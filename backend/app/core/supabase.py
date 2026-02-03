import os
from supabase import create_client, Client
from dotenv import load_dotenv

# Load .env from the correct path
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

def get_supabase_client() -> Client:
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    
    if not url or not key:
        raise ValueError(f"Missing Supabase credentials: URL={bool(url)}, KEY={bool(key)}")
    
    return create_client(url, key)