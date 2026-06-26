// src/db.js
// Capa de acceso a datos. Usa better-sqlite3 (síncrono, simple, robusto).
// La base de datos se guarda en un archivo local: data/licenses.db
//
// IMPORTANTE sobre Render (o cualquier hosting "efímero"):
// Si usas el plan gratuito de Render, el disco se reinicia en cada deploy
// salvo que configures un "Persistent Disk". Más detalles en el README.

const path = require("path");
const Database = require("better-sqlite3");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "data", "licenses.db");

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS licenses (
    code TEXT PRIMARY KEY,
    max_machines INTEGER NOT NULL CHECK (max_machines IN (1, 3)),
    note TEXT,
    revoked INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS activations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    license_code TEXT NOT NULL,
    machine_id TEXT NOT NULL,
    activated_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (license_code, machine_id),
    FOREIGN KEY (license_code) REFERENCES licenses(code)
  );

  CREATE INDEX IF NOT EXISTS idx_activations_code ON activations(license_code);
`);

// ---------- Licencias ----------

function createLicense(code, maxMachines, note) {
  const stmt = db.prepare(
    `INSERT INTO licenses (code, max_machines, note) VALUES (?, ?, ?)`
  );
  stmt.run(code, maxMachines, note || null);
  return getLicense(code);
}

function getLicense(code) {
  return db.prepare(`SELECT * FROM licenses WHERE code = ?`).get(code);
}

function listLicenses() {
  return db.prepare(`SELECT * FROM licenses ORDER BY created_at DESC`).all();
}

function revokeLicense(code, revoked = 1) {
  db.prepare(`UPDATE licenses SET revoked = ? WHERE code = ?`).run(revoked ? 1 : 0, code);
  return getLicense(code);
}

// ---------- Activaciones ----------

function getActivations(code) {
  return db
    .prepare(`SELECT * FROM activations WHERE license_code = ? ORDER BY activated_at ASC`)
    .all(code);
}

function getActivation(code, machineId) {
  return db
    .prepare(`SELECT * FROM activations WHERE license_code = ? AND machine_id = ?`)
    .get(code, machineId);
}

function countActivations(code) {
  const row = db
    .prepare(`SELECT COUNT(*) as count FROM activations WHERE license_code = ?`)
    .get(code);
  return row.count;
}

function createActivation(code, machineId) {
  db.prepare(
    `INSERT INTO activations (license_code, machine_id) VALUES (?, ?)`
  ).run(code, machineId);
  return getActivation(code, machineId);
}

function touchActivation(code, machineId) {
  db.prepare(
    `UPDATE activations SET last_seen_at = datetime('now') WHERE license_code = ? AND machine_id = ?`
  ).run(code, machineId);
}

function removeActivation(code, machineId) {
  db.prepare(
    `DELETE FROM activations WHERE license_code = ? AND machine_id = ?`
  ).run(code, machineId);
}

module.exports = {
  db,
  createLicense,
  getLicense,
  listLicenses,
  revokeLicense,
  getActivations,
  getActivation,
  countActivations,
  createActivation,
  touchActivation,
  removeActivation,
};
