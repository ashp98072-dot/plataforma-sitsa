import type { PermisoModulo } from "@/lib/permisos-shared";
import { tienePermiso } from "@/lib/permisos-shared";
import {
  DEFINICIONES_ENTREGA,
  PERMISO_ANULAR,
  PERMISO_AREA_CONTABILIDAD,
  PERMISO_AREA_TESORERIA,
  PERMISO_PRESENCIAL,
  type AreaEntrega,
  type EstadoEntrega,
  type ModoEntrega,
  type ModuloEntrega,
} from "./catalogo";

/**
 * Reglas PURAS del control de entrega (sin base de datos): permisos por área, custodia y validaciones de entrada. El servicio
 * (entregas.ts) las aplica dentro de la transacción con los datos bloqueados.
 */

/** Identidad SIEMPRE resuelta en el servidor desde la sesión (nunca del cliente). */
export type ActorEntrega = {
  usuarioId: number;
  /** usuarios.username: lo que se escribe en `auditoria.usuario`, igual que el resto de la app. */
  username: string;
  nombre: string;
  /** Rol del sistema (usuarios.rol_global). No es un cargo formal. */
  rol: string | null;
  esAdmin: boolean;
  permisos: PermisoModulo[];
};

const conPermiso = (actor: ActorEntrega, fila: string) => actor.esAdmin || tienePermiso(actor.permisos, fila, "editar");

/** Fila de permiso que habilita actuar por un área en un módulo (emitir desde ella y recibir en ella). */
export function permisoDeArea(modulo: ModuloEntrega, area: AreaEntrega): string | null {
  const def = DEFINICIONES_ENTREGA[modulo];
  if (area === def.areaInicial) return def.permisoAreaInicial;
  if (area === "TESORERIA") return PERMISO_AREA_TESORERIA;
  if (area === "CONTABILIDAD") return PERMISO_AREA_CONTABILIDAD;
  return null; // p. ej. COMPRAS en Fondos: no existe esa área en el módulo
}

export function puedeActuarPorArea(actor: ActorEntrega, modulo: ModuloEntrega, area: AreaEntrega): boolean {
  const fila = permisoDeArea(modulo, area);
  return fila !== null && conPermiso(actor, fila);
}

export const puedeOperarPresencial = (actor: ActorEntrega) => conPermiso(actor, PERMISO_PRESENCIAL);
export const puedeAnularAjenas = (actor: ActorEntrega) => conPermiso(actor, PERMISO_ANULAR);

/** Áreas (por módulo) en las que el actor puede recibir: base de la bandeja «Entregas por recibir». */
export function areasRecepcionDelActor(actor: ActorEntrega): Record<ModuloEntrega, AreaEntrega[]> {
  const salida = {} as Record<ModuloEntrega, AreaEntrega[]>;
  for (const def of Object.values(DEFINICIONES_ENTREGA)) {
    const destinos = [...new Set(def.pares.map((p) => p.destino))];
    salida[def.modulo] = destinos.filter((a) => puedeActuarPorArea(actor, def.modulo, a));
  }
  return salida;
}

export type EntregaParaCustodia = { id: number; estado: EstadoEntrega; etapaDestino: AreaEntrega };

/**
 * Custodia actual: el destino de la última entrega RECIBIDA (las recepciones son secuenciales: solo puede haber una pendiente a
 * la vez), o el área inicial del módulo si aún no hay ninguna. `pendiente` es la entrega EMITIDA en curso, si existe.
 */
export function calcularCustodia<T extends EntregaParaCustodia>(modulo: ModuloEntrega, entregas: T[]): { area: AreaEntrega; pendiente: T | null } {
  const ordenadas = [...entregas].sort((a, b) => a.id - b.id);
  const recibidas = ordenadas.filter((e) => e.estado === "RECIBIDA");
  return {
    area: recibidas.length ? recibidas[recibidas.length - 1].etapaDestino : DEFINICIONES_ENTREGA[modulo].areaInicial,
    pendiente: ordenadas.find((e) => e.estado === "EMITIDA") ?? null,
  };
}

export const MAX_OBSERVACIONES_ENTREGA = 1000;
export const MAX_MOTIVO_ENTREGA = 1000;
export const MAX_NOMBRE_PRESENCIAL = 200;

/** Texto opcional: recorta, vacío → null; excede el máximo → error (no se trunca en silencio). */
export function textoOpcional(valor: string | null | undefined, maximo: number, campo: string): string | null {
  const limpio = (valor ?? "").trim();
  if (!limpio) return null;
  if (limpio.length > maximo) throw new RangeError(`${campo} no puede exceder ${maximo} caracteres.`);
  return limpio;
}

export function esModoEntrega(v: unknown): v is ModoEntrega {
  return v === "SISTEMA" || v === "PRESENCIAL";
}
