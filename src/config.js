'use strict';
/**
 * PASAR MINI - Konfigurasi terpusat.
 * MODE=db     : PostgreSQL produksi (DATABASE_URL).
 * MODE=file   : penyimpanan internal JSON (fallback otomatis bila Postgres/Redis tidak tersedia,
 *               atau dipaksa dengan DB_MODE=file). Data persisten di ./data/db.json.
 */
const path = require('path');

const env = process.env;
let forcedMode = (env.DB_MODE || 'auto').toLowerCase(); // auto | db | file

async function probePostgres(url) {
  const { Client } = require('pg');
  const c = new Client({ connectionString: url, connectionTimeoutMillis: 2500 });
  await c.connect(); await c.end();
}

async function init() {
  const databaseUrl = env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/pasar_mini';
  let useDb = false;
  if (forcedMode !== 'file') {
    try { await probePostgres(databaseUrl); useDb = true; }
    catch (e) {
      if (forcedMode === 'db') throw e;
      console.warn('[config] PostgreSQL tidak tersedia (' + e.code + ') -> memakai storage engine internal (file).');
    }
  }
  let redisOk = false;
  if (useDb && env.REDIS_URL) {
    try {
      const Redis = require('ioredis');
      const r = new Redis(env.REDIS_URL, { lazyConnect: true, connectTimeout: 2000 });
      await r.connect(); r.disconnect(); redisOk = true;
    } catch (e) { console.warn('[config] Redis tidak tersedia -> cache in-memory.'); }
  }
  module.exports.state = {
    mode: useDb ? 'db' : 'file',
    databaseUrl,
    redisUrl: redisOk ? env.REDIS_URL : null,
    jwtSecret: env.JWT_SECRET || 'pasar-mini-dev-secret-ubah-di-produksi',
    jwtDays: Number(env.JWT_DAYS || 7),
    port: Number(env.PORT || 3000),
    uploadDir: path.join(__dirname, '..', 'uploads'),
    dataDir: path.join(__dirname, '..', 'data'),
    ocrApiKey: env.OCR_API_KEY || null, // Google Cloud Vision API key (opsional)
    company: env.COMPANY_NAME || 'PASAR MINI',
  };
  return module.exports.state;
}

module.exports = { init, get state() { return module.exports.state; }, state: {} };
