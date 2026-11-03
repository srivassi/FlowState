import unittest
from datetime import date, timedelta
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from pydantic import ValidationError
from app.api.onboarding import CourseExamUpdate, update_course_exam


class CourseExamTests(unittest.TestCase):
    def test_updates_only_requested_users_module_and_normalizes_name(self):
        exam = date.today() + timedelta(days=54)
        client = MagicMock()
        query = client.table.return_value
        query.update.return_value.eq.return_value.eq.return_value.execute.return_value.data = [
            {"id": "module", "title": "Biology", "exam_date": exam.isoformat()}
        ]
        with patch("app.api.onboarding.get_supabase_client", return_value=client):
            result = update_course_exam("module", CourseExamUpdate(user_id="student", exam_date=exam))
        query.update.assert_called_once_with({"exam_date": exam.isoformat()})
        query.update.return_value.eq.assert_called_once_with("id", "module")
        query.update.return_value.eq.return_value.eq.assert_called_once_with("user_id", "student")
        self.assertEqual(result["name"], "Biology")
        self.assertEqual(result["exam_date"], exam.isoformat())
        self.assertEqual(client.table.call_count, 1)  # Saving a deadline does not change task history.

    def test_rejects_expired_deadline_before_writing(self):
        for exam in (date.today(), date.today() - timedelta(days=2)):
            with self.subTest(exam=exam), patch("app.api.onboarding.get_supabase_client") as client:
                with self.assertRaises(HTTPException) as error:
                    update_course_exam("module", CourseExamUpdate(user_id="student", exam_date=exam))
                self.assertEqual(error.exception.status_code, 400)
                client.assert_not_called()

    def test_rejects_invalid_date(self):
        with self.assertRaises(ValidationError):
            CourseExamUpdate(user_id="student", exam_date="2026-02-30")

    def test_missing_or_other_users_module_returns_not_found(self):
        client = MagicMock()
        client.table.return_value.update.return_value.eq.return_value.eq.return_value.execute.return_value.data = []
        with patch("app.api.onboarding.get_supabase_client", return_value=client):
            with self.assertRaises(HTTPException) as error:
                update_course_exam("missing", CourseExamUpdate(user_id="student", exam_date=date.today() + timedelta(days=1)))
        self.assertEqual(error.exception.status_code, 404)


if __name__ == "__main__":
    unittest.main()
