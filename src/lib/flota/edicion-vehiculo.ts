import { PERMISO_FLOTA_VEHICULOS_OTRAS_EMPRESAS } from "@/lib/permisos-shared";

/**
 * FLOTA — EDICIÓN DE VEHÍCULOS COMPARTIDOS / DE OTRAS EMPRESAS.
 *
 * Regla única (la usan el backend y la UI, así nunca divergen):
 *
 *   puedeEditarVehiculo = esEmpresaPropietaria  OR  (permiso «flota_vehiculos_otras_empresas:editar» AND la empresa propietaria es una de las
 *                                                    empresas que el usuario está autorizado a operar)
 *
 * No depende de `username` ni de `rol`: el permiso es un registro más de la matriz de Usuarios (Admin lo recibe por catálogo global; el
 * Encargado de Taller lo recibe cuando un Admin se lo asigna). El permiso NUNCA amplía el alcance más allá de las empresas del usuario: un
 * vehículo de una empresa a la que el usuario no tiene acceso no se puede editar aunque se manipulen los ids.
 *
 * Editar NO transfiere la propiedad: el UPDATE nunca toca `empresa_id` y se acota por la empresa propietaria leída de la BD (nunca del cliente).
 */
export { PERMISO_FLOTA_VEHICULOS_OTRAS_EMPRESAS };

export const MENSAJE_SOLO_EMPRESA_DUENA = "Este vehículo es compartido; solo la empresa dueña puede editarlo.";
export const MENSAJE_EMPRESA_DUENA_NO_AUTORIZADA = "No tienes acceso a la empresa propietaria de este vehículo; no puedes editarlo.";

export type MotivoDenegado = "no_dueno" | "empresa_no_autorizada";

export type DecisionEdicionVehiculo = {
  puede: boolean;
  /** La empresa activa es la propietaria. */
  esDueno: boolean;
  /** Se permite SOLO por el permiso transversal (la empresa activa no es la propietaria). */
  porPermisoTransversal: boolean;
  motivoDenegado: MotivoDenegado | null;
};

export function decidirEdicionVehiculo(i: {
  empresaActivaId: number;
  empresaDuenaId: number;
  /** El usuario tiene «Editar vehículos de otras empresas» (o es Admin). */
  permisoTransversal: boolean;
  /** Empresas que el usuario está autorizado a operar (solo hace falta cuando hay permiso transversal). */
  empresasAutorizadasIds: number[];
}): DecisionEdicionVehiculo {
  const esDueno = i.empresaActivaId === i.empresaDuenaId;
  if (esDueno) return { puede: true, esDueno: true, porPermisoTransversal: false, motivoDenegado: null };
  if (!i.permisoTransversal) return { puede: false, esDueno: false, porPermisoTransversal: false, motivoDenegado: "no_dueno" };
  if (!i.empresasAutorizadasIds.includes(i.empresaDuenaId)) {
    return { puede: false, esDueno: false, porPermisoTransversal: false, motivoDenegado: "empresa_no_autorizada" };
  }
  return { puede: true, esDueno: false, porPermisoTransversal: true, motivoDenegado: null };
}

/** Claves de la solicitud PATCH que corresponden a la operación de TALLER (enviar / sacar de taller), que sigue disponible para unidades compartidas. */
export const CLAVES_OPERACION_TALLER = ["id", "enTaller", "motivoTaller"] as const;

/** true si la solicitud solo pide enviar/sacar de taller: esa acción conserva su propio permiso (flota_vehiculos:editar) y no es «editar el vehículo». */
export function esSolicitudSoloTaller(clavesPresentes: string[]): boolean {
  return clavesPresentes.includes("enTaller") && clavesPresentes.every((k) => (CLAVES_OPERACION_TALLER as readonly string[]).includes(k));
}

export function mensajeDenegado(motivo: MotivoDenegado | null): string {
  return motivo === "empresa_no_autorizada" ? MENSAJE_EMPRESA_DUENA_NO_AUTORIZADA : MENSAJE_SOLO_EMPRESA_DUENA;
}

export function avisoEdicionOtraEmpresa(empresaDuena: string): string {
  return `Vehículo propiedad de ${empresaDuena}. Tienes permiso para editar vehículos de otras empresas.`;
}

/** Texto de la auditoría de una edición transversal (sin datos sensibles): vehículo, empresa propietaria, empresa activa y usuario. */
export function detalleAuditoriaEdicionTransversal(i: {
  placa: string; vehiculoId: number; empresaDuenaNombre: string; empresaDuenaId: number; empresaActivaNombre: string; empresaActivaId: number; usuario: string;
}): string {
  return `Vehículo ${i.placa} (id ${i.vehiculoId}) de ${i.empresaDuenaNombre} (empresa ${i.empresaDuenaId}) editado desde ${i.empresaActivaNombre} (empresa ${i.empresaActivaId}) por ${i.usuario} con el permiso «editar vehículos de otras empresas».`;
}
