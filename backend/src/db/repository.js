'use strict';

/**
 * Repository interface (abstract base class).
 *
 * All storage engines (JSON-file, SQLite, ...) must implement this exact
 * surface so the rest of the application (routes, sockets, synthesis
 * manager, aggregator) never needs to know which engine is active.
 *
 * Every method here throws "not implemented" - concrete subclasses override
 * all of them. This keeps swapping storage engines a one-line config change
 * (`STORAGE_ENGINE=json|sqlite`) with zero changes anywhere else.
 */
class Repository {
  // ---- Instructors ----
  async createInstructor(_instructor) { throw new Error('not implemented'); }
  async getInstructorByEmail(_email) { throw new Error('not implemented'); }
  async getInstructorById(_id) { throw new Error('not implemented'); }

  // ---- Presentations ----
  async createPresentation(_presentation) { throw new Error('not implemented'); }
  async getPresentation(_id) { throw new Error('not implemented'); }
  async listPresentationsByInstructor(_instructorId) { throw new Error('not implemented'); }

  // ---- Questions ----
  async createQuestion(_question) { throw new Error('not implemented'); }
  async getQuestion(_id) { throw new Error('not implemented'); }
  async updateQuestion(_id, _patch) { throw new Error('not implemented'); }
  async listQuestionsByPresentation(_presentationId) { throw new Error('not implemented'); }
  async deleteQuestion(_id) { throw new Error('not implemented'); }

  // ---- Responses ----
  async createResponse(_response) { throw new Error('not implemented'); }
  async getResponse(_id) { throw new Error('not implemented'); }
  async listResponsesByQuestion(_questionId, _opts) { throw new Error('not implemented'); }
  async countResponsesByQuestion(_questionId) { throw new Error('not implemented'); }
  async hasParticipantAnswered(_questionId, _participantToken) { throw new Error('not implemented'); }
  async clearResponsesForQuestion(_questionId) { throw new Error('not implemented'); }

  // ---- Participant Sessions ----
  async upsertParticipantSession(_token) { throw new Error('not implemented'); }
  async touchParticipantSession(_token) { throw new Error('not implemented'); }
  async getParticipantSession(_token) { throw new Error('not implemented'); }

  // ---- Aggregates (streaming, per-question running counters) ----
  async getAggregate(_questionId) { throw new Error('not implemented'); }
  async saveAggregate(_questionId, _aggregate) { throw new Error('not implemented'); }

  // ---- Synthesis Snapshots ----
  async getLatestSynthesis(_questionId) { throw new Error('not implemented'); }
  async saveSynthesis(_snapshot) { throw new Error('not implemented'); }
}

module.exports = { Repository };
