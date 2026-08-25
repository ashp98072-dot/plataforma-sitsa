import type { RolGlobal } from "@/lib/roles";

export const ROLES_PORTALES_PROVEEDORES = [
  "Operaciones",
  "GerenteOperaciones",
  "JefeOperaciones",
  "AuxiliarOperaciones",
  "Facturador",
] as const satisfies readonly RolGlobal[];

export function puedeUsarPortalesProveedores(rol: RolGlobal): boolean {
  return (
    rol === "Admin" ||
    ROLES_PORTALES_PROVEEDORES.some((permitido) => permitido === rol)
  );
}
