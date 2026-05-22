import os
import sys
from app.main import app

# Add the current directory to sys.path so 'app' can be found
sys.path.append(os.path.dirname(__file__))

# Set root_path for Vercel deployment so routes match /api/...
app.root_path = "/api"
