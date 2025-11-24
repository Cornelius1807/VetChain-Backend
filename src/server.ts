import express from "express";
import type { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { PrismaClient, Prisma } from "../generated/prisma/index.js";
import type { EstadoCita, EstadoCuenta, Rol } from "../generated/prisma/index.js";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import { promises as fs } from "node:fs";
import path from "node:path";

dotenv.config();

const app = express();
const prisma = new PrismaClient();
const uploadsRoot = path.resolve(process.cwd(), "uploads");
const docsRoot = path.join(uploadsRoot, "docs");

await fs.mkdir(docsRoot, { recursive: true });

app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use("/uploads", express.static(uploadsRoot));

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

type JWTPayload = {
  id: string;
  rol: Rol;
};

declare global {
  namespace Express {
    interface Request {
      user?: JWTPayload | null;
    }
  }
}

function signJWT(payload: JWTPayload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

function auth(required = true) {
  return (req: Request, res: Response, next: () => void) => {
    const header = req.headers.authorization;
    if (!header) {
      if (required) return res.status(401).json({ error: "No autorizado" });
      req.user = null;
      return next();
    }
    const token = header.replace("Bearer ", "");
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as JWTPayload;
      req.user = decoded;
      next();
    } catch {
      if (required) return res.status(401).json({ error: "Token inválido" });
      req.user = null;
      next();
    }
  };
}

function isValidEmail(email: string) {
  return /.+@.+\..+/.test(email);
}

function isStrongPassword(pwd: string) {
  return /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/.test(pwd);
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

async function enqueueNotification(args: {
  cuentaId?: string;
  correoDestino: string;
  tipo: string;
  payload: Record<string, unknown>;
  citaId?: string;
  subject?: string;
  message?: string;
}) {
  const notif = await prisma.notificacion.create({
    data: {
      cuentaId: args.cuentaId ?? null,
      correoDestino: args.correoDestino,
      tipo: args.tipo,
      payload: args.payload as unknown as Prisma.InputJsonValue,
      citaId: args.citaId ?? null,
    },
  });
  if (args.subject || args.message) {
    await sendEmail(
      notif.correoDestino,
      args.subject ?? `Notificación ${args.tipo}`,
      args.message ?? JSON.stringify(args.payload)
    );
    await prisma.notificacion.update({ where: { id: notif.id }, data: { estado: "enviado", enviadoAt: new Date() } });
  }
}

function mimeToExtension(mime: string) {
  if (mime.includes("pdf")) return ".pdf";
  if (mime.includes("msword")) return ".doc";
  if (mime.includes("openxmlformats-officedocument")) return ".docx";
  if (mime.includes("jpeg")) return ".jpg";
  if (mime.includes("png")) return ".png";
  return ".dat";
}

async function saveDocument(base64data: string | undefined, label: string) {
  if (!base64data) return undefined;
  let payload = base64data.trim();
  let mime = "application/octet-stream";
  if (payload.startsWith("data:")) {
    const [, meta, data] = payload.match(/^data:(.*?);base64,(.*)$/) ?? [];
    if (!meta || !data) throw new Error("Archivo adjunto invalido");
    mime = meta;
    payload = data;
  }
  const buffer = Buffer.from(payload, "base64");
  if (!buffer.length) throw new Error("Archivo adjunto vacio");
  const filename = `${label}-${Date.now()}-${Math.round(Math.random() * 1000)}${mimeToExtension(mime)}`;
  const filePath = path.join(docsRoot, filename);
  await fs.writeFile(filePath, buffer);
  return `/uploads/docs/${filename}`;
}

async function ensureAdmin() {
  const adminEmail = "admin@vetchain.com";
  const exists = await prisma.cuenta.findUnique({ where: { correo: adminEmail } });
  if (!exists) {
    const hash = await bcrypt.hash("admin123", 10);
    await prisma.cuenta.create({
      data: { correo: adminEmail, hash, rol: "admin", estado: "active" as EstadoCuenta },
    });
    console.log("Seeded admin account admin@vetchain.com / admin123");
  }
}

ensureAdmin().catch((err) => console.error("Error seeding admin", err));

const transporter =
  process.env.SMTP_HOST
    ? nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587,
        secure: process.env.SMTP_SECURE === "true",
        auth:
          process.env.SMTP_USER && process.env.SMTP_PASS
            ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
            : undefined,
        tls: {
          // Si SMTP_REJECT_UNAUTHORIZED = "false", permitimos certificados autofirmados (desarrollo)
          rejectUnauthorized: process.env.SMTP_REJECT_UNAUTHORIZED !== "false",
        },
      })
    : null;

async function sendEmail(to: string, subject: string, message: string) {
  if (!to) return;
  const from = process.env.SMTP_FROM || "no-reply@vetchain.local";
  if (!transporter) {
    console.log(`[EMAIL MOCK] ${subject} -> ${to}\n${message}`);
    return;
  }
  try {
    await transporter.sendMail({ from, to, subject, text: message });
  } catch (err) {
    console.error("Error enviando correo:", err);
  }
}

// Helper utilities ----------------------------------------------------------

async function fetchCuenta(req: Request) {
  if (!req.user) return null;
  return prisma.cuenta.findUnique({ where: { id: req.user.id } });
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60000);
}

function isWithinTwoWeeks(date: Date) {
  const now = new Date();
  const inTwoWeeks = addMinutes(now, 14 * 24 * 60);
  return date >= now && date <= inTwoWeeks;
}

function parseHM(hm: string) {
  const parts = hm.split(":");
  if (parts.length < 2) throw new Error("Formato de hora inválido");
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (Number.isNaN(h) || Number.isNaN(m)) throw new Error("Formato de hora inválido");
  return { h, m };
}

// Auth endpoints ------------------------------------------------------------

// Registro de dueño: activo inmediatamente
app.post("/auth/register/owner", async (req, res) => {
  const { dni, nombres, apellidos, correo, contrasena, telefono } = req.body || {};
  const dniClean = typeof dni === "string" ? dni.trim() : "";
  const nombresClean = typeof nombres === "string" ? nombres.trim() : "";
  const apellidosClean = typeof apellidos === "string" ? apellidos.trim() : "";
  const telefonoClean = typeof telefono === "string" ? telefono.trim() : "";
  const correoNorm = normalizeEmail(typeof correo === "string" ? correo : "");
  if (!dniClean || !nombresClean || !apellidosClean || !correoNorm || !contrasena || !telefonoClean) {
    return res.status(400).json({ error: "Campos obligatorios faltantes" });
  }
  if (!isValidEmail(correoNorm)) return res.status(400).json({ error: "Correo invalido" });
  if (!isStrongPassword(contrasena)) return res.status(400).json({ error: "La contrasena no cumple la politica" });
  const exists = await prisma.cuenta.findUnique({ where: { correo: correoNorm } });
  if (exists) return res.status(409).json({ error: "Correo ya registrado" });

  const hash = await bcrypt.hash(contrasena, 10);
  const cuenta = await prisma.cuenta.create({
    data: { correo: correoNorm, hash, rol: "dueno", estado: "active" as EstadoCuenta },
  });
  const dueno = await prisma.dueno.create({
    data: { cuentaId: cuenta.id, dni: dniClean, nombres: nombresClean, apellidos: apellidosClean, telefono: telefonoClean },
  });

  return res.status(201).json({ id: cuenta.id });
});


// Registro de veterinario (queda pendiente hasta aprobación + confirmación)
app.post("/auth/register/vet", async (req, res) => {
  const {
    dni,
    nombre,
    apellidos,
    correo,
    contrasena,
    especialidad,
    telefono,
    tituloData,
    constanciaData,
    centroId,
  } = req.body || {};
  const dniClean = typeof dni === "string" ? dni.trim() : "";
  const nombreClean = typeof nombre === "string" ? nombre.trim() : "";
  const apellidosClean = typeof apellidos === "string" ? apellidos.trim() : "";
  const telefonoClean = typeof telefono === "string" ? telefono.trim() : "";
  const correoNorm = normalizeEmail(typeof correo === "string" ? correo : "");
  if (!dniClean || !nombreClean || !correoNorm || !contrasena || !especialidad) {
    return res.status(400).json({ error: "Campos obligatorios faltantes" });
  }
  if (!isValidEmail(correoNorm)) return res.status(400).json({ error: "Correo invalido" });
  if (!isStrongPassword(contrasena)) return res.status(400).json({ error: "La contrasena no cumple la politica" });
  const exists = await prisma.cuenta.findUnique({ where: { correo: correoNorm } });
  if (exists) return res.status(409).json({ error: "Correo ya registrado" });

  const hash = await bcrypt.hash(contrasena, 10);
  const cuenta = await prisma.cuenta.create({
    data: { correo: correoNorm, hash, rol: "veterinario", estado: "pending" as EstadoCuenta },
  });

  const tituloURL = await saveDocument(tituloData, "titulo");
  const constanciaURL = await saveDocument(constanciaData, "constancia");

  await prisma.veterinario.create({
    data: {
      cuentaId: cuenta.id,
      dni: dniClean,
      nombre: nombreClean,
      apellidos: apellidosClean || undefined,
      telefono: telefonoClean || undefined,
      especialidad,
      tituloURL,
      constanciaURL,
      centroId,
    },
  });

  return res.status(201).json({ id: cuenta.id });
});


// Confirmación por correo (usada para veterinarios tras aprobación)
app.post("/auth/confirm-email", async (req, res) => {
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ error: "Token requerido" });
  const rec = await prisma.emailConfirmationToken.findUnique({ where: { token } });
  if (!rec || rec.usedAt) return res.status(400).json({ error: "Token inválido" });

  await prisma.$transaction([
    prisma.cuenta.update({ where: { id: rec.cuentaId }, data: { estado: "active" as EstadoCuenta, confirmadoEn: new Date() } }),
    prisma.emailConfirmationToken.update({ where: { id: rec.id }, data: { usedAt: new Date() } }),
  ]);
  return res.json({ ok: true });
});

app.post("/auth/login", async (req, res) => {
  const { correo, contrasena } = req.body || {};
  if (!correo || !contrasena) return res.status(400).json({ error: "Debe ingresar correo y contrasena" });
  const rawCorreo = typeof correo === "string" ? correo : "";
  const correoNorm = normalizeEmail(rawCorreo);

  let cuenta = await prisma.cuenta.findUnique({ where: { correo: correoNorm } });
  if (!cuenta && rawCorreo && rawCorreo !== correoNorm) {
    cuenta = await prisma.cuenta.findUnique({ where: { correo: rawCorreo } });
  }
  if (!cuenta) {
    const candidates = await prisma.cuenta.findMany({
      where: { correo: { contains: correoNorm, mode: "insensitive" } },
      take: 5,
    });
    cuenta = candidates.find((c) => c.correo.trim().toLowerCase() === correoNorm) ?? null;
  }
  if (!cuenta) return res.status(401).json({ error: "Credenciales invalidas (correo o contrasena)" });
  const ok = await bcrypt.compare(contrasena, cuenta.hash);
  if (!ok) return res.status(401).json({ error: "Credenciales invalidas (correo o contrasena)" });
  if (cuenta.estado !== "active") return res.status(403).json({ error: "Cuenta no activa o pendiente de aprobacion" });

  const token = signJWT({ id: cuenta.id, rol: cuenta.rol });
  return res.json({ token, rol: cuenta.rol });
});



app.post("/auth/request-password-reset", async (req, res) => {
  const { correo } = req.body || {};
  if (!correo) return res.status(400).json({ error: "Correo requerido" });
  const cuenta = await prisma.cuenta.findUnique({ where: { correo } });
  if (!cuenta) return res.json({ ok: true });
  const token = await prisma.passwordResetToken.create({ data: { cuentaId: cuenta.id, token: randomUUID() } });
  await enqueueNotification({
    cuentaId: cuenta.id,
    correoDestino: cuenta.correo,
    tipo: "reset-password",
    payload: { token: token.token },
    subject: "Restablece tu contraseña",
    message: `Usa este token para restablecer tu contraseña: ${token.token}`,
  });
  return res.json({ ok: true, token: token.token });
});

app.post("/auth/reset-password", async (req, res) => {
  const { token, contrasena } = req.body || {};
  if (!token || !contrasena) return res.status(400).json({ error: "Datos incompletos" });
  if (!isStrongPassword(contrasena)) return res.status(400).json({ error: "La contraseña no cumple la política" });
  const rec = await prisma.passwordResetToken.findUnique({ where: { token } });
  if (!rec || rec.usedAt) return res.status(400).json({ error: "Token inválido" });

  const hash = await bcrypt.hash(contrasena, 10);
  await prisma.$transaction([
    prisma.cuenta.update({ where: { id: rec.cuentaId }, data: { hash } }),
    prisma.passwordResetToken.update({ where: { id: rec.id }, data: { usedAt: new Date() } }),
  ]);
  return res.json({ ok: true });
});

app.get("/me", auth(), async (req, res) => {
  const cuenta = await fetchCuenta(req);
  if (!cuenta) return res.status(404).json({ error: "Cuenta no encontrada" });

  if (cuenta.rol === "dueno") {
    const dueno = await prisma.dueno.findUnique({ where: { cuentaId: cuenta.id } });
    return res.json({ cuenta, dueno });
  }
  if (cuenta.rol === "veterinario") {
    const vet = await prisma.veterinario.findUnique({ where: { cuentaId: cuenta.id }, include: { centro: true } });
    return res.json({ cuenta, veterinario: vet });
  }
  return res.json({ cuenta });
});

app.put("/me", auth(), async (req, res) => {
  const cuenta = await fetchCuenta(req);
  if (!cuenta) return res.status(404).json({ error: "Cuenta no encontrada" });

  const { correo, telefono, nombres, apellidos, direccion, nombre, especialidad, actualContrasena, nuevaContrasena } = req.body || {};

  if (correo) {
    if (!isValidEmail(correo)) return res.status(400).json({ error: "Correo inválido" });
    if (correo !== cuenta.correo) {
      const exists = await prisma.cuenta.findUnique({ where: { correo } });
      if (exists) return res.status(409).json({ error: "Correo ya registrado" });
    }
  }

  if (nuevaContrasena) {
    if (!actualContrasena) return res.status(400).json({ error: "Debe proporcionar su contraseña actual" });
    const ok = await bcrypt.compare(actualContrasena, cuenta.hash);
    if (!ok) return res.status(400).json({ error: "Contraseña actual incorrecta" });
    if (!isStrongPassword(nuevaContrasena)) return res.status(400).json({ error: "La nueva contraseña no cumple la política" });
    const hash = await bcrypt.hash(nuevaContrasena, 10);
    await prisma.cuenta.update({ where: { id: cuenta.id }, data: { hash } });
  }

  if (correo && correo !== cuenta.correo) {
    await prisma.cuenta.update({ where: { id: cuenta.id }, data: { correo } });
  }

  if (cuenta.rol === "dueno") {
    await prisma.dueno.update({ where: { cuentaId: cuenta.id }, data: { telefono, nombres, apellidos, direccion } });
  } else if (cuenta.rol === "veterinario") {
    await prisma.veterinario.update({ where: { cuentaId: cuenta.id }, data: { telefono, nombre, apellidos, especialidad } });
  }

  return res.json({ ok: true });
});

// --- Eliminación de cuenta -------------------------------------------------
app.post("/account/delete-request", auth(), async (req, res) => {
  const cuenta = await fetchCuenta(req);
  if (!cuenta) return res.status(404).json({ error: "Cuenta no encontrada" });
  const { motivo } = req.body || {};
  await prisma.deleteRequest.create({ data: { cuentaId: cuenta.id, motivo: motivo ?? null } });
  return res.json({ ok: true });
});

// --- Admin -----------------------------------------------------------------

app.get("/admin/pending-vets", auth(), async (req, res) => {
  if (req.user?.rol !== "admin") return res.status(403).json({ error: "Solo admin" });
  const vets = await prisma.veterinario.findMany({
    where: { cuenta: { estado: "pending" as EstadoCuenta } },
    include: { cuenta: true, centro: true },
  });
  return res.json(vets);
});

app.post("/admin/vets/:id/approve", auth(), async (req, res) => {
  if (req.user?.rol !== "admin") return res.status(403).json({ error: "Solo admin" });
  const vetId = req.params.id;
  if (!vetId) return res.status(400).json({ error: "Id invalido" });
  const { centroId, permitirCrearCentro } = req.body || {};
  const vet = await prisma.veterinario.findUnique({ where: { id: vetId }, include: { cuenta: true } });
  if (!vet) return res.status(404).json({ error: "Veterinario no encontrado" });

  await prisma.$transaction([
    prisma.cuenta.update({
      where: { id: vet.cuentaId },
      data: { estado: "active" as EstadoCuenta, confirmadoEn: new Date() },
    }),
    prisma.veterinario.update({
      where: { id: vet.id },
      data: {
        ...(centroId ? { centroId } : {}),
        puedeCrearCentro:
          typeof permitirCrearCentro === "boolean" ? permitirCrearCentro : vet.puedeCrearCentro,
      },
    }),
  ]);

  await enqueueNotification({
    cuentaId: vet.cuentaId,
    correoDestino: vet.cuenta?.correo || "",
    tipo: "aprobacion-veterinario",
    payload: { mensaje: "Tu cuenta ha sido aprobada y ya puedes iniciar sesion." },
    subject: "Cuenta de veterinario aprobada",
    message: "Tu cuenta ha sido aprobada y ya puedes iniciar sesión en VetChain.",
  });
  return res.json({ ok: true });
});

app.post("/admin/vets/:id/reject", auth(), async (req, res) => {
  if (req.user?.rol !== "admin") return res.status(403).json({ error: "Solo admin" });
  const { motivo } = req.body || {};
  const vetId = req.params.id;
  if (!vetId) return res.status(400).json({ error: "Id inválido" });
  const vet = await prisma.veterinario.findUnique({ where: { id: vetId }, include: { cuenta: true } });
  if (!vet) return res.status(404).json({ error: "Veterinario no encontrado" });
  await prisma.cuenta.update({ where: { id: vet.cuentaId }, data: { estado: "rejected" as EstadoCuenta } });
  await enqueueNotification({
    cuentaId: vet.cuentaId,
    correoDestino: vet.cuenta?.correo || "",
    tipo: "rechazo-veterinario",
    payload: { motivo },
    subject: "Cuenta de veterinario rechazada",
    message: `Tu registro fue rechazado. Motivo: ${motivo || "Sin detalle"}.`,
  });
  return res.json({ ok: true });
});

// --- Centros ---------------------------------------------------------------

app.get("/centros", async (_req, res) => {
  const centros = await prisma.centroVeterinario.findMany({ include: { consultorios: true } });
  return res.json(centros);
});

app.get("/veterinarios/activos", async (req, res) => {
  const { centroId } = req.query as { centroId?: string };
  const vets = await prisma.veterinario.findMany({
    where: {
      cuenta: { estado: "active" as EstadoCuenta },
      ...(centroId ? { centroId } : {}),
    },
    include: { centro: true },
    orderBy: { nombre: "asc" },
  });
  return res.json(vets);
});

app.post("/centros", auth(), async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "No autorizado" });
  const { nombre, direccion, telefono, email, rangoAtencionInicio, rangoAtencionFin, rangoConsultaInicio, rangoConsultaFin, consultorios } = req.body || {};
  if (!nombre || !direccion) return res.status(400).json({ error: "Nombre y dirección son obligatorios" });

  let creadorVet: { id: string } | null = null;

  if (req.user.rol === "veterinario") {
    const vet = await prisma.veterinario.findUnique({ where: { cuentaId: req.user.id } });
    if (!vet) return res.status(403).json({ error: "Veterinario no encontrado" });
    if (!vet.puedeCrearCentro) return res.status(403).json({ error: "No autorizado para crear centro" });
    creadorVet = { id: vet.id };
  } else if (req.user.rol !== "admin") {
    return res.status(403).json({ error: "No autorizado" });
  }

  const data: Prisma.CentroVeterinarioCreateInput = {
    nombre,
    direccion,
    telefono: telefono ?? undefined,
    email: email ?? undefined,
    rangoAtencionInicio: rangoAtencionInicio ?? undefined,
    rangoAtencionFin: rangoAtencionFin ?? undefined,
    rangoConsultaInicio: rangoConsultaInicio ?? undefined,
    rangoConsultaFin: rangoConsultaFin ?? undefined,
    consultorios: { create: (consultorios || []).map((nombre: string) => ({ nombre })) },
  };
  if (creadorVet) {
    data.creadoPor = { connect: { id: creadorVet.id } };
  }

  const centro = await prisma.centroVeterinario.create({ data, include: { consultorios: true } });

  if (creadorVet) {
    await prisma.veterinario.update({ where: { id: creadorVet.id }, data: { puedeCrearCentro: false, centroId: centro.id } });
  }

  return res.status(201).json(centro);
});

app.patch("/vet/centro", auth(), async (req, res) => {
  if (req.user?.rol !== "veterinario") return res.status(403).json({ error: "Solo veterinarios" });
  const vet = await prisma.veterinario.findUnique({ where: { cuentaId: req.user.id } });
  if (!vet) return res.status(404).json({ error: "Veterinario no encontrado" });
  const { centroId } = req.body || {};
  if (centroId) {
    const centro = await prisma.centroVeterinario.findUnique({ where: { id: centroId } });
    if (!centro) return res.status(404).json({ error: "Centro no encontrado" });
  }
  await prisma.veterinario.update({ where: { id: vet.id }, data: { centroId: centroId || null } });
  return res.json({ ok: true });
});

// --- Programación y agenda -------------------------------------------------

app.post("/vet/programaciones", auth(), async (req, res) => {
  if (req.user?.rol !== "veterinario") return res.status(403).json({ error: "Solo veterinarios" });
  const { centroId, consultorioId, fechaInicio, fechaFin, horaInicio, horaFin, duracionMinutos } = req.body || {};
  if (!centroId || !fechaInicio || !fechaFin || !horaInicio || !horaFin) {
    return res.status(400).json({ error: "Datos incompletos" });
  }
  const vet = await prisma.veterinario.findUnique({ where: { cuentaId: req.user.id } });
  if (!vet) return res.status(404).json({ error: "Veterinario no encontrado" });
  const centro = await prisma.centroVeterinario.findUnique({ where: { id: centroId } });
  if (!centro) return res.status(404).json({ error: "Centro no encontrado" });

  const inicio = new Date(fechaInicio);
  const fin = new Date(fechaFin);
  if (inicio > fin) return res.status(400).json({ error: "Rango inválido" });

  const { h: hi, m: mi } = parseHM(horaInicio);
  const { h: hf, m: mf } = parseHM(horaFin);
  const duracion = typeof duracionMinutos === "number" && duracionMinutos > 0 ? duracionMinutos : 30;

  const programacion = await prisma.programacion.create({
    data: { veterinarioId: vet.id, fechaInicio: inicio, fechaFin: fin },
  });

  const slots: Array<{ veterinarioId: string; centroId: string; consultorioId: string | null; programacionId: string; fechaInicio: Date; fechaFin: Date }> = [];

  for (let day = new Date(inicio); day <= fin; day = addMinutes(day, 24 * 60)) {
    const dayStart = new Date(day);
    dayStart.setHours(hi, mi, 0, 0);
    const dayEnd = new Date(day);
    dayEnd.setHours(hf, mf, 0, 0);
    for (let current = new Date(dayStart); current < dayEnd; current = addMinutes(current, duracion)) {
      const next = addMinutes(current, duracion);
      slots.push({
        veterinarioId: vet.id,
        centroId,
        consultorioId: consultorioId ?? null,
        programacionId: programacion.id,
        fechaInicio: new Date(current),
        fechaFin: new Date(next),
      });
    }
  }

  await prisma.$transaction([
    prisma.horarioSlot.deleteMany({
      where: {
        veterinarioId: vet.id,
        fechaInicio: { gte: inicio, lte: fin },
        estado: "LIBRE",
      },
    }),
    prisma.horarioSlot.createMany({
      data: slots.map((slot) => ({
        veterinarioId: slot.veterinarioId,
        centroId: slot.centroId,
        consultorioId: slot.consultorioId,
        programacionId: slot.programacionId,
        fechaInicio: slot.fechaInicio,
        fechaFin: slot.fechaFin,
      })),
    }),
  ]);

  return res.json({ ok: true, created: slots.length });
});

app.get("/citas/disponibilidad", async (req, res) => {
  const { veterinarioId, centroId } = req.query as { veterinarioId?: string; centroId?: string };
  if (!veterinarioId) return res.status(400).json({ error: "Debe indicar veterinarioId" });
  const slots = await prisma.horarioSlot.findMany({
    where: {
      veterinarioId,
      ...(centroId ? { centroId } : {}),
      estado: "LIBRE",
      fechaInicio: { gte: new Date() },
    },
    orderBy: { fechaInicio: "asc" },
  });
  return res.json(slots);
});

// --- Mascotas --------------------------------------------------------------

app.get("/mascotas", auth(), async (req, res) => {
  if (req.user?.rol !== "dueno") return res.status(403).json({ error: "Solo dueños" });
  const dueno = await prisma.dueno.findUnique({ where: { cuentaId: req.user.id } });
  if (!dueno) return res.json([]);
  const mascotas = await prisma.mascota.findMany({ where: { duenoId: dueno.id } });
  return res.json(mascotas);
});

app.post("/mascotas", auth(), async (req, res) => {
  if (req.user?.rol !== "dueno") return res.status(403).json({ error: "Solo dueños" });
  const dueno = await prisma.dueno.findUnique({ where: { cuentaId: req.user.id } });
  if (!dueno) return res.status(404).json({ error: "Dueño no encontrado" });

  const { nombre, especie, raza, genero, edad, peso, descripcion, imagenURL } = req.body || {};
  if (!nombre || !especie || !raza || !genero || typeof edad !== "number") {
    return res.status(400).json({ error: "Campos obligatorios faltantes" });
  }

  try {
    const mascota = await prisma.mascota.create({
      data: {
        duenoId: dueno.id,
        nombre,
        especie,
        raza,
        genero,
        edad,
        peso,
        descripcion,
        imagenURL,
        historial: { create: {} },
        resumen: { create: {} },
      },
    });
    return res.status(201).json(mascota);
  } catch (err) {
    return res.status(409).json({ error: "Ya existe una mascota similar registrada" });
  }
});

app.put("/mascotas/:id", auth(), async (req, res) => {
  if (req.user?.rol !== "dueno") return res.status(403).json({ error: "Solo dueños" });
  const dueno = await prisma.dueno.findUnique({ where: { cuentaId: req.user.id } });
  if (!dueno) return res.status(404).json({ error: "Dueño no encontrado" });
  const mascotaId = req.params.id;
  if (!mascotaId) return res.status(400).json({ error: "Id inválido" });
  const mascota = await prisma.mascota.findUnique({ where: { id: mascotaId } });
  if (!mascota || mascota.duenoId !== dueno.id) return res.status(404).json({ error: "Mascota no encontrada" });

  const data = req.body || {};
  try {
    const updated = await prisma.mascota.update({ where: { id: mascota.id }, data });
    return res.json(updated);
  } catch (err) {
    return res.status(409).json({ error: "Actualización provocaría duplicado" });
  }
});

app.delete("/mascotas/:id", auth(), async (req, res) => {
  if (req.user?.rol !== "dueno") return res.status(403).json({ error: "Solo dueños" });
  const dueno = await prisma.dueno.findUnique({ where: { cuentaId: req.user.id } });
  if (!dueno) return res.status(404).json({ error: "Dueño no encontrado" });
  const mascotaId = req.params.id;
  if (!mascotaId) return res.status(400).json({ error: "Id inválido" });
  const mascota = await prisma.mascota.findUnique({ where: { id: mascotaId } });
  if (!mascota || mascota.duenoId !== dueno.id) return res.status(404).json({ error: "Mascota no encontrada" });

  await prisma.mascota.update({ where: { id: mascota.id }, data: { activa: false } });
  return res.json({ ok: true });
});

// --- Citas -----------------------------------------------------------------

app.get("/citas/owner", auth(), async (req, res) => {
  if (req.user?.rol !== "dueno") return res.status(403).json({ error: "Solo dueños" });
  const dueno = await prisma.dueno.findUnique({ where: { cuentaId: req.user.id } });
  if (!dueno) return res.json([]);
  const citas = await prisma.cita.findMany({
    where: { duenoId: dueno.id },
    include: { veterinario: true, mascota: true, centro: true, slot: true },
    orderBy: { fecha: "asc" },
  });
  return res.json(citas);
});

app.get("/citas/vet", auth(), async (req, res) => {
  if (req.user?.rol !== "veterinario") return res.status(403).json({ error: "Solo veterinarios" });
  const vet = await prisma.veterinario.findUnique({ where: { cuentaId: req.user.id } });
  if (!vet) return res.json([]);
  const citas = await prisma.cita.findMany({
    where: { veterinarioId: vet.id },
    include: { dueno: true, mascota: true, centro: true, slot: true },
    orderBy: { fecha: "asc" },
  });
  return res.json(citas);
});

app.post("/citas", auth(), async (req, res) => {
  if (req.user?.rol !== "dueno") return res.status(403).json({ error: "Solo dueños" });
  const dueno = await prisma.dueno.findUnique({ where: { cuentaId: req.user.id } });
  if (!dueno) return res.status(404).json({ error: "Dueño no encontrado" });

  const { mascotaId, veterinarioId, motivo, slotId } = req.body || {};
  if (!mascotaId || !veterinarioId || !motivo || !slotId) {
    return res.status(400).json({ error: "Datos incompletos" });
  }
  const mascota = await prisma.mascota.findUnique({ where: { id: mascotaId } });
  if (!mascota || mascota.duenoId !== dueno.id) return res.status(404).json({ error: "Mascota no encontrada" });

  const slot = await prisma.horarioSlot.findUnique({ where: { id: slotId } });
  if (!slot || slot.estado !== "LIBRE" || slot.veterinarioId !== veterinarioId) {
    return res.status(409).json({ error: "El horario ya no está disponible" });
  }
  if (!isWithinTwoWeeks(slot.fechaInicio)) return res.status(400).json({ error: "Solo puede agendar dentro de dos semanas" });
  const diffHours = (slot.fechaInicio.getTime() - Date.now()) / 3600000;
  if (diffHours < 24) return res.status(400).json({ error: "Debe reservar con 24h de anticipación" });

  const cita = await prisma.cita.create({
    data: {
      motivo,
      fecha: slot.fechaInicio,
      estado: "Programada" as EstadoCita,
      centroId: slot.centroId!,
      consultorioId: slot.consultorioId,
      veterinarioId,
      duenoId: dueno.id,
      mascotaId,
      slotId,
    },
    include: { veterinario: true, centro: true },
  });

  await prisma.horarioSlot.update({ where: { id: slot.id }, data: { estado: "RESERVADO" } });
  await enqueueNotification({
    cuentaId: dueno.cuentaId,
    correoDestino: (await prisma.cuenta.findUnique({ where: { id: dueno.cuentaId } }))?.correo || "",
    tipo: "cita-programada",
    payload: { motivo, citaId: cita.id },
    citaId: cita.id,
    subject: "Cita programada",
    message: `Tu cita para ${mascota.nombre} se registró para ${cita.fecha.toLocaleString()}.`,
  });
  return res.status(201).json(cita);
});

app.patch("/citas/:id/cancel", auth(), async (req, res) => {
  const { motivo } = req.body || {};
  const citaId = req.params.id;
  if (!citaId) return res.status(400).json({ error: "Id inválido" });
  const cita = await prisma.cita.findUnique({ where: { id: citaId }, include: { slot: true, dueno: { include: { cuenta: true } }, veterinario: { include: { cuenta: true } } } });
  if (!cita) return res.status(404).json({ error: "Cita no encontrada" });

  const now = new Date();
  const diffHours = (cita.fecha.getTime() - now.getTime()) / 3600000;
  if (diffHours < 3) return res.status(400).json({ error: "Solo puede cancelar con 3h de anticipación" });

  if (req.user?.rol === "dueno") {
    const dueno = await prisma.dueno.findUnique({ where: { cuentaId: req.user.id } });
    if (!dueno || cita.duenoId !== dueno.id) return res.status(403).json({ error: "No autorizado" });
  } else if (req.user?.rol === "veterinario") {
    const vet = await prisma.veterinario.findUnique({ where: { cuentaId: req.user.id } });
    if (!vet || cita.veterinarioId !== vet.id) return res.status(403).json({ error: "No autorizado" });
  } else {
    return res.status(403).json({ error: "No autorizado" });
  }

  await prisma.cita.update({ where: { id: cita.id }, data: { estado: "Cancelada", motivoCancelacion: motivo ?? "Cancelada" } });
  if (cita.slot) {
    await prisma.horarioSlot.update({ where: { id: cita.slot.id }, data: { estado: "LIBRE" } });
  }

  if (cita.dueno?.cuenta?.correo) {
    await enqueueNotification({
      cuentaId: cita.dueno.cuentaId,
      correoDestino: cita.dueno.cuenta.correo,
      tipo: "cita-cancelada",
      payload: { motivo, citaId: cita.id },
      citaId: cita.id,
      subject: "Cita cancelada",
      message: `La cita del ${cita.fecha.toLocaleString()} fue cancelada. Motivo: ${motivo ?? "Sin detalle"}.`,
    });
  }
  return res.json({ ok: true });
});

app.patch("/citas/:id/atender", auth(), async (req, res) => {
  if (req.user?.rol !== "veterinario") return res.status(403).json({ error: "Solo veterinarios" });
  const vet = await prisma.veterinario.findUnique({ where: { cuentaId: req.user.id } });
  if (!vet) return res.status(404).json({ error: "Veterinario no encontrado" });
  const citaId = req.params.id;
  if (!citaId) return res.status(400).json({ error: "Id inválido" });
  const cita = await prisma.cita.findUnique({ where: { id: citaId }, include: { slot: true, mascota: true } });
  if (!cita || cita.veterinarioId !== vet.id) return res.status(404).json({ error: "Cita no encontrada" });

  const { hallazgos, pruebas, tratamiento, estado } = req.body || {};
  const nuevoEstado = (estado === "Confirmada" || estado === "Atendida") ? (estado as EstadoCita) : "Atendida";

  const updateData: Prisma.CitaUpdateInput = {
    estado: nuevoEstado,
    hallazgos,
    pruebas,
    tratamiento,
  };

  await prisma.cita.update({ where: { id: cita.id }, data: updateData });

  await prisma.historialClinico.upsert({
    where: { mascotaId: cita.mascotaId },
    update: { entradas: { connect: { id: cita.id } } },
    create: { mascotaId: cita.mascotaId, entradas: { connect: { id: cita.id } } },
  });

  return res.json({ ok: true });
});

app.get("/historial/:mascotaId", auth(), async (req, res) => {
  const mascotaId = req.params.mascotaId;
  if (!mascotaId) return res.status(400).json({ error: "Id inválido" });
  const mascota = await prisma.mascota.findUnique({ where: { id: mascotaId }, include: { dueno: { include: { cuenta: true } } } });
  if (!mascota) return res.status(404).json({ error: "Mascota no encontrada" });

  if (req.user?.rol === "dueno") {
    const dueno = await prisma.dueno.findUnique({ where: { cuentaId: req.user.id } });
    if (!dueno || mascota.duenoId !== dueno.id) return res.status(403).json({ error: "No autorizado" });
  }
  if (req.user?.rol === "veterinario") {
    const vet = await prisma.veterinario.findUnique({ where: { cuentaId: req.user.id } });
    if (!vet) return res.status(403).json({ error: "No autorizado" });
    const attended = await prisma.cita.findFirst({ where: { mascotaId: mascota.id, veterinarioId: vet.id } });
    if (!attended) return res.status(403).json({ error: "No tiene acceso al historial" });
  }

  const citas = await prisma.cita.findMany({ where: { mascotaId: mascota.id }, orderBy: { fecha: "asc" } });
  return res.json({ mascota, citas });
});

app.get("/notificaciones", auth(), async (req, res) => {
  const cuenta = await fetchCuenta(req);
  if (!cuenta) return res.status(401).json({ error: "No autorizado" });
  const notifs = await prisma.notificacion.findMany({ where: { cuentaId: cuenta.id }, orderBy: { createdAt: "desc" } });
  return res.json(notifs);
});

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`VetChain API listening on port ${port}`);
});

