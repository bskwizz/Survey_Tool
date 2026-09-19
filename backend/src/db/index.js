'use strict';

const fs = require('fs');
const config = require('../config');
const { JsonFileRepository } = require('./jsonStore');

/**
 * Repository factory. Chooses a storage engine based on config.storageEngine
 * ('json' | 'sqlite') and falls back safely to the JSON store if the SQLite
 * native module isn't available (e.g. sandboxed environments where the
 * native addon failed to build). This keeps `npm start` working everywhere.
 */
function createRepository() {
  if (!fs.existsSync(config.dataDir)) {
    fs.mkdirSync(config.dataDir, { recursive: true });
  }

  if (config.storageEngine === 'sqlite') {
    try {
      // eslint-disable-next-line global-require
      const { SqliteRepository } = require('./sqliteStore');
      return new SqliteRepository({ dataDir: config.dataDir });
    } catch (err) {
      console.warn(
        '[db] STORAGE_ENGINE=sqlite requested but better-sqlite3 is unavailable ' +
          `(${err.message}). Falling back to the JSON file store.`
      );
    }
  }

  return new JsonFileRepository({ dataDir: config.dataDir });
}

module.exports = { createRepository };
