const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { openDatabase, seedFromLegacyIfEmpty } = require("./db");

const PORT = Number(process.env.PORT || 8085);
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const SESSION_TTL_MS = 1000 * 60 * 60 * 8;

const sessions = new Map();
const db = openDatabase();
const seedResult = seedFromLegacyIfEmpty(db);

if (seedResult.seeded) {
  console.log(`SQLite seed effectue depuis ${seedResult.sourcePath}`);
}

const statements = {
  patientByLogin: db.prepare(
    "SELECT id, full_name, phone, dossier FROM patients WHERE phone = ? AND birth_date = ? LIMIT 1"
  ),
  patientByDossierLogin: db.prepare(
    "SELECT id, full_name, phone, dossier FROM patients WHERE lower(dossier) = lower(?) AND birth_date = ? LIMIT 1"
  ),
  biologistByLogin: db.prepare(
    "SELECT id, display_name, username FROM biologists WHERE username = ? AND password = ? LIMIT 1"
  ),
  patientById: db.prepare("SELECT id, full_name, dossier, phone FROM patients WHERE id = ? LIMIT 1"),
  biologistById: db.prepare("SELECT id, display_name, username FROM biologists WHERE id = ? LIMIT 1"),
  protocolById: db.prepare(
    "SELECT id, patient_id, title, status, collected_at, pdf_url, updated_at FROM protocols WHERE id = ? LIMIT 1"
  ),
  patientProtocols: db.prepare(
    "SELECT id, title, status, collected_at, pdf_url, updated_at FROM protocols WHERE patient_id = ? ORDER BY updated_at DESC"
  ),
  inboxAll: db.prepare(
    "SELECT p.id, p.patient_id, p.title, p.status, p.collected_at, p.pdf_url, p.updated_at, pt.full_name AS patient_name FROM protocols p JOIN patients pt ON pt.id = p.patient_id ORDER BY p.updated_at DESC"
  ),
  inboxByStatus: db.prepare(
    "SELECT p.id, p.patient_id, p.title, p.status, p.collected_at, p.pdf_url, p.updated_at, pt.full_name AS patient_name FROM protocols p JOIN patients pt ON pt.id = p.patient_id WHERE lower(p.status) = ? ORDER BY p.updated_at DESC"
  ),
  messagesByProtocol: db.prepare(
    "SELECT id, protocol_id, author_role, author_name, body, created_at FROM messages WHERE protocol_id = ? ORDER BY created_at ASC"
  ),
  insertMessage: db.prepare(
    "INSERT INTO messages (id, protocol_id, author_role, author_id, author_name, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ),
  updateProtocolStatus: db.prepare("UPDATE protocols SET status = ?, updated_at = ? WHERE id = ?"),
  adminPatientsAll: db.prepare(
    "SELECT id, full_name, dossier, phone, birth_date FROM patients ORDER BY full_name COLLATE NOCASE ASC"
  ),
  adminInsertPatient: db.prepare(
    "INSERT INTO patients (id, full_name, dossier, phone, birth_date) VALUES (?, ?, ?, ?, ?)"
  ),
  adminProtocolsAll: db.prepare(
    "SELECT p.id, p.patient_id, p.title, p.status, p.collected_at, p.pdf_url, p.updated_at, pt.full_name AS patient_name, pt.phone AS patient_phone, pt.dossier AS patient_dossier, COUNT(m.id) AS message_count FROM protocols p JOIN patients pt ON pt.id = p.patient_id LEFT JOIN messages m ON m.protocol_id = p.id GROUP BY p.id ORDER BY p.updated_at DESC"
  ),
  adminInsertProtocol: db.prepare(
    "INSERT INTO protocols (id, patient_id, title, status, collected_at, pdf_url, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  )
};

function nowIso() {
  return new Date().toISOString();
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function normalizeDateInput(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  let year = 0;
  let month = 0;
  let day = 0;

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    year = Number(isoMatch[1]);
    month = Number(isoMatch[2]);
    day = Number(isoMatch[3]);
  } else {
    const frMatch = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!frMatch) return null;
    day = Number(frMatch[1]);
    month = Number(frMatch[2]);
    year = Number(frMatch[3]);
  }

  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() + 1 !== month ||
    utc.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function normalizePhoneInput(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const hasPlusPrefix = raw.startsWith("+");
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  return hasPlusPrefix ? `+${digits}` : digits;
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(text);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1024 * 1024) {
        reject(new Error("Payload too large"));
      }
    });
    req.on("end", () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function createSession(role, userId) {
  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, {
    role,
    userId,
    expiresAt: Date.now() + SESSION_TTL_MS
  });
  return token;
}

function getSession(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return null;
  }
  return { token, ...session };
}

function ensureRole(req, role) {
  const session = getSession(req);
  if (!session || session.role !== role) return null;
  return session;
}

function publicPathFromUrl(urlPath) {
  let decoded = decodeURIComponent(urlPath.split("?")[0]);
  if (decoded === "/") decoded = "/index.html";
  const filePath = path.join(PUBLIC_DIR, decoded);
  if (!filePath.startsWith(PUBLIC_DIR)) return null;
  return filePath;
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "application/javascript; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  return "application/octet-stream";
}

function serveStatic(req, res) {
  const filePath = publicPathFromUrl(req.url || "/");
  if (!filePath) {
    sendText(res, 400, "Bad request");
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    sendText(res, 404, "Not found");
    return;
  }
  res.writeHead(200, {
    "Content-Type": contentTypeFor(filePath),
    "Cache-Control": "no-cache"
  });
  fs.createReadStream(filePath).pipe(res);
}

function normalizeProtocol(protocol, patient) {
  const patientName = protocol.patient_name || (patient ? patient.full_name : "");
  return {
    id: protocol.id,
    title: protocol.title,
    status: protocol.status,
    collected_at: protocol.collected_at,
    pdf_url: protocol.pdf_url,
    updated_at: protocol.updated_at,
    patient_name: patientName
  };
}

function normalizeMessage(message) {
  return {
    id: message.id,
    protocol_id: message.protocol_id,
    author_role: message.author_role,
    author_name: message.author_name,
    body: message.body,
    created_at: message.created_at
  };
}

function normalizePatient(patient) {
  return {
    id: patient.id,
    full_name: patient.full_name,
    dossier: patient.dossier,
    phone: patient.phone || "",
    birth_date: patient.birth_date
  };
}

function createEntityId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

function createInternalDossier() {
  return `AUTO-${new Date().getUTCFullYear()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

function createMessage({ protocolId, authorRole, authorId, authorName, body }) {
  return {
    id: `msg_${crypto.randomBytes(6).toString("hex")}`,
    protocol_id: protocolId,
    author_role: authorRole,
    author_id: authorId,
    author_name: authorName,
    body: String(body || "").trim(),
    created_at: nowIso()
  };
}

function insertMessageAndSetStatus(message, nextStatus) {
  db.exec("BEGIN");
  try {
    statements.insertMessage.run(
      message.id,
      message.protocol_id,
      message.author_role,
      message.author_id,
      message.author_name,
      message.body,
      message.created_at
    );
    const updateResult = statements.updateProtocolStatus.run(nextStatus, nowIso(), message.protocol_id);
    if (!updateResult || updateResult.changes === 0) {
      throw new Error("Protocole introuvable");
    }
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // No-op rollback fallback.
    }
    throw error;
  }
}

function setProtocolStatus(protocolId, nextStatus) {
  const updateResult = statements.updateProtocolStatus.run(nextStatus, nowIso(), protocolId);
  if (!updateResult || updateResult.changes === 0) return null;
  return statements.protocolById.get(protocolId) || null;
}

async function handleApi(req, res) {
  const { method, url: rawUrl = "/" } = req;
  const url = new URL(rawUrl, "http://localhost");
  const pathname = url.pathname;

  if (method === "GET" && pathname === "/api/health") {
    sendJson(res, 200, { ok: true, ts: nowIso() });
    return;
  }

  if (method === "POST" && pathname === "/api/patient/login") {
    const { phone = "", dossier = "", birth_date = "" } = await parseBody(req);
    const cleanPhone = normalizePhoneInput(phone);
    const cleanDossier = String(dossier || "").trim();
    const normalizedBirthDate = normalizeDateInput(birth_date);
    if (!normalizedBirthDate) {
      sendJson(res, 400, { error: "Date de naissance invalide" });
      return;
    }
    if (!cleanPhone && !cleanDossier) {
      sendJson(res, 400, { error: "Telephone requis" });
      return;
    }
    if (String(phone || "").trim() && !cleanPhone) {
      sendJson(res, 400, { error: "Telephone invalide" });
      return;
    }
    const patient = cleanPhone
      ? statements.patientByLogin.get(cleanPhone, normalizedBirthDate)
      : statements.patientByDossierLogin.get(cleanDossier, normalizedBirthDate);
    if (!patient) {
      sendJson(res, 401, { error: "Identifiants patient invalides" });
      return;
    }
    const token = createSession("patient", patient.id);
    sendJson(res, 200, {
      token,
      patient: {
        id: patient.id,
        full_name: patient.full_name,
        phone: patient.phone || ""
      }
    });
    return;
  }

  if (method === "POST" && pathname === "/api/biologist/login") {
    const { username = "", password = "" } = await parseBody(req);
    const user = statements.biologistByLogin.get(String(username), String(password));
    if (!user) {
      sendJson(res, 401, { error: "Identifiants biologiste invalides" });
      return;
    }
    const token = createSession("biologist", user.id);
    sendJson(res, 200, {
      token,
      biologist: {
        id: user.id,
        display_name: user.display_name,
        username: user.username
      }
    });
    return;
  }

  if (method === "GET" && pathname === "/api/admin/patients") {
    const session = ensureRole(req, "biologist");
    if (!session) {
      sendJson(res, 401, { error: "Session biologiste invalide" });
      return;
    }
    const patients = statements.adminPatientsAll.all().map(normalizePatient);
    sendJson(res, 200, { patients });
    return;
  }

  if (method === "POST" && pathname === "/api/admin/patients") {
    const session = ensureRole(req, "biologist");
    if (!session) {
      sendJson(res, 401, { error: "Session biologiste invalide" });
      return;
    }
    const { full_name = "", dossier = "", phone = "", birth_date = "" } = await parseBody(req);
    const cleanName = String(full_name).trim();
    const cleanPhone = normalizePhoneInput(phone);
    const cleanDossier = String(dossier || "").trim() || createInternalDossier();
    const rawBirthDate = String(birth_date || "").trim();
    if (!cleanName || !rawBirthDate || !String(phone || "").trim()) {
      sendJson(res, 400, { error: "Champs patient incomplets" });
      return;
    }
    if (!cleanPhone) {
      sendJson(res, 400, { error: "Telephone invalide" });
      return;
    }
    const cleanBirthDate = normalizeDateInput(rawBirthDate);
    if (!cleanBirthDate) {
      sendJson(res, 400, { error: "Date de naissance invalide (YYYY-MM-DD ou DD/MM/YYYY)" });
      return;
    }
    const patient = {
      id: createEntityId("pat"),
      full_name: cleanName,
      dossier: cleanDossier,
      phone: cleanPhone,
      birth_date: cleanBirthDate
    };
    try {
      statements.adminInsertPatient.run(
        patient.id,
        patient.full_name,
        patient.dossier,
        patient.phone,
        patient.birth_date
      );
      sendJson(res, 201, { patient: normalizePatient(patient) });
    } catch (error) {
      if (String(error.message || "").includes("UNIQUE constraint failed: patients.dossier")) {
        sendJson(res, 409, { error: "Identifiant interne deja utilise" });
        return;
      }
      if (String(error.message || "").includes("UNIQUE constraint failed: patients.phone")) {
        sendJson(res, 409, { error: "Ce telephone existe deja" });
        return;
      }
      throw error;
    }
    return;
  }

  if (method === "GET" && pathname === "/api/admin/protocols") {
    const session = ensureRole(req, "biologist");
    if (!session) {
      sendJson(res, 401, { error: "Session biologiste invalide" });
      return;
    }
    const protocols = statements.adminProtocolsAll.all().map((item) => ({
      id: item.id,
      patient_id: item.patient_id,
      patient_name: item.patient_name,
      patient_phone: item.patient_phone || "",
      patient_dossier: item.patient_dossier,
      title: item.title,
      status: item.status,
      collected_at: item.collected_at,
      pdf_url: item.pdf_url,
      updated_at: item.updated_at,
      message_count: Number(item.message_count || 0)
    }));
    sendJson(res, 200, { protocols });
    return;
  }

  if (method === "POST" && pathname === "/api/admin/protocols") {
    const session = ensureRole(req, "biologist");
    if (!session) {
      sendJson(res, 401, { error: "Session biologiste invalide" });
      return;
    }
    const { patient_id = "", title = "", status = "open", collected_at = "", pdf_url = "" } = await parseBody(req);
    const cleanPatientId = String(patient_id).trim();
    const cleanTitle = String(title).trim();
    const cleanStatus = String(status || "open").trim().toLowerCase();
    const rawCollectedAt = String(collected_at || "").trim();
    const cleanPdfUrl = String(pdf_url || "").trim();

    if (!cleanPatientId || !cleanTitle) {
      sendJson(res, 400, { error: "Patient et titre obligatoires" });
      return;
    }
    if (!["open", "answered", "closed"].includes(cleanStatus)) {
      sendJson(res, 400, { error: "Statut invalide" });
      return;
    }
    const cleanCollectedAt = normalizeDateInput(rawCollectedAt);
    if (rawCollectedAt && !cleanCollectedAt) {
      sendJson(res, 400, { error: "Date de prelevement invalide (YYYY-MM-DD ou DD/MM/YYYY)" });
      return;
    }

    const patient = statements.patientById.get(cleanPatientId);
    if (!patient) {
      sendJson(res, 404, { error: "Patient introuvable" });
      return;
    }

    const protocol = {
      id: createEntityId("prot"),
      patient_id: cleanPatientId,
      title: cleanTitle,
      status: cleanStatus,
      collected_at: cleanCollectedAt,
      pdf_url: cleanPdfUrl,
      updated_at: nowIso()
    };
    statements.adminInsertProtocol.run(
      protocol.id,
      protocol.patient_id,
      protocol.title,
      protocol.status,
      protocol.collected_at,
      protocol.pdf_url,
      protocol.updated_at
    );
    sendJson(res, 201, { protocol });
    return;
  }

  if (method === "GET" && pathname === "/api/patient/protocols") {
    const session = ensureRole(req, "patient");
    if (!session) {
      sendJson(res, 401, { error: "Session patient invalide" });
      return;
    }
    const patient = statements.patientById.get(session.userId);
    if (!patient) {
      sendJson(res, 404, { error: "Patient introuvable" });
      return;
    }
    const protocols = statements.patientProtocols
      .all(patient.id)
      .map((item) => normalizeProtocol(item, patient));
    sendJson(res, 200, { protocols });
    return;
  }

  if (method === "GET" && pathname === "/api/biologist/inbox") {
    const session = ensureRole(req, "biologist");
    if (!session) {
      sendJson(res, 401, { error: "Session biologiste invalide" });
      return;
    }
    const statusFilter = (url.searchParams.get("status") || "").trim().toLowerCase();
    const rows = statusFilter
      ? statements.inboxByStatus.all(statusFilter)
      : statements.inboxAll.all();
    const protocols = rows.map((protocol) => normalizeProtocol(protocol, null));
    sendJson(res, 200, { protocols });
    return;
  }

  const patientMessagesMatch = pathname.match(/^\/api\/patient\/protocols\/([^/]+)\/messages$/);
  if (patientMessagesMatch && method === "GET") {
    const session = ensureRole(req, "patient");
    if (!session) {
      sendJson(res, 401, { error: "Session patient invalide" });
      return;
    }
    const protocolId = patientMessagesMatch[1];
    const protocol = statements.protocolById.get(protocolId);
    if (!protocol || protocol.patient_id !== session.userId) {
      sendJson(res, 404, { error: "Protocole introuvable" });
      return;
    }
    const messages = statements.messagesByProtocol.all(protocolId).map(normalizeMessage);
    sendJson(res, 200, { messages });
    return;
  }

  if (patientMessagesMatch && method === "POST") {
    const session = ensureRole(req, "patient");
    if (!session) {
      sendJson(res, 401, { error: "Session patient invalide" });
      return;
    }
    const protocolId = patientMessagesMatch[1];
    const { body = "" } = await parseBody(req);
    if (!String(body).trim()) {
      sendJson(res, 400, { error: "Message vide" });
      return;
    }
    const protocol = statements.protocolById.get(protocolId);
    const patient = statements.patientById.get(session.userId);
    if (!protocol || !patient || protocol.patient_id !== patient.id) {
      sendJson(res, 404, { error: "Protocole introuvable" });
      return;
    }
    const message = createMessage({
      protocolId,
      authorRole: "patient",
      authorId: patient.id,
      authorName: patient.full_name,
      body
    });
    insertMessageAndSetStatus(message, "open");
    sendJson(res, 201, { message: normalizeMessage(message) });
    return;
  }

  const biologistMessagesMatch = pathname.match(/^\/api\/biologist\/protocols\/([^/]+)\/messages$/);
  if (biologistMessagesMatch && method === "GET") {
    const session = ensureRole(req, "biologist");
    if (!session) {
      sendJson(res, 401, { error: "Session biologiste invalide" });
      return;
    }
    const protocolId = biologistMessagesMatch[1];
    const protocol = statements.protocolById.get(protocolId);
    if (!protocol) {
      sendJson(res, 404, { error: "Protocole introuvable" });
      return;
    }
    const messages = statements.messagesByProtocol.all(protocolId).map(normalizeMessage);
    sendJson(res, 200, { messages });
    return;
  }

  if (biologistMessagesMatch && method === "POST") {
    const session = ensureRole(req, "biologist");
    if (!session) {
      sendJson(res, 401, { error: "Session biologiste invalide" });
      return;
    }
    const protocolId = biologistMessagesMatch[1];
    const { body = "" } = await parseBody(req);
    if (!String(body).trim()) {
      sendJson(res, 400, { error: "Message vide" });
      return;
    }
    const protocol = statements.protocolById.get(protocolId);
    const biologist = statements.biologistById.get(session.userId);
    if (!protocol || !biologist) {
      sendJson(res, 404, { error: "Protocole introuvable" });
      return;
    }
    const message = createMessage({
      protocolId,
      authorRole: "biologist",
      authorId: biologist.id,
      authorName: biologist.display_name,
      body
    });
    insertMessageAndSetStatus(message, "answered");
    sendJson(res, 201, { message: normalizeMessage(message) });
    return;
  }

  const statusMatch = pathname.match(/^\/api\/biologist\/protocols\/([^/]+)\/status$/);
  if (statusMatch && method === "PATCH") {
    const session = ensureRole(req, "biologist");
    if (!session) {
      sendJson(res, 401, { error: "Session biologiste invalide" });
      return;
    }
    const protocolId = statusMatch[1];
    const { status = "" } = await parseBody(req);
    const nextStatus = String(status).trim().toLowerCase();
    if (!["open", "answered", "closed"].includes(nextStatus)) {
      sendJson(res, 400, { error: "Statut invalide" });
      return;
    }
    const updated = setProtocolStatus(protocolId, nextStatus);
    if (!updated) {
      sendJson(res, 404, { error: "Protocole introuvable" });
      return;
    }
    sendJson(res, 200, { protocol: normalizeProtocol(updated, null) });
    return;
  }

  sendJson(res, 404, { error: "Endpoint introuvable" });
}

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = req.url || "/";
    if (requestUrl.startsWith("/api/")) {
      await handleApi(req, res);
      return;
    }
    if (req.method !== "GET") {
      sendText(res, 405, "Method not allowed");
      return;
    }
    serveStatic(req, res);
  } catch (error) {
    if (error && error.message === "Payload too large") {
      sendJson(res, 413, { error: "Payload too large" });
      return;
    }
    if (error instanceof SyntaxError) {
      sendJson(res, 400, { error: "JSON invalide" });
      return;
    }
    sendJson(res, 500, { error: "Erreur interne", detail: error.message });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Portail resultats actif: http://127.0.0.1:${PORT}`);
});

process.on("exit", () => {
  try {
    db.close();
  } catch {
    // Ignore close errors during shutdown.
  }
});
