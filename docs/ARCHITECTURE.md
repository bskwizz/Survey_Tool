# Architecture

## 1. High-level system diagram

```
                         ┌─────────────────────────────┐
                         │   PowerPoint (desktop app)   │
                         │  ┌────────────────────────┐  │
                         │  │  Task Pane Add-in       │  │
                         │  │  (Office.js, HTML/JS)   │  │
                         │  │  - create question      │  │
                         │  │  - insert QR + text box  │  │
                         │  │  - start/stop/refresh    │  │
                         │  └───────────┬────────────┘  │
                         └──────────────┼───────────────┘
                                        │ HTTPS (REST) + Socket.IO
                                        ▼
        ┌────────────────────────────────────────────────────────┐
        │                    Backend (Node.js)                    │
        │  Express REST API   +   Socket.IO server                │
        │                                                          │
        │  ┌───────────┐  ┌────────────┐  ┌──────────────────┐    │
        │  │ Auth       │  │ Question   │  │ Synthesis         │    │
        │  │ (JWT/bcrypt│  │ Types      │  │ Manager           │    │
        │  │  )         │  │ registry   │  │ (batching)        │    │
        │  └───────────┘  └────────────┘  └─────────┬─────────┘    │
        │                                            │ pluggable    │
        │                                    ┌────────▼─────────┐   │
        │                                    │ SynthesisProvider │   │
        │                                    │  Mock | OpenAI    │   │
        │                                    └───────────────────┘   │
        │  ┌────────────────────────────────────────────────────┐   │
        │  │        Repository interface (storage-agnostic)      │   │
        │  │        JsonFileRepository  |  SqliteRepository       │   │
        │  └────────────────────────────────────────────────────┘   │
        └───────────────────────────┬──────────────────────────────┘
                                     │ HTTPS + Socket.IO
                 ┌───────────────────┼────────────────────┐
                 ▼                                        ▼
     ┌───────────────────────┐               ┌───────────────────────────┐
     │ Participant web app    │               │ Instructor dashboard       │
     │ (phones, no login)     │               │ (laptop, authenticated)    │
     │ - answer question      │               │ - create/edit questions    │
     │ - see live aggregate    │               │ - start/stop/clear         │
     │ - stays live for next Q │               │ - view synthesis           │
     └───────────────────────┘               └───────────────────────────┘
```

## 2. Data flow: a single response, end to end

```
participant phone           backend                         instructor / slide
      │                        │                                    │
      │  POST /api/responses   │                                    │
      ├───────────────────────▶│                                    │
      │                        │ 1. validate + normalize via         │
      │                        │    QuestionType.validateResponseValue│
      │                        │ 2. repository.createResponse()      │
      │                        │ 3. QuestionType.foldResponse()      │
      │                        │    (O(1) running counts, NOT a      │
      │                        │     full rescan of all responses)   │
      │                        │ 4. repository.saveAggregate()       │
      │                        │ 5. io.to(question:<id>)             │
      │                        │      .emit('response:new', agg) ───┼──▶ live bar chart updates
      │◀───── 201 + aggregate ─┤                                    │    instantly (dashboard +
      │                        │ 6. IF open_text:                    │    task pane "Refresh")
      │                        │    synthesisManager.enqueue(...)    │
      │                        │    (buffers; does NOT synthesize    │
      │                        │     on every single response)       │
      │                        │                                    │
      │                        │  ... batch trigger (N responses     │
      │                        │      or T seconds) ...              │
      │                        │                                    │
      │                        │ 7. provider.synthesize({             │
      │                        │      prompt,                        │
      │                        │      previousSynthesis,   <— only    │
      │                        │      newResponseTexts })  <— NEW     │
      │                        │ 8. repository.saveSynthesis()       │
      │                        │ 9. io.emit('synthesis:updated') ────┼──▶ dashboard/add-in refresh
      │                        │                                    │
```

## 3. Why streaming aggregation instead of full rescans

For multiple-choice and rating questions, `aggregation/streamingAggregator.js`
maintains running `counts` and a running `_sum` (rating average) per
question. Every new response performs O(1) work:

- increment the relevant option's count,
- recompute `distribution` (O(number of options), not O(number of
  responses)),
- recompute normalized Shannon entropy / "top option share" from the
  counts map alone.

This means a question with 5,000 responses costs exactly the same per-new-
response work as one with 5 responses. The full response history is never
walked to answer "what's the current state?" - the aggregate document *is*
the current state, updated incrementally.

## 4. Incremental synthesis batching strategy (open text)

Naively re-running an LLM prompt over the *entire* response history on every
new reply is both slow (grows with N) and expensive (token cost grows with
N). Instead, `synthesis/synthesisManager.js` implements:

1. New open-text responses accumulate in a small in-memory per-question
   buffer as they arrive.
2. A batch is flushed - triggering exactly one `provider.synthesize()` call
   - when either:
   - the buffer reaches `SYNTHESIS_BATCH_SIZE` new responses, or
   - `SYNTHESIS_BATCH_INTERVAL_MS` has elapsed since the first buffered
     response arrived,
   whichever happens first.
3. The provider call receives **only** the new batch's texts, plus the
   **previous synthesis JSON** (or `null` on the first batch), and is asked
   to produce an **updated** synthesis - not regenerate everything from
   scratch. This keeps both the LLM's context window and the cost of each
   call bounded and roughly constant, independent of total response count.
4. The updated `SynthesisSnapshot` (with an incremented `version` and
   `lastResponseIdIncluded`) is persisted and broadcast via
   `synthesis:updated`.

This contract is enforced identically by both `MockSynthesisProvider` (pure
local word-frequency clustering, merges new pseudo-themes into the previous
list) and `OpenAiSynthesisProvider` (the system prompt explicitly instructs
the model to merge/update rather than restart) - see
`synthesis/SynthesisProvider.js` for the shared interface.

## 5. QuestionType strategy/plugin pattern

`questionTypes/QuestionType.js` defines the interface every question type
implements: `validateDefinition`, `validateResponseValue`,
`createEmptyAggregate`, `foldResponse`. Concrete types
(`MultipleChoiceType`, `RatingType`, `OpenTextType`) register themselves with
`questionTypes/registry.js`. Routes, the aggregator, and the synthesis
manager all look up behavior via `registry.get(question.type)` - none of them
contain a type-specific `if/else` or `switch`. Adding a new question type
(e.g. "word cloud", "ranking", "slider") is a matter of adding one new file
and one `registry.register(...)` call; no existing logic needs to change.

## 6. Storage engine abstraction

`db/repository.js` defines the full storage contract as an abstract base
class. Two implementations exist:

- `db/jsonStore.js` - `JsonFileRepository`, a dependency-free single-JSON-
  file store. **This is the default** (`STORAGE_ENGINE=json`) because it has
  zero native dependencies and "just works" in any Node 18+ environment,
  including sandboxes where native addon compilation (`better-sqlite3`) may
  fail.
- `db/sqliteStore.js` - `SqliteRepository`, backed by `better-sqlite3`.
  Enable with `STORAGE_ENGINE=sqlite` for a real production workload. The
  factory in `db/index.js` gracefully falls back to the JSON store if the
  native module fails to load, so misconfiguration never hard-crashes the
  app.

Nothing outside `db/` needs to know which engine is active.

## 7. PowerPoint Slide Show limitation (and workaround)

See the file-level comment block at the top of
`powerpoint-addin/taskpane.js` for the full explanation, summarized here:

Office.js task panes - and every PowerPoint JS API call that writes to a
slide (`PowerPoint.run`, `shape.textFrame.textRange.text = ...`,
`slide.shapes.addImage`, etc.) - **only function while PowerPoint is in
Normal/Editing view**. Once the presenter starts a full-screen Slide Show
("Presented by a speaker" mode), the task pane surface is not rendered at
all, and none of these calls can execute, because full-screen Slide Show is
a separate rendering surface with no add-in host.

**Workaround:** use PowerPoint's "Set Up Slide Show" > "Browsed by an
individual (window)" mode instead of the default full-screen mode. In
windowed/browsed presentation mode, PowerPoint retains its normal
application chrome (ribbon, task panes), so the Live Classroom Survey task
pane remains usable throughout the presentation - the instructor can click
"Refresh slide now" to pull the latest aggregate/synthesis onto the slide's
placeholder shapes while presenting. There is no supported way to run task
pane JavaScript during a true full-screen Slide Show; this should be
communicated clearly to instructors during onboarding (see `README.md`'s
MVP checklist).

## 8. Why a single-file "App" skill/tool could not implement this

This product fundamentally requires **multiple independently-deployed
runtime surfaces that must communicate over a live, stateful network
channel**, which a single generated file (or even a single static web app)
cannot provide:

1. **A stateful backend process is mandatory.** Real-time aggregation
   (`response:new`), duplicate-submission prevention, JWT auth, and the
   Socket.IO room model all require a long-lived server process holding
   in-memory + persisted state shared across many concurrent phone clients
   and the instructor's dashboard. A static single-file app has no server
   component and cannot hold shared, authoritative state.
2. **PowerPoint add-ins are a distinct host/runtime with its own manifest,
   security sandbox, and API surface** (`office.js`, `PowerPoint.run`,
   the unified manifest schema, Microsoft 365 sideloading/publishing
   pipeline). This is fundamentally different from, and cannot be emulated
   by, a generic browser-hosted "app" - it requires PowerPoint itself (or
   Office Online) as the host, a `manifest.xml`, HTTPS hosting with valid
   certs, and (for production) publisher verification / admin center
   deployment.
3. **Two different audiences need two different trust levels and UIs at the
   same time**: authenticated instructors (JWT, CRUD, moderation) and fully
   anonymous participants (no login, rate-limited, duplicate-guarded) must
   be served concurrently from the same live data, which requires real
   session/auth middleware layered over shared persisted state - not
   something a single client-side file can enforce, since all its logic
   would be visible/forgeable by the browser running it.
4. **The incremental AI synthesis pipeline requires server-side scheduling**
   (batch-by-count-or-time timers per question, calling out to an LLM
   provider with server-held API keys) that must run continuously in the
   background independent of whether any particular browser tab is open -
   this is inherently a backend responsibility, not something a single
   static file/app can own safely (an API key can never be shipped to a
   client-side single-file app without exposing it to every participant's
   phone).

In short: the product spec requires an actual multi-service architecture
(backend + 2 frontends + a distinct Office host integration), coordinated
over real-time sockets and persisted state - which is what this repository
implements, and what a single generated file/app fundamentally cannot be.
