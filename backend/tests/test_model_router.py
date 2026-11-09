import logging
import os
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.core.model_router import (
    FAST_MODEL_DEFAULT,
    REASONING_MODEL_DEFAULT,
    create_message,
    select_model,
)


class ModelRouterTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {}, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_economy_routes_every_task_deterministically(self):
        expected = {
            "tutor_chat": FAST_MODEL_DEFAULT,
            "tutor_topics": FAST_MODEL_DEFAULT,
            "ocr": FAST_MODEL_DEFAULT,
            "flashcards": FAST_MODEL_DEFAULT,
            "syllabus": FAST_MODEL_DEFAULT,
            "schedule": FAST_MODEL_DEFAULT,
            "whiteboard": REASONING_MODEL_DEFAULT,
            "question_generate": REASONING_MODEL_DEFAULT,
            "question_extract": REASONING_MODEL_DEFAULT,
            "question_grade": REASONING_MODEL_DEFAULT,
        }
        for task, model in expected.items():
            with self.subTest(task=task):
                self.assertEqual(select_model(task), model)
        self.assertEqual(select_model("tutor_chat", complex=True), REASONING_MODEL_DEFAULT)

    def test_balanced_routes_topics_syllabus_and_schedule_to_reasoning(self):
        os.environ["AI_ROUTING_MODE"] = "balanced"
        for task in ("tutor_topics", "syllabus", "schedule"):
            self.assertEqual(select_model(task), REASONING_MODEL_DEFAULT)
        self.assertEqual(select_model("ocr"), FAST_MODEL_DEFAULT)
        self.assertEqual(select_model("tutor_chat", complex=True), REASONING_MODEL_DEFAULT)

    def test_quality_routes_all_tasks_to_reasoning_model(self):
        os.environ["AI_ROUTING_MODE"] = "quality"
        for task in (
            "tutor_chat", "tutor_topics", "ocr", "flashcards", "syllabus", "schedule",
            "whiteboard", "question_generate", "question_extract", "question_grade",
        ):
            with self.subTest(task=task):
                self.assertEqual(select_model(task), REASONING_MODEL_DEFAULT)

    def test_runtime_model_overrides_are_used(self):
        os.environ["AI_FAST_MODEL"] = "custom-fast"
        os.environ["AI_REASONING_MODEL"] = "custom-reasoning"
        self.assertEqual(select_model("ocr"), "custom-fast")
        self.assertEqual(select_model("whiteboard"), "custom-reasoning")
        os.environ["AI_FAST_MODEL"] = "changed-after-import"
        self.assertEqual(select_model("ocr"), "changed-after-import")

    def test_invalid_configuration_and_unknown_task_fail_before_call(self):
        client = MagicMock()
        for task, env_name, env_value in (
            ("not-a-task", None, None),
            ("ocr", "AI_ROUTING_MODE", "invalid"),
            ("ocr", "AI_FAST_MODEL", ""),
            ("ocr", "AI_REASONING_MODEL", "  "),
        ):
            with self.subTest(task=task, env=env_name):
                with patch.dict(os.environ, {}, clear=True):
                    if env_name:
                        os.environ[env_name] = env_value
                    with self.assertRaises(ValueError):
                        create_message(client, task, messages=[])
                client.messages.create.assert_not_called()

    def test_kwargs_are_preserved_model_is_policy_selected_and_return_is_unchanged(self):
        client = MagicMock()
        response = object()
        client.messages.create.return_value = response
        kwargs = {
            "max_tokens": 123,
            "system": "stable instructions",
            "messages": [{"role": "user", "content": "question"}],
            "temperature": 0,
            "model": "caller-model",
        }
        result = create_message(client, "tutor_chat", **kwargs)
        self.assertIs(result, response)
        client.messages.create.assert_called_once_with(
            max_tokens=123,
            system="stable instructions",
            messages=[{"role": "user", "content": "question"}],
            temperature=0,
            model=FAST_MODEL_DEFAULT,
        )

    def test_create_failure_is_not_retried(self):
        client = MagicMock()
        client.messages.create.side_effect = RuntimeError("request failed")
        with self.assertRaisesRegex(RuntimeError, "request failed"):
            create_message(client, "ocr", messages=[])
        client.messages.create.assert_called_once()

    def test_numeric_usage_is_logged_without_request_content(self):
        secret = "private prompt and document text"
        response = SimpleNamespace(
            usage=SimpleNamespace(
                input_tokens=10,
                output_tokens=4,
                cache_creation_input_tokens=2,
                cache_read_input_tokens=3,
                ignored="do not log",
            )
        )
        client = MagicMock()
        client.messages.create.return_value = response
        with self.assertLogs("app.core.model_router", level=logging.INFO) as captured:
            create_message(client, "tutor_chat", messages=[{"content": secret}], system=secret)
        record = captured.records[0]
        self.assertEqual(record.task, "tutor_chat")
        self.assertEqual(record.model, FAST_MODEL_DEFAULT)
        self.assertEqual(record.input_tokens, 10)
        self.assertEqual(record.output_tokens, 4)
        self.assertEqual(record.cache_creation_input_tokens, 2)
        self.assertEqual(record.cache_read_input_tokens, 3)
        self.assertNotIn(secret, captured.output[0])

    def test_non_numeric_usage_is_not_logged(self):
        client = MagicMock()
        client.messages.create.return_value = SimpleNamespace(
            usage=SimpleNamespace(input_tokens="unknown", output_tokens=None)
        )
        with self.assertNoLogs("app.core.model_router", level=logging.INFO):
            create_message(client, "ocr", messages=[])


if __name__ == "__main__":
    unittest.main()
