import os
import unittest
from unittest.mock import MagicMock, call, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.tutor import ProgressSnapshot, router


def snapshot():
    return {
        "version": 1,
        "session_id": "session-123",
        "phase": "active",
        "current_topic_index": 0,
        "topic_states": [
            {
                "topic": {
                    "id": "topic-1",
                    "title": "Cells",
                    "summary": "Cell structure and function.",
                    "key_points": ["Membranes surround cells."],
                },
                "messages": [
                    {"role": "assistant", "content": "What is a cell?"},
                    {"role": "user", "content": "The basic unit of life."},
                ],
                "stars": 2,
            },
            {
                "topic": {"id": "topic-2", "title": "Tissues", "summary": "Cells form tissues."},
                "messages": [],
            },
        ],
        "pending_next": {"next_idx": 1, "stars": 2},
    }


class GauntletProgressTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {}, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)
        app = FastAPI()
        app.include_router(router)
        self.client = TestClient(app)

    def test_get_returns_null_for_legacy_room_and_filters_by_owner(self):
        db = MagicMock()
        db.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = [
            {"progress": None}
        ]
        with patch("app.api.tutor.get_supabase_client", return_value=db):
            response = self.client.get("/tutor/rooms/room-1/progress", params={"user_id": "owner-1"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"progress": None})
        db.table.assert_called_once_with("gauntlet_rooms")
        db.table.return_value.select.assert_called_once_with("progress")
        room_filter = db.table.return_value.select.return_value.eq
        room_filter.assert_called_once_with("id", "room-1")
        room_filter.return_value.eq.assert_called_once_with("user_id", "owner-1")

    def test_put_round_trips_snapshot_without_creating_session(self):
        db = MagicMock()
        db.table.return_value.update.return_value.eq.return_value.eq.return_value.select.return_value.execute.return_value.data = [
            {"id": "room-1"}
        ]
        payload = {"user_id": "owner-1", "progress": snapshot()}
        with patch("app.api.tutor.get_supabase_client", return_value=db):
            response = self.client.put("/tutor/rooms/room-1/progress", json=payload)

        self.assertEqual(response.status_code, 200)
        expected = ProgressSnapshot.model_validate(payload["progress"]).model_dump(mode="json")
        self.assertEqual(response.json(), {"progress": expected})
        db.table.assert_called_once_with("gauntlet_rooms")
        saved = db.table.return_value.update.call_args.args[0]
        self.assertEqual(saved["progress"], expected)
        self.assertIn("last_played_at", saved)
        room_filter = db.table.return_value.update.return_value.eq
        room_filter.assert_called_once_with("id", "room-1")
        room_filter.return_value.eq.assert_called_once_with("user_id", "owner-1")

    def test_missing_or_non_owned_room_is_not_found(self):
        db = MagicMock()
        db.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = []
        with patch("app.api.tutor.get_supabase_client", return_value=db):
            response = self.client.get("/tutor/rooms/room-1/progress", params={"user_id": "other"})
        self.assertEqual(response.status_code, 404)

        db = MagicMock()
        db.table.return_value.update.return_value.eq.return_value.eq.return_value.select.return_value.execute.return_value.data = []
        with patch("app.api.tutor.get_supabase_client", return_value=db):
            response = self.client.put(
                "/tutor/rooms/room-1/progress", json={"user_id": "other", "progress": snapshot()}
            )
        self.assertEqual(response.status_code, 404)

    def test_invalid_snapshots_are_rejected_before_database_access(self):
        bad = snapshot()
        bad["current_topic_index"] = 2
        bad_pending = snapshot()
        bad_pending["pending_next"]["next_idx"] = 2
        bad_role = snapshot()
        bad_role["topic_states"][0]["messages"][0]["role"] = "system"
        bad_stars = snapshot()
        bad_stars["topic_states"][0]["stars"] = True
        oversized = snapshot()
        oversized["topic_states"][0]["messages"] = [
            {"role": "user", "content": "x" * 20000} for _ in range(51)
        ]

        with patch("app.api.tutor.get_supabase_client") as db:
            for progress in (bad, bad_pending, bad_role, bad_stars, oversized):
                with self.subTest(progress=progress):
                    response = self.client.put(
                        "/tutor/rooms/room-1/progress",
                        json={"user_id": "owner-1", "progress": progress},
                    )
                    self.assertEqual(response.status_code, 422)
            db.assert_not_called()

    def test_put_does_not_touch_sessions_table(self):
        db = MagicMock()
        db.table.return_value.update.return_value.eq.return_value.eq.return_value.select.return_value.execute.return_value.data = [
            {"id": "room-1"}
        ]
        with patch("app.api.tutor.get_supabase_client", return_value=db):
            response = self.client.put(
                "/tutor/rooms/room-1/progress", json={"user_id": "owner-1", "progress": snapshot()}
            )
        self.assertEqual(response.status_code, 200)
        db.table.assert_called_once_with("gauntlet_rooms")

    def test_room_listing_selects_picker_fields_without_saved_payloads(self):
        room = {
            "id": "room-1",
            "user_id": "owner-1",
            "course_id": None,
            "pdf_url": "https://example.test/notes.pdf",
            "pdf_name": "notes.pdf",
            "last_played_at": "2026-11-09T12:00:00+00:00",
        }
        rooms_query = MagicMock()
        rooms_query.select.return_value = rooms_query
        rooms_query.eq.return_value = rooms_query
        rooms_query.order.return_value = rooms_query
        rooms_query.execute.return_value.data = [room]
        sessions_query = MagicMock()
        sessions_query.select.return_value = sessions_query
        sessions_query.in_.return_value = sessions_query
        sessions_query.execute.return_value.data = []
        db = MagicMock()
        db.table.side_effect = lambda name: rooms_query if name == "gauntlet_rooms" else sessions_query

        with patch("app.api.tutor.get_supabase_client", return_value=db):
            response = self.client.get("/tutor/rooms", params={"user_id": "owner-1"})

        self.assertEqual(response.status_code, 200)
        rooms_query.select.assert_called_once_with(
            "id, user_id, course_id, pdf_url, pdf_name, last_played_at"
        )
        self.assertNotIn("progress", response.json()[0])
        self.assertNotIn("pdf_text", response.json()[0])
        self.assertNotIn("topics", response.json()[0])


if __name__ == "__main__":
    unittest.main()
