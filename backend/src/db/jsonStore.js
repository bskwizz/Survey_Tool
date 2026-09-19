'use strict';

const fs = require('fs');
const path = require('path');
const { Repository } = require('./repository');

/**
 * JsonFileRepository
 * -------------------
 * A dependency-free storage engine backed by a single JSON file on disk.
 *
 * WHY THIS IS THE DEFAULT:
 *  - `better-sqlite3` is a native addon; in restricted/offline sandboxes
 *    `npm install` can fail to build it, which would break the whole app.
 *  - `sql.js` (WASM SQLite) avoids native compilation but adds a nontrivial
 *    dependency + manual persistence-to-disk dance for very little benefit
 *    at classroom-demo scale (hundreds of responses per session, not millions).
 *  - A JSON-file store "just works" everywhere Node runs, has zero extra
 *    dependencies, and is trivially inspectable/debuggable.
 *
 * All data lives in memory (loaded once at boot) and is flushed to disk
 * on every mutating call. This is intentionally simple and fully adequate
 * for a live-classroom-sized workload. For heavier production workloads,
 * see `sqliteStore.js`, which implements the exact same `Repository`
 * interface - swap via `STORAGE_ENGINE=sqlite` with no other code changes.
 */
class JsonFileRepository extends Repository {
  constructor({ dataDir }) {
    super();
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'db.json');
    this._data = this._load();
    this._writeScheduled = false;
  }

  _defaultData() {
    return {
      instructors: [],
      presentations: [],
      questions: [],
      responses: [],
      participantSessions: [],
      aggregates: {}, // questionId -> aggregate object
      synthesisSnapshots: {}, // questionId -> latest snapshot
    };
  }

  _load() {
    try {
      if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });
      if (fs.existsSync(this.file)) {
        const raw = fs.readFileSync(this.file, 'utf-8');
        return { ...this._defaultData(), ...JSON.parse(raw) };
      }
    } catch (err) {
      console.error('[jsonStore] failed to load existing data, starting fresh:', err.message);
    }
    return this._defaultData();
  }

  _persist() {
    // Synchronous write is fine at this scale and keeps behavior predictable
    // (no torn reads between async flush and next request).
    fs.writeFileSync(this.file, JSON.stringify(this._data, null, 2), 'utf-8');
  }

  // ---- Instructors ----
  async createInstructor(instructor) {
    this._data.instructors.push(instructor);
    this._persist();
    return instructor;
  }

  async getInstructorByEmail(email) {
    return this._data.instructors.find((i) => i.email.toLowerCase() === email.toLowerCase()) || null;
  }

  async getInstructorById(id) {
    return this._data.instructors.find((i) => i.id === id) || null;
  }

  // ---- Presentations ----
  async createPresentation(presentation) {
    this._data.presentations.push(presentation);
    this._persist();
    return presentation;
  }

  async getPresentation(id) {
    return this._data.presentations.find((p) => p.id === id) || null;
  }

  async listPresentationsByInstructor(instructorId) {
    return this._data.presentations.filter((p) => p.instructorId === instructorId);
  }

  // ---- Questions ----
  async createQuestion(question) {
    this._data.questions.push(question);
    this._persist();
    return question;
  }

  async getQuestion(id) {
    return this._data.questions.find((q) => q.id === id) || null;
  }

  async updateQuestion(id, patch) {
    const q = this._data.questions.find((x) => x.id === id);
    if (!q) return null;
    Object.assign(q, patch, { updatedAt: new Date().toISOString() });
    this._persist();
    return q;
  }

  async listQuestionsByPresentation(presentationId) {
    return this._data.questions.filter((q) => q.presentationId === presentationId);
  }

  async deleteQuestion(id) {
    this._data.questions = this._data.questions.filter((q) => q.id !== id);
    this._data.responses = this._data.responses.filter((r) => r.questionId !== id);
    delete this._data.aggregates[id];
    delete this._data.synthesisSnapshots[id];
    this._persist();
    return true;
  }

  // ---- Responses ----
  async createResponse(response) {
    this._data.responses.push(response);
    this._persist();
    return response;
  }

  async getResponse(id) {
    return this._data.responses.find((r) => r.id === id) || null;
  }

  async listResponsesByQuestion(questionId, opts = {}) {
    const { afterId = null, limit = null, offset = 0 } = opts;
    let list = this._data.responses.filter((r) => r.questionId === questionId);
    list.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    if (afterId) {
      const idx = list.findIndex((r) => r.id === afterId);
      list = idx >= 0 ? list.slice(idx + 1) : list;
    } else if (offset) {
      list = list.slice(offset);
    }
    if (limit) list = list.slice(0, limit);
    return list;
  }

  async countResponsesByQuestion(questionId) {
    return this._data.responses.filter((r) => r.questionId === questionId).length;
  }

  async hasParticipantAnswered(questionId, participantToken) {
    return this._data.responses.some(
      (r) => r.questionId === questionId && r.participantToken === participantToken
    );
  }

  async clearResponsesForQuestion(questionId) {
    this._data.responses = this._data.responses.filter((r) => r.questionId !== questionId);
    delete this._data.aggregates[questionId];
    delete this._data.synthesisSnapshots[questionId];
    this._persist();
    return true;
  }

  // ---- Participant Sessions ----
  async upsertParticipantSession(token) {
    let session = this._data.participantSessions.find((s) => s.token === token);
    const now = new Date().toISOString();
    if (!session) {
      session = { token, createdAt: now, lastSeenAt: now };
      this._data.participantSessions.push(session);
    } else {
      session.lastSeenAt = now;
    }
    this._persist();
    return session;
  }

  async touchParticipantSession(token) {
    return this.upsertParticipantSession(token);
  }

  async getParticipantSession(token) {
    return this._data.participantSessions.find((s) => s.token === token) || null;
  }

  // ---- Aggregates ----
  async getAggregate(questionId) {
    return this._data.aggregates[questionId] || null;
  }

  async saveAggregate(questionId, aggregate) {
    this._data.aggregates[questionId] = aggregate;
    this._persist();
    return aggregate;
  }

  // ---- Synthesis Snapshots ----
  async getLatestSynthesis(questionId) {
    return this._data.synthesisSnapshots[questionId] || null;
  }

  async saveSynthesis(snapshot) {
    this._data.synthesisSnapshots[snapshot.questionId] = snapshot;
    this._persist();
    return snapshot;
  }
}

module.exports = { JsonFileRepository };
