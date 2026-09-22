'use strict';

/**
 * Centralized configuration loader.
 * Loads environment variables via dotenv and exposes a single frozen config
 * object so the rest of the app never touches `process.env` directly.
 */

const path = require('path');
const dotenv = require('dotenv');

// Load `.env` from the backend/ directory (or repo root if run from there).
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
dotenv.config(); // fallback: also allow a .env in CWD without overriding existing vars

function bool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const config = Object.freeze({
  port: num(process.env.PORT, 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  publicBaseUrl: process.env.PUBLIC_BASE_URL || 'http://localhost:3000',

  jwtSecret: process.env.JWT_SECRET || 'dev-only-insecure-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '30d',
  participantTokenSecret:
    process.env.PARTICIPANT_TOKEN_SECRET || 'dev-only-insecure-participant-secret-change-me',

  corsOrigin: process.env.CORS_ORIGIN || '*',

  storageEngine: (process.env.STORAGE_ENGINE || 'json').toLowerCase(), // 'json' | 'sqlite'
  dataDir: process.env.DATA_DIR || path.resolve(__dirname, '..', 'data'),

  synthesisProvider: (process.env.SYNTHESIS_PROVIDER || 'mock').toLowerCase(), // 'mock' | 'anthropic' | 'openai'
  aiApiKey: process.env.AI_API_KEY || '',
  aiApiBaseUrl: process.env.AI_API_BASE_URL || 'https://api.openai.com/v1',
  aiModel: process.env.AI_MODEL || '', // provider-specific default applies when empty
  aiEffort: process.env.AI_EFFORT || 'low',

  synthesisBatchSize: num(process.env.SYNTHESIS_BATCH_SIZE, 5),
  synthesisBatchIntervalMs: num(process.env.SYNTHESIS_BATCH_INTERVAL_MS, 8000),

  rateLimitWindowMs: num(process.env.RATE_LIMIT_WINDOW_MS, 60000),
  rateLimitMax: num(process.env.RATE_LIMIT_MAX, 120),

  isProduction: (process.env.NODE_ENV || 'development') === 'production',
});

module.exports = config;
