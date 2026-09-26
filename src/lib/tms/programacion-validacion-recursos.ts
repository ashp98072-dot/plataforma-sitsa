import type { RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { execute, query } from "@/lib/db";
import { esTc } from "@/lib/flota/tipo-unidad";
import { personalDesdeEmpleado, validarPersonalId } from "./personal-resolucion";
import { resolverTcInterno } from "./tc-plan";
import { MSG_EXTRA_INVALIDO, MSG_PERSONA_DUPLICADA, hayPersonaDuplicada } from "./piloto-extra";

/**
 * PROGRAMACIÓN — EDICIÓN RÁPIDA, PR-0. Validaciones de recursos de un viaje EXTRAÍDAS de PATCH /tms/planes
 * (planes/route.ts) SIN CAMBIO FUNCIONAL: mismos mensajes, mismos códigos HTTP, mismo orden de evaluación.
 * Existen para que la futura edición rápida (validar/guardar por lote) reutilice EXACTAMENTE estas reglas.
 *
 * Se dividieron en helpers pequeños según su naturaleza:
 *  - puras (sin BD): estado editable, motivo, fecha pasada, cambios reales, evaluación de disponibilidad;
 *  - lectura de BD: viáticos que impiden quitar personal;
 *  - resolución de personal: modo "escritura" (idéntico al PATCH actual: puede crear filas en tms_personal) y modo
 *    "lectura" (SIN efectos secundarios: nunca inserta ni actualiza; informa lo que habría que crear).
 *
 * Ningún helper aplica política de traslapes (día/intervalo): eso lo hace el motor de disponibilidad bajo el candado.
 */
export type ErrorValidacion = { status: number; error: string };
export type AdvertenciaRecurso = { tipo: string; mensaje: string };

// ------------------------------------------------------------------------------------ estado editable
/** "En ruta" admite solo notas (salvo pendiente de cierre); "Cerrado"/"Cancelado" bloquean toda edición. */
export const ESTADOS_SOLO_NOTAS = new Set(["En ruta"]);
export const ESTADOS_BLOQUEADOS = new Set(["Cerrado", "Cancelado"]);

/** Campos que la solicitud "toca" (presencia en el request, no comparación con el valor anterior). */
export type CamposTocados = {
  piloto: boolean;
  /** Piloto EXTRA (asignar, cambiar o quitar): cambio sensible igual que piloto/auxiliares/unidad. */
  pilotoExtra: boolean;
  auxiliares: boolean;
  unidad: boolean;
  fecha: boolean;
  paradas: boolean;
  hora: boolean;
  comercial: boolean;
};

export type EntradaCamposTocados = {
  pilotoNombre?: string | null;
  pilotoPersonalId?: number | null;
  /** undefined = no se toca; null = quitar el piloto extra; número = asignarlo/cambiarlo. */
  pilotoExtraEmpleadoId?: number | null;
  pilotoExtraPersonalId?: number | null;
  auxiliarEmpleadoIds?: unknown[] | null;
  auxiliarNombres?: unknown[] | null;
  auxiliarNombre?: string | null;
  auxiliarPersonalIds?: unknown[] | null;
  placa?: string | null;
  flotaVehiculoId?: number | null;
  fechaPlan?: string | null;
  paradas?: unknown[] | null;
  horaCarga?: string | null;
  regresoEstimado?: unknown;
  tarifaComercial?: unknown;
  tarifaId?: unknown;
  costoOperativoReferencia?: unknown;
  referenciaCliente?: unknown;
  /** Tipo de traslado (dato comercial descriptivo). */
  tipoTraslado?: unknown;
};

export function camposTocados(d: EntradaCamposTocados): CamposTocados {
  return {
    piloto: d.pilotoNombre != null || d.pilotoPersonalId != null,
    pilotoExtra: d.pilotoExtraEmpleadoId !== undefined || d.pilotoExtraPersonalId !== undefined,
    auxiliares: d.auxiliarEmpleadoIds != null || d.auxiliarNombres != null || d.auxiliarNombre != null || d.auxiliarPersonalIds != null,
    unidad: d.placa != null || d.flotaVehiculoId != null,
    fecha: d.fechaPlan != null,
    paradas: d.paradas != null,
    hora: d.horaCarga != null,
    comercial:
      d.regresoEstimado !== undefined ||
      d.tarifaComercial !== undefined ||
      d.tarifaId !== undefined ||
      d.costoOperativoReferencia !== undefined ||
      d.referenciaCliente !== undefined ||
      d.tipoTraslado !== undefined,
  };
}

/** OPS-AJUSTES: piloto, unidad y auxiliares exigen motivo (por presencia en el request). */
export function validarMotivoCambioRecursos(toca: CamposTocados, motivoCambio: string | undefined): ErrorValidacion | null {
  if ((toca.piloto || toca.pilotoExtra || toca.unidad || toca.auxiliares) && !motivoCambio?.trim()) {
    return { status: 400, error: "Indica el motivo del cambio de piloto, unidad o auxiliares." };
  }
  return null;
}

/** Reglas por estado del plan (Cerrado/Cancelado, En ruta con y sin llegada registrada). */
export function validarEstadoEditable(
  plan: { estado: string; pendienteCierre: boolean },
  toca: CamposTocados,
): ErrorValidacion | null {
  if (ESTADOS_BLOQUEADOS.has(plan.estado)) {
    return { status: 409, error: `Este plan está en estado "${plan.estado}" y ya no admite modificaciones desde Programación.` };
  }
  if (ESTADOS_SOLO_NOTAS.has(plan.estado) && !plan.pendienteCierre) {
    const camposNoPermitidos: string[] = [];
    if (toca.piloto) camposNoPermitidos.push("piloto");
    if (toca.pilotoExtra) camposNoPermitidos.push("piloto extra");
    if (toca.auxiliares) camposNoPermitidos.push("auxiliares");
    if (toca.unidad) camposNoPermitidos.push("unidad");
    if (toca.fecha) camposNoPermitidos.push("fecha");
    if (toca.paradas) camposNoPermitidos.push("paradas");
    if (toca.hora) camposNoPermitidos.push("hora de carga");
    if (toca.comercial) camposNoPermitidos.push("datos comerciales/regreso estimado");
    if (camposNoPermitidos.length) {
      return {
        status: 409,
        error: `El plan está "${plan.estado}"; solo se pueden editar notas mientras está en ruta (no permitido: ${camposNoPermitidos.join(", ")}).`,
      };
    }
  } else if (ESTADOS_SOLO_NOTAS.has(plan.estado) && plan.pendienteCierre) {
    const camposNoPermitidos: string[] = [];
    if (toca.fecha) camposNoPermitidos.push("fecha");
    if (toca.hora) camposNoPermitidos.push("hora de carga");
    if (camposNoPermitidos.length) {
      return {
        status: 409,
        error: `El plan está "${plan.estado}" (pendiente de cierre); no se puede modificar: ${camposNoPermitidos.join(", ")}. Antes del cierre solo se pueden corregir notas, tarifa comercial, referencia de cliente, regreso estimado, ruta/contacto, piloto, unidad, auxiliares y paradas.`,
      };
    }
  }
  return null;
}

/** Un viaje con fecha efectiva anterior a hoy (Guatemala) no se edita ni se reprograma hacia el pasado. */
export function validarFechaNoPasada(fechaEfectiva: string | null | undefined, hoy: string): ErrorValidacion | null {
  if (fechaEfectiva && fechaEfectiva < hoy) {
    return { status: 400, error: "No se puede reprogramar un viaje hacia una fecha pasada." };
  }
  return null;
}

/** `regresoEstimado` (YYYY-MM-DDTHH:mm) debe ser posterior a la salida programada. */
export function validarRegresoPosteriorASalida(
  regresoEstimado: string | null | undefined,
  fechaEfectiva: string,
  horaEfectiva: string | null | undefined,
): ErrorValidacion | null {
  if (!regresoEstimado) return null;
  const salidaProgramada = `${fechaEfectiva}T${((horaEfectiva ?? "") || "00:00").slice(0, 5)}`;
  if (regresoEstimado <= salidaProgramada) {
    return { status: 400, error: "El regreso estimado debe ser posterior a la salida programada." };
  }
  return null;
}

// ------------------------------------------------------------------------------------ TC
export type ResultadoCambioTc =
  | { ok: false; status: number; error: string }
  | {
      ok: true;
      escribirTcInterno: boolean;
      tcVehiculoIdNuevo: number | null;
      tcPlacaNueva: string | null;
      escribirTcExterno: boolean;
      tcExternoNuevo: string | null;
      /** TC interno efectivo del viaje tras el cambio (null en tercerizados). */
      tcEfectivo: number | null;
    };

/**
 * TC del viaje. Tercerizado: solo `tcExternoPlaca` (texto), un TC interno se rechaza. Propio: un TC DISTINTO al
 * actual se valida en servidor (acceso + clasificación + activo/taller); el mismo TC no se re-valida.
 */
export async function resolverCambioTc(
  empresaId: number,
  plan: { tipoViaje: string; tcVehiculoId: number | null },
  solicitud: { tcVehiculoId?: number | null; tcExternoPlaca?: string | null },
): Promise<ResultadoCambioTc> {
  const planEsTercerizado = plan.tipoViaje === "Tercerizado";
  if (planEsTercerizado && solicitud.tcVehiculoId != null) {
    return { ok: false, status: 400, error: "Un viaje tercerizado no usa TC interno: captura el TC externo como texto." };
  }
  const escribirTcInterno =
    !planEsTercerizado && solicitud.tcVehiculoId !== undefined && (solicitud.tcVehiculoId === null || solicitud.tcVehiculoId !== plan.tcVehiculoId);
  let tcVehiculoIdNuevo: number | null = null;
  let tcPlacaNueva: string | null = null;
  if (escribirTcInterno && solicitud.tcVehiculoId != null) {
    const tc = await resolverTcInterno(empresaId, solicitud.tcVehiculoId);
    if (!tc.ok) return { ok: false, status: tc.status, error: tc.error };
    tcVehiculoIdNuevo = tc.vehiculoId;
    tcPlacaNueva = tc.placa;
  }
  const escribirTcExterno = planEsTercerizado && solicitud.tcExternoPlaca !== undefined;
  const tcExternoNuevo = escribirTcExterno ? ((solicitud.tcExternoPlaca ?? "").trim().toUpperCase() || null) : null;
  const tcEfectivo: number | null = planEsTercerizado ? null : escribirTcInterno ? tcVehiculoIdNuevo : plan.tcVehiculoId;
  return { ok: true, escribirTcInterno, tcVehiculoIdNuevo, tcPlacaNueva, escribirTcExterno, tcExternoNuevo, tcEfectivo };
}

// ------------------------------------------------------------------------------------ resolución de personal
export type EntradaPersonal = {
  pilotoNombre?: string;
  pilotoPersonalId?: number;
  auxiliarEmpleadoIds?: number[];
  auxiliarNombres?: string[];
  auxiliarNombre?: string;
  auxiliarPersonalIds?: number[];
  /** Piloto EXTRA por empleado de RRHH (nunca texto libre). undefined = no se toca; null = quitarlo. */
  pilotoExtraEmpleadoId?: number | null;
  /** Piloto extra por tms_personal.id exacto (edición rápida). undefined = no se toca; null = quitarlo. */
  pilotoExtraPersonalId?: number | null;
};

/** Personal que, en modo "escritura", se habría CREADO en tms_personal (informativo en modo "lectura"). */
export type PersonalPorCrear = { tipo: "Piloto" | "Auxiliar"; nombre?: string; empleadoId?: number };

export type ResultadoSeleccionPersonal =
  | { ok: false; status: number; error: string }
  | {
      ok: true;
      /** Piloto resuelto (undefined = la solicitud no lo toca o no pudo resolverse en modo lectura). */
      pilotoId: number | undefined;
      /** Piloto extra resuelto: undefined = no se toca; null = quitarlo; número = tms_personal.id. */
      pilotoExtraId?: number | null;
      /** Auxiliar principal (primero de la lista); undefined = no se tocan los auxiliares. */
      auxiliarId: number | null | undefined;
      /** Lista de auxiliares resuelta por empleado/nombre (campos legado). */
      auxPersonalIdsLegado: number[] | undefined;
      /** Lista de auxiliares resuelta por `auxiliarPersonalIds` (ids exactos, validados). */
      auxPersonalIdsNuevo: number[] | undefined;
      /** Solo modo "lectura": lo que faltaría materializar. En "escritura" siempre vacío (ya se creó). */
      porCrear: PersonalPorCrear[];
    };

type ModoPersonal = "escritura" | "lectura";

async function buscarPorNombre(empresaId: number, tipo: "Piloto" | "Auxiliar", nombre: string): Promise<number | null> {
  const rows = await query<RowDataPacket[]>(
    `SELECT id FROM tms_personal
       WHERE empresa_id = ? AND tipo = '${tipo}' AND LOWER(TRIM(nombre)) = LOWER(?)
       LIMIT 1`,
    [empresaId, nombre],
  );
  return rows[0] ? Number(rows[0].id) : null;
}

/**
 * Equivalente de SOLO LECTURA de `personalDesdeEmpleado`: mismas comprobaciones (empleado activo de la empresa,
 * `tms_personal` por código+tipo) pero sin INSERT/UPDATE. `null` = empleado inexistente/inactivo; `{ existe:false }` =
 * habría que crear la fila.
 */
export async function personalExistenteDesdeEmpleado(
  empresaId: number,
  empleadoId: number,
  tipo: "Piloto" | "Auxiliar",
  conn?: PoolConnection,
): Promise<{ existe: true; id: number } | { existe: false } | null> {
  const run = async (sql: string, params: unknown[]) =>
    conn ? (await conn.query<RowDataPacket[]>(sql, params))[0] : query<RowDataPacket[]>(sql, params as never);
  const emp = await run(`SELECT id, codigo, nombre FROM empleados WHERE id = ? AND empresa_id = ? AND estado = 'Activo' LIMIT 1`, [empleadoId, empresaId]);
  if (!emp[0]) return null;
  const existing = await run(`SELECT id FROM tms_personal WHERE empresa_id = ? AND codigo = ? AND tipo = ? LIMIT 1`, [empresaId, String(emp[0].codigo), tipo]);
  return existing[0] ? { existe: true, id: Number(existing[0].id) } : { existe: false };
}

/**
 * Resuelve piloto y auxiliares de una solicitud de PATCH.
 *  - "escritura": comportamiento IDÉNTICO al PATCH previo (por nombre o empleado puede INSERTAR en tms_personal
 *    fuera de la transacción de guardado, mismas consultas y mismo orden).
 *  - "lectura": nunca inserta ni actualiza; lo que faltaría crear se informa en `porCrear`.
 * Los campos por id exacto (`pilotoPersonalId`/`auxiliarPersonalIds`) solo validan (no crean) en ambos modos.
 */
export async function resolverSeleccionPersonal(
  empresaId: number,
  d: EntradaPersonal,
  modo: ModoPersonal = "escritura",
): Promise<ResultadoSeleccionPersonal> {
  const porCrear: PersonalPorCrear[] = [];
  let pilotoId: number | undefined;

  if (d.pilotoNombre?.trim()) {
    const nombre = d.pilotoNombre.trim();
    const existente = await buscarPorNombre(empresaId, "Piloto", nombre);
    if (existente != null) {
      pilotoId = existente;
    } else if (modo === "escritura") {
      const r = await execute("INSERT INTO tms_personal (empresa_id, nombre, tipo) VALUES (?, ?, 'Piloto')", [empresaId, nombre]);
      pilotoId = Number(r.insertId);
    } else {
      porCrear.push({ tipo: "Piloto", nombre });
    }
  }

  // Campo por ID (Fase P5.1a): se evalúa DESPUÉS del bloque por nombre; el id validado tiene precedencia.
  if (d.pilotoPersonalId != null) {
    const piloto = await validarPersonalId(empresaId, d.pilotoPersonalId, "Piloto");
    if (!piloto) {
      return { ok: false, status: 400, error: "El piloto seleccionado no existe o no pertenece a esta empresa." };
    }
    pilotoId = piloto.id;
  }

  let auxiliarId: number | null | undefined;
  let auxPersonalIdsLegado: number[] | undefined;
  const actualizarAux = d.auxiliarEmpleadoIds != null || d.auxiliarNombres != null || d.auxiliarNombre != null;
  if (actualizarAux) {
    const auxPersonalIds: number[] = [];
    for (const eid of (d.auxiliarEmpleadoIds ?? []).slice(0, 8)) {
      if (modo === "escritura") {
        const pid = await personalDesdeEmpleado(empresaId, eid, "Auxiliar");
        if (pid) auxPersonalIds.push(pid);
      } else {
        const r = await personalExistenteDesdeEmpleado(empresaId, eid, "Auxiliar");
        if (r?.existe) auxPersonalIds.push(r.id);
        else if (r) porCrear.push({ tipo: "Auxiliar", empleadoId: eid });
      }
    }
    const nombresAux = [...(d.auxiliarNombres ?? []), ...(d.auxiliarNombre?.trim() ? [d.auxiliarNombre.trim()] : [])];
    for (const nom of nombresAux) {
      if (auxPersonalIds.length >= 8) break;
      const nombre = nom.trim();
      if (nombre.length < 2) continue;
      const existente = await buscarPorNombre(empresaId, "Auxiliar", nombre);
      if (existente != null) {
        if (!auxPersonalIds.includes(existente)) auxPersonalIds.push(existente);
        continue;
      }
      if (modo === "escritura") {
        const r = await execute("INSERT INTO tms_personal (empresa_id, nombre, tipo) VALUES (?, ?, 'Auxiliar')", [empresaId, nombre]);
        auxPersonalIds.push(Number(r.insertId));
      } else {
        porCrear.push({ tipo: "Auxiliar", nombre });
      }
    }
    auxiliarId = auxPersonalIds[0] ?? null;
    auxPersonalIdsLegado = auxPersonalIds;
  }

  let auxPersonalIdsNuevo: number[] | undefined;
  if (d.auxiliarPersonalIds != null) {
    const auxIds: number[] = [];
    for (const pid of d.auxiliarPersonalIds.slice(0, 8)) {
      const aux = await validarPersonalId(empresaId, pid, "Auxiliar");
      if (!aux) {
        return { ok: false, status: 400, error: `Un auxiliar seleccionado no existe o no pertenece a esta empresa (id ${pid}).` };
      }
      if (!auxIds.includes(aux.id)) auxIds.push(aux.id);
    }
    auxiliarId = auxIds[0] ?? null;
    auxPersonalIdsNuevo = auxIds;
  }

  // PILOTO EXTRA — solo de RRHH (empleado activo con puesto de piloto) o por id exacto de tms_personal tipo Piloto; nunca texto libre.
  let pilotoExtraId: number | null | undefined;
  if (d.pilotoExtraPersonalId !== undefined || d.pilotoExtraEmpleadoId !== undefined) {
    if (d.pilotoExtraPersonalId === null || (d.pilotoExtraPersonalId === undefined && d.pilotoExtraEmpleadoId === null)) {
      pilotoExtraId = null; // quitarlo
    } else if (d.pilotoExtraPersonalId != null) {
      const extra = await validarPersonalId(empresaId, d.pilotoExtraPersonalId, "Piloto");
      if (!extra) return { ok: false, status: 400, error: MSG_EXTRA_INVALIDO };
      pilotoExtraId = extra.id;
    } else if (d.pilotoExtraEmpleadoId != null) {
      const emp = await query<RowDataPacket[]>(
        `SELECT id FROM empleados
         WHERE id = ? AND empresa_id = ? AND estado = 'Activo'
           AND (categoria_ops = 'Piloto' OR LOWER(COALESCE(puesto, '')) LIKE '%piloto%' OR LOWER(COALESCE(categoria_ops, '')) LIKE '%piloto%')
         LIMIT 1`,
        [d.pilotoExtraEmpleadoId, empresaId],
      );
      if (!emp[0]) return { ok: false, status: 400, error: MSG_EXTRA_INVALIDO };
      if (modo === "escritura") {
        const pid = await personalDesdeEmpleado(empresaId, d.pilotoExtraEmpleadoId, "Piloto");
        if (!pid) return { ok: false, status: 400, error: MSG_EXTRA_INVALIDO };
        pilotoExtraId = pid;
      } else {
        const r = await personalExistenteDesdeEmpleado(empresaId, d.pilotoExtraEmpleadoId, "Piloto");
        if (r?.existe) pilotoExtraId = r.id;
        else if (r) porCrear.push({ tipo: "Piloto", empleadoId: d.pilotoExtraEmpleadoId });
      }
    }
  }
  // Una persona no puede estar dos veces en el mismo viaje (principal, extra y auxiliares): se valida en cuanto se conocen los ids
  // enviados. La validación contra lo YA guardado (p. ej. extra nuevo == auxiliar actual) la hace el llamador con `hayPersonaDuplicada`.
  const auxEnviados = auxPersonalIdsNuevo ?? auxPersonalIdsLegado ?? [];
  if (hayPersonaDuplicada(pilotoId, pilotoExtraId ?? null, auxEnviados)) {
    return { ok: false, status: 400, error: MSG_PERSONA_DUPLICADA };
  }

  return { ok: true, pilotoId, pilotoExtraId, auxiliarId, auxPersonalIdsLegado, auxPersonalIdsNuevo, porCrear };
}

// ------------------------------------------------------------------------------------ cambios reales
export type AsignacionPlan = {
  pilotoId: number | null;
  /** Piloto extra actual (tms_personal.id) o null/undefined si no tiene. */
  pilotoExtraId?: number | null;
  auxiliaresIds: number[];
  unidadFlotaId: number | null;
};

export type CambiosRecursos = {
  pilotoFinal: number | null;
  pilotoCambioReal: boolean;
  /** Piloto extra tras el cambio (null = sin extra). */
  pilotoExtraFinal: number | null;
  pilotoExtraCambioReal: boolean;
  /** El piloto extra a revalidar en disponibilidad: el nuevo si cambia, o el actual si cambia la fecha. */
  pilotoExtraIdParaValidar: number | null;
  auxiliaresFinal: number[];
  auxiliaresCambioReal: boolean;
  unidadFinalId: number | null;
  unidadCambioReal: boolean;
  /** Recursos a revalidar en disponibilidad: los que cambian de verdad, o todos los ya asignados si cambia la fecha. */
  pilotoIdParaValidar: number | null;
  auxiliaresIdsParaValidar: number[];
  vehiculoIdParaValidar: number | null;
};

/** Qué recursos cambian de verdad y cuáles hay que revalidar (pura). */
export function calcularCambiosRecursos(
  antes: AsignacionPlan,
  final: { pilotoId: number | undefined; pilotoExtraId?: number | null | undefined; auxiliaresIds: number[] | undefined; unidadFlotaId: number | null },
  fechaCambia: boolean,
): CambiosRecursos {
  const pilotoFinal = final.pilotoId !== undefined ? final.pilotoId : antes.pilotoId;
  const pilotoCambioReal = pilotoFinal !== antes.pilotoId;
  const pilotoExtraAntes = antes.pilotoExtraId ?? null;
  const pilotoExtraFinal = final.pilotoExtraId !== undefined ? final.pilotoExtraId : pilotoExtraAntes;
  const pilotoExtraCambioReal = pilotoExtraFinal !== pilotoExtraAntes;
  const auxiliaresFinal = final.auxiliaresIds ?? antes.auxiliaresIds;
  const auxiliaresCambioReal = (() => {
    const finalSet = new Set(auxiliaresFinal);
    const antesSet = new Set(antes.auxiliaresIds);
    if (finalSet.size !== antesSet.size) return true;
    for (const id of finalSet) if (!antesSet.has(id)) return true;
    return false;
  })();
  const unidadFinalId = final.unidadFlotaId;
  const unidadCambioReal = unidadFinalId !== (antes.unidadFlotaId ?? null);
  return {
    pilotoFinal,
    pilotoCambioReal,
    pilotoExtraFinal,
    pilotoExtraCambioReal,
    pilotoExtraIdParaValidar: pilotoExtraCambioReal ? pilotoExtraFinal : fechaCambia && pilotoExtraAntes != null ? pilotoExtraAntes : null,
    auxiliaresFinal,
    auxiliaresCambioReal,
    unidadFinalId,
    unidadCambioReal,
    pilotoIdParaValidar: pilotoCambioReal ? pilotoFinal : fechaCambia && antes.pilotoId != null ? antes.pilotoId : null,
    auxiliaresIdsParaValidar: auxiliaresCambioReal ? auxiliaresFinal : fechaCambia ? antes.auxiliaresIds : [],
    vehiculoIdParaValidar: unidadCambioReal ? unidadFinalId : fechaCambia && antes.unidadFlotaId != null ? antes.unidadFlotaId : null,
  };
}

// ------------------------------------------------------------------------------------ viáticos que impiden quitar personal
export type PersonalQueSale = { personalId: number; nombre: string };

/** Quienes dejan el viaje: el piloto anterior si cambia, el piloto extra anterior si ya no está y los auxiliares anteriores que ya no están. */
export function personalQueSale(
  antes: { pilotoId: number | null; piloto: string; pilotoExtraId?: number | null; pilotoExtraNombre?: string; auxiliaresIds: number[]; auxiliaresNombres: string[] },
  final: { pilotoId: number | null; pilotoExtraId?: number | null; auxiliaresIds: number[] },
): PersonalQueSale[] {
  const removidos: PersonalQueSale[] = [];
  // (El principal que pasa a ser el piloto EXTRA sigue en el viaje: no sale.)
  if (antes.pilotoId != null && antes.pilotoId !== final.pilotoId && antes.pilotoId !== (final.pilotoExtraId ?? null)) {
    removidos.push({ personalId: antes.pilotoId, nombre: antes.piloto || `Piloto #${antes.pilotoId}` });
  }
  // Piloto extra: sale si ya no es el extra NI pasa a ser el principal ni auxiliar (quien solo cambia de rol dentro del viaje conserva su viatico).
  if (
    antes.pilotoExtraId != null &&
    antes.pilotoExtraId !== (final.pilotoExtraId ?? null) &&
    antes.pilotoExtraId !== final.pilotoId &&
    !final.auxiliaresIds.includes(antes.pilotoExtraId)
  ) {
    removidos.push({ personalId: antes.pilotoExtraId, nombre: antes.pilotoExtraNombre || `Piloto extra #${antes.pilotoExtraId}` });
  }
  antes.auxiliaresIds.forEach((id, i) => {
    if (!final.auxiliaresIds.includes(id) && id !== (final.pilotoExtraId ?? null)) {
      removidos.push({ personalId: id, nombre: antes.auxiliaresNombres[i] || `Auxiliar #${id}` });
    }
  });
  return removidos;
}

/**
 * Un viático ya AUTORIZADO/ENTREGADO/LIQUIDADO es información financiera procesada: quitar a esa persona del viaje
 * se rechaza (409). Solo lectura de BD; se evalúa antes de cualquier escritura.
 */
export async function validarRemocionConViaticos(planId: number, removidos: PersonalQueSale[]): Promise<ErrorValidacion | null> {
  if (!removidos.length) return null;
  const viaticosRemovidos = await query<RowDataPacket[]>(
    `SELECT personal_id, estado FROM tms_viaticos
         WHERE plan_id = ? AND personal_id IN (${removidos.map(() => "?").join(",")}) AND estado != 'PROGRAMADO'`,
    [planId, ...removidos.map((r) => r.personalId)],
  );
  if (!viaticosRemovidos.length) return null;
  const estadoPorPersonal = new Map(viaticosRemovidos.map((r) => [Number(r.personal_id), String(r.estado)]));
  const bloqueados = removidos.filter((r) => estadoPorPersonal.has(r.personalId));
  const detalle = bloqueados.map((b) => `${b.nombre} (viático ${estadoPorPersonal.get(b.personalId)!.toLowerCase()})`).join(", ");
  return {
    status: 409,
    error:
      bloqueados.length === 1
        ? `No se puede quitar a ${bloqueados[0].nombre} del viaje porque su viático ya fue ${estadoPorPersonal.get(bloqueados[0].personalId)!.toLowerCase()}.`
        : `No se puede modificar el personal del viaje: ${detalle} — su(s) viático(s) ya fue(ron) procesado(s).`,
  };
}

// ------------------------------------------------------------------------------------ disponibilidad (evaluación pura)
export type RecursoPersonalValidar = { personalId: number; rol: "piloto" | "auxiliar" };

/** Forma mínima de `listarDisponibilidadPersonal` que consumen las reglas. */
export type DisponibilidadPersonalRegla = {
  personalId: number;
  nombre: string;
  incidenciasBloqueantes: { tipo: string; fechaInicio: string; fechaFin: string }[];
  viajeActual: unknown | null;
  estadoDisponibilidad: string;
  otrosPlanesDelDia: { planId: number; planCodigo: string }[];
  advertencias: { tipo: string; incidencia?: { tipo: string } }[];
};

export type ResultadoEvaluacion = { error: ErrorValidacion | null; advertencias: AdvertenciaRecurso[] };

/**
 * Personal (piloto/auxiliares) frente a la disponibilidad del día: incidencia bloqueante y viaje en curso HOY o
 * baja bloquean (409); el resto son advertencias. Devuelve el PRIMER bloqueo; las advertencias acumuladas hasta
 * ese punto no se usan (el PATCH responde el error).
 */
export function evaluarDisponibilidadPersonal(
  personalDisp: DisponibilidadPersonalRegla[],
  recursos: RecursoPersonalValidar[],
  contexto: { fechaEfectiva: string; esHoy: boolean; planId: number },
): ResultadoEvaluacion {
  const advertencias: AdvertenciaRecurso[] = [];
  const { fechaEfectiva, esHoy, planId } = contexto;
  for (const r of recursos) {
    const disp = personalDisp.find((p) => p.personalId === r.personalId);
    if (!disp) continue;
    const etiqueta = r.rol === "piloto" ? "El piloto seleccionado" : `El auxiliar ${disp.nombre}`;

    if (disp.incidenciasBloqueantes.length > 0) {
      const inc = disp.incidenciasBloqueantes[0];
      return { error: { status: 409, error: `${etiqueta} tiene una incidencia (${inc.tipo}) del ${inc.fechaInicio} al ${inc.fechaFin} que cubre el ${fechaEfectiva}.` }, advertencias };
    }
    if (disp.viajeActual != null) {
      if (esHoy) return { error: { status: 409, error: `${etiqueta} tiene un viaje en curso.` }, advertencias };
      advertencias.push({
        tipo: r.rol === "piloto" ? "viaje_actual_piloto" : "viaje_actual_auxiliar",
        mensaje: `${disp.nombre} está actualmente en ruta. Esto no impide su programación para el ${fechaEfectiva}.`,
      });
    } else if (disp.estadoDisponibilidad === "no_disponible") {
      return { error: { status: 409, error: `${etiqueta} no está activo o el empleado vinculado está de baja.` }, advertencias };
    }
    for (const otro of disp.otrosPlanesDelDia) {
      if (otro.planId === planId) continue; // nunca advertir contra el propio plan
      advertencias.push({
        tipo: r.rol === "piloto" ? "otro_plan_dia_piloto" : "otro_plan_dia_auxiliar",
        mensaje: `${disp.nombre} ya tiene otro plan el mismo día (${otro.planCodigo}).`,
      });
    }
    for (const a of disp.advertencias) {
      if (a.tipo === "incidencia_informativa") {
        advertencias.push({
          tipo: r.rol === "piloto" ? "incidencia_informativa_piloto" : "incidencia_informativa_auxiliar",
          mensaje: `${disp.nombre} tiene una incidencia informativa (${a.incidencia?.tipo}) el ${fechaEfectiva}.`,
        });
      }
    }
  }
  return { error: null, advertencias };
}

/** Forma mínima de un vehículo de `listarDisponibilidadVehiculos`. */
export type VehiculoDisponibilidadRegla = {
  id: number;
  placa: string;
  tipoUnidad?: string | null;
  estadoDisponibilidad: string;
  viajeAbierto?: { pilotoNombre: string } | null;
};

/** Unidad frente a su estado: TC como unidad y unidad inactiva bloquean; taller/en ruta bloquean solo HOY. */
export function evaluarDisponibilidadUnidad(
  vehiculos: VehiculoDisponibilidadRegla[],
  vehiculoId: number,
  unidadCambioReal: boolean,
  contexto: { fechaEfectiva: string; esHoy: boolean },
): ResultadoEvaluacion {
  const advertencias: AdvertenciaRecurso[] = [];
  const { fechaEfectiva, esHoy } = contexto;
  const v = vehiculos.find((x) => x.id === vehiculoId);
  if (!v) return { error: null, advertencias };
  if (unidadCambioReal && esTc(v.tipoUnidad ?? undefined)) {
    return { error: { status: 400, error: `La placa ${v.placa} está clasificada como TC: asígnala en el campo TC, no como Unidad.` }, advertencias };
  }
  if (v.estadoDisponibilidad === "inactivo") {
    return { error: { status: 409, error: "La unidad seleccionada está inactiva." }, advertencias };
  }
  if (v.estadoDisponibilidad === "en_taller") {
    if (esHoy) return { error: { status: 409, error: "La unidad seleccionada está actualmente en taller." }, advertencias };
    advertencias.push({
      tipo: "vehiculo_en_taller",
      mensaje: `La unidad ${v.placa} está actualmente en taller y no tiene fecha de salida registrada. Verifique su disponibilidad antes de confirmar.`,
    });
  } else if (v.estadoDisponibilidad === "en_ruta") {
    if (esHoy) {
      return {
        error: { status: 409, error: `La unidad seleccionada está actualmente en ruta${v.viajeAbierto ? ` con ${v.viajeAbierto.pilotoNombre}` : ""}.` },
        advertencias,
      };
    }
    advertencias.push({ tipo: "vehiculo_en_ruta", mensaje: `La unidad ${v.placa} está actualmente en ruta. Esto no impide su programación para el ${fechaEfectiva}.` });
  }
  return { error: null, advertencias };
}
