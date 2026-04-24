from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Query
from app.core.supabase import get_supabase_client
from pydantic import BaseModel
from typing import List, Optional, Dict, Literal
import anthropic
import os
import io
import json
import re

try:
    import fitz  # PyMuPDF
    HAS_FITZ = True
except ImportError:
    HAS_FITZ = False

try:
    import pypdf
    HAS_PYPDF = True
except ImportError:
    HAS_PYPDF = False

router = APIRouter(prefix="/questions")


# ─── Models ──────────────────────────────────────────────────

class GenerateRequest(BaseModel):
    user_id: str
    course_id: str
    pdf_url: str
    pdf_name: Optional[str] = None
    title: Optional[str] = None
    format: Optional[Literal['mixed', 'mcq', 'short_answer', 'essay']] = None
    num_questions: Optional[int] = None
    instructions: Optional[str] = None  # free-text user instructions


class GradeRequest(BaseModel):
    question_text: str
    user_answer: str
    topic: str


# ─── Helpers ─────────────────────────────────────────────────

def _pdf_page_images(file_bytes: bytes, dpi: int = 150) -> list[str]:
    """Render each PDF page to a base64 PNG. Requires PyMuPDF."""
    import base64
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    zoom = dpi / 72
    mat = fitz.Matrix(zoom, zoom)
    return [
        base64.b64encode(page.get_pixmap(matrix=mat).tobytes("png")).decode()
        for page in doc
    ]


def _extract_pdf_text(file_bytes: bytes) -> str:
    if HAS_FITZ:
        doc = fitz.open(stream=file_bytes, filetype="pdf")
        return "\n\n".join(
            f"[Page {i+1}]\n{page.get_text() or ''}"
            for i, page in enumerate(doc)
        )
    reader = pypdf.PdfReader(io.BytesIO(file_bytes))
    return "\n\n".join(
        f"[Page {i+1}]\n{page.extract_text() or ''}"
        for i, page in enumerate(reader.pages)
    )


def _fetch_url_pdf_text(pdf_url: str) -> str:
    try:
        import requests as _requests
        r = _requests.get(pdf_url, timeout=30)
        r.raise_for_status()
        return _extract_pdf_text(r.content)
    except Exception:
        return ""


def _call_claude_vision(images_b64: list[str], prompt: str, max_tokens: int = 8192) -> str:
    """Call Claude with page images + a text prompt. Falls back to text-only if no images."""
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not set")
    client = anthropic.Anthropic(api_key=api_key)

    content: list = []
    for i, b64 in enumerate(images_b64[:30]):  # cap at 30 pages
        content.append({"type": "text", "text": f"[Page {i+1}]"})
        content.append({
            "type": "image",
            "source": {"type": "base64", "media_type": "image/png", "data": b64},
        })
    content.append({"type": "text", "text": prompt})

    msg = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=max_tokens,
        messages=[{"role": "user", "content": content}],
    )
    return msg.content[0].text.strip()


def _parse_questions(raw: str) -> list:
    cleaned = re.sub(r'```(?:json)?\s*|\s*```', '', raw).strip()

    def _try(s: str):
        try:
            result = json.loads(s)
            if isinstance(result, list):
                return result
            if isinstance(result, dict) and "questions" in result:
                return result["questions"]
        except Exception:
            pass
        return None

    result = _try(cleaned)
    if result is not None:
        return result

    start = cleaned.find('[')
    end = cleaned.rfind(']')
    if start != -1 and end != -1 and end > start:
        result = _try(cleaned[start:end + 1])
        if result is not None:
            return result

    if start != -1:
        fragment = cleaned[start:]
        last_brace = fragment.rfind('}')
        if last_brace != -1:
            result = _try(fragment[:last_brace + 1] + ']')
            if result is not None:
                return result

    return []


def _group_by_topic(questions: list) -> Dict[str, list]:
    groups: Dict[str, list] = {}
    for q in questions:
        t = q["topic"]
        if t not in groups:
            groups[t] = []
        groups[t].append(q)
    return groups


def _build_question_rows(questions: list, bank_id: str, source_label: str | None) -> list:
    return [
        {
            "bank_id": bank_id,
            "topic": q.get("topic", "General"),
            "question_text": q.get("question_text", ""),
            "model_answer": q.get("model_answer", ""),
            "explanation": q.get("explanation", ""),
            "source_label": source_label,
            "order_index": i,
        }
        for i, q in enumerate(questions)
        if q.get("question_text")
    ]


def _call_claude(prompt: str, max_tokens: int = 8000) -> str:
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not set")
    client = anthropic.Anthropic(api_key=api_key)
    msg = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=max_tokens,
        messages=[{"role": "user", "content": prompt}],
    )
    return msg.content[0].text.strip()


# ─── Extract from past paper ─────────────────────────────────

_EXTRACT_PROMPT = """You are processing an exam past paper. The pages are shown as images — read them carefully, including all diagrams, FSA/automata, tables, graphs, and figures.

Extract every question exactly as written. Do not paraphrase.

For each question:
- Assign a broad topic label shared across questions on the same concept (e.g. "Finite Automata", "Search Algorithms"). Do NOT create a new topic per question.
- If a question has sub-parts (a, b, c…), extract each as a separate question, prefixed with enough parent context to be self-contained.
- If the question references a diagram, FSA, table, or figure that appears on the page, set "diagram_page" to the 1-based page number where it appears. The actual image will be shown to the student automatically — do NOT describe it in question_text.
- Write a model answer (2-5 sentences). For diagram questions, base it on what you can see.
- Add a one-sentence explanation of the key concept being tested.

CRITICAL JSON RULES:
- Return ONLY a valid JSON array, no text before or after
- Every string value on one line — use \\n for line breaks, not literal newlines
- Escape backslashes as \\\\ and double quotes inside strings as \\"
- No triple backticks or markdown anywhere

[
  {
    "topic": "Topic name",
    "question_text": "Exact question text",
    "model_answer": "Model answer",
    "explanation": "Key concept tested",
    "diagram_page": null
  }
]

Set "diagram_page" to the page number (integer) if the question references a visual element on that page, otherwise null."""


def _run_extraction(content: bytes, source_label: str) -> tuple[list, str]:
    """Run Claude extraction on PDF bytes. Returns (questions, raw_response)."""
    if HAS_FITZ:
        try:
            images = _pdf_page_images(content)
            raw = _call_claude_vision(images, _EXTRACT_PROMPT + f'\n\nSource: "{source_label}"', max_tokens=8192)
            return _parse_questions(raw), raw
        except Exception:
            pass
    pdf_text = _extract_pdf_text(content)
    if not pdf_text.strip():
        raise HTTPException(status_code=400, detail="No text could be extracted from the PDF")
    raw = _call_claude(_EXTRACT_PROMPT + f'\n\nSource: "{source_label}"\n\nExam paper:\n{pdf_text[:60000]}', max_tokens=8192)
    return _parse_questions(raw), raw


def _upload_page_images(supabase, content: bytes, user_id: str, course_id: str, filename: str) -> dict[int, str]:
    """Render and upload page PNGs. Returns {1-based page: public_url}."""
    if not HAS_FITZ:
        return {}
    import base64
    page_urls: dict[int, str] = {}
    try:
        images = _pdf_page_images(content)
        for i, img_b64 in enumerate(images):
            path = f"{user_id}/{course_id}/pages/{filename}/page_{i+1}.png"
            try:
                supabase.storage.from_("past-papers").upload(
                    path, base64.b64decode(img_b64),
                    {"content-type": "image/png", "upsert": "true"}
                )
                page_urls[i + 1] = supabase.storage.from_("past-papers").get_public_url(path)
            except Exception:
                pass
    except Exception:
        pass
    return page_urls


def _embed_diagram_urls(questions: list, page_urls: dict[int, str]) -> None:
    """Mutates questions in-place: prepends [diagram:url] to question_text where diagram_page is set."""
    for q in questions:
        pg = q.get("diagram_page")
        if pg and isinstance(pg, int) and pg in page_urls:
            q["question_text"] = f"[diagram:{page_urls[pg]}]\n{q['question_text']}"


@router.post("/extract")
def extract_from_past_paper(
    file: UploadFile = File(...),
    user_id: str = Form(...),
    course_id: str = Form(...),
    title: str = Form(...),
    source_label: str = Form(default=""),
):
    if not HAS_FITZ and not HAS_PYPDF:
        raise HTTPException(status_code=500, detail="PDF parsing library not available")

    content = file.file.read()
    supabase = get_supabase_client()

    # Upload PDF
    pdf_url = None
    try:
        storage_path = f"{user_id}/{course_id}/{file.filename}"
        supabase.storage.from_("past-papers").upload(
            storage_path, content,
            {"content-type": file.content_type or "application/pdf", "upsert": "true"}
        )
        pdf_url = supabase.storage.from_("past-papers").get_public_url(storage_path)
    except Exception:
        pass

    # Upload page images and extract
    page_urls = _upload_page_images(supabase, content, user_id, course_id, file.filename)
    questions, raw = _run_extraction(content, source_label or title)

    if not questions:
        raise HTTPException(status_code=500, detail=f"Could not parse questions. Claude raw (first 500): {raw[:500]!r}")

    _embed_diagram_urls(questions, page_urls)

    bank = supabase.table("question_banks").insert({
        "user_id": user_id,
        "course_id": course_id,
        "title": title,
        "source_type": "past_paper",
        "source_label": source_label or title,
        "pdf_url": pdf_url,
        "pdf_name": file.filename,
        "vision_extracted": True,
    }).execute()

    if not bank.data:
        raise HTTPException(status_code=400, detail="Failed to create question bank")

    bank_id = bank.data[0]["id"]
    rows = _build_question_rows(questions, bank_id, source_label or title)
    supabase.table("questions").insert(rows).execute()
    return {"bank": bank.data[0], "count": len(rows)}


@router.post("/banks/{bank_id}/reextract")
def reextract_bank(bank_id: str):
    supabase = get_supabase_client()
    bank_row = supabase.table("question_banks").select("*").eq("id", bank_id).execute()
    if not bank_row.data:
        raise HTTPException(status_code=404, detail="Bank not found")
    bank = bank_row.data[0]

    if not bank.get("pdf_url"):
        raise HTTPException(status_code=400, detail="No PDF stored for this bank")

    import requests as _req
    r = _req.get(bank["pdf_url"], timeout=30)
    r.raise_for_status()
    content = r.content
    filename = bank.get("pdf_name") or "paper.pdf"

    page_urls = _upload_page_images(supabase, content, bank["user_id"], bank["course_id"], filename)
    questions, raw = _run_extraction(content, bank.get("source_label") or bank["title"])

    if not questions:
        raise HTTPException(status_code=500, detail=f"Re-extraction failed. Raw (first 500): {raw[:500]!r}")

    _embed_diagram_urls(questions, page_urls)

    supabase.table("questions").delete().eq("bank_id", bank_id).execute()
    rows = _build_question_rows(questions, bank_id, bank.get("source_label"))
    supabase.table("questions").insert(rows).execute()
    supabase.table("question_banks").update({"vision_extracted": True}).eq("id", bank_id).execute()
    return {"bank": bank, "count": len(rows)}


# ─── Generate from notes PDF ─────────────────────────────────

@router.post("/generate")
def generate_question_bank(body: GenerateRequest):
    pdf_text = _fetch_url_pdf_text(body.pdf_url)
    if not pdf_text.strip():
        raise HTTPException(status_code=400, detail="Could not extract text from this PDF")

    fmt = (body.format or 'mixed').lower()
    count_str = f"exactly {body.num_questions}" if body.num_questions else "a comprehensive set of"

    if fmt == 'mcq':
        format_instructions = f"""Generate {count_str} multiple-choice questions (MCQ) at exam difficulty.
- Each question must have exactly 4 options labelled A), B), C), D) on separate lines inside question_text
- Set model_answer to the correct option letter and full text, e.g. "B) The correct answer"
- Explanation should briefly note why the other options are wrong"""
    elif fmt == 'short_answer':
        format_instructions = f"""Generate {count_str} short-answer questions requiring 2–5 sentence responses at exam difficulty."""
    elif fmt == 'essay':
        format_instructions = f"""Generate {count_str} essay questions requiring detailed multi-paragraph responses.
Model answers should be structured outlines with 5–8 key points."""
    else:
        format_instructions = f"""Generate {count_str} exam questions mixing types: definition, explain/discuss, apply/analyse, compare/contrast."""

    extra = f"\n\nAdditional instructions from the user: {body.instructions.strip()}" if body.instructions and body.instructions.strip() else ""

    prompt = f"""You are creating an exam-style question bank from lecture notes.

{format_instructions}

All questions should:
- Be at exam difficulty level (not trivial recall)
- Be grouped under broad topic labels — each general concept gets one topic, and many questions should share the same topic label. Do NOT create a new topic per question.{extra}

For each question provide a model answer and explanation of what's being tested.

Return ONLY a JSON array, no other text:
[
  {{
    "topic": "Topic name",
    "question_text": "Exam question",
    "model_answer": "Detailed model answer",
    "explanation": "Key concepts tested"
  }}
]

Lecture notes:
{pdf_text[:80000]}"""

    raw = _call_claude(prompt)
    questions = _parse_questions(raw)

    if not questions:
        raise HTTPException(status_code=500, detail="Could not generate questions from this PDF")

    supabase = get_supabase_client()
    title = body.title or (body.pdf_name or "Generated Questions")
    bank = supabase.table("question_banks").insert({
        "user_id": body.user_id,
        "course_id": body.course_id,
        "title": title,
        "source_type": "generated",
        "source_label": None,
    }).execute()

    if not bank.data:
        raise HTTPException(status_code=400, detail="Failed to create question bank")

    bank_id = bank.data[0]["id"]
    rows = _build_question_rows(questions, bank_id, None)
    supabase.table("questions").insert(rows).execute()
    return {"bank": bank.data[0], "count": len(rows)}


# ─── List banks ──────────────────────────────────────────────

@router.get("/banks")
def get_banks(user_id: str = Query(...), course_id: str = Query(...)):
    supabase = get_supabase_client()
    banks = (
        supabase.table("question_banks")
        .select("*")
        .eq("user_id", user_id)
        .eq("course_id", course_id)
        .order("created_at", desc=True)
        .execute()
        .data or []
    )
    if not banks:
        return []

    bank_ids = [b["id"] for b in banks]
    counts = (
        supabase.table("questions")
        .select("bank_id")
        .in_("bank_id", bank_ids)
        .execute()
        .data or []
    )
    count_map: Dict[str, int] = {}
    for row in counts:
        count_map[row["bank_id"]] = count_map.get(row["bank_id"], 0) + 1

    for b in banks:
        b["question_count"] = count_map.get(b["id"], 0)

    return banks


# ─── Get questions in a bank ─────────────────────────────────

@router.get("/banks/{bank_id}")
def get_bank_questions(bank_id: str):
    supabase = get_supabase_client()
    bank = supabase.table("question_banks").select("*").eq("id", bank_id).execute()
    if not bank.data:
        raise HTTPException(status_code=404, detail="Bank not found")

    questions = (
        supabase.table("questions")
        .select("*")
        .eq("bank_id", bank_id)
        .order("topic")
        .order("order_index")
        .execute()
        .data or []
    )

    return {"bank": bank.data[0], "topics": _group_by_topic(questions)}


# ─── Combined topic view (all banks for a course) ────────────

@router.get("/topics")
def get_topics_for_course(user_id: str = Query(...), course_id: str = Query(...)):
    supabase = get_supabase_client()
    banks = (
        supabase.table("question_banks")
        .select("id")
        .eq("user_id", user_id)
        .eq("course_id", course_id)
        .execute()
        .data or []
    )
    if not banks:
        return {}

    bank_ids = [b["id"] for b in banks]
    questions = (
        supabase.table("questions")
        .select("*")
        .in_("bank_id", bank_ids)
        .order("topic")
        .order("source_label")
        .order("order_index")
        .execute()
        .data or []
    )

    return _group_by_topic(questions)


# ─── Delete bank ─────────────────────────────────────────────

@router.delete("/banks/{bank_id}")
def delete_bank(bank_id: str):
    supabase = get_supabase_client()
    supabase.table("questions").delete().eq("bank_id", bank_id).execute()
    supabase.table("question_banks").delete().eq("id", bank_id).execute()
    return {"ok": True}


# ─── Grade answer ─────────────────────────────────────────────

@router.post("/grade")
def grade_answer(body: GradeRequest):
    prompt = f"""You are a supportive tutor giving feedback directly to a student on their exam answer. Be warm and constructive — lead with what they got right, then guide them toward what to strengthen. Never be harsh. Write in second person using "you".

Topic: {body.topic}

Question:
{body.question_text}

Their answer:
{body.user_answer}

Grade on depth of understanding, accuracy, and completeness.

Respond with a JSON object:
{{
  "grade": "Excellent" | "Good" | "Developing" | "Insufficient",
  "score": 1-4,
  "feedback": "2-3 encouraging, specific sentences addressed to the student using 'you' — acknowledge the good first, then suggest improvement",
  "what_was_good": "Specific thing(s) you got right — be concrete and encouraging",
  "what_to_improve": "One or two specific things to add or strengthen — frame as guidance, not criticism"
}}"""

    raw = _call_claude(prompt, max_tokens=1024)
    cleaned = re.sub(r'```(?:json)?\s*|\s*```', '', raw).strip()
    try:
        result = json.loads(cleaned)
    except Exception:
        m = re.search(r'\{[\s\S]*\}', cleaned)
        if m:
            try:
                result = json.loads(m.group(0))
            except Exception:
                raise HTTPException(status_code=500, detail="Could not parse grading response")
        else:
            raise HTTPException(status_code=500, detail="Could not parse grading response")

    return result
