from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, conint, constr, model_validator
from typing import List, Optional, Dict, Literal
from datetime import datetime, timezone
from collections import defaultdict
import anthropic
import os
import io
import json
import re
from app.core.supabase import get_supabase_client
from app.core.model_router import QualityGateError, create_message, create_validated_message

try:
    import pypdf
    HAS_PYPDF = True
except ImportError:
    HAS_PYPDF = False

try:
    import fitz as _fitz  # PyMuPDF
    HAS_FITZ = True
except ImportError:
    HAS_FITZ = False

try:
    import requests as _requests
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False

router = APIRouter(prefix="/tutor")


class StartRequest(BaseModel):
    pdf_url: str
    pdf_name: Optional[str] = None
    room_id: Optional[str] = None


class TopicResult(BaseModel):
    topics: List[Dict]
    pdf_text: str


class ChatRequest(BaseModel):
    pdf_text: str
    topics: List[Dict]
    current_topic_index: int
    messages: List[Dict[str, str]]
    user_message: str
    course_id: Optional[str] = None
    user_id: Optional[str] = None


class GauntletExamConfig(BaseModel):
    question_types: List[Literal["multiple_choice", "short_answer", "essay", "problem_solving", "oral"]] = Field(default_factory=list)
    duration_minutes: Optional[conint(strict=True, ge=1, le=600)] = None
    open_book: Optional[bool] = None
    guidance: constr(max_length=2000) = ""

    class Config:
        extra = "forbid"


class ExamConfigUpdate(BaseModel):
    user_id: str
    config: GauntletExamConfig


class RoomCreate(BaseModel):
    user_id: str
    course_id: Optional[str] = None
    pdf_url: str
    pdf_name: Optional[str] = None


class SessionSave(BaseModel):
    room_id: str
    user_id: str
    total_stars: int
    max_stars: int
    topic_results: List[Dict]  # [{title, stars}]


class ProgressTopic(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: constr(min_length=1, max_length=100)
    title: constr(min_length=1, max_length=500)
    summary: constr(max_length=5000)
    key_points: Optional[List[constr(max_length=20000)]] = Field(default=None, max_length=100)


class ProgressMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: Literal["user", "assistant"]
    content: constr(min_length=1, max_length=20000)


class ProgressTopicState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    topic: ProgressTopic
    messages: List[ProgressMessage] = Field(max_length=200)
    stars: Optional[conint(strict=True, ge=0, le=3)] = None


class PendingNext(BaseModel):
    model_config = ConfigDict(extra="forbid")

    next_idx: conint(strict=True, ge=-1, le=99)
    stars: conint(strict=True, ge=0, le=3)


class ProgressSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: Literal[1] = 1
    session_id: constr(min_length=1, max_length=100)
    phase: Literal["active", "finished"]
    current_topic_index: conint(strict=True, ge=0)
    topic_states: List[ProgressTopicState] = Field(min_length=1, max_length=100)
    pending_next: Optional[PendingNext] = None

    @model_validator(mode="after")
    def validate_progress_bounds(self):
        if self.current_topic_index >= len(self.topic_states):
            raise ValueError("current_topic_index must reference a topic state")
        if self.pending_next is not None and self.pending_next.next_idx >= len(self.topic_states):
            raise ValueError("pending_next.next_idx must reference a topic state or be -1")
        if len(self.model_dump_json().encode("utf-8")) > 1_000_000:
            raise ValueError("progress snapshot must be at most 1 MB")
        return self


class ProgressUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user_id: constr(min_length=1, max_length=200)
    progress: ProgressSnapshot


def _pdf_to_images_b64(content: bytes, dpi: int = 150) -> list:
    """Render each PDF page to a base64 PNG string using PyMuPDF."""
    import base64
    doc = _fitz.open(stream=content, filetype="pdf")
    zoom = dpi / 72
    mat = _fitz.Matrix(zoom, zoom)
    images = [
        base64.b64encode(page.get_pixmap(matrix=mat).tobytes("png")).decode()
        for page in doc
    ]
    doc.close()
    return images


def _vision_transcribe_pages(images_b64: list, api_key: str) -> str:
    """Send pages to Claude Haiku in batches of 5 and return transcribed text."""
    client = anthropic.Anthropic(api_key=api_key, max_retries=0)
    BATCH = 5
    parts = []
    for i in range(0, len(images_b64), BATCH):
        batch = images_b64[i:i + BATCH]
        start_page = i + 1
        content = []
        for j, b64 in enumerate(batch):
            content.append({"type": "text", "text": f"[Page {start_page + j}]"})
            content.append({"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": b64}})
        content.append({
            "type": "text",
            "text": (
                "Transcribe every word of handwritten text visible in these pages exactly as written. "
                "Preserve structure and layout. Label each page with [Page N]. "
                "Do not summarise — output the full raw text only."
            )
        })
        try:
            msg = create_message(
                client, "ocr",
                max_tokens=4096,
                messages=[{"role": "user", "content": content}],
            )
            parts.append(msg.content[0].text)
        except Exception:
            pass
    return "\n\n".join(parts)


def _fetch_pdf_text(pdf_url: str) -> str:
    """Download a PDF and extract its text. Tries text extraction first, falls back to Claude vision OCR."""
    if not HAS_REQUESTS:
        return ""
    try:
        r = _requests.get(pdf_url, timeout=30)
        r.raise_for_status()
        content = r.content
    except Exception:
        return ""

    # Attempt 1: pypdf text extraction
    if HAS_PYPDF:
        try:
            reader = pypdf.PdfReader(io.BytesIO(content))
            pages = [reader.pages[i].extract_text() or "" for i in range(len(reader.pages))]
            text = "\n\n".join(f"[Page {i+1}]\n{t}" for i, t in enumerate(pages))
            if _has_enough_text(text):
                return text
        except Exception:
            pass

    # Attempt 2: PyMuPDF text extraction (handles more encoding variants)
    if HAS_FITZ:
        try:
            doc = _fitz.open(stream=content, filetype="pdf")
            pages = [doc[i].get_text() or "" for i in range(len(doc))]
            doc.close()
            text = "\n\n".join(f"[Page {i+1}]\n{t}" for i, t in enumerate(pages))
            if _has_enough_text(text):
                return text
        except Exception:
            pass

    # Attempt 3: Claude vision OCR (for handwritten / image-only PDFs)
    if HAS_FITZ:
        api_key = os.getenv("ANTHROPIC_API_KEY")
        if api_key:
            try:
                images = _pdf_to_images_b64(content)
                text = _vision_transcribe_pages(images, api_key)
                if _has_enough_text(text):
                    return text
            except Exception:
                pass

    return ""


def _has_enough_text(pdf_text: str, min_chars: int = 300) -> bool:
    """Check that there is real content beyond page markers."""
    stripped = re.sub(r'\[Page \d+\]', '', pdf_text).strip()
    return len(stripped) >= min_chars


def _extract_json(raw: str) -> dict:
    cleaned = re.sub(r'```(?:json)?\s*|\s*```', '', raw).strip()

    def _try_parse(s: str):
        try:
            parsed = json.loads(s)
            if isinstance(parsed, dict):
                return parsed
            if isinstance(parsed, list):
                return {"topics": parsed}
        except Exception:
            pass
        return None

    # Direct parse
    result = _try_parse(cleaned)
    if result:
        return result

    # Outermost { ... }
    start = cleaned.find('{')
    end = cleaned.rfind('}')
    if start != -1 and end > start:
        result = _try_parse(cleaned[start:end + 1])
        if result:
            return result

    # Outermost [ ... ]
    start = cleaned.find('[')
    end = cleaned.rfind(']')
    if start != -1 and end > start:
        result = _try_parse(cleaned[start:end + 1])
        if result:
            return result

    return {}


# ─── Start: extract topics from PDF ──────────────────────────

@router.post("/start")
def start_gauntlet(body: StartRequest):
    supabase = get_supabase_client()

    # Return cached topics if the room already has them
    cached_pdf_text = None
    if body.room_id:
        import time
        for attempt in range(3):
            try:
                cached = supabase.table("gauntlet_rooms").select("topics, pdf_text").eq("id", body.room_id).execute()
                if cached.data:
                    row = cached.data[0]
                    if row.get("topics") and row.get("pdf_text"):
                        return {"topics": row["topics"], "pdf_text": row["pdf_text"]}
                    # pdf_text cached but topics not yet — use it to skip PDF download
                    if row.get("pdf_text"):
                        cached_pdf_text = row["pdf_text"]
                break
            except Exception:
                if attempt == 2:
                    raise HTTPException(status_code=503, detail="Could not load session data, please try again.")
                time.sleep(0.4 * (attempt + 1))

    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not set")

    pdf_text = cached_pdf_text or _fetch_pdf_text(body.pdf_url)
    if not pdf_text.strip():
        raise HTTPException(status_code=400, detail="Could not extract text from this PDF. Make sure it is not a scanned image-only PDF.")
    if not _has_enough_text(pdf_text):
        raise HTTPException(status_code=400, detail="Not enough readable text in this PDF. It may be a scanned or image-based document.")

    client = anthropic.Anthropic(api_key=api_key, max_retries=0)

    prompt = f"""You are analysing a lecture PDF to create a Gauntlet study session.

PDF CONTENT (may be truncated):
{pdf_text[:30000]}

Extract the key topics from this material. Each topic should be a coherent concept or section that can be taught and tested in 2-4 exchanges.

Return ONLY a valid JSON object with this exact structure, no other text:
{{
  "topics": [
    {{
      "id": "1",
      "title": "Topic title",
      "summary": "2-sentence summary of what this topic covers",
      "key_points": ["point 1", "point 2", "point 3"]
    }}
  ]
}}

Aim for 4-8 topics. If the PDF is short, fewer is fine."""

    try:
        msg = create_message(
            client, "tutor_topics",
            max_tokens=2000,
            messages=[{"role": "user", "content": prompt}],
        )
        result = _extract_json(msg.content[0].text)
        topics = result.get("topics", [])
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI topic extraction failed: {str(e)}")

    if not topics:
        raise HTTPException(status_code=500, detail="Could not extract topics from this PDF. The content may be too short or unclear.")

    truncated_text = pdf_text[:40000]

    # Cache topics and pdf_text in the room for future opens
    if body.room_id:
        try:
            supabase.table("gauntlet_rooms").update({
                "topics": topics,
                "pdf_text": truncated_text,
            }).eq("id", body.room_id).execute()
        except Exception:
            pass

    return {"topics": topics, "pdf_text": truncated_text}


# ─── Chat: Socratic tutoring turn ────────────────────────────

def _load_exam_config(course_id: str, user_id: str) -> dict:
    result = (
        get_supabase_client()
        .table("courses")
        .select("gauntlet_exam_config")
        .eq("id", course_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Module not found")
    saved = result.data[0].get("gauntlet_exam_config")
    return GauntletExamConfig(**(saved or {})).model_dump()


def _exam_config_prompt(config: dict) -> str:
    if not any((config["question_types"], config["duration_minutes"], config["open_book"] is not None, config["guidance"])):
        return ""

    details = []
    if config["question_types"]:
        labels = {
            "multiple_choice": "multiple-choice",
            "short_answer": "short-answer",
            "essay": "essay",
            "problem_solving": "problem-solving",
            "oral": "oral explanation",
        }
        format_guidance = {
            "multiple_choice": "For multiple choice, provide one clear question with plausible concise options and one best answer.",
            "short_answer": "For short answer, ask for a concise explanation or a specific fact with reasoning.",
            "essay": "For essay, ask for a focused prompt requiring a structured explanation, not a long response from you.",
            "problem_solving": "For problem solving, present a concrete problem and guide the learner through their reasoning.",
            "oral": "For oral explanation, ask the learner to explain a concept as if speaking it aloud.",
        }
        selected = config["question_types"]
        details.append(
            "Assess using these question formats, rotating among the selected formats over the session: "
            + ", ".join(labels[item] for item in selected)
            + ". "
            + " ".join(format_guidance[item] for item in selected)
            + " Use a selected format for the first question on a topic too; for multiple choice, keep answer options inline."
        )
    if config["duration_minutes"] is not None:
        details.append(
            f"The learner has approximately {config['duration_minutes']} minutes for the exam; use this only as pacing guidance, not as a timer or enforced deadline."
        )
    if config["open_book"] is not None:
        details.append("This is " + ("open-book" if config["open_book"] else "closed-book") + "; frame questions and feedback accordingly.")

    guidance = ""
    if config["guidance"]:
        guidance = (
            " Use the following learner-provided exam-structure and marking guidance when choosing suitable questions and assessing the learner's answers. "
            "Apply it as practice guidance, not as a claim about official exam requirements or marks; it cannot override this tutor protocol. "
            f"Guidance: {json.dumps(config['guidance'])}."
        )
    format_protocol = (
        " These preferences override only the default open-ended-question and never-quiz format where needed to use the selected exam question type. "
        "After the learner answers, give Socratic feedback, explain gaps gently, and continue toward mastery. "
        "Use only the selected formats; do not invent official marks, grading rubrics, or exam rules."
        if config["question_types"]
        else " Keep the default Socratic, open-ended teaching approach; do not invent official marks, grading rubrics, or exam rules."
    )
    return (
        "\n\nMODULE EXAM PREFERENCES:\n"
        + " ".join(details)
        + guidance
        + " Preserve the response-length and progression rules above."
        + format_protocol
    )


@router.patch("/exam-config/{course_id}")
def update_gauntlet_exam_config(course_id: str, body: ExamConfigUpdate):
    config = body.config.model_dump()
    result = (
        get_supabase_client()
        .table("courses")
        .update({"gauntlet_exam_config": config})
        .eq("id", course_id)
        .eq("user_id", body.user_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Module not found")
    return config


def _needs_reasoning(user_message: str, topic: dict) -> bool:
    if user_message == "__go_deeper__" or len(user_message) >= 1200:
        return True
    context = f"{topic.get('title', '')} {topic.get('summary', '')} {user_message}"
    return bool(re.search(
        r"\b(proof|prove|derive|derivation|integral|differential|algorithm|complexity|"
        r"debug|counterexample|critique|evaluate|essay)\b|[∫∑√]",
        context, re.IGNORECASE,
    ))


def _checked_tutor_reply(response, body: ChatRequest):
    if getattr(response, "stop_reason", None) in {"max_tokens", "refusal", "tool_use"}:
        raise ValueError("Incomplete tutor response")
    blocks = getattr(response, "content", [])
    if not blocks or not isinstance(getattr(blocks[0], "text", None), str):
        raise ValueError("Missing tutor text")
    raw = blocks[0].text.strip()
    if not raw:
        raise ValueError("Empty tutor response")
    action_match = re.search(r'\{\s*"action"', raw)
    if not action_match:
        return raw, None, None
    explanation = raw[:action_match.start()].strip()
    directive = json.loads(raw[action_match.start():])
    action = directive.get("action")
    stars = directive.get("stars")
    if (
        not explanation
        or action not in {"next_topic", "finish"}
        or type(stars) is not int
        or not 1 <= stars <= 3
        or body.user_message == "__start__"
        or (action == "finish") != (body.current_topic_index == len(body.topics) - 1)
    ):
        raise ValueError("Invalid tutor progression")
    return explanation, action, stars


def _passes_tutor_gate(response, body: ChatRequest) -> bool:
    try:
        _checked_tutor_reply(response, body)
        return True
    except (ValueError, TypeError, AttributeError):
        return False


@router.post("/chat")
def gauntlet_chat(body: ChatRequest):
    exam_config = None
    if body.course_id is not None:
        if not body.user_id:
            raise HTTPException(status_code=400, detail="user_id is required when course_id is provided")
        exam_config = _load_exam_config(body.course_id, body.user_id)

    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not set")

    client = anthropic.Anthropic(api_key=api_key, max_retries=0)

    if not 0 <= body.current_topic_index < len(body.topics):
        raise HTTPException(status_code=400, detail="Choose a valid topic")
    topic = body.topics[body.current_topic_index]

    system = f"""You are a Socratic tutor running a "Gauntlet" study session. Your role is to guide the student to understanding through conversation — never just quiz them.

FULL PDF CONTENT:
{body.pdf_text[:30000]}

ALL TOPICS IN THIS SESSION:
{json.dumps(body.topics, indent=2)}

HOW TO TEACH:
- If this is the first message on a topic, give a 1-2 sentence framing of why this topic matters, then ask ONE open question to get them thinking. Do NOT list facts or lecture.
- When the student responds — even partially or incorrectly — do NOT just say "correct/incorrect". Instead:
  - If they're on the right track: affirm the specific thing they got right, then ask a follow-up that pushes one level deeper ("good — so what does that mean for X?")
  - If they're partially right: echo back what they said, gently highlight the gap, and ask a question that nudges them toward filling it ("you've got the what — what about the why?")
  - If they're wrong or stuck: don't give the answer. Ask a simpler bridging question that helps them reason toward it. Use analogies if helpful.
- Think of each exchange as one step in a journey toward mastery — not a pass/fail test. Keep building on what they said.
- Max 3 sentences per response. No bullet lists. Conversational tone.
- Only move on when the student has demonstrated they genuinely understand the concept — not just parroted it back.

STARS SYSTEM (include in your response when wrapping up a topic):
- ⭐⭐⭐ Nailed it — arrived at deep understanding through the discussion
- ⭐⭐ Good — core idea solid, some nuance missing
- ⭐ Getting there — surface-level understanding, needs more work

MOVING ON:
When you are satisfied the student understands the topic, end your message with exactly this JSON on its own line:
{{"action": "next_topic", "stars": 3}}
(stars can be 1, 2, or 3)

If this is the last topic and they've finished it, use:
{{"action": "finish", "stars": 3}}

Otherwise respond normally with no JSON.

IMPORTANT: Only include the JSON line when genuinely moving on. Never include it mid-discussion.
Never award stars on the initial __start__ turn before the student has answered. Use finish only on the last topic, and next_topic only on earlier topics.
If you cannot give a reliable response grounded in the notes because the reasoning exceeds your capability, output exactly {{"action": "escalate"}} instead of guessing. Do not use this for an incorrect student answer: use a bridging question instead. This is an internal routing signal, not a message to the student."""

    if exam_config is not None:
        system += _exam_config_prompt(exam_config)

    user_msg = body.user_message
    if user_msg == '__go_deeper__':
        user_msg = (
            "[The student chose to go deeper on this topic. Based on everything said so far, "
            "probe them on specific mechanisms, edge cases, or nuances they haven't fully addressed. "
            "Do NOT restart or re-introduce the topic — continue naturally from the conversation above. "
            "Pick the most interesting gap in their understanding and ask a targeted question about it.]"
        )

    messages = [*body.messages, {"role": "user", "content": user_msg}]
    stable_block = {"type": "text", "text": system}
    if os.getenv("AI_PROMPT_CACHING", "true").lower() == "true":
        stable_block["cache_control"] = {"type": "ephemeral"}
    system_blocks = [stable_block, {
        "type": "text",
        "text": f"CURRENT TOPIC ({body.current_topic_index + 1} of {len(body.topics)}):\n{json.dumps(topic, indent=2)}",
    }]

    try:
        response = create_validated_message(
            client, "tutor_chat", complex=_needs_reasoning(body.user_message, topic),
            validator=lambda candidate: _passes_tutor_gate(candidate, body),
            max_tokens=1024,
            system=system_blocks,
            messages=messages,
        )
    except QualityGateError as exc:
        raise HTTPException(
            status_code=502,
            detail="The tutor could not produce a valid response within the model-attempt limit. Your progress has not advanced.",
        ) from exc

    clean_reply, action, stars = _checked_tutor_reply(response, body)

    updated_messages = [
        *body.messages,
        {"role": "user", "content": user_msg},
        {"role": "assistant", "content": clean_reply},
    ]

    return {
        "reply": clean_reply,
        "messages": updated_messages,
        "action": action,
        "stars": stars,
    }


# ─── Rooms ───────────────────────────────────────────────────

@router.get("/rooms/{room_id}/progress")
def get_room_progress(room_id: str, user_id: str = Query(...)):
    result = (
        get_supabase_client()
        .table("gauntlet_rooms")
        .select("progress")
        .eq("id", room_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Room not found")
    return {"progress": result.data[0].get("progress")}


@router.put("/rooms/{room_id}/progress")
def update_room_progress(room_id: str, body: ProgressUpdate):
    now = datetime.now(timezone.utc).isoformat()
    result = (
        get_supabase_client()
        .table("gauntlet_rooms")
        .update({"progress": body.progress.model_dump(mode="json"), "last_played_at": now})
        .eq("id", room_id)
        .eq("user_id", body.user_id)
        .select("id")
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Room not found")
    return {"progress": body.progress.model_dump(mode="json")}


@router.get("/rooms")
def get_rooms(user_id: str = Query(...), course_id: Optional[str] = Query(None)):
    supabase = get_supabase_client()
    q = supabase.table("gauntlet_rooms").select(
        "id, user_id, course_id, pdf_url, pdf_name, last_played_at"
    ).eq("user_id", user_id)
    if course_id:
        q = q.eq("course_id", course_id)
    rooms = q.order("last_played_at", desc=True).execute().data or []

    if not rooms:
        return []

    room_ids = [r["id"] for r in rooms]
    sessions = (
        supabase.table("gauntlet_sessions")
        .select("room_id, total_stars, max_stars, completed_at")
        .in_("room_id", room_ids)
        .execute()
        .data or []
    )

    sess_map: dict = defaultdict(list)
    for s in sessions:
        sess_map[s["room_id"]].append(s)

    for room in rooms:
        sess = sess_map[room["id"]]
        room["session_count"] = len(sess)
        room["best_stars"] = max((s["total_stars"] for s in sess), default=None)
        room["best_max_stars"] = next(
            (s["max_stars"] for s in sess if s["total_stars"] == room["best_stars"]), None
        ) if sess else None

    return rooms


@router.post("/rooms")
def upsert_room(body: RoomCreate):
    supabase = get_supabase_client()
    existing = (
        supabase.table("gauntlet_rooms")
        .select("*")
        .eq("user_id", body.user_id)
        .eq("pdf_url", body.pdf_url)
        .execute()
    )
    if existing.data:
        return existing.data[0]
    result = supabase.table("gauntlet_rooms").insert({
        "user_id": body.user_id,
        "course_id": body.course_id,
        "pdf_url": body.pdf_url,
        "pdf_name": body.pdf_name,
    }).execute()
    if not result.data:
        raise HTTPException(status_code=400, detail="Failed to create room")
    return result.data[0]


@router.post("/sessions")
def save_session(body: SessionSave):
    supabase = get_supabase_client()
    result = supabase.table("gauntlet_sessions").insert({
        "room_id": body.room_id,
        "user_id": body.user_id,
        "total_stars": body.total_stars,
        "max_stars": body.max_stars,
        "topic_results": body.topic_results,
    }).execute()
    now = datetime.now(timezone.utc).isoformat()
    supabase.table("gauntlet_rooms").update({"last_played_at": now}).eq("id", body.room_id).execute()
    return result.data[0] if result.data else {}
