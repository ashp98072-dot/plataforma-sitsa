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
 * Solo se editan piloto, auxiliares, unidad y TC. Nada se guarda al cambiar un select: se mantiene un BORRADOR local
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
};

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
};

export type EntradaBorrador = { esperado: SnapshotEsperado; nuevo: RecursosEditables };
/** planId -> fila modificada. Una fila que vuelve a sus valores originales sale del borrador. */
export type Borrador = ReadonlyMap<number, EntradaBorrador>;
export type ResultadosValidacion = ReadonlyMap<number, FilaResultadoEdicionRapida>;
export type EstadoEdicionFila = "sin_cambios" | "modificada" | "ok" | "conflicto";
export type CambioLote = { planId: number; esperado: SnapshotEsperado; nuevo: RecursosEditables };
export type CuerpoEdicionRapida = { motivoCambio: string; cambios: CambioLote[] };

export const MAX_AUXILIARES_EDICION_RAPIDA = 8;
export const MSG_CAMBIOS_PENDIENTES = "Tienes cambios sin guardar en Edición rápida. ¿Descartarlos?";

/** Botón "Edición rápida": mismo permiso que exige el backend (programacion:editar). */
export function puedeUsarEdicionRapida(permisos: PermisoModulo[]): boolean {
  return tienePermiso(permisos, "programacion", "editar");
}

/** Snapshot `esperado` desde los datos REALES del viaje cargado (ids del GET, nunca nombres/etiquetas). */
export function snapshotEsperado(p: PlanEdicionRapida): SnapshotEsperado {
  return {
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
  if ((p.tipo_viaje ?? "Propio") === "Tercerizado") return "Tercerizado";
  if (p.estado === "Cerrado" || p.estado === "Cancelado") return p.estado;
  if (p.fecha_plan < hoy) return "Histórico";
  // Datos que el GET aún no trae (versión anterior del servidor): sin snapshot exacto no se edita.
  if (p.auxiliarPersonalIds === undefined || p.flotaVehiculoId === undefined) return "Sin datos para edición rápida";
  // Auxiliar legado (solo columna auxiliar_id): el snapshot real no coincidiría con lo que se muestra.
  if (p.auxiliaresDetalle.length > 0 && p.auxiliarPersonalIds.length === 0) return "Auxiliar legado: usa Ajustar";
  return null;
}

/** Unidad legado (placa sin vínculo con Flota): no se puede representar por flotaVehiculoId -> se ajusta desde "Ajustar". */
export function unidadSinVinculoFlota(p: PlanEdicionRapida): boolean {
  return Boolean(p.placa) && (p.flotaVehiculoId ?? null) == null;
}

/** Recursos a mostrar en la fila: el borrador si existe, si no los reales. */
export function recursosVisibles(borrador: Borrador, p: PlanEdicionRapida): RecursosEditables {
  return borrador.get(p.id)?.nuevo ?? recursosDe(snapshotEsperado(p));
}

/**
 * Aplica un cambio a una fila. El snapshot `esperado` se toma la PRIMERA vez que se toca la fila y se conserva (así un
 * cambio concurrente en el servidor se detecta como PLAN_DESACTUALIZADO). Si la fila vuelve a sus valores originales,
 * sale del borrador.
 */
export function editarRecursos(borrador: Borrador, p: PlanEdicionRapida, cambios: Partial<RecursosEditables>): Map<number, EntradaBorrador> {
  const siguiente = new Map(borrador);
  const esperado = borrador.get(p.id)?.esperado ?? snapshotEsperado(p);
  const actual = borrador.get(p.id)?.nuevo ?? recursosDe(esperado);
  const aux = cambios.auxiliarPersonalIds
    ? [...new Set(cambios.auxiliarPersonalIds)].slice(0, MAX_AUXILIARES_EDICION_RAPIDA)
    : actual.auxiliarPersonalIds;
  const nuevo: RecursosEditables = { ...actual, ...cambios, auxiliarPersonalIds: aux };
  if (mismosRecursos(nuevo, recursosDe(esperado))) siguiente.delete(p.id);
  else siguiente.set(p.id, { esperado, nuevo });
  return siguiente;
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
    .filter(([, e]) => !mismosRecursos(e.nuevo, recursosDe(e.esperado)))
    .map(([planId, e]) => ({
      planId,
      esperado: { ...e.esperado, auxiliarPersonalIds: [...e.esperado.auxiliarPersonalIds] },
      nuevo: { ...e.nuevo, auxiliarPersonalIds: [...e.nuevo.auxiliarPersonalIds] },
    }));
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
