import anthropic
import json
import re
from datetime import datetime
from typing import List
from .schemas import Task


class SyllabusParser:
    def __init__(self, api_key: str):
        self.client = anthropic.Anthropic(api_key=api_key)

    def parse_to_tasks(self, syllabus: str, preferences, assessment_info) -> List[Task]:
        urgency_context = ""
        if assessment_info.exam_date:
            days = (assessment_info.exam_date.replace(tzinfo=None) - datetime.now()).days
            urgency_context = f"Exam is in {days} days. "

        prompt = f"""You are a study planning expert. The student has already broken their syllabus into topics — the input below is a structured breakdown, not a raw syllabus document.

{urgency_context}Student preferences:
- Daily study hours: {preferences.daily_study_hours}
- Preferred session length: {preferences.preferred_session_length} minutes
- Difficulty preference: {preferences.difficulty_preference}

Assessment weights: {assessment_info.assessment_breakdown}
Past papers available: {assessment_info.past_papers_available}

Convert this breakdown into specific, actionable study tasks. Each task should fit within one Pomodoro session ({preferences.pomodoro_work_minutes} min). For larger topics, split into multiple tasks (e.g. "Read + notes", "Practice problems", "Review").

Prioritise tasks based on assessment weights and exam proximity. High priority = heavily weighted or foundational topics.

Breakdown to parse:
{syllabus}

Return ONLY a valid JSON array with no markdown, no explanation, nothing else:
[
  {{
    "title": "Clear specific task name",
    "estimated_minutes": 25,
    "priority": "high",
    "task_type": "study"
  }}
]

task_type options: study, practice, review, assessment
priority options: high, medium, low"""

        message = self.client.messages.create(
            model="claude-opus-4-6",
            max_tokens=16000,
            messages=[{"role": "user", "content": prompt}]
        )

        response_text = message.content[0].text.strip()

        # Strip markdown fences if Claude wraps them anyway
        match = re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', response_text)
        if match:
            response_text = match.group(1).strip()

        # Find the JSON array even if there's surrounding text
        array_match = re.search(r'\[[\s\S]*\]', response_text)
        if array_match:
            response_text = array_match.group(0)

        try:
            tasks_data = json.loads(response_text)
            return [Task(**task) for task in tasks_data]
        except Exception as e:
            print(f"Parse error: {e}\nRaw response: {response_text[:500]}")
            return [Task(title="Review syllabus content", estimated_minutes=60)]
