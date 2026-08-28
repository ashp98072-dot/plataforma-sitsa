import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { transicion, type Multa } from "@/lib/multas/reglas";
import { registrarAuditoriaTx } from "@/lib/auditoria";

export class LimpiezaBloqueada extends Error {}

const identificador = (name: string) => {
  if (!/^[a-zA-Z0-9_]+$/.test(name)) throw new LimpiezaBloqueada("Referencia de esquema no reconocida.");
  return `\`${name}\``;
};
type Grupo = { tabla: string; filas: RowDataPacket[] };

export function validarViaticos(filas: Record<string, unknown>[]) {
  for (const fila of filas) {
    if (fila.estado !== "PROGRAMADO" || ["autorizado_en", "autorizado_por", "entregado_en", "entregado_por", "liquidado_en", "liquidado_por", "metodo_pago", "referencia_pago"].some((k) => fila[k] != null && fila[k] !== "")) {
      throw new LimpiezaBloqueada("Existen viáticos autorizados, pagados o con movimientos. No se limpió ningún dato.");
    }
  }
}

async function leer(conn: PoolConnection, tabla: string, where: string, empresaId: number): Promise<Grupo> {
  const [meta] = await conn.query<RowDataPacket[]>(
    "SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?", [tabla]);
  // Fallar cerrado si falta una migración: nunca limpiar parcialmente un esquema desconocido.
  if (meta[0]?.ENGINE !== "InnoDB") throw new LimpiezaBloqueada(`La tabla ${tabla} no está disponible con soporte transaccional.`);
  const [filas] = await conn.query<RowDataPacket[]>(`SELECT * FROM ${identificador(tabla)} WHERE ${where} ORDER BY id FOR UPDATE`, [empresaId]);
  for (const f of filas) {
    if (f.empresa_id != null && Number(f.empresa_id) !== empresaId) {
      throw new LimpiezaBloqueada("Se encontró un vínculo entre empresas. Requiere revisión; no se limpió ningún dato.");
    }
  }
  return { tabla, filas };
}

/** Bloquea referencias externas incluso si su FK usa CASCADE o SET NULL. */
async function validarReferencias(conn: PoolConnection, grupos: Grupo[]) {
  for (const padre of grupos) {
    if (!padre.filas.length) continue;
    const [refs] = await conn.query<RowDataPacket[]>(
      `SELECT TABLE_SCHEMA AS esquema, TABLE_SCHEMA = DATABASE() AS local, TABLE_NAME AS tabla, COLUMN_NAME AS columna, REFERENCED_COLUMN_NAME AS destino
       FROM information_schema.KEY_COLUMN_USAGE
       WHERE REFERENCED_TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME = ?`, [padre.tabla]);
    // Algunas relaciones históricas no tienen FK: también comprobar los IDs conocidos.
    const columna = padre.tabla === "tms_planes_viaje" ? "plan_id" : padre.tabla === "flota_viajes" ? "viaje_id" : padre.tabla === "tms_plan_paradas" ? "parada_id" : null;
    if (columna) {
      const [sinFk] = await conn.query<RowDataPacket[]>(
        "SELECT TABLE_NAME AS tabla, COLUMN_NAME AS columna, 'id' AS destino FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = ?", [columna]);
      refs.push(...sinFk);
    }
    for (const ref of refs) {
      if (ref.local != null && !Number(ref.local)) throw new LimpiezaBloqueada("Hay referencias desde otra base de datos. No se limpió ningún dato.");
      const hijo = grupos.find((g) => g.tabla === ref.tabla);
      const ids = padre.filas.map((f) => f[String(ref.destino)]);
      const excluidos = hijo?.filas.map((f) => f.id) ?? [];
      const [externas] = await conn.query<RowDataPacket[]>(
        `SELECT ${identificador(String(ref.columna))} FROM ${identificador(String(ref.tabla))}
         WHERE ${identificador(String(ref.columna))} IN (?) ${excluidos.length ? "AND id NOT IN (?)" : ""} LIMIT 1 FOR UPDATE`,
        excluidos.length ? [ids, excluidos] : [ids]);
      if (externas.length) throw new LimpiezaBloqueada(`Hay registros vinculados en ${ref.tabla}. No se limpió ningún dato.`);
    }
  }
}

async function borrarGrupos(conn: PoolConnection, grupos: Grupo[]) {
  await validarReferencias(conn, grupos);
  const out: Record<string, number> = {};
  // El caller ordena hijos antes de padres. No se desactivan FKs.
  for (const g of grupos) {
    out[g.tabla] = 0;
    for (let i = 0; i < g.filas.length; i += 250) {
      const ids = g.filas.slice(i, i + 250).map((f) => f.id);
      const [r] = await conn.query<ResultSetHeader>(`DELETE FROM ${identificador(g.tabla)} WHERE id IN (?)`, [ids]);
      out[g.tabla] += r.affectedRows;
    }
  }
  return out;
}

export async function limpiarViajesConjuntos(conn: PoolConnection, empresaId: number) {
  const planes = await leer(conn, "tms_planes_viaje", "empresa_id = ?", empresaId);
  if (planes.filas.some((p) => !["Programado", "Cancelado", "Cerrado"].includes(String(p.estado)))) {
    throw new LimpiezaBloqueada("Hay viajes en proceso. Finalízalos antes de limpiar Programación/TMS.");
  }
  const planWhere = "plan_id IN (SELECT id FROM tms_planes_viaje WHERE empresa_id = ?)";
  const viajes = await leer(conn, "flota_viajes", planWhere, empresaId);
  if (viajes.filas.some((v) => v.estado !== "cerrado")) throw new LimpiezaBloqueada("Hay viajes de flota abiertos. No se limpió ningún dato.");
  const paradas = await leer(conn, "tms_plan_paradas", planWhere, empresaId);
  const viaticos = await leer(conn, "tms_viaticos", planWhere, empresaId);
  validarViaticos(viaticos.filas);
  const evidencias = await leer(conn, "tms_evidencias", planWhere, empresaId);
  const fotos = await leer(conn, "flota_viaje_evidencias", "viaje_id IN (SELECT v.id FROM flota_viajes v INNER JOIN tms_planes_viaje p ON p.id = v.plan_id WHERE p.empresa_id = ?)", empresaId);
  const lecturas = await leer(conn, "flota_lecturas", "viaje_id IN (SELECT v.id FROM flota_viajes v INNER JOIN tms_planes_viaje p ON p.id = v.plan_id WHERE p.empresa_id = ?)", empresaId);
  const auxiliares = await leer(conn, "tms_plan_auxiliares", planWhere, empresaId);
  return borrarGrupos(conn, [fotos, evidencias, lecturas, viaticos, auxiliares, paradas, viajes, planes]);
}

export async function limpiarViaticos(conn: PoolConnection, empresaId: number) {
  const grupo = await leer(conn, "tms_viaticos", "empresa_id = ?", empresaId);
  validarViaticos(grupo.filas);
  return borrarGrupos(conn, [grupo]);
}

export async function limpiarCuestionarios(conn: PoolConnection, empresaId: number) {
  return borrarGrupos(conn, [await leer(conn, "fact_cliente_perfil", "empresa_id = ?", empresaId)]);
}

export async function desactivarCatalogo(conn: PoolConnection, empresaId: number, modulo: string) {
  const tablas = modulo === "clientes" ? ["clientes", "tms_clientes"]
    : modulo === "operaciones_rutas" ? ["tms_cliente_rutas", "tms_cliente_ruta_paradas"]
    : modulo === "operaciones_accesos" ? ["proveedor_portales"] : [];
  if (!tablas.length) throw new LimpiezaBloqueada("Catálogo no soportado.");
  const out: Record<string, number> = {};
  for (const tabla of tablas) {
    await leer(conn, tabla, "empresa_id = ?", empresaId);
    const campo = modulo === "clientes" ? "estado" : "activo";
    const valor = modulo === "clientes" ? "Inactivo" : 0;
    const [r] = await conn.execute<ResultSetHeader>(`UPDATE ${identificador(tabla)} SET ${campo} = ? WHERE empresa_id = ? AND ${campo} <> ?`, [valor, empresaId, valor]);
    out[tabla] = r.affectedRows;
  }
  return out;
}

export async function anularMultas(conn: PoolConnection, empresaId: number, usuarioId: number, usuario: string) {
  const grupo = await leer(conn, "ops_multas", "empresa_id = ?", empresaId);
  const activas = grupo.filas.filter((f) => f.estado !== "ANULADA");
  const motivo = "Anulación administrativa desde Limpiar módulo";
  // Validar todas antes de escribir; se reutiliza la política del módulo.
  for (const fila of activas) {
    try { transicion(fila as Multa, { accion: "anular", motivo_anulacion: motivo }, usuarioId); }
    catch { throw new LimpiezaBloqueada(`La multa #${fila.id} no admite anulación (movimientos, cierre o datos incompletos). No se modificó ninguna.`); }
  }
  for (const fila of activas) {
    await conn.execute("UPDATE ops_multas SET estado = 'ANULADA', motivo_anulacion = ?, anulada_en = NOW(), anulada_por_usuario_id = ?, actualizado_por_usuario_id = ?, actualizado_en = NOW() WHERE id = ? AND empresa_id = ?", [motivo, usuarioId, usuarioId, fila.id, empresaId]);
    await registrarAuditoriaTx(conn, { empresaId, usuario, modulo: "multas", accion: "multa_anulada", detalle: `Multa #${fila.id}: ${fila.estado} → ANULADA. ${motivo}.` });
  }
  return { multas_anuladas: activas.length };
}
