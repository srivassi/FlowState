import os
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import requests
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import flashcards


PDF_URL = "https://project.supabase.co/storage/v1/object/public/whiteboards/user-1/course-1/board.pdf"
PDF_BYTES = b"%PDF-mocked-whiteboard-content"
BODY = {
    "pdf_url": PDF_URL,
    "user_id": "user-1",
    "course_id": "course-1",
    "title": "Whiteboard cards",
    "instructions": "Focus on definitions",
}


class FakeResponse:
    def __init__(self, chunks=(), status=200, headers=None):
        self.status_code = status
        self.headers = headers or {}
        self.chunks = chunks
        self.closed = False

    def iter_content(self, chunk_size):
        yield from self.chunks

    def close(self):
        self.closed = True


def make_db(course_rows=None):
    db = MagicMock()
    tables = {name: MagicMock() for name in ("courses", "flashcard_sets", "flashcards")}
    db.table.side_effect = lambda name: tables[name]
    tables["courses"].select.return_value.eq.return_value.eq.return_value.execute.return_value.data = (
        [{"id": "course-1"}] if course_rows is None else course_rows
    )
    tables["flashcard_sets"].insert.return_value.execute.return_value.data = [
        {"id": "set-1", "user_id": "user-1", "course_id": "course-1", "title": "Whiteboard cards"}
    ]
    return db, tables


def make_ai(text='[{"question":"What is a cell?","answer":"The basic unit of life."}]'):
    ai = MagicMock()
    ai.messages.create.return_value.content = [SimpleNamespace(text=text)]
    return ai


def mock_pdf_reader(content=PDF_BYTES, text="Source PDF text"):
    def read_pdf(stream):
        assert stream.read() == content
        return SimpleNamespace(pages=[SimpleNamespace(extract_text=lambda: text)])

    return read_pdf


class FlashcardUrlTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(
            os.environ,
            {"SUPABASE_URL": "https://project.supabase.co", "ANTHROPIC_API_KEY": "test-key"},
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)
        app = FastAPI()
        app.include_router(flashcards.router)
        self.client = TestClient(app)

    def test_post_generate_from_url_downloads_and_uses_shared_pipeline(self):
        db, tables = make_db()
        response_body = make_ai()
        downloaded = FakeResponse([PDF_BYTES])
        with (
            patch.object(flashcards, "get_supabase_client", return_value=db),
            patch.object(flashcards.requests, "get", return_value=downloaded) as get,
            patch.object(flashcards.pypdf, "PdfReader", side_effect=mock_pdf_reader()),
            patch.object(flashcards.anthropic, "Anthropic", return_value=response_body) as anthropic_client,
        ):
            response = self.client.post("/flashcards/generate-from-url", json=BODY)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["count"], 1)
        self.assertEqual(response.json()["cards"][0]["question"], "What is a cell?")
        get.assert_called_once_with(PDF_URL, stream=True, timeout=(3, 15), allow_redirects=False)
        self.assertTrue(downloaded.closed)
        db.table.assert_any_call("courses")
        tables["courses"].select.return_value.eq.assert_called_once_with("id", "course-1")
        tables["courses"].select.return_value.eq.return_value.eq.assert_called_once_with("user_id", "user-1")
        anthropic_client.assert_called_once_with(api_key="test-key", max_retries=0)
        self.assertEqual(
            response_body.messages.create.call_args.kwargs["model"], "claude-haiku-4-5-20251001"
        )
        self.assertIn(
            "Source PDF text",
            response_body.messages.create.call_args.kwargs["messages"][0]["content"],
        )
        tables["flashcard_sets"].insert.assert_called_once_with(
            {"user_id": "user-1", "course_id": "course-1", "title": "Whiteboard cards"}
        )

    def test_multipart_upload_still_generates_and_persists_cards(self):
        db, tables = make_db()
        with (
            patch.object(flashcards, "get_supabase_client", return_value=db),
            patch.object(flashcards.pypdf, "PdfReader", side_effect=mock_pdf_reader(PDF_BYTES)),
            patch.object(flashcards.anthropic, "Anthropic", return_value=make_ai()),
        ):
            response = self.client.post(
                "/flashcards/generate",
                files={"file": ("notes.pdf", PDF_BYTES, "application/pdf")},
                data={"user_id": "user-1", "course_id": "course-1", "title": "Upload cards"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["count"], 1)
        self.assertEqual(response.json()["cards"][0]["answer"], "The basic unit of life.")
        tables["flashcard_sets"].insert.assert_called_once()
        tables["flashcards"].insert.assert_called_once()

    def test_url_and_upload_generation_share_outputs_for_multiline_instructions(self):
        body = {
            **BODY,
            "title": "Whiteboard\nCards",
            "instructions": "Focus on definitions\n\tInclude examples",
        }
        url_db, _ = make_db()
        upload_db, _ = make_db()
        url_ai = make_ai()
        upload_ai = make_ai()
        with (
            patch.object(flashcards, "get_supabase_client", return_value=url_db),
            patch.object(flashcards.requests, "get", return_value=FakeResponse([PDF_BYTES])),
            patch.object(flashcards.pypdf, "PdfReader", side_effect=mock_pdf_reader()),
            patch.object(flashcards.anthropic, "Anthropic", return_value=url_ai),
        ):
            url_response = self.client.post("/flashcards/generate-from-url", json=body)

        with (
            patch.object(flashcards, "get_supabase_client", return_value=upload_db),
            patch.object(flashcards.pypdf, "PdfReader", side_effect=mock_pdf_reader()),
            patch.object(flashcards.anthropic, "Anthropic", return_value=upload_ai),
        ):
            upload_response = self.client.post(
                "/flashcards/generate",
                files={"file": ("notes.pdf", PDF_BYTES, "application/pdf")},
                data={
                    "user_id": body["user_id"],
                    "course_id": body["course_id"],
                    "title": body["title"],
                    "instructions": body["instructions"],
                },
            )

        self.assertEqual(url_response.status_code, 200)
        self.assertEqual(upload_response.status_code, 200)
        self.assertEqual(url_response.json(), upload_response.json())
        self.assertEqual(
            url_ai.messages.create.call_args.kwargs,
            upload_ai.messages.create.call_args.kwargs,
        )
        self.assertIn("Focus on definitions\n\tInclude examples", url_ai.messages.create.call_args.kwargs["messages"][0]["content"])

    @unittest.skipUnless(flashcards.HAS_FITZ, "PyMuPDF is not installed")
    def test_private_use_pypdf_text_falls_back_to_pymupdf(self):
        db, _ = make_db()
        ai = make_ai()
        pypdf_text = "Lecture notes with corrupted digits \ue003"
        document = MagicMock()
        document.__iter__.return_value = [SimpleNamespace(get_text=lambda: "Lecture notes with clean digits 123")]
        with (
            patch.object(flashcards, "get_supabase_client", return_value=db),
            patch.object(flashcards.requests, "get", return_value=FakeResponse([PDF_BYTES])),
            patch.object(flashcards.pypdf, "PdfReader", side_effect=mock_pdf_reader(text=pypdf_text)),
            patch.object(flashcards.fitz, "open", return_value=document) as open_pdf,
            patch.object(flashcards.anthropic, "Anthropic", return_value=ai),
        ):
            response = self.client.post("/flashcards/generate-from-url", json=BODY)

        self.assertEqual(response.status_code, 200)
        open_pdf.assert_called_once_with(stream=PDF_BYTES, filetype="pdf")
        document.close.assert_called_once()
        prompt = ai.messages.create.call_args.kwargs["messages"][0]["content"]
        self.assertIn("Lecture notes with clean digits 123", prompt)
        self.assertNotIn("\ue003", prompt)

    def test_hostname_and_path_validation_block_before_network_or_model(self):
        invalid_urls = (
            "https://attacker.example/storage/v1/object/public/whiteboards/user-1/course-1/a.pdf",
            "https://project.supabase.co/storage/v1/object/public/whiteboards/user-1/course-1/%2e%2e/secret.pdf",
            "https://project.supabase.co/storage/v1/object/public/whiteboards/user-1/course-1/%252e%252e/secret.pdf",
            "https://project.supabase.co/storage/v1/object/public/whiteboards/user-2/course-1/a.pdf",
            "https://project.supabase.co/storage/v1/object/public/whiteboards/user-1/course-2/a.pdf",
        )
        for url in invalid_urls:
            with self.subTest(url=url):
                with (
                    patch.object(flashcards, "get_supabase_client") as get_db,
                    patch.object(flashcards.requests, "get") as get,
                    patch.object(flashcards.anthropic, "Anthropic") as anthropic_client,
                ):
                    response = self.client.post(
                        "/flashcards/generate-from-url", json={**BODY, "pdf_url": url}
                    )
                self.assertEqual(response.status_code, 400)
                get_db.assert_not_called()
                get.assert_not_called()
                anthropic_client.assert_not_called()

    def test_course_ownership_is_checked_before_network_or_model(self):
        db, _ = make_db(course_rows=[])
        with (
            patch.object(flashcards, "get_supabase_client", return_value=db),
            patch.object(flashcards.requests, "get") as get,
            patch.object(flashcards.anthropic, "Anthropic") as anthropic_client,
        ):
            response = self.client.post("/flashcards/generate-from-url", json=BODY)

        self.assertEqual(response.status_code, 404)
        get.assert_not_called()
        anthropic_client.assert_not_called()

    def test_download_status_redirect_size_and_empty_errors_are_sanitized(self):
        cases = (
            (FakeResponse([], status=302, headers={"location": "https://private.invalid/secret"}), 502, "Could not download"),
            (FakeResponse([], status=503), 502, "Could not download"),
            (FakeResponse([], headers={"content-length": str(flashcards.MAX_PDF_BYTES + 1)}), 413, "20 MiB"),
            (FakeResponse([b"x" * (flashcards.MAX_PDF_BYTES + 1)]), 413, "20 MiB"),
            (FakeResponse([b""]), 400, "empty"),
        )
        for downloaded, status, detail in cases:
            with self.subTest(status=status, detail=detail):
                db, _ = make_db()
                with (
                    patch.object(flashcards, "get_supabase_client", return_value=db),
                    patch.object(flashcards.requests, "get", return_value=downloaded),
                    patch.object(flashcards.anthropic, "Anthropic") as anthropic_client,
                ):
                    response = self.client.post("/flashcards/generate-from-url", json=BODY)
                self.assertEqual(response.status_code, status)
                self.assertIn(detail, response.json()["detail"])
                self.assertNotIn("private.invalid", response.text)
                anthropic_client.assert_not_called()

    def test_network_failure_is_sanitized(self):
        db, _ = make_db()
        with (
            patch.object(flashcards, "get_supabase_client", return_value=db),
            patch.object(
                flashcards.requests,
                "get",
                side_effect=requests.ConnectionError("failed https://project.supabase.co/?secret=do-not-return"),
            ),
            patch.object(flashcards.anthropic, "Anthropic") as anthropic_client,
        ):
            response = self.client.post("/flashcards/generate-from-url", json=BODY)

        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()["detail"], "Could not download the whiteboard PDF")
        self.assertNotIn("secret", response.text)
        anthropic_client.assert_not_called()

    def test_invalid_pdf_and_unusable_ai_output_do_not_create_sets(self):
        db, tables = make_db()
        with (
            patch.object(flashcards, "get_supabase_client", return_value=db),
            patch.object(flashcards.requests, "get", return_value=FakeResponse([PDF_BYTES])),
            patch.object(flashcards.pypdf, "PdfReader", side_effect=ValueError("private parser detail")),
        ):
            invalid_pdf = self.client.post("/flashcards/generate-from-url", json=BODY)
        self.assertEqual(invalid_pdf.status_code, 400)
        self.assertNotIn("private parser detail", invalid_pdf.text)
        tables["flashcard_sets"].insert.assert_not_called()

        with (
            patch.object(flashcards, "get_supabase_client", return_value=db),
            patch.object(flashcards.requests, "get", return_value=FakeResponse([PDF_BYTES])),
            patch.object(flashcards.pypdf, "PdfReader", side_effect=mock_pdf_reader()),
            patch.object(flashcards.anthropic, "Anthropic", return_value=make_ai("[]")),
        ):
            empty_cards = self.client.post("/flashcards/generate-from-url", json=BODY)
        self.assertEqual(empty_cards.status_code, 500)
        self.assertIn("no usable cards", empty_cards.json()["detail"])
        tables["flashcard_sets"].insert.assert_not_called()

    def test_missing_empty_and_control_character_payloads_return_422(self):
        invalid_bodies = (
            {key: value for key, value in BODY.items() if key != "pdf_url"},
            {**BODY, "pdf_url": ""},
            {**BODY, "pdf_url": "https://project.supabase.co/a\nb"},
            {**BODY, "user_id": "  "},
            {**BODY, "course_id": ""},
            {**BODY, "title": "  "},
            {**BODY, "instructions": "bad\x00instruction"},
        )
        for body in invalid_bodies:
            with self.subTest(body=body):
                with patch.object(flashcards, "get_supabase_client") as get_db:
                    response = self.client.post("/flashcards/generate-from-url", json=body)
                self.assertEqual(response.status_code, 422)
                get_db.assert_not_called()

    def test_http_is_allowed_only_for_configured_local_supabase(self):
        local_body = {
            **BODY,
            "pdf_url": "http://127.0.0.1:54321/storage/v1/object/public/whiteboards/user-1/course-1/a.pdf",
        }
        db, _ = make_db()
        with (
            patch.dict(os.environ, {"SUPABASE_URL": "http://127.0.0.1:54321"}),
            patch.object(flashcards, "get_supabase_client", return_value=db),
            patch.object(flashcards.requests, "get", return_value=FakeResponse([PDF_BYTES])),
            patch.object(flashcards.pypdf, "PdfReader", side_effect=mock_pdf_reader()),
            patch.object(flashcards.anthropic, "Anthropic", return_value=make_ai()),
        ):
            response = self.client.post("/flashcards/generate-from-url", json=local_body)
        self.assertEqual(response.status_code, 200)

        with patch.dict(os.environ, {"SUPABASE_URL": "http://supabase.example"}):
            denied = self.client.post(
                "/flashcards/generate-from-url",
                json={
                    **local_body,
                    "pdf_url": local_body["pdf_url"].replace("127.0.0.1:54321", "supabase.example"),
                },
            )
        self.assertEqual(denied.status_code, 400)


if __name__ == "__main__":
    unittest.main()
