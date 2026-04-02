from datetime import date, timedelta
from typing import List, Dict


def generate_schedule(
    tasks: List[Dict],
    exam_date: date,
    daily_study_hours: int,
    pomodoro_minutes: int,
    disruptions: List[Dict],  # [{start_date, end_date}]
    start_date: date = None,
) -> List[Dict]:
    """
    Assigns each task a scheduled_date and order_index.
    Respects disruption date ranges (zero capacity those days).
    Leaves a 1-day buffer before the exam for review.
    """
    if start_date is None:
        start_date = date.today()

    exam_buffer_date = exam_date - timedelta(days=1)

    disrupted_dates = set()
    for d in disruptions:
        s = _parse_date(d["start_date"])
        e = _parse_date(d["end_date"])
        cur = s
        while cur <= e:
            disrupted_dates.add(cur)
            cur += timedelta(days=1)

    pomodoros_per_day = max(1, (daily_study_hours * 60) // pomodoro_minutes)

    available_days = []
    d = start_date
    while d < exam_buffer_date:
        if d not in disrupted_dates:
            available_days.append(d)
        d += timedelta(days=1)

    priority_order = {"high": 0, "medium": 1, "low": 2}
    sorted_tasks = sorted(tasks, key=lambda t: priority_order.get(t.get("priority", "medium"), 1))

    scheduled = []
    day_idx = 0
    slot_in_day = 0

    for task in sorted_tasks:
        if day_idx >= len(available_days):
            day_idx = len(available_days) - 1

        scheduled.append({
            **task,
            "scheduled_date": available_days[day_idx].isoformat() if available_days else date.today().isoformat(),
            "order_index": slot_in_day,
        })

        slot_in_day += 1
        if slot_in_day >= pomodoros_per_day:
            slot_in_day = 0
            day_idx += 1

    return scheduled


def reschedule_remaining(
    tasks: List[Dict],
    completed_task_ids: List[str],
    exam_date: date,
    daily_study_hours: int,
    pomodoro_minutes: int,
    disruptions: List[Dict],
) -> List[Dict]:
    """
    Redistributes overdue/remaining tasks starting from tomorrow.
    Completed tasks are untouched.
    """
    today = date.today()
    completed_ids_set = set(completed_task_ids)

    done_tasks = [t for t in tasks if t["id"] in completed_ids_set or t["status"] == "done"]
    overdue = [
        t for t in tasks
        if t["id"] not in completed_ids_set
        and t["status"] != "done"
        and t.get("scheduled_date")
        and _parse_date(t["scheduled_date"]) <= today
    ]
    future_tasks = [
        t for t in tasks
        if t["id"] not in completed_ids_set
        and t["status"] != "done"
        and t.get("scheduled_date")
        and _parse_date(t["scheduled_date"]) > today
    ]

    if not overdue:
        return tasks

    rescheduled = generate_schedule(
        tasks=overdue,
        exam_date=exam_date,
        daily_study_hours=daily_study_hours,
        pomodoro_minutes=pomodoro_minutes,
        disruptions=disruptions,
        start_date=today + timedelta(days=1),
    )

    return done_tasks + rescheduled + future_tasks


def _parse_date(d) -> date:
    if isinstance(d, date):
        return d
    return date.fromisoformat(str(d)[:10])
