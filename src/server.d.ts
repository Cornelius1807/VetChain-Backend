import type { Rol } from "../generated/prisma/index.js";
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
export {};
//# sourceMappingURL=server.d.ts.map