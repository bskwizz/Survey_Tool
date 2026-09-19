'use strict';

/**
 * SynthesisProvider (pluggable interface)
 * -----------------------------------------
 * Any backend that can turn open-text survey responses into a qualitative
 * synthesis implements this interface. Selected via config/env
 * (`SYNTHESIS_PROVIDER=mock|openai`, default mock so the app runs fully
 * offline out of the box).
 *
 * Both the previous synthesis (if any) and only the NEW responses since the
 * last run are passed in - implementations should produce an UPDATED
 * synthesis rather than recomputing from the full response history, which
 * is what makes the incremental/rolling batching strategy in
 * synthesisManager.js cheap even as response counts grow.
 */
class SynthesisProvider {
  /**
   * @param {object} params
   * @param {string} params.prompt - the survey question prompt, for context
   * @param {object|null} params.previousSynthesis - prior SynthesisSnapshot.summaryJson, or null on first run
   * @param {string[]} params.newResponseTexts - only the responses added since previousSynthesis was produced
   * @returns {Promise<object>} the updated synthesis JSON, matching the shape:
   *   {
   *     themes: string[],
   *     agreements: string[],
   *     disagreements: string[],
   *     misconceptions: string[],
   *     outliers: string[],
   *     emergingPatterns: string[],
   *     suggestedDiscussionQuestions: string[], // 3-5 items
   *     responseCountIncluded: number,
   *   }
   */
  async synthesize({ prompt, previousSynthesis, newResponseTexts }) {
    throw new Error('synthesize() must be implemented by SynthesisProvider subclasses');
  }
}

module.exports = { SynthesisProvider };
