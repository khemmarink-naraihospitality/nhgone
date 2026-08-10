import logging
import secrets
from datetime import datetime, timedelta
from typing import Optional
from zoneinfo import ZoneInfo
from fastapi import APIRouter, HTTPException, Body
from pydantic import BaseModel
from app.config import settings, get_supabase_client
from app.services.encryption import encryption_service
from app.services.email_service import email_service, WELCOME_TEMPLATE_KEY, ST_FILES_DAILY_TEMPLATE_KEY
from app.services.sync_service import sync_service
from app.services import ftp_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])

class UserCreateRequest(BaseModel):
    email: str
    role: str = "User"
    full_name: str = ""
    # "google" (default) - a random, never-shown password is generated purely
    # so the Supabase Auth row exists; the user signs in via Google OAuth,
    # which Supabase links to this account by email. "internal" - for users
    # without a Google account on this email (e.g. a shared/contractor
    # address): a real password is generated and emailed to them directly,
    # for the login page's "Internal Auth" email/password form.
    auth_method: str = "google"

class SelfRegisterRequest(BaseModel):
    id: str
    email: str
    full_name: str = ""

class ApproveUserRequest(BaseModel):
    role: str

class SyncScheduleUpdate(BaseModel):
    sync_hour: int
    sync_minute: int
    sync_enabled: bool

class PropertyApiSettingsUpdate(BaseModel):
    property_name: str
    client_name: str
    client_token: str
    access_token: str
    # Per-property code used in the legacy pipe-delimited ST statistics
    # export (field 17) - e.g. "SM" for Lub d Bangkok Siam. Not sensitive,
    # so it isn't in encryption.py's SENSITIVE_FIELDS.
    st_property_code: Optional[str] = None
    # Comma-separated MEWS resource category types this property's ST report
    # counts, mirroring its own export schedule's "Space types" filter (e.g.
    # "Room,Bed" for most, "Room,Suite" for Koh Tao / Marasca Samui). Blank
    # falls back to Room,Bed - see sync_service._resolve_st_space_types.
    st_space_types: Optional[str] = None

class SyncRetrySettingsUpdate(BaseModel):
    retry_count: int = 2
    retry_interval_minutes: int = 60

class FtpSettingsUpdate(BaseModel):
    host: str
    port: int = 21
    username: Optional[str] = None
    # Omitted/blank preserves the existing encrypted password, same
    # semantics as SmtpSettingsUpdate.password below.
    password: Optional[str] = None
    remote_path: str = ""
    enabled: bool = False
    upload_hour: int = 4
    upload_minute: int = 0

class SmtpSettingsUpdate(BaseModel):
    host: str
    port: int = 587
    username: Optional[str] = None
    password: Optional[str] = None
    from_email: str
    from_name: Optional[str] = None
    use_tls: bool = True

class SmtpTestRequest(BaseModel):
    to_email: str

class EmailTemplateUpdate(BaseModel):
    subject: str
    html_template: str

class StFilesEmailSettingsUpdate(BaseModel):
    subject: str
    html_template: str
    recipients: str
    send_hour: int
    send_minute: int
    enabled: bool = True

@router.post("/users")
async def create_user(request: UserCreateRequest):
    """
    Pre-register a user by email + role. A strong random password is always
    generated so the Supabase Auth row exists, but nobody is ever told it -
    "google" throws it away entirely (Google OAuth is the real credential,
    linked by email); "internal" emails a Supabase recovery link instead (the
    same generate_link mechanism POST /auth/forgot-password uses) so the user
    sets their own password on /reset-password rather than receiving one.
    """
    is_internal = request.auth_method == "internal"
    try:
        admin_supabase = get_supabase_client()
        random_password = secrets.token_urlsafe(32)
        auth_res = admin_supabase.auth.admin.create_user({
            "email": request.email,
            "password": random_password,
            "email_confirm": True,
            "user_metadata": {
                "full_name": request.full_name,
                "role": request.role
            }
        })
        if not auth_res or not auth_res.user:
            raise HTTPException(status_code=400, detail="Failed to create auth user")
        user_id = auth_res.user.id
        try:
            admin_supabase.table("profiles").upsert({
                "id": user_id,
                "email": request.email,
                "full_name": request.full_name,
                "role": request.role,
                "status": "Active",
                "auth_method": "internal" if is_internal else "google",
                # The emailed password is a delivery mechanism, not a
                # credential the user chose - Navigation.tsx blocks the app
                # behind a forced change screen until they replace it. Google
                # accounts have no password to change, so the flag stays off.
                "must_change_password": is_internal,
            }).execute()
        except Exception as profile_error:
            # The auth user already exists at this point. Leaving it behind
            # would take the address hostage - a retry would fail with "email
            # already registered" while the person still can't sign in
            # (no profile => the auth guard rejects them). Undo it so the
            # admin can simply fix the cause and create the user again.
            logger.error(f"Profile row failed for {request.email}, rolling back auth user: {profile_error}")
            try:
                admin_supabase.auth.admin.delete_user(user_id)
            except Exception as cleanup_error:
                logger.error(f"Rollback of orphaned auth user {user_id} failed: {cleanup_error}")
            raise HTTPException(
                status_code=500,
                detail=(
                    f"Could not create the profile row: {profile_error}. "
                    "If this mentions an unknown 'auth_method' or 'must_change_password' column, "
                    "the profiles table still needs those two columns added."
                ),
            )

        email_sent = False
        email_error = None
        set_password_link = None
        try:
            if is_internal:
                link_res = admin_supabase.auth.admin.generate_link({
                    "type": "recovery",
                    "email": request.email,
                    "options": {"redirect_to": f"{settings.APP_BASE_URL}/reset-password"},
                })
                set_password_link = link_res.properties.action_link
                email_service.send_internal_welcome_email(request.email, set_password_link, request.full_name)
            else:
                # Google flow - no credentials or links in the email; the
                # throwaway password above is never shown to anyone.
                email_service.send_welcome_email(request.email, None, request.full_name)
            email_sent = True
        except Exception as e:
            email_error = str(e)

        return {
            "status": "success",
            "message": f"User {request.email} pre-registered successfully",
            "user_id": user_id,
            "email_sent": email_sent,
            "email_error": email_error,
            # Only surfaced for internal accounts, and only so the admin has
            # something to hand the user directly if the email above failed -
            # a Google-flow account has no link or password to share.
            "set_password_link": set_password_link,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/self-register")
async def self_register(request: SelfRegisterRequest):
    """
    Auto-provisions a pending profile the first time someone logs in (Google or
    email/password) with no existing profiles row, instead of Navigation.tsx's
    old behavior of immediately kicking them out as unauthorized. They land on
    a "waiting for approval" screen until a Super Admin approves them via
    approve_user below. Role/status are fixed here ("User"/"Pending")
    regardless of what's posted - only the Approve action can grant Active
    status (or change the role away from the Role Settings grid's default).
    """
    try:
        admin_supabase = get_supabase_client()
        existing = admin_supabase.table("profiles").select("id").eq("id", request.id).limit(1).execute()
        if existing.data:
            return {"status": "success", "message": "Profile already exists"}
        admin_supabase.table("profiles").insert({
            "id": request.id,
            "email": request.email,
            "full_name": request.full_name,
            "role": "User",
            "status": "Pending",
        }).execute()
        return {"status": "success", "message": "Pending profile created"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/users/{user_id}/approve")
async def approve_user(user_id: str, request: ApproveUserRequest):
    """
    Super Admin approval step for a pending self-registered user: sets their
    real role and flips status to Active, which unlocks the normal app (see
    Navigation.tsx's pending-status gate).
    """
    try:
        admin_supabase = get_supabase_client()
        res = admin_supabase.table("profiles").update({
            "role": request.role,
            "status": "Active",
        }).eq("id", user_id).execute()
        if not res.data:
            raise HTTPException(status_code=404, detail="User not found")
        return {"status": "success", "message": "User approved"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/users/{user_id}")
async def delete_user(user_id: str):
    """
    Removes a user's profile (Pending or Active) and emails them that access
    was not authorized. Only the profiles row is deleted, not the underlying
    Supabase Auth user — if they sign in again, self_register above will
    re-create a fresh Pending profile so they can be reviewed again.
    """
    try:
        admin_supabase = get_supabase_client()
        existing = admin_supabase.table("profiles").select("email, full_name").eq("id", user_id).limit(1).execute()
        if not existing.data:
            raise HTTPException(status_code=404, detail="User not found")
        email = existing.data[0]["email"]
        full_name = existing.data[0].get("full_name") or ""

        admin_supabase.table("profiles").delete().eq("id", user_id).execute()

        email_sent = False
        email_error = None
        try:
            email_service.send_rejection_email(email, full_name)
            email_sent = True
        except Exception as e:
            email_error = str(e)

        return {"status": "success", "message": "User deleted", "email_sent": email_sent, "email_error": email_error}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/sync/properties")
async def get_sync_properties():
    """
    Fetch all properties and their sync schedule settings.
    """
    try:
        admin_supabase = get_supabase_client()
        res = admin_supabase.table("property_api_settings").select("*").order("property_name").execute()
        decrypted_data = [encryption_service.decrypt_data(row) for row in res.data]
        return {"status": "success", "data": decrypted_data}
    except Exception as e:
        print(f"Error in get_sync_properties: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/sync/properties")
async def create_property_settings(request: PropertyApiSettingsUpdate):
    try:
        admin_supabase = get_supabase_client()
        data = request.dict()
        encrypted_data = encryption_service.encrypt_data(data)
        
        res = admin_supabase.table("property_api_settings").insert(encrypted_data).execute()
        return {"status": "success", "data": res.data[0] if res.data else None}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/sync/properties/{property_id}")
async def update_property_settings(property_id: str, request: PropertyApiSettingsUpdate):
    try:
        admin_supabase = get_supabase_client()
        data = request.dict()
        encrypted_data = encryption_service.encrypt_data(data)

        admin_supabase.table("property_api_settings").update(encrypted_data).eq("id", property_id).execute()
        return {"status": "success", "message": "Property settings updated"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/sync/retry-settings")
async def get_sync_retry_settings():
    """
    Global policy for main.py's retry_scheduled_syncs: how many times, and
    how many minutes apart, a property's Data Mart sync is auto-retried
    after its own scheduled run if a table is still missing or errored that
    day. Reuses sync_service's lookup (same one the retry job itself calls)
    so this always reflects what will actually run, including the built-in
    fallback (2 retries, 60 min apart) before the settings row has been saved.
    """
    try:
        data = await sync_service.get_sync_retry_settings()
        return {"status": "success", "data": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/sync/retry-settings")
async def save_sync_retry_settings(request: SyncRetrySettingsUpdate):
    """
    Upsert the single global retry-policy row. Clamped server-side: 0-6
    retries (0 disables the retry pass entirely), 5-720 minutes between them
    - the interval floors at 5 since retry_scheduled_syncs' dedicated cron
    only ticks every 5 minutes in production (see its own docstring), so a
    finer value would just resolve to that same 5-minute bucket anyway.
    """
    try:
        retry_count = max(0, min(request.retry_count, 6))
        retry_interval_minutes = max(5, min(request.retry_interval_minutes, 720))
        admin_supabase = get_supabase_client()
        existing = admin_supabase.table("sync_retry_settings").select("id").limit(1).execute()
        payload = {"retry_count": retry_count, "retry_interval_minutes": retry_interval_minutes}
        if existing.data:
            admin_supabase.table("sync_retry_settings").update(payload).eq("id", existing.data[0]["id"]).execute()
        else:
            admin_supabase.table("sync_retry_settings").insert(payload).execute()
        return {"status": "success", "message": "Retry settings saved"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/ftp-settings")
async def get_ftp_settings_route():
    """
    Fetch the single global ST Files FTP upload settings row (Admin > Sync >
    ST Files FTP Upload). The real password is never returned - only
    whether one is set - same convention as GET /admin/smtp.
    """
    try:
        data = ftp_service.get_ftp_settings()
        data["password_set"] = bool(data.get("password"))
        data.pop("password", None)
        return {"status": "success", "data": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/ftp-settings")
async def save_ftp_settings(request: FtpSettingsUpdate):
    """
    Upsert the single global FTP settings row. If password is omitted/
    blank, the existing encrypted password (if any) is preserved instead
    of wiped - same convention as POST /admin/smtp.
    """
    try:
        admin_supabase = get_supabase_client()
        existing = admin_supabase.table("ftp_settings").select("id, password").limit(1).execute()

        payload = request.dict(exclude={"password"})
        if request.password:
            payload["password"] = encryption_service.encrypt(request.password)
        elif existing.data:
            payload["password"] = existing.data[0].get("password")

        if existing.data:
            admin_supabase.table("ftp_settings").update(payload).eq("id", existing.data[0]["id"]).execute()
        else:
            admin_supabase.table("ftp_settings").insert(payload).execute()

        return {"status": "success", "message": "FTP settings saved"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/ftp-settings/upload-now")
async def upload_ftp_now():
    """
    Manual "Upload Test Now" trigger (Admin > Sync > ST Files FTP Upload) -
    connects and uploads immediately, bypassing the schedule. Targets
    YESTERDAY's report, same as the real scheduled upload and the same
    reasoning as the email digest's own "Send Test Now" (daily_auto_sync_st_files'
    docstring: "today" would be an incomplete, still-in-progress day) - this
    exercises the exact same path production uses. mark_sent=False so this
    never marks anything as already-uploaded, meaning it can't suppress the
    real scheduled upload for the same day.
    """
    try:
        report_date_str = (datetime.now(ZoneInfo("Asia/Bangkok")).date() - timedelta(days=1)).isoformat()
        result = await sync_service.send_st_files_ftp_upload(report_date_str, mark_sent=False, sync_type="manual")
        if not result.get("uploaded"):
            reason = result.get("reason") or "; ".join(result.get("skipped", [])) or "no properties have yesterday's data imported yet"
            raise HTTPException(status_code=400, detail=f"Nothing uploaded - {reason}")
        return {
            "status": "success",
            "message": f"Uploaded {len(result['included'])} file(s)",
            "included": result["included"],
            "skipped": result["skipped"],
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/sync/properties/{property_id}")
async def delete_property_settings(property_id: str):
    try:
        admin_supabase = get_supabase_client()
        admin_supabase.table("property_api_settings").delete().eq("id", property_id).execute()
        return {"status": "success", "message": "Property deleted"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/sync/logs")
async def get_sync_logs(
    property: str = None,
    limit: int = 200
):
    """
    Fetch sync logs from the sync_logs table.
    """
    try:
        admin_supabase = get_supabase_client()
        # Join with property_api_settings to get the property name if property_id is present
        query = admin_supabase.table("sync_logs").select("*, property_api_settings(property_name)").order("created_at", desc=True).limit(limit)
        
        if property and property != "All":
            query = query.eq("property", property)
            
        res = query.execute()
        
        # Format the data to ensure 'property' field is populated from the join
        formatted_data = []
        for row in res.data:
            if not row.get("property") and row.get("property_api_settings"):
                row["property"] = row["property_api_settings"].get("property_name")
            formatted_data.append(row)
            
        return {"status": "success", "data": formatted_data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/smtp")
async def get_smtp_settings():
    """
    Fetch the single global SMTP settings row. The real password is never
    returned - only whether one is set.
    """
    try:
        admin_supabase = get_supabase_client()
        res = admin_supabase.table("smtp_settings").select("*").limit(1).execute()
        if not res.data:
            return {"status": "success", "data": None}
        row = res.data[0]
        password_set = bool(row.get("password"))
        row.pop("password", None)
        row["password_set"] = password_set
        return {"status": "success", "data": row}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/smtp")
async def save_smtp_settings(request: SmtpSettingsUpdate):
    """
    Upsert the single global SMTP settings row. If password is omitted/blank,
    the existing encrypted password (if any) is preserved instead of wiped.
    """
    try:
        admin_supabase = get_supabase_client()
        existing = admin_supabase.table("smtp_settings").select("id, password").limit(1).execute()

        payload = request.dict(exclude={"password"})
        if request.password:
            payload["password"] = encryption_service.encrypt(request.password)
        elif existing.data:
            payload["password"] = existing.data[0].get("password")

        if existing.data:
            admin_supabase.table("smtp_settings").update(payload).eq("id", existing.data[0]["id"]).execute()
        else:
            admin_supabase.table("smtp_settings").insert(payload).execute()

        return {"status": "success", "message": "SMTP settings saved"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/smtp/test")
async def test_smtp_settings(request: SmtpTestRequest):
    try:
        email_service.send_email(
            request.to_email,
            "NHGOne SMTP Test",
            "<p>This is a test email from NHGOne. If you received this, your SMTP settings are working.</p>",
            "This is a test email from NHGOne. If you received this, your SMTP settings are working.",
        )
        return {"status": "success", "message": f"Test email sent to {request.to_email}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/email-template")
async def get_email_template():
    """
    Returns the admin-edited welcome email (Admin > Templates > Email), or
    the built-in default (is_default=True) if none saved yet - same
    editable-template pattern as GET /bills/template and GET /rr3/template.
    """
    return {"status": "success", "data": email_service.get_welcome_template()}

@router.post("/email-template")
async def save_email_template(request: EmailTemplateUpdate):
    try:
        admin_supabase = get_supabase_client()
        existing = admin_supabase.table("email_templates").select("id") \
            .eq("template_key", WELCOME_TEMPLATE_KEY).limit(1).execute()
        payload = {
            "template_key": WELCOME_TEMPLATE_KEY,
            "subject": request.subject,
            "html_template": request.html_template,
        }
        if existing.data:
            admin_supabase.table("email_templates").update(payload).eq("id", existing.data[0]["id"]).execute()
        else:
            admin_supabase.table("email_templates").insert(payload).execute()
        return {"status": "success", "message": "Email template saved"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/email-template/st-files-daily")
async def get_st_files_daily_email_template():
    """
    Returns the ST Files daily digest's subject/body plus delivery config
    (recipients/send_hour/send_minute/enabled), or the built-in defaults
    (is_default=True) if none saved yet - see
    email_service.get_st_files_daily_settings.
    """
    return {"status": "success", "data": email_service.get_st_files_daily_settings()}

@router.post("/email-template/st-files-daily")
async def save_st_files_daily_email_template(request: StFilesEmailSettingsUpdate):
    try:
        admin_supabase = get_supabase_client()
        existing = admin_supabase.table("email_templates").select("id") \
            .eq("template_key", ST_FILES_DAILY_TEMPLATE_KEY).limit(1).execute()
        payload = {
            "template_key": ST_FILES_DAILY_TEMPLATE_KEY,
            "subject": request.subject,
            "html_template": request.html_template,
            "recipients": request.recipients,
            "send_hour": request.send_hour,
            "send_minute": request.send_minute,
            "enabled": request.enabled,
        }
        if existing.data:
            admin_supabase.table("email_templates").update(payload).eq("id", existing.data[0]["id"]).execute()
        else:
            admin_supabase.table("email_templates").insert(payload).execute()
        return {"status": "success", "message": "ST Files email settings saved"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/email-template/st-files-daily/send-now")
async def send_st_files_daily_email_now():
    """
    Manual "Send Test Now" trigger (Admin > Templates > ST Files Email) -
    builds and sends immediately, bypassing the schedule. Targets
    YESTERDAY's report, same as the real scheduled send (see
    daily_auto_sync_st_files' docstring on why "today" would be an
    incomplete, still-in-progress day) - this is meant to test the exact
    same path production uses, not a different one. mark_sent=False so
    this never marks anything as already-sent, meaning it can't suppress
    the real scheduled send for the same day.
    """
    try:
        report_date_str = (datetime.now(ZoneInfo("Asia/Bangkok")).date() - timedelta(days=1)).isoformat()
        result = await sync_service.send_st_files_daily_digest(report_date_str, mark_sent=False)
        if not result.get("sent"):
            skipped = "; ".join(result.get("skipped", [])) or "no properties have yesterday's data imported yet"
            raise HTTPException(status_code=400, detail=f"Nothing sent - {skipped}")
        settings_row = email_service.get_st_files_daily_settings()
        return {
            "status": "success",
            "message": f"Sent to {settings_row['recipients']}",
            "included": result["included"],
            "skipped": result["skipped"],
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
