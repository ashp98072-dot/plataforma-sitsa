"use client";

export default function EmpresaError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-3 p-6">
      <h1 className="text-lg font-semibold">No se pudo cargar la página</h1>
      <p className="text-sm text-[var(--muted)]">
        {error.message || "Error temporal. Prueba de nuevo."}
      </p>
      <button
        type="button"
        onClick={() => reset()}
        className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm text-white"
      >
        Reintentar
      </button>
    </div>
  );
}
