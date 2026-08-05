"use client";

import { useCallback, useEffect, useState } from "react";

type Ev = {
  id: number;
  nombreOriginal: string | null;
  subidoEn: string;
};

type Props = {
  slug: string;
  incidenciaId: number;
  titulo: string;
  puedeEditar?: boolean;
  onClose: () => void;
  onChanged?: () => void;
};

export function EvidenciasModal({
  slug,
  incidenciaId,
  titulo,
  puedeEditar = true,
  onClose,
  onChanged,
}: Props) {
  const [items, setItems] = useState<Ev[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `/api/empresas/${slug}/rrhh/vacaciones/${incidenciaId}/evidencias`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error");
      setItems(data.evidencias ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }, [slug, incidenciaId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function subir() {
    if (!puedeEditar || !file) return;
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(
      `/api/empresas/${slug}/rrhh/vacaciones/${incidenciaId}/evidencias`,
      { method: "POST", body: fd },
    );
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "No se pudo subir");
      return;
    }
    setFile(null);
    await cargar();
    onChanged?.();
  }

  async function eliminar(id: number) {
    if (!puedeEditar) return;
    if (!confirm("¿Eliminar esta evidencia?")) return;
    const res = await fetch(
      `/api/empresas/${slug}/rrhh/vacaciones/evidencias/${id}`,
      { method: "DELETE" },
    );
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "No se pudo eliminar");
      return;
    }
    await cargar();
    onChanged?.();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">Evidencias / boletas</h3>
            <p className="text-sm text-[var(--muted)]">{titulo}</p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Doble clic en el historial abre este panel (PDF, fotos…).
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-[#37474F] px-3 py-1 text-sm text-white"
          >
            Cerrar
          </button>
        </div>

        {puedeEditar ? (
          <div className="mt-4 space-y-2 rounded-lg border border-[var(--border)] p-3">
            <input
              type="file"
              accept=".jpg,.jpeg,.png,.webp,.bmp,.pdf,image/*,application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-[var(--muted)]"
            />
            <button
              type="button"
              disabled={!file}
              onClick={() => void subir()}
              className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm text-white disabled:opacity-40"
            >
              Subir evidencia
            </button>
            <p className="text-xs text-[var(--muted)]">
              jpg, png, webp, bmp, pdf · máx. 8 MB
            </p>
          </div>
        ) : null}

        {error ? <p className="mt-2 text-sm text-[#f0a0a0]">{error}</p> : null}

        <ul className="mt-4 space-y-2">
          {loading ? (
            <li className="text-sm text-[var(--muted)]">Cargando…</li>
          ) : items.length === 0 ? (
            <li className="text-sm text-[var(--muted)]">Sin evidencias.</li>
          ) : (
            items.map((ev) => (
              <li
                key={ev.id}
                className="flex items-center justify-between gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm"
              >
                <span className="truncate">{ev.nombreOriginal || "archivo"}</span>
                <div className="flex shrink-0 gap-2">
                  <a
                    href={`/api/empresas/${slug}/rrhh/vacaciones/evidencias/${ev.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded bg-[#1F6AA5] px-2 py-1 text-xs text-white"
                  >
                    Ver
                  </a>
                  {puedeEditar ? (
                    <button
                      type="button"
                      onClick={() => void eliminar(ev.id)}
                      className="rounded bg-[#8B0000] px-2 py-1 text-xs text-white"
                    >
                      Borrar
                    </button>
                  ) : null}
                </div>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
