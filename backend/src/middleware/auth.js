'use strict';

const { verifyInstructorToken } = require('../auth/jwt');

/**
 * Requires a valid `Authorization: Bearer <jwt>` header issued to an
 * instructor account. Attaches `req.instructor = { id, email, role }`.
 */
function requireInstructorAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }
  try {
    const payload = verifyInstructorToken(token);
    req.instructor = { id: payload.sub, email: payload.email, role: payload.role };
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { requireInstructorAuth };
