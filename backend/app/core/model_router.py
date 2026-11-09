"""Deterministic model selection for study tasks."""

import logging
import os
from numbers import Number
from typing import Any, Callable


logger = logging.getLogger(__name__)

FAST_MODEL_DEFAULT = "claude-haiku-4-5-20251001"
REASONING_MODEL_DEFAULT = "claude-sonnet-4-6"
PREMIUM_MODEL_DEFAULT = "claude-opus-4-6"
ROUTING_MODES = frozenset({"economy", "balanced", "quality"})

TASKS = frozenset(
    {
        "tutor_chat",
        "tutor_topics",
        "ocr",
        "flashcards",
        "syllabus",
        "schedule",
        "whiteboard",
        "question_generate",
        "question_extract",
        "question_grade",
    }
)

_ECONOMY_REASONING_TASKS = frozenset(
    {"whiteboard", "question_generate", "question_extract", "question_grade"}
)
_BALANCED_REASONING_TASKS = frozenset({"tutor_topics", "syllabus", "schedule"})


def _model_env(name: str, default: str) -> str:
    value = os.environ.get(name, default)
    if not value.strip():
        raise ValueError(f"{name} must not be empty")
    return value


def _boolean_env(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    normalized = value.strip().lower()
    if normalized not in {"true", "false"}:
        raise ValueError(f"{name} must be 'true' or 'false'")
    return normalized == "true"


def select_model(task: str, complex: bool = False) -> str:
    """Choose a configured model without making a classifier or API call."""
    if task not in TASKS:
        raise ValueError(f"Unknown model-routing task: {task!r}")

    mode = os.environ.get("AI_ROUTING_MODE", "economy")
    if mode not in ROUTING_MODES:
        choices = ", ".join(sorted(ROUTING_MODES))
        raise ValueError(f"Invalid AI_ROUTING_MODE {mode!r}; expected one of: {choices}")

    fast_model = _model_env("AI_FAST_MODEL", FAST_MODEL_DEFAULT)
    reasoning_model = _model_env("AI_REASONING_MODEL", REASONING_MODEL_DEFAULT)

    use_reasoning = mode == "quality"
    if mode != "quality":
        use_reasoning = (
            (task == "tutor_chat" and complex)
            or task in _ECONOMY_REASONING_TASKS
            or (mode == "balanced" and task in _BALANCED_REASONING_TASKS)
        )
    return reasoning_model if use_reasoning else fast_model


_USAGE_FIELDS = (
    "input_tokens",
    "output_tokens",
    "cache_creation_input_tokens",
    "cache_read_input_tokens",
)


def _log_usage(task: str, model: str, message: Any) -> None:
    usage = getattr(message, "usage", None)
    if usage is None:
        return

    fields = {}
    for name in _USAGE_FIELDS:
        value = usage.get(name) if isinstance(usage, dict) else getattr(usage, name, None)
        if isinstance(value, Number) and not isinstance(value, bool):
            fields[name] = value
    if fields:
        token_counts = " ".join(f"{name}={value}" for name, value in fields.items())
        logger.info(
            "Claude model usage task=%s model=%s %s",
            task,
            model,
            token_counts,
            extra={"task": task, "model": model, **fields},
        )


def create_message(client: Any, task: str, *, complex: bool = False, **kwargs: Any) -> Any:
    """Select a model and make exactly one messages.create call."""
    model = select_model(task, complex=complex)
    request = dict(kwargs)
    request["model"] = model
    message = client.messages.create(**request)
    _log_usage(task, model, message)
    return message


class QualityGateError(ValueError):
    """Raised when no attempted model response passes local validation."""


def create_validated_message(
    client: Any,
    task: str,
    *,
    validator: Callable[[Any], bool],
    complex: bool = False,
    **kwargs: Any,
) -> Any:
    """Try at most two configured models until a response passes validation."""
    primary = select_model(task, complex=complex)
    cascade_enabled = _boolean_env("AI_CASCADE_ENABLED", True)
    allow_opus = _boolean_env("AI_ALLOW_OPUS_ESCALATION", False)
    reasoning = _model_env("AI_REASONING_MODEL", REASONING_MODEL_DEFAULT)

    candidates = [primary]
    if cascade_enabled:
        if primary != reasoning:
            candidates.append(reasoning)
        elif allow_opus:
            candidates.append(_model_env("AI_PREMIUM_MODEL", PREMIUM_MODEL_DEFAULT))
    candidates = list(dict.fromkeys(candidates))[:2]

    for index, model in enumerate(candidates):
        if index:
            logger.info(
                "Model escalation model=%s reason=quality_gate_rejected",
                model,
                extra={"model": model, "reason": "quality_gate_rejected"},
            )
        request = dict(kwargs)
        request["model"] = model
        response = client.messages.create(**request)
        _log_usage(task, model, response)
        if validator(response):
            return response

    raise QualityGateError("No model response passed the quality gate.")
