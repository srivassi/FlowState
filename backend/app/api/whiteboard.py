from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from app.core.supabase import get_supabase_client
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import anthropic
import os
import uuid
import io
import json

try:
    import pypdf
    HAS_PYPDF = True
except ImportError:
    HAS_PYPDF = False

router = APIRouter(prefix="/whiteboard")


class StickyNote(BaseModel):
    id: str
    x: float
    y: float
    width: float = 320
    highlight_text: Optional[str] = None
    page_number: Optional[int] = None
    color: str = "#FEF08A"
    title: Optional[str] = None
    messages: List[Dict[str, str]]
    parent_note_id: Optional[str] = None
    page_id: Optional[str] = None   # which whiteboard page this note belongs to
    type: Optional[str] = 'ai'      # 'ai' = chat note, 'text' = plain text note
    content: Optional[str] = None   # body text for text notes


class PageData(BaseModel):
    id: str
    name: str
    pdf_url: Optional[str] = None
    pdf_name: Optional[str] = None


class WhiteboardSave(BaseModel):
    course_id: str
    user_id: str
    sticky_notes: List[StickyNote]
    pdf_name: Optional[str] = None   # legacy single-PDF compat
    pdf_url: Optional[str] = None    # legacy single-PDF compat
    pages: Optional[List[Dict[str, Any]]] = None  # multi-page metadata


class ChatMessage(BaseModel):
    course_id: str
    user_id: str
    note_id: str
    message: str
    prior_messages: List[Dict[str, str]] = []
    highlight_text: Optional[str] = None
    pdf_url: Optional[str] = None
    page_number: Optional[int] = None


class ForkNote(BaseModel):
    course_id: str
    user_id: str
    parent_note_id: str
    fork_message: Optional[str] = None


# ─── PDF upload ──────────────────────────────────────────────

def _extract_pdf_sections(content: bytes) -> list:
    """Extract table of contents / outline from a PDF using pypdf."""
    if not HAS_PYPDF:
        return []
    try:
        reader = pypdf.PdfReader(io.BytesIO(content))

        def walk(items, depth=0):
            result = []
            for item in items:
                if isinstance(item, list):
                    result.extend(walk(item, depth + 1))
                elif hasattr(item, "title"):
                    try:
                        page_idx = reader.get_destination_page_number(item)
                        title = str(item.title).strip()
                        if title:
                            result.append({"title": title, "page": page_idx + 1, "depth": depth})
                    except Exception:
                        pass
            return result

        return walk(reader.outline)
    except Exception:
        return []


@router.post("/upload-pdf")
def upload_pdf(
    file: UploadFile = File(...),
    user_id: str = Form(...),
    course_id: str = Form(...),
):
    supabase = get_supabase_client()
    content = file.file.read()
    path = f"{user_id}/{course_id}/{file.filename}"
    supabase.storage.from_("whiteboards").upload(path, content, {"content-type": file.content_type or "application/pdf", "upsert": "true"})
    pdf_url = supabase.storage.from_("whiteboards").get_public_url(path)
    sections = _extract_pdf_sections(content)
    return {"pdf_url": pdf_url, "pdf_name": file.filename, "sections": sections}


# ─── Extract sections from an existing PDF URL ───────────────

class ExtractSectionsRequest(BaseModel):
    pdf_url: str

@router.post("/extract-sections")
def extract_sections(body: ExtractSectionsRequest):
    if not HAS_PYPDF:
        return {"sections": []}
    try:
        import requests as _requests
        r = _requests.get(body.pdf_url, timeout=20)
        sections = _extract_pdf_sections(r.content)
        return {"sections": sections}
    except Exception:
        return {"sections": []}


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
        row = dict(result.data[0])
        # Decode pages from pdf_name if it was stored as JSON
        pdf_name_raw = row.get("pdf_name") or ""
        if pdf_name_raw.startswith("["):
            try:
                pages = json.loads(pdf_name_raw)
                if isinstance(pages, list) and pages and isinstance(pages[0], dict) and "id" in pages[0]:
                    row["pages"] = pages
                    # Restore pdf_name/pdf_url from first page for compat
                    row["pdf_name"] = pages[0].get("pdf_name")
                    row["pdf_url"] = pages[0].get("pdf_url")
            except (json.JSONDecodeError, TypeError):
                pass
        return row
    return {"course_id": course_id, "sticky_notes": [], "pdf_url": None, "pdf_name": None, "pages": None}


# ─── Save/update whiteboard state ────────────────────────────

@router.post("/save")
def save_whiteboard(body: WhiteboardSave):
    supabase = get_supabase_client()

    existing = (
        supabase.table("whiteboards")
        .select("id")
        .eq("course_id", body.course_id)
        .eq("user_id", body.user_id)
        .limit(1)
        .execute()
    )

    notes_json = [n.dict() for n in body.sticky_notes]

    # Encode pages into pdf_name as JSON; keep pdf_url for first page compat
    if body.pages is not None:
        stored_pdf_name = json.dumps(body.pages)
        stored_pdf_url = body.pages[0].get("pdf_url") if body.pages else None
    else:
        stored_pdf_name = body.pdf_name
        stored_pdf_url = body.pdf_url

    if existing.data:
        result = (
            supabase.table("whiteboards")
            .update({
                "sticky_notes": notes_json,
                "pdf_name": stored_pdf_name,
                "pdf_url": stored_pdf_url,
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
                "pdf_name": stored_pdf_name,
                "pdf_url": stored_pdf_url,
            })
            .execute()
        )

    if not result.data:
        raise HTTPException(status_code=400, detail="Failed to save whiteboard")
    return result.data[0]


# ─── Chat with AI on a specific note ─────────────────────────

@router.post("/chat")
def chat_on_note(body: ChatMessage):
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not set")

    client = anthropic.Anthropic(api_key=api_key)

    system_prompt = (
        "You are a study assistant helping a student understand their course material. "
        "You are embedded as a sticky note on a PDF canvas. Keep responses concise and focused — "
        "this is an annotation tool, not a full chat interface. Use bullet points for clarity when listing multiple points."
    )

    if body.pdf_url and HAS_PYPDF:
        try:
            import requests as _requests
            r = _requests.get(body.pdf_url, timeout=15)
            reader = pypdf.PdfReader(io.BytesIO(r.content))
            all_pages = [reader.pages[i].extract_text() or "" for i in range(len(reader.pages))]

            if body.page_number and body.page_number <= len(all_pages):
                # Put the annotated page first so it's never cut off by truncation,
                # then append remaining pages in order
                idx = body.page_number - 1
                ordered = (
                    [f"[Page {body.page_number} — annotated]\n{all_pages[idx]}"] +
                    [f"[Page {i + 1}]\n{all_pages[i]}" for i in range(len(all_pages)) if i != idx]
                )
            else:
                ordered = [f"[Page {i + 1}]\n{all_pages[i]}" for i in range(len(all_pages))]

            pdf_text = "\n\n".join(ordered)
            if pdf_text.strip():
                system_prompt += (
                    f"\n\nFull content of the student's PDF ({len(all_pages)} pages):\n\n"
                    f"{pdf_text[:40000]}"
                )
        except Exception:
            pass

    if body.highlight_text:
        system_prompt += (
            f"\n\nThe student has highlighted this specific excerpt:\n"
            f"\"{body.highlight_text}\"\n"
            f"Ground your response in this excerpt unless they ask something unrelated."
        )

    messages = [*body.prior_messages, {"role": "user", "content": body.message}]

    response = client.messages.create(
        model="claude-opus-4-6",
        max_tokens=1024,
        system=system_prompt,
        messages=messages,
    )

    reply = response.content[0].text

    updated_messages = [
        *body.prior_messages,
        {"role": "user", "content": body.message},
        {"role": "assistant", "content": reply},
    ]

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
        "x": parent["x"] + 340,
        "y": parent["y"],
        "parent_note_id": body.parent_note_id,
        "title": f"Fork of: {parent.get('title', 'note')}",
        "messages": list(parent["messages"]),
        "color": "#DBEAFE",
        # page_id is preserved via **parent spread
    }

    if body.fork_message:
        new_note["messages"].append({"role": "user", "content": body.fork_message})

    notes.append(new_note)
    supabase.table("whiteboards").update({
        "sticky_notes": notes,
        "updated_at": "now()",
    }).eq("course_id", body.course_id).eq("user_id", body.user_id).execute()

    return new_note
