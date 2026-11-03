from datetime import date, timedelta
from collections import defaultdict
from typing import List, Dict, Optional


class ScheduleCapacityError(ValueError):
    """Raised when unfinished tasks cannot fit before their deadline."""


def _parse_date(d) -> date:
    if isinstance(d, date):
        return d
    return date.fromisoformat(str(d)[:10])


def _available_days(start: date, end_exclusive: date, disrupted: set) -> List[date]:
    """Return non-disrupted days in [start, end_exclusive)."""
    days = []
    d = start
    while d < end_exclusive:
        if d not in disrupted:
            days.append(d)
        d += timedelta(days=1)
    return days


def generate_schedule(
    tasks: List[Dict],
    exam_date: date,
    daily_study_hours: int,
    pomodoro_minutes: int,
    disruptions: List[Dict],
    start_date: date = None,
    sessions_per_day: int = None,
    session_duration_minutes: int = None,
    preserve_order: bool = False,
) -> List[Dict]:
    """
    Single-course scheduler. Assigns each task a scheduled_date and order_index.
    Leaves a 1-day buffer before the exam. Respects disruptions.
    """
    if start_date is None:
        start_date = date.today()

    disrupted_dates = _build_disrupted_set(disruptions)
    pomodoros_per_day = _calc_pomodoros_per_day(
        daily_study_hours, pomodoro_minutes, sessions_per_day, session_duration_minutes
    )

    exam_buffer = exam_date - timedelta(days=1)
    available = _available_days(start_date, exam_buffer, disrupted_dates)

    priority_order = {"high": 0, "medium": 1, "low": 2}
    sorted_tasks = tasks if preserve_order else sorted(
        tasks, key=lambda t: priority_order.get(t.get("priority", "medium"), 1)
    )

    return _pack_tasks(sorted_tasks, available, pomodoros_per_day)


def generate_schedule_multi_course(
    tasks_by_course: Dict[str, List[Dict]],   # course_id → tasks (each has _exam_date)
    course_map: Dict[str, Dict],               # course_id → course row
    daily_study_hours: int,
    pomodoro_minutes: int,
    disruptions: List[Dict],
    start_date: date = None,
    sessions_per_day: int = None,
    session_duration_minutes: int = None,
    tasks_per_day_override: Dict[str, int] = None,   # course_id → forced tasks/day
    interleave_courses: bool = True,
) -> List[Dict]:
    """
    Deadline-aware multi-course scheduler.

    For each course it:
    1. Computes available days until that course's exam.
    2. Calculates whether tasks fit; if not, auto-increases density.
    3. Schedules independently.

    interleave_courses=True (default):  each day mixes tasks from all courses,
    ordered by exam urgency (soonest exam first).

    interleave_courses=False: each day is dedicated to a single course,
    scheduling courses in exam-deadline order.
    """
    if start_date is None:
        start_date = date.today()

    disrupted_dates = _build_disrupted_set(disruptions)
    base_ppd = _calc_pomodoros_per_day(
        daily_study_hours, pomodoro_minutes, sessions_per_day, session_duration_minutes
    )

    sorted_courses = sorted(
        [cid for cid, tasks in tasks_by_course.items() if tasks],
        key=lambda cid: course_map.get(cid, {}).get("exam_date", "9999-99-99")
    )

    if not interleave_courses:
        # ── Non-interleave: dedicate each available day to one course ──────
        latest_buffer = max(
            (_parse_date(course_map[cid]["exam_date"]) - timedelta(days=1) for cid in sorted_courses),
            default=start_date,
        )
        all_available = _available_days(start_date, latest_buffer, disrupted_dates)
        remaining = {cid: list(tasks_by_course[cid]) for cid in sorted_courses}
        result = []

        for d in all_available:
            active_courses = [
                cid for cid in sorted_courses
                if remaining[cid]
                and d < _parse_date(course_map[cid]["exam_date"]) - timedelta(days=1)
            ]
            if not active_courses:
                continue

            cid = active_courses[0]

            ppd = tasks_per_day_override.get(cid, base_ppd) if tasks_per_day_override else base_ppd
            ppd = min(max(ppd, 1), 12)

            day_tasks = remaining[cid][:ppd]
            remaining[cid] = remaining[cid][ppd:]

            for order_idx, t in enumerate(day_tasks):
                t = dict(t)
                t["scheduled_date"] = d.isoformat()
                t["order_index"] = order_idx
                result.append(t)

        if any(remaining.values()):
            raise ScheduleCapacityError(
                "Some unfinished tasks cannot fit before their exam dates with the available study days."
            )

        return result

    # ── Interleave (default): mix courses each day sorted by urgency ────────
    day_slots: Dict[date, List] = defaultdict(list)

    for cid in sorted_courses:
        tasks = tasks_by_course[cid]
        if not tasks:
            continue

        exam_date = _parse_date(course_map[cid]["exam_date"])
        exam_buffer = exam_date - timedelta(days=1)
        available = _available_days(start_date, exam_buffer, disrupted_dates)

        # Respect the user's configured tasks/day as a hard cap.
        # tasks_per_day_override (from Claude directives) can raise it for tight courses.
        ppd = base_ppd
        if tasks_per_day_override and cid in tasks_per_day_override:
            ppd = tasks_per_day_override[cid]
        ppd = min(max(ppd, 1), 12)

        days_to_exam = (exam_date - start_date).days
        urgency = 1.0 / max(days_to_exam, 1)

        per_course = _pack_tasks(tasks, available, ppd)
        for t in per_course:
            d = _parse_date(t["scheduled_date"])
            day_slots[d].append((urgency, t))

    result = []
    for d in sorted(day_slots.keys()):
        slots = day_slots[d]
        slots.sort(key=lambda x: -x[0])
        for idx, (_, task) in enumerate(slots):
            task["order_index"] = idx
            result.append(task)

    return result


def course_capacity_report(
    tasks_by_course: Dict[str, List[Dict]],
    course_map: Dict[str, Dict],
    disruptions: List[Dict],
    start_date: date,
    base_ppd: int,
) -> List[Dict]:
    """
    Returns a per-course summary used to build the Claude prompt.
    Each entry: course_name, exam_date, days_remaining, available_study_days,
                task_count, capacity_at_base_ppd, tasks_per_day_needed, is_tight, is_overflowing
    """
    disrupted_dates = _build_disrupted_set(disruptions)
    report = []

    for cid, tasks in tasks_by_course.items():
        course = course_map.get(cid, {})
        exam_date = _parse_date(course["exam_date"])
        exam_buffer = exam_date - timedelta(days=1)
        available = _available_days(start_date, exam_buffer, disrupted_dates)
        n_days = len(available)
        capacity = n_days * base_ppd
        needed_ppd = (-(-len(tasks) // max(n_days, 1))) if n_days > 0 else len(tasks)
        days_remaining = (exam_date - start_date).days

        report.append({
            "course_id": cid,
            "course_name": course.get("title", cid),
            "exam_date": exam_date.isoformat(),
            "days_remaining": days_remaining,
            "available_study_days": n_days,
            "task_count": len(tasks),
            "capacity_at_base_ppd": capacity,
            "tasks_per_day_needed": needed_ppd,
            "is_tight": needed_ppd > base_ppd,
            "is_overflowing": needed_ppd > 12,
        })

    report.sort(key=lambda r: r["days_remaining"])
    return report


def reschedule_remaining(
    tasks: List[Dict],
    completed_task_ids: List[str],
    exam_date: date,
    daily_study_hours: int,
    pomodoro_minutes: int,
    disruptions: List[Dict],
) -> List[Dict]:
    """Redistribute every unfinished task starting tomorrow; preserve completed tasks."""
    today = date.today()
    completed_ids_set = set(completed_task_ids)

    completed_statuses = {"done", "completed"}
    remaining = [
        t for t in tasks
        if t["id"] not in completed_ids_set
        and t.get("status") not in completed_statuses
    ]

    if not remaining:
        return [dict(t) for t in tasks]

    rescheduled = generate_schedule(
        tasks=remaining,
        exam_date=exam_date,
        daily_study_hours=daily_study_hours,
        pomodoro_minutes=pomodoro_minutes,
        disruptions=disruptions,
        start_date=today + timedelta(days=1),
    )

    by_id = {task["id"]: task for task in rescheduled}
    return [by_id.get(task["id"], dict(task)) for task in tasks]


# ─── Internal helpers ────────────────────────────────────────

def _build_disrupted_set(disruptions: List[Dict]) -> set:
    disrupted = set()
    for d in disruptions:
        s = _parse_date(d["start_date"])
        e = _parse_date(d["end_date"])
        cur = s
        while cur <= e:
            disrupted.add(cur)
            cur += timedelta(days=1)
    return disrupted


def _calc_pomodoros_per_day(
    daily_study_hours: int,
    pomodoro_minutes: int,
    sessions_per_day: Optional[int],
    session_duration_minutes: Optional[int],
) -> int:
    if sessions_per_day and session_duration_minutes:
        tasks_per_session = max(1, session_duration_minutes // pomodoro_minutes)
        return sessions_per_day * tasks_per_session
    return max(1, (daily_study_hours * 60) // pomodoro_minutes)


def _pack_tasks(tasks: List[Dict], available_days: List[date], pomodoros_per_day: int) -> List[Dict]:
    """
    Assign scheduled_date + order_index sequentially into available_days.
    Raises instead of putting overflow tasks beyond the available deadline.
    """
    capacity = len(available_days) * pomodoros_per_day
    if tasks and (not available_days or len(tasks) > capacity):
        raise ScheduleCapacityError(
            f"Cannot schedule {len(tasks)} unfinished tasks: only {capacity} study slots are available before the deadline."
        )

    scheduled = []
    day_idx = 0
    slot_in_day = 0

    for task in tasks:
        current_day = available_days[day_idx]

        scheduled.append({
            **task,
            "scheduled_date": current_day.isoformat(),
            "order_index": slot_in_day,
        })

        slot_in_day += 1
        if slot_in_day >= pomodoros_per_day:
            slot_in_day = 0
            day_idx += 1

    return scheduled
