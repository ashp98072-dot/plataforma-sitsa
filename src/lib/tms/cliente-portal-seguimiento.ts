import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { toIsoDate } from "@/lib/rrhh/dates";
import { listarParadasDelPlan, type PlanParada } from "@/lib/tms/paradas";
import {
  listarSolicitudesCliente,
  obtenerSolicitudCliente,
  type SolicitudClienteDetalle,
} from "@/lib/tms/solicitudes-cliente";

/**
 * CLIENTE-PORTAL-4 — seguimiento de viajes + evidencias para el Portal
 * del Cliente. NO es una segunda fuente de verdad: todo se lee de las
 * mismas tablas que ya usa TMS/Programación/Portal del piloto.
 *
 * ============================================================
 * DISCOVERY (obligatorio antes de implementar — resumen; detalle
 * completo en docs/ no se generó aparte, se documenta aquí porque este
 * módulo ES el resultado de esa investigación):
 * ============================================================
 *
 * A) Estado real del viaje — tms_planes_viaje.estado (VARCHAR libre,
 *    sin ENUM, mismo criterio que el resto del proyecto). Máquina de
 *    estados real (comentario de sql/schema.sql, OPS-1):
 *      Programado -> En ruta -> Descargado (finalizado por el piloto,
 *      PENDIENTE DE CIERRE administrativo) -> Cerrado (cierre
 *      administrativo, permiso viajes_cerrar) — o Cancelado en
 *      cualquier punto anterior. "Cargado" es un estado adicional
 *      equivalente a "Programado" para fines de salida (ver
 *      buscarPlanesParaSalida/marcarPlanEnRuta).
 *
 * B) Registro del piloto — src/app/api/portal/viajes/route.ts:
 *      - accion "salida": crea flota_viajes (estado 'abierto'),
 *        vincula plan_id si hay match único, y llama
 *        marcarPlanEnRuta() -> tms_planes_viaje.estado = 'En ruta'.
 *      - Evidencias: POST /api/portal/viajes/[id]/evidencias — el
 *        piloto elige libremente tipo y (si es "producto") la parada
 *        exacta; YA NO hay orden obligatorio (PORTAL-HARDENING-2 Fase
 *        C) — ver docs/CLIENTE-PORTAL-0-DISCOVERY... para el detalle
 *        completo, reconfirmado aquí.
 *      - accion "llegada": solo registra km/hora en flota_viajes
 *        (estado 'cerrado') — es respaldo operativo, NUNCA cambia
 *        tms_planes_viaje.estado (comentario explícito en el propio
 *        código: "ya NO exige completar evidencias primero").
 *      - El cierre ADMINISTRATIVO (Descargado -> Cerrado) lo hace
 *        exclusivamente Operaciones desde Programación
 *        (src/lib/tms/cierre-viaje.ts) — no se toca aquí.
 *
 * C/D) Tablas de evidencias — AMBAS existen, con roles distintos:
 *      - `flota_viaje_evidencias` (empresa_id, viaje_id, tipo,
 *        ruta_relativa, nombre_original, mime, tamano, latitud,
 *        longitud, capturado_en, subido_por, creado_at, parada_id
 *        NULLABLE sin FK) — es la ÚNICA tabla donde el piloto SIEMPRE
 *        escribe al subir una foto (src/lib/flota/viaje-evidencias.ts,
 *        guardarEvidenciaViaje) — FUENTE VIGENTE/COMPLETA.
 *      - `tms_evidencias` (empresa_id, plan_id, tipo, ruta_archivo,
 *        nombre_original, latitud, longitud, subido_por, parada_id
 *        NULLABLE, capturado_en) — un ESPEJO best-effort de la misma
 *        subida, escrito SOLO si en ese momento el viaje YA estaba
 *        vinculado a un plan (planId conocido) — si el vínculo
 *        automático falla o llega después, esa evidencia queda SIN
 *        copiar aquí de forma permanente (no hay backfill retroactivo).
 *        Es decir: FUENTE LEGACY/PARCIAL, pensada para reportes de
 *        staff por plan_id directo — NO se usa aquí como fuente de
 *        contenido (evitaría duplicar la misma foto dos veces si el
 *        espejo sí existe).
 *        AJUSTE PRE-MERGE PR #174 (punto 1): el CONTEO de "evidencias
 *        por parada" mostrado al cliente YA NO reutiliza el campo
 *        `evidencias` de listarParadasDelPlan() — ese campo suma
 *        flota_viaje_evidencias + tms_evidencias para reportes
 *        internos de staff, y por tanto PUEDE contar dos veces la
 *        misma foto cuando el espejo en tms_evidencias también existe
 *        (la afirmación original de que "un conteo que sume de más
 *        nunca ocurre en la práctica" era INCORRECTA: tms_evidencias
 *        es un espejo de flota_viaje_evidencias, no una fuente
 *        independiente, así que sumar ambas SÍ duplica la misma foto
 *        cuando el espejo existe). El conteo del Portal Cliente ahora
 *        tiene su propia consulta batch
 *        (conteoEvidenciasVigentesPorParada, más abajo) que cuenta
 *        EXCLUSIVAMENTE flota_viaje_evidencias — una sola consulta
 *        para todas las paradas del plan, sin N+1. listarParadasDelPlan
 *        se sigue reutilizando tal cual, pero solo para id/orden/tipo/
 *        lugar_nombre, nunca para `evidencias`.
 *      - Vínculo evidencia -> plan: SIEMPRE indirecto vía
 *        flota_viajes.plan_id (flota_viaje_evidencias solo tiene
 *        viaje_id, nunca plan_id directo). Si un flota_viajes nunca se
 *        vinculó a ningún plan (0 o 2+ candidatos, nunca resuelto a
 *        mano por Operaciones), su evidencia queda invisible para
 *        CUALQUIER consumidor por plan_id — incluido este módulo y el
 *        propio TMS de staff (misma limitación ya existente, no nueva).
 *      - Vínculo evidencia -> parada: `parada_id` (ambas tablas,
 *        NULLABLE, SIN FK — evidencia "tablero_salida"/"tablero_llegada"
 *        nunca tiene parada_id, es evidencia del viaje, no de una
 *        parada puntual). Confirmado: SÍ existen evidencias sin
 *        parada_id en el modelo actual.
 *
 * E) Helpers reutilizados tal cual (no se reimplementa nada de esto):
 *      - listarParadasDelPlan/listarParadasDePlanes
 *        (src/lib/tms/paradas.ts) — paradas + conteo de evidencias ya
 *        resuelto (ambas tablas).
 *      - obtenerSolicitudCliente (src/lib/tms/solicitudes-cliente.ts,
 *        CLIENTE-PORTAL-2) — solicitud + SU PROPIO recorrido original
 *        (tms_solicitud_paradas, con `referencia`) ya scoped por
 *        empresaId+clienteId.
 *      - absPathFromRelative/contentTypeFor (src/lib/uploads.ts) — el
 *        mismo mecanismo de servido de archivo protegido que ya usa
 *        GET /api/portal/viajes/[id]/evidencias (adjuntoId): nunca se
 *        expone la ruta real en el JSON, solo un id de evidencia que
 *        el cliente pide a través de una ruta propia que resuelve el
 *        archivo server-side.
 *
 * ============================================================
 * SECCIÓN 7 del ticket — referencia de la parada / plan modificado
 * después de programar:
 * ============================================================
 * CONFIRMADO: Operaciones SÍ puede modificar las paradas de un plan ya
 * creado después de la conversión (guardarParadasPlan soporta
 * actualizar/agregar/eliminar paradas de un plan existente vía PATCH de
 * Programación — diseño identity-based no destructivo, ver
 * src/lib/tms/paradas.ts). Por lo tanto, el orden de
 * tms_solicitud_paradas YA NO puede asumirse como una relación estable
 * con tms_plan_paradas después de programar — no existe ningún id que
 * relacione directamente una fila de una tabla con la otra.
 *
 * Decisión (siguiendo la instrucción explícita del ticket, sección 16,
 * en vez de inventar un emparejamiento por orden/nombre no confiable):
 * se muestran AMBOS recorridos, SIN intentar emparejarlos:
 *   - "Recorrido solicitado" = tms_solicitud_paradas (vía
 *     obtenerSolicitudCliente, ya existente) — histórico, inmutable,
 *     con su `referencia` original.
 *   - "Recorrido programado" = tms_plan_paradas (vía
 *     listarParadasDelPlan) — el operativo ACTUAL, con conteo de
 *     evidencias real. Es el que se usa para el seguimiento/progreso.
 * Si algún día se necesita mostrar la referencia de una entrega
 * específica del recorrido PROGRAMADO, hace falta una relación técnica
 * nueva (columna de trazabilidad solicitud_parada_id en
 * tms_plan_paradas, o similar) — eso es SQL nuevo, fuera de alcance de
 * este ticket (ver "NO SQL por defecto").
 */

// ============================================================
// Estado del viaje — mapeo documentado, sin inventar estados nuevos.
// ============================================================

export const ESTADO_VIAJE_PORTAL = [
  "PROGRAMADO",
  "EN_RUTA",
  "FINALIZADO",
  "CANCELADO",
  "DESCONOCIDO",
] as const;
export type EstadoViajePortal = (typeof ESTADO_VIAJE_PORTAL)[number];

/**
 * Mapea el estado REAL de tms_planes_viaje.estado (fuente única) a la
 * representación simplificada del portal. "Cargado" se trata igual que
 * "Programado" (mismo criterio que buscarPlanesParaSalida/
 * marcarPlanEnRuta: ambos son "todavía no salió"). "Descargado" se
 * muestra como FINALIZADO desde la perspectiva del cliente — la
 * distinción "Descargado vs. Cerrado" es puramente administrativa
 * interna (cierre de Operaciones, permiso viajes_cerrar) y no aporta
 * nada útil al cliente, que solo necesita saber si su carga ya llegó.
 *
 * AJUSTE PRE-MERGE PR #174 (punto 3): `tms_planes_viaje.estado` es
 * VARCHAR libre, sin ENUM — un estado real futuro no documentado aquí
 * ("En aduana", "Retenido", etc.) NO puede mostrarse engañosamente
 * como "Programado" (mapear a PROGRAMADO por defecto sugeriría al
 * cliente que su viaje simplemente aún no salió, cuando en realidad es
 * un estado operativo que ni siquiera reconocemos). Un estado no
 * reconocido se mapea a DESCONOCIDO explícito ("Estado por confirmar"
 * en la UI) — el texto libre interno (`estadoReal`) se conserva aparte
 * en el resultado para diagnóstico interno, pero NUNCA se expone tal
 * cual al cliente sin pasar por este mapeo aprobado.
 */
export function estadoViajePortal(estadoReal: string): EstadoViajePortal {
  switch (estadoReal) {
    case "Programado":
    case "Cargado":
      return "PROGRAMADO";
    case "En ruta":
      return "EN_RUTA";
    case "Descargado":
    case "Cerrado":
      return "FINALIZADO";
    case "Cancelado":
      return "CANCELADO";
    default:
      return "DESCONOCIDO";
  }
}

// ============================================================
// Evidencias
// ============================================================

export type EvidenciaCliente = {
  id: number;
  tipo: string;
  capturadoEn: string | null;
  nombreOriginal: string;
};

/**
 * Evidencias de UNA parada del plan — SIEMPRE resueltas vía
 * flota_viajes.plan_id -> flota_viaje_evidencias (fuente vigente, ver
 * discovery arriba). Nunca se consulta tms_evidencias aquí (evitaría
 * duplicar la misma foto si el espejo también existe).
 */
async function evidenciasDeParada(
  empresaId: number,
  planId: number,
  paradaId: number,
): Promise<EvidenciaCliente[]> {
  const viajes = await query<RowDataPacket[]>(
    `SELECT id FROM flota_viajes WHERE empresa_id = ? AND plan_id = ?`,
    [empresaId, planId],
  );
  const viajeIds = viajes.map((v) => Number(v.id));
  if (!viajeIds.length) return [];

  const rows = await query<RowDataPacket[]>(
    `SELECT id, tipo, capturado_en, nombre_original
     FROM flota_viaje_evidencias
     WHERE empresa_id = ? AND parada_id = ? AND viaje_id IN (${viajeIds.map(() => "?").join(",")})
     ORDER BY id ASC`,
    [empresaId, paradaId, ...viajeIds],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    tipo: String(r.tipo),
    capturadoEn: r.capturado_en != null ? String(r.capturado_en) : null,
    nombreOriginal: String(r.nombre_original),
  }));
}

// ============================================================
// Seguimiento
// ============================================================

export type ParadaSeguimiento = {
  id: number;
  orden: number;
  tipo: string;
  lugarNombre: string;
  /**
   * Único criterio de "completada" disponible HOY en el modelo real:
   * al menos 1 evidencia VIGENTE asociada a esta parada (ver discovery,
   * sección 6 del ticket: no existe ningún estado explícito
   * "completada" en tms_plan_paradas — investigado, no inventado).
   */
  completada: boolean;
  /** Conteo VIGENTE (flota_viaje_evidencias únicamente) — ver
   * conteoEvidenciasVigentesPorParada, AJUSTE PRE-MERGE PR #174. Nunca
   * la suma legacy+vigente de listarParadasDelPlan(). */
  cantidadEvidencias: number;
};

export type PlanSeguimiento = {
  id: number;
  codigo: string;
  estadoReal: string;
  estadoPortal: EstadoViajePortal;
  fechaPlan: string;
  horaCarga: string | null;
  pilotoNombre: string | null;
  unidadPlaca: string | null;
  paradas: ParadaSeguimiento[];
};

export type SeguimientoSolicitudCliente = {
  solicitud: SolicitudClienteDetalle;
  plan: PlanSeguimiento | null;
};

/**
 * AJUSTE PRE-MERGE PR #174 (punto 1) — conteo VIGENTE (Portal Cliente)
 * de evidencias por parada. A diferencia de listarParadasDelPlan()
 * (paradas.ts, que suma flota_viaje_evidencias + tms_evidencias para
 * reportes internos de staff), esto cuenta EXCLUSIVAMENTE
 * flota_viaje_evidencias — evita contar dos veces la misma fotografía
 * cuando el espejo en tms_evidencias también existe (ver discovery
 * arriba). Una sola consulta batch para TODAS las paradas del plan
 * (GROUP BY parada_id), nunca una consulta por parada (sin N+1).
 */
async function conteoEvidenciasVigentesPorParada(
  empresaId: number,
  planId: number,
): Promise<Map<number, number>> {
  const rows = await query<RowDataPacket[]>(
    `SELECT e.parada_id, COUNT(*) AS n
     FROM flota_viaje_evidencias e
     JOIN flota_viajes v ON v.id = e.viaje_id
     WHERE e.empresa_id = ? AND v.empresa_id = ? AND v.plan_id = ? AND e.parada_id IS NOT NULL
     GROUP BY e.parada_id`,
    [empresaId, empresaId, planId],
  );
  const map = new Map<number, number>();
  for (const r of rows) {
    map.set(Number(r.parada_id), Number(r.n));
  }
  return map;
}

/**
 * Punto de entrada ÚNICO de seguimiento — la cadena de autorización
 * completa (ticket, sección 2):
 *   session -> empresaId+clienteId -> tms_solicitudes_cliente (ya
 *   scoped) -> plan_id -> tms_planes_viaje, validando EXPLÍCITAMENTE
 *   que el plan encontrado siga perteneciendo al mismo empresaId Y
 *   clienteId (nunca solo confiar en la FK — defensa en profundidad,
 *   mismo criterio ya aplicado en CLIENTE-PORTAL-3).
 *
 * Nunca acepta un planId/paradaId sueltos: TODO empieza desde
 * `solicitudId` + el scope de sesión.
 */
export async function obtenerSeguimientoSolicitudCliente(
  empresaId: number,
  clienteId: number,
  solicitudId: number,
): Promise<SeguimientoSolicitudCliente | null> {
  const solicitud = await obtenerSolicitudCliente(empresaId, clienteId, solicitudId);
  if (!solicitud) return null;
  if (solicitud.planId == null) return { solicitud, plan: null };

  const planRows = await query<RowDataPacket[]>(
    `SELECT p.id, p.codigo, p.empresa_id, p.cliente_id, p.estado, p.fecha_plan, p.hora_carga,
            pil.nombre AS piloto_nombre, u.placa AS unidad_placa
     FROM tms_planes_viaje p
     LEFT JOIN tms_personal pil ON pil.id = p.piloto_id
     LEFT JOIN tms_unidades u ON u.id = p.unidad_id
     WHERE p.id = ? AND p.empresa_id = ? LIMIT 1`,
    [solicitud.planId, empresaId],
  );
  const p = planRows[0];
  // Defensa en profundidad (ticket, sección 2): el plan debe seguir
  // siendo del MISMO empresaId + clienteId — nunca basta con que la FK
  // exista. Si no coincide (no debería ocurrir nunca por construcción
  // de CLIENTE-PORTAL-3, pero se verifica igual), no hay seguimiento
  // — el caller (API) responde 404, nunca revela el desajuste.
  if (!p || Number(p.empresa_id) !== empresaId || Number(p.cliente_id) !== clienteId) {
    return null;
  }

  // listarParadasDelPlan() se reutiliza SOLO para id/orden/tipo/
  // lugar_nombre — su campo `evidencias` (suma legacy+vigente, pensado
  // para reportes internos de staff) NUNCA se usa como cantidad visible
  // del Portal Cliente (ver AJUSTE PRE-MERGE PR #174, punto 1).
  const paradasPlan = await listarParadasDelPlan(Number(p.id));
  const conteoVigente = await conteoEvidenciasVigentesPorParada(empresaId, Number(p.id));
  const paradas: ParadaSeguimiento[] = paradasPlan.map((pp: PlanParada) => {
    const cantidadEvidencias = conteoVigente.get(pp.id) ?? 0;
    return {
      id: pp.id,
      orden: pp.orden,
      tipo: pp.tipo,
      lugarNombre: pp.lugar_nombre,
      completada: cantidadEvidencias > 0,
      cantidadEvidencias,
    };
  });

  const plan: PlanSeguimiento = {
    id: Number(p.id),
    codigo: String(p.codigo),
    estadoReal: String(p.estado),
    estadoPortal: estadoViajePortal(String(p.estado)),
    fechaPlan: toIsoDate(p.fecha_plan as string | Date | null) ?? "",
    horaCarga: p.hora_carga != null ? String(p.hora_carga) : null,
    pilotoNombre: p.piloto_nombre != null ? String(p.piloto_nombre) : null,
    unidadPlaca: p.unidad_placa != null ? String(p.unidad_placa) : null,
    paradas,
  };

  return { solicitud, plan };
}

/**
 * Evidencias de UNA parada — SIEMPRE a través de la cadena completa
 * cliente -> solicitud -> plan -> parada. Nunca por paradaId/planId
 * sueltos: se revalida TODO en cada llamada (nunca se confía en que un
 * paradaId "ya se validó antes" en otra petición).
 */
export async function obtenerEvidenciasParadaCliente(
  empresaId: number,
  clienteId: number,
  solicitudId: number,
  paradaId: number,
): Promise<EvidenciaCliente[] | null> {
  const seguimiento = await obtenerSeguimientoSolicitudCliente(empresaId, clienteId, solicitudId);
  if (!seguimiento?.plan) return null;
  const parada = seguimiento.plan.paradas.find((p) => p.id === paradaId);
  if (!parada) return null;
  return evidenciasDeParada(empresaId, seguimiento.plan.id, paradaId);
}

/**
 * Una evidencia puntual — misma cadena completa que
 * obtenerEvidenciasParadaCliente, más la validación de que la evidencia
 * concreta pertenezca a esa parada/plan/viaje ya autorizados. Nunca
 * "GET evidencia por id" sin pasar por toda la cadena (ticket, sección
 * 8: "Nunca: GET /evidencias/:id sin validar primero el ownership").
 */
export async function obtenerEvidenciaClienteParaArchivo(
  empresaId: number,
  clienteId: number,
  solicitudId: number,
  paradaId: number,
  evidenciaId: number,
): Promise<{ rutaRelativa: string; nombreOriginal: string; mime: string | null } | null> {
  const evidencias = await obtenerEvidenciasParadaCliente(empresaId, clienteId, solicitudId, paradaId);
  if (!evidencias) return null;
  if (!evidencias.some((e) => e.id === evidenciaId)) return null;

  const rows = await query<RowDataPacket[]>(
    `SELECT ruta_relativa, nombre_original, mime
     FROM flota_viaje_evidencias
     WHERE id = ? AND empresa_id = ? AND parada_id = ? LIMIT 1`,
    [evidenciaId, empresaId, paradaId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    rutaRelativa: String(r.ruta_relativa),
    nombreOriginal: String(r.nombre_original),
    mime: r.mime != null ? String(r.mime) : null,
  };
}

// ============================================================
// Historial de viajes — extiende listarSolicitudesCliente (CLIENTE-
// PORTAL-2) con el estado LIVE del plan cuando existe, en vez de crear
// una segunda fuente de verdad. Reutiliza la MISMA función/consulta de
// listado, solo agrega una columna derivada por encima.
// ============================================================

export type { SolicitudClienteResumenFila } from "@/lib/tms/solicitudes-cliente";

export type ViajeClienteFila = {
  solicitudId: number;
  estadoSolicitud: string;
  fechaSolicitada: string;
  horaSolicitada: string | null;
  referenciaCliente: string | null;
  cantidadEntregas: number;
  planId: number | null;
  planCodigo: string | null;
  estadoViaje: EstadoViajePortal | null;
  creadoEn: string;
};

export async function listarViajesCliente(
  empresaId: number,
  clienteId: number,
  filtros?: { estado?: string; fechaDesde?: string; fechaHasta?: string },
): Promise<ViajeClienteFila[]> {
  const solicitudes = await listarSolicitudesCliente(empresaId, clienteId, filtros);

  const planIds = [...new Set(solicitudes.map((s) => s.planId).filter((id): id is number => id != null))];
  const planPorId = new Map<number, { codigo: string; estado: string }>();
  if (planIds.length) {
    // AJUSTE PRE-MERGE PR #174 (punto 2) — defensa en profundidad: el
    // mismo criterio explícito empresaId+clienteId que
    // obtenerSeguimientoSolicitudCliente() aplica al detalle, aplicado
    // aquí también. Aunque los planIds provienen de solicitudes ya
    // scoped por cliente, esto evita que un planId inconsistente (bug
    // futuro, dato corrupto) enriquezca con código/estado del plan de
    // OTRO cliente de la misma empresa — un plan que no matchea
    // simplemente no aparece en `rows`, y esa solicitud queda con
    // planCodigo/estadoViaje en null (ver el .map de abajo).
    const rows = await query<RowDataPacket[]>(
      `SELECT id, codigo, estado FROM tms_planes_viaje
       WHERE empresa_id = ? AND cliente_id = ? AND id IN (${planIds.map(() => "?").join(",")})`,
      [empresaId, clienteId, ...planIds],
    );
    for (const r of rows) {
      planPorId.set(Number(r.id), { codigo: String(r.codigo), estado: String(r.estado) });
    }
  }

  return solicitudes.map((s) => {
    const plan = s.planId != null ? planPorId.get(s.planId) : undefined;
    return {
      solicitudId: s.id,
      estadoSolicitud: s.estado,
      fechaSolicitada: s.fechaSolicitada,
      horaSolicitada: s.horaSolicitada,
      referenciaCliente: s.referenciaCliente,
      cantidadEntregas: s.cantidadEntregas,
      planId: s.planId,
      planCodigo: plan?.codigo ?? null,
      estadoViaje: plan ? estadoViajePortal(plan.estado) : null,
      creadoEn: s.creadoEn,
    };
  });
}

// ============================================================
// Dashboard — resumen de seguimiento (sección 14 del ticket).
// ============================================================

export type ResumenSeguimientoCliente = {
  pendientes: number;
  viajesProgramados: number;
  viajesEnRuta: number;
  viajesFinalizados: number;
  rechazadasCanceladas: number;
  total: number;
};

/**
 * Números del dashboard basados en el estado LIVE del viaje (no solo el
 * estado de la solicitud) — construidos sobre listarViajesCliente()
 * (misma consulta que el historial), nunca una fuente aparte. Cada
 * solicitud PROGRAMADA cae en EXACTAMENTE un bucket (nunca se cuenta
 * dos veces).
 *
 * AJUSTE PRE-MERGE PR #174 (punto 4): un plan Cancelado por Operaciones
 * DESPUÉS de programar YA NO se agrupa dentro de "viajesFinalizados"
 * (un viaje cancelado no es un viaje que llegó a su destino — agruparlo
 * ahí inflaba esa tarjeta con viajes que en realidad no se completaron).
 * En su lugar se agrupa junto con RECHAZADA/CANCELADA dentro de
 * `rechazadasCanceladas` (mismo criterio: "esta solicitud/viaje ya no
 * está activo, no requiere seguimiento"), preferido sobre agregar un
 * sexto contador nuevo en el dashboard para un caso extremo.
 */
export async function resumenSeguimientoCliente(
  empresaId: number,
  clienteId: number,
): Promise<ResumenSeguimientoCliente> {
  const viajes = await listarViajesCliente(empresaId, clienteId);
  let pendientes = 0;
  let viajesProgramados = 0;
  let viajesEnRuta = 0;
  let viajesFinalizados = 0;
  let rechazadasCanceladas = 0;

  for (const v of viajes) {
    if (v.estadoSolicitud === "SOLICITADA" || v.estadoSolicitud === "EN_REVISION") {
      pendientes++;
    } else if (v.estadoSolicitud === "RECHAZADA" || v.estadoSolicitud === "CANCELADA") {
      rechazadasCanceladas++;
    } else if (v.estadoSolicitud === "PROGRAMADA") {
      if (v.estadoViaje === "EN_RUTA") viajesEnRuta++;
      else if (v.estadoViaje === "FINALIZADO") viajesFinalizados++;
      else if (v.estadoViaje === "CANCELADO") rechazadasCanceladas++;
      // PROGRAMADO, DESCONOCIDO, o nulo (defensa en profundidad del
      // punto 2 — un plan que no matchea empresa/cliente no enriquece
      // y llega aquí como estadoViaje null): bucket seguro por defecto.
      else viajesProgramados++;
    }
  }

  return {
    pendientes,
    viajesProgramados,
    viajesEnRuta,
    viajesFinalizados,
    rechazadasCanceladas,
    total: viajes.length,
  };
}
