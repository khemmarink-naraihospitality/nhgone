import secrets
from typing import Optional
from fastapi import APIRouter, HTTPException, Body
from pydantic import BaseModel
from app.config import settings, get_supabase_client
from app.services.encryption import encryption_service
from app.services.email_service import email_service

router = APIRouter(prefix="/admin", tags=["admin"])

class UserCreateRequest(BaseModel):
    email: str
    role: str = "User"
    full_name: str = ""

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

@router.post("/users")
async def create_user(request: UserCreateRequest):
    """
    Pre-register a user by email + role. A random password is generated internally
    so the account exists in Supabase Auth — the user is expected to sign in via
    Google OAuth (which Supabase will link to this account by email).
    """
    try:
        admin_supabase = get_supabase_client()
        # Generate a strong random password — the user will never see or use this
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
        admin_supabase.table("profiles").upsert({
            "id": user_id,
            "email": request.email,
            "full_name": request.full_name,
            "role": request.role,
            "status": "Active"
        }).execute()

        email_sent = False
        email_error = None
        try:
            # Send welcome email without credentials — user should use Google login
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
