import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getPool } from "@/lib/db";
import { z } from "zod";

export const ROLES_CONTABLES = ["CLIENTES", "IVA_POR_PAGAR", "RETENCION_IVA", "VENTAS_SERVICIOS", "VENTAS_BIENES"] as const;
export type RolContable = typeof ROLES_CONTABLES[number];
export class ConfiguracionContableInvalida extends Error { readonly status = 409; }
const entrada = z.object({ empresaId: z.number().int().positive(), entidadId: z.number().int().positive(), rol: z.enum(ROLES_CONTABLES) });
export type CuentaResuelta = { id: number; empresaId: number; entidadId: number; codigo: string; nombre: string; tipo: string; rol: RolContable };

/** Sin fallback. Con conexión recibida usa current read dentro de la transacción del llamador. */
export async function resolverCuentaPorRol(input: z.infer<typeof entrada>, conn?: PoolConnection): Promise<CuentaResuelta> {
  const d = entrada.parse(input);
  const sql = `SELECT c.id, c.empresa_id, c.entidad_id, c.codigo, c.nombre, c.tipo, c.activa,
      r.activa AS rol_activo, e.activa AS entidad_activa
    FROM cont_cuentas_rol r
    INNER JOIN cont_cuentas c ON c.empresa_id = r.empresa_id AND c.entidad_id = r.entidad_id AND c.id = r.cuenta_id
    INNER JOIN cont_entidades e ON e.empresa_id = r.empresa_id AND e.id = r.entidad_id
    WHERE r.empresa_id = ? AND r.entidad_id = ? AND r.rol = ?${conn ? " FOR UPDATE" : ""}`;
  const [rows] = await (conn ?? getPool()).query<RowDataPacket[]>(sql, [d.empresaId, d.entidadId, d.rol]);
  const c = rows[0];
  if (rows.length !== 1 || !c || Number(c.empresa_id) !== d.empresaId || Number(c.entidad_id) !== d.entidadId
    || Number(c.activa) !== 1 || Number(c.rol_activo) !== 1 || Number(c.entidad_activa) !== 1) {
    throw new ConfiguracionContableInvalida(`Configuración activa no disponible para ${d.rol} en esta empresa/entidad.`);
  }
  return { id: Number(c.id), empresaId: d.empresaId, entidadId: d.entidadId, codigo: String(c.codigo), nombre: String(c.nombre), tipo: String(c.tipo), rol: d.rol };
}
