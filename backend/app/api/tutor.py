from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import List, Optional, Dict
from datetime import datetime, timezone
from collections import defaultdict
import anthropic
import os
import io
import json
import re
from app.core.supabase import get_supabase_client

try:
    import pypdf
    HAS_PYPDF = True
except ImportError:
    HAS_PYPDF = False

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


def _fetch_pdf_text(pdf_url: str) -> str:
    """Download a PDF and extract its text."""
    if not HAS_PYPDF or not HAS_REQUESTS:
        return ""
    try:
        r = _requests.get(pdf_url, timeout=30)
        r.raise_for_status()
        reader = pypdf.PdfReader(io.BytesIO(r.content))
        pages = [reader.pages[i].extract_text() or "" for i in range(len(reader.pages))]
        return "\n\n".join(f"[Page {i+1}]\n{t}" for i, t in enumerate(pages))
    except Exception:
        return ""


def _has_enough_text(pdf_text: str, min_chars: int = 300) -> bool:
    """Check that there is real content beyond page markers."""
    stripped = re.sub(r'\[Page \d+\]', '', pdf_text).strip()
    return len(stripped) >= min_chars


def _extract_json(raw: str) -> dict:
    # Remove opening and closing code fences
    cleaned = re.sub(r'```(?:json)?\s*|\s*```', '', raw).strip()
    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, dict):
            return parsed
        if isinstance(parsed, list):
            return {"topics": parsed}
    except json.JSONDecodeError:
        pass
    # Fallback: find the outermost {...}
    m = re.search(r'\{[\s\S]*\}', cleaned)
    if m:
        try:
            parsed = json.loads(m.group(0))
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            pass
    # Fallback: find a top-level [...] array
    m2 = re.search(r'\[[\s\S]*\]', cleaned)
    if m2:
        try:
            parsed = json.loads(m2.group(0))
            if isinstance(parsed, list):
                return {"topics": parsed}
        except json.JSONDecodeError:
            pass
    return {}


# ─── Start: extract topics from PDF ──────────────────────────

@router.post("/start")
def start_gauntlet(body: StartRequest):
    supabase = get_supabase_client()

    # Return cached topics if the room already has them
    if body.room_id:
        try:
            cached = supabase.table("gauntlet_rooms").select("topics, pdf_text").eq("id", body.room_id).execute()
            if cached.data and cached.data[0].get("topics") and cached.data[0].get("pdf_text"):
                row = cached.data[0]
                return {"topics": row["topics"], "pdf_text": row["pdf_text"]}
        except Exception:
            pass

    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not set")

    pdf_text = _fetch_pdf_text(body.pdf_url)
    if not pdf_text.strip():
        raise HTTPException(status_code=400, detail="Could not extract text from this PDF. Make sure it is not a scanned image-only PDF.")
    if not _has_enough_text(pdf_text):
        raise HTTPException(status_code=400, detail="Not enough readable text in this PDF. It may be a scanned or image-based document.")

    client = anthropic.Anthropic(api_key=api_key)

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
        msg = client.messages.create(
            model="claude-sonnet-4-6",
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

@router.post("/chat")
def gauntlet_chat(body: ChatRequest):
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not set")

    client = anthropic.Anthropic(api_key=api_key)

    topic = body.topics[body.current_topic_index] if body.current_topic_index < len(body.topics) else None
    is_last_topic = body.current_topic_index >= len(body.topics) - 1

    system = f"""You are a Socratic tutor running a "Gauntlet" study session. Your role is to guide the student to understanding through conversation — never just quiz them.

FULL PDF CONTENT:
{body.pdf_text[:30000]}

ALL TOPICS IN THIS SESSION:
{json.dumps(body.topics, indent=2)}

CURRENT TOPIC ({body.current_topic_index + 1} of {len(body.topics)}):
{json.dumps(topic, indent=2) if topic else "Session complete"}

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

IMPORTANT: Only include the JSON line when genuinely moving on. Never include it mid-discussion."""

    messages = [*body.messages, {"role": "user", "content": body.user_message}]

    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        system=system,
        messages=messages,
    )

    raw_reply = response.content[0].text

    # Parse out any action directive
    action = None
    stars = None
    clean_reply = raw_reply

    action_match = re.search(r'\{"action":\s*"(next_topic|finish)",\s*"stars":\s*(\d)\}', raw_reply)
    if action_match:
        action = action_match.group(1)
        stars = int(action_match.group(2))
        clean_reply = raw_reply[:action_match.start()].strip()

    updated_messages = [
        *body.messages,
        {"role": "user", "content": body.user_message},
        {"role": "assistant", "content": clean_reply},
    ]

    return {
        "reply": clean_reply,
        "messages": updated_messages,
        "action": action,
        "stars": stars,
    }


# ─── Rooms ───────────────────────────────────────────────────

@router.get("/rooms")
def get_rooms(user_id: str = Query(...), course_id: Optional[str] = Query(None)):
    supabase = get_supabase_client()
    q = supabase.table("gauntlet_rooms").select("*").eq("user_id", user_id)
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
