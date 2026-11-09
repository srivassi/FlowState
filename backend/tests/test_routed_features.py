import io
import os
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.agent.schemas import AssessmentInfo, StudyPreferences
from app.agent.syllabus_parser import SyllabusParser
from app.api import flashcards, questions, study, whiteboard
from app.api.questions import GradeRequest
from app.api.study import FullRescheduleRequest
from app.api.whiteboard import ChatMessage


def response_text(text):
    return SimpleNamespace(content=[SimpleNamespace(text=text)])


class RoutedFeatureTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-key"})
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_syllabus_uses_router_and_preserves_request_arguments(self):
        client = MagicMock()
        parser = SyllabusParser.__new__(SyllabusParser)
        parser.client = client
        result = response_text('[{"title":"Review cells","estimated_minutes":25}]')
        preferences = StudyPreferences(
            learning_style="reading", daily_study_hours=2,
            preferred_session_length=25, break_frequency=50,
            difficulty_preference="mixed",
        )
        assessment = AssessmentInfo(assessment_breakdown={"final": 100})

        with patch("app.agent.syllabus_parser.create_message", return_value=result) as routed:
            tasks = parser.parse_to_tasks("Cell structure", preferences, assessment)

        routed.assert_called_once()
        args, kwargs = routed.call_args
        self.assertEqual(args, (client, "syllabus"))
        self.assertEqual(kwargs["max_tokens"], 16000)
        self.assertIn("Cell structure", kwargs["messages"][0]["content"])
        self.assertEqual(tasks[0].title, "Review cells")

        with patch("app.agent.syllabus_parser.anthropic.Anthropic", return_value=client) as constructor:
            SyllabusParser("test-key")
        constructor.assert_called_once_with(api_key="test-key", max_retries=0)

    def test_study_schedule_uses_schedule_task_and_keeps_output_limit(self):
        context = {"tasks_by_course": {"biology": [{"id": "task"}]}}
        client = MagicMock()
        result = response_text('{"summary":"Move review earlier"}')
        with patch("app.api.study._load_reschedule_context", return_value=context), \
             patch("app.api.study._build_claude_prompt", return_value="schedule prompt"), \
             patch("app.api.study._anthropic.Anthropic", return_value=client) as constructor, \
             patch("app.api.study.create_message", return_value=result) as routed:
            output = study.reschedule_preview(FullRescheduleRequest(user_id="student"))

        self.assertEqual(output["summary"], "Move review earlier")
        args, kwargs = routed.call_args
        self.assertEqual(args, (client, "schedule"))
        self.assertEqual(kwargs, {
            "max_tokens": 8000,
            "messages": [{"role": "user", "content": "schedule prompt"}],
        })
        constructor.assert_called_once_with(api_key="test-key", max_retries=0)

    def test_whiteboard_routes_prompt_and_prior_messages(self):
        supabase = MagicMock()
        body = ChatMessage(
            course_id="course", user_id="student", note_id="note", message="Explain this",
            prior_messages=[{"role": "user", "content": "Earlier question"}],
        )

        with patch("app.api.whiteboard.anthropic.Anthropic", return_value=MagicMock()) as constructor, \
             patch("app.api.whiteboard.create_message", return_value=response_text("A short explanation")) as routed, \
             patch("app.api.whiteboard.get_supabase_client", return_value=supabase):
            result = whiteboard.chat_on_note(body)

        self.assertEqual(result["reply"], "A short explanation")
        args, kwargs = routed.call_args
        self.assertEqual(args[1], "whiteboard")
        self.assertEqual(kwargs["max_tokens"], 1024)
        self.assertIn("system", kwargs)
        self.assertEqual(kwargs["messages"], [
            {"role": "user", "content": "Earlier question"},
            {"role": "user", "content": "Explain this"},
        ])
        constructor.assert_called_once_with(api_key="test-key", max_retries=0)

    def test_flashcards_routes_card_generation_request(self):
        client = MagicMock()
        supabase = MagicMock()
        supabase.table.return_value.insert.return_value.execute.return_value.data = [{"id": "set"}]
        pdf_reader = SimpleNamespace(pages=[SimpleNamespace(extract_text=lambda: "Cell structure notes")])
        file = SimpleNamespace(file=io.BytesIO(b"pdf"))

        with patch("app.api.flashcards.HAS_PYPDF", True), \
             patch.object(flashcards, "pypdf", SimpleNamespace(PdfReader=MagicMock(return_value=pdf_reader)), create=True), \
             patch("app.api.flashcards.anthropic.Anthropic", return_value=client) as constructor, \
             patch("app.api.flashcards.create_message", return_value=response_text('[{"question":"What is a cell?","answer":"A unit of life."}]')) as routed, \
             patch("app.api.flashcards.get_supabase_client", return_value=supabase):
            flashcards.generate_flashcards(file, "student", "course", "Biology", "")

        args, kwargs = routed.call_args
        self.assertEqual(args, (client, "flashcards"))
        self.assertEqual(kwargs["max_tokens"], 8096)
        self.assertIn("Cell structure notes", kwargs["messages"][0]["content"])
        constructor.assert_called_once_with(api_key="test-key", max_retries=0)

    def test_question_text_vision_extraction_and_grading_use_distinct_tasks(self):
        client = MagicMock()
        response = response_text("[]")
        with patch("app.api.questions.anthropic.Anthropic", return_value=client) as constructor, \
             patch("app.api.questions.create_message", return_value=response) as routed:
            self.assertEqual(questions._call_claude("generate prompt", max_tokens=123), "[]")
            args, kwargs = routed.call_args
            self.assertEqual(args, (client, "question_generate"))
            self.assertEqual(kwargs, {
                "max_tokens": 123,
                "messages": [{"role": "user", "content": "generate prompt"}],
            })
            constructor.assert_called_with(api_key="test-key", max_retries=0)

            self.assertEqual(questions._call_claude_vision(["encoded"], "vision prompt", 321), "[]")
            args, kwargs = routed.call_args
            self.assertEqual(args, (client, "question_extract"))
            self.assertEqual(kwargs["max_tokens"], 321)
            self.assertEqual(kwargs["messages"][0]["content"][-1], {"type": "text", "text": "vision prompt"})

        with patch("app.api.questions.HAS_FITZ", False), \
             patch("app.api.questions._extract_pdf_text", return_value="past-paper text"), \
             patch("app.api.questions._call_claude", return_value="[]") as call_text:
            self.assertEqual(questions._run_extraction(b"pdf", "paper"), ([], "[]"))
        self.assertEqual(call_text.call_args.kwargs, {"max_tokens": 8192, "task": "question_extract"})

        with patch("app.api.questions._call_claude", return_value='{"grade":"Good","score":3,"feedback":"Good work."}') as call_grade:
            questions.grade_answer(GradeRequest(question_text="Q", user_answer="A", topic="Biology"))
        self.assertEqual(call_grade.call_args.kwargs, {"max_tokens": 1024, "task": "question_grade"})


if __name__ == "__main__":
    unittest.main()
