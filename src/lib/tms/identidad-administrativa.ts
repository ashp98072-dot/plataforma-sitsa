import type { RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import type { SqlParams } from "@/lib/db";

/**
 * GASTOS-ADMINISTRATIVO-1 — helpers de identidad/seguridad REALMENTE
 * genéricos, extraídos de src/lib/tms/fondos.ts para que Gastos operativos
 * (y cualquier otro módulo administrativo futuro) los reutilicen tal
 * cual, sin duplicar la lógica de seguridad. Refactor
 * comportamiento-preservante: Fondos sigue llamando estas MISMAS
 * funciones, con el mismo SQL y el mismo comportamiento exacto de antes
 * (ver fondos.test.ts — verifica que nada cambió) — el único cambio es su
 * ubicación.
 *
 * Deliberadamente NO se movieron aquí (quedan en fondos.ts porque
 * dependen demasiado de su modelo de líneas/firmas, y forzarlas a ser
 * genéricas sin un segundo consumidor real sería generalizar por
 * generalizar):
 *  - `limpiarOverride` / `resolverSnapshotLineaTx`: atados al concepto de
 *    "línea de una solicitud de fondo" con overrides de snapshot
 *    (empleado/vehículo/cliente/plan) — Gastos no tiene líneas (cada
 *    gasto es su propio registro, opción B de GASTOS-ADMINISTRATIVO-1).
 *  - `guardarImagenFirmaFondo`: su convención de nombre de archivo
 *    (`firma_fondo_${accionPrefix}_${solicitudId}`) es específica de
 *    Fondos; se revisará/generalizará recién en la fase de firmas de
 *    Gastos (todavía no tocada en esta Fase 1).
 */

async function queryConn<T extends RowDataPacket[]>(conn: PoolConnection, sql: string, params: SqlParams = []): Promise<T> {
  const [rows] = await conn.query<T>(sql, params);
  return rows;
}

/**
 * AISLAMIENTO MULTIEMPRESA (corrección post-revisión PR #204) — valida
 * ANTES de escribir que un empleado (requirente/autorizante/etc.)
 * pertenezca a la MISMA empresa, aunque el id exista en otra. La FK
 * compuesta (empresa_id, xxx_empleado_id) en la base es la garantía real
 * e incondicional — esta validación es la primera línea de defensa, no
 * la única, y da un mensaje claro.
 */
export async function validarEmpleadoDeEmpresaTx(
  conn: PoolConnection,
  empresaId: number,
  empleadoId: number | null | undefined,
  etiqueta: string,
): Promise<void> {
  if (empleadoId == null) return;
  const rows = await queryConn<RowDataPacket[]>(conn, "SELECT id FROM empleados WHERE id = ? AND empresa_id = ? LIMIT 1", [empleadoId, empresaId]);
  if (!rows[0]) throw new Error(`El ${etiqueta} indicado no pertenece a esta empresa.`);
}

/**
 * SOLICITUD-FONDOS-ENTIDAD-REQUIRIENTE-1 / GASTOS-ADMINISTRATIVO-1 —
 * catálogo de "empresa requirente" COMPARTIDO entre Fondos y Gastos:
 * entidades contables reales (cont_entidades), acotadas a los códigos
 * KT (Kuiqtrans) y MONACO (Logiservicios Mónaco) — nunca tenants nuevos,
 * nunca un catálogo duplicado.
 */
export const CODIGOS_ENTIDAD_REQUIRIENTE = ["KT", "MONACO"] as const;

export async function resolverEntidadRequirenteTx(
  conn: PoolConnection,
  empresaId: number,
  entidadId: number,
): Promise<{ id: number; nombre: string }> {
  const rows = await queryConn<RowDataPacket[]>(conn,
    `SELECT id, nombre
     FROM cont_entidades
     WHERE id = ? AND empresa_id = ? AND activa = 1 AND codigo IN (?, ?)
     LIMIT 1`,
    [entidadId, empresaId, ...CODIGOS_ENTIDAD_REQUIRIENTE],
  );
  if (!rows[0]) throw new Error("La empresa requirente no es válida, no está activa o no pertenece a esta empresa.");
  return { id: Number(rows[0].id), nombre: String(rows[0].nombre) };
}

/**
 * `usuarios` es GLOBAL (sin empresa_id, ver usuario_firmas/MI-FIRMA-1),
 * así que "pertenece a esta empresa" para un usuario significa: tiene
 * acceso a ella (usuario_empresa) o tiene acceso a todas
 * (acceso_todas_empresas) — mismo criterio que empresasParaUsuario() en
 * src/lib/empresas.ts, en sentido inverso. Devuelve {nombre, rol} para
 * snapshot (nunca username) — null si el id no existe o no tiene acceso a
 * esta empresa, nunca lanza, para dejar que el caller decida el mensaje.
 */
export async function resolverUsuarioDeEmpresaTx(
  conn: PoolConnection,
  empresaId: number,
  usuarioId: number | null | undefined,
): Promise<{ nombre: string; rol: string | null } | null> {
  if (usuarioId == null) return null;
  const rows = await queryConn<RowDataPacket[]>(conn,
    `SELECT u.nombre, u.rol_global
     FROM usuarios u
     LEFT JOIN usuario_empresa ue ON ue.usuario_id = u.id AND ue.empresa_id = ?
     WHERE u.id = ? AND u.activo = 1 AND (ue.usuario_id IS NOT NULL OR u.acceso_todas_empresas = 1)
     LIMIT 1`,
    [empresaId, usuarioId],
  );
  const row = rows[0];
  if (!row || !row.nombre) return null;
  return { nombre: String(row.nombre), rol: row.rol_global != null ? String(row.rol_global) : null };
}

/** Roles habilitados para actuar como "solicitante" (Operaciones) — compartido entre Fondos y Gastos. */
export const ROLES_SOLICITANTE_OPERACIONES = new Set(["Operaciones", "GerenteOperaciones", "JefeOperaciones", "AuxiliarOperaciones"]);

export async function resolverSolicitanteOperacionesTx(
  conn: PoolConnection,
  empresaId: number,
  usuarioId: number | null,
): Promise<{ nombre: string; rol: string | null } | null> {
  const usuario = await resolverUsuarioDeEmpresaTx(conn, empresaId, usuarioId);
  return usuario && usuario.rol && ROLES_SOLICITANTE_OPERACIONES.has(usuario.rol) ? usuario : null;
}
