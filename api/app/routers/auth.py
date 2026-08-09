import logging

from fastapi import APIRouter
from pydantic import BaseModel

from app.config import settings, get_supabase_client
from app.services.email_service import email_service

logger = logging.getLogger(__name__)

# Public (unauthenticated) auth endpoints. Deliberately NOT under /admin -
# nothing here requires an existing session, which is the whole point: it's
# reached by someone who can't get in.
router = APIRouter(prefix="/auth", tags=["auth"])


class ForgotPasswordRequest(BaseModel):
    email: str


@router.post("/forgot-password")
async def forgot_password(request: ForgotPasswordRequest):
    """
    Emails a password-reset link for an Internal Auth account.

    The link is minted with Supabase's admin generate_link (type "recovery")
    rather than the client-side resetPasswordForEmail, so the mail goes out
    through this app's own SMTP settings and welcome-email styling instead of
    Supabase's default sender - the same reason send_welcome_email exists.

    Every outcome returns the identical response. A reset form that answers
    differently for a real address than an unknown one is an account
    enumeration oracle, and this login page is public. The three real
    outcomes, all invisible to the caller:
      * internal account  -> reset link emailed
      * Google account    -> a "sign in with Google instead" note emailed, so
                             the person isn't left waiting for a link that is
                             never coming
      * unknown address   -> nothing sent at all

    Not rate-limited here; abuse is bounded by the SMTP provider's own send
    limits, and Supabase rate-limits repeated recovery links per address.
    """
    generic_response = {
        "status": "success",
        "message": "If that email belongs to an NHGOne account, a reset link is on its way.",
    }
    email = (request.email or "").strip().lower()
    if not email:
        return generic_response

    try:
        admin_supabase = get_supabase_client()
        # select("*") rather than naming auth_method explicitly: on a database
        # where that column hasn't been added yet, an explicit list fails the
        # whole query and every reset silently turns into a no-op. With "*"
        # the field is simply absent and falls back to "google" below.
        profile_res = admin_supabase.table("profiles").select(
            "*").eq("email", email).limit(1).execute()
        profile = profile_res.data[0] if profile_res.data else None

        if not profile:
            logger.info("Password reset requested for unknown address - nothing sent")
            return generic_response

        # A deactivated account must not be able to reset its way back in.
        if profile.get("status") == "Inactive":
            logger.info("Password reset requested for an Inactive account - nothing sent")
            return generic_response

        full_name = profile.get("full_name") or ""

        # Accounts created before auth_method existed default to "google",
        # matching how every one of them was actually set up.
        if (profile.get("auth_method") or "google") != "internal":
            email_service.send_google_signin_notice_email(email, full_name)
            return generic_response

        link_res = admin_supabase.auth.admin.generate_link({
            "type": "recovery",
            "email": email,
            "options": {"redirect_to": f"{settings.APP_BASE_URL}/reset-password"},
        })
        action_link = link_res.properties.action_link
        email_service.send_password_reset_email(email, action_link, full_name)
    except Exception as e:
        # Deliberately swallowed: surfacing the failure would leak which
        # addresses exist (a send only fails for a real one). Logged instead.
        logger.error(f"Password reset for {email} failed: {e}")

    return generic_response
