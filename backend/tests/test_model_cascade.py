import logging
import os
import unittest
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.core.model_router import (
    FAST_MODEL_DEFAULT,
    PREMIUM_MODEL_DEFAULT,
    REASONING_MODEL_DEFAULT,
    QualityGateError,
    create_validated_message,
)


class ModelCascadeTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {}, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)
        self.client = MagicMock()

    def test_passing_primary_makes_one_call(self):
        response = object()
        self.client.messages.create.return_value = response

        result = create_validated_message(self.client, "tutor_chat", validator=lambda _: True)

        self.assertIs(result, response)
        self.client.messages.create.assert_called_once_with(model=FAST_MODEL_DEFAULT)

    def test_fast_rejection_escalates_to_reasoning_and_preserves_request(self):
        bad, good = object(), object()
        self.client.messages.create.side_effect = [bad, good]
        messages = [{"role": "user", "content": "original request"}]
        kwargs = {"messages": messages, "system": "fixed instructions", "max_tokens": 321}
        original = deepcopy(kwargs)
        validator = MagicMock(side_effect=lambda response: response is good)

        result = create_validated_message(self.client, "tutor_chat", validator=validator, **kwargs)

        self.assertIs(result, good)
        self.assertEqual(
            [call.kwargs for call in self.client.messages.create.call_args_list],
            [
                {**original, "model": FAST_MODEL_DEFAULT},
                {**original, "model": REASONING_MODEL_DEFAULT},
            ],
        )
        self.assertEqual(kwargs, original)
        self.assertIs(self.client.messages.create.call_args_list[0].kwargs["messages"], messages)
        self.assertEqual(
            validator.call_args_list,
            [unittest.mock.call(bad), unittest.mock.call(good)],
        )

    def test_two_invalid_responses_raise_generic_quality_gate_error(self):
        self.client.messages.create.side_effect = [object(), object()]

        with self.assertRaisesRegex(
            QualityGateError, "No model response passed the quality gate"
        ) as raised:
            create_validated_message(self.client, "tutor_chat", validator=lambda _: False)

        self.assertNotIn("object at", str(raised.exception))
        self.assertEqual(self.client.messages.create.call_count, 2)

    def test_reasoning_primary_does_not_escalate_without_opus_permission(self):
        os.environ["AI_ROUTING_MODE"] = "quality"
        self.client.messages.create.return_value = object()

        with self.assertRaises(QualityGateError):
            create_validated_message(self.client, "tutor_chat", validator=lambda _: False)

        self.client.messages.create.assert_called_once_with(model=REASONING_MODEL_DEFAULT)

    def test_explicit_opus_permission_adds_premium_candidate(self):
        os.environ["AI_ROUTING_MODE"] = "quality"
        os.environ["AI_ALLOW_OPUS_ESCALATION"] = "true"
        first, second = object(), object()
        self.client.messages.create.side_effect = [first, second]

        result = create_validated_message(
            self.client, "tutor_chat", validator=lambda response: response is second
        )

        self.assertIs(result, second)
        self.assertEqual(
            [call.kwargs["model"] for call in self.client.messages.create.call_args_list],
            [REASONING_MODEL_DEFAULT, PREMIUM_MODEL_DEFAULT],
        )

    def test_fast_to_reasoning_never_adds_third_premium_stage(self):
        os.environ["AI_ALLOW_OPUS_ESCALATION"] = "true"
        self.client.messages.create.return_value = object()

        with self.assertRaises(QualityGateError):
            create_validated_message(self.client, "tutor_chat", validator=lambda _: False)

        self.assertEqual(self.client.messages.create.call_count, 2)
        self.assertEqual(
            [call.kwargs["model"] for call in self.client.messages.create.call_args_list],
            [FAST_MODEL_DEFAULT, REASONING_MODEL_DEFAULT],
        )

    def test_identical_model_ids_are_deduplicated(self):
        os.environ["AI_FAST_MODEL"] = "same-model"
        os.environ["AI_REASONING_MODEL"] = "same-model"
        self.client.messages.create.return_value = object()

        with self.assertRaises(QualityGateError):
            create_validated_message(self.client, "tutor_chat", validator=lambda _: False)

        self.client.messages.create.assert_called_once_with(model="same-model")

    def test_api_error_propagates_without_fallback(self):
        failure = RuntimeError("request failed")
        self.client.messages.create.side_effect = failure

        with self.assertRaisesRegex(RuntimeError, "request failed") as raised:
            create_validated_message(self.client, "tutor_chat", validator=lambda _: False)

        self.assertIs(raised.exception, failure)
        self.client.messages.create.assert_called_once()

    def test_disabled_cascade_makes_one_call(self):
        os.environ["AI_CASCADE_ENABLED"] = "false"
        self.client.messages.create.return_value = object()

        with self.assertRaises(QualityGateError):
            create_validated_message(self.client, "tutor_chat", validator=lambda _: False)

        self.client.messages.create.assert_called_once_with(model=FAST_MODEL_DEFAULT)

    def test_usage_is_logged_for_both_actual_responses(self):
        responses = [
            SimpleNamespace(usage=SimpleNamespace(input_tokens=10, output_tokens=2)),
            SimpleNamespace(usage=SimpleNamespace(input_tokens=20, output_tokens=4)),
        ]
        self.client.messages.create.side_effect = responses

        with self.assertLogs("app.core.model_router", level=logging.INFO) as captured:
            result = create_validated_message(
                self.client, "tutor_chat", validator=lambda response: response is responses[1]
            )

        usage_records = [record for record in captured.records if hasattr(record, "input_tokens")]
        self.assertIs(result, responses[1])
        self.assertEqual(len(usage_records), 2)
        self.assertEqual([record.input_tokens for record in usage_records], [10, 20])
        self.assertEqual([record.output_tokens for record in usage_records], [2, 4])

    def test_invalid_boolean_configuration_fails_before_request(self):
        for name, value in (
            ("AI_CASCADE_ENABLED", "sometimes"),
            ("AI_ALLOW_OPUS_ESCALATION", "1"),
        ):
            with self.subTest(name=name):
                os.environ[name] = value
                with self.assertRaisesRegex(ValueError, name):
                    create_validated_message(self.client, "tutor_chat", validator=lambda _: True)
                self.client.messages.create.assert_not_called()
                os.environ.pop(name)

    def test_invalid_premium_model_fails_before_request_when_enabled(self):
        os.environ["AI_ROUTING_MODE"] = "quality"
        os.environ["AI_ALLOW_OPUS_ESCALATION"] = "true"
        os.environ["AI_PREMIUM_MODEL"] = "  "

        with self.assertRaisesRegex(ValueError, "AI_PREMIUM_MODEL"):
            create_validated_message(self.client, "tutor_chat", validator=lambda _: True)

        self.client.messages.create.assert_not_called()

    def test_validator_exception_propagates_without_retry(self):
        failure = RuntimeError("local validator bug")
        self.client.messages.create.return_value = object()

        with self.assertRaisesRegex(RuntimeError, "local validator bug") as raised:
            create_validated_message(
                self.client, "tutor_chat", validator=MagicMock(side_effect=failure)
            )

        self.assertIs(raised.exception, failure)
        self.client.messages.create.assert_called_once()


if __name__ == "__main__":
    unittest.main()
