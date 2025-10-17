# VetChain Backend (Express + Prisma)

API para VetChain basada en Express y Prisma (PostgreSQL).

## Configuración

1. Copia `.env.example` a `.env` y configura:

```
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DBNAME?schema=public"
JWT_SECRET="cambia-este-secreto"
```

2. Genera el cliente y aplica migraciones:

```
npm run generate
npm run migrate -- --name init
```

3. Levanta el servidor:

```
npm run dev
```

La API por defecto escucha en `http://localhost:4000`.

## Endpoints principales (Sprint 1)
- POST `/auth/register/owner` – registro de dueño (RN23–RN27)
- POST `/auth/register/vet` – registro de veterinario pendiente (RN28–RN33)
- POST `/auth/confirm-email` – confirma correo (simulado)
- POST `/auth/login` – login con validaciones de estado (RN01–RN06)
- POST `/auth/request-password-reset` y `/auth/reset-password` – flujo de contraseña (RN11–RN13)
- GET `/me` y PUT `/me` – perfil y actualización con reglas (RN7–RN10, RN61–RN64)
- POST `/account/delete-request` – solicitud de eliminación (RN14–RN18)
- GET `/centros` y POST `/centros` – gestión básica de centros (RN34–RN39 parcial)
- GET `/pets`, POST `/pets`, PUT `/pets/:id`, DELETE `/pets/:id` – mascotas (RN65–RN69, RN85–RN90)
- GET `/citas/owner`, GET `/citas/vet`, POST `/citas` – citas
- GET `/historial/:mascotaId` – historial con restricciones de acceso (RN53–RN58, RN79–RN80)

Notas:
- Envío de correos se simula retornando un token en la respuesta para pruebas locales.
- Vinculación vet-centro puede ampliarse con endpoints dedicados.
