import { crearAlmacenIndexedDB } from "./almacen-indexeddb";
import {
  decidirSalidaConDialogoNativo,
  prepararCierreSesionExplicito,
  resolverTrasExcepcionInesperada,
  type DecisionTrasFallo,
  type InformeLimpieza,
  type ResultadoCierreSesion,
} from "./cierre-sesion";
import { crearNucleoBorradores } from "./nucleo";

/**
 * BORR-1b — pegamento de NAVEGADOR para la salida EXPLÍCITA (menú de cuenta y selector de empresa). Usa el almacén IndexedDB
 * real (no el envoltorio de preferencia): la limpieza debe poder funcionar aunque la persistencia esté desactivada. NUNCA lanza.
 * Una excepción durante la CONSULTA previa (solo lectura) no bloquea la salida. Si el usuario pidió borrar y la eliminación no se
 * confirma por completo —o hay una excepción inesperada durante o después de la eliminación autorizada—, `decidirTrasFallo` (la
 * interfaz de advertencia) decide: sin ella, o si falla, la salida se CANCELA. NO se usa en la salida por expiración de sesión.
 */
export async function prepararSalidaDelNavegador(
  ownerKey: string | null,
  opciones: { decidirTrasFallo?: (informe: InformeLimpieza) => Promise<DecisionTrasFallo> } = {},
): Promise<ResultadoCierreSesion> {
  if (ownerKey === null) return { continuar: true, limpieza: "no_requerida", detectados: 0, eliminados: 0 };
  let nucleo: ReturnType<typeof crearNucleoBorradores>;
  try {
    nucleo = crearNucleoBorradores({ almacen: crearAlmacenIndexedDB(), appBuild: "salida-sesion" }); // sin escrituras: appBuild solo identifica al instanciador
  } catch {
    // Falló al preparar el almacenamiento, ANTES de cualquier lectura o borrado: no se pidió destruir nada.
    return { continuar: true, limpieza: "consulta_fallida", detectados: 0, eliminados: 0 };
  }
  try {
    return await prepararCierreSesionExplicito({
      ownerKey,
      nucleo,
      decidir: decidirSalidaConDialogoNativo((mensaje) => window.confirm(mensaje)),
      decidirTrasFallo: opciones.decidirTrasFallo,
    });
  } catch {
    // `prepararCierreSesionExplicito` es TOTAL (clasifica sus excepciones por fase): llegar aquí es un defecto. Como ya pudo
    // haberse autorizado un borrado, NO se continúa en silencio: se advierte (resultado incierto) y, sin decisión, se cancela.
    return resolverTrasExcepcionInesperada(opciones.decidirTrasFallo, 0);
  }
}
