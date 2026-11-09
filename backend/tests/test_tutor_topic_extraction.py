import json
import os
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.api import tutor


TOPIC = {'id': 'a', 'title': 'Cells', 'summary': 'Cell structure.', 'key_points': ['Nucleus']}


class TutorTopicExtractionTests(unittest.TestCase):
    def test_accepts_wrapped_objects_arrays_and_single_element_arrays(self):
        for raw in (
            json.dumps({'topics': [TOPIC]}),
            '```json\n' + json.dumps({'topics': [TOPIC]}) + '\n```',
            'Here are the topics:\n' + json.dumps([TOPIC]),
            'Here are the topics:\n' + json.dumps([TOPIC, {**TOPIC, 'id': 'b', 'title': 'Membranes'}]),
            'Result: {"metadata":"outline"}\n' + json.dumps({'topics': [TOPIC]}),
        ):
            with self.subTest(raw=raw):
                topics = tutor._normalise_topics(raw)
                self.assertGreater(len(topics), 0)
                self.assertEqual(topics[0]['title'], 'Cells')
                self.assertEqual(topics[0]['id'], '1')

    def test_rejects_unusable_topics_without_leaking_raw_response(self):
        for result in ({'topics': []}, {'topics': 'Cells'}, {'topics': [None]},
                       {'topics': [{'title': 'Cells'}]}, {'topics': [{**TOPIC, 'key_points': 'invalid'}]}):
            self.assertEqual(tutor._normalise_topics(json.dumps(result)), [])

    def start(self, text, stop_reason='end_turn'):
        app = FastAPI()
        app.include_router(tutor.router)
        db = MagicMock()
        db.table.return_value.select.return_value.eq.return_value.execute.return_value.data = []
        ai = MagicMock()
        ai.messages.create.return_value = SimpleNamespace(content=[SimpleNamespace(text=text)], stop_reason=stop_reason)
        with patch.dict(os.environ, {'ANTHROPIC_API_KEY': 'test-key'}), patch(
            'app.api.tutor.get_supabase_client', return_value=db
        ), patch('app.api.tutor._fetch_pdf_text', return_value='Cell notes. ' * 100), patch(
            'app.api.tutor.anthropic.Anthropic', return_value=ai
        ), TestClient(app) as client:
            result = client.post('/tutor/start', json={'pdf_url': 'https://example.test/notes.pdf', 'room_id': 'room'})
        return result, db, ai

    def test_cleaner_pdf_reader_preserves_final_pages_without_ocr(self):
        doc = MagicMock()
        doc.__len__.return_value = 2
        doc.__getitem__.side_effect = [SimpleNamespace(get_text=lambda: "Clean first page. " * 30),
                                       SimpleNamespace(get_text=lambda: "Last page: 123 and punctuation.")]
        downloaded = SimpleNamespace(content=b"pdf", raise_for_status=lambda: None)
        with patch.object(tutor, "HAS_FITZ", True), patch.object(tutor, "HAS_REQUESTS", True), patch(
            'app.api.tutor._fitz.open', return_value=doc
        ), patch('app.api.tutor._requests.get', return_value=downloaded), patch(
            'app.api.tutor.pypdf.PdfReader'
        ) as alternate, patch('app.api.tutor._vision_transcribe_pages') as ocr:
            text = tutor._fetch_pdf_text('https://example.test/notes.pdf')
        self.assertIn('[Page 2]\nLast page: 123 and punctuation.', text)
        doc.close.assert_called_once()
        alternate.assert_not_called()
        ocr.assert_not_called()

    def test_full_supported_pdf_reaches_topic_prompt_cache_and_chat(self):
        notes = 'Readable text. ' * 6000 + 'FINAL CHAPTER MARKER'
        app = FastAPI()
        app.include_router(tutor.router)
        db = MagicMock()
        db.table.return_value.select.return_value.eq.return_value.execute.return_value.data = []
        ai = MagicMock()
        ai.messages.create.return_value = SimpleNamespace(content=[SimpleNamespace(text=json.dumps({'topics': [TOPIC]}))], stop_reason='end_turn')
        with patch.dict(os.environ, {'ANTHROPIC_API_KEY': 'test-key'}), patch(
            'app.api.tutor.get_supabase_client', return_value=db
        ), patch('app.api.tutor._fetch_pdf_text', return_value=notes), patch(
            'app.api.tutor.anthropic.Anthropic', return_value=ai
        ), TestClient(app) as client:
            response = client.post('/tutor/start', json={'pdf_url': 'https://example.test/notes.pdf', 'room_id': 'room'})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()['pdf_text'], notes)
            self.assertIn('FINAL CHAPTER MARKER', ai.messages.create.call_args.kwargs['messages'][0]['content'])
            self.assertEqual(db.table.return_value.update.call_args.args[0]['pdf_text'], notes)
            ai.messages.create.return_value = SimpleNamespace(content=[SimpleNamespace(text='What happens next?')])
            chat = client.post('/tutor/chat', json={'pdf_text':notes, 'topics':response.json()['topics'], 'current_topic_index':0, 'messages':[], 'user_message':'__start__'})
            self.assertEqual(chat.status_code, 200)
            self.assertIn('FINAL CHAPTER MARKER', ai.messages.create.call_args.kwargs['system'])
        self.assertEqual(ai.messages.create.call_count, 2)

    def test_oversize_pdf_rejected_before_paid_topic_request(self):
        with patch.dict(os.environ, {'ANTHROPIC_API_KEY': 'test-key'}), patch(
            'app.api.tutor.get_supabase_client'
        ), patch('app.api.tutor._fetch_pdf_text', return_value='x' * (tutor.MAX_GOF_TEXT_CHARS + 1)), patch(
            'app.api.tutor.anthropic.Anthropic'
        ) as ai:
            with self.assertRaises(tutor.HTTPException) as failure:
                tutor.start_gauntlet(tutor.StartRequest(pdf_url='https://example.test/notes.pdf'))
        self.assertEqual(failure.exception.status_code, 413)
        ai.assert_not_called()

    def test_http_start_accepts_json_body_without_user_id_query_and_caches_valid_topics(self):
        response, db, ai = self.start('Here are the topics:\n' + json.dumps([TOPIC]))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['topics'][0]['title'], 'Cells')
        db.table.return_value.update.assert_called_once()
        ai.messages.create.assert_called_once()
        self.assertEqual(ai.messages.create.call_args.kwargs['model'], 'claude-sonnet-4-6')
        self.assertEqual(ai.messages.create.call_args.kwargs['max_tokens'], 4000)

    def test_truncated_reply_is_not_cached_or_retried(self):
        response, db, ai = self.start(json.dumps({'topics': [TOPIC]}), 'max_tokens')
        self.assertEqual(response.status_code, 502)
        self.assertIn('response limit', response.json()['detail'])
        db.table.return_value.update.assert_not_called()
        ai.messages.create.assert_called_once()

    def test_empty_model_reply_gets_precise_error_not_short_pdf_diagnosis(self):
        response, db, ai = self.start('No outline available. private-content')
        self.assertEqual(response.status_code, 502)
        self.assertIn('AI returned no usable topic list', response.json()['detail'])
        self.assertNotIn('private-content', response.text)
        db.table.return_value.update.assert_not_called()
        ai.messages.create.assert_called_once()


if __name__ == '__main__':
    unittest.main()
