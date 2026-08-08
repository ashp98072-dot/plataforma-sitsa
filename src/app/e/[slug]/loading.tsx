export default function EmpresaLoading() {
  return (
    <div
      className="animate-pulse space-y-4 p-1"
      aria-busy="true"
      aria-live="polite"
    >
      <p className="text-sm text-[var(--muted)]">Cargando módulo…</p>
      <div className="h-8 max-w-xs rounded-md bg-[var(--panel)]" />
      <div className="h-4 max-w-md rounded bg-[var(--panel)]" />
      <div className="mt-6 space-y-2">
        <div className="h-12 rounded-lg bg-[var(--panel)]" />
        <div className="h-12 rounded-lg bg-[var(--panel)]" />
        <div className="h-12 rounded-lg bg-[var(--panel)]" />
      </div>
    </div>
  );
}
