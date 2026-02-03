import os
from datetime import datetime, timedelta
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from typing import Dict, List

class GoogleCalendarIntegration:
    def __init__(self):
        self.SCOPES = ['https://www.googleapis.com/auth/calendar']
        self.credentials = None
        
    def get_auth_url(self) -> str:
        """Get OAuth URL for user to authorize calendar access"""
        flow = Flow.from_client_config(
            {
                "web": {
                    "client_id": os.getenv("GOOGLE_CLIENT_ID"),
                    "client_secret": os.getenv("GOOGLE_CLIENT_SECRET"),
                    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                    "token_uri": "https://oauth2.googleapis.com/token",
                    "redirect_uris": ["http://localhost:8000/auth/google/callback"]
                }
            },
            scopes=self.SCOPES
        )
        flow.redirect_uri = "http://localhost:8000/auth/google/callback"
        
        auth_url, _ = flow.authorization_url(prompt='consent')
        return auth_url
    
    def exchange_code_for_token(self, code: str) -> dict:
        """Exchange authorization code for access token"""
        flow = Flow.from_client_config(
            {
                "web": {
                    "client_id": os.getenv("GOOGLE_CLIENT_ID"),
                    "client_secret": os.getenv("GOOGLE_CLIENT_SECRET"),
                    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                    "token_uri": "https://oauth2.googleapis.com/token",
                    "redirect_uris": ["http://localhost:8000/auth/google/callback"]
                }
            },
            scopes=self.SCOPES
        )
        flow.redirect_uri = "http://localhost:8000/auth/google/callback"
        flow.fetch_token(code=code)
        
        return {
            "access_token": flow.credentials.token,
            "refresh_token": flow.credentials.refresh_token
        }
    
    def create_study_events(self, study_plan: Dict, access_token: str) -> List[str]:
        """Create calendar events for study sessions"""
        credentials = Credentials(token=access_token)
        service = build('calendar', 'v3', credentials=credentials)
        
        created_events = []
        
        for date_str, day_plan in study_plan["schedule"].items():
            date_obj = datetime.strptime(date_str, "%Y-%m-%d")
            start_time = date_obj.replace(hour=9, minute=0)  # Default start at 9 AM
            
            for task in day_plan["tasks"]:
                # Create event for each task
                event = {
                    'summary': f"📚 {task['title']}",
                    'description': f"Priority: {task['priority']}\\nType: {task['task_type']}\\nEstimated time: {task['estimated_minutes']} minutes",
                    'start': {
                        'dateTime': start_time.isoformat(),
                        'timeZone': 'UTC',
                    },
                    'end': {
                        'dateTime': (start_time + timedelta(minutes=task['estimated_minutes'])).isoformat(),
                        'timeZone': 'UTC',
                    },
                    'colorId': '2' if task['priority'] == 'high' else '5',  # Green for high, yellow for others
                }
                
                try:
                    created_event = service.events().insert(calendarId='primary', body=event).execute()
                    created_events.append(created_event['id'])
                    start_time += timedelta(minutes=task['estimated_minutes'] + 10)  # 10 min buffer
                except Exception as e:
                    print(f"Error creating event: {e}")
        
        return created_events