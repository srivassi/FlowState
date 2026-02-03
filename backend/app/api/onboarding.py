from fastapi import APIRouter, HTTPException
from app.core.supabase import get_supabase_client
from pydantic import BaseModel
from typing import List, Optional

router = APIRouter(prefix="/onboarding")

class OnboardingStep1(BaseModel):
    learning_style: str
    best_study_times: List[str]  # ["morning", "afternoon", "evening"]
    attention_span: str  # "short", "medium", "long"

class OnboardingStep2(BaseModel):
    pomodoro_preference: str  # "classic", "power", "sprint", "custom"
    custom_work_minutes: Optional[int] = None
    custom_break_minutes: Optional[int] = None

class OnboardingStep3(BaseModel):
    daily_study_hours: int
    available_days: List[str]  # ["monday", "tuesday", ...]
    preferred_start_time: str  # "09:00"
    buffer_time_needed: bool

class OnboardingStep4(BaseModel):
    difficulty_progression: str  # "gradual", "mixed", "challenging"
    music_preference: str  # "focus_music", "ambient", "silence"
    break_activities: List[str]  # ["walk", "stretch", "snack"]
    distraction_blocking: bool

class CompleteOnboarding(BaseModel):
    user_id: str
    step1: OnboardingStep1
    step2: OnboardingStep2
    step3: OnboardingStep3
    step4: OnboardingStep4

@router.post("/complete")
def complete_onboarding(data: CompleteOnboarding):
    """Save complete onboarding data and create user profile"""
    
    try:
        # Convert to StudyPreferences format
        pomodoro_settings = {
            "classic": {"work": 25, "break": 5, "long_break": 15},
            "power": {"work": 50, "break": 10, "long_break": 30},
            "sprint": {"work": 15, "break": 3, "long_break": 10},
            "custom": {
                "work": data.step2.custom_work_minutes or 25,
                "break": data.step2.custom_break_minutes or 5,
                "long_break": (data.step2.custom_break_minutes or 5) * 3
            }
        }
        
        pomo = pomodoro_settings[data.step2.pomodoro_preference]
        
        user_profile = {
            "user_id": data.user_id,
            "learning_style": data.step1.learning_style,
            "daily_study_hours": data.step3.daily_study_hours,
            "preferred_session_length": pomo["work"],
            "difficulty_preference": data.step4.difficulty_progression,
            "pomodoro_work_minutes": pomo["work"],
            "pomodoro_break_minutes": pomo["break"],
            "long_break_minutes": pomo["long_break"],
            "best_study_times": data.step1.best_study_times,
            "music_preference": data.step4.music_preference,
            "distraction_blocking": data.step4.distraction_blocking
        }
        
        # For now, just return the profile without saving to database
        # TODO: Implement proper authentication and save to Supabase
        
        return {
            "status": "onboarding_complete",
            "profile": user_profile,
            "message": "Your personalized study plan is ready!"
        }
        
    except Exception as e:
        print(f"Error in onboarding: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/profile/{user_id}")
def get_user_profile(user_id: str):
    """Get user's study preferences"""
    supabase = get_supabase_client()
    result = supabase.table("user_profiles").select("*").eq("user_id", user_id).execute()
    
    if result.data:
        return result.data[0]
    else:
        raise HTTPException(status_code=404, detail="User profile not found")