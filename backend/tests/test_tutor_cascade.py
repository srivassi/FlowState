import os
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from app.api.tutor import ChatRequest, _passes_tutor_gate, gauntlet_chat, router


def message(text, stop_reason='end_turn'):
    return SimpleNamespace(content=[SimpleNamespace(text=text)], stop_reason=stop_reason)


class TutorCascadeTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {'ANTHROPIC_API_KEY': 'test', 'AI_ROUTING_MODE': 'economy'}, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)

    def request(self, **changes):
        fields = dict(pdf_text='Cell notes', topics=[{'id': '1', 'title': 'Cells'}], current_topic_index=0,
                      messages=[{'role': 'assistant', 'content': 'Where is DNA stored?'}], user_message='In the nucleus.')
        fields.update(changes)
        return ChatRequest(**fields)

    def test_local_gate_accepts_conversation_and_whitespace_in_directive(self):
        for text in ('What does the nucleus do?', 'Good reasoning.\n{ "action" : "finish", "stars" : 2 }'):
            self.assertTrue(_passes_tutor_gate(message(text), self.request()))

    def test_local_gate_rejects_broken_protocol_or_model_escalation_signal(self):
        invalid = [
            '', '   ', '{"action":"escalate"}', 'Try again. {"action": "escalate"}',
            'Good. {"action":"finish","stars":0}', 'Good. {"action":"finish","stars":4}',
            'Good. {"action":"finish","stars":true}', 'Good. {"action":"finish","stars":"3"}',
            'Good. {"action":"finish","stars":3} trailing text',
            'Good. {"action":"finish","stars":3',
            'Good. {"action" "finish"}',
            '{"action":"finish","stars":3}',
            'Good. {"action":"next_topic","stars":3}',
        ]
        for text in invalid:
            with self.subTest(text=text):
                self.assertFalse(_passes_tutor_gate(message(text), self.request()))
        self.assertFalse(_passes_tutor_gate(message('Partial', 'max_tokens'), self.request()))
        self.assertFalse(_passes_tutor_gate(message('No', 'refusal'), self.request()))
        self.assertFalse(_passes_tutor_gate(SimpleNamespace(content=[]), self.request()))

    def test_no_mastery_before_answer_and_correct_last_topic_semantics(self):
        finish = message('Good reasoning.\n{"action":"finish","stars":3}')
        self.assertFalse(_passes_tutor_gate(finish, self.request(user_message='__start__', messages=[])))
        topics = [{'id': '1', 'title': 'Cells'}, {'id': '2', 'title': 'Membranes'}]
        self.assertFalse(_passes_tutor_gate(finish, self.request(topics=topics)))
        next_topic = message('Good reasoning.\n{"action":"next_topic","stars":3}')
        self.assertTrue(_passes_tutor_gate(next_topic, self.request(topics=topics)))

    def test_invalid_haiku_reply_escalates_once_and_only_valid_reply_advances(self):
        client = MagicMock()
        client.messages.create.side_effect = [message('{"action":"escalate"}'),
                                              message('Correct.\n{"action":"finish","stars":3}')]
        with patch('app.api.tutor.anthropic.Anthropic', return_value=client):
            result = gauntlet_chat(self.request())
        self.assertEqual([call.kwargs['model'] for call in client.messages.create.call_args_list],
                         ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6'])
        self.assertEqual(result['action'], 'finish')
        self.assertEqual(result['stars'], 3)
        self.assertEqual(result['reply'], 'Correct.')
        self.assertNotIn('escalate', str(result['messages']))
        first, second = [call.kwargs for call in client.messages.create.call_args_list]
        self.assertEqual(first['messages'], second['messages'])
        self.assertEqual(first['system'], second['system'])

    def test_exhausted_gate_reports_error_without_advancing_or_third_call(self):
        client = MagicMock()
        client.messages.create.return_value = message('')
        body = self.request()
        original_messages = list(body.messages)
        with patch('app.api.tutor.anthropic.Anthropic', return_value=client):
            with self.assertRaises(HTTPException) as failure:
                gauntlet_chat(body)
        self.assertEqual(failure.exception.status_code, 502)
        self.assertIn('progress has not advanced', failure.exception.detail)
        self.assertEqual(client.messages.create.call_count, 2)
        self.assertEqual(body.messages, original_messages)

    def test_http_endpoint_never_leaks_failed_candidate_or_advances_on_error(self):
        app = FastAPI()
        app.include_router(router)
        client = MagicMock()
        client.messages.create.side_effect = [message('{"action":"escalate"}'), message('')]
        with TestClient(app) as http, patch('app.api.tutor.anthropic.Anthropic', return_value=client):
            response = http.post('/tutor/chat', json=self.request().model_dump())
        self.assertEqual(response.status_code, 502)
        self.assertEqual(list(response.json()), ['detail'])
        self.assertNotIn('escalate', response.text)
        self.assertEqual(client.messages.create.call_count, 2)

    def test_complex_request_uses_sonnet_and_no_opus_without_opt_in(self):
        client = MagicMock()
        client.messages.create.return_value = message('{"action":"escalate"}')
        with patch('app.api.tutor.anthropic.Anthropic', return_value=client):
            with self.assertRaises(HTTPException):
                gauntlet_chat(self.request(user_message='__go_deeper__'))
        client.messages.create.assert_called_once()
        self.assertEqual(client.messages.create.call_args.kwargs['model'], 'claude-sonnet-4-6')


if __name__ == '__main__':
    unittest.main()
