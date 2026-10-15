export type EstacionOpcion = { id: number; proveedorId: number; nombre: string };
export const estacionesDelProveedor = (estaciones: EstacionOpcion[], proveedorId: string) => estaciones.filter(e => e.proveedorId === Number(proveedorId));
export const estacionAlCambiarProveedor = (estaciones: EstacionOpcion[], proveedorId: string, estacionId: string) => estacionesDelProveedor(estaciones, proveedorId).some(e => String(e.id) === estacionId) ? estacionId : "";
