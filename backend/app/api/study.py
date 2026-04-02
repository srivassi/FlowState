from fastapi import APIRouter, HTTPException
from app.core.supabase import get_supabase_client
from app.agent.scheduler import reschedule_remaining, _parse_date
from pydantic import BaseModel
from typing import List, Optional
from datetime import date, datetime

router = APIRouter(prefix="/study")


class PomodoroStart(BaseModel):
    task_id: str
    user_id: str
    duration_minutes: int = 25


class PomodoroComplete(BaseModel):
    session_id: str
    notes: Optional[str] = None


class RescheduleRequest(BaseModel):
    course_id: str
    user_id: str
    completed_task_ids: List[str]
    exam_date: str          # ISO date
    daily_study_hours: int
    pomodoro_minutes: int = 25


# ─── Pomodoro ───────────────────────────────────────────────

@router.post("/pomodoro/start")
def start_pomodoro(body: PomodoroStart):
    supabase = get_supabase_client()

    # Mark task as in_progress
    supabase.table("tasks").update({"status": "in_progress"}).eq("id", body.task_id).execute()

    # Create session row
    result = supabase.table("pomodoro_sessions").insert({
        "task_id": body.task_id,
        "user_id": body.user_id,
        "duration_minutes": body.duration_minutes,
        "started_at": datetime.utcnow().isoformat(),
        "is_completed": False,
    }).execute()

    if not result.data:
        raise HTTPException(status_code=400, detail="Failed to start session")
    return result.data[0]


@router.post("/pomodoro/complete")
def complete_pomodoro(body: PomodoroComplete):
    supabase = get_supabase_client()

    update = {
        "is_completed": True,
        "completed_at": datetime.utcnow().isoformat(),
    }
    if body.notes:
        update["notes"] = body.notes

    result = supabase.table("pomodoro_sessions").update(update).eq("id", body.session_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Session not found")

    session = result.data[0]

    # Mark task done
    supabase.table("tasks").update({
        "status": "done",
        "completed_at": datetime.utcnow().isoformat(),
    }).eq("id", session["task_id"]).execute()

    return session


@router.get("/pomodoro/sessions/{user_id}")
def get_sessions(user_id: str, limit: int = 50):
    supabase = get_supabase_client()
    result = (
        supabase.table("pomodoro_sessions")
        .select("*, tasks(title, course_id)")
        .eq("user_id", user_id)
        .order("started_at", desc=True)
        .limit(limit)
        .execute()
    )
    return result.data


# ─── Today's plan ────────────────────────────────────────────

@router.get("/today/{user_id}")
def get_today_plan(user_id: str):
    supabase = get_supabase_client()
    today = date.today().isoformat()

    tasks_result = (
        supabase.table("tasks")
        .select("*, courses(title, color, exam_date)")
        .eq("user_id", user_id)
        .eq("scheduled_date", today)
        .order("order_index")
        .execute()
    )
    for t in (tasks_result.data or []):
        if t.get("courses"):
            t["courses"]["name"] = t["courses"].pop("title", "")

    sessions_result = (
        supabase.table("pomodoro_sessions")
        .select("*")
        .eq("user_id", user_id)
        .gte("started_at", f"{today}T00:00:00")
        .execute()
    )

    tasks = tasks_result.data or []
    sessions = sessions_result.data or []
    completed_today = sum(1 for s in sessions if s["is_completed"])

    return {
        "date": today,
        "tasks": tasks,
        "completed_pomodoros_today": completed_today,
        "total_tasks": len(tasks),
        "completed_tasks": sum(1 for t in tasks if t["status"] == "done"),
    }


# ─── Stats ───────────────────────────────────────────────────

@router.get("/stats/{user_id}")
def get_stats(user_id: str):
    supabase = get_supabase_client()

    sessions = (
        supabase.table("pomodoro_sessions")
        .select("*")
        .eq("user_id", user_id)
        .eq("is_completed", True)
        .execute()
    ).data or []

    tasks_done = (
        supabase.table("tasks")
        .select("id, completed_at")
        .eq("user_id", user_id)
        .eq("status", "done")
        .execute()
    ).data or []

    total_focus_minutes = sum(s["duration_minutes"] for s in sessions)

    # Streak calculation
    completed_dates = sorted(set(
        s["completed_at"][:10] for s in sessions if s.get("completed_at")
    ), reverse=True)

    streak = 0
    check = date.today()
    for d_str in completed_dates:
        if _parse_date(d_str) == check:
            streak += 1
            check = check.__class__.fromordinal(check.toordinal() - 1)
        elif _parse_date(d_str) < check:
            break

    # Weekly pomodoros (last 7 days)
    from datetime import timedelta
    weekly = []
    for i in range(6, -1, -1):
        day = (date.today() - timedelta(days=i)).isoformat()
        count = sum(1 for s in sessions if s.get("completed_at", "")[:10] == day)
        weekly.append({"date": day, "count": count})

    return {
        "tasks_completed": len(tasks_done),
        "total_focus_minutes": total_focus_minutes,
        "streak_days": streak,
        "weekly_pomodoros": weekly,
    }


# ─── Reschedule ──────────────────────────────────────────────

@router.post("/reschedule")
def reschedule(body: RescheduleRequest):
    supabase = get_supabase_client()

    # Fetch all tasks for course
    result = supabase.table("tasks").select("*").eq("course_id", body.course_id).execute()
    tasks = result.data or []

    # Fetch disruptions
    disruptions_result = supabase.table("disruptions").select("*").eq("user_id", body.user_id).execute()
    disruptions = disruptions_result.data or []

    updated = reschedule_remaining(
        tasks=tasks,
        completed_task_ids=body.completed_task_ids,
        exam_date=_parse_date(body.exam_date),
        daily_study_hours=body.daily_study_hours,
        pomodoro_minutes=body.pomodoro_minutes,
        disruptions=disruptions,
    )

    # Write updated scheduled_dates back to Supabase
    for t in updated:
        supabase.table("tasks").update({
            "scheduled_date": t.get("scheduled_date"),
            "order_index": t.get("order_index", 0),
        }).eq("id", t["id"]).execute()

    return {"rescheduled_count": len(updated), "tasks": updated}
