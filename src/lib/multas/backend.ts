import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { z } from "zod";
import { getPool, query, type SqlParams, type SqlValue } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { anioSchema, ErrorMultas, idSchema, mesSchema, nuevaMulta, revisionSchema, transicion, validarMulta,
  CLASIFICACION_MULTA_RRHH, CONCEPTO_MULTA_RRHH, motivoDescuentoMulta, type Multa } from "./reglas";
// MULTAS-3.2: reutiliza el motor de RRHH tal cual — nunca lo duplica. Las
// variantes *Interno participan en NUESTRA transacción (mismo patrón ya
// usado por INV-1 en src/lib/rrhh/inventario.ts).
import {
  crearDescuentoInterno,
  autorizarDescuentoInterno,
  cancelarDescuentoInterno,
  obtenerDescuento,
  type Periodicidad,
  type TipoQuincenaInicio,
} from "@/lib/rrhh/descuentos";

export type ActorMultas = { empresaId: number; usuarioId: number; usuario: string };
async function tx<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await getPool().getConnection();
  let descartada = false;
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (error) {
    try { await conn.rollback(); } catch (rollbackError) {
      descartada = true; conn.destroy(); console.error("Rollback Multas", rollbackError);
    }
    throw error;
  } finally { if (!descartada) conn.release(); }
}
async function auditar(conn: PoolConnection, actor: ActorMultas, accion: string, detalle: object) {
  await registrarAuditoriaTx(conn, { empresaId: actor.empresaId, usuario: actor.usuario,
    modulo: "multas", accion, detalle: JSON.stringify({ usuario_id: actor.usuarioId, ...detalle }) });
}
async function vehiculoPropio(conn: PoolConnection, empresa: number, id: number) {
  const [rows] = await conn.query<RowDataPacket[]>(
    "SELECT id, placa FROM flota_vehiculos WHERE empresa_id = ? AND id = ? FOR UPDATE", [empresa, id]);
  if (!rows[0]) throw new ErrorMultas("Vehículo no encontrado en la empresa propietaria.", 404);
  return rows[0];
}
async function responsablePropio(conn: PoolConnection, empresa: number, id: number | null) {
  if (id == null) return;
  const [rows] = await conn.query<RowDataPacket[]>(
    "SELECT id FROM empleados WHERE empresa_id = ? AND id = ? FOR UPDATE", [empresa, id]);
  if (!rows[0]) throw new ErrorMultas("Empleado responsable no encontrado en esta empresa.", 400);
}

export async function crearRevision(actor: ActorMultas, input: unknown) {
  const data = revisionSchema.parse(input);
  return tx(async (conn) => {
    // Mismo primer lock que el DELETE de vehículos y el alta de multas.
    await vehiculoPropio(conn, actor.empresaId, data.vehiculo_id);
    const [previas] = await conn.query<RowDataPacket[]>(
      `SELECT id FROM ops_multas_revisiones WHERE empresa_id = ? AND vehiculo_id = ?
       AND periodo_anio = ? AND periodo_mes = ? FOR UPDATE`,
      [actor.empresaId, data.vehiculo_id, data.anio, data.mes]);
    if (previas.length) throw new ErrorMultas("La unidad ya tiene revisión en ese período.", 409);
    const [result] = await conn.execute<ResultSetHeader>(
      `INSERT INTO ops_multas_revisiones (empresa_id, vehiculo_id, periodo_anio, periodo_mes,
       verificada_en, verificada_por_usuario_id, observaciones) VALUES (?, ?, ?, ?, NOW(), ?, ?)`,
      [actor.empresaId, data.vehiculo_id, data.anio, data.mes, actor.usuarioId, data.observaciones]);
    if (result.affectedRows !== 1) throw new ErrorMultas("No se pudo crear la revisión.", 409);
    await auditar(conn, actor, "revision_multa_creada", { revision_id: result.insertId, ...data });
    return { id: result.insertId };
  });
}

const columnasCreacion = ["revision_id", "vehiculo_id", "fecha_infraccion", "referencia_boleta", "tipo_multa",
  "descripcion", "lugar", "monto_total", "moneda", "tipo_responsabilidad", "empleado_responsable_id",
  "responsable_texto", "resolucion_economica", "monto_empresa", "monto_colaborador", "estado",
  "estado_pago", "estado_descuento", "observaciones"] as const;
export async function crearMulta(actor: ActorMultas, input: unknown) {
  const data = nuevaMulta(input);
  return tx(async (conn) => {
    const vehiculo = await vehiculoPropio(conn, actor.empresaId, data.vehiculo_id);
    const [revisiones] = await conn.query<RowDataPacket[]>(
      `SELECT id FROM ops_multas_revisiones WHERE empresa_id = ? AND id = ? AND vehiculo_id = ? FOR UPDATE`,
      [actor.empresaId, data.revision_id, data.vehiculo_id]);
    if (!revisiones[0]) throw new ErrorMultas("Revisión no encontrada para esta empresa y vehículo.", 404);
    await responsablePropio(conn, actor.empresaId, data.empleado_responsable_id);
    const [result] = await conn.execute<ResultSetHeader>(
      `INSERT INTO ops_multas (empresa_id, placa_historica, creado_por_usuario_id, actualizado_por_usuario_id,
       ${columnasCreacion.join(", ")}) VALUES (${Array(4 + columnasCreacion.length).fill("?").join(", ")})`,
      [actor.empresaId, vehiculo.placa, actor.usuarioId, actor.usuarioId, ...columnasCreacion.map((c) => data[c])]);
    if (result.affectedRows !== 1) throw new ErrorMultas("No se pudo crear la multa.", 409);
    await auditar(conn, actor, "multa_creada", { multa_id: result.insertId, datos: data });
    return { id: result.insertId };
  });
}

// Whitelist fija: identidad, importe total, moneda y fecha no son editables.
const columnasEdicion = ["tipo_multa", "descripcion", "lugar", "tipo_responsabilidad", "empleado_responsable_id",
  "responsable_texto", "resolucion_economica", "monto_empresa", "monto_colaborador", "estado", "estado_pago",
  "estado_descuento", "observaciones", "pagada_en", "pagada_por_usuario_id",
  "monto_pagado", "referencia_pago", "observaciones_pago", "descontada_en",
  "descontada_por_usuario_id", "motivo_anulacion", "anulada_en", "anulada_por_usuario_id"] as const;
export async function actualizarMulta(actor: ActorMultas, id: number, input: unknown) {
  idSchema.parse(id);
  return tx(async (conn) => {
    const [rows] = await conn.query<RowDataPacket[]>(
      "SELECT * FROM ops_multas WHERE empresa_id = ? AND id = ? FOR UPDATE", [actor.empresaId, id]);
    if (!rows[0]) throw new ErrorMultas("Multa no encontrada.", 404);
    // mysql2 conserva DECIMAL como string; no activar decimalNumbers.
    const antes = rows[0] as RowDataPacket & Multa;
    const { multa: despues, evento } = transicion(antes, input, actor.usuarioId);
    await responsablePropio(conn, actor.empresaId, despues.empleado_responsable_id);
    const cambios = columnasEdicion.filter((c) => antes[c] !== despues[c]);
    if (!cambios.length) throw new ErrorMultas("No hay cambios; recargue el expediente.", 409);
    const params: SqlParams = cambios.map((c) => despues[c] as SqlValue);
    const [result] = await conn.execute<ResultSetHeader>(
      `UPDATE ops_multas SET ${cambios.map((c) => `${c} = ?`).join(", ")}, actualizado_por_usuario_id = ?, actualizado_en = NOW()
       WHERE empresa_id = ? AND id = ? AND estado = ? AND estado_pago = ? AND estado_descuento = ?`,
      [...params, actor.usuarioId, actor.empresaId, id, antes.estado, antes.estado_pago, antes.estado_descuento]);
    if (result.affectedRows !== 1) throw new ErrorMultas("El expediente cambió; recargue antes de continuar.", 409);
    await auditar(conn, actor, evento, { multa_id: id,
      antes: Object.fromEntries(cambios.map((c) => [c, antes[c]])),
      despues: Object.fromEntries(cambios.map((c) => [c, despues[c]])) });
    return { id };
  });
}

const filtrosSchema = z.object({
  anio: anioSchema.optional(), mes: mesSchema.optional(), vehiculo_id: idSchema.optional(),
  vista: z.enum(["periodo", "pendientes"]).default("periodo"),
  pagina: z.coerce.number().int().min(1).max(100000).default(1),
}).strict();
export function filtros(input: Record<string, string>, revisiones = false) {
  const data = filtrosSchema.parse(input);
  if ((revisiones || data.vista === "periodo") && (data.anio == null || data.mes == null))
    throw new ErrorMultas("Indique año y mes.");
  if (revisiones && data.vista !== "periodo") throw new ErrorMultas("Las revisiones se consultan por período.");
  return data;
}
export async function listarRevisiones(empresaId: number, input: Record<string, string>) {
  const f = filtros(input, true);
  const params: SqlParams = [empresaId, f.anio!, f.mes!];
  if (f.vehiculo_id) params.push(f.vehiculo_id);
  const rows = await query<RowDataPacket[]>(
    `SELECT r.*, v.placa AS placa_actual, u.nombre AS verificador_nombre, u.username AS verificador_usuario,
       (SELECT COUNT(*) FROM ops_multas m WHERE m.empresa_id = r.empresa_id AND m.revision_id = r.id
         AND m.vehiculo_id = r.vehiculo_id AND m.estado <> 'ANULADA') AS cantidad_multas,
       (SELECT COALESCE(SUM(m.monto_total), 0) FROM ops_multas m WHERE m.empresa_id = r.empresa_id AND m.revision_id = r.id
         AND m.vehiculo_id = r.vehiculo_id AND m.estado <> 'ANULADA') AS monto_total
     FROM ops_multas_revisiones r
     INNER JOIN flota_vehiculos v ON v.empresa_id = r.empresa_id AND v.id = r.vehiculo_id
     INNER JOIN usuarios u ON u.id = r.verificada_por_usuario_id
     WHERE r.empresa_id = ? AND r.periodo_anio = ? AND r.periodo_mes = ?
       ${f.vehiculo_id ? "AND r.vehiculo_id = ?" : ""}
     ORDER BY r.id DESC LIMIT 101 OFFSET ${(f.pagina - 1) * 100}`, params);
  return { revisiones: rows.slice(0, 100), pagina: f.pagina, hay_mas: rows.length > 100 };
}
export async function listarMultas(empresaId: number, input: Record<string, string>) {
  const f = filtros(input);
  const params: SqlParams = [empresaId];
  let periodo = "";
  if (f.vista === "periodo") {
    periodo = "AND r.periodo_anio = ? AND r.periodo_mes = ?";
    params.push(f.anio!, f.mes!);
  } else {
    // Pendientes de TODOS los períodos, sin copiar multas a otro mes.
    periodo = `AND m.estado <> 'ANULADA' AND (m.estado IN ('PENDIENTE','EN_REVISION')
      OR m.estado_pago = 'PENDIENTE' OR m.estado_descuento = 'PENDIENTE')`;
  }
  if (f.vehiculo_id) params.push(f.vehiculo_id);
  const rows = await query<RowDataPacket[]>(
    `SELECT m.*, r.periodo_anio, r.periodo_mes, v.placa AS placa_actual, e.nombre AS empleado_responsable_nombre,
            up.nombre AS pagada_por_nombre
     FROM ops_multas m
     INNER JOIN ops_multas_revisiones r ON r.empresa_id = m.empresa_id AND r.id = m.revision_id AND r.vehiculo_id = m.vehiculo_id
     INNER JOIN flota_vehiculos v ON v.empresa_id = m.empresa_id AND v.id = m.vehiculo_id
     LEFT JOIN empleados e ON e.empresa_id = m.empresa_id AND e.id = m.empleado_responsable_id
     LEFT JOIN usuarios up ON up.id = m.pagada_por_usuario_id
     WHERE m.empresa_id = ? ${periodo} ${f.vehiculo_id ? "AND m.vehiculo_id = ?" : ""}
     ORDER BY m.id DESC LIMIT 101 OFFSET ${(f.pagina - 1) * 100}`, params);
  const multas = await enriquecerConDescuentoRrhh(empresaId, rows.slice(0, 100));
  return { multas, vista: f.vista, pagina: f.pagina, hay_mas: rows.length > 100 };
}

/** Detalle de una multa — usado por GET .../multas/[id] (sección 29: historial básico). */
export async function obtenerMulta(empresaId: number, id: number) {
  idSchema.parse(id);
  const rows = await query<RowDataPacket[]>(
    `SELECT m.*, r.periodo_anio, r.periodo_mes, v.placa AS placa_actual, e.nombre AS empleado_responsable_nombre,
            up.nombre AS pagada_por_nombre
     FROM ops_multas m
     INNER JOIN ops_multas_revisiones r ON r.empresa_id = m.empresa_id AND r.id = m.revision_id AND r.vehiculo_id = m.vehiculo_id
     INNER JOIN flota_vehiculos v ON v.empresa_id = m.empresa_id AND v.id = m.vehiculo_id
     LEFT JOIN empleados e ON e.empresa_id = m.empresa_id AND e.id = m.empleado_responsable_id
     LEFT JOIN usuarios up ON up.id = m.pagada_por_usuario_id
     WHERE m.empresa_id = ? AND m.id = ? LIMIT 1`,
    [empresaId, id],
  );
  if (!rows[0]) throw new ErrorMultas("Multa no encontrada.", 404);
  const [multa] = await enriquecerConDescuentoRrhh(empresaId, [rows[0]]);
  return multa;
}

// ---------------------------------------------------------------------------
// MULTAS-3.2 — integración real con RRHH (rrhh_descuentos_maestro/cuotas).
// Fuente de verdad única: rrhh_descuentos_maestro/rrhh_descuento_cuotas
// (src/lib/rrhh/descuentos.ts). ops_multas SOLO guarda rrhh_descuento_id;
// todo lo demás (cuotas, saldo, periodicidad, estado real) se consulta.
// ---------------------------------------------------------------------------

export type DescuentoRrhhResumen = {
  id: number; codigo: string; estado: string; montoOriginal: number;
  numeroCuotas: number; cuotasAplicadas: number; pagado: number; saldo: number;
  proximaCuota: { numero: number; fecha: string; monto: number } | null;
};

/**
 * Enriquecimiento de LECTURA (sección 19). Agrega `descuentoRrhh` (o null)
 * a cada fila con rrhh_descuento_id, y RECALCULA `estado_descuento` a partir
 * de datos reales de RRHH — DESCONTADO solo si el descuento vinculado ya
 * tiene al menos una cuota APLICADA (sección 6). Es una proyección: nunca
 * escribe en ops_multas — la columna almacenada la sigue escribiendo
 * únicamente obligaciones() (PENDIENTE/NO_APLICA), ver reglas.ts.
 *
 * Nota de costo: una consulta por descuento_id DISTINTO en la página (vía
 * obtenerDescuento(), reutilizado tal cual). Un listado admin pagina de a
 * 100 filas y, en la práctica, solo una fracción tendrá rrhh_descuento_id
 * — aceptable para este panel; no es un hot path de alto volumen.
 */
async function enriquecerConDescuentoRrhh<T extends RowDataPacket>(
  empresaId: number,
  rows: T[],
): Promise<(T & { descuentoRrhh: DescuentoRrhhResumen | null })[]> {
  const ids = Array.from(new Set(
    rows.map((r) => (r.rrhh_descuento_id != null ? Number(r.rrhh_descuento_id) : null))
      .filter((v): v is number => v != null),
  ));
  if (!ids.length) return rows.map((r) => ({ ...r, descuentoRrhh: null }));
  const encontrados = await Promise.all(ids.map((id) => obtenerDescuento(empresaId, id)));
  const porId = new Map(encontrados.filter((d): d is NonNullable<typeof d> => d != null).map((d) => [d.id, d]));
  return rows.map((r) => {
    const id = r.rrhh_descuento_id != null ? Number(r.rrhh_descuento_id) : null;
    const d = id != null ? porId.get(id) ?? null : null;
    const descuentoRrhh: DescuentoRrhhResumen | null = d ? {
      id: d.id, codigo: d.codigo, estado: d.estado, montoOriginal: d.montoOriginal,
      numeroCuotas: d.numeroCuotas, cuotasAplicadas: d.cuotasAplicadas, pagado: d.pagado,
      saldo: d.saldo, proximaCuota: d.proximaCuota,
    } : null;
    const estado_descuento = d && d.cuotasAplicadas > 0 ? "DESCONTADO" : r.estado_descuento;
    return { ...r, estado_descuento, descuentoRrhh };
  });
}

/** Bandeja RRHH (sección 9): multas resueltas a cargo del colaborador sin descuento vinculado todavía. */
const paginaSchema = z.object({ pagina: z.coerce.number().int().min(1).max(100000).default(1) }).strict();
export async function listarMultasPendientesDescuento(empresaId: number, input: Record<string, string>) {
  const { pagina } = paginaSchema.parse(input);
  const rows = await query<RowDataPacket[]>(
    `SELECT m.id, m.fecha_infraccion, m.placa_historica, m.tipo_multa, m.descripcion,
            m.empleado_responsable_id, e.nombre AS empleado_responsable_nombre,
            m.monto_total, m.monto_colaborador, m.referencia_boleta, m.creado_en, m.estado_pago
     FROM ops_multas m
     LEFT JOIN empleados e ON e.empresa_id = m.empresa_id AND e.id = m.empleado_responsable_id
     WHERE m.empresa_id = ? AND m.estado <> 'ANULADA'
       AND m.resolucion_economica IN ('COLABORADOR','COMPARTIDO')
       AND m.monto_colaborador > 0
       AND m.rrhh_descuento_id IS NULL
     ORDER BY m.fecha_infraccion, m.id
     LIMIT 101 OFFSET ${(pagina - 1) * 100}`,
    [empresaId],
  );
  return { multas: rows.slice(0, 100), pagina, hay_mas: rows.length > 100 };
}

const configDescuentoSchema = z.object({
  periodicidad: z.enum(["UNA_VEZ", "CADA_QUINCENA", "SOLO_QUINCENA_1", "SOLO_QUINCENA_2", "CADA_N_QUINCENAS", "MENSUAL", "MANUAL"]),
  numeroCuotas: z.coerce.number().int().min(1).max(60).default(1),
  fechaInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida."),
  cadaNQuincenas: z.coerce.number().int().positive().nullable().optional(),
  tipoQuincenaInicio: z.enum(["QUINCENA_1", "QUINCENA_2", "MENSUAL"]).nullable().optional(),
  quincenaInicio: z.union([z.literal(1), z.literal(2)]).nullable().optional(),
}).strict();

export type ActorRrhh = { empresaId: number; usuarioId: number; usuario: string };

/**
 * RRHH crea, autoriza y VINCULA el descuento real (sección 10) — una sola
 * transacción multi-módulo: si algo falla (creación, autorización o el
 * vínculo final), todo se revierte y la multa queda exactamente como
 * estaba (nunca "descuento creado pero multa sin vínculo").
 *
 * Idempotencia (sección 14): el SELECT ... FOR UPDATE inicial serializa
 * solicitudes concurrentes sobre la MISMA multa — la segunda ve
 * rrhh_descuento_id ya no-nulo y falla con 409 antes de crear nada. El
 * UPDATE final, además, es condicional (WHERE rrhh_descuento_id IS NULL)
 * con verificación de affectedRows, como defensa adicional.
 *
 * Autoridad (sección 11): quien llama esta función YA debe tener permiso
 * RRHH real (requireTenantRrhh "descuentos" "crear") — verificado en el
 * endpoint, no aquí. multas:editar NUNCA basta por sí solo.
 */
export async function crearDescuentoDesdeMulta(actor: ActorRrhh, multaId: number, input: unknown) {
  const config = configDescuentoSchema.parse(input);
  if (config.periodicidad === "CADA_N_QUINCENAS" && !(Number(config.cadaNQuincenas) > 0)) {
    throw new ErrorMultas("Indica cada cuántas quincenas se aplica.");
  }
  return tx(async (conn) => {
    const [rows] = await conn.query<RowDataPacket[]>(
      "SELECT * FROM ops_multas WHERE empresa_id = ? AND id = ? FOR UPDATE",
      [actor.empresaId, multaId],
    );
    if (!rows[0]) throw new ErrorMultas("Multa no encontrada.", 404);
    const multa = rows[0] as RowDataPacket & Multa & { placa_historica: string };
    if (multa.estado === "ANULADA") throw new ErrorMultas("No se puede generar descuento de una multa anulada.", 409);
    if (multa.rrhh_descuento_id != null) throw new ErrorMultas("Esta multa ya tiene un descuento RRHH vinculado.", 409);
    // MULTAS-5 (sección 27): flujo preferido "Multa → Empresa paga → RRHH
    // descuenta" — la empresa paga el total a la autoridad ANTES de que
    // empiece la recuperación al colaborador. No rompe la arquitectura
    // (mismo guard atómico, mismo mensaje 409 que las demás validaciones
    // de esta función) y evita que RRHH programe cuotas sobre una multa
    // que la empresa todavía no pagó.
    if (multa.estado_pago !== "PAGADA")
      throw new ErrorMultas("La empresa debe registrar el pago de la multa a la autoridad antes de generar el descuento del colaborador.", 409);
    if (!["COLABORADOR", "COMPARTIDO"].includes(multa.resolucion_economica))
      throw new ErrorMultas("Esta multa no tiene monto a cargo del colaborador.", 409);
    const montoColaborador = Number(multa.monto_colaborador);
    if (!(montoColaborador > 0)) throw new ErrorMultas("Monto de colaborador inválido.", 409);
    if (multa.empleado_responsable_id == null)
      throw new ErrorMultas("La multa no tiene un empleado responsable vinculado.", 400);

    const { id: descuentoId, codigo } = await crearDescuentoInterno(conn, actor.empresaId, {
      empleadoId: multa.empleado_responsable_id,
      concepto: CONCEPTO_MULTA_RRHH,
      clasificacion: CLASIFICACION_MULTA_RRHH,
      motivo: motivoDescuentoMulta({
        placa_historica: multa.placa_historica,
        referencia_boleta: multa.referencia_boleta,
        descripcion: multa.descripcion,
      }),
      montoOriginal: montoColaborador,
      periodicidad: config.periodicidad as Periodicidad,
      numeroCuotas: config.numeroCuotas,
      cadaNQuincenas: config.cadaNQuincenas ?? null,
      tipoQuincenaInicio: (config.tipoQuincenaInicio ?? null) as TipoQuincenaInicio | null,
      quincenaInicio: config.quincenaInicio ?? null,
      fechaInicio: config.fechaInicio,
      documentoId: null,
      creadoPor: actor.usuario,
    });
    const { cuotasGeneradas } = await autorizarDescuentoInterno(conn, actor.empresaId, descuentoId, actor.usuario, {
      periodicidad: config.periodicidad as Periodicidad,
      fechaInicio: config.fechaInicio,
      numeroCuotas: config.numeroCuotas,
      cadaNQuincenas: config.cadaNQuincenas ?? null,
      montoOriginal: montoColaborador,
    });

    const [r] = await conn.execute<ResultSetHeader>(
      `UPDATE ops_multas SET rrhh_descuento_id = ?, actualizado_por_usuario_id = ?, actualizado_en = NOW()
       WHERE id = ? AND empresa_id = ? AND rrhh_descuento_id IS NULL`,
      [descuentoId, actor.usuarioId, multaId, actor.empresaId],
    );
    if (r.affectedRows !== 1) throw new ErrorMultas("La multa ya fue vinculada por otra solicitud.", 409);

    await registrarAuditoriaTx(conn, {
      empresaId: actor.empresaId, usuario: actor.usuario, modulo: "rrhh", accion: "descuento_creado_desde_multa",
      detalle: JSON.stringify({ usuario_id: actor.usuarioId, multa_id: multaId, descuento_id: descuentoId, codigo, cuotas: cuotasGeneradas }),
    });
    await registrarAuditoriaTx(conn, {
      empresaId: actor.empresaId, usuario: actor.usuario, modulo: "multas", accion: "multa_descuento_vinculado",
      detalle: JSON.stringify({ usuario_id: actor.usuarioId, multa_id: multaId, rrhh_descuento_id: descuentoId }),
    });
    return { id: multaId, rrhhDescuentoId: descuentoId, codigo, cuotasGeneradas };
  });
}

/**
 * Anulación de una multa CON descuento RRHH vinculado (sección 16). Sin
 * ninguna cuota APLICADA: cancela el descuento (cancelarDescuentoInterno,
 * reutilizado) y anula la multa en la MISMA transacción. Con al menos una
 * cuota APLICADA: 409, sin tocar nada — la reversión de planilla no se
 * implementa en esta fase.
 */
export async function anularMultaConDescuentoVinculado(actor: ActorMultas, id: number, motivoAnulacionInput: string) {
  idSchema.parse(id);
  const motivo = z.string().trim().min(1).max(4000).parse(motivoAnulacionInput);
  return tx(async (conn) => {
    const [rows] = await conn.query<RowDataPacket[]>(
      "SELECT * FROM ops_multas WHERE empresa_id = ? AND id = ? FOR UPDATE",
      [actor.empresaId, id],
    );
    if (!rows[0]) throw new ErrorMultas("Multa no encontrada.", 404);
    const antes = rows[0] as RowDataPacket & Multa;
    if (antes.rrhh_descuento_id == null)
      throw new ErrorMultas("Esta multa no tiene descuento RRHH vinculado; use la anulación estándar.", 409);
    if (antes.estado === "ANULADA") throw new ErrorMultas("Esta multa ya fue anulada.", 409);

    const [cuotasRows] = await conn.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS aplicadas FROM rrhh_descuento_cuotas WHERE empresa_id = ? AND descuento_id = ? AND estado = 'APLICADA'`,
      [actor.empresaId, antes.rrhh_descuento_id],
    );
    if (Number(cuotasRows[0]?.aplicadas ?? 0) > 0) {
      throw new ErrorMultas(
        "Esta multa ya tiene descuentos aplicados en planilla y requiere un proceso de reversión/ajuste.",
        409,
      );
    }

    const ahora = new Date();
    const next: Multa = { ...(antes as unknown as Multa), estado: "ANULADA", motivo_anulacion: motivo,
      anulada_en: ahora, anulada_por_usuario_id: actor.usuarioId };
    validarMulta(next); // preserva, entre otras, la protección existente si estado_pago ya es PAGADA.

    await cancelarDescuentoInterno(conn, actor.empresaId, antes.rrhh_descuento_id, `Multa #${id} anulada: ${motivo}`);

    const [r] = await conn.execute<ResultSetHeader>(
      `UPDATE ops_multas SET estado = 'ANULADA', motivo_anulacion = ?, anulada_en = NOW(), anulada_por_usuario_id = ?,
              actualizado_por_usuario_id = ?, actualizado_en = NOW()
       WHERE id = ? AND empresa_id = ? AND estado = ?`,
      [motivo, actor.usuarioId, actor.usuarioId, id, actor.empresaId, antes.estado],
    );
    if (r.affectedRows !== 1) throw new ErrorMultas("El expediente cambió; recargue antes de continuar.", 409);

    await registrarAuditoriaTx(conn, {
      empresaId: actor.empresaId, usuario: actor.usuario, modulo: "rrhh", accion: "cancelar_descuento",
      detalle: JSON.stringify({ usuario_id: actor.usuarioId, descuento_id: antes.rrhh_descuento_id, motivo: `Multa #${id} anulada: ${motivo}` }),
    });
    await registrarAuditoriaTx(conn, {
      empresaId: actor.empresaId, usuario: actor.usuario, modulo: "multas", accion: "multa_anulada_con_descuento",
      detalle: JSON.stringify({ usuario_id: actor.usuarioId, multa_id: id, rrhh_descuento_id: antes.rrhh_descuento_id, motivo }),
    });
    return { id };
  });
}

// ---------------------------------------------------------------------------
// Panel mensual (secciones 22-23): indicadores + tabla de unidades del mes.
// ---------------------------------------------------------------------------

const panelSchema = z.object({ anio: anioSchema, mes: mesSchema }).strict();
export async function panelMensualMultas(empresaId: number, input: Record<string, string>) {
  const { anio, mes } = panelSchema.parse(input);
  const unidades = await query<RowDataPacket[]>(
    `SELECT v.id AS vehiculo_id, v.placa,
            r.id AS revision_id, r.verificada_en, u.nombre AS verificador_nombre,
            (SELECT COUNT(*) FROM ops_multas m WHERE m.empresa_id = r.empresa_id AND m.revision_id = r.id
              AND m.vehiculo_id = r.vehiculo_id AND m.estado <> 'ANULADA') AS cantidad_multas,
            (SELECT COALESCE(SUM(m.monto_total), 0) FROM ops_multas m WHERE m.empresa_id = r.empresa_id AND m.revision_id = r.id
              AND m.vehiculo_id = r.vehiculo_id AND m.estado <> 'ANULADA') AS monto_total
     FROM flota_vehiculos v
     LEFT JOIN ops_multas_revisiones r ON r.empresa_id = v.empresa_id AND r.vehiculo_id = v.id
       AND r.periodo_anio = ? AND r.periodo_mes = ?
     LEFT JOIN usuarios u ON u.id = r.verificada_por_usuario_id
     WHERE v.empresa_id = ? AND v.estado = 'Activo'
     ORDER BY v.placa`,
    [anio, mes, empresaId],
  );
  const acumuladosRows = await query<RowDataPacket[]>(
    `SELECT COUNT(*) AS cantidad, COALESCE(SUM(monto_total), 0) AS monto_total,
            COALESCE(SUM(monto_empresa), 0) AS monto_empresa, COALESCE(SUM(monto_colaborador), 0) AS monto_colaborador,
            SUM(CASE WHEN resolucion_economica = 'PENDIENTE' THEN 1 ELSE 0 END) AS pendiente_resolucion
     FROM ops_multas WHERE empresa_id = ? AND estado <> 'ANULADA'`,
    [empresaId],
  );

  const filas = unidades.map((r) => ({
    vehiculoId: Number(r.vehiculo_id),
    placa: String(r.placa),
    revisionId: r.revision_id != null ? Number(r.revision_id) : null,
    estadoRevision: (r.revision_id == null ? "PENDIENTE" : Number(r.cantidad_multas) > 0 ? "CON_MULTAS" : "SIN_MULTAS") as
      "PENDIENTE" | "SIN_MULTAS" | "CON_MULTAS",
    cantidadMultas: Number(r.cantidad_multas ?? 0),
    montoTotal: Number(r.monto_total ?? 0),
    ultimaRevision: r.verificada_en ? String(r.verificada_en).slice(0, 10) : null,
    verificadoPor: r.verificador_nombre ? String(r.verificador_nombre) : null,
  }));
  const a = acumuladosRows[0] ?? {};
  return {
    indicadores: {
      unidadesActivas: filas.length,
      revisadas: filas.filter((u) => u.estadoRevision !== "PENDIENTE").length,
      pendientesRevision: filas.filter((u) => u.estadoRevision === "PENDIENTE").length,
      unidadesConMultas: filas.filter((u) => u.estadoRevision === "CON_MULTAS").length,
      cantidadMultasMes: filas.reduce((s, u) => s + u.cantidadMultas, 0),
      montoTotalMes: filas.reduce((s, u) => s + u.montoTotal, 0),
      acumulados: {
        cantidadMultas: Number(a.cantidad ?? 0),
        montoTotal: Number(a.monto_total ?? 0),
        montoEmpresa: Number(a.monto_empresa ?? 0),
        montoColaborador: Number(a.monto_colaborador ?? 0),
        pendienteResolucion: Number(a.pendiente_resolucion ?? 0),
      },
    },
    unidades: filas,
  };
}
