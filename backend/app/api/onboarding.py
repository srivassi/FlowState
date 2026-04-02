from fastapi import APIRouter, HTTPException
from app.core.supabase import get_supabase_client
from pydantic import BaseModel
from typing import List, Optional

router = APIRouter(prefix="/onboarding")

POMODORO_PRESETS = {
    "classic": {"work": 25, "break": 5, "long_break": 15},
    "power":   {"work": 50, "break": 10, "long_break": 30},
    "sprint":  {"work": 15, "break": 3,  "long_break": 10},
}


class CompleteOnboarding(BaseModel):
    user_id: str
    display_name: Optional[str] = None
    daily_study_hours: int = 4
    pomodoro_preset: str = "classic"         # classic | power | sprint | custom
    custom_work_minutes: Optional[int] = None
    custom_break_minutes: Optional[int] = None


@router.post("/complete")
def complete_onboarding(data: CompleteOnboarding):
    supabase = get_supabase_client()

    if data.pomodoro_preset == "custom":
        work  = data.custom_work_minutes or 25
        brk   = data.custom_break_minutes or 5
        long  = brk * 3
    else:
        preset = POMODORO_PRESETS.get(data.pomodoro_preset, POMODORO_PRESETS["classic"])
        work, brk, long = preset["work"], preset["break"], preset["long_break"]

    profile = {
        "id": data.user_id,
        "display_name": data.display_name,
        "daily_study_hours": data.daily_study_hours,
        "pomodoro_work_minutes": work,
        "pomodoro_break_minutes": brk,
        "long_break_minutes": long,
        "long_break_interval": 4,
        "onboarding_complete": True,
    }

    # Upsert so re-running onboarding updates rather than errors
    result = supabase.table("user_profiles").upsert(profile).execute()
    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to save profile")

    return {"status": "onboarding_complete", "profile": result.data[0]}


@router.get("/profile/{user_id}")
def get_user_profile(user_id: str):
    supabase = get_supabase_client()
    result = supabase.table("user_profiles").select("*").eq("id", user_id).limit(1).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Profile not found")
    return result.data[0]


# ─── Courses ─────────────────────────────────────────────────

class CourseCreate(BaseModel):
    user_id: str
    name: str                          # mapped to 'title' in DB
    exam_date: Optional[str] = None
    color: str = "#3B82F6"


@router.post("/courses")
def create_course(body: CourseCreate):
    supabase = get_supabase_client()
    row = {
        "user_id": body.user_id,
        "title": body.name,            # DB column is 'title'
        "exam_date": body.exam_date,
        "color": body.color,
    }
    result = supabase.table("courses").insert(row).execute()
    if not result.data:
        raise HTTPException(status_code=400, detail="Failed to create course")
    # Normalise response: expose 'name' so frontend stays consistent
    row = result.data[0]
    row["name"] = row.get("title", "")
    return row


@router.get("/courses/{user_id}")
def get_courses(user_id: str):
    supabase = get_supabase_client()
    result = (
        supabase.table("courses")
        .select("*")
        .eq("user_id", user_id)
        .order("exam_date", desc=False)
        .execute()
    )
    # Normalise: add 'name' alias for 'title'
    rows = result.data or []
    for r in rows:
        r["name"] = r.get("title", "")
    return rows


@router.delete("/courses/{course_id}")
def delete_course(course_id: str):
    supabase = get_supabase_client()
    supabase.table("courses").delete().eq("id", course_id).execute()
    return {"deleted": course_id}


# ─── Disruptions ─────────────────────────────────────────────

class DisruptionCreate(BaseModel):
    user_id: str
    label: str
    start_date: str   # ISO date
    end_date: str     # ISO date


@router.post("/disruptions")
def create_disruption(body: DisruptionCreate):
    supabase = get_supabase_client()
    result = supabase.table("disruptions").insert(body.dict()).execute()
    if not result.data:
        raise HTTPException(status_code=400, detail="Failed to save disruption")
    return result.data[0]


@router.get("/disruptions/{user_id}")
def get_disruptions(user_id: str):
    supabase = get_supabase_client()
    result = supabase.table("disruptions").select("*").eq("user_id", user_id).order("start_date").execute()
    return result.data


@router.delete("/disruptions/{disruption_id}")
def delete_disruption(disruption_id: str):
    supabase = get_supabase_client()
    supabase.table("disruptions").delete().eq("id", disruption_id).execute()
    return {"deleted": disruption_id}
