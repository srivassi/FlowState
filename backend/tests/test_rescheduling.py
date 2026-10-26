import unittest
from datetime import date, timedelta
from unittest.mock import MagicMock, patch

from fastapi import HTTPException

from app.agent import scheduler
from app.api.study import (
    FullRescheduleRequest,
    _apply_directives,
    _load_reschedule_context,
    full_reschedule,
)


class FixedDate(date):
    @classmethod
    def today(cls):
        return cls(2026, 10, 26)


class ReschedulingTests(unittest.TestCase):
    def test_reschedules_all_unfinished_tasks_around_disruptions(self):
        tasks = [
            {"id": "overdue", "scheduled_date": "2026-10-20", "status": "todo"},
            {"id": "future", "scheduled_date": "2026-11-02", "status": "todo"},
            {"id": "completed", "scheduled_date": "2026-10-21", "status": "done"},
            {"id": "completed_by_id", "scheduled_date": "2026-10-22", "status": "todo"},
        ]

        with patch.object(scheduler, "date", FixedDate):
            updated = scheduler.reschedule_remaining(
                tasks=tasks,
                completed_task_ids=["completed_by_id"],
                exam_date=date(2026, 12, 19),
                daily_study_hours=1,
                pomodoro_minutes=25,
                disruptions=[{"start_date": "2026-10-27", "end_date": "2026-10-28"}],
            )

        by_id = {task["id"]: task for task in updated}
        self.assertEqual(by_id["overdue"]["scheduled_date"], "2026-10-29")
        self.assertEqual(by_id["future"]["scheduled_date"], "2026-10-29")
        self.assertEqual(by_id["completed"]["scheduled_date"], "2026-10-21")
        self.assertEqual(by_id["completed_by_id"]["scheduled_date"], "2026-10-22")
        for task_id in ("overdue", "future"):
            scheduled = date.fromisoformat(by_id[task_id]["scheduled_date"])
            self.assertGreater(scheduled, FixedDate.today())
            self.assertLess(scheduled, date(2026, 12, 18))
            self.assertNotIn(scheduled, {date(2026, 10, 27), date(2026, 10, 28)})

    def test_expired_exam_fails_without_returning_backdated_schedule(self):
        with patch.object(scheduler, "date", FixedDate):
            with self.assertRaises(scheduler.ScheduleCapacityError):
                scheduler.reschedule_remaining(
                    tasks=[{"id": "task", "scheduled_date": "2026-10-20", "status": "todo"}],
                    completed_task_ids=[],
                    exam_date=date(2026, 10, 24),
                    daily_study_hours=4,
                    pomodoro_minutes=25,
                    disruptions=[],
                )

    def test_capacity_shortfall_raises_instead_of_scheduling_past_deadline(self):
        with self.assertRaises(scheduler.ScheduleCapacityError):
            scheduler.generate_schedule(
                tasks=[{"id": "one"}, {"id": "two"}, {"id": "three"}],
                exam_date=date(2026, 10, 29),
                daily_study_hours=1,
                pomodoro_minutes=25,
                disruptions=[],
                start_date=date(2026, 10, 27),
            )

    def test_multi_course_noninterleaved_schedule_respects_each_deadline(self):
        scheduled = scheduler.generate_schedule_multi_course(
            tasks_by_course={"early": [{"id": "early-task"}], "late": [{"id": "late-task"}]},
            course_map={"early": {"exam_date": "2026-11-02"}, "late": {"exam_date": "2026-11-05"}},
            daily_study_hours=1,
            pomodoro_minutes=25,
            disruptions=[{"start_date": "2026-10-27", "end_date": "2026-10-27"}],
            start_date=date(2026, 10, 27),
            interleave_courses=False,
        )

        dates_by_id = {task["id"]: date.fromisoformat(task["scheduled_date"]) for task in scheduled}
        self.assertEqual(dates_by_id["early-task"], date(2026, 10, 28))
        self.assertLess(dates_by_id["early-task"], date(2026, 11, 1))
        self.assertLess(dates_by_id["late-task"], date(2026, 11, 4))
        self.assertNotEqual(dates_by_id["late-task"], date(2026, 10, 27))

    def test_multi_course_fails_when_deadline_capacity_is_exhausted(self):
        with self.assertRaises(scheduler.ScheduleCapacityError):
            scheduler.generate_schedule_multi_course(
                tasks_by_course={"course": [{"id": "one"}, {"id": "two"}, {"id": "three"}]},
                course_map={"course": {"exam_date": "2026-10-29"}},
                daily_study_hours=1,
                pomodoro_minutes=25,
                disruptions=[],
                start_date=date(2026, 10, 27),
                interleave_courses=False,
            )

    def test_noninterleaved_prioritizes_earlier_deadline_when_capacity_is_tight(self):
        early_tasks = [{"id": f"early-{i}"} for i in range(4)]
        late_tasks = [{"id": f"late-{i}"} for i in range(3)]
        scheduled = scheduler.generate_schedule_multi_course(
            tasks_by_course={"early": early_tasks, "late": late_tasks},
            course_map={"early": {"exam_date": "2026-11-02"}, "late": {"exam_date": "2026-11-04"}},
            daily_study_hours=0,
            pomodoro_minutes=25,
            disruptions=[],
            start_date=date(2026, 10, 26),
            interleave_courses=False,
        )

        dates_by_id = {task["id"]: date.fromisoformat(task["scheduled_date"]) for task in scheduled}
        self.assertTrue(all(dates_by_id[f"early-{i}"] <= date(2026, 10, 30) for i in range(4)))
        self.assertTrue(all(dates_by_id[f"late-{i}"] <= date(2026, 11, 2) for i in range(3)))

    def test_backdated_start_date_directive_is_rejected(self):
        today = date.today()
        ctx = {"today": today, "course_map": {}, "tasks_by_course": {}, "base_ppd": 1}

        with self.assertRaises(HTTPException) as error:
            _apply_directives({"start_date": (today - timedelta(days=1)).isoformat()}, ctx)

        self.assertEqual(error.exception.status_code, 400)

    def test_full_reschedule_reports_missing_exam_date_tasks_and_does_not_write(self):
        supabase = MagicMock()
        ctx = {
            "supabase": supabase,
            "tasks_by_course": {},
            "missing_exam_date_courses": [{"course_name": "Biology", "task_count": 2}],
        }

        with patch("app.api.study._load_reschedule_context", return_value=ctx):
            with self.assertRaises(HTTPException) as error:
                full_reschedule(FullRescheduleRequest(user_id="student"))

        self.assertEqual(error.exception.status_code, 400)
        self.assertIn("2 unfinished task(s)", error.exception.detail)
        self.assertIn("Biology", error.exception.detail)
        supabase.table.assert_not_called()

    def test_context_counts_unfinished_tasks_for_modules_without_exam_dates(self):
        supabase = MagicMock()
        disruptions = MagicMock()
        disruptions.select.return_value.eq.return_value.execute.return_value.data = []
        profiles = MagicMock()
        profiles.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = []
        courses = MagicMock()
        courses.select.return_value.eq.return_value.execute.return_value.data = [
            {"id": "course", "title": "Biology", "exam_date": None}
        ]
        tasks = MagicMock()
        tasks.select.return_value.eq.return_value.execute.return_value.data = [
            {"id": "task", "status": "todo"},
            {"id": "done", "status": "done"},
        ]
        supabase.table.side_effect = {
            "disruptions": disruptions,
            "user_profiles": profiles,
            "courses": courses,
            "tasks": tasks,
        }.__getitem__

        with patch("app.api.study.get_supabase_client", return_value=supabase):
            ctx = _load_reschedule_context("student")

        self.assertEqual(ctx["missing_exam_date_courses"], [{"course_name": "Biology", "task_count": 1}])
        self.assertEqual(dict(ctx["tasks_by_course"]), {})

    def test_full_reschedule_capacity_error_is_400_without_writes(self):
        today = date.today()
        supabase = MagicMock()
        ctx = {
            "supabase": supabase,
            "today": today,
            "disruptions": [],
            "daily_hours": 1,
            "pomodoro_minutes": 25,
            "sessions_per_day": None,
            "session_duration_minutes": None,
            "course_map": {"course": {"title": "Biology", "exam_date": (today + timedelta(days=1)).isoformat()}},
            "tasks_by_course": {"course": [{"id": "unfinished", "title": "Read chapter"}]},
            "missing_exam_date_courses": [],
            "base_ppd": 2,
        }

        with patch("app.api.study._load_reschedule_context", return_value=ctx):
            with self.assertRaises(HTTPException) as error:
                full_reschedule(FullRescheduleRequest(
                    user_id="student",
                    directives={"start_date": today.isoformat()},
                ))

        self.assertEqual(error.exception.status_code, 400)
        supabase.table.assert_not_called()

    def test_full_reschedule_reports_scheduled_and_merged_task_counts(self):
        today = date.today()
        supabase = MagicMock()
        ctx = {
            "supabase": supabase,
            "today": today,
            "disruptions": [],
            "daily_hours": 1,
            "pomodoro_minutes": 25,
            "sessions_per_day": None,
            "session_duration_minutes": None,
            "course_map": {"course": {"title": "Biology", "exam_date": (today + timedelta(days=10)).isoformat()}},
            "tasks_by_course": {"course": [{"id": "kept", "title": "Read"}, {"id": "merged", "title": "Review"}]},
            "missing_exam_date_courses": [],
            "base_ppd": 2,
        }
        scheduled = [{
            "id": "kept",
            "title": "Read and review",
            "estimated_minutes": 40,
            "_merged_from": ["merged"],
            "scheduled_date": (today + timedelta(days=1)).isoformat(),
        }]

        with patch("app.api.study._load_reschedule_context", return_value=ctx), patch(
            "app.api.study.generate_schedule_multi_course", return_value=scheduled
        ):
            result = full_reschedule(FullRescheduleRequest(
                user_id="student",
                directives={"start_date": today.isoformat()},
            ))

        self.assertEqual(result, {"updated": 1, "scheduled_count": 1, "merged_task_count": 1})


if __name__ == "__main__":
    unittest.main()
