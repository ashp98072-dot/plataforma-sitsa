import type { RowDataPacket } from "mysql2";
import type { PoolConnection, ResultSetHeader } from "mysql2/promise";
import { execute, query, type SqlParams } from "@/lib/db";
import { registrarAuditoria } from "@/lib/auditoria";

/**
 * VIAT-0 — viáticos operativos asociados a una programación/viaje (piloto y
 * auxiliares). Información INTERNA: nunca se expone en endpoints de
 * cliente/facturación (ver src/app/api/empresas/[slug]/facturacion/**), ni se
 * mezcla con `tarifa_comercial`/`referencia_cliente` de tms_planes_viaje.
 *
 * Diseño (punto 10 de VIAT-0, ajustado por aclaración de negocio): `estado`
 * y `metodo_pago` quedan preparados para una fase operativa posterior
 * VIAT-1, conceptualmente PENDIENTE/PROGRAMADO → AUTORIZADO → ENTREGADO →
 * LIQUIDADO — ENTREGADO es el dinero entregado al piloto/auxiliar,
 * LIQUIDADO el cierre administrativo del viático. En esta fase NINGÚN
 * código escribe otro valor de `estado` que 'PROGRAMADO'.
 *
 * IMPORTANTE: los viáticos son un flujo puramente OPERATIVO de TMS/viaje —
 * NUNCA se pagan por planilla/nómina. No hay ni habrá relación con
 * rrhh_planilla_lineas, ni descuentos/ingresos de nómina generados desde
 * viáticos, ni lógica que dependa de una planilla para determinar si un
 * viático está pagado. `metodo_pago` (sin usar todavía) describirá en
 * VIAT-1 el medio de entrega del efectivo (p. ej. Efectivo/Transferencia/
 * Cheque) — Planilla no es, y no será, una opción válida.
 *
 * Puesto/tipo: se reutiliza el vocabulario ya existente (empleados.puesto /
 * empleados.categoria_ops: Piloto | Auxiliar | ...; tms_personal.tipo, que ya
 * usa los mismos valores) — no se crea un catálogo nuevo de puestos. La
 * resolución preferida es empleados.categoria_ops (cuando tms_personal está
 * vinculado a un empleado real vía id_empleado, ver
 * migrate-2026-08-fase0-tms-personal-empleado.sql); si no hay vínculo, cae a
 * tms_personal.tipo.
 *
 * Esquema: NO se crea/altera desde este módulo. tms_viaticos_config y
 * tms_viaticos deben existir por haberse aplicado manualmente
 * sql/migrate-2026-08-viat-0-viaticos.sql (mismo criterio que el resto de
 * SITSA: migraciones SQL explícitas antes de desplegar, sin DDL automático
 * en runtime). Si la migración no se aplicó, cualquier función de este
 * archivo falla con el error real de MySQL (tabla inexistente) — no se
 * silencia ni se crea estructura por su cuenta.
 */

export type ViaticoConfig = {
  id: number;
  puesto: string;
  montoDefecto: number;
  activo: boolean;
};

function mapConfig(r: RowDataPacket): ViaticoConfig {
  return {
    id: Number(r.id),
    puesto: String(r.puesto),
    montoDefecto: Number(r.monto_defecto ?? 0),
    activo: Number(r.activo ?? 1) === 1,
  };
}

export async function listarViaticosConfig(
  empresaId: number,
): Promise<ViaticoConfig[]> {
  const rows = await query<RowDataPacket[]>(
    `SELECT id, puesto, monto_defecto, activo FROM tms_viaticos_config
     WHERE empresa_id = ? ORDER BY puesto`,
    [empresaId],
  );
  return rows.map(mapConfig);
}

export async function guardarViaticoConfig(
  empresaId: number,
  puesto: string,
  montoDefecto: number,
  usuario: string,
): Promise<void> {
  const p = puesto.trim();
  if (!p) throw new Error("Puesto requerido.");
  await execute(
    `INSERT INTO tms_viaticos_config (empresa_id, puesto, monto_defecto, actualizado_por)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE monto_defecto = VALUES(monto_defecto), actualizado_por = VALUES(actualizado_por)`,
    [empresaId, p, montoDefecto, usuario],
  );
  await registrarAuditoria({
    empresaId,
    usuario,
    accion: "config_viatico",
    modulo: "tms",
    detalle: `Viático predeterminado · ${p} → Q${montoDefecto.toFixed(2)}`,
  });
}

async function runQuery<T extends RowDataPacket[]>(
  conn: PoolConnection | undefined,
  sql: string,
  params: SqlParams = [],
): Promise<T> {
  if (conn) {
    const [rows] = await conn.query<RowDataPacket[]>(sql, params);
    return rows as T;
  }
  return query<RowDataPacket[]>(sql, params) as Promise<T>;
}

async function runExecute(
  conn: PoolConnection | undefined,
  sql: string,
  params: SqlParams = [],
): Promise<ResultSetHeader> {
  if (conn) {
    const [result] = await conn.execute<ResultSetHeader>(sql, params);
    return result;
  }
  return execute(sql, params);
}

/** Puesto efectivo de un personal_id: empleados.categoria_ops si está vinculado, si no tms_personal.tipo. */
async function puestoDePersonal(
  empresaId: number,
  personalId: number,
  conn?: PoolConnection,
): Promise<string> {
  const rows = await runQuery<RowDataPacket[]>(
    conn,
    `SELECT COALESCE(e.categoria_ops, tp.tipo) AS puesto
     FROM tms_personal tp
     LEFT JOIN empleados e ON e.id = tp.id_empleado AND e.empresa_id = tp.empresa_id
     WHERE tp.id = ? AND tp.empresa_id = ? LIMIT 1`,
    [personalId, empresaId],
  );
  return rows[0]?.puesto ? String(rows[0].puesto) : "Otro";
}

async function montoSugeridoParaPuesto(
  empresaId: number,
  puesto: string,
  conn?: PoolConnection,
): Promise<number> {
  const rows = await runQuery<RowDataPacket[]>(
    conn,
    `SELECT monto_defecto FROM tms_viaticos_config
     WHERE empresa_id = ? AND puesto = ? AND activo = 1 LIMIT 1`,
    [empresaId, puesto],
  );
  return rows[0] ? Number(rows[0].monto_defecto ?? 0) : 0;
}

export type AsignacionPersonalPlan = {
  piloto: number | null;
  auxiliares: number[];
};

/** Monto explícito para UNA persona al sincronizar (Opción A — viáticos definidos desde el primer guardado). */
export type OverrideMontoViatico = {
  personalId: number;
  montoAsignado: number;
};

/**
 * Sincroniza tms_viaticos con el personal REALMENTE asignado a un plan
 * (punto 6, 8, 12). Reutiliza el mismo patrón "reemplazar según lo
 * actualmente asignado" que guardarAuxiliaresPlan() en
 * src/app/api/empresas/[slug]/tms/planes/route.ts:
 * - elimina filas de personal que ya no está asignado al plan;
 * - crea una fila para cada personal recién asignado que todavía no tenía
 *   viático (monto_asignado = el override recibido para esa persona, o el
 *   monto sugerido si no se envió override);
 * - NO toca monto_asignado/motivo_cambio/modificado_por de un personal que
 *   ya tenía fila y NO trae override (una edición de otros campos del
 *   plan, o un resave con el mismo personal, nunca resetea a ciegas un
 *   monto ya ajustado manualmente) — pero SÍ lo actualiza si esta llamada
 *   trae explícitamente un override para esa persona.
 *
 * Protección (revisión previa a merge, VIAT-3/Programación): la
 * sincronización automática por cambio de personal SOLO puede tocar
 * (borrar, refrescar rol/monto_sugerido, o aplicar un override de monto)
 * registros en estado PROGRAMADO. Un viático ya AUTORIZADO/ENTREGADO/
 * LIQUIDADO es información financiera/operativa ya procesada — si la
 * persona deja de estar asignada al plan, esa fila se PRESERVA intacta
 * (queda "huérfana" de la asignación actual del plan, pero es exactamente
 * el registro histórico de que esa persona sí fue programada y su
 * viático sí se autorizó/pagó/liquidó). Nunca se borra ni se modifica
 * automáticamente por un cambio de piloto/auxiliares o por un override —
 * solo por las transiciones explícitas de autorizarViatico/
 * registrarEntregaViatico/liquidarViatico o por una intervención manual
 * en BD, igual que cualquier otro dato ya cerrado.
 *
 * `conn` opcional: si viene (dentro de la transacción de POST/PATCH en
 * planes/route.ts), todas las escrituras usan esa misma conexión — la
 * asignación de personal y sus viáticos quedan consistentes en un solo
 * commit/rollback.
 */
export async function sincronizarViaticosPlan(
  empresaId: number,
  planId: number,
  asignacion: AsignacionPersonalPlan,
  conn?: PoolConnection,
  overrides?: OverrideMontoViatico[],
): Promise<void> {
  const objetivo: { personalId: number; rol: "Piloto" | "Auxiliar" }[] = [];
  if (asignacion.piloto != null) {
    objetivo.push({ personalId: asignacion.piloto, rol: "Piloto" });
  }
  for (const pid of asignacion.auxiliares) {
    if (!objetivo.some((o) => o.personalId === pid)) {
      objetivo.push({ personalId: pid, rol: "Auxiliar" });
    }
  }
  const overridePorPersonal = new Map<number, number>(
    (overrides ?? []).map((o) => [o.personalId, o.montoAsignado]),
  );

  // Solo estado PROGRAMADO se toca automáticamente -- ver protección arriba.
  if (objetivo.length) {
    const placeholders = objetivo.map(() => "?").join(",");
    await runExecute(
      conn,
      `DELETE FROM tms_viaticos WHERE plan_id = ? AND personal_id NOT IN (${placeholders}) AND estado = 'PROGRAMADO'`,
      [planId, ...objetivo.map((o) => o.personalId)],
    );
  } else {
    await runExecute(conn, `DELETE FROM tms_viaticos WHERE plan_id = ? AND estado = 'PROGRAMADO'`, [planId]);
  }

  // Si ya existe una fila para esta persona en este plan y NO está
  // PROGRAMADO (ya se autorizó/entregó/liquidó), se deja completamente
  // intacta -- ni rol, ni monto_sugerido, ni monto_asignado se tocan sobre
  // un registro ya cerrado, ni siquiera si viene un override para esa
  // persona.
  const existentesRows = await runQuery<RowDataPacket[]>(
    conn,
    `SELECT personal_id, estado, monto_asignado FROM tms_viaticos WHERE plan_id = ?`,
    [planId],
  );
  const existentePorPersonal = new Map<number, { estado: string; montoAsignado: number }>(
    existentesRows.map((r) => [
      Number(r.personal_id),
      { estado: String(r.estado ?? "PROGRAMADO"), montoAsignado: Number(r.monto_asignado ?? 0) },
    ]),
  );

  for (const o of objetivo) {
    const existente = existentePorPersonal.get(o.personalId);
    if (existente && existente.estado !== "PROGRAMADO") continue;

    const puesto = await puestoDePersonal(empresaId, o.personalId, conn);
    const sugerido = await montoSugeridoParaPuesto(empresaId, puesto, conn);
    // Prioridad del monto asignado: 1) override explícito de ESTA llamada
    // (gana siempre que la fila esté PROGRAMADO o sea nueva); 2) si la fila
    // ya existía (PROGRAMADO) y no hay override, se preserva su monto
    // actual (nunca se resetea a sugerido en un resave); 3) fila nueva sin
    // override -> sugerido.
    const asignado = overridePorPersonal.has(o.personalId)
      ? overridePorPersonal.get(o.personalId)!
      : existente
        ? existente.montoAsignado
        : sugerido;

    await runExecute(
      conn,
      `INSERT INTO tms_viaticos (empresa_id, plan_id, personal_id, rol, monto_sugerido, monto_asignado)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         rol = VALUES(rol),
         monto_sugerido = VALUES(monto_sugerido),
         monto_asignado = VALUES(monto_asignado)`,
      [empresaId, planId, o.personalId, o.rol, sugerido, asignado],
    );
  }
}

export type ResultadoActualizarMonto =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Modifica el monto asignado de UN viático ya existente (punto 7). Si el
 * monto difiere del sugerido, exige motivo (defensa server-side; la UI ya lo
 * exige antes de enviar). Guarda quién lo modificó y cuándo
 * (actualizado_en). No permite cambiar plan_id/personal_id/estado — este
 * endpoint es exclusivamente para el monto y su motivo.
 *
 * VIAT-1: una vez el viático dejó de estar PROGRAMADO (ya se autorizó, se
 * entregó o se liquidó), este endpoint YA NO permite tocar el monto —
 * "evitar modificaciones silenciosas del monto" una vez autorizado. No hay
 * todavía una acción explícita de "volver a Programado"/reautorización en
 * esta fase (mantener solución sencilla, según lo pedido); si el negocio
 * necesita corregir un monto ya autorizado, por ahora requiere intervención
 * manual en BD — riesgo documentado en el reporte de esta fase.
 */
export async function actualizarMontoViatico(
  empresaId: number,
  viaticoId: number,
  montoAsignado: number,
  motivoCambio: string | null,
  usuario: string,
): Promise<ResultadoActualizarMonto> {
  if (montoAsignado < 0) {
    return { ok: false, error: "El monto no puede ser negativo." };
  }
  const rows = await query<RowDataPacket[]>(
    `SELECT monto_sugerido, estado FROM tms_viaticos WHERE id = ? AND empresa_id = ? LIMIT 1`,
    [viaticoId, empresaId],
  );
  if (!rows[0]) {
    return { ok: false, error: "Viático no encontrado." };
  }
  const estadoActual = String(rows[0].estado ?? "PROGRAMADO");
  if (estadoActual !== "PROGRAMADO") {
    return {
      ok: false,
      error: `Este viático ya está ${estadoActual}; no se puede modificar el monto directamente.`,
    };
  }
  const sugerido = Number(rows[0].monto_sugerido ?? 0);
  const difiere = Math.abs(montoAsignado - sugerido) > 0.005;
  if (difiere && !motivoCambio?.trim()) {
    return {
      ok: false,
      error: "Indica el motivo del cambio: el monto difiere del predeterminado.",
    };
  }
  await execute(
    `UPDATE tms_viaticos
     SET monto_asignado = ?, motivo_cambio = ?, modificado_por = ?
     WHERE id = ? AND empresa_id = ? AND estado = 'PROGRAMADO'`,
    [montoAsignado, difiere ? motivoCambio!.trim() : null, usuario, viaticoId, empresaId],
  );
  await registrarAuditoria({
    empresaId,
    usuario,
    accion: "editar_viatico",
    modulo: "tms",
    detalle: `Viático #${viaticoId} · Q${sugerido.toFixed(2)} → Q${montoAsignado.toFixed(2)}${
      difiere ? ` · motivo: ${motivoCambio!.trim()}` : ""
    }`,
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// VIAT-1 — ciclo PROGRAMADO -> AUTORIZADO -> ENTREGADO -> LIQUIDADO.
// Transiciones atómicas y verificadas (UPDATE condicional por estado +
// affectedRows), mismo patrón ya usado en todo el proyecto (aprobarHorasExtra,
// aplicarCuotasElegibles, etc.) para que dos acciones concurrentes nunca
// dupliquen ni pisen una transición ya hecha por otra.
// ---------------------------------------------------------------------------

export type EstadoViatico = "PROGRAMADO" | "AUTORIZADO" | "ENTREGADO" | "LIQUIDADO";
export type MetodoPagoViatico = "EFECTIVO" | "TRANSFERENCIA" | "CHEQUE";

export type ResultadoTransicionViatico =
  | { ok: true }
  | { ok: false; error: string };

/**
 * PROGRAMADO -> AUTORIZADO. Quién puede: exclusivamente usuarios con el
 * permiso explícito `viaticos_autorizar:editar` (VIAT-2 — "OPERACIONES
 * AUTORIZA"; ver requireTenantViaticosAutorizar en src/lib/tenant.ts) —
 * NUNCA por ser supervisor del empleado, y separado del permiso de
 * pagar/entregar (`viaticos_pagar`). El permiso lo verifica el endpoint
 * antes de llamar aquí; esta función solo aplica la transición atómica.
 */
export async function autorizarViatico(
  empresaId: number,
  viaticoId: number,
  usuario: string,
): Promise<ResultadoTransicionViatico> {
  const r = await execute(
    `UPDATE tms_viaticos
     SET estado = 'AUTORIZADO', autorizado_por = ?, autorizado_en = NOW()
     WHERE id = ? AND empresa_id = ? AND estado = 'PROGRAMADO'`,
    [usuario, viaticoId, empresaId],
  );
  if (r.affectedRows !== 1) {
    return await estadoActualComoError(empresaId, viaticoId, "autorizar");
  }
  await registrarAuditoria({
    empresaId,
    usuario,
    accion: "autorizar_viatico",
    modulo: "tms",
    detalle: `Viático #${viaticoId} · PROGRAMADO → AUTORIZADO`,
  });
  return { ok: true };
}

export type DatosEntregaViatico = {
  metodoPago: MetodoPagoViatico;
  referenciaPago: string | null;
  observaciones: string | null;
};

/**
 * AUTORIZADO -> ENTREGADO. Quién puede: exclusivamente usuarios con el
 * permiso explícito `viaticos_pagar:editar` (VIAT-2 — "FACTURADOR PAGA";
 * ver requireTenantViaticosPagar en src/lib/tenant.ts) — separado de
 * `viaticos_autorizar`. Requiere método de pago; referencia obligatoria
 * para TRANSFERENCIA y CHEQUE (tienen un número de operación/cheque real
 * que registrar), opcional para EFECTIVO. No integra bancos ni APIs
 * externas — solo guarda el dato para trazabilidad. DatosEntregaViatico no
 * tiene campo de monto: quien entrega no puede tocar monto_sugerido ni
 * monto_asignado por este camino, y actualizarMontoViatico ya lo bloquea
 * de forma independiente fuera de PROGRAMADO.
 */
export async function registrarEntregaViatico(
  empresaId: number,
  viaticoId: number,
  datos: DatosEntregaViatico,
  usuario: string,
): Promise<ResultadoTransicionViatico> {
  if (
    (datos.metodoPago === "TRANSFERENCIA" || datos.metodoPago === "CHEQUE") &&
    !datos.referenciaPago?.trim()
  ) {
    return {
      ok: false,
      error:
        datos.metodoPago === "CHEQUE"
          ? "Indica el número de cheque."
          : "Indica la referencia/número de la transferencia.",
    };
  }
  const r = await execute(
    `UPDATE tms_viaticos
     SET estado = 'ENTREGADO', entregado_por = ?, entregado_en = NOW(),
         metodo_pago = ?, referencia_pago = ?, observaciones_entrega = ?
     WHERE id = ? AND empresa_id = ? AND estado = 'AUTORIZADO'`,
    [
      usuario,
      datos.metodoPago,
      datos.referenciaPago?.trim() || null,
      datos.observaciones?.trim() || null,
      viaticoId,
      empresaId,
    ],
  );
  if (r.affectedRows !== 1) {
    return await estadoActualComoError(empresaId, viaticoId, "registrar la entrega de");
  }
  await registrarAuditoria({
    empresaId,
    usuario,
    accion: "entregar_viatico",
    modulo: "tms",
    detalle: `Viático #${viaticoId} · AUTORIZADO → ENTREGADO · ${datos.metodoPago}${
      datos.referenciaPago?.trim() ? ` · ref. ${datos.referenciaPago.trim()}` : ""
    }`,
  });
  return { ok: true };
}

export type DatosLiquidacionViatico = {
  observaciones: string | null;
};

/**
 * ENTREGADO -> LIQUIDADO. Quién puede: usuarios con el permiso explícito
 * `viaticos:editar` (administración autorizada — VIAT-2 no le asignó un
 * permiso propio como a autorizar/pagar, es el único paso que queda bajo
 * el permiso general `viaticos`). En esta fase significa únicamente
 * "cerrado administrativamente" — NO implica devolución de sobrante ni
 * presentación de comprobantes (eso, si el negocio lo requiere, es una
 * ampliación posterior; el modelo queda preparado con
 * observaciones_liquidacion como texto libre para entonces).
 */
export async function liquidarViatico(
  empresaId: number,
  viaticoId: number,
  datos: DatosLiquidacionViatico,
  usuario: string,
): Promise<ResultadoTransicionViatico> {
  const r = await execute(
    `UPDATE tms_viaticos
     SET estado = 'LIQUIDADO', liquidado_por = ?, liquidado_en = NOW(),
         observaciones_liquidacion = ?
     WHERE id = ? AND empresa_id = ? AND estado = 'ENTREGADO'`,
    [usuario, datos.observaciones?.trim() || null, viaticoId, empresaId],
  );
  if (r.affectedRows !== 1) {
    return await estadoActualComoError(empresaId, viaticoId, "liquidar");
  }
  await registrarAuditoria({
    empresaId,
    usuario,
    accion: "liquidar_viatico",
    modulo: "tms",
    detalle: `Viático #${viaticoId} · ENTREGADO → LIQUIDADO`,
  });
  return { ok: true };
}

/** Mensaje de error cuando una transición no aplicó — distingue "no existe" de "estado no permite". */
async function estadoActualComoError(
  empresaId: number,
  viaticoId: number,
  accionTexto: string,
): Promise<{ ok: false; error: string }> {
  const existe = await query<RowDataPacket[]>(
    `SELECT estado FROM tms_viaticos WHERE id = ? AND empresa_id = ? LIMIT 1`,
    [viaticoId, empresaId],
  );
  if (!existe[0]) {
    return { ok: false, error: "Viático no encontrado." };
  }
  return {
    ok: false,
    error: `Este viático está ${String(existe[0].estado)}; no se puede ${accionTexto} desde ese estado.`,
  };
}

export type ViaticoDetalle = {
  id: number;
  planId: number;
  planCodigo: string;
  fechaPlan: string;
  cliente: string | null;
  unidadPlaca: string | null;
  personalId: number;
  personalNombre: string;
  rol: string;
  puesto: string;
  montoSugerido: number;
  montoAsignado: number;
  motivoCambio: string | null;
  modificadoPor: string | null;
  estado: string;
  metodoPago: string | null;
  creadoEn: string;
  actualizadoEn: string;
  autorizadoPor: string | null;
  autorizadoEn: string | null;
  entregadoPor: string | null;
  entregadoEn: string | null;
  referenciaPago: string | null;
  observacionesEntrega: string | null;
  liquidadoPor: string | null;
  liquidadoEn: string | null;
  observacionesLiquidacion: string | null;
};

function mapDetalle(r: RowDataPacket): ViaticoDetalle {
  return {
    id: Number(r.id),
    planId: Number(r.plan_id),
    planCodigo: String(r.plan_codigo ?? ""),
    fechaPlan: r.fecha_plan != null ? String(r.fecha_plan).slice(0, 10) : "",
    cliente: r.cliente != null ? String(r.cliente) : null,
    unidadPlaca: r.unidad_placa != null ? String(r.unidad_placa) : null,
    personalId: Number(r.personal_id),
    personalNombre: String(r.personal_nombre ?? ""),
    rol: String(r.rol),
    puesto: String(r.puesto ?? r.rol),
    montoSugerido: Number(r.monto_sugerido ?? 0),
    montoAsignado: Number(r.monto_asignado ?? 0),
    motivoCambio: r.motivo_cambio != null ? String(r.motivo_cambio) : null,
    modificadoPor: r.modificado_por != null ? String(r.modificado_por) : null,
    estado: String(r.estado ?? "PROGRAMADO"),
    metodoPago: r.metodo_pago != null ? String(r.metodo_pago) : null,
    creadoEn: String(r.creado_en ?? ""),
    actualizadoEn: String(r.actualizado_en ?? ""),
    autorizadoPor: r.autorizado_por != null ? String(r.autorizado_por) : null,
    autorizadoEn: r.autorizado_en != null ? String(r.autorizado_en) : null,
    entregadoPor: r.entregado_por != null ? String(r.entregado_por) : null,
    entregadoEn: r.entregado_en != null ? String(r.entregado_en) : null,
    referenciaPago: r.referencia_pago != null ? String(r.referencia_pago) : null,
    observacionesEntrega:
      r.observaciones_entrega != null ? String(r.observaciones_entrega) : null,
    liquidadoPor: r.liquidado_por != null ? String(r.liquidado_por) : null,
    liquidadoEn: r.liquidado_en != null ? String(r.liquidado_en) : null,
    observacionesLiquidacion:
      r.observaciones_liquidacion != null ? String(r.observaciones_liquidacion) : null,
  };
}

const DETALLE_SELECT = `
  SELECT v.id, v.plan_id, v.personal_id, v.rol, v.monto_sugerido, v.monto_asignado,
         v.motivo_cambio, v.modificado_por, v.estado, v.metodo_pago, v.creado_en, v.actualizado_en,
         v.autorizado_por, v.autorizado_en, v.entregado_por, v.entregado_en,
         v.referencia_pago, v.observaciones_entrega,
         v.liquidado_por, v.liquidado_en, v.observaciones_liquidacion,
         pl.codigo AS plan_codigo, pl.fecha_plan,
         c.nombre AS cliente, u.placa AS unidad_placa,
         tp.nombre AS personal_nombre,
         COALESCE(e.categoria_ops, tp.tipo) AS puesto
  FROM tms_viaticos v
  INNER JOIN tms_planes_viaje pl ON pl.id = v.plan_id
  LEFT JOIN tms_clientes c ON c.id = pl.cliente_id
  LEFT JOIN tms_unidades u ON u.id = pl.unidad_id
  INNER JOIN tms_personal tp ON tp.id = v.personal_id
  LEFT JOIN empleados e ON e.id = tp.id_empleado AND e.empresa_id = tp.empresa_id
`;

/** Detalle completo de los viáticos de UN plan/viaje (punto 8). Uso interno TMS/RRHH — nunca en endpoints de cliente/facturación. */
export async function listarViaticosDePlan(
  empresaId: number,
  planId: number,
): Promise<ViaticoDetalle[]> {
  const rows = await query<RowDataPacket[]>(
    `${DETALLE_SELECT} WHERE v.empresa_id = ? AND v.plan_id = ? ORDER BY v.rol DESC, tp.nombre`,
    [empresaId, planId],
  );
  return rows.map(mapDetalle);
}

export type FiltrosControlViaticos = {
  planId?: number;
  fechaDesde?: string;
  fechaHasta?: string;
  empleadoNombre?: string;
  estado?: EstadoViatico;
};

export type ResumenControlViaticos = {
  pendientes: number;
  autorizados: number;
  entregados: number;
  liquidados: number;
};

export type ViaticoControlItem = ViaticoDetalle & {
  banco?: string | null;
  tipoCuenta?: string | null;
  cuentaBancaria?: string | null;
};

/**
 * Listado para el módulo "Operaciones > Viáticos" (VIAT-3; antes "Control
 * de Viáticos" de TMS, VIAT-1 punto 7): todos los viáticos de la empresa
 * con filtros de viaje/fecha/empleado/estado, más el resumen de conteos
 * por estado (sobre el resultado ya filtrado, salvo el propio filtro de
 * estado — el resumen siempre refleja los otros filtros aplicados para
 * que los 4 contadores sumen el total visible al cambiar de estado).
 *
 * `incluirBancario` (VIAT-3): agrega banco/tipo cuenta/cuenta bancaria vía
 * una consulta SEPARADA (no se agrega a DETALLE_SELECT/ViaticoDetalle a
 * propósito) para que listarViaticosDePlan (usado por el panel de
 * Programación, audiencia más amplia que `viaticos_pagar`) nunca reciba
 * ese dato aunque comparta el mismo SELECT base. El endpoint que llama a
 * esta función decide `incluirBancario` según si el usuario tiene
 * `viaticos_pagar:ver` — nunca a partir de un valor enviado por el
 * cliente.
 */
export async function listarViaticosControl(
  empresaId: number,
  filtros: FiltrosControlViaticos = {},
  opts: { incluirBancario?: boolean } = {},
): Promise<{ items: ViaticoControlItem[]; resumen: ResumenControlViaticos }> {
  const condiciones: string[] = ["v.empresa_id = ?"];
  const params: SqlParams = [empresaId];

  if (filtros.planId != null) {
    condiciones.push("v.plan_id = ?");
    params.push(filtros.planId);
  }
  if (filtros.fechaDesde) {
    condiciones.push("pl.fecha_plan >= ?");
    params.push(filtros.fechaDesde);
  }
  if (filtros.fechaHasta) {
    condiciones.push("pl.fecha_plan <= ?");
    params.push(filtros.fechaHasta);
  }
  if (filtros.empleadoNombre?.trim()) {
    condiciones.push("tp.nombre LIKE ?");
    params.push(`%${filtros.empleadoNombre.trim()}%`);
  }

  const whereBase = condiciones.join(" AND ");

  const resumenRows = await query<RowDataPacket[]>(
    `SELECT v.estado, COUNT(*) AS total
     FROM tms_viaticos v
     INNER JOIN tms_planes_viaje pl ON pl.id = v.plan_id
     INNER JOIN tms_personal tp ON tp.id = v.personal_id
     WHERE ${whereBase}
     GROUP BY v.estado`,
    params,
  );
  const resumen: ResumenControlViaticos = {
    pendientes: 0,
    autorizados: 0,
    entregados: 0,
    liquidados: 0,
  };
  for (const r of resumenRows) {
    const total = Number(r.total ?? 0);
    switch (String(r.estado)) {
      case "PROGRAMADO":
        resumen.pendientes = total;
        break;
      case "AUTORIZADO":
        resumen.autorizados = total;
        break;
      case "ENTREGADO":
        resumen.entregados = total;
        break;
      case "LIQUIDADO":
        resumen.liquidados = total;
        break;
    }
  }

  const condicionesItems = [...condiciones];
  const paramsItems = [...params];
  if (filtros.estado) {
    condicionesItems.push("v.estado = ?");
    paramsItems.push(filtros.estado);
  }
  const rows = await query<RowDataPacket[]>(
    `${DETALLE_SELECT} WHERE ${condicionesItems.join(" AND ")} ORDER BY pl.fecha_plan DESC, pl.codigo DESC, v.rol DESC, tp.nombre`,
    paramsItems,
  );
  const items: ViaticoControlItem[] = rows.map(mapDetalle);

  if (opts.incluirBancario && items.length) {
    const ids = items.map((i) => i.id);
    const placeholders = ids.map(() => "?").join(",");
    const bancoRows = await query<RowDataPacket[]>(
      `SELECT v.id, e.banco, e.cuenta_bancaria, e.tipo_cuenta
       FROM tms_viaticos v
       INNER JOIN tms_personal tp ON tp.id = v.personal_id
       LEFT JOIN empleados e ON e.id = tp.id_empleado AND e.empresa_id = tp.empresa_id
       WHERE v.id IN (${placeholders})`,
      ids,
    );
    const bancoMap = new Map(bancoRows.map((r) => [Number(r.id), r]));
    for (const item of items) {
      const b = bancoMap.get(item.id);
      item.banco = b?.banco != null ? String(b.banco) : null;
      item.tipoCuenta = b?.tipo_cuenta != null ? String(b.tipo_cuenta) : null;
      item.cuentaBancaria = b?.cuenta_bancaria != null ? String(b.cuenta_bancaria) : null;
    }
  }

  return { items, resumen };
}

export type ViaticoPropio = {
  planId: number;
  montoAsignado: number;
  estado: EstadoViatico;
};

/**
 * Viáticos propios de UN colaborador para un conjunto de planes/viajes —
 * punto 8 (Portal): el piloto/auxiliar solo ve "Viático asignado" y
 * "Estado", nunca quién autorizó/entregó ni referencias de pago. Consulta
 * independiente y deliberadamente simple (no reutiliza el JOIN complejo de
 * listarAsignacionesOperativasEmpleado en src/lib/flota/viajes-piloto.ts,
 * que es de otro flujo y cambia con frecuencia) — filtra por el empleado
 * dueño de la fila tms_personal, igual que el resto de la resolución
 * piloto→empleado en este módulo (puestoDePersonal).
 */
export async function listarViaticosPropiosPorPlanes(
  empresaId: number,
  empleadoId: number,
  planIds: number[],
): Promise<Map<number, ViaticoPropio>> {
  const mapa = new Map<number, ViaticoPropio>();
  if (!planIds.length) return mapa;
  const placeholders = planIds.map(() => "?").join(",");
  const rows = await query<RowDataPacket[]>(
    `SELECT v.plan_id, v.monto_asignado, v.estado
     FROM tms_viaticos v
     INNER JOIN tms_personal tp ON tp.id = v.personal_id AND tp.empresa_id = v.empresa_id
     WHERE v.empresa_id = ? AND tp.id_empleado = ? AND v.plan_id IN (${placeholders})`,
    [empresaId, empleadoId, ...planIds],
  );
  for (const r of rows) {
    mapa.set(Number(r.plan_id), {
      planId: Number(r.plan_id),
      montoAsignado: Number(r.monto_asignado ?? 0),
      estado: (String(r.estado ?? "PROGRAMADO") as EstadoViatico),
    });
  }
  return mapa;
}

// ---------------------------------------------------------------------------
// VIAT-2 — "Bandeja del Facturador": viáticos por pagar. Consulta propia,
// separada de DETALLE_SELECT/ViaticoDetalle a propósito — es la ÚNICA
// consulta de este módulo que expone dato bancario (banco/cuenta_bancaria/
// tipo_cuenta, YA EXISTENTES en la ficha RRHH del empleado desde
// migrate-2026-08-rrhh-ficha-monaco.sql — no se inventa ni se agrega
// columna nueva). No se reutiliza para el panel de Programación ni para el
// Control de Viáticos general de TMS, para no exponer cuentas bancarias de
// compañeros a quien no tiene el permiso de pagar.
// ---------------------------------------------------------------------------

export type ViaticoPorPagar = {
  id: number;
  planId: number;
  planCodigo: string;
  fechaPlan: string;
  personalCodigo: string | null;
  personalNombre: string;
  rol: string;
  montoAsignado: number;
  estado: EstadoViatico;
  metodoPago: string | null;
  referenciaPago: string | null;
  banco: string | null;
  tipoCuenta: string | null;
  cuentaBancaria: string | null;
};

export type FiltrosViaticosPorPagar = {
  planId?: number;
  fechaDesde?: string;
  fechaHasta?: string;
  empleadoNombre?: string;
  estado?: EstadoViatico;
};

function mapPorPagar(r: RowDataPacket): ViaticoPorPagar {
  return {
    id: Number(r.id),
    planId: Number(r.plan_id),
    planCodigo: String(r.plan_codigo ?? ""),
    fechaPlan: r.fecha_plan != null ? String(r.fecha_plan).slice(0, 10) : "",
    personalCodigo: r.personal_codigo != null ? String(r.personal_codigo) : null,
    personalNombre: String(r.personal_nombre ?? ""),
    rol: String(r.rol),
    montoAsignado: Number(r.monto_asignado ?? 0),
    estado: String(r.estado ?? "PROGRAMADO") as EstadoViatico,
    metodoPago: r.metodo_pago != null ? String(r.metodo_pago) : null,
    referenciaPago: r.referencia_pago != null ? String(r.referencia_pago) : null,
    banco: r.banco != null ? String(r.banco) : null,
    tipoCuenta: r.tipo_cuenta != null ? String(r.tipo_cuenta) : null,
    cuentaBancaria: r.cuenta_bancaria != null ? String(r.cuenta_bancaria) : null,
  };
}

/**
 * Listado para la bandeja "Viáticos por pagar" (VIAT-2, punto 3). Por
 * convención el endpoint aplica `estado: "AUTORIZADO"` por defecto cuando
 * el llamador no pide otro estado explícitamente — esta función en sí es
 * un primitivo flexible (sin default propio) para poder filtrar por
 * cualquier estado desde la UI si el facturador necesita revisar
 * entregados/liquidados.
 */
export async function listarViaticosPorPagar(
  empresaId: number,
  filtros: FiltrosViaticosPorPagar = {},
): Promise<ViaticoPorPagar[]> {
  const condiciones: string[] = ["v.empresa_id = ?"];
  const params: SqlParams = [empresaId];

  if (filtros.planId != null) {
    condiciones.push("v.plan_id = ?");
    params.push(filtros.planId);
  }
  if (filtros.fechaDesde) {
    condiciones.push("pl.fecha_plan >= ?");
    params.push(filtros.fechaDesde);
  }
  if (filtros.fechaHasta) {
    condiciones.push("pl.fecha_plan <= ?");
    params.push(filtros.fechaHasta);
  }
  if (filtros.empleadoNombre?.trim()) {
    condiciones.push("tp.nombre LIKE ?");
    params.push(`%${filtros.empleadoNombre.trim()}%`);
  }
  if (filtros.estado) {
    condiciones.push("v.estado = ?");
    params.push(filtros.estado);
  }

  const rows = await query<RowDataPacket[]>(
    `SELECT v.id, v.plan_id, v.monto_asignado, v.estado, v.metodo_pago, v.referencia_pago,
            v.rol,
            pl.codigo AS plan_codigo, pl.fecha_plan,
            COALESCE(e.codigo, tp.codigo) AS personal_codigo,
            tp.nombre AS personal_nombre,
            e.banco, e.cuenta_bancaria, e.tipo_cuenta
     FROM tms_viaticos v
     INNER JOIN tms_planes_viaje pl ON pl.id = v.plan_id
     INNER JOIN tms_personal tp ON tp.id = v.personal_id
     LEFT JOIN empleados e ON e.id = tp.id_empleado AND e.empresa_id = tp.empresa_id
     WHERE ${condiciones.join(" AND ")}
     ORDER BY pl.fecha_plan, pl.codigo, v.rol DESC, tp.nombre`,
    params,
  );
  return rows.map(mapPorPagar);
}
