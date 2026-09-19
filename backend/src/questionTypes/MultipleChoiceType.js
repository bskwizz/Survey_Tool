'use strict';

const { QuestionType } = require('./QuestionType');
const { foldCount } = require('../aggregation/streamingAggregator');

class MultipleChoiceType extends QuestionType {
  get name() {
    return 'multiple_choice';
  }

  validateDefinition(definition) {
    super.validateDefinition(definition);
    if (!Array.isArray(definition.options) || definition.options.length < 2) {
      throw new Error('Multiple choice questions require at least 2 options');
    }
    if (definition.options.some((o) => typeof o !== 'string' || !o.trim())) {
      throw new Error('All multiple choice options must be non-empty strings');
    }
  }

  validateResponseValue(value, question) {
    if (typeof value !== 'string' || !question.options.includes(value)) {
      throw new Error('Response value must match one of the question options');
    }
    return value;
  }

  createEmptyAggregate(question) {
    const counts = {};
    for (const opt of question.options) counts[opt] = 0;
    return {
      type: this.name,
      responseCount: 0,
      counts,
      distribution: {},
      entropy: 0,
      topOptionShare: 0,
      consensus: 'n/a',
    };
  }

  foldResponse(aggregate, value) {
    return foldCount(aggregate, value);
  }
}

module.exports = { MultipleChoiceType };
