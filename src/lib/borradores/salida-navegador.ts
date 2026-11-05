import { crearAlmacenIndexedDB } from "./almacen-indexeddb";
import { decidirSalidaConDialogoNativo, prepararCierreSesionExplicito, type ResultadoCierreSesion } from "./cierre-sesion";
import { crearNucleoBorradores } from "./nucleo";

/**
 * BORR-1b — pegamento de NAVEGADOR para la salida EXPLÍCITA (menú de cuenta y selector de empresa). Usa el almacén IndexedDB
 * real (no el envoltorio de preferencia): la limpieza debe poder funcionar aunque la persistencia esté desactivada. NUNCA lanza
 * y no bloquea la salida por errores de IndexedDB (ver cierre-sesion.ts). NO se usa en la salida por expiración de sesión.
 */
export function prepararSalidaDelNavegador(ownerKey: string | null): Promise<ResultadoCierreSesion> {
  if (ownerKey === null) return Promise.resolve({ continuar: true, limpieza: "no_requerida", detectados: 0, eliminados: 0 });
  const nucleo = crearNucleoBorradores({ almacen: crearAlmacenIndexedDB(), appBuild: "salida-sesion" }); // sin escrituras: appBuild solo identifica al instanciador
  return prepararCierreSesionExplicito({
    ownerKey,
    nucleo,
    decidir: decidirSalidaConDialogoNativo((mensaje) => window.confirm(mensaje)),
  }).catch(() => ({ continuar: true, limpieza: "fallida" as const, detectados: 0, eliminados: 0 }));
}
