const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const DATA_DIR = path.join(__dirname, "data");
const DB_PATH = process.env.PORTAIL_DB_PATH || path.join(DATA_DIR, "portail.db");
const LEGACY_STORE_PATH = process.env.PORTAIL_STORE_PATH || path.join(DATA_DIR, "store.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function openDatabase() {
  ensureDataDir();
  const db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  createSchema(db);
  ensurePatientColumns(db);
  backfillPatientsFromLegacyStore(db);
  return db;
}

function createSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS patients (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      dossier TEXT NOT NULL UNIQUE,
      phone TEXT,
      birth_date TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS biologists (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS protocols (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('open', 'answered', 'closed')),
      collected_at TEXT,
      pdf_url TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      protocol_id TEXT NOT NULL REFERENCES protocols(id) ON DELETE CASCADE,
      author_role TEXT NOT NULL CHECK (author_role IN ('patient', 'biologist')),
      author_id TEXT NOT NULL,
      author_name TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_protocols_patient_updated
      ON protocols(patient_id, updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_protocols_status_updated
      ON protocols(status, updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_messages_protocol_created
      ON messages(protocol_id, created_at ASC);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_patients_phone_unique
      ON patients(phone)
      WHERE phone IS NOT NULL AND phone <> '';
  `);
}

function ensurePatientColumns(db) {
  const columns = db.prepare("PRAGMA table_info(patients)").all();
  const columnNames = new Set(columns.map((column) => column.name));
  if (!columnNames.has("phone")) {
    db.exec("ALTER TABLE patients ADD COLUMN phone TEXT;");
  }
}

function defaultDossierForPatient(patient) {
  const suffix = String(patient.id || "patient").replace(/[^A-Za-z0-9]/g, "").slice(-10) || "patient";
  return `AUTO-${suffix}`;
}

function backfillPatientsFromLegacyStore(db) {
  if (!fs.existsSync(LEGACY_STORE_PATH)) return;
  const store = loadStoreFromFile(LEGACY_STORE_PATH);
  const updatePatient = db.prepare(
    "UPDATE patients SET phone = COALESCE(NULLIF(?, ''), phone), dossier = COALESCE(NULLIF(?, ''), dossier) WHERE id = ? AND ((phone IS NULL OR phone = '') OR (dossier IS NULL OR dossier = ''))"
  );
  withTransaction(db, () => {
    for (const patient of store.patients) {
      if (!patient || !patient.id) continue;
      updatePatient.run(patient.phone || "", patient.dossier || "", patient.id);
    }
  });
}

function normalizeStore(store) {
  const safe = store && typeof store === "object" ? store : {};
  return {
    patients: Array.isArray(safe.patients) ? safe.patients : [],
    biologists: Array.isArray(safe.biologists) ? safe.biologists : [],
    protocols: Array.isArray(safe.protocols) ? safe.protocols : [],
    messages: Array.isArray(safe.messages) ? safe.messages : []
  };
}

function withTransaction(db, run) {
  db.exec("BEGIN");
  try {
    const result = run();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // No-op rollback fallback.
    }
    throw error;
  }
}

function clearAll(db) {
  db.exec("DELETE FROM messages;");
  db.exec("DELETE FROM protocols;");
  db.exec("DELETE FROM biologists;");
  db.exec("DELETE FROM patients;");
}

function loadStoreFromFile(storePath = LEGACY_STORE_PATH) {
  if (!fs.existsSync(storePath)) {
    throw new Error(`Fichier introuvable: ${storePath}`);
  }
  const raw = fs.readFileSync(storePath, "utf8");
  const parsed = JSON.parse(raw);
  return normalizeStore(parsed);
}

function seedFromStore(db, store, options = {}) {
  const { clearBefore = false } = options;
  const normalized = normalizeStore(store);

  return withTransaction(db, () => {
    if (clearBefore) {
      clearAll(db);
    }

    const insertPatient = db.prepare(
      "INSERT OR REPLACE INTO patients (id, full_name, dossier, phone, birth_date) VALUES (?, ?, ?, ?, ?)"
    );
    const insertBiologist = db.prepare(
      "INSERT OR REPLACE INTO biologists (id, display_name, username, password) VALUES (?, ?, ?, ?)"
    );
    const insertProtocol = db.prepare(
      "INSERT OR REPLACE INTO protocols (id, patient_id, title, status, collected_at, pdf_url, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    const insertMessage = db.prepare(
      "INSERT OR REPLACE INTO messages (id, protocol_id, author_role, author_id, author_name, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );

    for (const patient of normalized.patients) {
      if (!patient || !patient.id || !patient.full_name || !patient.birth_date) continue;
      insertPatient.run(
        patient.id,
        patient.full_name,
        patient.dossier || defaultDossierForPatient(patient),
        patient.phone || "",
        patient.birth_date
      );
    }

    for (const biologist of normalized.biologists) {
      if (!biologist || !biologist.id || !biologist.display_name || !biologist.username || !biologist.password) continue;
      insertBiologist.run(biologist.id, biologist.display_name, biologist.username, biologist.password);
    }

    for (const protocol of normalized.protocols) {
      if (!protocol || !protocol.id || !protocol.patient_id || !protocol.title || !protocol.status || !protocol.updated_at) continue;
      insertProtocol.run(
        protocol.id,
        protocol.patient_id,
        protocol.title,
        String(protocol.status).toLowerCase(),
        protocol.collected_at || "",
        protocol.pdf_url || "",
        protocol.updated_at
      );
    }

    for (const message of normalized.messages) {
      if (
        !message ||
        !message.id ||
        !message.protocol_id ||
        !message.author_role ||
        !message.author_id ||
        !message.author_name ||
        !message.body ||
        !message.created_at
      ) {
        continue;
      }
      insertMessage.run(
        message.id,
        message.protocol_id,
        String(message.author_role).toLowerCase(),
        message.author_id,
        message.author_name,
        message.body,
        message.created_at
      );
    }

    return {
      patients: normalized.patients.length,
      biologists: normalized.biologists.length,
      protocols: normalized.protocols.length,
      messages: normalized.messages.length
    };
  });
}

function isEmpty(db) {
  const row = db.prepare("SELECT COUNT(*) AS total FROM patients").get();
  return Number(row && row.total ? row.total : 0) === 0;
}

function seedFromLegacyIfEmpty(db, storePath = LEGACY_STORE_PATH) {
  if (!isEmpty(db)) {
    return { seeded: false, reason: "already-initialized" };
  }
  if (!fs.existsSync(storePath)) {
    return { seeded: false, reason: "missing-store" };
  }
  const store = loadStoreFromFile(storePath);
  const stats = seedFromStore(db, store, { clearBefore: false });
  return {
    seeded: true,
    reason: "seeded-from-store",
    sourcePath: storePath,
    stats
  };
}

module.exports = {
  DB_PATH,
  LEGACY_STORE_PATH,
  openDatabase,
  loadStoreFromFile,
  seedFromStore,
  seedFromLegacyIfEmpty
};
