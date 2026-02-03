from fastapi import APIRouter, HTTPException
from app.agent.syllabus_parser import SyllabusParser
from app.agent.schemas import AgentInput
from app.core.supabase import get_supabase_client
import os

router = APIRouter(prefix="/agent")

@router.post("/parse-syllabus")
def parse_syllabus(input: AgentInput):
    try:
        print(f"🔍 Received request: {input.syllabus[:50]}...")
        print(f"📊 Preferences: {input.preferences}")
        
        # Just do syllabus parsing, skip complex scheduling
        api_key = os.getenv("GOOGLE_API_KEY")
        parser = SyllabusParser(api_key)
        
        print("🤖 Starting syllabus parsing...")
        tasks = parser.parse_to_tasks(input.syllabus, input.preferences, input.assessment_info)
        print(f"✅ Parsed {len(tasks)} tasks")
        
        # Return simple response without complex scheduling
        return {
            "tasks": [task.dict() for task in tasks],
            "total_study_time": sum(task.estimated_minutes for task in tasks),
            "status": "success"
        }
        
    except Exception as e:
        print(f"❌ Error in parse_syllabus: {str(e)}")
        print(f"📍 Error type: {type(e).__name__}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Agent error: {str(e)}")
