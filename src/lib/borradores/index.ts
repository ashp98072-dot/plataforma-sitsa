export * from "./tipos";
export * from "./almacen";
export { crearAlmacenIndexedDB, NOMBRE_BD_BORRADORES } from "./almacen-indexeddb";
export { crearNucleoBorradores } from "./nucleo";
export type { OpcionesNucleo, EntradaGuardado, LecturaBorrador, ResumenLimpieza, NucleoBorradores } from "./nucleo";
// BORR-1b (cliente). `owner-key.ts` es SOLO servidor y no se exporta aquí a propósito.
export * from "./contexto";
export * from "./preferencia";
export * from "./cierre-sesion";
export { prepararSalidaDelNavegador } from "./salida-navegador";
export { ESTADO_GUARDADO_INICIAL, reducirEstadoGuardado } from "./estado-guardado";
export type { EstadoGuardado, EventoGuardado, NombreEstadoGuardado } from "./estado-guardado";
