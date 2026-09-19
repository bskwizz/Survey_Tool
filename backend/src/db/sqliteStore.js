'use strict';

const path = require('path');
const { Repository } = require('./repository');

/**
 * SqliteRepository
 * -----------------
 * Optional storage engine using `better-sqlite3` (a native addon). Enable
 * with `STORAGE_ENGINE=sqlite`. Implements the exact same `Repository`
 * surface as `JsonFileRepository`, so nothing else in the app changes.
 *
 * `better-sqlite3` is declared as an `optionalDependency` in package.json:
 * if the native build fails in a given sandbox/CI environment, `npm install`
 * will not hard-fail, and the app simply falls back to the JSON store
 * (see `index.js` factory logic).
 */
class SqliteRepository extends Repository {
  constructor({ dataDir }) {
    super();
    // Lazy require so environments without the native module never crash
    // unless STORAGE_ENGINE=sqlite is explicitly requested.
    // eslint-disable-next-line global-require
    const Database = require('better-sqlite3');
    const file = path.join(dataDir, 'db.sqlite3');
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this._migrate();
  }

  _migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS instructors (
        id TEXT PRIMARY KEY, email TEXT UNIQUE, passwordHash TEXT, createdAt TEXT
      );
      CREATE TABLE IF NOT EXISTS presentations (
        id TEXT PRIMARY KEY, instructorId TEXT, title TEXT, createdAt TEXT
      );
      CREATE TABLE IF NOT EXISTS questions (
        id TEXT PRIMARY KEY, presentationId TEXT, slideRef TEXT, type TEXT,
        prompt TEXT, optionsJson TEXT, status TEXT, showSynthesisOnSlide INTEGER,
        shortCode TEXT, createdAt TEXT, updatedAt TEXT
      );
      CREATE TABLE IF NOT EXISTS responses (
        id TEXT PRIMARY KEY, questionId TEXT, participantToken TEXT, valueJson TEXT, createdAt TEXT
      );
      CREATE TABLE IF NOT EXISTS participant_sessions (
        token TEXT PRIMARY KEY, createdAt TEXT, lastSeenAt TEXT
      );
      CREATE TABLE IF NOT EXISTS aggregates (
        questionId TEXT PRIMARY KEY, aggregateJson TEXT
      );
      CREATE TABLE IF NOT EXISTS synthesis_snapshots (
        questionId TEXT PRIMARY KEY, snapshotJson TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_responses_question ON responses(questionId);
      CREATE INDEX IF NOT EXISTS idx_questions_presentation ON questions(presentationId);
    `);
  }

  async createInstructor(instructor) {
    this.db
      .prepare('INSERT INTO instructors (id, email, passwordHash, createdAt) VALUES (?,?,?,?)')
      .run(instructor.id, instructor.email, instructor.passwordHash, instructor.createdAt);
    return instructor;
  }

  async getInstructorByEmail(email) {
    return (
      this.db.prepare('SELECT * FROM instructors WHERE lower(email) = lower(?)').get(email) || null
    );
  }

  async getInstructorById(id) {
    return this.db.prepare('SELECT * FROM instructors WHERE id = ?').get(id) || null;
  }

  async createPresentation(presentation) {
    this.db
      .prepare('INSERT INTO presentations (id, instructorId, title, createdAt) VALUES (?,?,?,?)')
      .run(presentation.id, presentation.instructorId, presentation.title, presentation.createdAt);
    return presentation;
  }

  async getPresentation(id) {
    return this.db.prepare('SELECT * FROM presentations WHERE id = ?').get(id) || null;
  }

  async listPresentationsByInstructor(instructorId) {
    return this.db
      .prepare('SELECT * FROM presentations WHERE instructorId = ?')
      .all(instructorId);
  }

  _rowToQuestion(row) {
    if (!row) return null;
    return {
      ...row,
      options: JSON.parse(row.optionsJson || '[]'),
      showSynthesisOnSlide: !!row.showSynthesisOnSlide,
    };
  }

  async createQuestion(question) {
    this.db
      .prepare(
        `INSERT INTO questions
        (id, presentationId, slideRef, type, prompt, optionsJson, status, showSynthesisOnSlide, shortCode, createdAt, updatedAt)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        question.id,
        question.presentationId,
        question.slideRef,
        question.type,
        question.prompt,
        JSON.stringify(question.options || []),
        question.status,
        question.showSynthesisOnSlide ? 1 : 0,
        question.shortCode,
        question.createdAt,
        question.updatedAt
      );
    return question;
  }

  async getQuestion(id) {
    return this._rowToQuestion(this.db.prepare('SELECT * FROM questions WHERE id = ?').get(id));
  }

  async updateQuestion(id, patch) {
    const existing = await this.getQuestion(id);
    if (!existing) return null;
    const merged = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    this.db
      .prepare(
        `UPDATE questions SET presentationId=?, slideRef=?, type=?, prompt=?, optionsJson=?,
         status=?, showSynthesisOnSlide=?, shortCode=?, updatedAt=? WHERE id=?`
      )
      .run(
        merged.presentationId,
        merged.slideRef,
        merged.type,
        merged.prompt,
        JSON.stringify(merged.options || []),
        merged.status,
        merged.showSynthesisOnSlide ? 1 : 0,
        merged.shortCode,
        merged.updatedAt,
        id
      );
    return merged;
  }

  async listQuestionsByPresentation(presentationId) {
    return this.db
      .prepare('SELECT * FROM questions WHERE presentationId = ?')
      .all(presentationId)
      .map((r) => this._rowToQuestion(r));
  }

  async deleteQuestion(id) {
    this.db.prepare('DELETE FROM questions WHERE id = ?').run(id);
    this.db.prepare('DELETE FROM responses WHERE questionId = ?').run(id);
    this.db.prepare('DELETE FROM aggregates WHERE questionId = ?').run(id);
    this.db.prepare('DELETE FROM synthesis_snapshots WHERE questionId = ?').run(id);
    return true;
  }

  async createResponse(response) {
    this.db
      .prepare(
        'INSERT INTO responses (id, questionId, participantToken, valueJson, createdAt) VALUES (?,?,?,?,?)'
      )
      .run(
        response.id,
        response.questionId,
        response.participantToken,
        JSON.stringify(response.value),
        response.createdAt
      );
    return response;
  }

  _rowToResponse(row) {
    if (!row) return null;
    return { ...row, value: JSON.parse(row.valueJson) };
  }

  async getResponse(id) {
    return this._rowToResponse(this.db.prepare('SELECT * FROM responses WHERE id = ?').get(id));
  }

  async listResponsesByQuestion(questionId, opts = {}) {
    const { limit = null, offset = 0 } = opts;
    let sql = 'SELECT * FROM responses WHERE questionId = ? ORDER BY createdAt ASC';
    const params = [questionId];
    if (limit) {
      sql += ' LIMIT ? OFFSET ?';
      params.push(limit, offset);
    }
    return this.db
      .prepare(sql)
      .all(...params)
      .map((r) => this._rowToResponse(r));
  }

  async countResponsesByQuestion(questionId) {
    const row = this.db
      .prepare('SELECT COUNT(*) as c FROM responses WHERE questionId = ?')
      .get(questionId);
    return row.c;
  }

  async hasParticipantAnswered(questionId, participantToken) {
    const row = this.db
      .prepare('SELECT 1 FROM responses WHERE questionId = ? AND participantToken = ? LIMIT 1')
      .get(questionId, participantToken);
    return !!row;
  }

  async clearResponsesForQuestion(questionId) {
    this.db.prepare('DELETE FROM responses WHERE questionId = ?').run(questionId);
    this.db.prepare('DELETE FROM aggregates WHERE questionId = ?').run(questionId);
    this.db.prepare('DELETE FROM synthesis_snapshots WHERE questionId = ?').run(questionId);
    return true;
  }

  async upsertParticipantSession(token) {
    const now = new Date().toISOString();
    const existing = this.db
      .prepare('SELECT * FROM participant_sessions WHERE token = ?')
      .get(token);
    if (existing) {
      this.db
        .prepare('UPDATE participant_sessions SET lastSeenAt = ? WHERE token = ?')
        .run(now, token);
      return { ...existing, lastSeenAt: now };
    }
    const session = { token, createdAt: now, lastSeenAt: now };
    this.db
      .prepare('INSERT INTO participant_sessions (token, createdAt, lastSeenAt) VALUES (?,?,?)')
      .run(token, now, now);
    return session;
  }

  async touchParticipantSession(token) {
    return this.upsertParticipantSession(token);
  }

  async getParticipantSession(token) {
    return this.db.prepare('SELECT * FROM participant_sessions WHERE token = ?').get(token) || null;
  }

  async getAggregate(questionId) {
    const row = this.db
      .prepare('SELECT aggregateJson FROM aggregates WHERE questionId = ?')
      .get(questionId);
    return row ? JSON.parse(row.aggregateJson) : null;
  }

  async saveAggregate(questionId, aggregate) {
    const json = JSON.stringify(aggregate);
    this.db
      .prepare(
        `INSERT INTO aggregates (questionId, aggregateJson) VALUES (?,?)
         ON CONFLICT(questionId) DO UPDATE SET aggregateJson = excluded.aggregateJson`
      )
      .run(questionId, json);
    return aggregate;
  }

  async getLatestSynthesis(questionId) {
    const row = this.db
      .prepare('SELECT snapshotJson FROM synthesis_snapshots WHERE questionId = ?')
      .get(questionId);
    return row ? JSON.parse(row.snapshotJson) : null;
  }

  async saveSynthesis(snapshot) {
    const json = JSON.stringify(snapshot);
    this.db
      .prepare(
        `INSERT INTO synthesis_snapshots (questionId, snapshotJson) VALUES (?,?)
         ON CONFLICT(questionId) DO UPDATE SET snapshotJson = excluded.snapshotJson`
      )
      .run(snapshot.questionId, json);
    return snapshot;
  }
}

module.exports = { SqliteRepository };
