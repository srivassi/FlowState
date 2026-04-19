from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Dict
import anthropic
import os
import io
import json
import re

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


class TopicResult(BaseModel):
    topics: List[Dict]   # [{id, title, summary}]
    pdf_text: str        # truncated, passed back so frontend doesn't re-fetch


class ChatRequest(BaseModel):
    pdf_text: str
    topics: List[Dict]
    current_topic_index: int
    messages: List[Dict[str, str]]   # [{role, content}]
    user_message: str
    # Returned by the model to signal state changes:
    # action can be: "answer" | "next_topic" | "finish"


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
            messages=[
                {"role": "user", "content": prompt},
                {"role": "assistant", "content": "{"},
            ],
        )
        result = _extract_json("{" + msg.content[0].text)
        topics = result.get("topics", [])
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI topic extraction failed: {str(e)}")

    if not topics:
        raise HTTPException(status_code=500, detail="Could not extract topics from this PDF. The content may be too short or unclear.")

    return {"topics": topics, "pdf_text": pdf_text[:40000]}


# ─── Chat: Socratic tutoring turn ────────────────────────────

@router.post("/chat")
def gauntlet_chat(body: ChatRequest):
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not set")

    client = anthropic.Anthropic(api_key=api_key)

    topic = body.topics[body.current_topic_index] if body.current_topic_index < len(body.topics) else None
    is_last_topic = body.current_topic_index >= len(body.topics) - 1

    system = f"""You are a Socratic tutor running a "Gauntlet" study session. Your job is to teach through dialogue — not lecture.

FULL PDF CONTENT:
{body.pdf_text[:30000]}

ALL TOPICS IN THIS SESSION:
{json.dumps(body.topics, indent=2)}

CURRENT TOPIC ({body.current_topic_index + 1} of {len(body.topics)}):
{json.dumps(topic, indent=2) if topic else "Session complete"}

YOUR BEHAVIOUR:
- If this is the first message on a topic (no prior messages), briefly introduce the topic (2-3 sentences) then ask ONE focused question to probe understanding. Do NOT ask multiple questions at once.
- When the student responds: evaluate their answer, give encouraging feedback, correct misconceptions gently, then either:
  a) Ask a follow-up to go deeper if their answer was shallow
  b) Award stars and move on if they demonstrated solid understanding
- Keep responses concise — this is a dialogue, not a lecture. Max 4 sentences per turn.
- Be warm and encouraging. This is a study game, not an exam.

STARS SYSTEM (include in your response when wrapping up a topic):
- ⭐⭐⭐ Nailed it — deep understanding shown
- ⭐⭐ Good — core idea correct, some gaps
- ⭐ Getting there — needs more work

MOVING ON:
When you decide the student has engaged enough with the current topic, end your message with exactly this JSON on its own line:
{{"action": "next_topic", "stars": 3}}
(stars can be 1, 2, or 3)

If this is the last topic and they've finished it, use:
{{"action": "finish", "stars": 3}}

Otherwise just respond normally with no JSON.

IMPORTANT: Only include the JSON line when you are actually moving to the next topic or finishing. Never include it mid-conversation."""

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
