'use strict';

const config = require('../config');
const { MockSynthesisProvider } = require('./MockSynthesisProvider');
const { OpenAiSynthesisProvider } = require('./OpenAiSynthesisProvider');

/**
 * SynthesisManager
 * ------------------
 * Owns the incremental/rolling batching strategy described in the product
 * spec:
 *   - New open-text responses accumulate in a per-question pending buffer.
 *   - A synthesis run is triggered when EITHER:
 *       (a) the pending buffer reaches `synthesisBatchSize` new responses, OR
 *       (b) `synthesisBatchIntervalMs` has elapsed since a response first
 *           entered the (currently empty) buffer,
 *     whichever comes first - so bursts get processed quickly but a single
 *     trickle-in response is never left un-synthesized for too long.
 *   - Each run calls `provider.synthesize()` with ONLY the pending batch
 *     plus the previous synthesis snapshot, never the full response history,
 *     which is what keeps this cheap regardless of total response count.
 *   - The provider is selected once via config/env (mock by default so the
 *     app works fully offline).
 */
class SynthesisManager {
  constructor({ repository, io, provider = null }) {
    this.repository = repository;
    this.io = io;
    this.provider = provider || SynthesisManager.buildProviderFromConfig();
    // questionId -> { texts: string[], responseIds: string[], timer: NodeJS.Timeout | null }
    this._pending = new Map();
    this._runningLock = new Set(); // questionIds currently mid-synthesis, to avoid overlapping runs
  }

  static buildProviderFromConfig() {
    if (config.synthesisProvider === 'openai') {
      try {
        return new OpenAiSynthesisProvider({
          apiKey: config.aiApiKey,
          baseUrl: config.aiApiBaseUrl,
          model: config.aiModel,
        });
      } catch (err) {
        console.warn(
          `[synthesis] Failed to initialize OpenAiSynthesisProvider (${err.message}). ` +
            'Falling back to MockSynthesisProvider.'
        );
        return new MockSynthesisProvider();
      }
    }
    return new MockSynthesisProvider();
  }

  /** Call whenever a new open-text response is persisted. */
  enqueue(questionId, responseText, responseId) {
    let bucket = this._pending.get(questionId);
    if (!bucket) {
      bucket = { texts: [], responseIds: [], timer: null };
      this._pending.set(questionId, bucket);
    }
    bucket.texts.push(responseText);
    bucket.responseIds.push(responseId);

    if (bucket.texts.length >= config.synthesisBatchSize) {
      this._flush(questionId);
      return;
    }

    if (!bucket.timer) {
      bucket.timer = setTimeout(() => this._flush(questionId), config.synthesisBatchIntervalMs);
      if (bucket.timer.unref) bucket.timer.unref();
    }
  }

  async _flush(questionId) {
    const bucket = this._pending.get(questionId);
    if (!bucket || bucket.texts.length === 0) return;
    if (this._runningLock.has(questionId)) return; // a run is already in-flight; batch will pick up next tick

    if (bucket.timer) {
      clearTimeout(bucket.timer);
      bucket.timer = null;
    }
    const { texts, responseIds } = bucket;
    this._pending.delete(questionId);
    this._runningLock.add(questionId);

    try {
      const question = await this.repository.getQuestion(questionId);
      if (!question) return;
      const previous = await this.repository.getLatestSynthesis(questionId);
      const previousSummary = previous ? previous.summaryJson : null;

      const summaryJson = await this.provider.synthesize({
        prompt: question.prompt,
        previousSynthesis: previousSummary,
        newResponseTexts: texts,
      });

      const snapshot = {
        questionId,
        version: (previous?.version || 0) + 1,
        summaryJson,
        lastResponseIdIncluded: responseIds[responseIds.length - 1],
        updatedAt: new Date().toISOString(),
      };
      await this.repository.saveSynthesis(snapshot);

      if (this.io) {
        this.io.to(roomForQuestion(questionId)).emit('synthesis:updated', snapshot);
      }
    } catch (err) {
      console.error(`[synthesis] Batch run failed for question ${questionId}:`, err.message);
      // Re-queue the failed batch's texts so they aren't silently dropped.
      const retryBucket = this._pending.get(questionId) || { texts: [], responseIds: [], timer: null };
      retryBucket.texts = [...texts, ...retryBucket.texts];
      retryBucket.responseIds = [...responseIds, ...retryBucket.responseIds];
      this._pending.set(questionId, retryBucket);
    } finally {
      this._runningLock.delete(questionId);
    }
  }

  /** Force an immediate flush (e.g. instructor manually clicks "regenerate now"). */
  async flushNow(questionId) {
    await this._flush(questionId);
  }
}

function roomForQuestion(questionId) {
  return `question:${questionId}`;
}

module.exports = { SynthesisManager, roomForQuestion };
