import { crearAlmacenIndexedDB } from "./almacen-indexeddb";
import {
  decidirSalidaConDialogoNativo,
  prepararCierreSesionExplicito,
  type DecisionTrasFallo,
  type InformeLimpieza,
  type ResultadoCierreSesion,
} from "./cierre-sesion";
import { crearNucleoBorradores } from "./nucleo";

/**
 * BORR-1b — pegamento de NAVEGADOR para la salida EXPLÍCITA (menú de cuenta y selector de empresa). Usa el almacén IndexedDB
 * real (no el envoltorio de preferencia): la limpieza debe poder funcionar aunque la persistencia esté desactivada. NUNCA lanza
 * y no bloquea la salida por errores de la CONSULTA previa (solo lectura). Si el usuario pidió borrar y la eliminación no se
 * confirma por completo, `decidirTrasFallo` (la interfaz de advertencia) decide: sin ella la salida se CANCELA. NO se usa en la
 * salida por expiración de sesión.
 */
export function prepararSalidaDelNavegador(
  ownerKey: string | null,
  opciones: { decidirTrasFallo?: (informe: InformeLimpieza) => Promise<DecisionTrasFallo> } = {},
): Promise<ResultadoCierreSesion> {
  if (ownerKey === null) return Promise.resolve({ continuar: true, limpieza: "no_requerida", detectados: 0, eliminados: 0 });
  const nucleo = crearNucleoBorradores({ almacen: crearAlmacenIndexedDB(), appBuild: "salida-sesion" }); // sin escrituras: appBuild solo identifica al instanciador
  return prepararCierreSesionExplicito({
    ownerKey,
    nucleo,
    decidir: decidirSalidaConDialogoNativo((mensaje) => window.confirm(mensaje)),
    decidirTrasFallo: opciones.decidirTrasFallo,
  }).catch(() => ({ continuar: true, limpieza: "consulta_fallida" as const, detectados: 0, eliminados: 0 }));
}
