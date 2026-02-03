from fastapi import APIRouter, HTTPException
from app.core.supabase import get_supabase_client
from pydantic import BaseModel
from typing import List

router = APIRouter(prefix="/tasks")

class TaskCreate(BaseModel):
    course_id: str
    title: str
    estimated_minutes: int

class TaskResponse(BaseModel):
    id: str
    title: str
    estimated_minutes: int
    status: str

@router.post("/", response_model=List[TaskResponse])
def create_tasks(tasks: List[TaskCreate]):
    supabase = get_supabase_client()
    
    # Insert tasks into Supabase
    result = supabase.table("tasks").insert([task.dict() for task in tasks]).execute()
    
    if result.data:
        return result.data
    else:
        raise HTTPException(status_code=400, detail="Failed to create tasks")

@router.get("/course/{course_id}", response_model=List[TaskResponse])
def get_tasks_by_course(course_id: str):
    supabase = get_supabase_client()
    
    result = supabase.table("tasks").select("*").eq("course_id", course_id).execute()
    
    return result.data