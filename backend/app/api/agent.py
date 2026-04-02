from fastapi import APIRouter, HTTPException
from app.agent.syllabus_parser import SyllabusParser
from app.agent.scheduler import generate_schedule
from app.agent.schemas import AgentInput
from app.core.supabase import get_supabase_client
import os
from datetime import date

router = APIRouter(prefix="/agent")


@router.post("/parse-syllabus")
def parse_syllabus(input: AgentInput):
    try:
        api_key = os.getenv("ANTHROPIC_API_KEY")
        if not api_key:
            raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not set")

        parser = SyllabusParser(api_key)
        tasks = parser.parse_to_tasks(input.syllabus, input.preferences, input.assessment_info)

        return {
            "tasks": [task.dict() for task in tasks],
            "total_study_time": sum(t.estimated_minutes for t in tasks),
            "status": "success"
        }
    except HTTPException:
        raise
    except Exception as e:
        import traceback; traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/generate-plan")
def generate_plan(input: AgentInput):
    """Parse syllabus, save tasks to DB, and generate a scheduled plan."""
    try:
        supabase = get_supabase_client()
        api_key = os.getenv("ANTHROPIC_API_KEY")
        if not api_key:
            raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not set")

        # 1. Parse into tasks
        parser = SyllabusParser(api_key)
        tasks = parser.parse_to_tasks(input.syllabus, input.preferences, input.assessment_info)

        # 2. Fetch disruptions for this user
        disruptions = []
        if input.user_id:
            result = supabase.table("disruptions").select("*").eq("user_id", input.user_id).execute()
            disruptions = result.data or []

        # 3. Schedule tasks
        exam_date = input.assessment_info.exam_date.date() if input.assessment_info.exam_date else None
        if not exam_date:
            raise HTTPException(status_code=400, detail="exam_date is required")

        task_dicts = [t.dict() for t in tasks]
        scheduled = generate_schedule(
            tasks=task_dicts,
            exam_date=exam_date,
            daily_study_hours=input.preferences.daily_study_hours,
            pomodoro_minutes=input.preferences.pomodoro_work_minutes,
            disruptions=disruptions,
        )

        # 4. Save to Supabase
        if input.course_id:
            rows = [
                {
                    "course_id": input.course_id,
                    "user_id": input.user_id,
                    "title": t["title"],
                    "estimated_minutes": t["estimated_minutes"],
                    "priority": t.get("priority", "medium"),
                    "task_type": t.get("task_type", "study"),
                    "status": "todo",
                    "scheduled_date": t.get("scheduled_date"),
                    "order_index": t.get("order_index", 0),
                }
                for t in scheduled
            ]
            supabase.table("tasks").insert(rows).execute()

        return {
            "tasks": scheduled,
            "total_study_time": sum(t["estimated_minutes"] for t in scheduled),
            "status": "success"
        }
    except HTTPException:
        raise
    except Exception as e:
        import traceback; traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
