# Study Planner Agent

An AI-powered study platform for university students. Turns lecture notes and past papers into a personalised, adaptive study experience — planning, practice, and games in one place.

Built by Siddhi and Heza.

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router), React, TypeScript, Tailwind CSS |
| Backend | FastAPI (Python), deployed on Vercel |
| Database / Auth / Storage | Supabase (PostgreSQL + Auth + Storage) |
| AI | Anthropic Claude (claude-sonnet-4-6) |

---

## Features

### Dashboard
- Daily task list pulled from the study plan
- Streak tracking and weekly activity graph (counts focus sessions, Gauntlet plays, and question answering)
- Stats: total focus minutes, tasks completed, day streak

### Study Plan
- AI generates a full task breakdown from a syllabus or course description
- Tasks scheduled across available days respecting exam dates and disruptions (blocked periods)
- Adaptive rescheduling: tell the agent what changed and it rebalances the remaining plan

### Focus (Pomodoro)
- Customisable Pomodoro timer (25/5, 50/10, or custom)
- Animated focus scenes: coffee pour, growing plant, candle — progress through stages as the session advances
- Space bar to start/pause; done screen with confetti

### Whiteboard
- Upload PDFs per module; multi-page note workspace
- AI chat grounded on the uploaded PDF
- Fork any note into a new page

### Flashcards
- Create and manage flashcard sets per module
- Flip cards, track progress through a set

### Question Bank
- **Past paper extraction** — upload a PDF exam paper; Claude extracts every question with model answers and topic labels
- **AI generation** — generate MCQ, short answer, essay, or mixed question sets from any uploaded lecture PDF; optionally specify count and custom instructions
- **Adaptive regeneration** — when regenerating, the prompt is automatically enriched with which topics the user got wrong or hasn't attempted yet
- **MCQ UI** — A/B/C/D option buttons, two-step select → Check flow, green/red reveal with explanation
- **Written answer grading** — Claude grades responses as Excellent / Good / Developing / Insufficient with constructive, second-person feedback
- **Session score tracking** — live score bar showing MCQ correct/total and average written grade across the session
- **Bank management** — view all banks per module, drill into a specific bank, delete banks

### Games
- **Goblet of Fire** — Socratic Q&A tutor powered by Claude. Upload a PDF, get broken into topics, earn stars per topic through back-and-forth discussion
- **Jeopardy** — Flashcard game-show mode; pick a set and race through questions

### Settings
- Profile management (name, degree, year)
- Manage courses and exam dates
- Add disruptions (blocked study periods)

---

## Project Structure

```
study-planner-agent/
├── backend/
│   ├── app/
│   │   ├── api/
│   │   │   ├── agent.py        # Study plan generation
│   │   │   ├── flashcards.py   # Flashcard CRUD
│   │   │   ├── onboarding.py   # Profile, courses, disruptions
│   │   │   ├── questions.py    # Question bank (extract, generate, grade)
│   │   │   ├── study.py        # Pomodoro, stats, rescheduling
│   │   │   ├── tasks.py        # Task CRUD
│   │   │   ├── tutor.py        # Gauntlet game (Socratic tutor)
│   │   │   └── whiteboard.py   # Notes, PDF chat
│   │   └── agent/
│   │       └── scheduler.py    # Deterministic scheduling engine
│   └── vercel.json
└── frontend/
    └── src/
        ├── app/
        │   ├── dashboard/      # Home dashboard
        │   ├── focus/          # Pomodoro timer + scenes
        │   ├── flashcards/     # Flashcard sets + Jeopardy
        │   ├── games/          # Game hub + Gauntlet
        │   ├── questions/      # Question bank
        │   ├── whiteboard/     # PDF notes workspace
        │   ├── modules/        # Course management
        │   └── settings/       # Profile + preferences
        └── lib/
            ├── api.js          # Typed API client
            ├── supabase.ts     # Supabase client
            └── noteRenderer.tsx # Markdown/note rendering
```

---

## Running Locally

### Backend
```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Requires `.env`:
```
SUPABASE_URL=...
SUPABASE_SERVICE_KEY=...
ANTHROPIC_API_KEY=...
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

Requires `.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
NEXT_PUBLIC_API_URL=http://localhost:8000
```
