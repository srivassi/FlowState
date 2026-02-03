from fastapi import APIRouter, HTTPException
from app.agent.orchestrator import StudyPlannerAgent
from app.agent.progress_tracker import ProgressTracker
from pydantic import BaseModel
from typing import List
from datetime import date

router = APIRouter(prefix="/study")

agent = StudyPlannerAgent()
progress_tracker = ProgressTracker()

class ProgressUpdate(BaseModel):
    completed_tasks: List[str]
    missed_tasks: List[str]
    date: str

@router.get("/today/{course_id}")
def get_today_plan(course_id: str):
    """Get today's study plan with Pomodoro sessions"""
    # This would fetch the stored study plan for the course
    # For now, return a placeholder
    today = date.today().strftime("%Y-%m-%d")
    return {
        "date": today,
        "message": "Fetch today's plan from database using course_id"
    }

@router.post("/progress")
def update_progress(progress: ProgressUpdate):
    """Update daily progress and get metrics"""
    # This would update progress in database
    return {
        "progress_updated": True,
        "completion_rate": len(progress.completed_tasks) / (len(progress.completed_tasks) + len(progress.missed_tasks)) if (len(progress.completed_tasks) + len(progress.missed_tasks)) > 0 else 0,
        "message": "Progress tracked successfully"
    }

@router.get("/calendar/{course_id}")
def get_study_calendar(course_id: str):
    """Get full study calendar for a course"""
    # This would fetch the full calendar from database
    return {
        "course_id": course_id,
        "message": "Fetch full calendar from database"
    }

@router.post("/reschedule/{course_id}")
def reschedule_tasks(course_id: str, missed_tasks: List[str]):
    """Reschedule missed tasks"""
    # This would trigger the rescheduling algorithm
    return {
        "rescheduled": True,
        "missed_tasks_count": len(missed_tasks),
        "message": "Tasks rescheduled successfully"
    }