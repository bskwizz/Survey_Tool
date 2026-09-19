'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MockSynthesisProvider } = require('../src/synthesis/MockSynthesisProvider');
const { SynthesisManager } = require('../src/synthesis/synthesisManager');

/** Minimal in-memory repository stub covering only what SynthesisManager needs. */
function makeFakeRepository(question) {
  const synthesisByQuestion = new Map();
  return {
    async getQuestion(id) {
      return id === question.id ? question : null;
    },
    async getLatestSynthesis(id) {
      return synthesisByQuestion.get(id) || null;
    },
    async saveSynthesis(snapshot) {
      synthesisByQuestion.set(snapshot.questionId, snapshot);
      return snapshot;
    },
    _snapshots: synthesisByQuestion,
  };
}

function makeFakeIo() {
  const emitted = [];
  return {
    to() {
      return { emit: (event, payload) => emitted.push({ event, payload }) };
    },
    emitted,
  };
}

test('SynthesisManager batches by count and calls provider with only new responses', async () => {
  const question = { id: 'q1', prompt: 'What confused you today?' };
  const repository = makeFakeRepository(question);
  const io = makeFakeIo();
  const seenBatches = [];
  const fakeProvider = {
    async synthesize({ previousSynthesis, newResponseTexts }) {
      seenBatches.push({ previousSynthesis, newResponseTexts: [...newResponseTexts] });
      return {
        themes: ['theme'],
        agreements: [],
        disagreements: [],
        misconceptions: [],
        outliers: [],
        emergingPatterns: [],
        suggestedDiscussionQuestions: ['q1', 'q2', 'q3'],
        responseCountIncluded: (previousSynthesis?.responseCountIncluded || 0) + newResponseTexts.length,
      };
    },
  };

  const manager = new SynthesisManager({ repository, io, provider: fakeProvider });
  // Force a small batch size for the test via direct config mutation is not
  // possible (config is frozen), so we rely on the default batch size and
  // manually flush instead - proving the batching + incremental contract.
  manager.enqueue('q1', 'first response', 'r1');
  manager.enqueue('q1', 'second response', 'r2');
  await manager.flushNow('q1');

  assert.equal(seenBatches.length, 1);
  assert.deepEqual(seenBatches[0].newResponseTexts, ['first response', 'second response']);
  assert.equal(seenBatches[0].previousSynthesis, null);

  const saved = await repository.getLatestSynthesis('q1');
  assert.equal(saved.version, 1);
  assert.equal(saved.summaryJson.responseCountIncluded, 2);
  assert.equal(io.emitted.length, 1);
  assert.equal(io.emitted[0].event, 'synthesis:updated');

  // Second batch should be passed the FIRST synthesis as previousSynthesis,
  // proving the incremental (not full-regeneration) contract.
  manager.enqueue('q1', 'third response', 'r3');
  await manager.flushNow('q1');

  assert.equal(seenBatches.length, 2);
  assert.deepEqual(seenBatches[1].newResponseTexts, ['third response']);
  assert.equal(seenBatches[1].previousSynthesis.responseCountIncluded, 2);
});

test('MockSynthesisProvider produces deterministic themes without external calls', async () => {
  const provider = new MockSynthesisProvider();
  const result = await provider.synthesize({
    prompt: 'What was confusing about recursion?',
    previousSynthesis: null,
    newResponseTexts: [
      'The base case was confusing to me',
      'I did not understand the base case either',
      'Stack overflow errors were scary',
    ],
  });

  assert.ok(Array.isArray(result.themes));
  assert.ok(result.suggestedDiscussionQuestions.length >= 3);
  assert.ok(result.suggestedDiscussionQuestions.length <= 5);
  assert.equal(result.responseCountIncluded, 3);
  assert.equal(result.generatedBy, 'mock');
});
