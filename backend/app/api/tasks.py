from fastapi import APIRouter, HTTPException
from app.core.supabase import get_supabase_client
from pydantic import BaseModel
from typing import List, Optional
from datetime import date

router = APIRouter(prefix="/tasks")


class TaskCreate(BaseModel):
    course_id: str
    user_id: str
    title: str
    estimated_minutes: int = 25
    priority: str = "medium"
    task_type: str = "study"
    status: str = "todo"
    scheduled_date: Optional[str] = None
    order_index: int = 0


class TaskStatusUpdate(BaseModel):
    status: str  # todo | in_progress | done


class TaskTypeUpdate(BaseModel):
    task_type: str  # study | practice | review | assessment


class TaskReorder(BaseModel):
    task_id: str
    scheduled_date: str
    order_index: int


@router.post("/")
def create_tasks(tasks: List[TaskCreate]):
    supabase = get_supabase_client()
    result = supabase.table("tasks").insert([t.dict() for t in tasks]).execute()
    if not result.data:
        raise HTTPException(status_code=400, detail="Failed to create tasks")
    return result.data


@router.get("/course/{course_id}")
def get_tasks_by_course(course_id: str):
    supabase = get_supabase_client()
    result = (
        supabase.table("tasks")
        .select("*")
        .eq("course_id", course_id)
        .order("scheduled_date")
        .order("order_index")
        .execute()
    )
    return result.data


@router.get("/today/{user_id}")
def get_todays_tasks(user_id: str):
    """All tasks scheduled for today across all courses."""
    supabase = get_supabase_client()
    today = date.today().isoformat()
    result = (
        supabase.table("tasks")
        .select("*, courses(title, color, exam_date)")
        .eq("user_id", user_id)
        .eq("scheduled_date", today)
        .neq("status", "done")
        .order("order_index")
        .execute()
    )
    # Normalise: rename 'title' → 'name' inside nested courses object
    for t in (result.data or []):
        if t.get("courses"):
            t["courses"]["name"] = t["courses"].pop("title", "")
    return result.data


@router.patch("/{task_id}/status")
def update_task_status(task_id: str, body: TaskStatusUpdate):
    supabase = get_supabase_client()
    update = {"status": body.status}
    if body.status == "done":
        from datetime import datetime
        update["completed_at"] = datetime.utcnow().isoformat()
        update["scheduled_date"] = date.today().isoformat()
    result = supabase.table("tasks").update(update).eq("id", task_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Task not found")
    return result.data[0]


@router.patch("/{task_id}/type")
def update_task_type(task_id: str, body: TaskTypeUpdate):
    supabase = get_supabase_client()
    result = supabase.table("tasks").update({"task_type": body.task_type}).eq("id", task_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Task not found")
    return result.data[0]


@router.patch("/reorder")
def reorder_tasks(updates: List[TaskReorder]):
    """Batch update scheduled_date + order_index (drag & drop on calendar)."""
    supabase = get_supabase_client()
    for u in updates:
        supabase.table("tasks").update({
            "scheduled_date": u.scheduled_date,
            "order_index": u.order_index,
        }).eq("id", u.task_id).execute()
    return {"reordered": len(updates)}


@router.delete("/{task_id}")
def delete_task(task_id: str):
    supabase = get_supabase_client()
    supabase.table("tasks").delete().eq("id", task_id).execute()
    return {"deleted": task_id}
