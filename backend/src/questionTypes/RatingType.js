'use strict';

const { QuestionType } = require('./QuestionType');
const { foldCount } = require('../aggregation/streamingAggregator');

const MIN = 1;
const MAX = 5;

/** 1-5 rating scale question type. Options are implicit: "1".."5". */
class RatingType extends QuestionType {
  get name() {
    return 'rating';
  }

  validateDefinition(definition) {
    super.validateDefinition(definition);
    // Options are fixed for rating questions; ignore any provided options.
  }

  validateResponseValue(value) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < MIN || n > MAX) {
      throw new Error(`Rating value must be an integer between ${MIN} and ${MAX}`);
    }
    return n;
  }

  createEmptyAggregate() {
    const counts = {};
    for (let i = MIN; i <= MAX; i++) counts[String(i)] = 0;
    return {
      type: this.name,
      responseCount: 0,
      counts,
      distribution: {},
      entropy: 0,
      topOptionShare: 0,
      consensus: 'n/a',
      average: 0,
      _sum: 0, // internal running sum for O(1) average updates
    };
  }

  foldResponse(aggregate, value) {
    const key = String(value);
    aggregate._sum = (aggregate._sum || 0) + value;
    foldCount(aggregate, key);
    aggregate.average = Number((aggregate._sum / aggregate.responseCount).toFixed(2));
    return aggregate;
  }
}

module.exports = { RatingType, MIN, MAX };
