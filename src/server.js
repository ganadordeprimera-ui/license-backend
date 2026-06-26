// src/server.js
// Servidor de licencias. Expone endpoints HTTP que la extensión / host nativo
// consultará para activar y validar licencias.
//
// ENDPOINTS:
//   POST /api/activate   { code, machine_id }  -> intenta activar/validar
//   GET  /api/health                            -> chequeo simple de vida
//   GET  /api/admin/licenses        (requiere x-admin-key) -> listar todas
//   POST /api/admin/licenses        (requiere x-admin-key) -> crear nueva
//   POST /api/admin/licenses/:code/revoke (requiere x-admin-key) -> revocar
//
// Variables de entorno (ver .env.example):
//   PORT          puerto del servidor (Render lo inyecta automáticamente)
//   ADMIN_KEY     clave secreta para proteger endpoints /api/admin/*
//   ALLOWED_ORIGIN (opcional) origen permitido para CORS, ej: chrome-extension://abcdef...

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

const {
  getLicense,
  getActivation,
  countActivations,
  createActivation,
  touchActivation,
  listLicenses,
  createLicense,
  revokeLicense,
} = require("./db");

const app = express();
app.use(express.json());

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || null;
app.use(
  cors({
    origin: ALLOWED_ORIGIN ? ALLOWED_ORIGIN.split(",") : true,
  })
);

const ADMIN_KEY = process.env.ADMIN_KEY;
if (!ADMIN_KEY) {
  console.warn(
    "⚠️  ADVERTENCIA: no se definió ADMIN_KEY en las variables de entorno. " +
      "Los endpoints /api/admin/* quedarán SIN PROTECCIÓN. Defínela antes de producción."
  );
}

function requireAdmin(req, res, next) {
  if (!ADMIN_KEY) return next(); // sin clave configurada: solo para pruebas locales
  const provided = req.header("x-admin-key");
  if (provided && crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(ADMIN_KEY))) {
    return next();
  }
  return res.status(401).json({ ok: false, error: "No autorizado." });
}

function isValidCodeFormat(code) {
  return typeof code === "string" && /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code);
}

function isValidMachineId(id) {
  return typeof id === "string" && id.length >= 8 && id.length <= 256;
}

// ---------- Endpoint principal: activar / validar ----------

app.post("/api/activate", (req, res) => {
  const { code, machine_id } = req.body || {};

  if (!isValidCodeFormat(code)) {
    return res.status(400).json({ ok: false, error: "Formato de código inválido." });
  }
  if (!isValidMachineId(machine_id)) {
    return res.status(400).json({ ok: false, error: "machine_id inválido o ausente." });
  }

  const license = getLicense(code);
  if (!license) {
    return res.status(404).json({ ok: false, error: "Código de licencia no encontrado." });
  }
  if (license.revoked) {
    return res.status(403).json({ ok: false, error: "Esta licencia ha sido revocada." });
  }

  const existing = getActivation(code, machine_id);
  if (existing) {
    // Esta máquina ya estaba activada para este código: permitir siempre,
    // sin consumir un cupo adicional. Actualizamos "última vez vista".
    touchActivation(code, machine_id);
    return res.json({
      ok: true,
      status: "already_active",
      max_machines: license.max_machines,
      activations_used: countActivations(code),
    });
  }

  const used = countActivations(code);
  if (used >= license.max_machines) {
    return res.status(403).json({
      ok: false,
      error: `Esta licencia ya alcanzó su límite de ${license.max_machines} PC${license.max_machines > 1 ? "s" : ""}.`,
      max_machines: license.max_machines,
      activations_used: used,
    });
  }

  createActivation(code, machine_id);
  return res.json({
    ok: true,
    status: "newly_activated",
    max_machines: license.max_machines,
    activations_used: countActivations(code),
  });
});

// Endpoint de "heartbeat" opcional: la extensión puede llamarlo periódicamente
// para confirmar que la activación sigue siendo válida (por si revocas la
// licencia después de activada).
app.post("/api/verify", (req, res) => {
  const { code, machine_id } = req.body || {};

  if (!isValidCodeFormat(code) || !isValidMachineId(machine_id)) {
    return res.status(400).json({ ok: false, error: "Datos inválidos." });
  }

  const license = getLicense(code);
  if (!license || license.revoked) {
    return res.status(403).json({ ok: false, error: "Licencia inválida o revocada." });
  }

  const activation = getActivation(code, machine_id);
  if (!activation) {
    return res.status(403).json({ ok: false, error: "Esta máquina no tiene esta licencia activada." });
  }

  touchActivation(code, machine_id);
  return res.json({ ok: true, status: "valid" });
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// ---------- Endpoints de administración ----------

app.get("/api/admin/licenses", requireAdmin, (req, res) => {
  const licenses = listLicenses();
  res.json({ ok: true, licenses });
});

app.post("/api/admin/licenses", requireAdmin, (req, res) => {
  const { max_machines, note, code: customCode } = req.body || {};

  if (![1, 3].includes(max_machines)) {
    return res.status(400).json({ ok: false, error: "max_machines debe ser 1 o 3." });
  }

  let code = customCode;
  if (code && !isValidCodeFormat(code)) {
    return res.status(400).json({ ok: false, error: "Formato de código personalizado inválido." });
  }

  if (!code) {
    const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const groups = [];
    for (let g = 0; g < 4; g++) {
      let group = "";
      for (let i = 0; i < 4; i++) {
        group += ALPHABET[crypto.randomInt(0, ALPHABET.length)];
      }
      groups.push(group);
    }
    code = groups.join("-");
  }

  try {
    const license = createLicense(code, max_machines, note);
    return res.json({ ok: true, license });
  } catch (err) {
    if (err.code === "SQLITE_CONSTRAINT_PRIMARYKEY") {
      return res.status(409).json({ ok: false, error: "Ese código ya existe." });
    }
    console.error(err);
    return res.status(500).json({ ok: false, error: "Error interno al crear la licencia." });
  }
});

app.post("/api/admin/licenses/:code/revoke", requireAdmin, (req, res) => {
  const { code } = req.params;
  const license = getLicense(code);
  if (!license) {
    return res.status(404).json({ ok: false, error: "Licencia no encontrada." });
  }
  const updated = revokeLicense(code, true);
  res.json({ ok: true, license: updated });
});

app.post("/api/admin/licenses/:code/unrevoke", requireAdmin, (req, res) => {
  const { code } = req.params;
  const license = getLicense(code);
  if (!license) {
    return res.status(404).json({ ok: false, error: "Licencia no encontrada." });
  }
  const updated = revokeLicense(code, false);
  res.json({ ok: true, license: updated });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor de licencias escuchando en el puerto ${PORT}`);
});
