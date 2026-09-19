'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { registry } = require('../src/questionTypes/registry');
const { computeConsensus } = require('../src/aggregation/streamingAggregator');

test('registry exposes all three built-in question types', () => {
  const names = registry.list();
  assert.ok(names.includes('multiple_choice'));
  assert.ok(names.includes('rating'));
  assert.ok(names.includes('open_text'));
});

test('MultipleChoiceType folds responses incrementally with correct percentages', () => {
  const type = registry.get('multiple_choice');
  const question = { options: ['A', 'B', 'C'] };
  let aggregate = type.createEmptyAggregate(question);

  type.foldResponse(aggregate, 'A');
  type.foldResponse(aggregate, 'A');
  type.foldResponse(aggregate, 'B');

  assert.equal(aggregate.responseCount, 3);
  assert.equal(aggregate.counts.A, 2);
  assert.equal(aggregate.counts.B, 1);
  assert.equal(aggregate.counts.C, 0);
  assert.equal(aggregate.distribution.A.percentage, 66.67);
  assert.equal(aggregate.distribution.B.percentage, 33.33);
});

test('RatingType tracks a running average without rescanning', () => {
  const type = registry.get('rating');
  let aggregate = type.createEmptyAggregate();
  [4, 5, 3].forEach((v) => type.foldResponse(aggregate, type.validateResponseValue(v)));
  assert.equal(aggregate.responseCount, 3);
  assert.equal(aggregate.average, 4);
});

test('RatingType rejects out-of-range values', () => {
  const type = registry.get('rating');
  assert.throws(() => type.validateResponseValue(6));
  assert.throws(() => type.validateResponseValue(0));
  assert.throws(() => type.validateResponseValue('abc'));
});

test('computeConsensus returns high consensus for unanimous responses', () => {
  const { consensus, entropy } = computeConsensus({ A: 10, B: 0, C: 0 });
  assert.equal(consensus, 'high');
  assert.equal(entropy, 0);
});

test('computeConsensus returns low consensus for a uniform split', () => {
  const { consensus, entropy } = computeConsensus({ A: 10, B: 10, C: 10 });
  assert.equal(consensus, 'low');
  assert.equal(entropy, 1);
});

test('OpenTextType keeps a capped rolling window of recent texts', () => {
  const type = registry.get('open_text');
  let aggregate = type.createEmptyAggregate();
  for (let i = 0; i < 60; i++) {
    type.foldResponse(aggregate, type.validateResponseValue(`response ${i}`));
  }
  assert.equal(aggregate.responseCount, 60);
  assert.equal(aggregate.recentTexts.length, 50);
  assert.equal(aggregate.recentTexts[aggregate.recentTexts.length - 1], 'response 59');
});
