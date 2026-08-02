from fastapi import Depends, Header, HTTPException
from app.config import get_supabase_client


async def get_current_user(authorization: str = Header(None)):
    """
    Verifies the Supabase session JWT the frontend attaches on every request
    (see src/lib/api.ts's apiFetch) against Supabase Auth itself - this is
    what every other backend endpoint was missing entirely until this file
    was added, letting anyone who knew a URL call the API with no login at
    all. Returns the underlying Supabase auth user (id/email), not yet
    cross-checked against `profiles` - see get_current_active_user for that.
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing or malformed Authorization header")
    token = authorization.split(" ", 1)[1].strip()
    try:
        res = get_supabase_client().auth.get_user(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    user = getattr(res, "user", None)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    return user


async def get_current_active_user(user=Depends(get_current_user)):
    """
    Same as get_current_user, plus requires the caller's `profiles` row to
    exist and be Active - mirrors Navigation.tsx's own Inactive/Pending
    handling so a session token issued before an admin flips someone to
    Inactive can't still be used to hit the API directly until it expires.
    """
    admin_supabase = get_supabase_client()
    res = admin_supabase.table("profiles").select("role, status").eq("id", user.id).limit(1).execute()
    if not res.data:
        raise HTTPException(status_code=403, detail="No profile found for this account")
    profile = res.data[0]
    if profile.get("status") != "Active":
        raise HTTPException(status_code=403, detail=f"Account is {profile.get('status', 'not active')}")
    return {"id": user.id, "email": user.email, "role": profile.get("role")}


def _is_super_admin(role: str) -> bool:
    role = (role or "").strip().lower()
    return role in ("super admin", "super_admin")


async def require_admin(current=Depends(get_current_active_user)):
    """
    Admin-only gate for the sensitive admin.py endpoints (user CRUD, MEWS
    property tokens, SMTP credentials) - mirrors Navigation.tsx's own admin
    route guard (Super Admin always passes; any other role needs
    role_permissions.admin === true).
    """
    role = current.get("role")
    if _is_super_admin(role):
        return current
    admin_supabase = get_supabase_client()
    res = admin_supabase.table("role_permissions").select("admin").eq("role", role).limit(1).execute()
    if res.data and res.data[0].get("admin"):
        return current
    raise HTTPException(status_code=403, detail="Admin access required")
