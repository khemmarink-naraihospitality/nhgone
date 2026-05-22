import os
import sys

# Add the current directory to sys.path BEFORE any other imports
sys.path.append(os.path.dirname(__file__))

from app.main import app

# Set root_path for Vercel deployment so routes match /api/...
app.root_path = "/api"
