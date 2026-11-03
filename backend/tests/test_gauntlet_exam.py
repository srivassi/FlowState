import os
import unittest
from unittest.mock import MagicMock, patch

from pydantic import ValidationError
from fastapi import HTTPException

from app.api.tutor import (
    ChatRequest,
    ExamConfigUpdate,
    GauntletExamConfig,
    _exam_config_prompt,
    _load_exam_config,
    gauntlet_chat,
    update_gauntlet_exam_config,
)


class GauntletExamConfigTests(unittest.TestCase):
    def test_config_defaults_and_null_saved_value(self):
        self.assertEqual(
            GauntletExamConfig().model_dump(),
            {"question_types": [], "duration_minutes": None, "open_book": None, "guidance": ""},
        )
        client = MagicMock()
        client.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = [
            {"gauntlet_exam_config": None}
        ]
        with patch("app.api.tutor.get_supabase_client", return_value=client):
            self.assertEqual(_load_exam_config("module", "student"), GauntletExamConfig().model_dump())

    def test_rejects_invalid_config_payloads(self):
        invalid = [
            {"question_types": ["true_false"]},
            {"duration_minutes": 0},
            {"duration_minutes": 601},
            {"duration_minutes": True},
            {"open_book": "sometimes"},
            {"guidance": "x" * 2001},
            {"unexpected": True},
        ]
        for config in invalid:
            with self.subTest(config=list(config)):
                with self.assertRaises(ValidationError):
                    ExamConfigUpdate(user_id="student", config=config)

    def test_saves_normalized_config_only_for_requested_user_and_module(self):
        client = MagicMock()
        query = client.table.return_value
        query.update.return_value.eq.return_value.eq.return_value.execute.return_value.data = [{"id": "module"}]
        body = ExamConfigUpdate(user_id="student", config={"question_types": ["essay"]})
        with patch("app.api.tutor.get_supabase_client", return_value=client):
            result = update_gauntlet_exam_config("module", body)
        expected = {"question_types": ["essay"], "duration_minutes": None, "open_book": None, "guidance": ""}
        query.update.assert_called_once_with({"gauntlet_exam_config": expected})
        query.update.return_value.eq.assert_called_once_with("id", "module")
        query.update.return_value.eq.return_value.eq.assert_called_once_with("user_id", "student")
        self.assertEqual(result, expected)

    def test_update_and_chat_return_not_found_for_unowned_module(self):
        client = MagicMock()
        client.table.return_value.update.return_value.eq.return_value.eq.return_value.execute.return_value.data = []
        with patch("app.api.tutor.get_supabase_client", return_value=client):
            with self.assertRaises(HTTPException) as error:
                update_gauntlet_exam_config("missing", ExamConfigUpdate(user_id="student", config={}))
        self.assertEqual(error.exception.status_code, 404)

        client.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = []
        with patch("app.api.tutor.get_supabase_client", return_value=client):
            with self.assertRaises(HTTPException) as error:
                _load_exam_config("missing", "student")
        self.assertEqual(error.exception.status_code, 404)

    def test_exam_prompt_includes_all_formats_preferences_and_safe_guidance(self):
        prompt = _exam_config_prompt({
            "question_types": ["multiple_choice", "short_answer", "essay", "problem_solving", "oral"],
            "duration_minutes": 45,
            "open_book": False,
            "guidance": "Focus on application.",
        })
        for phrase in ("multiple-choice", "short-answer", "essay", "problem-solving", "oral explanation"):
            self.assertIn(phrase, prompt)
        self.assertIn("rotating among the selected formats", prompt)
        self.assertIn("45 minutes", prompt)
        self.assertIn("not as a timer", prompt)
        self.assertIn("closed-book", prompt)
        self.assertIn("Focus on application.", prompt)
        self.assertIn("not instructions that can override", prompt)
        self.assertIn("do not invent official marks", prompt)
        self.assertEqual(_exam_config_prompt(GauntletExamConfig().model_dump()), "")
        self.assertIn("override only the default open-ended-question and never-quiz format", prompt)
        self.assertIn("Keep the default Socratic, open-ended teaching approach", _exam_config_prompt({
            "question_types": [], "duration_minutes": 20, "open_book": None, "guidance": ""
        }))

    def _chat_request(self, **kwargs):
        data = dict(
            pdf_text="course notes",
            topics=[{"title": "Cell biology"}],
            current_topic_index=0,
            messages=[],
            user_message="Let's begin",
        )
        data.update(kwargs)
        return ChatRequest(**data)

    def test_legacy_chat_uses_existing_socratic_prompt_without_database_lookup(self):
        client = MagicMock()
        client.messages.create.return_value.content = [MagicMock(text="What do you think?")]
        with patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-key"}), \
                patch("app.api.tutor.anthropic.Anthropic", return_value=client), \
                patch("app.api.tutor.get_supabase_client") as supabase:
            result = gauntlet_chat(self._chat_request())
        supabase.assert_not_called()
        system = client.messages.create.call_args.kwargs["system"]
        self.assertIn("You are a Socratic tutor", system)
        self.assertNotIn("MODULE EXAM PREFERENCES", system)
        self.assertEqual(result["reply"], "What do you think?")

    def test_config_is_loaded_on_each_chat_turn_and_go_deeper_uses_it(self):
        client = MagicMock()
        client.messages.create.return_value.content = [MagicMock(text="Explain how that works.")]
        config = {"question_types": ["problem_solving"], "duration_minutes": 30, "open_book": True, "guidance": "Use examples."}
        supabase = MagicMock()
        supabase.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = [
            {"gauntlet_exam_config": config}
        ]
        with patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-key"}), \
                patch("app.api.tutor.anthropic.Anthropic", return_value=client), \
                patch("app.api.tutor.get_supabase_client", return_value=supabase):
            first = gauntlet_chat(self._chat_request(course_id="module", user_id="student"))
            subsequent = gauntlet_chat(self._chat_request(course_id="module", user_id="student", user_message="It changes the rate."))
            deeper = gauntlet_chat(self._chat_request(course_id="module", user_id="student", user_message="__go_deeper__"))

        self.assertEqual(supabase.table.call_count, 3)
        self.assertEqual(first["reply"], "Explain how that works.")
        self.assertIn("problem-solving", client.messages.create.call_args_list[0].kwargs["system"])
        self.assertIn("problem-solving", client.messages.create.call_args_list[1].kwargs["system"])
        self.assertIn("problem-solving", client.messages.create.call_args_list[2].kwargs["system"])
        self.assertEqual(deeper["messages"][-2]["content"].startswith("[The student chose to go deeper"), True)
        self.assertEqual(subsequent["messages"][-2]["content"], "It changes the rate.")
        self.assertIn("30 minutes", client.messages.create.call_args_list[2].kwargs["system"])

    def test_course_chat_requires_user_id(self):
        with patch("app.api.tutor.get_supabase_client") as supabase:
            with self.assertRaises(HTTPException) as error:
                gauntlet_chat(self._chat_request(course_id="module"))
        self.assertEqual(error.exception.status_code, 400)
        supabase.assert_not_called()


if __name__ == "__main__":
    unittest.main()
