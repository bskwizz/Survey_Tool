'use strict';

const { SynthesisProvider } = require('./SynthesisProvider');

const SYSTEM_PROMPT = `You are an assistant helping a classroom instructor understand open-text
survey responses in real time. You will be given the survey question, the
PREVIOUS synthesis (a JSON object, or null if this is the first batch), and a
list of NEW responses received since that previous synthesis was produced.

Your job: produce an UPDATED synthesis that incorporates the new responses
into the existing themes/findings - do NOT start over or ignore the previous
synthesis. Merge, refine, and re-prioritize as needed, but preserve prior
insights that are still valid.

Respond with STRICT JSON only (no prose, no markdown fences), matching this
exact shape:
{
  "themes": string[],
  "agreements": string[],
  "disagreements": string[],
  "misconceptions": string[],
  "outliers": string[],
  "emergingPatterns": string[],
  "suggestedDiscussionQuestions": string[] // exactly 3 to 5 items
}`;

/**
 * OpenAiSynthesisProvider
 * -------------------------
 * Calls an OpenAI-compatible Chat Completions endpoint (works with OpenAI
 * itself, Azure OpenAI via a compatible base URL, or any self-hosted
 * OpenAI-API-compatible server) to produce/update the open-text synthesis.
 *
 * Config (all from environment, see .env.example):
 *   AI_API_KEY       - bearer token for the Authorization header
 *   AI_API_BASE_URL  - e.g. https://api.openai.com/v1
 *   AI_MODEL         - e.g. gpt-4o-mini
 *
 * Request: POST {AI_API_BASE_URL}/chat/completions
 *   { model, messages: [system, user], temperature, response_format }
 * Response: standard Chat Completions shape; we read
 *   response.choices[0].message.content and parse it as JSON, with a
 *   tolerant fallback parser (see `parseModelJson`) in case the model wraps
 *   the JSON in prose or markdown fences despite instructions.
 */
class OpenAiSynthesisProvider extends SynthesisProvider {
  constructor({ apiKey, baseUrl, model, fetchImpl = globalThis.fetch }) {
    super();
    if (!apiKey) {
      throw new Error(
        'OpenAiSynthesisProvider requires an API key (set AI_API_KEY in the environment)'
      );
    }
    if (!fetchImpl) {
      throw new Error(
        'global fetch is unavailable in this Node runtime; upgrade to Node 18+ or inject fetchImpl'
      );
    }
    this.apiKey = apiKey;
    this.baseUrl = (baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    this.model = model || 'gpt-4o-mini';
    this.fetch = fetchImpl;
  }

  async synthesize({ prompt, previousSynthesis, newResponseTexts }) {
    const userPayload = {
      surveyQuestion: prompt,
      previousSynthesis: previousSynthesis || null,
      newResponses: newResponseTexts,
    };

    const body = {
      model: this.model,
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(userPayload) },
      ],
    };

    const res = await this.fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await safeText(res);
      throw new Error(`AI synthesis request failed (${res.status}): ${errText}`);
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('AI synthesis response had no message content');
    }

    const parsed = parseModelJson(content);
    const prevCount = previousSynthesis?.responseCountIncluded || 0;

    return {
      themes: asArray(parsed.themes),
      agreements: asArray(parsed.agreements),
      disagreements: asArray(parsed.disagreements),
      misconceptions: asArray(parsed.misconceptions),
      outliers: asArray(parsed.outliers),
      emergingPatterns: asArray(parsed.emergingPatterns),
      suggestedDiscussionQuestions: asArray(parsed.suggestedDiscussionQuestions).slice(0, 5),
      responseCountIncluded: prevCount + newResponseTexts.length,
      generatedBy: 'openai',
      generatedAt: new Date().toISOString(),
    };
  }
}

/**
 * Robust JSON parsing for LLM output: tries direct JSON.parse first, then
 * falls back to stripping common markdown code-fence wrappers and finally
 * to extracting the first {...} block via regex before giving up.
 */
function parseModelJson(content) {
  try {
    return JSON.parse(content);
  } catch (_err) {
    // fallthrough to fallback strategies
  }

  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch (_err) {
      // fallthrough
    }
  }

  const braceMatch = content.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try {
      return JSON.parse(braceMatch[0]);
    } catch (_err) {
      // fallthrough
    }
  }

  throw new Error('Could not parse JSON from AI synthesis response');
}

function asArray(value) {
  return Array.isArray(value) ? value.filter((v) => typeof v === 'string') : [];
}

async function safeText(res) {
  try {
    return await res.text();
  } catch (_err) {
    return '<unreadable error body>';
  }
}

module.exports = { OpenAiSynthesisProvider, parseModelJson };
