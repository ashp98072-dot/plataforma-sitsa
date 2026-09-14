import type { FilaProgramacionExcel } from "./programacion-import-excel";
import { finViajeDesdeInput, inicioViaje, type IntervaloViaje } from "./disponibilidad-traslapes";

/**
 * TMS-IMPORTACION-PROGRAMACION-EXCEL (PR 3 de 6) — validaciones PURAS
 * entre filas del mismo Excel: filas duplicadas y traslapes de piloto/
 * auxiliar/unidad DENTRO del lote (fila contra fila del propio archivo).
 * Ver docs/TMS-IMPORTACION-PROGRAMACION-EXCEL-{0,1,2}-*.md.
 *
 * Nada de esto consulta BD. Todavía NO se resuelve ruta/cliente/piloto/
 * auxiliar/unidad contra catálogo, NO se valida tarifa vigente, NO se
 * compara contra viajes YA EXISTENTES en BD (eso es
 * `primerConflictoTraslape` de disponibilidad-traslapes.ts, y es alcance
 * de una fase posterior — PR 4/5). Este módulo reutiliza de ese mismo
 * archivo únicamente sus dos funciones puras de combinación de fecha/hora
 * (`inicioViaje`/`finViajeDesdeInput`) y el tipo `IntervaloViaje` — nunca
 * `primerConflictoTraslape` en sí (esa sí toca BD).
 */

/** Comparación case-insensitive de códigos/placas — mismo criterio que normalizarCodigoEmpleado() en rutas-import.ts. */
function normalizarClave(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLocaleLowerCase("es-GT");
}

// ---------------------------------------------------------------------
// Filas duplicadas dentro del mismo archivo
// ---------------------------------------------------------------------

/**
 * Clave normalizada aprobada: fechaSalida + horaSalida + ruta + piloto +
 * unidad. La MISMA ruta puede repetirse varias veces en el archivo si
 * cambia piloto y/o unidad — por eso piloto/unidad forman parte de la
 * clave, no solo la ruta.
 */
export function claveDuplicadoFila(fila: FilaProgramacionExcel): string {
  return [
    fila.fechaSalidaExcel ?? "",
    fila.horaSalidaExcel ?? "",
    normalizarClave(fila.codigoRutaExcel),
    normalizarClave(fila.pilotoCodigoExcel),
    normalizarClave(fila.placaExcel),
  ].join("|");
}

/**
 * Una fila sin fecha/ruta/piloto/placa (ya reportado como error sintáctico
 * propio en el PR 2) no aporta una clave de duplicado significativa —
 * comparar filas rotas entre sí produciría falsos positivos (dos filas
 * distintas, ambas con estos campos vacíos, no son "la misma fila
 * repetida"). Se excluyen de la detección de duplicados, sin que eso
 * oculte sus propios errores (esos ya vienen en erroresSintacticos).
 */
function tieneClaveDuplicadoCompleta(fila: FilaProgramacionExcel): boolean {
  return Boolean(
    fila.fechaSalidaExcel && fila.codigoRutaExcel && fila.pilotoCodigoExcel && fila.placaExcel,
  );
}

export type FilaDuplicadaEnLote = {
  filaExcel: number;
  /** Otras filas del mismo archivo con la MISMA clave (fecha+hora+ruta+piloto+unidad). */
  duplicadaCon: number[];
};

/**
 * Detecta filas EXACTAMENTE duplicadas dentro del mismo archivo (misma
 * clave normalizada). Devuelve una entrada por cada fila involucrada en
 * un grupo de 2+ duplicados (ambas/todas se reportan, no solo la
 * "segunda"), ordenadas por número de fila de Excel. Si no hay
 * duplicados, devuelve `[]`.
 */
export function detectarFilasDuplicadas(filas: FilaProgramacionExcel[]): FilaDuplicadaEnLote[] {
  const grupos = new Map<string, number[]>();
  for (const fila of filas) {
    if (!tieneClaveDuplicadoCompleta(fila)) continue;
    const clave = claveDuplicadoFila(fila);
    const existentes = grupos.get(clave);
    if (existentes) existentes.push(fila.filaExcel);
    else grupos.set(clave, [fila.filaExcel]);
  }

  const resultado: FilaDuplicadaEnLote[] = [];
  for (const filasDelGrupo of grupos.values()) {
    if (filasDelGrupo.length < 2) continue;
    for (const filaExcel of filasDelGrupo) {
      resultado.push({
        filaExcel,
        duplicadaCon: filasDelGrupo.filter((otra) => otra !== filaExcel),
      });
    }
  }
  return resultado.sort((a, b) => a.filaExcel - b.filaExcel);
}

// ---------------------------------------------------------------------
// Traslapes de piloto/auxiliar/unidad ENTRE filas del mismo archivo
// ---------------------------------------------------------------------

type CategoriaRecurso = "persona" | "unidad";
type RolRecurso = "piloto" | "auxiliar" | "unidad";

type RecursoFila = {
  categoria: CategoriaRecurso;
  rol: RolRecurso;
  /** Valor tal como viene de la fila (ya normalizado por el parser del PR 2), para mostrar. */
  valor: string;
  /** Solo para comparar igualdad (case-insensitive). */
  claveComparacion: string;
};

/**
 * "piloto" y "auxiliar" comparten la MISMA categoría de recurso
 * ("persona") — mismo criterio ya documentado y usado por
 * disponibilidad-traslapes.ts (primerConflictoTraslape): un mismo
 * empleado no puede estar en dos viajes traslapados sin importar si en
 * uno es piloto y en el otro auxiliar, es la misma persona físicamente.
 * "unidad" (placa) es una categoría aparte. No se inventa una regla
 * nueva — se reutiliza la ya existente.
 */
function recursosDeFila(fila: FilaProgramacionExcel): RecursoFila[] {
  const recursos: RecursoFila[] = [];
  if (fila.pilotoCodigoExcel) {
    recursos.push({ categoria: "persona", rol: "piloto", valor: fila.pilotoCodigoExcel, claveComparacion: normalizarClave(fila.pilotoCodigoExcel) });
  }
  if (fila.auxiliar1CodigoExcel) {
    recursos.push({ categoria: "persona", rol: "auxiliar", valor: fila.auxiliar1CodigoExcel, claveComparacion: normalizarClave(fila.auxiliar1CodigoExcel) });
  }
  if (fila.auxiliar2CodigoExcel) {
    recursos.push({ categoria: "persona", rol: "auxiliar", valor: fila.auxiliar2CodigoExcel, claveComparacion: normalizarClave(fila.auxiliar2CodigoExcel) });
  }
  if (fila.placaExcel) {
    recursos.push({ categoria: "unidad", rol: "unidad", valor: fila.placaExcel, claveComparacion: normalizarClave(fila.placaExcel) });
  }
  return recursos;
}

/**
 * Intervalo real de la fila (salida -> regreso estimado), reutilizando
 * las MISMAS funciones puras que ya usa el resto de Programación
 * (inicioViaje/finViajeDesdeInput de disponibilidad-traslapes.ts) —
 * mismo formato "YYYY-MM-DD HH:mm:ss", comparable como string. `null` si
 * no se puede construir un intervalo completo: sin fecha de salida
 * válida, o sin regreso estimado completo (fecha+hora). Una fila sin
 * regreso NO se compara por traslape (no hay con qué) — su propia
 * ausencia de regreso, si corresponde, ya se reporta aparte (PR 2:
 * "incompleto" si viene a medias; completamente vacío se permite en V1).
 */
function intervaloDeFila(fila: FilaProgramacionExcel): IntervaloViaje | null {
  if (!fila.fechaSalidaExcel) return null;
  if (!fila.fechaRegresoExcel || !fila.horaRegresoExcel) return null;
  const fin = finViajeDesdeInput(`${fila.fechaRegresoExcel}T${fila.horaRegresoExcel}`);
  if (!fin) return null;
  return { inicio: inicioViaje(fila.fechaSalidaExcel, fila.horaSalidaExcel), fin };
}

/** Mismo criterio documentado en disponibilidad-traslapes.ts: se solapan si inicioA < finB Y inicioB < finA (tocar el límite NO es traslape). */
function seSolapan(a: IntervaloViaje, b: IntervaloViaje): boolean {
  return a.inicio < b.fin && b.inicio < a.fin;
}

export type ConflictoTraslapeEnLote = {
  filaExcel: number;
  filaExcelConflicto: number;
  categoria: CategoriaRecurso;
  /** El código/placa compartido, tal como viene en `filaExcel` (mismo valor salvo mayúsculas/espacios en `filaExcelConflicto`). */
  valor: string;
  /** Rol que jugaba el recurso compartido en `filaExcel`. */
  rolEnFila: RolRecurso;
  /** Rol que jugaba el recurso compartido en `filaExcelConflicto`. */
  rolEnFilaConflicto: RolRecurso;
};

/**
 * Detecta traslapes de piloto/auxiliar/unidad ENTRE filas del mismo
 * archivo (nunca contra BD — eso es una fase posterior). Dos filas
 * conflictúan cuando sus intervalos se solapan Y comparten al menos un
 * recurso de la MISMA categoría (persona o unidad). Devuelve una entrada
 * por cada lado del conflicto (ambas filas involucradas), ordenadas por
 * número de fila de Excel. `[]` si no hay ningún conflicto.
 */
export function detectarTraslapesEnLote(filas: FilaProgramacionExcel[]): ConflictoTraslapeEnLote[] {
  const intervalos = filas.map((fila) => ({ fila, intervalo: intervaloDeFila(fila), recursos: recursosDeFila(fila) }));

  const resultado: ConflictoTraslapeEnLote[] = [];
  for (let i = 0; i < intervalos.length; i++) {
    const a = intervalos[i];
    if (!a.intervalo || !a.recursos.length) continue;
    for (let j = i + 1; j < intervalos.length; j++) {
      const b = intervalos[j];
      if (!b.intervalo || !b.recursos.length) continue;
      if (!seSolapan(a.intervalo, b.intervalo)) continue;

      for (const ra of a.recursos) {
        for (const rb of b.recursos) {
          if (ra.categoria !== rb.categoria) continue;
          if (ra.claveComparacion !== rb.claveComparacion) continue;
          resultado.push({
            filaExcel: a.fila.filaExcel,
            filaExcelConflicto: b.fila.filaExcel,
            categoria: ra.categoria,
            valor: ra.valor,
            rolEnFila: ra.rol,
            rolEnFilaConflicto: rb.rol,
          });
          resultado.push({
            filaExcel: b.fila.filaExcel,
            filaExcelConflicto: a.fila.filaExcel,
            categoria: rb.categoria,
            valor: rb.valor,
            rolEnFila: rb.rol,
            rolEnFilaConflicto: ra.rol,
          });
        }
      }
    }
  }
  return resultado.sort((x, y) => x.filaExcel - y.filaExcel || x.filaExcelConflicto - y.filaExcelConflicto);
}
