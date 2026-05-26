import os
import sys
import asyncio
from datetime import datetime
from zoneinfo import ZoneInfo

# Add the project directory to sys.path
current_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.append(current_dir)

# Load env variables from .env
from dotenv import load_dotenv
load_dotenv(os.path.join(current_dir, ".env"))

from app.main import daily_auto_sync

async def test_manual_sync():
    print("=== Starting Manual Auto-Sync Test ===")
    start_time = datetime.now()
    
    # We pass force_all=True to bypass the time-matching logic
    try:
        await daily_auto_sync(force_all=True)
        print(f"=== Test Completed Successfully in {datetime.now() - start_time} ===")
    except Exception as e:
        print(f"=== Test FAILED: {str(e)} ===")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test_manual_sync())
