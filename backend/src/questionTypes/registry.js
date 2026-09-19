'use strict';

const { MultipleChoiceType } = require('./MultipleChoiceType');
const { RatingType } = require('./RatingType');
const { OpenTextType } = require('./OpenTextType');

/**
 * QuestionType registry (plugin pattern).
 *
 * To add a new question type: implement the QuestionType interface in a new
 * file, then register an instance below with `register()`. Everything else
 * in the codebase (routes, aggregator, synthesis) looks types up by name via
 * `get(name)` / `list()` and never hard-codes a type-specific branch.
 */
class QuestionTypeRegistry {
  constructor() {
    this._types = new Map();
  }

  register(questionType) {
    this._types.set(questionType.name, questionType);
  }

  get(name) {
    const type = this._types.get(name);
    if (!type) throw new Error(`Unknown question type: "${name}"`);
    return type;
  }

  has(name) {
    return this._types.has(name);
  }

  list() {
    return Array.from(this._types.keys());
  }
}

const registry = new QuestionTypeRegistry();
registry.register(new MultipleChoiceType());
registry.register(new RatingType());
registry.register(new OpenTextType());

module.exports = { registry, QuestionTypeRegistry };
