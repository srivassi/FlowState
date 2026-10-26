import unittest
from datetime import date
from unittest.mock import patch

from app.agent import scheduler


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
                tasks=[{"id": "one"}, {"id": "two"}],
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
            start_date=date(2026, 10, 26),
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


if __name__ == "__main__":
    unittest.main()
