# Live Classroom Survey

A real-time, anonymous audience-response system for classrooms, integrated
directly into PowerPoint via an Office.js task-pane Add-in. Instructors
create a question for the current slide, PowerPoint gets a QR code +
short URL, students scan and answer on their phones (no login, no account),
and results - including AI-assisted synthesis of open-text answers - update
live on the slide and on an instructor dashboard.

## What's included

```
classroom-survey/
├── backend/                  Node.js + Express + Socket.IO API server
├── frontend/participant/     Mobile-first static web app for students
├── frontend/instructor-dashboard/  Static web app for instructors
├── powerpoint-addin/         Office.js task-pane Add-in (manifest + taskpane)
├── docs/                     ARCHITECTURE.md and DEPLOYMENT.md
├── package.json               root npm workspaces config
└── .env.example                environment variable template (no real secrets)
```

## Prerequisites

- Node.js **18+** and npm
- (Optional, local dev) PowerPoint desktop or PowerPoint on the web, for
  sideloading the add-in
- (Optional) An OpenAI-compatible API key if you want real AI synthesis
  instead of the built-in deterministic Mock provider

## Quickstart (local dev)

```bash
# 1. Install dependencies (workspaces install backend + both frontends)
npm install

# 2. Configure environment
cp .env.example backend/.env
# edit backend/.env - at minimum, set JWT_SECRET and PARTICIPANT_TOKEN_SECRET
# to random values. Leave SYNTHESIS_PROVIDER=mock to run fully offline.

# 3. Start the backend (Express + Socket.IO on PORT, default 3000)
npm run dev
# -> backend/src/index.js listens on http://localhost:3000

# 4. In separate terminals, serve the two static frontends
npm run dev --workspace=frontend/participant          # http://localhost:5173
npm run dev --workspace=frontend/instructor-dashboard  # http://localhost:5174

# 5. Open the instructor dashboard, register an account, create a
#    presentation + question, then open the participant URL it gives you
#    (or scan its QR code) on your phone to answer.
```

### Running the PowerPoint Add-in locally

Office Add-ins require HTTPS, including in local dev:

```bash
npx office-addin-dev-certs install
```

Serve `powerpoint-addin/` over HTTPS (e.g. behind the same host as the
backend, or any static HTTPS file server) so it matches the URLs in
`powerpoint-addin/manifest.xml`. Then sideload it:

1. PowerPoint > **Insert > My Add-ins > Upload My Add-in**
2. Select `powerpoint-addin/manifest.xml`
3. Click the new "Live Survey" button on the Home ribbon tab to open the
   task pane, sign in with the instructor account you registered on the
   dashboard, and create a question for the current slide.

See `docs/DEPLOYMENT.md` for full production deployment steps (Azure App
Service for the backend, Azure Static Web Apps for the frontends,
Microsoft 365 admin center for org-wide add-in publishing).

## Architecture at a glance

- **Storage:** pluggable `Repository` interface; defaults to a
  dependency-free JSON-file store (`STORAGE_ENGINE=json`), with an optional
  `better-sqlite3`-backed engine (`STORAGE_ENGINE=sqlite`) available without
  changing any other code.
- **Question types:** a `QuestionType` strategy/plugin pattern
  (`backend/src/questionTypes/`) - multiple choice, rating, and open text
  ship out of the box; new types can be added without touching routes,
  aggregation, or synthesis code.
- **Quant aggregation:** O(1)-per-response streaming counters (never a full
  rescan), producing live percentages, distributions, and a normalized-
  entropy "consensus vs. disagreement" score.
- **Open-text synthesis:** a pluggable `SynthesisProvider` interface with a
  deterministic, offline `MockSynthesisProvider` (default) and an
  `OpenAiSynthesisProvider`. New responses are batched (by count or time)
  and synthesized **incrementally** - each run updates the previous
  synthesis using only the new responses, never regenerating from scratch.
- Full details, ASCII diagrams, and the PowerPoint Slide-Show limitation
  (and its "Browsed by an individual" workaround) are in
  `docs/ARCHITECTURE.md`.

## MVP success checklist

- [x] Instructor can register/login (bcrypt + JWT).
- [x] Instructor can create a multiple-choice, rating, or open-text question
      tied to a specific slide.
- [x] A QR code + short participant URL is generated per question.
- [x] Participants can scan, answer anonymously (no login), and are issued a
      persistent local device token so they can answer multiple questions
      during the same class without re-entering anything.
- [x] Duplicate submissions from the same participant token for the same
      question are rejected (409).
- [x] Quant responses update a live streaming aggregate (counts,
      percentages, distribution, consensus/entropy) pushed over Socket.IO.
- [x] Open-text responses are batched and incrementally synthesized into
      themes / agreements / disagreements / misconceptions / outliers /
      emerging patterns / 3-5 discussion questions.
- [x] Instructor dashboard: create/edit questions, start/stop/clear,
      live counts, raw responses, synthesis view, "show synthesis on slide"
      toggle.
- [x] PowerPoint task pane: create a question for the current slide, insert
      a QR image + result text box, Start/Stop, and "Refresh slide now".
- [x] Add-in code documents the Slide-Show limitation and its workaround.
- [x] No secrets committed; `.env.example` only, `.env` gitignored.

## License

MIT - see `LICENSE`.
