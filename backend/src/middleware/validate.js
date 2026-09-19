'use strict';

/**
 * Express middleware factory that validates `req.body` against a Zod schema.
 * On failure, responds 400 with a flattened error list. On success, replaces
 * `req.body` with the parsed (and thus type-coerced/defaulted) value.
 *
 * @param {import('zod').ZodSchema} schema
 */
function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: result.error.flatten(),
      });
    }
    req.body = result.data;
    return next();
  };
}

module.exports = { validateBody };
