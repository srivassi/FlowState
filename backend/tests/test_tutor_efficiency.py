import os
import unittest
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from app.api.tutor import ChatRequest, StartRequest, _needs_reasoning, gauntlet_chat, start_gauntlet


class TutorEfficiencyTests(unittest.TestCase):
    def request(self, **updates):
        data = dict(
            pdf_text='Shared notes ' * 1800,
            topics=[{'id': 'one', 'title': 'Cells'}, {'id': 'two', 'title': 'Membranes'}],
            current_topic_index=0,
            messages=[],
            user_message='__start__',
        )
        data.update(updates)
        return ChatRequest(**data)

    def client(self):
        client = MagicMock()
        client.messages.create.return_value.content[0].text = 'What does the nucleus do?'
        return client

    def test_routine_and_deeper_turns_route_without_a_classifier_call(self):
        client = self.client()
        with patch.dict(os.environ, {'ANTHROPIC_API_KEY': 'test-key', 'AI_ROUTING_MODE': 'economy'}, clear=True), patch(
            'app.api.tutor.anthropic.Anthropic', return_value=client
        ) as constructor:
            gauntlet_chat(self.request())
            gauntlet_chat(self.request(user_message='__go_deeper__'))
        constructor.assert_called_with(api_key='test-key', max_retries=0)
        self.assertEqual(client.messages.create.call_count, 2)
        self.assertEqual(client.messages.create.call_args_list[0].kwargs['model'], 'claude-haiku-4-5-20251001')
        self.assertEqual(client.messages.create.call_args_list[1].kwargs['model'], 'claude-sonnet-4-6')

    def test_stable_cache_prefix_survives_topic_change_with_full_notes_and_history(self):
        client = self.client()
        history = [{'role': 'assistant', 'content': 'Explain membranes.'}, {'role': 'user', 'content': 'They control transport.'}]
        with patch.dict(os.environ, {'ANTHROPIC_API_KEY': 'test-key', 'AI_PROMPT_CACHING': 'true'}), patch(
            'app.api.tutor.anthropic.Anthropic', return_value=client
        ):
            gauntlet_chat(self.request())
            gauntlet_chat(self.request(current_topic_index=1, messages=history, user_message='A selective barrier.'))
        first, second = [call.kwargs for call in client.messages.create.call_args_list]
        self.assertEqual(first['system'][0], second['system'][0])
        self.assertEqual(first['system'][0]['cache_control'], {'type': 'ephemeral'})
        self.assertIn(self.request().pdf_text[:30000], first['system'][0]['text'])
        self.assertNotIn('CURRENT TOPIC', first['system'][0]['text'])
        self.assertIn('CURRENT TOPIC (2 of 2)', second['system'][1]['text'])
        self.assertNotIn('cache_control', second['system'][1])
        self.assertEqual(second['messages'][:-1], history)
        self.assertEqual(second['messages'][-1]['content'], 'A selective barrier.')

    def test_cache_can_be_disabled_without_changing_tutoring_protocol(self):
        client = self.client()
        client.messages.create.return_value.content[0].text = 'Good reasoning.\n{"action": "finish", "stars": 3}'
        with patch.dict(os.environ, {'ANTHROPIC_API_KEY': 'test-key', 'AI_PROMPT_CACHING': 'false'}), patch(
            'app.api.tutor.anthropic.Anthropic', return_value=client
        ):
            result = gauntlet_chat(self.request())
        self.assertNotIn('cache_control', client.messages.create.call_args.kwargs['system'][0])
        self.assertEqual(result['reply'], 'Good reasoning.')
        self.assertEqual(result['action'], 'finish')
        self.assertEqual(result['stars'], 3)

    def test_invalid_topic_is_rejected_without_a_paid_request(self):
        client = self.client()
        with patch.dict(os.environ, {'ANTHROPIC_API_KEY': 'test-key'}), patch(
            'app.api.tutor.anthropic.Anthropic', return_value=client
        ):
            for index in (-1, 2):
                with self.subTest(index=index), self.assertRaises(HTTPException) as error:
                    gauntlet_chat(self.request(current_topic_index=index))
                self.assertEqual(error.exception.status_code, 400)
        client.messages.create.assert_not_called()

    def test_existing_room_avoids_topic_extraction_and_pdf_download(self):
        client = MagicMock()
        cached = {'topics': [{'id': 'one', 'title': 'Cells'}], 'pdf_text': 'Cached notes'}
        client.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [cached]
        with patch('app.api.tutor.get_supabase_client', return_value=client), patch(
            'app.api.tutor.anthropic.Anthropic'
        ) as ai, patch('app.api.tutor._fetch_pdf_text') as download:
            result = start_gauntlet(StartRequest(pdf_url='https://example.test/notes.pdf', room_id='room'))
        self.assertEqual(result, cached)
        ai.assert_not_called()
        download.assert_not_called()

    def test_reasoning_signals_are_local_and_specific(self):
        self.assertFalse(_needs_reasoning('The membrane controls entry.', {'title': 'Cells'}))
        self.assertTrue(_needs_reasoning('__start__', {'title': 'Algorithm complexity'}))
        self.assertTrue(_needs_reasoning('Can you derive this?', {'title': 'Rates'}))
        self.assertTrue(_needs_reasoning('x' * 1200, {'title': 'Cells'}))


if __name__ == '__main__':
    unittest.main()
