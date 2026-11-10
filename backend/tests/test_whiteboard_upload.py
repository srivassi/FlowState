import unittest
from unittest.mock import MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.api.whiteboard import router


class WhiteboardUploadTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(router)
        self.client = TestClient(app)
        self.db = MagicMock()
        self.bucket = self.db.storage.from_.return_value
        self.bucket.create_signed_upload_url.return_value = {'signed_url': 'https://storage.test/upload?token=private'}
        self.bucket.get_public_url.side_effect = lambda path: 'https://storage.test/public/' + path
        self.body = {'user_id': 'student-1', 'course_id': 'course-1', 'file_name': 'Computer Vision — Exam Notes.pdf'}

    def test_unicode_filename_and_retries_use_unique_ascii_keys(self):
        with patch('app.api.whiteboard.get_supabase_client', return_value=self.db):
            results = [self.client.post('/whiteboard/upload-url', json=self.body) for _ in range(2)]
        paths = [response.json()['path'] for response in results]
        self.assertTrue(all(response.status_code == 200 for response in results))
        self.assertNotEqual(*paths)
        for path, call in zip(paths, self.bucket.create_signed_upload_url.call_args_list):
            self.assertRegex(path, r'^student-1/course-1/[a-f0-9]{32}\.pdf$')
            self.assertEqual(call.args, (path,))
        for response, path in zip(results, paths):
            self.assertTrue(response.json()['pdf_url'].endswith(path))

    def test_supported_sdk_url_aliases(self):
        for alias in ('signedURL', 'signed_url', 'signedUrl'):
            self.bucket.create_signed_upload_url.return_value = {alias: 'https://storage.test/signed'}
            with patch('app.api.whiteboard.get_supabase_client', return_value=self.db):
                response = self.client.post('/whiteboard/upload-url', json=self.body)
            self.assertEqual(response.status_code, 200)

    def test_signing_errors_do_not_expose_tokens(self):
        for value in ({'token': 'private-token'}, RuntimeError('https://storage.test?token=private-token')):
            self.bucket.create_signed_upload_url.side_effect = value if isinstance(value, Exception) else None
            self.bucket.create_signed_upload_url.return_value = value
            with patch('app.api.whiteboard.get_supabase_client', return_value=self.db):
                response = self.client.post('/whiteboard/upload-url', json=self.body)
            self.assertEqual(response.status_code, 502)
            self.assertNotIn('private-token', response.text)

    def test_invalid_path_segments_rejected_before_storage(self):
        with patch('app.api.whiteboard.get_supabase_client') as db:
            for field, value in (('user_id', '../student'), ('course_id', 'one/two'), ('file_name', '')):
                response = self.client.post('/whiteboard/upload-url', json={**self.body, field: value})
                self.assertEqual(response.status_code, 422)
            db.assert_not_called()
