'use strict';

const { SynthesisProvider } = require('./SynthesisProvider');

const STOPWORDS = new Set(
  ('the a an and or but if of to in on for with is are was were be been being ' +
    'this that these those it its i we you they he she them us our your ' +
    'not no yes so as at by from about into over after before than then ' +
    'can could should would will just very really also more most much many')
    .split(' ')
);

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w) && w.length > 2);
}

/**
 * MockSynthesisProvider
 * -----------------------
 * Deterministic, fully local, no-external-calls synthesis implementation.
 * Used as the default so the app runs and demonstrates the end-to-end
 * "open text -> AI-style synthesis" pipeline without requiring any external
 * account or API key. Clusters responses into pseudo-themes purely via
 * word-frequency, and merges incrementally with any previous synthesis so
 * the same "batch new responses, update rather than regenerate" contract as
 * OpenAiSynthesisProvider is honored (proves the incremental architecture
 * works independent of which provider is plugged in).
 */
class MockSynthesisProvider extends SynthesisProvider {
  async synthesize({ prompt, previousSynthesis, newResponseTexts }) {
    const wordFreq = new Map();
    for (const text of newResponseTexts) {
      for (const word of tokenize(text)) {
        wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
      }
    }

    const sortedWords = Array.from(wordFreq.entries()).sort((a, b) => b[1] - a[1]);
    const topWords = sortedWords.slice(0, 8).map(([w]) => w);

    // Group responses into pseudo-themes by which top word they contain most.
    const themeBuckets = new Map();
    for (const text of newResponseTexts) {
      const tokens = new Set(tokenize(text));
      const matchedWord = topWords.find((w) => tokens.has(w));
      const key = matchedWord || 'general';
      if (!themeBuckets.has(key)) themeBuckets.set(key, []);
      themeBuckets.get(key).push(text);
    }

    const newThemes = Array.from(themeBuckets.entries())
      .filter(([, texts]) => texts.length > 0)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 6)
      .map(([word, texts]) => `"${word}" (mentioned in ${texts.length} response(s))`);

    // Outliers: responses that shared no top word with anyone else in this batch.
    const newOutliers = newResponseTexts
      .filter((text) => {
        const tokens = new Set(tokenize(text));
        return !topWords.some((w) => tokens.has(w));
      })
      .slice(0, 3)
      .map((t) => truncate(t));

    const prev = previousSynthesis || {
      themes: [],
      agreements: [],
      disagreements: [],
      misconceptions: [],
      outliers: [],
      emergingPatterns: [],
      suggestedDiscussionQuestions: [],
      responseCountIncluded: 0,
    };

    const mergedThemes = dedupeMerge(prev.themes, newThemes, 8);
    const totalCount = prev.responseCountIncluded + newResponseTexts.length;

    // Simple heuristics for agreement/disagreement/misconceptions, derived
    // from repeated vs. singleton top words in this batch (deterministic,
    // not a real NLP judgment - clearly a demo/dev-mode approximation).
    const agreementCandidates = sortedWords.filter(([, count]) => count >= Math.max(2, newResponseTexts.length * 0.3));
    const newAgreements = agreementCandidates
      .slice(0, 3)
      .map(([w, c]) => `Multiple participants (${c}) referenced "${w}"`);

    const disagreementNote =
      newOutliers.length > 0
        ? [`${newOutliers.length} response(s) diverged from the majority phrasing/topics this batch`]
        : [];

    const emergingPatterns =
      topWords.length > 0
        ? [`Recurring vocabulary this batch: ${topWords.slice(0, 5).join(', ')}`]
        : [];

    const questions = buildDiscussionQuestions(prompt, topWords);

    return {
      themes: mergedThemes,
      agreements: dedupeMerge(prev.agreements, newAgreements, 6),
      disagreements: dedupeMerge(prev.disagreements, disagreementNote, 6),
      misconceptions: dedupeMerge(
        prev.misconceptions,
        [], // Mock provider makes no claim to detect misconceptions reliably.
        6
      ),
      outliers: dedupeMerge(prev.outliers, newOutliers, 6),
      emergingPatterns: dedupeMerge(prev.emergingPatterns, emergingPatterns, 6),
      suggestedDiscussionQuestions: questions,
      responseCountIncluded: totalCount,
      generatedBy: 'mock',
      generatedAt: new Date().toISOString(),
    };
  }
}

function truncate(text, max = 120) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function dedupeMerge(prevList, newList, max) {
  const merged = [...prevList];
  for (const item of newList) {
    if (!merged.includes(item)) merged.push(item);
  }
  return merged.slice(-max);
}

function buildDiscussionQuestions(prompt, topWords) {
  const base = [
    `What common ground do you see across responses to "${prompt}"?`,
    topWords[0]
      ? `Why do you think "${topWords[0]}" came up so often?`
      : 'What surprised you most about these responses?',
    'Which response challenges your own assumptions the most, and why?',
    'Where do you see the biggest disagreement, and what might explain it?',
    'What follow-up question would help clarify the more ambiguous answers?',
  ];
  return base.slice(0, 5);
}

module.exports = { MockSynthesisProvider };
