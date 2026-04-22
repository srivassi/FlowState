from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Query
from app.core.supabase import get_supabase_client
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

router = APIRouter(prefix="/questions")


# ─── Models ──────────────────────────────────────────────────

class GenerateRequest(BaseModel):
    user_id: str
    course_id: str
    pdf_url: str
    pdf_name: Optional[str] = None
    title: Optional[str] = None
    format: Optional[str] = None        # 'mixed' | 'mcq' | 'short_answer' | 'essay'
    num_questions: Optional[int] = None


class GradeRequest(BaseModel):
    question_text: str
    user_answer: str
    topic: str


# ─── Helpers ─────────────────────────────────────────────────

def _extract_pdf_text(file_bytes: bytes) -> str:
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

    # direct parse
    result = _try(cleaned)
    if result is not None:
        return result

    # find outermost array
    start = cleaned.find('[')
    end = cleaned.rfind(']')
    if start != -1 and end != -1 and end > start:
        result = _try(cleaned[start:end + 1])
        if result is not None:
            return result

    # truncated response — try closing the last incomplete object
    if start != -1:
        fragment = cleaned[start:]
        last_brace = fragment.rfind('}')
        if last_brace != -1:
            result = _try(fragment[:last_brace + 1] + ']')
            if result is not None:
                return result

    return []


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

@router.post("/extract")
def extract_from_past_paper(
    file: UploadFile = File(...),
    user_id: str = Form(...),
    course_id: str = Form(...),
    title: str = Form(...),
    source_label: str = Form(default=""),   # e.g. "2025"
):
    if not HAS_PYPDF:
        raise HTTPException(status_code=500, detail="pypdf not available")

    content = file.file.read()
    try:
        pdf_text = _extract_pdf_text(content)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read PDF: {e}")

    if not pdf_text.strip():
        raise HTTPException(status_code=400, detail="No text could be extracted from the PDF")

    prompt = f"""You are processing an exam past paper. Extract every question from this paper exactly as written — preserve the original wording faithfully. Do not paraphrase.

For each question:
- Assign a topic based on the broad subject area (e.g. "Search Algorithms", "Markov Decision Processes", "Neural Networks"). Each general concept in the paper gets one topic label — do NOT create a separate topic per question or sub-part. Multiple questions must share the same topic label where they cover the same concept.
- If a question has sub-parts (a, b, c), extract each sub-part as a separate question. Prefix it with enough parent context to make it self-contained — include the full parent question stem and any earlier sub-parts that this one references or builds on (e.g. "Given the Prolog KB defined above... (c) Using your answer from (b), explain...")
- Write a concise but complete model answer (2-5 sentences is fine)
- Add a one-sentence explanation of the key concept being tested

CRITICAL JSON RULES — you must follow these exactly:
- Return ONLY a valid JSON array, absolutely no text before or after
- Every string value must be on one line — no literal newlines inside strings, use \\n instead
- Escape all backslashes as \\\\ and all double quotes inside strings as \\"
- If question text contains code, keep it inline using \\n for line breaks
- Do not use triple backticks or markdown anywhere in your response

[
  {{
    "topic": "Topic name",
    "question_text": "Exact question text (use \\n for line breaks in code)",
    "model_answer": "Concise model answer",
    "explanation": "Key concept tested"
  }}
]

Source: "{source_label or title}"

Exam paper:
{pdf_text[:60000]}"""

    raw = _call_claude(prompt, max_tokens=8192)
    questions = _parse_questions(raw)

    if not questions:
        raise HTTPException(status_code=500, detail=f"Could not parse questions. Claude raw (first 500): {raw[:500]!r}")

    supabase = get_supabase_client()

    # Upload PDF to Supabase Storage
    pdf_url = None
    try:
        storage_path = f"{user_id}/{course_id}/{file.filename}"
        supabase.storage.from_("past-papers").upload(
            storage_path, content,
            {"content-type": file.content_type or "application/pdf", "upsert": "true"}
        )
        pdf_url = supabase.storage.from_("past-papers").get_public_url(storage_path)
    except Exception:
        pass  # storage failure is non-fatal; questions still saved

    bank = supabase.table("question_banks").insert({
        "user_id": user_id,
        "course_id": course_id,
        "title": title,
        "source_type": "past_paper",
        "source_label": source_label or title,
        "pdf_url": pdf_url,
        "pdf_name": file.filename,
    }).execute()

    if not bank.data:
        raise HTTPException(status_code=400, detail="Failed to create question bank")

    bank_id = bank.data[0]["id"]
    rows = [
        {
            "bank_id": bank_id,
            "topic": q.get("topic", "General"),
            "question_text": q.get("question_text", ""),
            "model_answer": q.get("model_answer", ""),
            "explanation": q.get("explanation", ""),
            "source_label": source_label or title,
            "order_index": i,
        }
        for i, q in enumerate(questions)
        if q.get("question_text")
    ]

    supabase.table("questions").insert(rows).execute()
    return {"bank": bank.data[0], "count": len(rows)}


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

    prompt = f"""You are creating an exam-style question bank from lecture notes.

{format_instructions}

All questions should:
- Be at exam difficulty level (not trivial recall)
- Be grouped under broad topic labels — each general concept gets one topic, and many questions should share the same topic label. Do NOT create a new topic per question.

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
    rows = [
        {
            "bank_id": bank_id,
            "topic": q.get("topic", "General"),
            "question_text": q.get("question_text", ""),
            "model_answer": q.get("model_answer", ""),
            "explanation": q.get("explanation", ""),
            "source_label": None,
            "order_index": i,
        }
        for i, q in enumerate(questions)
        if q.get("question_text")
    ]

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

    # Group by topic
    topics: Dict[str, list] = {}
    for q in questions:
        t = q["topic"]
        if t not in topics:
            topics[t] = []
        topics[t].append(q)

    return {"bank": bank.data[0], "topics": topics}


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

    topics: Dict[str, list] = {}
    for q in questions:
        t = q["topic"]
        if t not in topics:
            topics[t] = []
        topics[t].append(q)

    return topics


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
    prompt = f"""You are an examiner grading a student's answer to an exam question.

Topic: {body.topic}

Question:
{body.question_text}

Student's answer:
{body.user_answer}

Grade this answer strictly on its own merits — the depth of understanding demonstrated, accuracy, and completeness. Do not compare to a model answer.

Respond with a JSON object:
{{
  "grade": "Excellent" | "Good" | "Developing" | "Insufficient",
  "score": 1-4,
  "feedback": "2-3 sentences of specific, constructive feedback",
  "what_was_good": "What the student got right",
  "what_to_improve": "What was missing or could be stronger"
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
