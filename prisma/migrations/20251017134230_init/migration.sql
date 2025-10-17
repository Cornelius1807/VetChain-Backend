-- CreateEnum
CREATE TYPE "Rol" AS ENUM ('dueno', 'veterinario', 'admin');

-- CreateEnum
CREATE TYPE "EstadoCuenta" AS ENUM ('active', 'inactive', 'pending', 'rejected');

-- CreateEnum
CREATE TYPE "EstadoCita" AS ENUM ('Programada', 'Confirmada', 'Atendida', 'Cancelada');

-- CreateTable
CREATE TABLE "Cuenta" (
    "id" TEXT NOT NULL,
    "correo" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "rol" "Rol" NOT NULL,
    "estado" "EstadoCuenta" NOT NULL DEFAULT 'pending',
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmadoEn" TIMESTAMP(3),
    "eliminadoEn" TIMESTAMP(3),

    CONSTRAINT "Cuenta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "cuentaId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailConfirmationToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "cuentaId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "EmailConfirmationToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeleteRequest" (
    "id" TEXT NOT NULL,
    "cuentaId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),

    CONSTRAINT "DeleteRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dueno" (
    "id" TEXT NOT NULL,
    "cuentaId" TEXT NOT NULL,
    "dni" TEXT NOT NULL,
    "nombres" TEXT NOT NULL,
    "apellidos" TEXT NOT NULL,
    "telefono" TEXT NOT NULL,
    "direccion" TEXT,

    CONSTRAINT "Dueno_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Veterinario" (
    "id" TEXT NOT NULL,
    "cuentaId" TEXT NOT NULL,
    "dni" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "telefono" TEXT,
    "especialidad" TEXT NOT NULL,
    "tituloURL" TEXT,
    "constanciaURL" TEXT,
    "fotoURL" TEXT,
    "centroId" TEXT,
    "puedeCrearCentro" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Veterinario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CentroVeterinario" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "direccion" TEXT NOT NULL,
    "telefono" TEXT,
    "email" TEXT,
    "rangoAtencionInicio" TEXT,
    "rangoAtencionFin" TEXT,
    "rangoConsultaInicio" TEXT,
    "rangoConsultaFin" TEXT,

    CONSTRAINT "CentroVeterinario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Consultorio" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "centroId" TEXT NOT NULL,

    CONSTRAINT "Consultorio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mascota" (
    "id" TEXT NOT NULL,
    "duenoId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "especie" TEXT NOT NULL,
    "raza" TEXT NOT NULL,
    "genero" TEXT NOT NULL,
    "edad" INTEGER NOT NULL,
    "peso" DOUBLE PRECISION,
    "imagenURL" TEXT,
    "descripcion" TEXT,
    "activa" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Mascota_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HistorialClinico" (
    "id" TEXT NOT NULL,
    "mascotaId" TEXT NOT NULL,

    CONSTRAINT "HistorialClinico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cita" (
    "id" TEXT NOT NULL,
    "motivo" TEXT NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "estado" "EstadoCita" NOT NULL DEFAULT 'Programada',
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "horaTexto" TEXT NOT NULL,
    "centroId" TEXT NOT NULL,
    "consultorioId" TEXT,
    "veterinarioId" TEXT NOT NULL,
    "mascotaId" TEXT NOT NULL,
    "historialId" TEXT,
    "duenoId" TEXT NOT NULL,
    "hallazgos" TEXT,
    "prueba" TEXT,
    "tratamiento" TEXT,

    CONSTRAINT "Cita_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Cuenta_correo_key" ON "Cuenta"("correo");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_token_key" ON "PasswordResetToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "EmailConfirmationToken_token_key" ON "EmailConfirmationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "Dueno_cuentaId_key" ON "Dueno"("cuentaId");

-- CreateIndex
CREATE UNIQUE INDEX "Dueno_dni_key" ON "Dueno"("dni");

-- CreateIndex
CREATE UNIQUE INDEX "Veterinario_cuentaId_key" ON "Veterinario"("cuentaId");

-- CreateIndex
CREATE UNIQUE INDEX "Veterinario_dni_key" ON "Veterinario"("dni");

-- CreateIndex
CREATE UNIQUE INDEX "Mascota_duenoId_nombre_especie_edad_key" ON "Mascota"("duenoId", "nombre", "especie", "edad");

-- CreateIndex
CREATE UNIQUE INDEX "HistorialClinico_mascotaId_key" ON "HistorialClinico"("mascotaId");

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_cuentaId_fkey" FOREIGN KEY ("cuentaId") REFERENCES "Cuenta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailConfirmationToken" ADD CONSTRAINT "EmailConfirmationToken_cuentaId_fkey" FOREIGN KEY ("cuentaId") REFERENCES "Cuenta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeleteRequest" ADD CONSTRAINT "DeleteRequest_cuentaId_fkey" FOREIGN KEY ("cuentaId") REFERENCES "Cuenta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dueno" ADD CONSTRAINT "Dueno_cuentaId_fkey" FOREIGN KEY ("cuentaId") REFERENCES "Cuenta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Veterinario" ADD CONSTRAINT "Veterinario_cuentaId_fkey" FOREIGN KEY ("cuentaId") REFERENCES "Cuenta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Veterinario" ADD CONSTRAINT "Veterinario_centroId_fkey" FOREIGN KEY ("centroId") REFERENCES "CentroVeterinario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consultorio" ADD CONSTRAINT "Consultorio_centroId_fkey" FOREIGN KEY ("centroId") REFERENCES "CentroVeterinario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mascota" ADD CONSTRAINT "Mascota_duenoId_fkey" FOREIGN KEY ("duenoId") REFERENCES "Dueno"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistorialClinico" ADD CONSTRAINT "HistorialClinico_mascotaId_fkey" FOREIGN KEY ("mascotaId") REFERENCES "Mascota"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cita" ADD CONSTRAINT "Cita_centroId_fkey" FOREIGN KEY ("centroId") REFERENCES "CentroVeterinario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cita" ADD CONSTRAINT "Cita_consultorioId_fkey" FOREIGN KEY ("consultorioId") REFERENCES "Consultorio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cita" ADD CONSTRAINT "Cita_veterinarioId_fkey" FOREIGN KEY ("veterinarioId") REFERENCES "Veterinario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cita" ADD CONSTRAINT "Cita_mascotaId_fkey" FOREIGN KEY ("mascotaId") REFERENCES "Mascota"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cita" ADD CONSTRAINT "Cita_historialId_fkey" FOREIGN KEY ("historialId") REFERENCES "HistorialClinico"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cita" ADD CONSTRAINT "Cita_duenoId_fkey" FOREIGN KEY ("duenoId") REFERENCES "Dueno"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
