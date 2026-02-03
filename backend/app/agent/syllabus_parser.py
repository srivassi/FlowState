import google.generativeai as genai
from typing import List, Dict
from .schemas import Task
import os

class SyllabusParser:
    def __init__(self, api_key: str):
        print(f"🔑 Configuring Gemini with API key: {api_key[:10]}...{api_key[-5:] if api_key else 'None'}")
        if not api_key:
            raise ValueError("Google API key is required but not provided")
        genai.configure(api_key=api_key)
        self.model = genai.GenerativeModel('models/gemini-2.5-flash')
    
    def parse_to_tasks(self, syllabus: str, preferences, assessment_info) -> List[Task]:
        # Calculate urgency based on exam date
        urgency_context = ""
        if assessment_info.exam_date:
            days_until_exam = (assessment_info.exam_date - datetime.now()).days
            urgency_context = f"Exam in {days_until_exam} days. "
        
        prompt = f"""
You are a study planning expert. Break down this syllabus into specific, actionable study tasks.

{urgency_context}Student preferences:
- Learning style: {preferences.learning_style}
- Daily study hours: {preferences.daily_study_hours}
- Session length: {preferences.preferred_session_length} minutes
- Difficulty preference: {preferences.difficulty_preference}

Assessment breakdown: {assessment_info.assessment_breakdown}
Past papers available: {assessment_info.past_papers_available}

For each task:
- Create clear, specific titles
- Estimate realistic study time (15-{preferences.preferred_session_length} min per task)
- Set priority (high/medium/low) based on assessment weights and exam proximity
- Set task_type (study/practice/review/assessment)
- Break large topics into smaller chunks matching session length

Syllabus:
{syllabus}

Return ONLY a valid JSON array:
[{{
    "title": "Read Chapter 1: Introduction",
    "estimated_minutes": 45,
    "priority": "high",
    "task_type": "study"
}}]
"""
        
        response = self.model.generate_content(prompt)
        
        # Parse JSON response and convert to Task objects
        import json
        import re
        from datetime import datetime
        
        try:
            # Clean response text - extract JSON if wrapped in markdown
            response_text = response.text.strip()
            if "```json" in response_text:
                response_text = re.search(r'```json\s*([\s\S]*?)\s*```', response_text).group(1)
            elif "```" in response_text:
                response_text = re.search(r'```\s*([\s\S]*?)\s*```', response_text).group(1)
            
            tasks_data = json.loads(response_text)
            return [Task(**task) for task in tasks_data]
        except Exception as e:
            print(f"Error parsing response: {e}")
            print(f"Raw response: {response.text}")
            # Fallback if parsing fails
            return [Task(title="Review syllabus content", estimated_minutes=60)]