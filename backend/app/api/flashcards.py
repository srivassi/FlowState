from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from app.core.supabase import get_supabase_client
from pydantic import BaseModel
from typing import List, Optional
import anthropic
import os
import io
import json
import uuid

try:
    import pypdf
    HAS_PYPDF = True
except ImportError:
    HAS_PYPDF = False

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
):
    """Upload a PDF and generate flashcards from it using Claude."""
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not set")

    if not HAS_PYPDF:
        raise HTTPException(status_code=500, detail="pypdf not available")

    # Extract text from PDF
    content = file.file.read()
    try:
        reader = pypdf.PdfReader(io.BytesIO(content))
        pdf_text = "\n".join(p.extract_text() or "" for p in reader.pages)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read PDF: {e}")

    if not pdf_text.strip():
        raise HTTPException(status_code=400, detail="No text could be extracted from the PDF")

    # Truncate to ~12k chars to fit context
    pdf_text = pdf_text[:12000]

    # Generate flashcards with Claude
    client = anthropic.Anthropic(api_key=api_key)

    prompt = (
        "You are a study assistant. Given the following course material, generate a comprehensive "
        "set of flashcards that cover the key concepts, definitions, facts, and relationships.\n\n"
        "Return ONLY a JSON array (no markdown, no extra text) where each element has:\n"
        '  { "question": "...", "answer": "..." }\n\n'
        "Aim for 10-20 high-quality cards. Questions should test understanding, not just recall.\n\n"
        f"Course material:\n{pdf_text}"
    )

    response = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}],
    )

    raw = response.content[0].text.strip()

    # Strip markdown fences if present
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.strip()

    try:
        cards = json.loads(raw)
    except Exception:
        raise HTTPException(status_code=500, detail="Claude returned invalid JSON")

    if not isinstance(cards, list):
        raise HTTPException(status_code=500, detail="Expected a JSON array from Claude")

    # Persist the set + cards
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
            "question": c.get("question", ""),
            "answer": c.get("answer", ""),
            "order_index": i,
        }
        for i, c in enumerate(cards)
        if c.get("question") and c.get("answer")
    ]

    supabase.table("flashcards").insert(cards_to_insert).execute()

    return {"set": new_set, "cards": cards_to_insert, "count": len(cards_to_insert)}
