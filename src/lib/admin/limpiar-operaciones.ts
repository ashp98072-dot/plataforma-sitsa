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

export async function leer(conn: PoolConnection, tabla: string, where: string, empresaId: number, adicionales: Array<number | number[]> = []): Promise<Grupo> {
  const [meta] = await conn.query<RowDataPacket[]>(
    "SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?", [tabla]);
  // Fallar cerrado si falta una migración: nunca limpiar parcialmente un esquema desconocido.
  if (meta[0]?.ENGINE !== "InnoDB") throw new LimpiezaBloqueada(`La tabla ${tabla} no está disponible con soporte transaccional.`);
  const [filas] = await conn.query<RowDataPacket[]>(`SELECT * FROM ${identificador(tabla)} WHERE ${where} ORDER BY id FOR UPDATE`, [empresaId, ...adicionales]);
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
      `SELECT CONSTRAINT_NAME AS restriccion, TABLE_SCHEMA AS esquema, TABLE_SCHEMA = DATABASE() AS local, TABLE_NAME AS tabla, COLUMN_NAME AS columna, REFERENCED_COLUMN_NAME AS destino
       FROM information_schema.KEY_COLUMN_USAGE
       WHERE REFERENCED_TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME = ?`, [padre.tabla]);
    // Algunas relaciones históricas no tienen FK: también comprobar los IDs conocidos.
    const columna = padre.tabla === "tms_planes_viaje" ? "plan_id" : padre.tabla === "flota_viajes" ? "viaje_id" : padre.tabla === "tms_plan_paradas" ? "parada_id" : null;
    if (columna) {
      const [sinFk] = await conn.query<RowDataPacket[]>(
        "SELECT TABLE_NAME AS tabla, COLUMN_NAME AS columna, 'id' AS destino FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = ?", [columna]);
      refs.push(...sinFk);
    }
    const relaciones = new Map<string, RowDataPacket[]>();
    for (const ref of refs) {
      if (ref.local != null && !Number(ref.local)) throw new LimpiezaBloqueada("Hay referencias desde otra base de datos. No se limpió ningún dato.");
      const key = `${ref.tabla}:${ref.restriccion ?? ref.columna}`;
      relaciones.set(key, [...(relaciones.get(key) ?? []), ref]);
    }
    for (const columnas of relaciones.values()) {
      const ref = columnas[0];
      const hijo = grupos.find((g) => g.tabla === ref.tabla);
      const excluidos = hijo?.filas.map((f) => f.id) ?? [];
      // Una FK compuesta relaciona la tupla completa, no cada columna por separado.
      // Comparar solo empresa_id bloqueaba descuentos no relacionados de la misma empresa.
      for (let i = 0; i < padre.filas.length; i += 250) {
        const lote = padre.filas.slice(i, i + 250);
        const condiciones = lote.map(() => `(${columnas.map((c) => `${identificador(String(c.columna))} = ?`).join(" AND ")})`).join(" OR ");
        const valores = lote.flatMap((fila) => columnas.map((c) => fila[String(c.destino)]));
        const [externas] = await conn.query<RowDataPacket[]>(
          `SELECT ${identificador(String(ref.columna))} FROM ${identificador(String(ref.tabla))}
           WHERE (${condiciones}) ${excluidos.length ? "AND id NOT IN (?)" : ""} LIMIT 1 FOR UPDATE`,
          excluidos.length ? [...valores, excluidos] : valores);
        if (externas.length) throw new LimpiezaBloqueada(`Hay registros vinculados en ${ref.tabla}. No se limpió ningún dato.`);
      }
    }
  }
}

/**
 * ADMIN-LIMPIAR-ARCHIVOS-FISICOS — columnas conocidas que guardan una ruta
 * relativa de archivo físico (ver
 * docs/LIMPIEZA-TMS-OPERACIONES-REINICIO-2-STORAGE-DISCOVERY.md §1):
 * `flota_viaje_evidencias.ruta_relativa`, `tms_evidencias.ruta_archivo`,
 * `firmas_electronicas.imagen_ruta`. Recolectar en un Set porque una misma
 * evidencia de viaje puede estar referenciada por dos filas/tablas a la
 * vez (tms_evidencias copia la ruta de flota_viaje_evidencias al
 * sincronizar el viaje con un plan) — nunca debe contarse ni borrarse dos
 * veces.
 */
const COLUMNAS_RUTA_ARCHIVO = ["ruta_relativa", "ruta_archivo", "imagen_ruta"] as const;

/** Debe llamarse con los grupos YA leídos (leer() hace SELECT * antes de borrar nada) — nunca borra archivos, solo recolecta las rutas en memoria. */
export function recolectarRutasArchivo(grupos: Grupo[]): Set<string> {
  const rutas = new Set<string>();
  for (const grupo of grupos) {
    for (const fila of grupo.filas) {
      for (const columna of COLUMNAS_RUTA_ARCHIVO) {
        const valor = fila[columna];
        if (typeof valor === "string" && valor.trim()) rutas.add(valor.trim());
      }
    }
  }
  return rutas;
}

/**
 * ADMIN-LIMPIAR-ARCHIVOS-FISICOS — firmas electrónicas internas
 * (`firmas_electronicas`) de los viáticos indicados. Vínculo POLIMÓRFICO
 * sin FK real (`entidad_tipo = 'VIATICO'` + `entidad_id = tms_viaticos.id`,
 * ver docs/LIMPIEZA-TMS-OPERACIONES-REINICIO-2-STORAGE-DISCOVERY.md §2) —
 * invisible para validarReferencias(), así que debe recolectarse y
 * borrarse EXPLÍCITAMENTE aquí, antes de borrar los propios viáticos.
 * `firmas_electronicas` sí tiene columna `empresa_id` propia (con FK real
 * a `empresas`): leer() la valida igual que a cualquier otra tabla, como
 * capa adicional de aislamiento sobre el filtro explícito por
 * `entidadId IN (viaticoIds)` — nunca se confía en un solo campo.
 * `viaticoIds` debe venir ya acotado a los viáticos de esta empresa
 * (los que el caller acaba de leer con `empresa_id = ?`); un array vacío
 * evita un `IN ()` inválido en SQL y simplemente no borra nada.
 */
export async function leerFirmasElectronicasViaticos(
  conn: PoolConnection,
  empresaId: number,
  viaticoIds: number[],
): Promise<Grupo> {
  if (!viaticoIds.length) return { tabla: "firmas_electronicas", filas: [] };
  return leer(
    conn,
    "firmas_electronicas",
    "empresa_id = ? AND entidad_tipo = 'VIATICO' AND entidad_id IN (?)",
    empresaId,
    [viaticoIds],
  );
}

export async function borrarGrupos(conn: PoolConnection, grupos: Grupo[]) {
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

export type ResultadoLimpiezaConArchivos = {
  conteos: Record<string, number>;
  /** Rutas relativas (empresas/<empresaId>/...) recolectadas ANTES de borrar — ningún archivo físico se toca aquí. */
  archivos: Set<string>;
};

export async function limpiarViajesConjuntos(conn: PoolConnection, empresaId: number, pruebas = false): Promise<ResultadoLimpiezaConArchivos> {
  const planes = await leer(conn, "tms_planes_viaje", "empresa_id = ?", empresaId);
  if (!pruebas && planes.filas.some((p) => !["Programado", "Cancelado", "Cerrado"].includes(String(p.estado)))) {
    throw new LimpiezaBloqueada("Hay viajes en proceso. Finalízalos antes de limpiar Programación/TMS.");
  }
  const planWhere = "plan_id IN (SELECT id FROM tms_planes_viaje WHERE empresa_id = ?)";
  const viajes = await leer(conn, "flota_viajes", planWhere, empresaId);
  if (!pruebas && viajes.filas.some((v) => v.estado !== "cerrado")) throw new LimpiezaBloqueada("Hay viajes de flota abiertos. No se limpió ningún dato.");
  const paradas = await leer(conn, "tms_plan_paradas", planWhere, empresaId);
  const viaticos = await leer(conn, "tms_viaticos", planWhere, empresaId);
  if (!pruebas) validarViaticos(viaticos.filas);
  const evidencias = await leer(conn, "tms_evidencias", planWhere, empresaId);
  const fotos = await leer(conn, "flota_viaje_evidencias", "viaje_id IN (SELECT v.id FROM flota_viajes v INNER JOIN tms_planes_viaje p ON p.id = v.plan_id WHERE p.empresa_id = ?)", empresaId);
  const lecturas = await leer(conn, "flota_lecturas", "viaje_id IN (SELECT v.id FROM flota_viajes v INNER JOIN tms_planes_viaje p ON p.id = v.plan_id WHERE p.empresa_id = ?)", empresaId);
  const auxiliares = await leer(conn, "tms_plan_auxiliares", planWhere, empresaId);
  // ADMIN-LIMPIAR-ARCHIVOS-FISICOS: firmas de ESTOS viáticos (autorización/
  // liquidación) — antes de borrar tms_viaticos, nunca después.
  const viaticoIds = viaticos.filas.map((f) => Number(f.id));
  const firmas = await leerFirmasElectronicasViaticos(conn, empresaId, viaticoIds);
  const archivos = recolectarRutasArchivo([fotos, evidencias, firmas]);
  const conteos = await borrarGrupos(conn, [fotos, evidencias, lecturas, firmas, viaticos, auxiliares, paradas, viajes, planes]);
  return { conteos, archivos };
}

export async function limpiarViaticos(conn: PoolConnection, empresaId: number, pruebas = false): Promise<ResultadoLimpiezaConArchivos> {
  const grupo = await leer(conn, "tms_viaticos", "empresa_id = ?", empresaId);
  if (!pruebas) validarViaticos(grupo.filas);
  const viaticoIds = grupo.filas.map((f) => Number(f.id));
  const firmas = await leerFirmasElectronicasViaticos(conn, empresaId, viaticoIds);
  const archivos = recolectarRutasArchivo([firmas]);
  const conteos = await borrarGrupos(conn, [firmas, grupo]);
  return { conteos, archivos };
}

export async function limpiarCuestionarios(conn: PoolConnection, empresaId: number) {
  return borrarGrupos(conn, [await leer(conn, "fact_cliente_perfil", "empresa_id = ?", empresaId)]);
}

/**
 * LIMPIEZA-TMS-OPERACIONES-REINICIO-1 — facturación transaccional
 * (fact_pagos -> fact_factura_viajes -> fact_facturas), en ese orden por
 * sus propias FK: fact_pagos.factura_id y fact_factura_viajes.factura_id
 * son ON DELETE CASCADE hacia fact_facturas, pero fact_factura_viajes.plan_id
 * es ON DELETE RESTRICT hacia tms_planes_viaje y fact_facturas.cliente_id es
 * ON DELETE RESTRICT hacia clientes — por eso este módulo debe correr ANTES
 * de limpiarViajesConjuntos()/limpiarClientesPrueba() en cualquier flujo que
 * los combine (ver reiniciarOperacionesCompleto() en limpiar-modulo.ts).
 * fact_pagos SÍ tiene empresa_id propio; fact_factura_viajes no, se
 * resuelve por subconsulta contra fact_facturas de esta empresa (mismo
 * patrón ya usado por planWhere en limpiarViajesConjuntos).
 */
export async function limpiarFacturacion(conn: PoolConnection, empresaId: number) {
  const pagos = await leer(conn, "fact_pagos", "empresa_id = ?", empresaId);
  const facturaViajes = await leer(
    conn,
    "fact_factura_viajes",
    "factura_id IN (SELECT id FROM fact_facturas WHERE empresa_id = ?)",
    empresaId,
  );
  const facturas = await leer(conn, "fact_facturas", "empresa_id = ?", empresaId);
  return borrarGrupos(conn, [pagos, facturaViajes, facturas]);
}

/**
 * LIMPIEZA-TMS-OPERACIONES-REINICIO-1 — solicitudes del Portal del
 * Cliente (tms_solicitud_paradas -> tms_solicitudes_cliente). Debe
 * correr ANTES de limpiarViajesConjuntos() (tms_solicitudes_cliente.plan_id
 * es RESTRICT hacia tms_planes_viaje) y ANTES de que se borre
 * tms_cliente_usuarios (tms_solicitudes_cliente.creado_por_usuario_cliente_id
 * es RESTRICT hacia esa tabla).
 */
export async function limpiarSolicitudesCliente(conn: PoolConnection, empresaId: number) {
  const paradas = await leer(conn, "tms_solicitud_paradas", "empresa_id = ?", empresaId);
  const solicitudes = await leer(conn, "tms_solicitudes_cliente", "empresa_id = ?", empresaId);
  return borrarGrupos(conn, [paradas, solicitudes]);
}

/**
 * LIMPIEZA-TMS-OPERACIONES-REINICIO-1 — catálogos PROPIOS de TMS
 * (tms_personal, tms_unidades, tms_lugares). Confirmado en
 * docs/LIMPIEZA-TMS-OPERACIONES-REINICIO-1-PROPUESTA-FINAL.md §6: sus
 * únicos vínculos hacia RRHH/Flota (tms_personal.id_empleado->empleados,
 * tms_unidades.flota_vehiculo_id->flota_vehiculos) son ON DELETE SET NULL
 * en sentido RRHH/Flota->TMS — borrar estas filas NUNCA toca empleados
 * ni flota_vehiculos (esa FK solo se dispara al borrar el LADO RRHH/
 * Flota, algo que este módulo no hace). Debe correr DESPUÉS de
 * limpiarViajesConjuntos() (que ya vació tms_planes_viaje, único lugar
 * que referencia piloto_id/auxiliar_id/unidad_id/lugar_carga_id/
 * lugar_descarga_id) para que validarReferencias() no encuentre nada
 * pendiente.
 */
export async function limpiarCatalogosTms(conn: PoolConnection, empresaId: number) {
  const personal = await leer(conn, "tms_personal", "empresa_id = ?", empresaId);
  const unidades = await leer(conn, "tms_unidades", "empresa_id = ?", empresaId);
  const lugares = await leer(conn, "tms_lugares", "empresa_id = ?", empresaId);
  return borrarGrupos(conn, [personal, unidades, lugares]);
}

/** Solo catálogo maestro. Los viajes conservan sus copias históricas y paradas. */
export async function eliminarRutas(conn: PoolConnection, empresaId: number) {
  const rutas = await leer(conn, "tms_cliente_rutas", "empresa_id = ?", empresaId);
  const paradas = await leer(conn, "tms_cliente_ruta_paradas",
    "empresa_id = ? OR ruta_id IN (SELECT id FROM tms_cliente_rutas WHERE empresa_id = ?)", empresaId, [empresaId]);
  const ids = new Set(rutas.filas.map((r) => Number(r.id)));
  if (paradas.filas.some((p) => !ids.has(Number(p.ruta_id)))) {
    throw new LimpiezaBloqueada("Hay paradas maestras sin ruta de esta empresa. Requiere revisión; no se limpió ningún dato.");
  }
  // Valida FKs reales antes de borrar; no depende de CASCADE ni lo deshabilita.
  // tms_planes_viaje.ruta_id es informativo sin FK por diseño del esquema:
  // el viaje conserva ruta_codigo_historico y demás datos copiados.
  return borrarGrupos(conn, [paradas, rutas]);
}

export async function desactivarCatalogo(conn: PoolConnection, empresaId: number, modulo: string) {
  const tablas = modulo === "clientes" ? ["clientes", "tms_clientes"]
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
