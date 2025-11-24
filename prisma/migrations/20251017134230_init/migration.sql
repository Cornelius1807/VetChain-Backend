-- Base enums ------------------------------------------------------------------

CREATE TYPE "Rol" AS ENUM ('dueno', 'veterinario', 'admin');
CREATE TYPE "EstadoCuenta" AS ENUM ('active', 'inactive', 'pending', 'rejected');
CREATE TYPE "EstadoCita" AS ENUM ('Programada', 'Confirmada', 'Atendida', 'Cancelada', 'Rechazada');
CREATE TYPE "EstadoSlot" AS ENUM ('LIBRE', 'RESERVADO', 'BLOQUEADO', 'FUERA_RANGO');

-- Tablas principales ----------------------------------------------------------

CREATE TABLE "Cuenta" (
  "id"           TEXT         NOT NULL,
  "correo"       TEXT         NOT NULL,
  "hash"         TEXT         NOT NULL,
  "rol"          "Rol"        NOT NULL,
  "estado"       "EstadoCuenta" NOT NULL DEFAULT 'pending',
  "creadoEn"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmadoEn" TIMESTAMP(3),
  "eliminadoEn"  TIMESTAMP(3),
  CONSTRAINT "Cuenta_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PasswordResetToken" (
  "id"        TEXT        NOT NULL,
  "token"     TEXT        NOT NULL,
  "cuentaId"  TEXT        NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "usedAt"    TIMESTAMP(3),
  CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmailConfirmationToken" (
  "id"        TEXT        NOT NULL,
  "token"     TEXT        NOT NULL,
  "cuentaId"  TEXT        NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "usedAt"    TIMESTAMP(3),
  CONSTRAINT "EmailConfirmationToken_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeleteRequest" (
  "id"         TEXT        NOT NULL,
  "cuentaId"   TEXT        NOT NULL,
  "motivo"     TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approvedAt" TIMESTAMP(3),
  "rejectedAt" TIMESTAMP(3),
  CONSTRAINT "DeleteRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Dueno" (
  "id"        TEXT NOT NULL,
  "cuentaId"  TEXT NOT NULL,
  "dni"       TEXT NOT NULL,
  "nombres"   TEXT NOT NULL,
  "apellidos" TEXT NOT NULL,
  "telefono"  TEXT NOT NULL,
  "direccion" TEXT,
  CONSTRAINT "Dueno_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Veterinario" (
  "id"               TEXT    NOT NULL,
  "cuentaId"         TEXT    NOT NULL,
  "dni"              TEXT    NOT NULL,
  "nombre"           TEXT    NOT NULL,
  "apellidos"        TEXT,
  "telefono"         TEXT,
  "especialidad"     TEXT    NOT NULL,
  "centroId"         TEXT,
  "tituloURL"        TEXT,
  "constanciaURL"    TEXT,
  "puedeCrearCentro" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "Veterinario_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CentroVeterinario" (
  "id"                  TEXT NOT NULL,
  "nombre"              TEXT NOT NULL,
  "direccion"           TEXT NOT NULL,
  "telefono"            TEXT,
  "email"               TEXT,
  "rangoAtencionInicio" TEXT,
  "rangoAtencionFin"    TEXT,
  "rangoConsultaInicio" TEXT,
  "rangoConsultaFin"    TEXT,
  "creadoPorVetId"      TEXT,
  CONSTRAINT "CentroVeterinario_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Consultorio" (
  "id"       TEXT NOT NULL,
  "centroId" TEXT NOT NULL,
  "nombre"   TEXT NOT NULL,
  CONSTRAINT "Consultorio_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Programacion" (
  "id"            TEXT       NOT NULL,
  "veterinarioId" TEXT       NOT NULL,
  "fechaInicio"   TIMESTAMP(3) NOT NULL,
  "fechaFin"      TIMESTAMP(3) NOT NULL,
  "creadoEn"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Programacion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HorarioSlot" (
  "id"             TEXT       NOT NULL,
  "veterinarioId"  TEXT       NOT NULL,
  "centroId"       TEXT,
  "consultorioId"  TEXT,
  "programacionId" TEXT,
  "fechaInicio"    TIMESTAMP(3) NOT NULL,
  "fechaFin"       TIMESTAMP(3) NOT NULL,
  "estado"         "EstadoSlot" NOT NULL DEFAULT 'LIBRE',
  "motivo"         TEXT,
  CONSTRAINT "HorarioSlot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Mascota" (
  "id"          TEXT   NOT NULL,
  "duenoId"     TEXT   NOT NULL,
  "nombre"      TEXT   NOT NULL,
  "especie"     TEXT   NOT NULL,
  "raza"        TEXT   NOT NULL,
  "genero"      TEXT   NOT NULL,
  "edad"        INTEGER NOT NULL,
  "peso"        DOUBLE PRECISION,
  "imagenURL"   TEXT,
  "descripcion" TEXT,
  "activa"      BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "Mascota_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HistorialClinico" (
  "id"        TEXT NOT NULL,
  "mascotaId" TEXT NOT NULL,
  CONSTRAINT "HistorialClinico_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ResumenMedico" (
  "id"          TEXT NOT NULL,
  "mascotaId"   TEXT NOT NULL,
  "resumen"     TEXT,
  "actualizado" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ResumenMedico_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Cita" (
  "id"                TEXT        NOT NULL,
  "motivo"            TEXT        NOT NULL,
  "fecha"             TIMESTAMP(3) NOT NULL,
  "estado"            "EstadoCita" NOT NULL DEFAULT 'Programada',
  "creadoEn"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "motivoCancelacion" TEXT,
  "centroId"          TEXT        NOT NULL,
  "consultorioId"     TEXT,
  "veterinarioId"     TEXT        NOT NULL,
  "duenoId"           TEXT        NOT NULL,
  "mascotaId"         TEXT        NOT NULL,
  "slotId"            TEXT,
  "hallazgos"         TEXT,
  "pruebas"           TEXT,
  "tratamiento"       TEXT,
  "historialId"       TEXT,
  CONSTRAINT "Cita_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Notificacion" (
  "id"            TEXT        NOT NULL,
  "cuentaId"      TEXT,
  "correoDestino" TEXT        NOT NULL,
  "tipo"          TEXT        NOT NULL,
  "payload"       JSONB       NOT NULL,
  "estado"        TEXT        NOT NULL DEFAULT 'pendiente',
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "enviadoAt"     TIMESTAMP(3),
  "citaId"        TEXT,
  CONSTRAINT "Notificacion_pkey" PRIMARY KEY ("id")
);

-- Indices ---------------------------------------------------------------------

CREATE UNIQUE INDEX "Cuenta_correo_key" ON "Cuenta"("correo");
CREATE UNIQUE INDEX "PasswordResetToken_token_key" ON "PasswordResetToken"("token");
CREATE UNIQUE INDEX "EmailConfirmationToken_token_key" ON "EmailConfirmationToken"("token");
CREATE UNIQUE INDEX "Dueno_cuentaId_key" ON "Dueno"("cuentaId");
CREATE UNIQUE INDEX "Dueno_dni_key" ON "Dueno"("dni");
CREATE UNIQUE INDEX "Veterinario_cuentaId_key" ON "Veterinario"("cuentaId");
CREATE UNIQUE INDEX "Veterinario_dni_key" ON "Veterinario"("dni");
CREATE UNIQUE INDEX "Mascota_duenoId_nombre_especie_edad_key" ON "Mascota"("duenoId", "nombre", "especie", "edad");
CREATE UNIQUE INDEX "HistorialClinico_mascotaId_key" ON "HistorialClinico"("mascotaId");
CREATE UNIQUE INDEX "ResumenMedico_mascotaId_key" ON "ResumenMedico"("mascotaId");
CREATE UNIQUE INDEX "Cita_slotId_key" ON "Cita"("slotId");

-- Relaciones / Foreign Keys ---------------------------------------------------

ALTER TABLE "PasswordResetToken"
  ADD CONSTRAINT "PasswordResetToken_cuentaId_fkey"
  FOREIGN KEY ("cuentaId") REFERENCES "Cuenta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EmailConfirmationToken"
  ADD CONSTRAINT "EmailConfirmationToken_cuentaId_fkey"
  FOREIGN KEY ("cuentaId") REFERENCES "Cuenta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DeleteRequest"
  ADD CONSTRAINT "DeleteRequest_cuentaId_fkey"
  FOREIGN KEY ("cuentaId") REFERENCES "Cuenta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Dueno"
  ADD CONSTRAINT "Dueno_cuentaId_fkey"
  FOREIGN KEY ("cuentaId") REFERENCES "Cuenta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Veterinario"
  ADD CONSTRAINT "Veterinario_cuentaId_fkey"
  FOREIGN KEY ("cuentaId") REFERENCES "Cuenta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Veterinario"
  ADD CONSTRAINT "Veterinario_centroId_fkey"
  FOREIGN KEY ("centroId") REFERENCES "CentroVeterinario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CentroVeterinario"
  ADD CONSTRAINT "CentroVeterinario_creadoPorVetId_fkey"
  FOREIGN KEY ("creadoPorVetId") REFERENCES "Veterinario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Consultorio"
  ADD CONSTRAINT "Consultorio_centroId_fkey"
  FOREIGN KEY ("centroId") REFERENCES "CentroVeterinario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Programacion"
  ADD CONSTRAINT "Programacion_veterinarioId_fkey"
  FOREIGN KEY ("veterinarioId") REFERENCES "Veterinario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "HorarioSlot"
  ADD CONSTRAINT "HorarioSlot_veterinarioId_fkey"
  FOREIGN KEY ("veterinarioId") REFERENCES "Veterinario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "HorarioSlot"
  ADD CONSTRAINT "HorarioSlot_centroId_fkey"
  FOREIGN KEY ("centroId") REFERENCES "CentroVeterinario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "HorarioSlot"
  ADD CONSTRAINT "HorarioSlot_consultorioId_fkey"
  FOREIGN KEY ("consultorioId") REFERENCES "Consultorio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "HorarioSlot"
  ADD CONSTRAINT "HorarioSlot_programacionId_fkey"
  FOREIGN KEY ("programacionId") REFERENCES "Programacion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Mascota"
  ADD CONSTRAINT "Mascota_duenoId_fkey"
  FOREIGN KEY ("duenoId") REFERENCES "Dueno"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "HistorialClinico"
  ADD CONSTRAINT "HistorialClinico_mascotaId_fkey"
  FOREIGN KEY ("mascotaId") REFERENCES "Mascota"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ResumenMedico"
  ADD CONSTRAINT "ResumenMedico_mascotaId_fkey"
  FOREIGN KEY ("mascotaId") REFERENCES "Mascota"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Cita"
  ADD CONSTRAINT "Cita_centroId_fkey"
  FOREIGN KEY ("centroId") REFERENCES "CentroVeterinario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Cita"
  ADD CONSTRAINT "Cita_consultorioId_fkey"
  FOREIGN KEY ("consultorioId") REFERENCES "Consultorio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Cita"
  ADD CONSTRAINT "Cita_veterinarioId_fkey"
  FOREIGN KEY ("veterinarioId") REFERENCES "Veterinario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Cita"
  ADD CONSTRAINT "Cita_duenoId_fkey"
  FOREIGN KEY ("duenoId") REFERENCES "Dueno"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Cita"
  ADD CONSTRAINT "Cita_mascotaId_fkey"
  FOREIGN KEY ("mascotaId") REFERENCES "Mascota"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Cita"
  ADD CONSTRAINT "Cita_slotId_fkey"
  FOREIGN KEY ("slotId") REFERENCES "HorarioSlot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Cita"
  ADD CONSTRAINT "Cita_historialId_fkey"
  FOREIGN KEY ("historialId") REFERENCES "HistorialClinico"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Notificacion"
  ADD CONSTRAINT "Notificacion_cuentaId_fkey"
  FOREIGN KEY ("cuentaId") REFERENCES "Cuenta"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Notificacion"
  ADD CONSTRAINT "Notificacion_citaId_fkey"
  FOREIGN KEY ("citaId") REFERENCES "Cita"("id") ON DELETE SET NULL ON UPDATE CASCADE;
