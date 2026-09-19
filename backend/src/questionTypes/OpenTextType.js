'use strict';

const { QuestionType } = require('./QuestionType');

/**
 * Open text question type. Aggregation here is intentionally lightweight
 * (just response count + a rolling list of recent raw texts for display) -
 * the real analytical work for this type happens asynchronously in
 * synthesis/synthesisManager.js, which batches new responses and asks a
 * SynthesisProvider to produce/update a qualitative summary. That keeps the
 * O(1) streaming aggregate path (used for every response, on every type)
 * cheap even for open text.
 */
class OpenTextType extends QuestionType {
  get name() {
    return 'open_text';
  }

  get isOpenEnded() {
    return true;
  }

  validateResponseValue(value) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error('Open text response must be a non-empty string');
    }
    const trimmed = value.trim();
    if (trimmed.length > 2000) {
      throw new Error('Open text response must be 2000 characters or fewer');
    }
    return trimmed;
  }

  createEmptyAggregate() {
    return {
      type: this.name,
      responseCount: 0,
      recentTexts: [], // capped rolling window, most recent last
    };
  }

  foldResponse(aggregate, value) {
    aggregate.responseCount += 1;
    aggregate.recentTexts.push(value);
    // Keep the aggregate itself small; full history is always available via
    // repository.listResponsesByQuestion for the synthesis batching job.
    if (aggregate.recentTexts.length > 50) {
      aggregate.recentTexts = aggregate.recentTexts.slice(-50);
    }
    return aggregate;
  }
}

module.exports = { OpenTextType };
