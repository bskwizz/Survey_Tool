'use strict';

const crypto = require('crypto');

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'; // no 0/O/1/l/I

/** Generates a short, URL-safe, human-typeable code (default 6 chars). */
function generateShortCode(length = 6) {
  const bytes = crypto.randomBytes(length);
  let code = '';
  for (let i = 0; i < length; i++) {
    code += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return code;
}

/** Builds the full participant-facing join URL for a question. */
function buildParticipantUrl(baseUrl, shortCode, questionId) {
  const url = new URL(`/join/${shortCode}`, baseUrl);
  url.searchParams.set('q', questionId);
  return url.toString();
}

module.exports = { generateShortCode, buildParticipantUrl };
