from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from app.core.model_router import create_message
from app.core.supabase import get_supabase_client
from pydantic import BaseModel, Field, field_validator
from typing import List, Optional
import anthropic
import os
import io
import json
import re
import ipaddress
import unicodedata
from urllib.parse import unquote, urlsplit
import requests

try:
    import pypdf
    HAS_PYPDF = True
except ImportError:
    HAS_PYPDF = False

try:
    import fitz
    HAS_FITZ = True
except ImportError:
    HAS_FITZ = False

router = APIRouter(prefix="/flashcards")


# ─── Models ──────────────────────────────────────────────────

class FlashcardCreate(BaseModel):
    set_id: str
    question: str
    answer: str
    order_index: int = 0


class FlashcardUpdate(BaseModel):
    question: Optional[str] = None
    answer: Optional[str] = None
    status: Optional[str] = None   # 'new' | 'review' | 'mastered'


class SetCreate(BaseModel):
    user_id: str
    course_id: Optional[str] = None
    title: str


class GenerateFromUrlRequest(BaseModel):
    pdf_url: str = Field(min_length=1, max_length=4096)
    user_id: str = Field(min_length=1, max_length=256)
    course_id: str = Field(min_length=1, max_length=256)
    title: str = Field(min_length=1, max_length=500)
    instructions: str = Field(default="", max_length=10000)

    @field_validator("pdf_url", "user_id", "course_id", mode="before")
    @classmethod
    def validate_url_and_ids(cls, value):
        if not isinstance(value, str):
            return value
        if any(unicodedata.category(char) == "Cc" for char in value):
            raise ValueError("control characters are not allowed")
        return value.strip()

    @field_validator("title", "instructions", mode="before")
    @classmethod
    def validate_title_and_instructions(cls, value):
        if not isinstance(value, str):
            return value
        if any(
            unicodedata.category(char) == "Cc" and char not in "\t\n\r"
            for char in value
        ):
            raise ValueError("unsupported control characters are not allowed")
        return value.strip()

    @field_validator("pdf_url")
    @classmethod
    def validate_pdf_url_text(cls, value):
        if any(char.isspace() for char in value):
            raise ValueError("URL must not contain whitespace")
        return value

    @field_validator("user_id", "course_id", "title")
    @classmethod
    def require_nonblank_values(cls, value):
        if not value:
            raise ValueError("must not be empty")
        return value


# ─── Sets ────────────────────────────────────────────────────

@router.get("/sets/{course_id}")
def get_sets(course_id: str, user_id: str):
    supabase = get_supabase_client()
    result = (
        supabase.table("flashcard_sets")
        .select("*")
        .eq("course_id", course_id)
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .execute()
    )
    return result.data or []


@router.post("/sets")
def create_set(body: SetCreate):
    supabase = get_supabase_client()
    result = (
        supabase.table("flashcard_sets")
        .insert({
            "user_id": body.user_id,
            "course_id": body.course_id,
            "title": body.title,
        })
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=400, detail="Failed to create set")
    return result.data[0]


@router.delete("/sets/{set_id}")
def delete_set(set_id: str):
    supabase = get_supabase_client()
    supabase.table("flashcard_sets").delete().eq("id", set_id).execute()
    return {"ok": True}


# ─── Cards ───────────────────────────────────────────────────

@router.get("/{set_id}")
def get_cards(set_id: str):
    supabase = get_supabase_client()
    result = (
        supabase.table("flashcards")
        .select("*")
        .eq("set_id", set_id)
        .order("order_index")
        .execute()
    )
    return result.data or []


@router.post("/cards")
def add_card(body: FlashcardCreate):
    supabase = get_supabase_client()
    result = (
        supabase.table("flashcards")
        .insert({
            "set_id": body.set_id,
            "question": body.question,
            "answer": body.answer,
            "order_index": body.order_index,
            "status": "new",
        })
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=400, detail="Failed to create card")
    return result.data[0]


@router.patch("/cards/{card_id}")
def update_card(card_id: str, body: FlashcardUpdate):
    supabase = get_supabase_client()
    updates = {k: v for k, v in body.dict().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    result = supabase.table("flashcards").update(updates).eq("id", card_id).execute()
    return result.data[0] if result.data else {}


@router.delete("/cards/{card_id}")
def delete_card(card_id: str):
    supabase = get_supabase_client()
    supabase.table("flashcards").delete().eq("id", card_id).execute()
    return {"ok": True}


# ─── PDF → Flashcard generation ──────────────────────────────

@router.post("/generate")
def generate_flashcards(
    file: UploadFile = File(...),
    user_id: str = Form(...),
    course_id: str = Form(...),
    title: str = Form(...),
    instructions: str = Form(default=''),
):
    """Upload a PDF and generate flashcards from it using Claude."""
    return _generate_flashcards_from_pdf(
        file.file.read(), user_id=user_id, course_id=course_id, title=title, instructions=instructions
    )


MAX_PDF_BYTES = 20 * 1024 * 1024


def _is_loopback_host(host: str) -> bool:
    if host.lower() == "localhost" or host.lower().endswith(".localhost"):
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _validate_whiteboard_pdf_url(pdf_url: str, user_id: str, course_id: str) -> None:
    configured_url = os.getenv("SUPABASE_URL", "")
    try:
        configured = urlsplit(configured_url)
        target = urlsplit(pdf_url)
        configured_port = configured.port
        target_port = target.port
        configured_host = configured.hostname
        target_host = target.hostname
    except ValueError:
        raise HTTPException(status_code=400, detail="PDF URL is invalid")

    if (
        not configured_host
        or not target_host
        or configured.username is not None
        or configured.password is not None
        or target.username is not None
        or target.password is not None
        or configured.query
        or configured.fragment
        or configured.path not in ("", "/")
        or target.query
        or target.fragment
        or configured.scheme not in ("https", "http")
        or target.scheme != configured.scheme
        or target_host.lower() != configured_host.lower()
        or target_port != configured_port
    ):
        raise HTTPException(status_code=400, detail="PDF URL must point to this Supabase project")

    if configured.scheme == "http" and not _is_loopback_host(configured_host):
        raise HTTPException(status_code=400, detail="HTTP is allowed only for a local Supabase project")

    try:
        segments = target.path.split("/")
        for _ in range(8):
            decoded = [unquote(segment, errors="strict") for segment in segments]
            if decoded == segments:
                break
            segments = decoded
    except (UnicodeDecodeError, ValueError):
        raise HTTPException(status_code=400, detail="PDF URL path is invalid")
    if any(
        "/" in segment
        or "\\" in segment
        or segment in (".", "..")
        or any(unicodedata.category(char) == "Cc" for char in segment)
        for segment in segments
    ):
        raise HTTPException(status_code=400, detail="PDF URL path is invalid")
    if (
        len(segments) < 9
        or segments[:6] != ["", "storage", "v1", "object", "public", "whiteboards"]
        or segments[6] != user_id
        or segments[7] != course_id
        or any(not segment for segment in segments[6:])
    ):
        raise HTTPException(status_code=400, detail="PDF URL must reference this user's course whiteboard")


def _download_whiteboard_pdf(pdf_url: str) -> bytes:
    try:
        response = requests.get(
            pdf_url, stream=True, timeout=(3, 15), allow_redirects=False
        )
    except requests.RequestException:
        raise HTTPException(status_code=502, detail="Could not download the whiteboard PDF")

    try:
        if response.status_code != 200:
            raise HTTPException(status_code=502, detail="Could not download the whiteboard PDF")
        try:
            content_length = int(response.headers.get("content-length", "0"))
        except (TypeError, ValueError):
            content_length = 0
        if content_length > MAX_PDF_BYTES:
            raise HTTPException(status_code=413, detail="PDF exceeds the 20 MiB download limit")

        content = bytearray()
        try:
            for chunk in response.iter_content(chunk_size=64 * 1024):
                if not chunk:
                    continue
                content.extend(chunk)
                if len(content) > MAX_PDF_BYTES:
                    raise HTTPException(status_code=413, detail="PDF exceeds the 20 MiB download limit")
        except HTTPException:
            raise
        except requests.RequestException:
            raise HTTPException(status_code=502, detail="Could not download the whiteboard PDF")
        if not content:
            raise HTTPException(status_code=400, detail="The downloaded PDF is empty")
        return bytes(content)
    finally:
        response.close()


@router.post("/generate-from-url")
def generate_flashcards_from_url(body: GenerateFromUrlRequest):
    """Generate flashcards from a PDF in the owner's public whiteboard storage."""
    _validate_whiteboard_pdf_url(body.pdf_url, body.user_id, body.course_id)
    supabase = get_supabase_client()
    course = (
        supabase.table("courses")
        .select("id")
        .eq("id", body.course_id)
        .eq("user_id", body.user_id)
        .execute()
    )
    if not course.data:
        raise HTTPException(status_code=404, detail="Course not found")

    content = _download_whiteboard_pdf(body.pdf_url)
    return _generate_flashcards_from_pdf(
        content,
        user_id=body.user_id,
        course_id=body.course_id,
        title=body.title,
        instructions=body.instructions,
        supabase=supabase,
    )


def _generate_flashcards_from_pdf(
    content: bytes,
    *,
    user_id: str,
    course_id: str,
    title: str,
    instructions: str = "",
    supabase=None,
):
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not set")
    if not HAS_PYPDF:
        raise HTTPException(status_code=500, detail="pypdf not available")

    try:
        reader = pypdf.PdfReader(io.BytesIO(content))
        pdf_text = "\n".join(p.extract_text() or "" for p in reader.pages)
    except Exception:
        raise HTTPException(status_code=400, detail="Could not read the PDF")

    if HAS_FITZ and any(unicodedata.category(char) == "Co" for char in pdf_text):
        try:
            document = fitz.open(stream=content, filetype="pdf")
            try:
                pdf_text = "\n".join(page.get_text() or "" for page in document)
            finally:
                document.close()
        except Exception:
            pass

    if not pdf_text.strip():
        raise HTTPException(status_code=400, detail="No text could be extracted from the PDF")

    # Truncate to ~100k chars to fit context
    pdf_text = pdf_text[:100000]

    # Generate flashcards with Claude
    client = anthropic.Anthropic(api_key=api_key, max_retries=0)

    instruction_block = (
        f"\nSTUDENT INSTRUCTIONS: {instructions.strip()}\nFollow these instructions carefully when deciding what to include and how to phrase each card.\n"
        if instructions.strip() else
        "\nDefault style: one clear concept per card, keep answers concise (1-3 sentences max).\n"
    )
    prompt = (
        "You are a study assistant. Given the following course material, generate a set of flashcards.\n"
        + instruction_block +
        "\nReturn ONLY a JSON array (no markdown, no extra text) where each element has:\n"
        '  { "question": "...", "answer": "..." }\n\n'
        "Generate as many cards as needed to cover all key concepts in the material. Questions should test understanding, not just recall.\n\n"
        f"Course material:\n{pdf_text}"
    )

    response = create_message(
        client, "flashcards",
        max_tokens=8096,
        messages=[{"role": "user", "content": prompt}],
    )

    raw = response.content[0].text.strip()

    # Try to extract a JSON array from the response robustly
    cards = None
    # 1. Direct parse
    try:
        cards = json.loads(raw)
    except Exception:
        pass

    # 2. Strip markdown fences and retry
    if cards is None:
        fence_match = re.search(r"```(?:json)?\s*([\s\S]*?)```", raw)
        if fence_match:
            try:
                cards = json.loads(fence_match.group(1).strip())
            except Exception:
                pass

    # 3. Extract the first [...] array found in the text
    if cards is None:
        array_match = re.search(r"\[[\s\S]*\]", raw)
        if array_match:
            try:
                cards = json.loads(array_match.group(0))
            except Exception:
                pass

    # 4. Response truncated mid-stream — salvage complete objects before the cut
    if cards is None:
        start = raw.find("[")
        if start != -1:
            truncated = raw[start:]
            last_brace = truncated.rfind("}")
            if last_brace != -1:
                try:
                    cards = json.loads(truncated[:last_brace + 1] + "]")
                except Exception:
                    pass

    if cards is None:
        raise HTTPException(status_code=500, detail="Flashcard generation returned invalid data")

    if not isinstance(cards, list):
        raise HTTPException(status_code=500, detail="Flashcard generation returned invalid data")

    if any(not isinstance(card, dict) for card in cards):
        raise HTTPException(status_code=500, detail="Flashcard generation returned invalid data")

    cards_to_insert = [
        {
            "question": card.get("question", ""),
            "answer": card.get("answer", ""),
        }
        for card in cards
        if isinstance(card.get("question"), str)
        and card.get("question", "").strip()
        and isinstance(card.get("answer"), str)
        and card.get("answer", "").strip()
    ]
    if not cards_to_insert:
        raise HTTPException(status_code=500, detail="Flashcard generation returned no usable cards")

    # Persist the set + cards
    if supabase is None:
        supabase = get_supabase_client()
    set_result = (
        supabase.table("flashcard_sets")
        .insert({
            "user_id": user_id,
            "course_id": course_id,
            "title": title,
        })
        .execute()
    )
    if not set_result.data:
        raise HTTPException(status_code=400, detail="Failed to create flashcard set")

    new_set = set_result.data[0]
    set_id = new_set["id"]

    cards_to_insert = [
        {
            "set_id": set_id,
            "question": card["question"],
            "answer": card["answer"],
            "order_index": i,
        }
        for i, card in enumerate(cards_to_insert)
    ]

    supabase.table("flashcards").insert(cards_to_insert).execute()

    return {"set": new_set, "cards": cards_to_insert, "count": len(cards_to_insert)}

