import type { PermisoModulo } from "@/lib/permisos-shared";
import { tieneAccionCatalogo, tienePermisoBase } from "@/lib/permisos-catalogo";

export const ACCIONES_COMBUSTIBLE = ["ver", "registrar", "editar_pendientes", "revisar", "conciliar", "gestionar_estaciones"] as const;
export type AccionCombustible = typeof ACCIONES_COMBUSTIBLE[number];
/** Mismo resolvedor central en servidor/UI. Una denegación explícita prevalece sobre editar legacy. */
export function puedeCombustible(permisos: PermisoModulo[], accion: AccionCombustible): boolean {
  return tienePermisoBase(permisos, "flota_combustible") && tieneAccionCatalogo(permisos, "flota_combustible", accion);
}
export function capacidadesCombustible(permisos: PermisoModulo[], admin: boolean) {
  return {
    ver: admin || puedeCombustible(permisos, "ver"),
    registrar: admin || puedeCombustible(permisos, "registrar"),
    editar_pendientes: admin || puedeCombustible(permisos, "editar_pendientes"),
    revisar: admin || puedeCombustible(permisos, "revisar"),
    conciliar: admin || puedeCombustible(permisos, "conciliar"),
    gestionar_estaciones: admin || puedeCombustible(permisos, "gestionar_estaciones"),
  };
}
export type CapacidadesCombustible = ReturnType<typeof capacidadesCombustible>;
