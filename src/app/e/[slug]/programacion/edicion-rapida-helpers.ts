import type { DisponibilidadPersonal } from "@/lib/operaciones/disponibilidad-personal";
import { tienePermiso, type PermisoModulo } from "@/lib/permisos-shared";
import {
  MAX_FILAS_EDICION_RAPIDA,
  type FilaResultadoEdicionRapida,
} from "@/lib/tms/edicion-rapida-schema";

/**
 * PROGRAMACIÓN — EDICIÓN RÁPIDA PR-3: lógica PURA (sin React) de la tabla compacta de edición rápida, para poder
 * probarla sin infraestructura de componentes (mismo criterio que copiar/copiar-helpers.ts).
 *
 * Se editan piloto, auxiliares, unidad, TC y (PR-355) la tarifa del catálogo y los montos de viáticos. Nada se guarda al cambiar un select: se mantiene un BORRADOR local
 * (planId -> { esperado, nuevo }). `esperado` es el snapshot REAL del viaje tal como estaba cargado cuando el usuario lo
 * tocó por primera vez (ids, nunca etiquetas/nombres); `nuevo` es el estado editado. El contrato es exactamente el de
 * POST /tms/planes/edicion-rapida[/validar] (edicion-rapida-schema.ts). El servidor es la autoridad: vuelve a validar
 * todo al guardar.
 */

/** Campos del plan (GET /tms/planes) que la edición rápida necesita. */
export type PlanEdicionRapida = {
  id: number;
  codigo: string;
  estado: string;
  fecha_plan: string;
  hora_carga: string | null;
  regreso_estimado: string | null;
  tipo_viaje?: string;
  pilotoId: number | null;
  piloto: string | null;
  auxiliaresDetalle: { personalId: number; nombre: string }[];
  placa: string | null;
  tc?: string | null;
  tc_vehiculo_id?: number | null;
  /** Aditivo (PR-3): flota_vehiculos.id de la unidad asignada. */
  flotaVehiculoId?: number | null;
  /** Aditivo (PR-3): auxiliares SOLO de tms_plan_auxiliares, en orden (el primero es el principal). */
  auxiliarPersonalIds?: number[];
  /** PR-355 (aditivo del GET): ruta, tarifa del catálogo y monto comercial vigente del viaje. */
  ruta_id?: number | null;
  tarifa_id?: number | null;
  tarifa_comercial?: number | string | null;
  tarifa_nombre_historico?: string | null;
  tarifa_monto_historico?: number | string | null;
  /** PR-355 (aditivo del GET): viáticos por tms_personal.id. */
  viaticos?: ViaticoPlan[];
};

export type ViaticoPlan = { personalId: number; rol?: string; montoSugerido?: number | string; montoAsignado: number | string; estado: string };
export type MontoViatico = { personalId: number; montoAsignado: number };
export type ViaticoEsperado = MontoViatico & { estado: string };
export type TarifaRutaEdicion = { id: number; nombre: string; monto: number | string; moneda: string; predeterminada?: boolean };

export type RecursosEditables = {
  pilotoPersonalId: number | null;
  auxiliarPersonalIds: number[];
  flotaVehiculoId: number | null;
  tcVehiculoId: number | null;
};

export type SnapshotEsperado = RecursosEditables & {
  estado: string;
  fechaPlan: string;
  horaCarga: string | null;
  regresoEstimado: string | null;
  /** PR-355: presentes solo si el GET los trae (servidor anterior: la fila no edita tarifa/viáticos). */
  tarifaId?: number | null;
  tarifaComercial?: number | null;
  viaticos?: ViaticoEsperado[];
};

/** Estado editado: los 4 recursos + tarifa (undefined = sin tocar; null = sin tarifa) + montos de viático EXPLÍCITAMENTE editados. */
export type EstadoEditado = RecursosEditables & { tarifaId?: number | null; viaticos?: MontoViatico[] };
export type EntradaBorrador = { esperado: SnapshotEsperado; nuevo: EstadoEditado };
/** planId -> fila modificada. Una fila que vuelve a sus valores originales sale del borrador. */
export type Borrador = ReadonlyMap<number, EntradaBorrador>;
export type ResultadosValidacion = ReadonlyMap<number, FilaResultadoEdicionRapida>;
export type EstadoEdicionFila = "sin_cambios" | "modificada" | "ok" | "conflicto";
export type CambioLote = { planId: number; esperado: SnapshotEsperado; nuevo: EstadoEditado };
export type CuerpoEdicionRapida = { motivoCambio: string; cambios: CambioLote[] };

export const MAX_AUXILIARES_EDICION_RAPIDA = 8;
export const MSG_CAMBIOS_PENDIENTES = "Tienes cambios sin guardar en Edición rápida. ¿Descartarlos?";

/** Botón "Edición rápida": mismo permiso que exige el backend (programacion:editar). */
export function puedeUsarEdicionRapida(permisos: PermisoModulo[]): boolean {
  return tienePermiso(permisos, "programacion", "editar");
}

/** Snapshot `esperado` desde los datos REALES del viaje cargado (ids del GET, nunca nombres/etiquetas). */
const num = (v: number | string | null | undefined): number => Number(v ?? 0);

export function snapshotEsperado(p: PlanEdicionRapida): SnapshotEsperado {
  const extra: Partial<SnapshotEsperado> = {};
  if (p.tarifa_id !== undefined) {
    extra.tarifaId = p.tarifa_id ?? null;
    extra.tarifaComercial = p.tarifa_comercial != null ? Number(p.tarifa_comercial) : null;
  }
  if (p.viaticos !== undefined) {
    extra.viaticos = p.viaticos.map((v) => ({ personalId: v.personalId, montoAsignado: num(v.montoAsignado), estado: v.estado }));
  }
  return {
    ...extra,
    estado: p.estado,
    fechaPlan: p.fecha_plan,
    horaCarga: p.hora_carga ?? null,
    regresoEstimado: p.regreso_estimado ?? null,
    pilotoPersonalId: p.pilotoId ?? null,
    auxiliarPersonalIds: [...(p.auxiliarPersonalIds ?? [])],
    flotaVehiculoId: p.flotaVehiculoId ?? null,
    tcVehiculoId: p.tc_vehiculo_id ?? null,
  };
}

export function recursosDe(s: SnapshotEsperado): RecursosEditables {
  return {
    pilotoPersonalId: s.pilotoPersonalId,
    auxiliarPersonalIds: [...s.auxiliarPersonalIds],
    flotaVehiculoId: s.flotaVehiculoId,
    tcVehiculoId: s.tcVehiculoId,
  };
}

/** Igualdad de recursos; el ORDEN de auxiliares importa (el primero es el principal). */
export function mismosRecursos(a: RecursosEditables, b: RecursosEditables): boolean {
  return (
    a.pilotoPersonalId === b.pilotoPersonalId &&
    a.flotaVehiculoId === b.flotaVehiculoId &&
    a.tcVehiculoId === b.tcVehiculoId &&
    a.auxiliarPersonalIds.length === b.auxiliarPersonalIds.length &&
    a.auxiliarPersonalIds.every((x, i) => x === b.auxiliarPersonalIds[i])
  );
}

/**
 * Motivo por el que una fila NO se puede editar en modo rápido (null = editable). Solo lo obviamente no editable; el
 * resto (p. ej. "En ruta") lo decide el backend al validar.
 */
export function motivoNoEditable(p: PlanEdicionRapida, hoy: string): string | null {
  if (p.estado === "Cerrado" || p.estado === "Cancelado") return p.estado;
  if (p.fecha_plan < hoy) return "Histórico";
  // Datos que el GET aún no trae (versión anterior del servidor): sin snapshot exacto no se edita.
  if (p.auxiliarPersonalIds === undefined || p.flotaVehiculoId === undefined) return "Sin datos para edición rápida";
  // Auxiliar legado (solo columna auxiliar_id): el snapshot real no coincidiría con lo que se muestra.
  if (p.auxiliaresDetalle.length > 0 && p.auxiliarPersonalIds.length === 0) return "Auxiliar legado: usa Ajustar";
  return null;
}

/** Tercerizado: la tarifa se puede editar, pero piloto/auxiliares/unidad/TC/viáticos internos no aplican. */
export function recursosInternosBloqueados(p: PlanEdicionRapida): boolean {
  return (p.tipo_viaje ?? "Propio") === "Tercerizado";
}

/** ¿La fila tiene datos para editar tarifa? (GET nuevo + ruta conocida). */
export function puedeEditarTarifa(p: PlanEdicionRapida): boolean {
  return p.tarifa_id !== undefined && p.ruta_id != null && p.ruta_id > 0;
}

/** ¿La fila tiene datos para editar viáticos? (GET nuevo, viaje con recursos internos). */
export function puedeEditarViaticos(p: PlanEdicionRapida): boolean {
  return p.viaticos !== undefined && !recursosInternosBloqueados(p);
}

export const montoViaticoValido = (n: number) => Number.isFinite(n) && n >= 0 && n <= 9999999999.99 && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;

/** Unidad legado (placa sin vínculo con Flota): no se puede representar por flotaVehiculoId -> se ajusta desde "Ajustar". */
export function unidadSinVinculoFlota(p: PlanEdicionRapida): boolean {
  return Boolean(p.placa) && (p.flotaVehiculoId ?? null) == null;
}

/** Recursos a mostrar en la fila: el borrador si existe, si no los reales. */
export function recursosVisibles(borrador: Borrador, p: PlanEdicionRapida): RecursosEditables {
  return borrador.get(p.id)?.nuevo ?? recursosDe(snapshotEsperado(p));
}

/** Tarifa a mostrar: la editada si existe, si no la real (null = sin tarifa del catálogo). */
export function tarifaVisible(borrador: Borrador, p: PlanEdicionRapida): number | null {
  const n = borrador.get(p.id)?.nuevo.tarifaId;
  return n !== undefined ? n : p.tarifa_id ?? null;
}

/** Filas de viático a mostrar para las personas FINALES (piloto + auxiliares): monto editado o el actual de la BD (o null = aún sin fila). */
export function viaticosVisibles(borrador: Borrador, p: PlanEdicionRapida): { personalId: number; monto: number | null; estado: string | null; editado: boolean }[] {
  const e = borrador.get(p.id);
  const r = e?.nuevo ?? recursosDe(snapshotEsperado(p));
  const ids = [...(r.pilotoPersonalId != null ? [r.pilotoPersonalId] : []), ...r.auxiliarPersonalIds];
  const reales = new Map((p.viaticos ?? []).map((v) => [v.personalId, v]));
  const editados = new Map((e?.nuevo.viaticos ?? []).map((v) => [v.personalId, v.montoAsignado]));
  return ids.map((personalId) => {
    const real = reales.get(personalId);
    const ed = editados.get(personalId);
    return { personalId, monto: ed ?? (real ? num(real.montoAsignado) : null), estado: real?.estado ?? null, editado: ed !== undefined };
  });
}

/** Deja en los montos editados solo lo vigente: personas del estado FINAL cuyo monto realmente difiere del real. */
export function normalizarViaticos(esperado: SnapshotEsperado, r: RecursosEditables, viaticos: MontoViatico[] | undefined): MontoViatico[] | undefined {
  if (!viaticos) return undefined;
  const finales = new Set([...(r.pilotoPersonalId != null ? [r.pilotoPersonalId] : []), ...r.auxiliarPersonalIds]);
  const reales = new Map((esperado.viaticos ?? []).map((v) => [v.personalId, v.montoAsignado]));
  const lista = viaticos.filter((v) => finales.has(v.personalId) && (!reales.has(v.personalId) || Math.abs((reales.get(v.personalId) ?? 0) - v.montoAsignado) >= 0.005));
  return lista.length ? lista : undefined;
}

/** ¿El estado editado difiere del snapshot? (recursos, tarifa o viáticos) */
export function hayDiferencias(esperado: SnapshotEsperado, nuevo: EstadoEditado): boolean {
  if (!mismosRecursos(nuevo, recursosDe(esperado))) return true;
  if (nuevo.tarifaId !== undefined && nuevo.tarifaId !== (esperado.tarifaId ?? null)) return true;
  return (nuevo.viaticos?.length ?? 0) > 0;
}

/**
 * Aplica un cambio a una fila. El snapshot `esperado` se toma la PRIMERA vez que se toca la fila y se conserva (así un
 * cambio concurrente en el servidor se detecta como PLAN_DESACTUALIZADO). Si la fila vuelve a sus valores originales,
 * sale del borrador.
 */
export function editarRecursos(borrador: Borrador, p: PlanEdicionRapida, cambios: Partial<EstadoEditado>): Map<number, EntradaBorrador> {
  const siguiente = new Map(borrador);
  const esperado = borrador.get(p.id)?.esperado ?? snapshotEsperado(p);
  const actual: EstadoEditado = borrador.get(p.id)?.nuevo ?? recursosDe(esperado);
  const aux = cambios.auxiliarPersonalIds
    ? [...new Set(cambios.auxiliarPersonalIds)].slice(0, MAX_AUXILIARES_EDICION_RAPIDA)
    : actual.auxiliarPersonalIds;
  const nuevo: EstadoEditado = { ...actual, ...cambios, auxiliarPersonalIds: aux };
  // La tarifa editada que vuelve a la original deja de contar como cambio; los montos de quien ya no está en el viaje se descartan.
  if (nuevo.tarifaId !== undefined && nuevo.tarifaId === (esperado.tarifaId ?? null)) delete nuevo.tarifaId;
  const viaticos = normalizarViaticos(esperado, nuevo, nuevo.viaticos);
  if (viaticos) nuevo.viaticos = viaticos;
  else delete nuevo.viaticos;
  if (!hayDiferencias(esperado, nuevo)) siguiente.delete(p.id);
  else siguiente.set(p.id, { esperado, nuevo });
  return siguiente;
}

/** Edita el monto de viático de UNA persona (reemplaza su edición previa). */
export function editarViatico(borrador: Borrador, p: PlanEdicionRapida, personalId: number, montoAsignado: number): Map<number, EntradaBorrador> {
  const previos = (borrador.get(p.id)?.nuevo.viaticos ?? []).filter((v) => v.personalId !== personalId);
  return editarRecursos(borrador, p, { viaticos: [...previos, { personalId, montoAsignado }] });
}

export const agregarAuxiliar = (lista: number[], id: number) => (lista.includes(id) ? lista : [...lista, id]);
export const quitarAuxiliar = (lista: number[], id: number) => lista.filter((x) => x !== id);
/** Sube un auxiliar una posición (en la primera pasa a ser el principal). */
export function subirAuxiliar(lista: number[], id: number): number[] {
  const i = lista.indexOf(id);
  if (i <= 0) return lista;
  const r = [...lista];
  [r[i - 1], r[i]] = [r[i], r[i - 1]];
  return r;
}

/** Filas con cambios reales, en el formato exacto del contrato. */
export function cambiosDelBorrador(borrador: Borrador): CambioLote[] {
  return [...borrador.entries()]
    .filter(([, e]) => hayDiferencias(e.esperado, e.nuevo))
    .map(([planId, e]) => {
      const nuevo: EstadoEditado = { pilotoPersonalId: e.nuevo.pilotoPersonalId, auxiliarPersonalIds: [...e.nuevo.auxiliarPersonalIds], flotaVehiculoId: e.nuevo.flotaVehiculoId, tcVehiculoId: e.nuevo.tcVehiculoId };
      // Solo se envía lo que el usuario tocó de verdad: tarifa/viáticos omitidos = el servidor no los toca.
      if (e.nuevo.tarifaId !== undefined) nuevo.tarifaId = e.nuevo.tarifaId;
      if (e.nuevo.viaticos?.length) nuevo.viaticos = e.nuevo.viaticos.map((v) => ({ personalId: v.personalId, montoAsignado: v.montoAsignado }));
      return {
        planId,
        esperado: { ...e.esperado, auxiliarPersonalIds: [...e.esperado.auxiliarPersonalIds], ...(e.esperado.viaticos ? { viaticos: e.esperado.viaticos.map((v) => ({ ...v })) } : {}) },
        nuevo,
      };
    });
}

/** Cuerpo de POST /edicion-rapida/validar y /edicion-rapida: UN motivo por lote. */
export function cuerpoEdicionRapida(borrador: Borrador, motivo: string): CuerpoEdicionRapida {
  return { motivoCambio: motivo.trim(), cambios: cambiosDelBorrador(borrador) };
}

/** Error de UX previo a enviar (null = se puede enviar). El backend vuelve a validar todo. */
export function errorAntesDeEnviar(borrador: Borrador, motivo: string): string | null {
  const n = cambiosDelBorrador(borrador).length;
  if (!n) return "No hay cambios para validar o guardar.";
  if (n > MAX_FILAS_EDICION_RAPIDA) return `Máximo ${MAX_FILAS_EDICION_RAPIDA} viajes por lote (tienes ${n}).`;
  if (!motivo.trim()) return "Indica el motivo del cambio.";
  const malo = cambiosDelBorrador(borrador).some((c) => (c.nuevo.viaticos ?? []).some((v) => !montoViaticoValido(v.montoAsignado)));
  if (malo) return "Hay un monto de viático inválido (debe ser ≥ 0 con máximo 2 decimales).";
  return null;
}

export function estadoFila(planId: number, borrador: Borrador, resultados: ResultadosValidacion): EstadoEdicionFila {
  const r = resultados.get(planId);
  if (r?.estado === "error") return "conflicto";
  if (!borrador.has(planId)) return "sin_cambios";
  if (r?.estado === "ok") return "ok";
  return "modificada";
}

export function resumenEdicion(borrador: Borrador, resultados: ResultadosValidacion) {
  const ids = new Set([...borrador.keys(), ...resultados.keys()]);
  let ok = 0;
  let conflictos = 0;
  for (const id of ids) {
    const e = estadoFila(id, borrador, resultados);
    if (e === "ok") ok++;
    else if (e === "conflicto") conflictos++;
  }
  return { cambios: cambiosDelBorrador(borrador).length, ok, conflictos };
}

export function puedeValidar(borrador: Borrador, motivo: string, ocupado: boolean): boolean {
  return !ocupado && errorAntesDeEnviar(borrador, motivo) == null;
}

/** Guardar: ≥1 cambio, motivo, nada en curso y sin conflictos ya conocidos (el backend revalida de todos modos). */
export function puedeGuardar(borrador: Borrador, motivo: string, resultados: ResultadosValidacion, ocupado: boolean): boolean {
  return puedeValidar(borrador, motivo, ocupado) && resumenEdicion(borrador, resultados).conflictos === 0;
}

export function mapaResultados(filas: FilaResultadoEdicionRapida[] | undefined): Map<number, FilaResultadoEdicionRapida> {
  return new Map((filas ?? []).map((f) => [f.planId, f]));
}

/** Pide confirmación solo si hay algo que perder. */
export function confirmarPerdida(hayCambios: boolean, confirmar: (mensaje: string) => boolean): boolean {
  return !hayCambios || confirmar(MSG_CAMBIOS_PENDIENTES);
}

// ------------------------------------------------------------------------------------------------ red
type FetchFn = (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export type RespuestaValidar =
  | { tipo: "ok"; ok: boolean; filas: FilaResultadoEdicionRapida[] }
  | { tipo: "error"; error: string };
export type RespuestaGuardar =
  | { tipo: "ok"; guardados: number }
  | { tipo: "conflicto"; error: string; filas: FilaResultadoEdicionRapida[] }
  | { tipo: "error"; error: string };

const post = (fetchFn: FetchFn, url: string, cuerpo: CuerpoEdicionRapida) =>
  fetchFn(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });

export const urlValidar = (slug: string) => `/api/empresas/${slug}/tms/planes/edicion-rapida/validar`;
export const urlGuardar = (slug: string) => `/api/empresas/${slug}/tms/planes/edicion-rapida`;

export async function enviarValidar(fetchFn: FetchFn, slug: string, cuerpo: CuerpoEdicionRapida): Promise<RespuestaValidar> {
  try {
    const res = await post(fetchFn, urlValidar(slug), cuerpo);
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; filas?: FilaResultadoEdicionRapida[]; error?: string };
    if (!res.ok || !Array.isArray(data.filas)) return { tipo: "error", error: data.error ?? "No se pudo validar." };
    return { tipo: "ok", ok: Boolean(data.ok), filas: data.filas };
  } catch {
    return { tipo: "error", error: "Error de conexión al validar." };
  }
}

export async function enviarGuardar(fetchFn: FetchFn, slug: string, cuerpo: CuerpoEdicionRapida): Promise<RespuestaGuardar> {
  try {
    const res = await post(fetchFn, urlGuardar(slug), cuerpo);
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; guardados?: number; filas?: FilaResultadoEdicionRapida[]; error?: string };
    if (res.ok && data.ok) return { tipo: "ok", guardados: Number(data.guardados ?? 0) };
    if (res.status === 409) return { tipo: "conflicto", error: data.error ?? "Los cambios ya no son válidos.", filas: data.filas ?? [] };
    return { tipo: "error", error: data.error ?? "No se pudo guardar la edición rápida." };
  } catch {
    return { tipo: "error", error: "Error de conexión al guardar. No se perdió el borrador." };
  }
}

export const mensajeGuardado = (n: number) => `Se actualizaron ${n} viaje${n === 1 ? "" : "s"}.`;

// ------------------------------------------------------------------------------------------------ catálogos
export type PersonalCatalogo = { id: number; nombre: string; tipo: string; estado?: string | null };
export type VehiculoCatalogo = { id?: number; placa: string; tipoUnidad?: string; estadoDisponibilidad?: string };
export type Opcion = { id: number; etiqueta: string };

const ESTADO_PERSONA: Record<string, string> = { disponible: "🟢", no_disponible: "🔴", verificacion_parcial: "🟡" };

/**
 * Indicador de disponibilidad (si ya se cargó para esa fecha). No bloquea nada: un recurso "ocupado" por otra fila del
 * mismo lote puede liberarse en el mismo guardado (intercambio); la validación real la hace el backend.
 */
export function indicadorPersona(disp: DisponibilidadPersonal | undefined, planId: number): string {
  if (!disp) return "";
  const otros = disp.otrosPlanesDelDia.filter((o) => o.planId !== planId).length;
  return `${ESTADO_PERSONA[disp.estadoDisponibilidad] ?? ""}${otros ? ` · otro viaje${otros > 1 ? ` (${otros})` : ""}` : ""}`.trim();
}

/**
 * Opciones de piloto/auxiliar: tms_personal Activo del tipo pedido (mismo criterio que valida el backend). El valor
 * actual se incluye siempre aunque ya no esté en el catálogo, para no perderlo visualmente.
 */
export function opcionesPersonal(
  catalogo: PersonalCatalogo[],
  tipo: "Piloto" | "Auxiliar",
  actuales: { id: number; nombre: string }[],
  disp: Map<number, DisponibilidadPersonal>,
  planId: number,
): Opcion[] {
  const activos = catalogo.filter((p) => p.tipo === tipo && (p.estado ?? "Activo") === "Activo");
  const ids = new Set(activos.map((p) => p.id));
  const extra = actuales.filter((a) => !ids.has(a.id));
  return [...extra, ...activos].map((p) => {
    const ind = indicadorPersona(disp.get(p.id), planId);
    return { id: p.id, etiqueta: ind ? `${p.nombre} ${ind}` : p.nombre };
  });
}

const montoTexto = (m: number | string) => Number(m).toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Opciones de tarifa de la RUTA del viaje (solo las activas del GET). La tarifa actual se conserva aunque ya no esté
 * activa/vigente, para no perderla visualmente (el servidor solo acepta activas si el usuario la cambia).
 */
export function opcionesTarifa(catalogo: TarifaRutaEdicion[] | undefined, actual: { id: number | null; nombre?: string | null; monto?: number | string | null }): Opcion[] {
  const lista = (catalogo ?? []).map((t) => ({ id: t.id, etiqueta: `${t.nombre} · ${t.moneda} ${montoTexto(t.monto)}` }));
  if (actual.id != null && !lista.some((o) => o.id === actual.id)) {
    lista.unshift({ id: actual.id, etiqueta: `${actual.nombre ?? `#${actual.id}`}${actual.monto != null ? ` · ${montoTexto(actual.monto)}` : ""} (no vigente)` });
  }
  return lista;
}

/** Opciones de unidad (no TC) o TC por flota_vehiculos.id, mostrando la placa. */
export function opcionesVehiculo(catalogo: VehiculoCatalogo[], clase: "unidad" | "tc", actual: { id: number | null; placa: string | null }): Opcion[] {
  const lista = catalogo.filter((v) => v.id != null && (clase === "tc" ? v.tipoUnidad === "TC" : v.tipoUnidad !== "TC"));
  const opciones = lista.map((v) => ({
    id: v.id as number,
    etiqueta: v.estadoDisponibilidad && v.estadoDisponibilidad !== "disponible" ? `${v.placa} (${v.estadoDisponibilidad.replace("_", " ")})` : v.placa,
  }));
  if (actual.id != null && !opciones.some((o) => o.id === actual.id)) opciones.unshift({ id: actual.id, etiqueta: actual.placa ?? `#${actual.id}` });
  return opciones;
}
