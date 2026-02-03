from fastapi import FastAPI
from app.api.agent import router as agent_router
from app.api.tasks import router as tasks_router
from app.api.study import router as study_router
from app.api.integrations import router as integrations_router

app = FastAPI(title="Study Planner Agent")

app.include_router(agent_router)
app.include_router(tasks_router)
app.include_router(study_router)
app.include_router(integrations_router)

@app.get("/health")
def health():
    return {"status": "ok"}
