from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.agent import router as agent_router
from app.api.tasks import router as tasks_router
from app.api.study import router as study_router
from app.api.integrations import router as integrations_router
from app.api.onboarding import router as onboarding_router

app = FastAPI(title="Study Planner Agent")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(onboarding_router)
app.include_router(agent_router)
app.include_router(tasks_router)
app.include_router(study_router)
app.include_router(integrations_router)

@app.get("/health")
def health():
    return {"status": "ok"}
