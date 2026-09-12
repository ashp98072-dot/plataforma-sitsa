type Props = {
  abierto: boolean;
  mensaje: string;
  procesando: boolean;
  onCancelar: () => void;
  onConfirmar: () => void;
};

export function AutorizacionConfirmacionModal({
  abierto,
  mensaje,
  procesando,
  onCancelar,
  onConfirmar,
}: Props) {
  if (!abierto) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="confirmar-autorizacion-titulo">
      <div className="w-full max-w-md space-y-4 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5 shadow-xl">
        <h2 id="confirmar-autorizacion-titulo" className="text-base font-semibold">Confirmar autorización</h2>
        <p className="text-sm">{mensaje}</p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancelar} disabled={procesando} className="rounded border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-50">Cancelar</button>
          <button type="button" onClick={onConfirmar} disabled={procesando} className="rounded bg-emerald-600 px-3 py-2 text-sm text-white disabled:opacity-50">
            {procesando ? "Autorizando…" : "Confirmar autorización"}
          </button>
        </div>
      </div>
    </div>
  );
}
