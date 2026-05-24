import sys
import os

# Add the current directory to sys.path so we can import 'app'
sys.path.append(os.getcwd())

from app.config import get_supabase_client

try:
    print("Connecting to Supabase...")
    client = get_supabase_client()
    print("Fetching settings...")
    res = client.table("property_api_settings").select("*").execute()
    print(f"Success! Found {len(res.data)} properties.")
    for row in res.data:
        print(f"- {row.get('property_name')}")
except Exception as e:
    print(f"Error occurred: {str(e)}")
    import traceback
    traceback.print_exc()
