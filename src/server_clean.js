import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { PrismaClient } from "../generated/prisma/index.js";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
dotenv.config();
const app = express();
const prisma = new PrismaClient();
app.use(cors());
app.use(express.json({ limit: "1mb" }));
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
function signJWT(payload) {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}
function auth(required = true) {
    return (req, res, next) => {
        const auth = req.headers.authorization;
        if (!auth) {
            if (required)
                return res.status(401).json({ error: "No autorizado" });
            req.user = null;
            return next();
        }
        const token = auth.replace("Bearer ", "");
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            req.user = decoded;
            next();
        }
        catch {
            if (required)
                return res.status(401).json({ error: "Token inv?lido" });
            req.user = null;
            next();
        }
    };
}
// Helpers
function isValidEmail(email) {
    return /.+@.+\..+/.test(email);
}
function isStrongPassword(pwd) {
    return /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/.test(pwd);
}
// Auth endpoints
app.post("/auth/register/owner", async (req, res) => {
    const { dni, nombres, apellidos, correo, contrasena, telefono } = req.body || {};
    if (!dni || !nombres || !apellidos || !correo || !contrasena || !telefono) {
        return res.status(400).json({ error: "Campos obligatorios faltantes" }); // RN24
    }
    if (!isValidEmail(correo))
        return res.status(400).json({ error: "Correo inv?lido" });
    if (!isStrongPassword(contrasena))
        return res.status(400).json({ error: "Contrase?a no cumple pol?tica" }); // RN25
    const exists = await prisma.cuenta.findUnique({ where: { correo } });
    if (exists)
        return res.status(409).json({ error: "Correo ya registrado" }); // RN23
    const hash = await bcrypt.hash(contrasena, 10);
    const cuenta = await prisma.cuenta.create({
        data: { correo, hash, rol: 'dueno', estado: 'pending' },
    });
    await prisma.dueno.create({
        data: { cuentaId: cuenta.id, dni, nombres, apellidos, telefono },
    });
    const token = await prisma.emailConfirmationToken.create({ data: { cuentaId: cuenta.id, token: randomUUID() } });
    // En proyecto real: enviar correo con token.token (RN26)
    return res.status(201).json({ id: cuenta.id, confirmToken: token.token });
});
app.post("/auth/register/vet", async (req, res) => {
    const { dni, nombre, correo, contrasena, especialidad, tituloURL, constanciaURL, centroId } = req.body || {};
    if (!dni || !nombre || !correo || !contrasena || !especialidad) {
        return res.status(400).json({ error: "Campos obligatorios faltantes" }); // RN29
    }
    if (!isValidEmail(correo))
        return res.status(400).json({ error: "Correo inv?lido" });
    if (!isStrongPassword(contrasena))
        return res.status(400).json({ error: "Contrase?a no cumple pol?tica" }); // RN25
    const exists = await prisma.cuenta.findUnique({ where: { correo } });
    if (exists)
        return res.status(409).json({ error: "Correo ya registrado" }); // RN28
    const hash = await bcrypt.hash(contrasena, 10);
    const cuenta = await prisma.cuenta.create({ data: { correo, hash, rol: 'veterinario', estado: 'pending' } });
    await prisma.veterinario.create({
        data: { cuentaId: cuenta.id, dni, nombre, especialidad, tituloURL, constanciaURL, centroId },
    });
    return res.status(201).json({ id: cuenta.id }); // RN31 pendiente hasta aprobaci?n admin
});
app.post("/auth/confirm-email", async (req, res) => {
    const { token } = req.body || {};
    const rec = await prisma.emailConfirmationToken.findUnique({ where: { token } });
    if (!rec || rec.usedAt)
        return res.status(400).json({ error: "Token inv?lido" });
    await prisma.$transaction([
        prisma.cuenta.update({ where: { id: rec.cuentaId }, data: { estado: 'active', confirmadoEn: new Date() } }),
        prisma.emailConfirmationToken.update({ where: { id: rec.id }, data: { usedAt: new Date() } }),
    ]);
    return res.json({ ok: true });
});
app.post("/auth/login", async (req, res) => {
    const { correo, contrasena } = req.body || {};
    if (!correo || !contrasena)
        return res.status(400).json({ error: "Debe ingresar correo y contrase?a" }); // RN01
    const cuenta = await prisma.cuenta.findUnique({ where: { correo } });
    if (!cuenta)
        return res.status(401).json({ error: "Credenciales inv?lidas (correo o contrase?a)" }); // RN02
    const ok = await bcrypt.compare(contrasena, cuenta.hash);
    if (!ok)
        return res.status(401).json({ error: "Credenciales inv?lidas (correo o contrase?a)" }); // RN04
    if (cuenta.estado !== 'active')
        return res.status(403).json({ error: "Cuenta no activa o pendiente de aprobaci?n" }); // RN05
    const token = signJWT({ id: cuenta.id, rol: cuenta.rol });
    return res.json({ token, rol: cuenta.rol }); // RN06 redirecci?n por rol en front
});
app.post("/auth/request-password-reset", async (req, res) => {
    const { correo } = req.body || {};
    const cuenta = await prisma.cuenta.findUnique({ where: { correo } });
    if (!cuenta)
        return res.json({ ok: true }); // ocultar existencia
    const token = await prisma.passwordResetToken.create({ data: { cuentaId: cuenta.id, token: randomUUID() } });
    // Enviar correo con token.token (RN12)
    return res.json({ ok: true, token: token.token });
});
app.post("/auth/reset-password", async (req, res) => {
    const { token, contrasena } = req.body || {};
    const rec = await prisma.passwordResetToken.findUnique({ where: { token } });
    if (!rec || rec.usedAt)
        return res.status(400).json({ error: "Token inv?lido" });
    if (!isStrongPassword(contrasena))
        return res.status(400).json({ error: "Contrase?a no cumple pol?tica" });
    const hash = await bcrypt.hash(contrasena, 10);
    await prisma.$transaction([
        prisma.cuenta.update({ where: { id: rec.cuentaId }, data: { hash } }),
        prisma.passwordResetToken.update({ where: { id: rec.id }, data: { usedAt: new Date() } }),
    ]);
    return res.json({ ok: true });
});
// Me endpoints (perfil)
app.get("/me", auth(), async (req, res) => {
    const cuenta = await prisma.cuenta.findUnique({ where: { id: req.user.id } });
    if (!cuenta)
        return res.status(404).json({ error: "Cuenta no encontrada" });
    if (cuenta.rol === "dueno") {
        const dueno = await prisma.dueno.findUnique({ where: { cuentaId: cuenta.id } });
        return res.json({ cuenta: { id: cuenta.id, correo: cuenta.correo, rol: cuenta.rol, estado: cuenta.estado }, dueno });
    }
    if (cuenta.rol === "veterinario") {
        const vet = await prisma.veterinario.findUnique({ where: { cuentaId: cuenta.id } });
        return res.json({ cuenta: { id: cuenta.id, correo: cuenta.correo, rol: cuenta.rol, estado: cuenta.estado }, veterinario: vet });
    }
    return res.json({ cuenta: { id: cuenta.id, correo: cuenta.correo, rol: cuenta.rol, estado: cuenta.estado } });
});
app.put("/me", auth(), async (req, res) => {
    const cuenta = await prisma.cuenta.findUnique({ where: { id: req.user.id } });
    if (!cuenta)
        return res.status(404).json({ error: "Cuenta no encontrada" });
    const { correo, telefono, nombres, apellidos, direccion, nombre, especialidad } = req.body || {};
    if (correo && !isValidEmail(correo))
        return res.status(400).json({ error: "Correo inv?lido" });
    if (correo && correo !== cuenta.correo) {
        const exists = await prisma.cuenta.findUnique({ where: { correo } });
        if (exists)
            return res.status(409).json({ error: "Correo ya registrado" }); // RN63
    }
    await prisma.cuenta.update({ where: { id: cuenta.id }, data: { correo: correo ?? cuenta.correo } });
    if (cuenta.rol === "dueno") {
        await prisma.dueno.update({ where: { cuentaId: cuenta.id }, data: { telefono, nombres, apellidos, direccion } });
    }
    else if (cuenta.rol === "veterinario") {
        await prisma.veterinario.update({ where: { cuentaId: cuenta.id }, data: { telefono, nombre, especialidad } });
    }
    return res.json({ ok: true });
});
// Account deletion request
app.post("/account/delete-request", auth(), async (req, res) => {
    await prisma.deleteRequest.create({ data: { cuentaId: req.user.id } });
    return res.json({ ok: true }); // RN14-16: admin aprobar? luego
});
// Admin endpoints
app.get("/admin/pending-vets", auth(), async (req, res) => {
    const me = await prisma.cuenta.findUnique({ where: { id: req.user.id } });
    if (me?.rol !== "admin")
        return res.status(403).json({ error: "Solo admin" });
    const vets = await prisma.veterinario.findMany({
        where: { cuenta: { estado: pending } },
        include: { cuenta: true },
    });
    return res.json(vets);
});
app.post("/admin/vets/:id/approve", auth(), async (req, res) => {
    const me = await prisma.cuenta.findUnique({ where: { id: req.user.id } });
    if (me?.rol !== "admin")
        return res.status(403).json({ error: "Solo admin" });
    const vet = await prisma.veterinario.findUnique({ where: { id: req.params.id } });
    if (!vet)
        return res.status(404).json({ error: "No encontrado" });
    await prisma.cuenta.update({ where: { id: vet.cuentaId }, data: { estado: active } });
    return res.json({ ok: true });
});
app.post("/admin/vets/:id/reject", auth(), async (req, res) => {
    const me = await prisma.cuenta.findUnique({ where: { id: req.user.id } });
    if (me?.rol !== "admin")
        return res.status(403).json({ error: "Solo admin" });
    const vet = await prisma.veterinario.findUnique({ where: { id: req.params.id } });
    if (!vet)
        return res.status(404).json({ error: "No encontrado" });
    await prisma.cuenta.update({ where: { id: vet.cuentaId }, data: { estado: rejected } });
    return res.json({ ok: true });
});
// Centros
app.get("/centros", async (_req, res) => {
    const centros = await prisma.centroVeterinario.findMany({ include: { consultorios: true } });
    return res.json(centros);
});
app.post("/centros", auth(), async (req, res) => {
    const me = await prisma.cuenta.findUnique({ where: { id: req.user.id } });
    if (me?.rol !== "admin" && me?.rol !== "veterinario")
        return res.status(403).json({ error: "No autorizado" });
    const { nombre, direccion, telefono, email, rangoAtencionInicio, rangoAtencionFin, rangoConsultaInicio, rangoConsultaFin, consultorios } = req.body || {};
    const centro = await prisma.centroVeterinario.create({
        data: { nombre, direccion, telefono, email, rangoAtencionInicio, rangoAtencionFin, rangoConsultaInicio, rangoConsultaFin,
            consultorios: { create: (consultorios || []).map((n) => ({ nombre: n.nombre || String(n) })) },
        },
    });
    return res.status(201).json(centro);
});
// Mascotas
app.get("/pets", auth(), async (req, res) => {
    const me = await prisma.cuenta.findUnique({ where: { id: req.user.id } });
    if (me?.rol !== "dueno")
        return res.status(403).json({ error: "Solo due?os" });
    const dueno = await prisma.dueno.findUnique({ where: { cuentaId: me.id } });
    if (!dueno)
        return res.json([]);
    const mascotas = await prisma.mascota.findMany({ where: { duenoId: dueno.id } });
    return res.json(mascotas);
});
app.post("/pets", auth(), async (req, res) => {
    const me = await prisma.cuenta.findUnique({ where: { id: req.user.id } });
    if (me?.rol !== "dueno")
        return res.status(403).json({ error: "Solo due?os" });
    const dueno = await prisma.dueno.findUnique({ where: { cuentaId: me.id } });
    const { nombre, especie, raza, genero, edad, peso, imagenURL, descripcion } = req.body || {};
    if (!nombre || !especie || !genero || !raza || typeof edad !== "number")
        return res.status(400).json({ error: "Campos obligatorios faltantes" }); // RN65
    try {
        const mascota = await prisma.mascota.create({
            data: { duenoId: dueno.id, nombre, especie, raza, genero, edad, peso, imagenURL, descripcion, historial: { create: {} } },
        });
        return res.status(201).json(mascota);
    }
    catch (e) {
        return res.status(409).json({ error: "Duplicado para este due?o (nombre+especie+edad)" }); // RN68
    }
});
app.put("/pets/:id", auth(), async (req, res) => {
    const me = await prisma.cuenta.findUnique({ where: { id: req.user.id } });
    if (me?.rol !== "dueno")
        return res.status(403).json({ error: "Solo due?os" });
    const dueno = await prisma.dueno.findUnique({ where: { cuentaId: me.id } });
    const pet = await prisma.mascota.findUnique({ where: { id: req.params.id } });
    if (!pet || pet.duenoId !== dueno?.id)
        return res.status(404).json({ error: "Mascota no encontrada" }); // RN85
    const data = req.body || {};
    try {
        const updated = await prisma.mascota.update({ where: { id: pet.id }, data });
        return res.json(updated);
    }
    catch {
        return res.status(409).json({ error: "Cambios generar?an duplicado" }); // RN87
    }
});
app.delete("/pets/:id", auth(), async (req, res) => {
    const me = await prisma.cuenta.findUnique({ where: { id: req.user.id } });
    if (me?.rol !== "dueno")
        return res.status(403).json({ error: "Solo due?os" });
    const dueno = await prisma.dueno.findUnique({ where: { cuentaId: me.id } });
    const pet = await prisma.mascota.findUnique({ where: { id: req.params.id } });
    if (!pet || pet.duenoId !== dueno?.id)
        return res.status(404).json({ error: "Mascota no encontrada" });
    await prisma.mascota.update({ where: { id: pet.id }, data: { activa: false } }); // RN76 inactivo, conserva historial
    return res.json({ ok: true });
});
// Citas
app.get("/citas/owner", auth(), async (req, res) => {
    const me = await prisma.cuenta.findUnique({ where: { id: req.user.id } });
    if (me?.rol !== "dueno")
        return res.status(403).json({ error: "Solo due?os" });
    const dueno = await prisma.dueno.findUnique({ where: { cuentaId: me.id } });
    const citas = await prisma.cita.findMany({ where: { duenoId: dueno.id }, orderBy: { fecha: "asc" } });
    return res.json(citas);
});
app.get("/citas/vet", auth(), async (req, res) => {
    const me = await prisma.cuenta.findUnique({ where: { id: req.user.id } });
    if (me?.rol !== "veterinario")
        return res.status(403).json({ error: "Solo veterinarios" });
    const vet = await prisma.veterinario.findUnique({ where: { cuentaId: me.id } });
    const citas = await prisma.cita.findMany({ where: { veterinarioId: vet.id }, orderBy: { fecha: "asc" } });
    return res.json(citas);
});
app.post("/citas", auth(), async (req, res) => {
    const me = await prisma.cuenta.findUnique({ where: { id: req.user.id } });
    if (me?.rol !== "dueno")
        return res.status(403).json({ error: "Solo due?os" });
    const dueno = await prisma.dueno.findUnique({ where: { cuentaId: me.id } });
    const { motivo, fechaISO, horaTexto, centroId, veterinarioId, mascotaId, consultorioId } = req.body || {};
    const fecha = new Date(fechaISO);
    const collide = await prisma.cita.findFirst({ where: { veterinarioId, fecha, horaTexto, estado: { not: 'Cancelada' } } });
    if (collide)
        return res.status(409).json({ error: "Horario no disponible" });
    const cita = await prisma.cita.create({
        data: {
            motivo: motivo || "Consulta",
            fecha,
            horaTexto,
            centroId,
            veterinarioId,
            mascotaId,
            duenoId: dueno.id,
            consultorioId,
        },
    });
    return res.status(201).json(cita);
});
app.get("/historial/:mascotaId", auth(), async (req, res) => {
    const me = await prisma.cuenta.findUnique({ where: { id: req.user.id } });
    const mascota = await prisma.mascota.findUnique({ where: { id: req.params.mascotaId } });
    if (!mascota)
        return res.status(404).json({ error: "Mascota no encontrada" });
    if (me?.rol === "dueno") {
        const due, o = await prisma.dueno.findUnique({ where: { cuentaId: me.id } });
        if (mascota.duenoId !== due ? o?.id : )
            return res.status(403).json({ error: "No autorizado" });
    }
    if (me?.rol === "veterinario") {
        const vet = await prisma.veterinario.findUnique({ where: { cuentaId: me.id } });
        const attended = await prisma.cita.findFirst({ where: { mascotaId: mascota.id, veterinarioId: vet.id } });
        if (!attended)
            return res.status(403).json({ error: "Restricci?n de acceso" }); // RN56
    }
    const citas = await prisma.cita.findMany({ where: { mascotaId: mascota.id, estado: 'Atendida' }, orderBy: { fecha: "asc" } });
    return res.json(citas);
});
// Attend (vet)
app.patch("/citas/:id/atender", auth(), async (req, res) => {
    const me = await prisma.cuenta.findUnique({ where: { id: req.user.id } });
    if (me?.rol !== "veterinario")
        return res.status(403).json({ error: "Solo veterinarios" });
    const { hallazgos, prueba, tratamiento } = req.body || {};
    const cita = await prisma.cita.findUnique({ where: { id: req.params.id } });
    if (!cita)
        return res.status(404).json({ error: "Cita no encontrada" });
    const hist = await prisma.historialClinico.findUnique({ where: { mascotaId: cita.mascotaId } });
    const data = {
        estado: 'Atendida',
        hallazgos: JSON.stringify(hallazgos || []),
        prueba,
        tratamiento,
    };
    if (hist)
        data.historial = { connect: { id: hist.id } };
    await prisma.cita.update({ where: { id: cita.id }, data });
    return res.json({ ok: true });
});
const port = process.env.PORT || 4000;
app.listen(port, () => {
    console.log(`VetChain API listening on port ${port}`);
});
//# sourceMappingURL=server_clean.js.map