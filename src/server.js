import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { PrismaClient, Prisma } from "../generated/prisma/index.js";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
dotenv.config();
const app = express();
const prisma = new PrismaClient();
app.use(cors());
app.use(express.json({ limit: "2mb" }));
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
function signJWT(payload) {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}
function auth(required = true) {
    return (req, res, next) => {
        const header = req.headers.authorization;
        if (!header) {
            if (required)
                return res.status(401).json({ error: "No autorizado" });
            req.user = null;
            return next();
        }
        const token = header.replace("Bearer ", "");
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            req.user = decoded;
            next();
        }
        catch {
            if (required)
                return res.status(401).json({ error: "Token inválido" });
            req.user = null;
            next();
        }
    };
}
function isValidEmail(email) {
    return /.+@.+\..+/.test(email);
}
function isStrongPassword(pwd) {
    return /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/.test(pwd);
}
async function enqueueNotification(args) {
    await prisma.notificacion.create({
        data: {
            cuentaId: args.cuentaId ?? null,
            correoDestino: args.correoDestino,
            tipo: args.tipo,
            payload: args.payload,
            citaId: args.citaId ?? null,
        },
    });
}
async function ensureAdmin() {
    const adminEmail = "admin@vetchain.com";
    const exists = await prisma.cuenta.findUnique({ where: { correo: adminEmail } });
    if (!exists) {
        const hash = await bcrypt.hash("admin123", 10);
        await prisma.cuenta.create({
            data: { correo: adminEmail, hash, rol: "admin", estado: "active" },
        });
        console.log("Seeded admin account admin@vetchain.com / admin123");
    }
}
ensureAdmin().catch((err) => console.error("Error seeding admin", err));
// Helper utilities ----------------------------------------------------------
async function fetchCuenta(req) {
    if (!req.user)
        return null;
    return prisma.cuenta.findUnique({ where: { id: req.user.id } });
}
function addMinutes(date, minutes) {
    return new Date(date.getTime() + minutes * 60000);
}
function isWithinTwoWeeks(date) {
    const now = new Date();
    const inTwoWeeks = addMinutes(now, 14 * 24 * 60);
    return date >= now && date <= inTwoWeeks;
}
function parseHM(hm) {
    const parts = hm.split(":");
    if (parts.length < 2)
        throw new Error("Formato de hora inválido");
    const h = Number(parts[0]);
    const m = Number(parts[1]);
    if (Number.isNaN(h) || Number.isNaN(m))
        throw new Error("Formato de hora inválido");
    return { h, m };
}
// Auth endpoints ------------------------------------------------------------
// Registro de dueño: activo inmediatamente
app.post("/auth/register/owner", async (req, res) => {
    const { dni, nombres, apellidos, correo, contrasena, telefono, mascotaInicial } = req.body || {};
    if (!dni || !nombres || !apellidos || !correo || !contrasena || !telefono) {
        return res.status(400).json({ error: "Campos obligatorios faltantes" });
    }
    if (!isValidEmail(correo))
        return res.status(400).json({ error: "Correo inválido" });
    if (!isStrongPassword(contrasena))
        return res.status(400).json({ error: "La contraseña no cumple la política" });
    const exists = await prisma.cuenta.findUnique({ where: { correo } });
    if (exists)
        return res.status(409).json({ error: "Correo ya registrado" });
    const hash = await bcrypt.hash(contrasena, 10);
    const cuenta = await prisma.cuenta.create({
        data: { correo, hash, rol: "dueno", estado: "active" },
    });
    const dueno = await prisma.dueno.create({
        data: { cuentaId: cuenta.id, dni, nombres, apellidos, telefono },
    });
    if (mascotaInicial) {
        const { nombre, especie, raza, genero, edad, peso, descripcion, imagenURL } = mascotaInicial;
        if (nombre && especie && raza && genero && typeof edad === "number") {
            await prisma.mascota.create({
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
        }
    }
    return res.status(201).json({ id: cuenta.id });
});
// Registro de veterinario (queda pendiente hasta aprobación + confirmación)
app.post("/auth/register/vet", async (req, res) => {
    const { dni, nombre, apellidos, correo, contrasena, especialidad, telefono, tituloURL, constanciaURL, centroId } = req.body || {};
    if (!dni || !nombre || !correo || !contrasena || !especialidad) {
        return res.status(400).json({ error: "Campos obligatorios faltantes" });
    }
    if (!isValidEmail(correo))
        return res.status(400).json({ error: "Correo inválido" });
    if (!isStrongPassword(contrasena))
        return res.status(400).json({ error: "La contraseña no cumple la política" });
    const exists = await prisma.cuenta.findUnique({ where: { correo } });
    if (exists)
        return res.status(409).json({ error: "Correo ya registrado" });
    const hash = await bcrypt.hash(contrasena, 10);
    const cuenta = await prisma.cuenta.create({
        data: { correo, hash, rol: "veterinario", estado: "pending" },
    });
    await prisma.veterinario.create({
        data: {
            cuentaId: cuenta.id,
            dni,
            nombre,
            apellidos,
            telefono,
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
    if (!token)
        return res.status(400).json({ error: "Token requerido" });
    const rec = await prisma.emailConfirmationToken.findUnique({ where: { token } });
    if (!rec || rec.usedAt)
        return res.status(400).json({ error: "Token inválido" });
    await prisma.$transaction([
        prisma.cuenta.update({ where: { id: rec.cuentaId }, data: { estado: "active", confirmadoEn: new Date() } }),
        prisma.emailConfirmationToken.update({ where: { id: rec.id }, data: { usedAt: new Date() } }),
    ]);
    return res.json({ ok: true });
});
app.post("/auth/login", async (req, res) => {
    const { correo, contrasena } = req.body || {};
    if (!correo || !contrasena)
        return res.status(400).json({ error: "Debe ingresar correo y contraseña" });
    const cuenta = await prisma.cuenta.findUnique({ where: { correo } });
    if (!cuenta)
        return res.status(401).json({ error: "Credenciales inválidas (correo o contraseña)" });
    const ok = await bcrypt.compare(contrasena, cuenta.hash);
    if (!ok)
        return res.status(401).json({ error: "Credenciales inválidas (correo o contraseña)" });
    if (cuenta.estado !== "active")
        return res.status(403).json({ error: "Cuenta no activa o pendiente de aprobación" });
    const token = signJWT({ id: cuenta.id, rol: cuenta.rol });
    return res.json({ token, rol: cuenta.rol });
});
app.post("/auth/request-password-reset", async (req, res) => {
    const { correo } = req.body || {};
    if (!correo)
        return res.status(400).json({ error: "Correo requerido" });
    const cuenta = await prisma.cuenta.findUnique({ where: { correo } });
    if (!cuenta)
        return res.json({ ok: true });
    const token = await prisma.passwordResetToken.create({ data: { cuentaId: cuenta.id, token: randomUUID() } });
    await enqueueNotification({ cuentaId: cuenta.id, correoDestino: cuenta.correo, tipo: "reset-password", payload: { token: token.token } });
    return res.json({ ok: true, token: token.token });
});
app.post("/auth/reset-password", async (req, res) => {
    const { token, contrasena } = req.body || {};
    if (!token || !contrasena)
        return res.status(400).json({ error: "Datos incompletos" });
    if (!isStrongPassword(contrasena))
        return res.status(400).json({ error: "La contraseña no cumple la política" });
    const rec = await prisma.passwordResetToken.findUnique({ where: { token } });
    if (!rec || rec.usedAt)
        return res.status(400).json({ error: "Token inválido" });
    const hash = await bcrypt.hash(contrasena, 10);
    await prisma.$transaction([
        prisma.cuenta.update({ where: { id: rec.cuentaId }, data: { hash } }),
        prisma.passwordResetToken.update({ where: { id: rec.id }, data: { usedAt: new Date() } }),
    ]);
    return res.json({ ok: true });
});
app.get("/me", auth(), async (req, res) => {
    const cuenta = await fetchCuenta(req);
    if (!cuenta)
        return res.status(404).json({ error: "Cuenta no encontrada" });
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
    if (!cuenta)
        return res.status(404).json({ error: "Cuenta no encontrada" });
    const { correo, telefono, nombres, apellidos, direccion, nombre, especialidad, actualContrasena, nuevaContrasena } = req.body || {};
    if (correo) {
        if (!isValidEmail(correo))
            return res.status(400).json({ error: "Correo inválido" });
        if (correo !== cuenta.correo) {
            const exists = await prisma.cuenta.findUnique({ where: { correo } });
            if (exists)
                return res.status(409).json({ error: "Correo ya registrado" });
        }
    }
    if (nuevaContrasena) {
        if (!actualContrasena)
            return res.status(400).json({ error: "Debe proporcionar su contraseña actual" });
        const ok = await bcrypt.compare(actualContrasena, cuenta.hash);
        if (!ok)
            return res.status(400).json({ error: "Contraseña actual incorrecta" });
        if (!isStrongPassword(nuevaContrasena))
            return res.status(400).json({ error: "La nueva contraseña no cumple la política" });
        const hash = await bcrypt.hash(nuevaContrasena, 10);
        await prisma.cuenta.update({ where: { id: cuenta.id }, data: { hash } });
    }
    if (correo && correo !== cuenta.correo) {
        await prisma.cuenta.update({ where: { id: cuenta.id }, data: { correo } });
    }
    if (cuenta.rol === "dueno") {
        await prisma.dueno.update({ where: { cuentaId: cuenta.id }, data: { telefono, nombres, apellidos, direccion } });
    }
    else if (cuenta.rol === "veterinario") {
        await prisma.veterinario.update({ where: { cuentaId: cuenta.id }, data: { telefono, nombre, apellidos, especialidad } });
    }
    return res.json({ ok: true });
});
// --- Eliminación de cuenta -------------------------------------------------
app.post("/account/delete-request", auth(), async (req, res) => {
    const cuenta = await fetchCuenta(req);
    if (!cuenta)
        return res.status(404).json({ error: "Cuenta no encontrada" });
    const { motivo } = req.body || {};
    await prisma.deleteRequest.create({ data: { cuentaId: cuenta.id, motivo: motivo ?? null } });
    return res.json({ ok: true });
});
// --- Admin -----------------------------------------------------------------
app.get("/admin/pending-vets", auth(), async (req, res) => {
    if (req.user?.rol !== "admin")
        return res.status(403).json({ error: "Solo admin" });
    const vets = await prisma.veterinario.findMany({
        where: { cuenta: { estado: "pending" } },
        include: { cuenta: true, centro: true },
    });
    return res.json(vets);
});
app.post("/admin/vets/:id/approve", auth(), async (req, res) => {
    if (req.user?.rol !== "admin")
        return res.status(403).json({ error: "Solo admin" });
    const vetId = req.params.id;
    if (!vetId)
        return res.status(400).json({ error: "Id inválido" });
    const vet = await prisma.veterinario.findUnique({ where: { id: vetId }, include: { cuenta: true } });
    if (!vet)
        return res.status(404).json({ error: "Veterinario no encontrado" });
    const confirmToken = await prisma.emailConfirmationToken.create({ data: { cuentaId: vet.cuentaId, token: randomUUID() } });
    await prisma.cuenta.update({ where: { id: vet.cuentaId }, data: { estado: "inactive" } });
    await enqueueNotification({
        cuentaId: vet.cuentaId,
        correoDestino: vet.cuenta?.correo || "",
        tipo: "aprobacion-veterinario",
        payload: { token: confirmToken.token },
    });
    return res.json({ ok: true, confirmToken: confirmToken.token });
});
app.post("/admin/vets/:id/reject", auth(), async (req, res) => {
    if (req.user?.rol !== "admin")
        return res.status(403).json({ error: "Solo admin" });
    const { motivo } = req.body || {};
    const vetId = req.params.id;
    if (!vetId)
        return res.status(400).json({ error: "Id inválido" });
    const vet = await prisma.veterinario.findUnique({ where: { id: vetId }, include: { cuenta: true } });
    if (!vet)
        return res.status(404).json({ error: "Veterinario no encontrado" });
    await prisma.cuenta.update({ where: { id: vet.cuentaId }, data: { estado: "rejected" } });
    await enqueueNotification({
        cuentaId: vet.cuentaId,
        correoDestino: vet.cuenta?.correo || "",
        tipo: "rechazo-veterinario",
        payload: { motivo },
    });
    return res.json({ ok: true });
});
// --- Centros ---------------------------------------------------------------
app.get("/centros", async (_req, res) => {
    const centros = await prisma.centroVeterinario.findMany({ include: { consultorios: true } });
    return res.json(centros);
});
app.post("/centros", auth(), async (req, res) => {
    if (!req.user)
        return res.status(401).json({ error: "No autorizado" });
    const { nombre, direccion, telefono, email, rangoAtencionInicio, rangoAtencionFin, rangoConsultaInicio, rangoConsultaFin, consultorios } = req.body || {};
    if (!nombre || !direccion)
        return res.status(400).json({ error: "Nombre y dirección son obligatorios" });
    let creadorVet = null;
    if (req.user.rol === "veterinario") {
        const vet = await prisma.veterinario.findUnique({ where: { cuentaId: req.user.id } });
        if (!vet)
            return res.status(403).json({ error: "Veterinario no encontrado" });
        if (!vet.puedeCrearCentro)
            return res.status(403).json({ error: "No autorizado para crear centro" });
        creadorVet = { id: vet.id };
    }
    else if (req.user.rol !== "admin") {
        return res.status(403).json({ error: "No autorizado" });
    }
    const data = {
        nombre,
        direccion,
        telefono: telefono ?? undefined,
        email: email ?? undefined,
        rangoAtencionInicio: rangoAtencionInicio ?? undefined,
        rangoAtencionFin: rangoAtencionFin ?? undefined,
        rangoConsultaInicio: rangoConsultaInicio ?? undefined,
        rangoConsultaFin: rangoConsultaFin ?? undefined,
        consultorios: { create: (consultorios || []).map((nombre) => ({ nombre })) },
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
// --- Programación y agenda -------------------------------------------------
app.post("/vet/programaciones", auth(), async (req, res) => {
    if (req.user?.rol !== "veterinario")
        return res.status(403).json({ error: "Solo veterinarios" });
    const { centroId, consultorioId, fechaInicio, fechaFin, horaInicio, horaFin, duracionMinutos } = req.body || {};
    if (!centroId || !fechaInicio || !fechaFin || !horaInicio || !horaFin) {
        return res.status(400).json({ error: "Datos incompletos" });
    }
    const vet = await prisma.veterinario.findUnique({ where: { cuentaId: req.user.id } });
    if (!vet)
        return res.status(404).json({ error: "Veterinario no encontrado" });
    const centro = await prisma.centroVeterinario.findUnique({ where: { id: centroId } });
    if (!centro)
        return res.status(404).json({ error: "Centro no encontrado" });
    const inicio = new Date(fechaInicio);
    const fin = new Date(fechaFin);
    if (inicio > fin)
        return res.status(400).json({ error: "Rango inválido" });
    const { h: hi, m: mi } = parseHM(horaInicio);
    const { h: hf, m: mf } = parseHM(horaFin);
    const duracion = typeof duracionMinutos === "number" && duracionMinutos > 0 ? duracionMinutos : 30;
    const programacion = await prisma.programacion.create({
        data: { veterinarioId: vet.id, fechaInicio: inicio, fechaFin: fin },
    });
    const slots = [];
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
    const { veterinarioId, centroId } = req.query;
    if (!veterinarioId)
        return res.status(400).json({ error: "Debe indicar veterinarioId" });
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
    if (req.user?.rol !== "dueno")
        return res.status(403).json({ error: "Solo dueños" });
    const dueno = await prisma.dueno.findUnique({ where: { cuentaId: req.user.id } });
    if (!dueno)
        return res.json([]);
    const mascotas = await prisma.mascota.findMany({ where: { duenoId: dueno.id } });
    return res.json(mascotas);
});
app.post("/mascotas", auth(), async (req, res) => {
    if (req.user?.rol !== "dueno")
        return res.status(403).json({ error: "Solo dueños" });
    const dueno = await prisma.dueno.findUnique({ where: { cuentaId: req.user.id } });
    if (!dueno)
        return res.status(404).json({ error: "Dueño no encontrado" });
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
    }
    catch (err) {
        return res.status(409).json({ error: "Ya existe una mascota similar registrada" });
    }
});
app.put("/mascotas/:id", auth(), async (req, res) => {
    if (req.user?.rol !== "dueno")
        return res.status(403).json({ error: "Solo dueños" });
    const dueno = await prisma.dueno.findUnique({ where: { cuentaId: req.user.id } });
    if (!dueno)
        return res.status(404).json({ error: "Dueño no encontrado" });
    const mascotaId = req.params.id;
    if (!mascotaId)
        return res.status(400).json({ error: "Id inválido" });
    const mascota = await prisma.mascota.findUnique({ where: { id: mascotaId } });
    if (!mascota || mascota.duenoId !== dueno.id)
        return res.status(404).json({ error: "Mascota no encontrada" });
    const data = req.body || {};
    try {
        const updated = await prisma.mascota.update({ where: { id: mascota.id }, data });
        return res.json(updated);
    }
    catch (err) {
        return res.status(409).json({ error: "Actualización provocaría duplicado" });
    }
});
app.delete("/mascotas/:id", auth(), async (req, res) => {
    if (req.user?.rol !== "dueno")
        return res.status(403).json({ error: "Solo dueños" });
    const dueno = await prisma.dueno.findUnique({ where: { cuentaId: req.user.id } });
    if (!dueno)
        return res.status(404).json({ error: "Dueño no encontrado" });
    const mascotaId = req.params.id;
    if (!mascotaId)
        return res.status(400).json({ error: "Id inválido" });
    const mascota = await prisma.mascota.findUnique({ where: { id: mascotaId } });
    if (!mascota || mascota.duenoId !== dueno.id)
        return res.status(404).json({ error: "Mascota no encontrada" });
    await prisma.mascota.update({ where: { id: mascota.id }, data: { activa: false } });
    return res.json({ ok: true });
});
// --- Citas -----------------------------------------------------------------
app.get("/citas/owner", auth(), async (req, res) => {
    if (req.user?.rol !== "dueno")
        return res.status(403).json({ error: "Solo dueños" });
    const dueno = await prisma.dueno.findUnique({ where: { cuentaId: req.user.id } });
    if (!dueno)
        return res.json([]);
    const citas = await prisma.cita.findMany({
        where: { duenoId: dueno.id },
        include: { veterinario: true, mascota: true, centro: true, slot: true },
        orderBy: { fecha: "asc" },
    });
    return res.json(citas);
});
app.get("/citas/vet", auth(), async (req, res) => {
    if (req.user?.rol !== "veterinario")
        return res.status(403).json({ error: "Solo veterinarios" });
    const vet = await prisma.veterinario.findUnique({ where: { cuentaId: req.user.id } });
    if (!vet)
        return res.json([]);
    const citas = await prisma.cita.findMany({
        where: { veterinarioId: vet.id },
        include: { dueno: true, mascota: true, centro: true, slot: true },
        orderBy: { fecha: "asc" },
    });
    return res.json(citas);
});
app.post("/citas", auth(), async (req, res) => {
    if (req.user?.rol !== "dueno")
        return res.status(403).json({ error: "Solo dueños" });
    const dueno = await prisma.dueno.findUnique({ where: { cuentaId: req.user.id } });
    if (!dueno)
        return res.status(404).json({ error: "Dueño no encontrado" });
    const { mascotaId, veterinarioId, motivo, slotId } = req.body || {};
    if (!mascotaId || !veterinarioId || !motivo || !slotId) {
        return res.status(400).json({ error: "Datos incompletos" });
    }
    const mascota = await prisma.mascota.findUnique({ where: { id: mascotaId } });
    if (!mascota || mascota.duenoId !== dueno.id)
        return res.status(404).json({ error: "Mascota no encontrada" });
    const slot = await prisma.horarioSlot.findUnique({ where: { id: slotId } });
    if (!slot || slot.estado !== "LIBRE" || slot.veterinarioId !== veterinarioId) {
        return res.status(409).json({ error: "El horario ya no está disponible" });
    }
    if (!isWithinTwoWeeks(slot.fechaInicio))
        return res.status(400).json({ error: "Solo puede agendar dentro de dos semanas" });
    const diffHours = (slot.fechaInicio.getTime() - Date.now()) / 3600000;
    if (diffHours < 24)
        return res.status(400).json({ error: "Debe reservar con 24h de anticipación" });
    const cita = await prisma.cita.create({
        data: {
            motivo,
            fecha: slot.fechaInicio,
            estado: "Programada",
            centroId: slot.centroId,
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
    });
    return res.status(201).json(cita);
});
app.patch("/citas/:id/cancel", auth(), async (req, res) => {
    const { motivo } = req.body || {};
    const citaId = req.params.id;
    if (!citaId)
        return res.status(400).json({ error: "Id inválido" });
    const cita = await prisma.cita.findUnique({ where: { id: citaId }, include: { slot: true, dueno: { include: { cuenta: true } }, veterinario: { include: { cuenta: true } } } });
    if (!cita)
        return res.status(404).json({ error: "Cita no encontrada" });
    const now = new Date();
    const diffHours = (cita.fecha.getTime() - now.getTime()) / 3600000;
    if (diffHours < 3)
        return res.status(400).json({ error: "Solo puede cancelar con 3h de anticipación" });
    if (req.user?.rol === "dueno") {
        const dueno = await prisma.dueno.findUnique({ where: { cuentaId: req.user.id } });
        if (!dueno || cita.duenoId !== dueno.id)
            return res.status(403).json({ error: "No autorizado" });
    }
    else if (req.user?.rol === "veterinario") {
        const vet = await prisma.veterinario.findUnique({ where: { cuentaId: req.user.id } });
        if (!vet || cita.veterinarioId !== vet.id)
            return res.status(403).json({ error: "No autorizado" });
    }
    else {
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
        });
    }
    return res.json({ ok: true });
});
app.patch("/citas/:id/atender", auth(), async (req, res) => {
    if (req.user?.rol !== "veterinario")
        return res.status(403).json({ error: "Solo veterinarios" });
    const vet = await prisma.veterinario.findUnique({ where: { cuentaId: req.user.id } });
    if (!vet)
        return res.status(404).json({ error: "Veterinario no encontrado" });
    const citaId = req.params.id;
    if (!citaId)
        return res.status(400).json({ error: "Id inválido" });
    const cita = await prisma.cita.findUnique({ where: { id: citaId }, include: { slot: true, mascota: true } });
    if (!cita || cita.veterinarioId !== vet.id)
        return res.status(404).json({ error: "Cita no encontrada" });
    const { hallazgos, pruebas, tratamiento, estado } = req.body || {};
    const nuevoEstado = (estado === "Confirmada" || estado === "Atendida") ? estado : "Atendida";
    const updateData = {
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
    if (!mascotaId)
        return res.status(400).json({ error: "Id inválido" });
    const mascota = await prisma.mascota.findUnique({ where: { id: mascotaId }, include: { dueno: { include: { cuenta: true } } } });
    if (!mascota)
        return res.status(404).json({ error: "Mascota no encontrada" });
    if (req.user?.rol === "dueno") {
        const dueno = await prisma.dueno.findUnique({ where: { cuentaId: req.user.id } });
        if (!dueno || mascota.duenoId !== dueno.id)
            return res.status(403).json({ error: "No autorizado" });
    }
    if (req.user?.rol === "veterinario") {
        const vet = await prisma.veterinario.findUnique({ where: { cuentaId: req.user.id } });
        if (!vet)
            return res.status(403).json({ error: "No autorizado" });
        const attended = await prisma.cita.findFirst({ where: { mascotaId: mascota.id, veterinarioId: vet.id } });
        if (!attended)
            return res.status(403).json({ error: "No tiene acceso al historial" });
    }
    const citas = await prisma.cita.findMany({ where: { mascotaId: mascota.id }, orderBy: { fecha: "asc" } });
    return res.json({ mascota, citas });
});
app.get("/notificaciones", auth(), async (req, res) => {
    const cuenta = await fetchCuenta(req);
    if (!cuenta)
        return res.status(401).json({ error: "No autorizado" });
    const notifs = await prisma.notificacion.findMany({ where: { cuentaId: cuenta.id }, orderBy: { createdAt: "desc" } });
    return res.json(notifs);
});
const port = process.env.PORT || 4000;
app.listen(port, () => {
    console.log(`VetChain API listening on port ${port}`);
});
//# sourceMappingURL=server.js.map