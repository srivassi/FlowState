from fastapi import APIRouter, HTTPException
from app.core.supabase import get_supabase_client
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import anthropic
import os
import uuid

router = APIRouter(prefix="/whiteboard")


class StickyNote(BaseModel):
    id: str
    x: float
    y: float
    width: float = 320
    highlight_text: Optional[str] = None
    page_number: Optional[int] = None
    color: str = "#FEF08A"          # yellow default
    title: Optional[str] = None
    messages: List[Dict[str, str]]  # [{role: user|assistant, content: str}]
    parent_note_id: Optional[str] = None   # for forked notes


class WhiteboardSave(BaseModel):
    course_id: str
    user_id: str
    sticky_notes: List[StickyNote]
    pdf_name: Optional[str] = None
    pdf_url: Optional[str] = None


class ChatMessage(BaseModel):
    course_id: str
    user_id: str
    note_id: str
    message: str          # new user message
    # full prior messages so we pass context
    prior_messages: List[Dict[str, str]] = []
    highlight_text: Optional[str] = None  # what text is highlighted on the PDF


class ForkNote(BaseModel):
    course_id: str
    user_id: str
    parent_note_id: str
    fork_message: Optional[str] = None   # optional opening message for the fork


# ─── Get whiteboard for a course ─────────────────────────────

@router.get("/{course_id}")
def get_whiteboard(course_id: str, user_id: str):
    supabase = get_supabase_client()
    result = (
        supabase.table("whiteboards")
        .select("*")
        .eq("course_id", course_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    if result.data:
        return result.data[0]
    # Return empty whiteboard if none exists yet
    return {"course_id": course_id, "sticky_notes": [], "pdf_url": None, "pdf_name": None}


# ─── Save/update whiteboard state ────────────────────────────

@router.post("/save")
def save_whiteboard(body: WhiteboardSave):
    supabase = get_supabase_client()

    # Check if whiteboard exists
    existing = (
        supabase.table("whiteboards")
        .select("id")
        .eq("course_id", body.course_id)
        .eq("user_id", body.user_id)
        .limit(1)
        .execute()
    )

    notes_json = [n.dict() for n in body.sticky_notes]

    if existing.data:
        result = (
            supabase.table("whiteboards")
            .update({
                "sticky_notes": notes_json,
                "pdf_name": body.pdf_name,
                "pdf_url": body.pdf_url,
                "updated_at": "now()",
            })
            .eq("id", existing.data[0]["id"])
            .execute()
        )
    else:
        result = (
            supabase.table("whiteboards")
            .insert({
                "course_id": body.course_id,
                "user_id": body.user_id,
                "sticky_notes": notes_json,
                "pdf_name": body.pdf_name,
                "pdf_url": body.pdf_url,
            })
            .execute()
        )

    if not result.data:
        raise HTTPException(status_code=400, detail="Failed to save whiteboard")
    return result.data[0]


# ─── Chat with AI on a specific note ─────────────────────────

@router.post("/chat")
def chat_on_note(body: ChatMessage):
    """Send a message in a sticky note's conversation thread."""
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not set")

    client = anthropic.Anthropic(api_key=api_key)

    system_prompt = (
        "You are a study assistant helping a student understand their course material. "
        "You are embedded as a sticky note on a PDF canvas. Keep responses concise and focused — "
        "this is an annotation tool, not a full chat interface. Use bullet points for clarity when listing multiple points."
    )

    if body.highlight_text:
        system_prompt += (
            f"\n\nThe student has highlighted this text from their notes:\n"
            f"\"{body.highlight_text}\"\n"
            f"Ground your response in this specific excerpt unless they ask something unrelated."
        )

    # Build message history
    messages = [*body.prior_messages, {"role": "user", "content": body.message}]

    response = client.messages.create(
        model="claude-opus-4-6",
        max_tokens=1024,
        system=system_prompt,
        messages=messages,
    )

    reply = response.content[0].text

    # Append both turns to the note's messages and persist
    updated_messages = [
        *body.prior_messages,
        {"role": "user", "content": body.message},
        {"role": "assistant", "content": reply},
    ]

    # Update this specific note inside the whiteboard JSONB
    supabase = get_supabase_client()
    wb = (
        supabase.table("whiteboards")
        .select("sticky_notes")
        .eq("course_id", body.course_id)
        .eq("user_id", body.user_id)
        .limit(1)
        .execute()
    )
    if wb.data:
        notes = wb.data[0]["sticky_notes"] or []
        for note in notes:
            if note["id"] == body.note_id:
                note["messages"] = updated_messages
                break
        supabase.table("whiteboards").update({
            "sticky_notes": notes,
            "updated_at": "now()",
        }).eq("course_id", body.course_id).eq("user_id", body.user_id).execute()

    return {"reply": reply, "messages": updated_messages}


# ─── Fork a note into a new branching conversation ───────────

@router.post("/fork")
def fork_note(body: ForkNote):
    """Clone a note's context into a new sticky note (branching thread)."""
    supabase = get_supabase_client()

    wb = (
        supabase.table("whiteboards")
        .select("sticky_notes")
        .eq("course_id", body.course_id)
        .eq("user_id", body.user_id)
        .limit(1)
        .execute()
    )
    if not wb.data:
        raise HTTPException(status_code=404, detail="Whiteboard not found")

    notes = wb.data[0]["sticky_notes"] or []
    parent = next((n for n in notes if n["id"] == body.parent_note_id), None)
    if not parent:
        raise HTTPException(status_code=404, detail="Parent note not found")

    new_note = {
        **parent,
        "id": str(uuid.uuid4()),
        "x": parent["x"] + 340,    # offset to the right
        "y": parent["y"],
        "parent_note_id": body.parent_note_id,
        "title": f"Fork of: {parent.get('title', 'note')}",
        "messages": list(parent["messages"]),   # copy context
        "color": "#DBEAFE",         # blue tint to signal fork
    }

    if body.fork_message:
        new_note["messages"].append({"role": "user", "content": body.fork_message})

    notes.append(new_note)
    supabase.table("whiteboards").update({
        "sticky_notes": notes,
        "updated_at": "now()",
    }).eq("course_id", body.course_id).eq("user_id", body.user_id).execute()

    return new_note
