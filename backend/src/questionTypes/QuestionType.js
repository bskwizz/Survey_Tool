'use strict';

/**
 * QuestionType (strategy interface)
 * ----------------------------------
 * Every supported question type (multiple choice, rating, open text, and any
 * future type) implements this interface and self-registers with the
 * `registry` (see registry.js). Nothing in routes/, aggregation/, or
 * synthesis/ hard-codes a switch statement over type names - they all ask
 * the registry "give me the handler for this type" and call its methods.
 *
 * Adding a brand-new question type later (e.g. "word cloud", "ranking")
 * only requires:
 *   1. A new file in this folder implementing this interface.
 *   2. Registering it in registry.js.
 * No other core logic needs to change.
 */
class QuestionType {
  /** Unique machine name, e.g. "multiple_choice", "rating", "open_text". */
  get name() {
    throw new Error('QuestionType.name getter must be implemented');
  }

  /** Whether this type produces free-text responses requiring AI synthesis. */
  get isOpenEnded() {
    return false;
  }

  /**
   * Validate a question definition payload (prompt/options) at creation time.
   * Should throw a descriptive Error on invalid input.
   * @param {{prompt: string, options?: Array}} definition
   */
  validateDefinition(definition) {
    if (!definition || typeof definition.prompt !== 'string' || !definition.prompt.trim()) {
      throw new Error('Question prompt is required');
    }
  }

  /**
   * Validate + normalize an incoming response value before persistence.
   * @param {*} value - raw value submitted by a participant
   * @param {object} question - the question record (includes options)
   * @returns {*} normalized value to store
   */
  validateResponseValue(_value, _question) {
    throw new Error('validateResponseValue must be implemented');
  }

  /**
   * Return a fresh, empty aggregate structure for this question type. This
   * is the seed for the streaming aggregator's running counters.
   * @param {object} question
   */
  createEmptyAggregate(_question) {
    throw new Error('createEmptyAggregate must be implemented');
  }

  /**
   * Fold a single new (already-normalized) response value into the running
   * aggregate IN PLACE (O(1) - never rescans prior responses). Returns the
   * mutated aggregate for convenience.
   * @param {object} aggregate
   * @param {*} value
   */
  foldResponse(_aggregate, _value) {
    throw new Error('foldResponse must be implemented');
  }
}

module.exports = { QuestionType };
