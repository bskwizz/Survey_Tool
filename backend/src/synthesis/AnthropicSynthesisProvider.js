'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const { SynthesisProvider } = require('./SynthesisProvider');

const SYSTEM_PROMPT = `You help a classroom instructor understand open-text survey responses
while class is in session. You receive the survey question, the PREVIOUS
synthesis (or null on the first batch), and only the NEW responses received
since that synthesis was produced.

Produce an UPDATED synthesis that folds the new responses into the existing
findings. Merge, refine, and re-prioritize, but keep prior insights that are
still valid rather than starting over. Write for an instructor glancing at a
slide: short, concrete phrases. Suggest 3 to 5 discussion questions.`;

const LIST_KEYS = [
  'themes',
  'agreements',
  'disagreements',
  'misconceptions',
  'outliers',
  'emergingPatterns',
  'suggestedDiscussionQuestions',
];

// Plain JSON Schema for structured outputs (kept independent of the zod
// major version the rest of the backend uses for request validation).
const SYNTHESIS_JSON_SCHEMA = {
  type: 'object',
  properties: Object.fromEntries(LIST_KEYS.map((k) => [k, { type: 'array', items: { type: 'string' } }])),
  required: LIST_KEYS,
  additionalProperties: false,
};

/**
 * AnthropicSynthesisProvider
 * ----------------------------
 * Calls Claude through the official Anthropic SDK and asks for a
 * schema-constrained JSON synthesis (structured outputs), so the reply is
 * guaranteed to parse and match the shape the rest of the app expects.
 *
 * Config (see .env.example):
 *   AI_API_KEY   - Anthropic API key. If unset, the SDK falls back to
 *                  ANTHROPIC_API_KEY or an `ant auth login` profile.
 *   AI_MODEL     - defaults to claude-opus-5
 *   AI_EFFORT    - low | medium | high (default low: the synthesis is a
 *                  short summarization and latency matters in class)
 */
class AnthropicSynthesisProvider extends SynthesisProvider {
  constructor({ apiKey, model, effort } = {}) {
    super();
    this.client = apiKey ? new Anthropic({ apiKey }) : new Anthropic();
    this.model = model || 'claude-opus-5';
    this.effort = effort || 'low';
  }

  async synthesize({ prompt, previousSynthesis, newResponseTexts }) {
    const userPayload = {
      surveyQuestion: prompt,
      previousSynthesis: previousSynthesis || null,
      newResponses: newResponseTexts,
    };

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      output_config: {
        effort: this.effort,
        format: { type: 'json_schema', schema: SYNTHESIS_JSON_SCHEMA },
      },
      messages: [{ role: 'user', content: JSON.stringify(userPayload) }],
    });

    if (response.stop_reason === 'refusal') {
      const detail = response.stop_details?.explanation || 'no explanation';
      throw new Error(`Claude declined to synthesize this batch (${detail})`);
    }

    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');
    const parsed = JSON.parse(text);

    const prevCount = previousSynthesis?.responseCountIncluded || 0;
    return {
      ...Object.fromEntries(LIST_KEYS.map((k) => [k, Array.isArray(parsed[k]) ? parsed[k] : []])),
      suggestedDiscussionQuestions: (parsed.suggestedDiscussionQuestions || []).slice(0, 5),
      responseCountIncluded: prevCount + newResponseTexts.length,
      generatedBy: 'anthropic',
      generatedAt: new Date().toISOString(),
    };
  }
}

module.exports = { AnthropicSynthesisProvider };
