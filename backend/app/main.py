from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.agent import router as agent_router
from app.api.tasks import router as tasks_router
from app.api.study import router as study_router
from app.api.onboarding import router as onboarding_router
from app.api.whiteboard import router as whiteboard_router
from app.api.flashcards import router as flashcards_router
from app.api.tutor import router as tutor_router
import os

app = FastAPI(title="Study Planner Agent")

frontend_url = os.getenv("FRONTEND_URL", "")
allowed_origins = [o for o in ["http://localhost:3000", frontend_url] if o]

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(onboarding_router)
app.include_router(agent_router)
app.include_router(tasks_router)
app.include_router(study_router)
app.include_router(whiteboard_router)
app.include_router(flashcards_router)
app.include_router(tutor_router)


@app.get("/health")
def health():
    return {"status": "ok"}
