from app.services.sync_service import sync_service

if sync_service.supabase:
    res = sync_service.supabase.table("reservations_sync").select("property").execute()
    props = sorted(list(set(r["property"] for r in res.data)))
    print("Properties in Supabase:", props)
    
    cnt = sync_service.supabase.table("reservations_sync").select("mews_id", count="exact").eq("property", "Lub d Bangkok Chinatown").execute()
    print(f"Count for 'Lub d Bangkok Chinatown': {cnt.count}")
else:
    print("Supabase not connected")
