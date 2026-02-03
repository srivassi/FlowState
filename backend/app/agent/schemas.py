from pydantic import BaseModel
from typing import List, Optional, Dict
from datetime import datetime

class StudyPreferences(BaseModel):
    learning_style: str  # visual, auditory, kinesthetic, reading
    daily_study_hours: int
    preferred_session_length: int  # minutes
    break_frequency: int  # minutes between breaks
    difficulty_preference: str  # gradual, mixed, challenging

class AssessmentInfo(BaseModel):
    exam_date: Optional[datetime] = None
    assessment_breakdown: Dict[str, int]  # {"midterm": 30, "final": 50, "assignments": 20}
    past_papers_available: bool = False
    past_papers_urls: List[str] = []

class AgentInput(BaseModel):
    syllabus: str
    preferences: StudyPreferences
    assessment_info: AssessmentInfo
    course_id: Optional[str] = None

class StudyResource(BaseModel):
    title: str
    type: str  # video, article, practice, past_paper
    url: Optional[str] = None
    description: str
    estimated_time: int

class Task(BaseModel):
    title: str
    estimated_minutes: int
    priority: str = "medium"  # high, medium, low
    task_type: str = "study"  # study, practice, review, assessment
    resources: List[StudyResource] = []

class PomodoroSession(BaseModel):
    session_id: str
    task_title: str
    duration_minutes: int
    break_after: int
    session_type: str = "focus"

class DailySchedule(BaseModel):
    date: str
    tasks: List[Dict]
    total_minutes: int
    pomodoro_sessions: List[Dict]

class StudyPlan(BaseModel):
    schedule: Dict[str, DailySchedule]
    total_days: int
    exam_date: str
    buffer_days: int

class AgentOutput(BaseModel):
    tasks: List[Task]
    study_plan: StudyPlan
    total_study_time: int
    pomodoro_count: int
