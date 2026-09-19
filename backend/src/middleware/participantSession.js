'use strict';

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');

/**
 * Anonymous participant session handling.
 *
 * On first visit (`/api/join`), we issue an opaque token of the form
 * `<uuid>.<hmac-signature>`. The client stores this verbatim in
 * localStorage (see frontend/participant/app.js) and sends it back on every
 * subsequent request (header `x-participant-token`, or cookie fallback).
 * We verify the HMAC signature on every request so the token cannot be
 * forged client-side, without needing a DB round-trip just to validate it
 * (we still persist a ParticipantSession row for lastSeenAt bookkeeping and
 * duplicate-submission checks, but validity itself is stateless).
 *
 * No personal information is ever collected - the token is a random,
 * unlinkable identifier scoped to "this browser used this app before".
 */
function sign(uuid) {
  return crypto.createHmac('sha256', config.participantTokenSecret).update(uuid).digest('hex');
}

function issueToken() {
  const id = uuidv4();
  return `${id}.${sign(id)}`;
}

function isValidToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return false;
  const [id, sig] = token.split('.');
  if (!id || !sig) return false;
  const expected = sign(id);
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch (_err) {
    return false; // length mismatch etc.
  }
}

/**
 * Express middleware: reads the participant token from header/cookie/body,
 * validates its signature, and attaches `req.participantToken`. Does NOT
 * require a token to be present (some routes, like /api/join, issue the
 * first one) - routes that need a participant identity should check
 * `req.participantToken` themselves and 401 if missing.
 */
function participantSessionMiddleware(req, res, next) {
  const headerToken = req.headers['x-participant-token'];
  const cookieToken = req.cookies ? req.cookies.participantToken : undefined;
  const bodyToken = req.body ? req.body.participantToken : undefined;
  const token = headerToken || cookieToken || bodyToken;

  if (token && isValidToken(token)) {
    req.participantToken = token;
  } else {
    req.participantToken = null;
  }
  next();
}

module.exports = { participantSessionMiddleware, issueToken, isValidToken };
