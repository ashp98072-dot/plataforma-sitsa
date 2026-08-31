import type { RowDataPacket } from "mysql2";
import type { PoolConnection, ResultSetHeader } from "mysql2/promise";
import { execute, getPool, query, type SqlParams } from "@/lib/db";
import { registrarAuditoria, registrarAuditoriaTx } from "@/lib/auditoria";
import { verificarPasswordUsuarioActual } from "@/lib/auth";
import { crearFirmaInterna, type ResultadoFirmaInterna } from "@/lib/firmas/firmas-internas";
import { sha256Hex } from "@/lib/firmas/imagen-firma";
import { borrarUpload, guardarUpload } from "@/lib/uploads";
import { centavos, decimal } from "@/lib/multas/reglas";

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

export type AvisoViaticoRechazado = {
  personalId: number;
  nombre: string;
  tipo: "RECHAZADO";
  estadoViatico: "RECHAZADO";
  motivoRechazo: string | null;
};

/**
 * PROGRAMACION-RECHAZADO-AVISO-1 — lectura PURAMENTE INFORMATIVA (nunca
 * bloquea, nunca modifica nada): ¿alguna de las personas que se están
 * (re)asignando a ESTE plan ya tiene, en ESTE MISMO plan, un viático
 * RECHAZADO? Existe para que quien edita Programación entienda por qué
 * sincronizarViaticosPlan() NO genera un viático nuevo para esa persona
 * — RECHAZADO es terminal por (plan_id, personal_id), protegido por
 * `UNIQUE KEY uq_viatico_plan_personal` y por el propio
 * sincronizarViaticosPlan (que salta esa fila sin tocarla, ver su
 * JSDoc) — esta función NO cambia esa regla, NO la toca, solo la
 * explica. `empresaId`/`planId` son SIEMPRE obligatorios en el WHERE
 * (multiempresa-safe, nunca solo `personalId`).
 */
export async function listarViaticosRechazadosDelPlan(
  empresaId: number,
  planId: number,
  personalIds: number[],
): Promise<AvisoViaticoRechazado[]> {
  const ids = [...new Set(personalIds)]; // sin duplicados -- nunca dos avisos para la misma persona.
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(",");
  const rows = await query<RowDataPacket[]>(
    `SELECT v.personal_id, tp.nombre AS personal_nombre, v.motivo_rechazo
     FROM tms_viaticos v
     INNER JOIN tms_personal tp ON tp.id = v.personal_id AND tp.empresa_id = v.empresa_id
     WHERE v.empresa_id = ? AND v.plan_id = ? AND v.personal_id IN (${placeholders}) AND v.estado = 'RECHAZADO'`,
    [empresaId, planId, ...ids],
  );
  return rows.map((r) => ({
    personalId: Number(r.personal_id),
    nombre: String(r.personal_nombre ?? ""),
    tipo: "RECHAZADO",
    estadoViatico: "RECHAZADO",
    motivoRechazo: r.motivo_rechazo != null ? String(r.motivo_rechazo) : null,
  }));
}

/**
 * PROGRAMACION-RECHAZADO-AVISO-1 — personalIds REALMENTE nuevos o
 * cambiados en un PATCH de plan, comparando la asignación PREVIA
 * (`antesAuxiliaresIds`) contra la SOLICITADA (`pilotoFinal`/
 * `auxiliaresFinal`) — para consultar listarViaticosRechazadosDelPlan()
 * SOLO por esas personas.
 *
 * Deliberadamente MÁS ESTRICTO que "personal que se está revalidando por
 * disponibilidad" (`pilotoIdParaValidar`/`auxiliaresIdsParaValidar` en
 * planes/route.ts): esos también incluyen al piloto/auxiliares YA
 * asignados sin cambiar, cuando `fechaCambia` dispara su revalidación de
 * disponibilidad en la nueva fecha — usar ESE conjunto para el aviso de
 * rechazo repetiría el aviso en un PATCH que solo cambia la fecha, sin
 * tocar personal (comportamiento no deseado). Esta función solo
 * considera el piloto si REALMENTE cambió (`pilotoCambioReal`) y los
 * auxiliares NUEVOS que no estaban antes — nunca personal sin tocar.
 * `pilotoCambioReal`/`pilotoFinal`/`auxiliaresCambioReal`/
 * `auxiliaresFinal`/`antesAuxiliaresIds` ya se calculan en el propio
 * PATCH para otros fines (bloqueo de remoción, revalidación de
 * disponibilidad) — se reutilizan tal cual, sin ninguna consulta nueva.
 */
export function personalRecienAsignadoDelPlan(input: {
  pilotoCambioReal: boolean;
  pilotoFinal: number | null;
  auxiliaresCambioReal: boolean;
  auxiliaresFinal: number[];
  antesAuxiliaresIds: number[];
}): number[] {
  const ids: number[] = [];
  if (input.pilotoCambioReal && input.pilotoFinal != null) {
    ids.push(input.pilotoFinal);
  }
  if (input.auxiliaresCambioReal) {
    const antesSet = new Set(input.antesAuxiliaresIds);
    for (const id of input.auxiliaresFinal) {
      if (!antesSet.has(id)) ids.push(id);
    }
  }
  return ids;
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

/**
 * VIATICOS-RECHAZADO-1 — RECHAZADO es una transición alternativa a
 * AUTORIZADO, únicamente desde PROGRAMADO, y es TERMINAL para ESE par
 * (plan_id, personal_id): no existe RECHAZADO -> PROGRAMADO, y tampoco
 * se crea una segunda fila para el mismo plan+persona — la tabla tiene
 * `UNIQUE KEY uq_viatico_plan_personal (plan_id, personal_id)` (ver
 * sql/migrate-2026-08-viat-0-viaticos.sql), y sincronizarViaticosPlan()
 * además SALTA por completo cualquier persona cuya fila ya exista y no
 * esté en PROGRAMADO (doble protección: esquema + código) — el rechazo
 * queda histórico e intacto para ese viaje.
 *
 * "Volver a solicitar el viático" únicamente es posible para un
 * `plan_id` (viaje) DISTINTO — ahí no hay conflicto de UNIQUE y
 * sincronizarViaticosPlan() sí crea una fila PROGRAMADO nueva sin
 * problema, porque busca filas existentes con `WHERE plan_id = ?` (el
 * nuevo plan nunca tiene una fila previa para esa persona). Reasignar a
 * la MISMA persona en el MISMO plan que ya tiene un viático RECHAZADO
 * NO genera ni actualiza ninguna fila — queda como mejora futura
 * (PROGRAMACION-RECHAZADO-AVISO-1) mostrar una advertencia visible en
 * ese caso en vez de que la sincronización lo ignore en silencio.
 */
export type EstadoViatico = "PROGRAMADO" | "AUTORIZADO" | "RECHAZADO" | "ENTREGADO" | "LIQUIDADO";
export type MetodoPagoViatico = "EFECTIVO" | "TRANSFERENCIA" | "CHEQUE";

export type ResultadoTransicionViatico =
  | { ok: true }
  /** `status` opcional (VIATICOS-PAGO-SNAPSHOT-1): 404 no encontrado, 409 estado/concurrencia, 400 validación — el endpoint cae a 400 si no viene (compatibilidad con las validaciones de forma que no lo fijan). */
  | { ok: false; error: string; status?: number };

/**
 * VIATICOS-FIRMA — identidad del firmante, común a autorizar y liquidar.
 *
 * CORRECCIÓN URGENTE (autorizar sin contraseña) — `password` es OPCIONAL
 * a nivel de tipo porque autorizarViatico YA NO la usa: sesión autenticada
 * + permiso `viaticos_autorizar:editar` (verificado por el endpoint) +
 * firma manuscrita (imagen obligatoria) son prueba suficiente para esta
 * firma interna simbólica. liquidarViatico SIGUE exigiéndola sin cambios
 * — cuando se envía, NUNCA se guarda ni se registra en ningún lado: se
 * verifica contra el hash real (verificarPasswordUsuarioActual) y se
 * descarta.
 */
export type DatosFirmaViatico = {
  usuarioId: number;
  nombreFirmante: string;
  rolFirmante: string;
  password?: string;
  /**
   * VIATICOS-FIRMA-VISUAL — PNG de la firma manuscrita, YA validado
   * (magic bytes + tamaño) por el endpoint antes de llegar aquí.
   * OBLIGATORIO: los modales "Firmar y autorizar"/"Firmar liquidación" y
   * también la bandeja masiva "Autorizar seleccionados" (todos con canvas
   * — ver ViaticosControlPanel) exigen un trazo antes de poder confirmar,
   * y el endpoint (autorizar/liquidar route.ts) rechaza con 400 si falta
   * — nunca se llega aquí sin imagen.
   */
  imagen: { bytes: ArrayBuffer; original: string };
  /**
   * VIATICOS-FIRMA-VISUAL (hotfix PR #124) — true SOLO cuando la firma
   * viene de la bandeja masiva "Autorizar seleccionados" (un único trazo
   * dibujado una vez, aplicado a N autorizaciones — ver
   * ViaticosControlPanel). Únicamente lo usa autorizarViatico (no existe
   * bandeja masiva de liquidación); cuando es `true`, `firmaLote: true`
   * queda dentro del payload_canonico firmado de ESA autorización, para
   * que el hash/payload nunca pretenda que el usuario dibujó una firma
   * distinta para cada viático del lote. Ausente/false en el flujo
   * individual (no se agrega la clave al payload).
   */
  firmaLote?: boolean;
  /**
   * MI-FIRMA-1 — de dónde viene `imagen`: `'DIBUJADA'` (canvas) o
   * `'GUARDADA'` (plantilla personal de "Mi firma", copiada a un archivo
   * nuevo por el endpoint ANTES de llegar aquí — ver DatosFirmaInterna
   * .origenFirma en src/lib/firmas/firmas-internas.ts). Solo trazabilidad
   * dentro del payload firmado — nunca cambia el flujo de guardado ni la
   * regla de "siempre una copia física independiente".
   */
  origenFirma?: "GUARDADA" | "DIBUJADA";
  ip?: string | null;
  userAgent?: string | null;
};

/**
 * VIATICOS-FIRMA-VISUAL — guarda a disco la imagen de la firma DESPUÉS de
 * verificar la contraseña y ANTES de abrir la transacción (guardarUpload
 * no participa en la transacción MySQL). Devuelve tanto la referencia
 * física (para armar el registro de la firma) como su SHA-256 (para el
 * payload_canonico).
 */
async function guardarImagenFirma(
  empresaId: number,
  viaticoId: number,
  accionPrefix: "autorizar" | "liquidar",
  imagen: { bytes: ArrayBuffer; original: string },
): Promise<{ relative: string; original: string; mime: string; size: number; sha256: string }> {
  const guardada = await guardarUpload(
    empresaId,
    "firmas",
    `firma_viatico_${accionPrefix}_${viaticoId}`,
    {
      name: imagen.original || "firma.png",
      size: imagen.bytes.byteLength,
      arrayBuffer: async () => imagen.bytes,
    },
  );
  return {
    relative: guardada.relative,
    original: guardada.original,
    mime: "image/png",
    size: guardada.size,
    sha256: sha256Hex(imagen.bytes),
  };
}

/**
 * VIATICOS-FIRMA-VISUAL (hotfix PR #124) — compensación CENTRALIZADA: se
 * invoca UNA sola vez, desde el `finally` de autorizarViatico/
 * liquidarViatico, cubriendo CUALQUIER salida sin commit — getConnection()
 * falla, beginTransaction falla, un SELECT/UPDATE falla, crearFirmaInterna
 * falla, la auditoría falla, commit falla, o cualquiera de los `return`
 * explícitos de estado inválido — nunca solo "dentro de la transacción".
 * borrarUpload ya es best-effort internamente (nunca lanza) — nunca oculta
 * el error o el resultado de rechazo real de la operación.
 */
function compensarImagenFirma(imagenGuardada: { relative: string }): void {
  borrarUpload(imagenGuardada.relative);
}

export type ResultadoTransicionConFirma =
  | { ok: true; firma: ResultadoFirmaInterna }
  | { ok: false; error: string; status: number };

/**
 * PROGRAMADO -> AUTORIZADO. Quién puede: exclusivamente usuarios con el
 * permiso explícito `viaticos_autorizar:editar` (VIAT-2 — "OPERACIONES
 * AUTORIZA"; ver requireTenantViaticosAutorizar en src/lib/tenant.ts) —
 * NUNCA por ser supervisor del empleado, y separado del permiso de
 * pagar/entregar (`viaticos_pagar`) y de liquidar (`viaticos_liquidar`).
 * El permiso lo verifica el endpoint antes de llamar aquí.
 *
 * CORRECCIÓN URGENTE — AUTORIZAR ya NO reautentica con contraseña. Prueba
 * de identidad suficiente para esta firma interna simbólica: sesión
 * autenticada + permiso EXPLÍCITO `viaticos_autorizar:editar` (verificado
 * por el endpoint ANTES de llamar aquí, nunca se debilita) + firma
 * manuscrita dibujada (imagen PNG obligatoria, ya validada por el
 * endpoint). Dentro de la MISMA transacción: bloquear el viático (FOR
 * UPDATE), validar estado, aplicar la transición, insertar la firma
 * (`metodo: 'FIRMA_MANUSCRITA'`) y registrar auditoría — commit conjunto
 * o rollback conjunto (regla dura del ticket, nunca "acción hecha pero
 * firma falló" ni viceversa). liquidarViatico SIGUE exigiendo contraseña,
 * sin cambios — ver su propio JSDoc más abajo.
 */
export async function autorizarViatico(
  empresaId: number,
  viaticoId: number,
  usuario: string,
  firma: DatosFirmaViatico,
): Promise<ResultadoTransicionConFirma> {
  // VIATICOS-FIRMA-VISUAL — la imagen (ya validada por el endpoint) se
  // guarda ANTES de abrir la transacción (guardarUpload no es
  // transaccional). No hay contraseña que verificar antes de este paso —
  // el permiso ya fue validado por el endpoint (requireTenantViaticosAutorizar).
  const imagenGuardada = await guardarImagenFirma(empresaId, viaticoId, "autorizar", firma.imagen);

  // VIATICOS-FIRMA-VISUAL (hotfix PR #124) — `conn` se declara FUERA del
  // try para que el `finally` pueda liberar/hacer rollback aunque
  // getPool().getConnection() (o beginTransaction) sea lo que falle —
  // antes, un error ahí dejaba el PNG ya guardado en disco sin ninguna
  // fila que lo referencie. `committed` es la única señal de "ya no hay
  // nada que compensar" — el `finally` corre en TODA salida (return
  // normal, return anticipado, o excepción), así que la compensación
  // queda en un único lugar en vez de repetida en cada `return`.
  let conn: PoolConnection | null = null;
  let committed = false;
  try {
    conn = await getPool().getConnection();
    await conn.beginTransaction();

    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT id, plan_id, personal_id, monto_asignado, estado
       FROM tms_viaticos WHERE id = ? AND empresa_id = ? LIMIT 1 FOR UPDATE`,
      [viaticoId, empresaId],
    );
    const v = rows[0];
    if (!v) {
      return { ok: false, error: "Viático no encontrado.", status: 404 };
    }
    if (String(v.estado) !== "PROGRAMADO") {
      return {
        ok: false,
        error: `Este viático está ${String(v.estado)}; no se puede autorizar desde ese estado.`,
        status: 409,
      };
    }

    // Contexto de solo lectura para el payload firmado (viaje/beneficiario)
    // — NO forma parte de lo que se bloquea/actualiza, no necesita FOR UPDATE.
    const [ctxRows] = await conn.query<RowDataPacket[]>(
      `SELECT pl.codigo AS plan_codigo, tp.nombre AS personal_nombre
       FROM tms_planes_viaje pl, tms_personal tp
       WHERE pl.id = ? AND tp.id = ?`,
      [v.plan_id, v.personal_id],
    );
    const ctx = ctxRows[0];

    const [upd] = await conn.execute<ResultSetHeader>(
      `UPDATE tms_viaticos
       SET estado = 'AUTORIZADO', autorizado_por = ?, autorizado_en = NOW()
       WHERE id = ? AND empresa_id = ? AND estado = 'PROGRAMADO'`,
      [usuario, viaticoId, empresaId],
    );
    if (upd.affectedRows !== 1) {
      return { ok: false, error: "El viático cambió de estado durante la operación.", status: 409 };
    }

    const resultadoFirma = await crearFirmaInterna(conn, {
      empresaId,
      usuarioId: firma.usuarioId,
      empleadoId: null,
      nombreFirmante: firma.nombreFirmante,
      rolFirmante: firma.rolFirmante,
      accion: "AUTORIZAR_VIATICO",
      modulo: "VIATICOS",
      entidadTipo: "VIATICO",
      entidadId: viaticoId,
      valoresRelevantes: {
        viaticoId,
        planId: Number(v.plan_id),
        planCodigo: ctx?.plan_codigo != null ? String(ctx.plan_codigo) : null,
        beneficiario: ctx?.personal_nombre != null ? String(ctx.personal_nombre) : null,
        montoAsignado: Number(v.monto_asignado),
        // VIATICOS-FIRMA-VISUAL (hotfix PR #124) — solo presente cuando
        // viene de "Autorizar seleccionados": deja explícito en el payload
        // firmado que este trazo se reutilizó para todo el lote.
        ...(firma.firmaLote ? { firmaLote: true } : {}),
      },
      imagen: imagenGuardada,
      metodo: "FIRMA_MANUSCRITA",
      origenFirma: firma.origenFirma,
      ip: firma.ip,
      userAgent: firma.userAgent,
    });

    await registrarAuditoriaTx(conn, {
      empresaId,
      usuario,
      accion: "autorizar_viatico",
      modulo: "tms",
      detalle: `Viático #${viaticoId} · PROGRAMADO → AUTORIZADO · firma ${resultadoFirma.codigoFirma}`,
    });

    await conn.commit();
    committed = true;
    return { ok: true, firma: resultadoFirma };
  } finally {
    if (conn) {
      if (!committed) {
        try {
          await conn.rollback();
        } catch {
          // best-effort — nunca oculta el error/rechazo real que ya se está propagando.
        }
      }
      conn.release();
    }
    if (!committed) {
      compensarImagenFirma(imagenGuardada);
    }
  }
}

/** Longitud del motivo de rechazo — mismo criterio de tamaño que motivo_cambio/observaciones_* de esta misma tabla (VARCHAR(300)). */
export const MOTIVO_RECHAZO_MIN = 10;
export const MOTIVO_RECHAZO_MAX = 300;

export type ResultadoRechazoViatico =
  | { ok: true }
  | { ok: false; error: string; status: number };

/**
 * VIATICOS-RECHAZADO-1 — PROGRAMADO -> RECHAZADO. Quién puede:
 * EXACTAMENTE el mismo permiso que autorizar (`viaticos_autorizar:editar`,
 * verificado por el endpoint ANTES de llamar aquí, requireTenantViaticosAutorizar)
 * — nunca se amplía a Facturador/AuxiliarOperaciones. RECHAZADO es
 * TERMINAL para ESE (plan_id, personal_id): solo alcanzable desde
 * PROGRAMADO, nunca desde AUTORIZADO/ENTREGADO/LIQUIDADO, sin transición
 * de regreso, y sin una segunda fila para el mismo plan+persona
 * (`UNIQUE KEY uq_viatico_plan_personal`, ver EstadoViatico arriba para
 * el detalle completo). "Solicitar de nuevo" solo es posible para un
 * `plan_id` (viaje) DISTINTO — sincronizarViaticosPlan preserva la fila
 * RECHAZADO intacta y sin tocarla para el plan original, sin cambios
 * adicionales.
 *
 * Sin firma manuscrita ni contraseña (decisión de negocio aprobada,
 * VIATICOS-RECHAZADO-1 sección 4/6): sesión autenticada + permiso
 * EXPLÍCITO + motivo + fecha servidor + auditoría son prueba suficiente
 * — nunca se llama crearFirmaInterna/guardarImagenFirma/SelectorFirma
 * aquí, y `firmas_electronicas` queda completamente intacta (mismo
 * criterio que registrarEntregaViatico, que tampoco firma).
 *
 * Mismo esqueleto transaccional exacto que autorizarViatico/
 * liquidarViatico (conn/committed fuera del try, único finally con
 * rollback condicional + release incondicional) — sin compensación de
 * archivos (este flujo no maneja imágenes).
 */
export async function rechazarViatico(
  empresaId: number,
  viaticoId: number,
  motivoRechazo: string,
  usuario: string,
): Promise<ResultadoRechazoViatico> {
  const motivo = motivoRechazo.trim();
  if (motivo.length < MOTIVO_RECHAZO_MIN) {
    return { ok: false, error: `El motivo debe tener al menos ${MOTIVO_RECHAZO_MIN} caracteres.`, status: 400 };
  }
  if (motivo.length > MOTIVO_RECHAZO_MAX) {
    return { ok: false, error: `El motivo no puede superar ${MOTIVO_RECHAZO_MAX} caracteres.`, status: 400 };
  }

  let conn: PoolConnection | null = null;
  let committed = false;
  try {
    conn = await getPool().getConnection();
    await conn.beginTransaction();

    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT id, estado FROM tms_viaticos WHERE id = ? AND empresa_id = ? LIMIT 1 FOR UPDATE`,
      [viaticoId, empresaId],
    );
    const v = rows[0];
    if (!v) {
      return { ok: false, error: "Viático no encontrado.", status: 404 };
    }
    if (String(v.estado) !== "PROGRAMADO") {
      return {
        ok: false,
        error: `Este viático está ${String(v.estado)}; no se puede rechazar desde ese estado.`,
        status: 409,
      };
    }

    const [upd] = await conn.execute<ResultSetHeader>(
      `UPDATE tms_viaticos
       SET estado = 'RECHAZADO', rechazado_por = ?, rechazado_en = NOW(), motivo_rechazo = ?
       WHERE id = ? AND empresa_id = ? AND estado = 'PROGRAMADO'`,
      [usuario, motivo, viaticoId, empresaId],
    );
    if (upd.affectedRows !== 1) {
      return { ok: false, error: "El viático cambió de estado durante la operación.", status: 409 };
    }

    await registrarAuditoriaTx(conn, {
      empresaId,
      usuario,
      accion: "rechazar_viatico",
      modulo: "tms",
      detalle: `Viático #${viaticoId} · PROGRAMADO → RECHAZADO · motivo: ${motivo}`,
    });

    await conn.commit();
    committed = true;
    return { ok: true };
  } finally {
    if (conn) {
      if (!committed) {
        try {
          await conn.rollback();
        } catch {
          // best-effort — nunca oculta el error/rechazo real que ya se está propagando.
        }
      }
      conn.release();
    }
  }
}

export type DatosEntregaViatico = {
  metodoPago: MetodoPagoViatico;
  referenciaPago: string | null;
  observaciones: string | null;
};

/** Snapshot bancario derivado del método — VIATICOS-PAGO-SNAPSHOT-1: solo TRANSFERENCIA copia banco/cuenta_bancaria/tipo_cuenta de `empleados`; CHEQUE/EFECTIVO quedan siempre en null (nunca inventan un dato bancario que el método no usa). */
function snapshotPagoDesdeFila(
  metodoPago: MetodoPagoViatico,
  fila: RowDataPacket,
): { banco: string | null; cuentaBancaria: string | null; tipoCuenta: string | null } {
  if (metodoPago !== "TRANSFERENCIA") {
    return { banco: null, cuentaBancaria: null, tipoCuenta: null };
  }
  return {
    banco: fila.banco != null ? String(fila.banco) : null,
    cuentaBancaria: fila.cuenta_bancaria != null ? String(fila.cuenta_bancaria) : null,
    tipoCuenta: fila.tipo_cuenta != null ? String(fila.tipo_cuenta) : null,
  };
}

/**
 * AUTORIZADO -> ENTREGADO. Quién puede: exclusivamente usuarios con el
 * permiso explícito `viaticos_pagar:editar` (VIAT-2 — "FACTURADOR PAGA";
 * ver requireTenantViaticosPagar en src/lib/tenant.ts) — separado de
 * `viaticos_autorizar`. Requiere método de pago; referencia obligatoria
 * para TRANSFERENCIA y CHEQUE (tienen un número de operación/cheque real
 * que registrar), opcional para EFECTIVO. No integra bancos ni APIs
 * externas para el pago en sí — solo guarda el dato para trazabilidad.
 * DatosEntregaViatico no tiene campo de monto: quien entrega no puede
 * tocar monto_sugerido ni monto_asignado por este camino, y
 * actualizarMontoViatico ya lo bloquea de forma independiente fuera de
 * PROGRAMADO.
 *
 * VIATICOS-PAGO-SNAPSHOT-1 — REESTRUCTURADO de un `execute()` suelto a
 * una transacción real (mismo esqueleto exacto que autorizarViatico/
 * liquidarViatico/registrarEntregaViaticosMasiva: `conn`/`committed`
 * fuera del try, único `finally` con rollback condicional + release
 * incondicional) para poder leer el banco/cuenta_bancaria/tipo_cuenta
 * ACTUAL del empleado dentro del MISMO `SELECT ... FOR UPDATE` que
 * bloquea el viático, y congelarlo en `pago_banco`/`pago_cuenta_bancaria`/
 * `pago_tipo_cuenta` en el mismo `UPDATE` que hace ENTREGADO — nunca en
 * un paso separado, nunca desde una consulta posterior que ya podría ver
 * una cuenta distinta. Solo TRANSFERENCIA congela algo (ver
 * snapshotPagoDesdeFila) — CHEQUE/EFECTIVO guardan los 3 campos en NULL,
 * igual que hoy no usan ningún dato bancario. Una vez escrito, estos 3
 * campos NUNCA se vuelven a tocar (liquidarViatico no los toca, ver su
 * propio JSDoc).
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

  let conn: PoolConnection | null = null;
  let committed = false;
  try {
    conn = await getPool().getConnection();
    await conn.beginTransaction();

    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT v.id, v.estado, v.monto_asignado, e.banco, e.cuenta_bancaria, e.tipo_cuenta
       FROM tms_viaticos v
       INNER JOIN tms_personal tp ON tp.id = v.personal_id AND tp.empresa_id = v.empresa_id
       LEFT JOIN empleados e ON e.id = tp.id_empleado AND e.empresa_id = tp.empresa_id
       WHERE v.id = ? AND v.empresa_id = ? LIMIT 1 FOR UPDATE`,
      [viaticoId, empresaId],
    );
    const v = rows[0];
    if (!v) {
      return { ok: false, error: "Viático no encontrado.", status: 404 };
    }
    if (String(v.estado) !== "AUTORIZADO") {
      return {
        ok: false,
        error: `Este viático está ${String(v.estado)}; no se puede registrar la entrega desde ese estado.`,
        status: 409,
      };
    }
    if (!(Number(v.monto_asignado) > 0)) {
      return { ok: false, error: "El viático tiene un monto inválido.", status: 400 };
    }
    if (datos.metodoPago === "TRANSFERENCIA" && !String(v.cuenta_bancaria ?? "").trim()) {
      return { ok: false, error: "El colaborador no tiene cuenta bancaria registrada.", status: 400 };
    }

    const snapshot = snapshotPagoDesdeFila(datos.metodoPago, v);

    const [upd] = await conn.execute<ResultSetHeader>(
      `UPDATE tms_viaticos
       SET estado = 'ENTREGADO', entregado_por = ?, entregado_en = NOW(),
           metodo_pago = ?, referencia_pago = ?, observaciones_entrega = ?,
           pago_banco = ?, pago_cuenta_bancaria = ?, pago_tipo_cuenta = ?
       WHERE id = ? AND empresa_id = ? AND estado = 'AUTORIZADO'`,
      [
        usuario,
        datos.metodoPago,
        datos.referenciaPago?.trim() || null,
        datos.observaciones?.trim() || null,
        snapshot.banco,
        snapshot.cuentaBancaria,
        snapshot.tipoCuenta,
        viaticoId,
        empresaId,
      ],
    );
    if (upd.affectedRows !== 1) {
      return { ok: false, error: "El viático cambió de estado durante la operación.", status: 409 };
    }

    await registrarAuditoriaTx(conn, {
      empresaId,
      usuario,
      accion: "entregar_viatico",
      modulo: "tms",
      detalle: `Viático #${viaticoId} · AUTORIZADO → ENTREGADO · ${datos.metodoPago}${
        datos.referenciaPago?.trim() ? ` · ref. ${datos.referenciaPago.trim()}` : ""
      }`,
    });

    await conn.commit();
    committed = true;
    return { ok: true };
  } finally {
    if (conn) {
      if (!committed) {
        try {
          await conn.rollback();
        } catch {
          // best-effort — nunca oculta el error/rechazo real que ya se está propagando.
        }
      }
      conn.release();
    }
  }
}

// ---------------------------------------------------------------------------
// VIATICOS-PAGO-MASIVO-1 — entrega/pago masiva (AUTORIZADO -> ENTREGADO de
// varios viáticos en UNA sola operación backend, nunca N llamadas HTTP al
// endpoint individual). Mismo permiso (`viaticos_pagar:editar`, sin
// ampliarlo) y misma transición que registrarEntregaViatico — la única
// diferencia es que el lote es TODO O NADA: si cualquier seleccionado no
// califica, NINGUNO se procesa (rollback completo, nunca éxito parcial).
// ---------------------------------------------------------------------------

/** Límite razonable por lote — evita un UPDATE/SELECT desmedido y un bloqueo de filas prolongado. */
export const LIMITE_LOTE_ENTREGA_MASIVA = 200;

export type ItemEntregaMasiva = {
  id: number;
  /**
   * TRANSFERENCIA: referencia/número de operación — puede ser la MISMA
   * para todo el lote (representa el lote/operación bancaria, no se exige
   * que sea distinta por persona — ver sección 4 del ticket). CHEQUE:
   * número de cheque de ESTE viático, obligatorio y ÚNICO dentro del lote
   * (cada persona recibe un cheque físico distinto — nunca se reutiliza
   * una misma referencia para todo el lote, a diferencia de
   * transferencia). EFECTIVO: `null` (no exige referencia, igual que el
   * flujo individual).
   */
  referenciaPago: string | null;
};

export type DatosEntregaMasiva = {
  metodoPago: MetodoPagoViatico;
  items: ItemEntregaMasiva[];
};

export type ResultadoEntregaMasiva =
  | { ok: true; procesados: number; total: number; metodoPago: MetodoPagoViatico }
  | { ok: false; error: string; status: number; detalles?: string[] };

/**
 * Entrega/pago MASIVO — AUTORIZADO -> ENTREGADO de varios viáticos a la
 * vez. Quién puede: exclusivamente `viaticos_pagar:editar` (idéntico al
 * flujo individual, verificado por el endpoint ANTES de llamar aquí — este
 * ticket NO amplía ningún permiso).
 *
 * ATOMICIDAD DEL LOTE (regla dura del ticket): BEGIN -> `SELECT ... FOR
 * UPDATE` de TODOS los ids a la vez (bloquea las filas ANTES de validar,
 * cerrando la ventana de concurrencia — ver sección 8/19 del ticket) ->
 * se valida CADA condición de CADA item (pertenece a la empresa, está
 * AUTORIZADO, monto > 0, cuenta bancaria si es TRANSFERENCIA, referencia
 * obligatoria según método) ANTES de escribir un solo UPDATE -> si CUALQUIER
 * item falla cualquier condición, se hace `return` sin haber ejecutado
 * ningún UPDATE — el `finally` centralizado hace rollback (no hay nada que
 * compensar en disco: este flujo no maneja imágenes/archivos, a diferencia
 * de autorizarViatico/liquidarViatico) -> solo si TODOS pasan se ejecutan
 * los N `UPDATE` + N `registrarAuditoriaTx` (uno por viático, misma
 * transacción) -> UN solo `COMMIT` al final. Nunca éxito parcial: o se
 * confirman los N, o no se confirma ninguno.
 *
 * Concurrencia (sección 8/19): el `FOR UPDATE` bloquea las filas desde el
 * SELECT — si otro Facturador ya tiene una transacción en curso sobre
 * alguno de estos ids, esta espera a que termine; si esa otra transacción
 * ya confirmó (p. ej. ya lo entregó), el SELECT de ESTA transacción lee el
 * estado YA ACTUALIZADO y la validación de "todos AUTORIZADO" lo detecta y
 * rechaza el lote completo (409) — nunca hay doble entrega.
 */
export async function registrarEntregaViaticosMasiva(
  empresaId: number,
  datos: DatosEntregaMasiva,
  usuario: string,
): Promise<ResultadoEntregaMasiva> {
  const ids = datos.items.map((i) => i.id);
  if (!ids.length) {
    return { ok: false, error: "Selecciona al menos un viático.", status: 400 };
  }
  if (new Set(ids).size !== ids.length) {
    return { ok: false, error: "Hay viáticos repetidos en la selección.", status: 400 };
  }
  if (ids.length > LIMITE_LOTE_ENTREGA_MASIVA) {
    return { ok: false, error: `El lote supera el límite de ${LIMITE_LOTE_ENTREGA_MASIVA} viáticos.`, status: 400 };
  }

  // Validaciones de FORMA del método (antes de tocar la conexión) — mismo
  // criterio que registrarEntregaViatico: referencia obligatoria para
  // TRANSFERENCIA/CHEQUE, opcional para EFECTIVO. CHEQUE además exige que
  // cada referencia sea única dentro del lote (sección 5 del ticket).
  if (datos.metodoPago === "TRANSFERENCIA" || datos.metodoPago === "CHEQUE") {
    for (const it of datos.items) {
      if (!it.referenciaPago?.trim()) {
        return {
          ok: false,
          error:
            datos.metodoPago === "CHEQUE"
              ? `Falta el número de cheque para el viático #${it.id}.`
              : "Indica la referencia/número de la transferencia.",
          status: 400,
        };
      }
    }
  }
  if (datos.metodoPago === "CHEQUE") {
    const referencias = datos.items.map((i) => i.referenciaPago!.trim());
    if (new Set(referencias).size !== referencias.length) {
      return { ok: false, error: "Hay números de cheque repetidos dentro del lote.", status: 400 };
    }
  }

  let conn: PoolConnection | null = null;
  let committed = false;
  try {
    conn = await getPool().getConnection();
    await conn.beginTransaction();

    // VIATICOS-PAGO-SNAPSHOT-1 — e.banco/e.tipo_cuenta se agregan a este
    // MISMO SELECT (e.cuenta_bancaria ya se traía para validar) — cero
    // consultas adicionales, mismo bloqueo FOR UPDATE de siempre.
    const placeholders = ids.map(() => "?").join(",");
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT v.id, v.estado, v.monto_asignado, tp.nombre AS personal_nombre,
              e.banco, e.cuenta_bancaria, e.tipo_cuenta
       FROM tms_viaticos v
       INNER JOIN tms_personal tp ON tp.id = v.personal_id AND tp.empresa_id = v.empresa_id
       LEFT JOIN empleados e ON e.id = tp.id_empleado AND e.empresa_id = tp.empresa_id
       WHERE v.empresa_id = ? AND v.id IN (${placeholders})
       FOR UPDATE`,
      [empresaId, ...ids],
    );

    const filaPorId = new Map(rows.map((r) => [Number(r.id), r]));
    const problemas: string[] = [];
    for (const it of datos.items) {
      const fila = filaPorId.get(it.id);
      if (!fila) {
        problemas.push(`El viático #${it.id} no existe en esta empresa.`);
        continue;
      }
      if (String(fila.estado) !== "AUTORIZADO") {
        problemas.push(`El viático #${it.id} ya no está autorizado (estado actual: ${String(fila.estado)}).`);
        continue;
      }
      if (!(Number(fila.monto_asignado) > 0)) {
        problemas.push(`El viático #${it.id} tiene un monto inválido.`);
        continue;
      }
      if (datos.metodoPago === "TRANSFERENCIA" && !String(fila.cuenta_bancaria ?? "").trim()) {
        problemas.push(`${fila.personal_nombre ?? `Viático #${it.id}`} no tiene cuenta bancaria registrada.`);
      }
    }
    if (problemas.length) {
      return { ok: false, error: "Hay viáticos que no se pueden procesar en este lote.", status: 409, detalles: problemas };
    }

    for (const it of datos.items) {
      // VIATICOS-PAGO-SNAPSHOT-1 — snapshot POR PERSONA: aunque
      // TRANSFERENCIA comparta una sola referencia de lote, cada viático
      // congela el banco/cuenta/tipo de cuenta de SU PROPIO beneficiario
      // (nunca los de otro item del lote).
      const snapshot = snapshotPagoDesdeFila(datos.metodoPago, filaPorId.get(it.id)!);
      const [upd] = await conn.execute<ResultSetHeader>(
        `UPDATE tms_viaticos
         SET estado = 'ENTREGADO', entregado_por = ?, entregado_en = NOW(),
             metodo_pago = ?, referencia_pago = ?,
             pago_banco = ?, pago_cuenta_bancaria = ?, pago_tipo_cuenta = ?
         WHERE id = ? AND empresa_id = ? AND estado = 'AUTORIZADO'`,
        [
          usuario, datos.metodoPago, it.referenciaPago,
          snapshot.banco, snapshot.cuentaBancaria, snapshot.tipoCuenta,
          it.id, empresaId,
        ],
      );
      if (upd.affectedRows !== 1) {
        return { ok: false, error: `El viático #${it.id} cambió de estado durante la operación.`, status: 409 };
      }
      await registrarAuditoriaTx(conn, {
        empresaId,
        usuario,
        accion: "entregar_viatico",
        modulo: "tms",
        detalle: `Viático #${it.id} · AUTORIZADO → ENTREGADO (masivo) · ${datos.metodoPago}${
          it.referenciaPago ? ` · ref. ${it.referenciaPago}` : ""
        }`,
      });
    }

    await conn.commit();
    committed = true;
    const total = datos.items.reduce((acc, it) => acc + Number(filaPorId.get(it.id)!.monto_asignado), 0);
    return { ok: true, procesados: datos.items.length, total, metodoPago: datos.metodoPago };
  } finally {
    if (conn) {
      if (!committed) {
        try {
          await conn.rollback();
        } catch {
          // best-effort — nunca oculta el error/rechazo real que ya se está propagando.
        }
      }
      conn.release();
    }
  }
}

/**
 * VIATICOS-FIRMA — liquidación estructurada (antes: solo observaciones
 * libres). gastosComprobados/reintegro llegan como string decimal
 * (mismo contrato que `dinero`/`centavos()` en src/lib/multas/reglas.ts —
 * reutilizado tal cual, nunca aritmética en float JS para la decisión
 * financiera de si se puede liquidar).
 */
export type DatosLiquidacionViatico = {
  gastosComprobados: string;
  reintegro: string;
  observaciones: string | null;
};

/**
 * ENTREGADO -> LIQUIDADO. Quién puede: usuarios con el permiso EXPLÍCITO
 * `viaticos_liquidar:editar` (Facturador lo trae por defecto) — YA NO el
 * genérico `viaticos:editar` (VIATICOS-FIRMA lo reemplaza; ver reporte de
 * entrega sobre usuarios con el permiso genérico antiguo).
 *
 * Regla crítica de conciliación: diferencia = monto_asignado -
 * gastos_comprobados - reintegro, con aritmética EXACTA en centavos
 * (centavos()/decimal() de multas/reglas.ts, nunca float). Solo se
 * permite liquidar (y por tanto firmar) si diferencia === 0.00 exacto —
 * > 0 significa "pendiente por comprobar o reintegrar" (rechaza, sigue
 * ENTREGADO); < 0 significa que gastos+reintegro superan lo entregado
 * (rechaza igual, sigue ENTREGADO) — ningún caso cambia el estado ni crea
 * firma. VIATICOS-FIRMA: firma electrónica interna (contraseña actual,
 * `metodo: 'PASSWORD'`) + transición + auditoría en la MISMA transacción,
 * mismo patrón que autorizarViatico. CORRECCIÓN URGENTE (autorizar sin
 * contraseña): esto es SOLO para autorizar — liquidarViatico SIGUE
 * exigiendo contraseña sin cambios, `firma.password` sigue siendo
 * obligatorio en la práctica aquí (el tipo lo dejó opcional para
 * compartirse con autorizar, pero una contraseña vacía/ausente
 * simplemente nunca verifica correctamente, ver abajo).
 */
export async function liquidarViatico(
  empresaId: number,
  viaticoId: number,
  datos: DatosLiquidacionViatico,
  usuario: string,
  firma: DatosFirmaViatico,
): Promise<ResultadoTransicionConFirma> {
  let gastosCent: number;
  let reintegroCent: number;
  try {
    gastosCent = centavos(datos.gastosComprobados || "0");
    reintegroCent = centavos(datos.reintegro || "0");
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Monto inválido.", status: 400 };
  }
  if (gastosCent < 0 || reintegroCent < 0) {
    return { ok: false, error: "Los montos no pueden ser negativos.", status: 400 };
  }

  const passwordOk = await verificarPasswordUsuarioActual(firma.usuarioId, firma.password ?? "");
  if (!passwordOk) {
    return { ok: false, error: "Contraseña incorrecta.", status: 401 };
  }

  // VIATICOS-FIRMA-VISUAL — SOLO después de verificar la contraseña, y
  // ANTES de abrir la transacción (guardarUpload no es transaccional).
  const imagenGuardada = await guardarImagenFirma(empresaId, viaticoId, "liquidar", firma.imagen);

  // VIATICOS-FIRMA-VISUAL (hotfix PR #124) — misma estrategia centralizada
  // que autorizarViatico: `conn` fuera del try, `committed` como única
  // señal de "ya no hay nada que compensar", compensación (y rollback) en
  // UN solo `finally` que cubre cualquier salida sin commit — incluyendo
  // que getPool().getConnection() falle antes de siquiera existir `conn`.
  let conn: PoolConnection | null = null;
  let committed = false;
  try {
    conn = await getPool().getConnection();
    await conn.beginTransaction();

    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT id, monto_asignado, estado FROM tms_viaticos WHERE id = ? AND empresa_id = ? LIMIT 1 FOR UPDATE`,
      [viaticoId, empresaId],
    );
    const v = rows[0];
    if (!v) {
      return { ok: false, error: "Viático no encontrado.", status: 404 };
    }
    if (String(v.estado) !== "ENTREGADO") {
      return {
        ok: false,
        error: `Este viático está ${String(v.estado)}; no se puede liquidar desde ese estado.`,
        status: 409,
      };
    }

    const montoEntregadoCent = centavos(String(v.monto_asignado));
    const diferenciaCent = montoEntregadoCent - gastosCent - reintegroCent;
    if (diferenciaCent > 0) {
      return {
        ok: false,
        error: `Pendiente por comprobar o reintegrar: Q${decimal(diferenciaCent)}`,
        status: 409,
      };
    }
    if (diferenciaCent < 0) {
      return {
        ok: false,
        error: "Los gastos y reintegros superan el monto entregado. Revisa la liquidación.",
        status: 409,
      };
    }

    const [upd] = await conn.execute<ResultSetHeader>(
      `UPDATE tms_viaticos
       SET estado = 'LIQUIDADO', liquidado_por = ?, liquidado_en = NOW(),
           gastos_comprobados = ?, reintegro = ?, observaciones_liquidacion = ?
       WHERE id = ? AND empresa_id = ? AND estado = 'ENTREGADO'`,
      [usuario, decimal(gastosCent), decimal(reintegroCent), datos.observaciones?.trim() || null, viaticoId, empresaId],
    );
    if (upd.affectedRows !== 1) {
      return { ok: false, error: "El viático cambió de estado durante la operación.", status: 409 };
    }

    const resultadoFirma = await crearFirmaInterna(conn, {
      empresaId,
      usuarioId: firma.usuarioId,
      empleadoId: null,
      nombreFirmante: firma.nombreFirmante,
      rolFirmante: firma.rolFirmante,
      accion: "LIQUIDAR_VIATICO",
      modulo: "VIATICOS",
      entidadTipo: "VIATICO",
      entidadId: viaticoId,
      valoresRelevantes: {
        viaticoId,
        montoEntregado: decimal(montoEntregadoCent),
        gastosComprobados: decimal(gastosCent),
        reintegro: decimal(reintegroCent),
        diferencia: decimal(diferenciaCent),
        observaciones: datos.observaciones?.trim() || null,
      },
      imagen: imagenGuardada,
      metodo: "PASSWORD",
      origenFirma: firma.origenFirma,
      ip: firma.ip,
      userAgent: firma.userAgent,
    });

    await registrarAuditoriaTx(conn, {
      empresaId,
      usuario,
      accion: "liquidar_viatico",
      modulo: "tms",
      detalle: `Viático #${viaticoId} · ENTREGADO → LIQUIDADO · gastos Q${decimal(gastosCent)} · reintegro Q${decimal(reintegroCent)} · firma ${resultadoFirma.codigoFirma}`,
    });

    await conn.commit();
    committed = true;
    return { ok: true, firma: resultadoFirma };
  } finally {
    if (conn) {
      if (!committed) {
        try {
          await conn.rollback();
        } catch {
          // best-effort — nunca oculta el error/rechazo real que ya se está propagando.
        }
      }
      conn.release();
    }
    if (!committed) {
      compensarImagenFirma(imagenGuardada);
    }
  }
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
  // VIATICOS-FIRMA — liquidación estructurada.
  gastosComprobados: number | null;
  reintegro: number | null;
  /** Derivada, nunca persistida: montoAsignado - gastosComprobados - reintegro. null mientras no está LIQUIDADO. */
  diferencia: number | null;
  // VIATICOS-RECHAZADO-1 — null mientras el viático no está RECHAZADO.
  rechazadoPor: string | null;
  rechazadoEn: string | null;
  motivoRechazo: string | null;
};

function mapDetalle(r: RowDataPacket): ViaticoDetalle {
  const gastosComprobados = r.gastos_comprobados != null ? Number(r.gastos_comprobados) : null;
  const reintegro = r.reintegro != null ? Number(r.reintegro) : null;
  // Diferencia mostrada: misma aritmética EXACTA en centavos que la
  // decisión de liquidarViatico() (nunca resta directa de floats), aunque
  // aquí sea solo lectura — un viático LIQUIDADO siempre debería dar 0.00
  // exacto por construcción, esto evita cualquier artefacto de float al
  // formatear.
  const diferencia = gastosComprobados != null && reintegro != null
    ? Number(decimal(
        centavos(String(r.monto_asignado ?? 0)) - centavos(String(r.gastos_comprobados)) - centavos(String(r.reintegro)),
      ))
    : null;
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
    gastosComprobados,
    reintegro,
    diferencia,
    rechazadoPor: r.rechazado_por != null ? String(r.rechazado_por) : null,
    rechazadoEn: r.rechazado_en != null ? String(r.rechazado_en) : null,
    motivoRechazo: r.motivo_rechazo != null ? String(r.motivo_rechazo) : null,
  };
}

const DETALLE_SELECT = `
  SELECT v.id, v.plan_id, v.personal_id, v.rol, v.monto_sugerido, v.monto_asignado,
         v.motivo_cambio, v.modificado_por, v.estado, v.metodo_pago, v.creado_en, v.actualizado_en,
         v.autorizado_por, v.autorizado_en, v.entregado_por, v.entregado_en,
         v.referencia_pago, v.observaciones_entrega,
         v.liquidado_por, v.liquidado_en, v.observaciones_liquidacion,
         v.gastos_comprobados, v.reintegro,
         v.rechazado_por, v.rechazado_en, v.motivo_rechazo,
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
  rechazados: number;
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
    rechazados: 0,
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
      case "RECHAZADO":
        resumen.rechazados = total;
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
  /** Cuenta VIVA de la ficha del empleado — puede haber cambiado desde que se pagó. Nunca usar esto para mostrar "qué cuenta se usó" en un viático ya ENTREGADO/LIQUIDADO: usar los campos *Mostrar de abajo. */
  banco: string | null;
  tipoCuenta: string | null;
  cuentaBancaria: string | null;
  // VIATICOS-PAGO-SNAPSHOT-1 — snapshot congelado en tms_viaticos al
  // pasar AUTORIZADO -> ENTREGADO por TRANSFERENCIA (null para CHEQUE/
  // EFECTIVO y para pagos anteriores a esta funcionalidad).
  pagoBanco: string | null;
  pagoCuentaBancaria: string | null;
  pagoTipoCuenta: string | null;
  /**
   * Campos DERIVADOS (ver derivarCuentaMostrable) — lo que la UI/Excel
   * deben mostrar: cuenta viva mientras AUTORIZADO (o para CHEQUE/
   * EFECTIVO en cualquier estado), snapshot para ENTREGADO/LIQUIDADO por
   * TRANSFERENCIA. Nunca null como fallback silencioso a la cuenta viva
   * — ver `cuentaHistoricaNoDisponible`.
   */
  bancoMostrar: string | null;
  cuentaBancariaMostrar: string | null;
  tipoCuentaMostrar: string | null;
  /** true SOLO cuando el viático ya se pagó por TRANSFERENCIA pero es anterior a esta funcionalidad (snapshot NULL) — la UI debe mostrar "no disponible", NUNCA la cuenta viva como sustituto. */
  cuentaHistoricaNoDisponible: boolean;
};

export type FiltrosViaticosPorPagar = {
  planId?: number;
  fechaDesde?: string;
  fechaHasta?: string;
  empleadoNombre?: string;
  estado?: EstadoViatico;
};

/**
 * VIATICOS-PAGO-SNAPSHOT-1 — regla CENTRALIZADA y testeable de qué
 * cuenta mostrar: mientras el viático sigue AUTORIZADO (o para CHEQUE/
 * EFECTIVO en cualquier estado, que nunca usan snapshot), se muestra la
 * cuenta VIVA de la ficha del empleado, igual que siempre. Una vez
 * ENTREGADO/LIQUIDADO por TRANSFERENCIA, se muestra el snapshot
 * congelado — NUNCA la cuenta viva (podría ya no ser la que se usó). Si
 * el snapshot es null (pago anterior a esta funcionalidad), NUNCA cae a
 * la cuenta viva como sustituto: se marca `cuentaHistoricaNoDisponible`
 * y los 3 campos *Mostrar quedan en null.
 */
export function derivarCuentaMostrable(input: {
  estado: string;
  metodoPago: string | null;
  banco: string | null;
  cuentaBancaria: string | null;
  tipoCuenta: string | null;
  pagoBanco: string | null;
  pagoCuentaBancaria: string | null;
  pagoTipoCuenta: string | null;
}): { bancoMostrar: string | null; cuentaBancariaMostrar: string | null; tipoCuentaMostrar: string | null; cuentaHistoricaNoDisponible: boolean } {
  const yaPagado = input.estado === "ENTREGADO" || input.estado === "LIQUIDADO";
  if (yaPagado && input.metodoPago === "TRANSFERENCIA") {
    if (input.pagoCuentaBancaria != null) {
      return {
        bancoMostrar: input.pagoBanco,
        cuentaBancariaMostrar: input.pagoCuentaBancaria,
        tipoCuentaMostrar: input.pagoTipoCuenta,
        cuentaHistoricaNoDisponible: false,
      };
    }
    return { bancoMostrar: null, cuentaBancariaMostrar: null, tipoCuentaMostrar: null, cuentaHistoricaNoDisponible: true };
  }
  return {
    bancoMostrar: input.banco,
    cuentaBancariaMostrar: input.cuentaBancaria,
    tipoCuentaMostrar: input.tipoCuenta,
    cuentaHistoricaNoDisponible: false,
  };
}

function mapPorPagar(r: RowDataPacket): ViaticoPorPagar {
  const estado = String(r.estado ?? "PROGRAMADO") as EstadoViatico;
  const metodoPago = r.metodo_pago != null ? String(r.metodo_pago) : null;
  const banco = r.banco != null ? String(r.banco) : null;
  const tipoCuenta = r.tipo_cuenta != null ? String(r.tipo_cuenta) : null;
  const cuentaBancaria = r.cuenta_bancaria != null ? String(r.cuenta_bancaria) : null;
  const pagoBanco = r.pago_banco != null ? String(r.pago_banco) : null;
  const pagoCuentaBancaria = r.pago_cuenta_bancaria != null ? String(r.pago_cuenta_bancaria) : null;
  const pagoTipoCuenta = r.pago_tipo_cuenta != null ? String(r.pago_tipo_cuenta) : null;
  const mostrable = derivarCuentaMostrable({
    estado, metodoPago, banco, cuentaBancaria, tipoCuenta, pagoBanco, pagoCuentaBancaria, pagoTipoCuenta,
  });
  return {
    id: Number(r.id),
    planId: Number(r.plan_id),
    planCodigo: String(r.plan_codigo ?? ""),
    fechaPlan: r.fecha_plan != null ? String(r.fecha_plan).slice(0, 10) : "",
    personalCodigo: r.personal_codigo != null ? String(r.personal_codigo) : null,
    personalNombre: String(r.personal_nombre ?? ""),
    rol: String(r.rol),
    montoAsignado: Number(r.monto_asignado ?? 0),
    estado,
    metodoPago,
    referenciaPago: r.referencia_pago != null ? String(r.referencia_pago) : null,
    banco,
    tipoCuenta,
    cuentaBancaria,
    pagoBanco,
    pagoCuentaBancaria,
    pagoTipoCuenta,
    ...mostrable,
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
  // VIATICOS-RECHAZADO-1 (sección 12, "no confiar únicamente en UI") —
  // RECHAZADO NUNCA debe aparecer en la bandeja del Facturador, ni
  // siquiera con el filtro "Todos" (filtros.estado ausente). Exclusión
  // INCONDICIONAL, no depende de `filtros.estado`: aunque alguien pasara
  // `estado: "RECHAZADO"` explícitamente, la condición de abajo lo
  // combina con AND y el resultado sigue siendo vacío — nunca se
  // devuelve, nunca es seleccionable ni exportable.
  const condiciones: string[] = ["v.empresa_id = ?", "v.estado != 'RECHAZADO'"];
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
            v.rol, v.pago_banco, v.pago_cuenta_bancaria, v.pago_tipo_cuenta,
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
