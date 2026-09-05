export type AdvertenciaImportEmpleado = {
  filaExcel: number;
  codigo: string;
  nombre: string;
  motivo: string;
};

/**
 * Lógica pura de presentación de una advertencia — extraída y probada
 * sin renderizar el componente (no hay @testing-library/react en este
 * proyecto, mismo criterio ya usado en documentos-modal.test.ts/
 * plan-form.test.ts). Nunca deja pasar "undefined"/"null" ni un campo
 * vacío como texto visible: codigo/motivo vacíos (tras trim) se
 * devuelven como `null` para que el componente sepa NO renderizar esa
 * línea.
 */
export function formatearAdvertencia(a: AdvertenciaImportEmpleado): {
  titulo: string;
  codigo: string | null;
  motivo: string | null;
} {
  const nombre = (a.nombre ?? "").trim();
  const codigo = (a.codigo ?? "").trim();
  const motivo = (a.motivo ?? "").trim();

  return {
    titulo: `Fila ${a.filaExcel}${nombre ? ` — ${nombre}` : ""}`,
    codigo: codigo || null,
    motivo: motivo || null,
  };
}

/** Recorta la lista a `maxVisible` y calcula cuántas quedaron fuera. */
export function paginarAdvertencias(
  advertencias: AdvertenciaImportEmpleado[],
  maxVisible: number,
): { visibles: AdvertenciaImportEmpleado[]; resto: number } {
  const visibles = advertencias.slice(0, maxVisible);
  return { visibles, resto: advertencias.length - visibles.length };
}

type Props = {
  advertencias: AdvertenciaImportEmpleado[];
  /** Máximo de filas visibles; el resto se indica como conteo. */
  maxVisible?: number;
};

/**
 * IMPORT-EMPLEADOS-SEGURA (UI) — panel de advertencias devuelto por
 * POST .../empleados/import (campo `advertencias`, ver route.ts). Son
 * filas que el backend decidió OMITIR (código sospechoso, fila sin
 * código/nombre) — nunca crearon ni actualizaron nada — así que se
 * muestran en amarillo/naranja (aviso), no en rojo (error real de
 * `errores`, ver ImportErroresLista).
 *
 * Expandible/contraíble (<details>, abierto por defecto) y oculto por
 * completo si no hay advertencias.
 */
export function ImportAdvertenciasLista({ advertencias, maxVisible = 40 }: Props) {
  if (!advertencias.length) return null;
  const { visibles, resto } = paginarAdvertencias(advertencias, maxVisible);

  return (
    <details
      open
      className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200"
    >
      <summary className="cursor-pointer font-medium text-amber-900 dark:text-amber-100">
        {advertencias.length} fila(s) requieren revisión
      </summary>
      <ul className="mt-2 max-h-64 space-y-2 overflow-y-auto pl-1">
        {visibles.map((a, i) => {
          const f = formatearAdvertencia(a);
          return (
            <li
              key={`${i}-${a.filaExcel}`}
              className="border-t border-amber-500/20 pt-2 first:border-t-0 first:pt-0"
            >
              <p className="break-words font-medium">{f.titulo}</p>
              {f.codigo ? (
                <p className="text-xs opacity-90">Código: {f.codigo}</p>
              ) : null}
              {f.motivo ? (
                <p className="text-xs opacity-90">Motivo: {f.motivo}</p>
              ) : null}
            </li>
          );
        })}
      </ul>
      {resto > 0 ? (
        <p className="mt-2 text-xs opacity-80">
          …y {resto} advertencia(s) más. Corrige las filas indicadas en el
          Excel y vuelve a importar.
        </p>
      ) : (
        <p className="mt-2 text-xs opacity-80">
          Estas filas no crearon ni actualizaron ningún empleado. Revísalas
          en el Excel y vuelve a importar si corresponde.
        </p>
      )}
    </details>
  );
}
