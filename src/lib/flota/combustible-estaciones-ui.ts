import type { CatalogoSearchOption } from "@/components/tms/catalogo-search-select";
import { opcionesConHistorico } from "@/components/tms/catalogo-search-select";

export type EstacionOpcion = { id: number; proveedorId: number; nombre: string; proveedorNombre?: string | null; direccion?: string | null };
export type VehiculoOpcion = { id: number; placa: string; descripcion?: string | null };
export const estacionesDelProveedor = (estaciones: EstacionOpcion[], proveedorId: string) => estaciones.filter(e => e.proveedorId === Number(proveedorId));
export const estacionAlCambiarProveedor = (estaciones: EstacionOpcion[], proveedorId: string, estacionId: string) => estacionesDelProveedor(estaciones, proveedorId).some(e => String(e.id) === estacionId) ? estacionId : "";

/**
 * Opciones del selector «Estación / gasolinera» del vale. Se ve «Estación · Proveedor» (sin IDs técnicos) y se busca por nombre,
 * proveedor o dirección/referencia. Solo estaciones ACTIVAS (el catálogo ya las filtra); al editar un vale antiguo se conserva
 * la estación histórica aunque ya no esté activa, con el nombre que quedó en el vale.
 */
export function opcionesEstacion(estaciones: EstacionOpcion[], historica?: { id: number | null | undefined; nombre: string | null | undefined }): CatalogoSearchOption[] {
  const opciones = estaciones.map(e => ({
    value: String(e.id),
    label: e.nombre,
    detail: e.proveedorNombre ?? undefined,
    searchText: [e.proveedorNombre, e.direccion].filter(Boolean).join(" "),
  }));
  return historica?.id ? opcionesConHistorico(opciones, String(historica.id), historica.nombre?.trim() || "Estación anterior") : opciones;
}

/** Opciones del selector «Unidad / placa»: se ve «Placa · descripción» y se busca por ambas. Conserva la unidad histórica del vale. */
export function opcionesVehiculo(vehiculos: VehiculoOpcion[], historico?: { id: number | null | undefined; placa: string | null | undefined }): CatalogoSearchOption[] {
  const opciones = vehiculos.map(v => ({ value: String(v.id), label: v.placa, detail: v.descripcion?.trim() || undefined, searchText: v.descripcion?.trim() || undefined }));
  return historico?.id ? opcionesConHistorico(opciones, String(historico.id), historico.placa?.trim() || "Unidad anterior") : opciones;
}

export const MENSAJE_SIN_ESTACIONES = "Debes registrar primero la estación de combustible.";

/** ¿Un vale que exige estación no tiene ninguna disponible? Solo se decide con el catálogo YA cargado (nunca mientras carga). */
export const requiereRegistrarEstaciones = (catalogoCargado: boolean, exigeEstacion: boolean, opciones: CatalogoSearchOption[]) =>
  catalogoCargado && exigeEstacion && opciones.length === 0;
