type Props = {
  errores: string[];
  /** Máximo de filas visibles; el resto se indica como conteo. */
  maxVisible?: number;
};

/** Lista legible de errores por fila tras importar Excel. */
export function ImportErroresLista({ errores, maxVisible = 40 }: Props) {
  if (!errores.length) return null;
  const visibles = errores.slice(0, maxVisible);
  const resto = errores.length - visibles.length;

  return (
    <div
      className="rounded-lg border border-red-500/50 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-200"
      role="alert"
    >
      <p className="font-medium text-red-800 dark:text-red-100">
        {errores.length} registro(s) con error de importación
      </p>
      <ul className="mt-2 max-h-48 list-disc space-y-1 overflow-y-auto pl-5">
        {visibles.map((e, i) => (
          <li key={`${i}-${e.slice(0, 40)}`} className="break-words">
            {e}
          </li>
        ))}
      </ul>
      {resto > 0 ? (
        <p className="mt-2 text-xs opacity-80">
          …y {resto} error(es) más. Corrige las filas indicadas y vuelve a
          importar.
        </p>
      ) : (
        <p className="mt-2 text-xs opacity-80">
          Corrige las filas indicadas en el Excel y vuelve a importar.
        </p>
      )}
    </div>
  );
}
