from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.agent import router as agent_router
from app.api.tasks import router as tasks_router
from app.api.study import router as study_router
from app.api.onboarding import router as onboarding_router
from app.api.whiteboard import router as whiteboard_router
import os

app = FastAPI(title="Study Planner Agent")

# In production NEXT_PUBLIC_API_URL sets the frontend origin
allowed_origins = [
    "http://localhost:3000",
    os.getenv("FRONTEND_URL", ""),
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o for o in allowed_origins if o],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(onboarding_router)
app.include_router(agent_router)
app.include_router(tasks_router)
app.include_router(study_router)
app.include_router(whiteboard_router)


@app.get("/health")
def health():
    return {"status": "ok"}
