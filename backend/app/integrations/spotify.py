import os
import spotipy
from spotipy.oauth2 import SpotifyOAuth
from typing import Dict, List

class SpotifyIntegration:
    def __init__(self):
        self.client_id = os.getenv("SPOTIFY_CLIENT_ID")
        self.client_secret = os.getenv("SPOTIFY_CLIENT_SECRET")
        self.redirect_uri = "http://localhost:8000/auth/spotify/callback"
        
        self.scope = "user-modify-playback-state user-read-playback-state playlist-read-private"
        
    def get_auth_url(self) -> str:
        """Get Spotify OAuth URL"""
        sp_oauth = SpotifyOAuth(
            client_id=self.client_id,
            client_secret=self.client_secret,
            redirect_uri=self.redirect_uri,
            scope=self.scope
        )
        return sp_oauth.get_authorize_url()
    
    def exchange_code_for_token(self, code: str) -> dict:
        """Exchange authorization code for access token"""
        sp_oauth = SpotifyOAuth(
            client_id=self.client_id,
            client_secret=self.client_secret,
            redirect_uri=self.redirect_uri,
            scope=self.scope
        )
        token_info = sp_oauth.get_access_token(code)
        return token_info
    
    def get_focus_playlists(self, access_token: str) -> List[Dict]:
        """Get focus/study playlists"""
        sp = spotipy.Spotify(auth=access_token)
        
        # Search for focus playlists
        focus_keywords = ["focus", "study", "concentration", "deep work", "lofi", "ambient"]
        playlists = []
        
        for keyword in focus_keywords[:3]:  # Limit searches
            try:
                results = sp.search(q=keyword, type='playlist', limit=5)
                for playlist in results['playlists']['items']:
                    playlists.append({
                        "id": playlist['id'],
                        "name": playlist['name'],
                        "description": playlist.get('description', ''),
                        "tracks": playlist['tracks']['total'],
                        "url": playlist['external_urls']['spotify']
                    })
            except Exception as e:
                print(f"Error searching playlists: {e}")
        
        return playlists[:10]  # Return top 10
    
    def start_focus_session(self, access_token: str, playlist_id: str = None) -> Dict:
        """Start playing focus music for Pomodoro session"""
        sp = spotipy.Spotify(auth=access_token)
        
        try:
            # Get available devices
            devices = sp.devices()
            if not devices['devices']:
                return {"error": "No active Spotify devices found"}
            
            device_id = devices['devices'][0]['id']
            
            # Default focus playlist if none provided
            if not playlist_id:
                # Use a popular focus playlist
                search_results = sp.search(q="Deep Focus", type='playlist', limit=1)
                if search_results['playlists']['items']:
                    playlist_id = search_results['playlists']['items'][0]['id']
            
            # Start playback
            sp.start_playback(
                device_id=device_id,
                context_uri=f"spotify:playlist:{playlist_id}"
            )
            
            # Set volume to moderate level
            sp.volume(volume_percent=60, device_id=device_id)
            
            return {
                "status": "playing",
                "playlist_id": playlist_id,
                "device": devices['devices'][0]['name']
            }
            
        except Exception as e:
            return {"error": f"Failed to start playback: {str(e)}"}
    
    def pause_music(self, access_token: str) -> Dict:
        """Pause music for break time"""
        sp = spotipy.Spotify(auth=access_token)
        
        try:
            sp.pause_playback()
            return {"status": "paused"}
        except Exception as e:
            return {"error": f"Failed to pause: {str(e)}"}