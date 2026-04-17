import os
import re
import json
import traceback
from collections import defaultdict
from datetime import date, datetime, timedelta
import anthropic as _anthropic
from fastapi import APIRouter, HTTPException
from app.core.supabase import get_supabase_client
from app.agent.scheduler import (
    generate_schedule, reschedule_remaining, _parse_date,
    generate_schedule_multi_course, course_capacity_report, _calc_pomodoros_per_day,
)
from pydantic import BaseModel
from typing import List, Optional

router = APIRouter(prefix="/study")


def _extract_json(raw: str) -> dict:
    """
    Robustly extract a JSON object from Claude's response.
    Handles markdown fences, leading/trailing prose, and minor structural errors.
    """
    # 1. Strip markdown code fences
    cleaned = re.sub(r'```(?:json)?\s*', '', raw).strip()

    # 2. Try direct parse first
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    # 3. Extract the outermost {...} block and try again
    obj_match = re.search(r'\{[\s\S]*\}', cleaned)
    if obj_match:
        try:
            return json.loads(obj_match.group(0))
        except json.JSONDecodeError:
            pass

    # 4. Last resort: try progressively shorter substrings (truncation recovery)
    if obj_match:
        candidate = obj_match.group(0)
        # Walk back from the end, closing any open structures
        for trim in range(0, min(500, len(candidate)), 10):
            try:
                return json.loads(candidate[:len(candidate) - trim])
            except json.JSONDecodeError:
                continue

    return {}


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


class FullRescheduleRequest(BaseModel):
    user_id: str
    feedback: Optional[str] = None
    interleave_courses: bool = True
    sessions_per_day_override: Optional[int] = None
    directives: Optional[dict] = None   # pre-computed from /reschedule-preview
    overflow_strategy: str = "defer"    # "merge" | "defer" | "keep_all"


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

    # Streak calculation — consecutive days ending today or yesterday
    completed_dates = sorted(set(
        s["completed_at"][:10] for s in sessions if s.get("completed_at")
    ), reverse=True)

    streak = 0
    today = date.today()
    # Allow streak to count if most recent session was today or yesterday
    check = today if (completed_dates and _parse_date(completed_dates[0]) == today) else today - timedelta(days=1)
    for d_str in completed_dates:
        d = _parse_date(d_str)
        if d == check:
            streak += 1
            check = check - timedelta(days=1)
        elif d < check:
            break

    # Weekly pomodoros (last 7 days)
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


def _load_reschedule_context(user_id: str, sessions_per_day_override=None):
    """Load everything needed for a reschedule — shared by preview and apply."""
    supabase = get_supabase_client()
    today = date.today()

    disruptions = supabase.table("disruptions").select("*").eq("user_id", user_id).execute().data or []
    profile_rows = supabase.table("user_profiles").select("*").eq("id", user_id).limit(1).execute().data
    profile = profile_rows[0] if profile_rows else {}
    daily_hours = profile.get("daily_study_hours", 4)
    pomodoro_minutes = profile.get("pomodoro_work_minutes", 25)
    sessions_per_day = sessions_per_day_override or profile.get("sessions_per_day")
    session_duration_minutes = profile.get("session_duration_minutes")

    courses = supabase.table("courses").select("*").eq("user_id", user_id).execute().data or []
    course_map = {c["id"]: c for c in courses if c.get("exam_date")}

    priority_order = {"high": 0, "medium": 1, "low": 2}
    tasks_by_course: dict = defaultdict(list)
    for course in course_map.values():
        tasks = supabase.table("tasks").select("*").eq("course_id", course["id"]).execute().data or []
        for t in tasks:
            if t.get("status") not in ("done", "completed"):
                t["_exam_date"] = course["exam_date"]
                tasks_by_course[course["id"]].append(t)
        tasks_by_course[course["id"]].sort(
            key=lambda t: priority_order.get(t.get("priority", "medium"), 1)
        )

    base_ppd = _calc_pomodoros_per_day(daily_hours, pomodoro_minutes, sessions_per_day, session_duration_minutes)
    capacity = course_capacity_report(tasks_by_course, course_map, disruptions, today, base_ppd)

    return {
        "supabase": supabase,
        "today": today,
        "disruptions": disruptions,
        "daily_hours": daily_hours,
        "pomodoro_minutes": pomodoro_minutes,
        "sessions_per_day": sessions_per_day,
        "session_duration_minutes": session_duration_minutes,
        "course_map": course_map,
        "tasks_by_course": tasks_by_course,
        "base_ppd": base_ppd,
        "capacity": capacity,
    }


def _build_claude_prompt(ctx: dict, feedback: str, interleave_courses: bool = True) -> str:
    capacity_lines = []
    for r in ctx["capacity"]:
        status = "🚨 OVERFLOW" if r["is_overflowing"] else ("⚠️ TIGHT" if r["is_tight"] else "✅ ok")
        capacity_lines.append(
            f"  - {r['course_name']}: exam {r['exam_date']} ({r['days_remaining']} days away), "
            f"{r['task_count']} tasks, {r['available_study_days']} study days available, "
            f"need {r['tasks_per_day_needed']} tasks/day (current capacity: {ctx['base_ppd']}/day) {status}"
        )

    task_lines = []
    for cid, tasks in ctx["tasks_by_course"].items():
        cname = ctx["course_map"][cid].get("title", cid)
        for t in tasks[:30]:
            task_lines.append(
                f"  [{cname}][{t.get('priority','medium')}] {t['title']} ({t['estimated_minutes']}m)"
            )

    interleave_label = "mix all modules each day (interleaved)" if interleave_courses else "dedicate each day to a single module (one module per day)"
    return f"""You are an intelligent study schedule planner. Replan a student's remaining study tasks across multiple courses.

TODAY: {ctx['today'].isoformat()}
CURRENT SETTING: {ctx['base_ppd']} tasks/day (pomodoro: {ctx['pomodoro_minutes']}m each)
TASK DISTRIBUTION: {interleave_label}
DISRUPTIONS (blocked days): {', '.join(f"{d['start_date']}→{d['end_date']}" for d in ctx['disruptions']) or 'none'}

COURSE CAPACITY ANALYSIS:
{chr(10).join(capacity_lines)}

REMAINING TASKS (up to 30 per course):
{chr(10).join(task_lines)}

USER FEEDBACK: "{feedback or 'None — replan intelligently based on time pressure above.'}"

IMPORTANT CONSTRAINT: The student cannot study more than {ctx['base_ppd']} tasks/day — this is a hard limit based on their available hours. Do NOT suggest increasing tasks_per_day beyond this number. The student cannot manufacture extra time.

Your job:
1. Identify which courses are time-critical (tight or overflowing).
2. For tight/overflowing courses, reorder tasks so the highest-priority ones come first — the student should complete what matters most before the exam.
3. For courses that cannot fit all tasks within the hard limit before the exam, identify overflow tasks (low-priority ones that won't fit) and:
   a. Suggest merging similar/related tasks where it makes sense (e.g. two short "Read ChX" tasks → one combined task). Be specific — only suggest merges that genuinely save time.
   b. Flag which tasks should be deferred if the student chooses not to merge.
4. Do NOT increase tasks_per_day beyond {ctx['base_ppd']}.
5. Honour the user's feedback if given.

Return a JSON object with these fields:
- "start_date": ISO date string (today unless user said otherwise)
- "sessions_per_day": integer or null (only if user explicitly asked)
- "tasks_per_day_per_course": object mapping course name to integer tasks/day (must not exceed {ctx['base_ppd']})
- "defer_task_titles": array of task titles to push to the end (overflow low-priority tasks)
- "task_order_per_course": object mapping course name to ordered array of task titles (most important first)
- "merge_suggestions": array of merge objects — only include if there are genuinely useful merges:
    [{{"course_name": "...", "merged_title": "...", "source_titles": ["task A", "task B"], "estimated_minutes": 40, "priority": "high"}}]
- "overflow_courses": array of course names that have more tasks than can fit before their exam at {ctx['base_ppd']} tasks/day
- "summary": 2-3 sentence plain-English explanation shown to the user before they confirm

Return raw JSON only, no markdown fences."""


def _apply_directives(directives: dict, ctx: dict):
    """Mutates ctx in-place based on Claude's directives. Returns updated ctx."""
    if directives.get("start_date"):
        ctx["start_date"] = _parse_date(directives["start_date"])
    else:
        ctx["start_date"] = ctx["today"]

    if directives.get("sessions_per_day"):
        ctx["sessions_per_day"] = int(directives["sessions_per_day"])

    name_to_id = {v.get("title", k): k for k, v in ctx["course_map"].items()}
    tasks_per_day_override = {}

    tpd_map = directives.get("tasks_per_day_per_course", {})
    for cname, ppd in tpd_map.items():
        cid = name_to_id.get(cname)
        if cid:
            # Hard cap at the user's base tasks/day — cannot exceed their available hours
            tasks_per_day_override[cid] = min(max(1, int(ppd)), ctx["base_ppd"])

    order_map = directives.get("task_order_per_course", {})
    for cname, ordered_titles in order_map.items():
        cid = name_to_id.get(cname)
        if cid and cid in ctx["tasks_by_course"]:
            title_idx = {title: i for i, title in enumerate(ordered_titles)}
            ctx["tasks_by_course"][cid].sort(key=lambda t: title_idx.get(t["title"], 999))

    # Apply merge suggestions when user chose the "merge" strategy
    if ctx.get("overflow_strategy") == "merge":
        for merge in directives.get("merge_suggestions", []):
            cname = merge.get("course_name", "")
            cid = name_to_id.get(cname)
            if not cid or cid not in ctx["tasks_by_course"]:
                continue
            source_titles = set(merge.get("source_titles", []))
            course_tasks = ctx["tasks_by_course"][cid]
            sources = [t for t in course_tasks if t["title"] in source_titles]
            if len(sources) < 2:
                continue
            # Survivor = first source task with updated title/minutes; rest flagged for deletion
            survivor = dict(sources[0])
            survivor["title"] = merge["merged_title"]
            survivor["estimated_minutes"] = merge.get("estimated_minutes", survivor["estimated_minutes"])
            survivor["priority"] = merge.get("priority", survivor["priority"])
            survivor["_merged_from"] = [t["id"] for t in sources[1:]]
            # Replace all source tasks with the single merged task
            ctx["tasks_by_course"][cid] = [
                survivor if t["id"] == sources[0]["id"] else t
                for t in course_tasks
                if t["title"] not in source_titles or t["id"] == sources[0]["id"]
            ]

    # Defer overflow tasks to the back of the queue (when strategy is "defer" or default)
    if ctx.get("overflow_strategy") != "keep_all":
        defer_set = set(directives.get("defer_task_titles", []))
        if defer_set:
            for cid in ctx["tasks_by_course"]:
                normal = [t for t in ctx["tasks_by_course"][cid] if t["title"] not in defer_set]
                deferred = [t for t in ctx["tasks_by_course"][cid] if t["title"] in defer_set]
                ctx["tasks_by_course"][cid] = normal + deferred

    ctx["tasks_per_day_override"] = tasks_per_day_override
    return ctx


@router.post("/reschedule-preview")
def reschedule_preview(body: FullRescheduleRequest):
    """
    Ask Claude to analyse the schedule and return a plain-English summary
    of what it would change — without actually writing anything to the DB.
    The frontend shows this to the user before they confirm.
    """
    ctx = _load_reschedule_context(body.user_id, body.sessions_per_day_override)

    if not any(ctx["tasks_by_course"].values()):
        return {"summary": "No remaining tasks to reschedule.", "directives": {}}

    try:
        client = _anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
        prompt = _build_claude_prompt(ctx, body.feedback or "", body.interleave_courses)
        msg = client.messages.create(
            model="claude-opus-4-6",
            max_tokens=8000,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = msg.content[0].text.strip()
        directives = _extract_json(raw)
        if directives:
            summary = directives.get("summary", "Schedule will be updated based on your exam deadlines.")
            return {
                "summary": summary,
                "directives": directives,
                "overflow_courses": directives.get("overflow_courses", []),
                "merge_suggestions": directives.get("merge_suggestions", []),
            }
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Preview error: {e}")

    return {"summary": "Could not generate preview.", "directives": {}}


@router.post("/full-reschedule")
def full_reschedule(body: FullRescheduleRequest):
    """
    Deadline-aware replanning across all courses.
    Each course is scheduled against its own exam date.
    Accepts optional pre-computed directives from the preview step to avoid
    calling Claude twice.
    """
    supabase_ref = None  # set below
    today = date.today()

    ctx = _load_reschedule_context(body.user_id, body.sessions_per_day_override)
    supabase = ctx["supabase"]

    if not any(ctx["tasks_by_course"].values()):
        return {"updated": 0}

    # Use pre-computed directives from the preview step to avoid calling Claude twice
    directives = body.directives or {}
    if not directives:
        # No pre-computed directives — run Claude now
        try:
            client = _anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
            prompt = _build_claude_prompt(ctx, body.feedback or "", body.interleave_courses)
            msg = client.messages.create(
                model="claude-opus-4-6",
                max_tokens=8000,
                messages=[{"role": "user", "content": prompt}],
            )
            raw = msg.content[0].text.strip()
            directives = _extract_json(raw) or directives
        except Exception as e:
            traceback.print_exc()
            # Non-fatal — schedule with defaults

    ctx["overflow_strategy"] = body.overflow_strategy
    ctx = _apply_directives(directives, ctx)

    # ── Per-course deadline-aware scheduling ─────────────────
    scheduled = generate_schedule_multi_course(
        tasks_by_course=dict(ctx["tasks_by_course"]),
        course_map=ctx["course_map"],
        daily_study_hours=ctx["daily_hours"],
        pomodoro_minutes=ctx["pomodoro_minutes"],
        disruptions=ctx["disruptions"],
        start_date=ctx.get("start_date", ctx["today"]),
        sessions_per_day=ctx["sessions_per_day"],
        session_duration_minutes=ctx["session_duration_minutes"],
        tasks_per_day_override=ctx.get("tasks_per_day_override", {}),
        interleave_courses=body.interleave_courses,
    )

    for t in scheduled:
        update_payload = {
            "scheduled_date": t.get("scheduled_date"),
            "order_index": t.get("order_index", 0),
        }
        # If this task absorbed others (merge strategy), update its title/minutes too
        if t.get("_merged_from"):
            update_payload["title"] = t["title"]
            update_payload["estimated_minutes"] = t["estimated_minutes"]
            update_payload["priority"] = t.get("priority", "medium")
            # Delete the tasks that were merged away
            for dead_id in t["_merged_from"]:
                supabase.table("tasks").delete().eq("id", dead_id).execute()
        supabase.table("tasks").update(update_payload).eq("id", t["id"]).execute()

    return {"updated": len(scheduled)}
