from fastapi import APIRouter, HTTPException
from app.integrations.google_calendar import GoogleCalendarIntegration
from app.integrations.spotify import SpotifyIntegration
from app.integrations.productivity import ProductivityIntegrations
from pydantic import BaseModel
from typing import Optional

router = APIRouter(prefix="/integrations")

calendar_integration = GoogleCalendarIntegration()
spotify_integration = SpotifyIntegration()
productivity = ProductivityIntegrations()

class CalendarSyncRequest(BaseModel):
    study_plan: dict
    access_token: str

class SpotifySessionRequest(BaseModel):
    access_token: str
    playlist_id: Optional[str] = None

class NotificationRequest(BaseModel):
    title: str
    message: str

# Google Calendar Integration
@router.get("/calendar/auth")
def get_calendar_auth_url():
    """Get Google Calendar OAuth URL"""
    auth_url = calendar_integration.get_auth_url()
    return {"auth_url": auth_url}

@router.post("/calendar/sync")
def sync_to_calendar(request: CalendarSyncRequest):
    """Sync study plan to Google Calendar"""
    event_ids = calendar_integration.create_study_events(
        request.study_plan, 
        request.access_token
    )
    return {
        "status": "synced",
        "events_created": len(event_ids),
        "event_ids": event_ids
    }

# Spotify Integration
@router.get("/spotify/auth")
def get_spotify_auth_url():
    """Get Spotify OAuth URL"""
    auth_url = spotify_integration.get_auth_url()
    return {"auth_url": auth_url}

@router.get("/spotify/playlists")
def get_focus_playlists(access_token: str):
    """Get focus/study playlists from Spotify"""
    playlists = spotify_integration.get_focus_playlists(access_token)
    return {"playlists": playlists}

@router.post("/spotify/start-focus")
def start_focus_session(request: SpotifySessionRequest):
    """Start Spotify focus music for Pomodoro"""
    result = spotify_integration.start_focus_session(
        request.access_token, 
        request.playlist_id
    )
    return result

@router.post("/spotify/pause")
def pause_music(access_token: str):
    """Pause Spotify for break time"""
    result = spotify_integration.pause_music(access_token)
    return result

# Focus & Productivity Tools
@router.post("/notify/desktop")
def send_desktop_notification(request: NotificationRequest):
    """Send desktop notification for study reminders"""
    result = productivity.send_desktop_notification(
        request.title, 
        request.message
    )
    return result

@router.post("/focus/block-sites")
def block_distracting_sites(duration_minutes: int):
    """Block distracting websites during focus time"""
    result = productivity.block_distracting_websites(duration_minutes)
    return result

@router.get("/break/suggestions")
def get_break_suggestions():
    """Get healthy break activity suggestions"""
    result = productivity.get_study_break_suggestions()
    return result