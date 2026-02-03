import google.generativeai as genai
from typing import List
from .schemas import StudyResource, StudyPreferences

class ResourceFinder:
    def __init__(self, api_key: str):
        genai.configure(api_key=api_key)
        self.model = genai.GenerativeModel('models/gemini-2.5-flash')
    
    def find_resources(self, topic: str, preferences: StudyPreferences) -> List[StudyResource]:
        prompt = f"""
Find study resources for this topic: {topic}

Student preferences:
- Learning style: {preferences.learning_style}
- Preferred session length: {preferences.preferred_session_length} minutes
- Difficulty preference: {preferences.difficulty_preference}

Suggest 3-5 resources including:
- Videos (YouTube, Khan Academy, etc.)
- Articles/tutorials
- Practice exercises
- Interactive tools

Return ONLY a valid JSON array:
[{{
    "title": "Khan Academy: Introduction to Variables",
    "type": "video",
    "url": "https://example.com",
    "description": "Clear explanation with visual examples",
    "estimated_time": 15
}}]
"""
        
        response = self.model.generate_content(prompt)
        
        import json
        import re
        
        try:
            response_text = response.text.strip()
            if "```json" in response_text:
                response_text = re.search(r'```json\s*([\s\S]*?)\s*```', response_text).group(1)
            elif "```" in response_text:
                response_text = re.search(r'```\s*([\s\S]*?)\s*```', response_text).group(1)
            
            resources_data = json.loads(response_text)
            return [StudyResource(**resource) for resource in resources_data]
        except Exception as e:
            print(f"Error finding resources: {e}")
            return [StudyResource(
                title=f"Study {topic}",
                type="general",
                description="General study material",
                estimated_time=30
            )]