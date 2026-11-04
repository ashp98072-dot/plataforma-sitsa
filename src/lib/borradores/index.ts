export * from "./tipos";
export * from "./almacen";
export { crearAlmacenIndexedDB, NOMBRE_BD_BORRADORES } from "./almacen-indexeddb";
export { crearNucleoBorradores } from "./nucleo";
export type { OpcionesNucleo, EntradaGuardado, LecturaBorrador, ResumenLimpieza, NucleoBorradores } from "./nucleo";
export { ESTADO_GUARDADO_INICIAL, reducirEstadoGuardado } from "./estado-guardado";
export type { EstadoGuardado, EventoGuardado, NombreEstadoGuardado } from "./estado-guardado";
