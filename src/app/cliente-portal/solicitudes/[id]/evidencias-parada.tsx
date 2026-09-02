"use client";

import { useCallback, useState } from "react";

type Evidencia = {
  id: number;
  tipo: string;
  capturadoEn: string | null;
  nombreOriginal: string;
};

/**
 * CLIENTE-PORTAL-4 (secciones 8/9/12) — galería de evidencias de UNA
 * parada. Nunca carga nada hasta que el cliente pulsa "Ver evidencias"
 * (sección 12: no descargar automáticamente archivos pesados); las
 * imágenes se sirven desde la ruta protegida .../evidencias/[evidenciaId]
 * /archivo, que revalida TODA la cadena de autorización en cada
 * petición — este componente nunca conoce ni expone una ruta de disco,
 * solo ids ya autorizados por el propio backend.
 */
export function EvidenciasParada({
  solicitudId,
  paradaId,
  lugarNombre,
  cantidadEvidencias,
}: {
  solicitudId: number;
  paradaId: number;
  lugarNombre: string;
  cantidadEvidencias: number;
}) {
  const [abierto, setAbierto] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [evidencias, setEvidencias] = useState<Evidencia[] | null>(null);
  const [seleccionada, setSeleccionada] = useState<Evidencia | null>(null);

  const abrir = useCallback(async () => {
    setAbierto(true);
    if (evidencias) return; // ya cargadas — no repetir la petición
    setCargando(true);
    setError("");
    try {
      const res = await fetch(
        `/api/cliente-portal/solicitudes/${solicitudId}/paradas/${paradaId}/evidencias`,
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "No se pudieron cargar las evidencias.");
        return;
      }
      setEvidencias(data.evidencias ?? []);
    } finally {
      setCargando(false);
    }
  }, [solicitudId, paradaId, evidencias]);

  const cerrar = useCallback(() => {
    setAbierto(false);
    setSeleccionada(null);
  }, []);

  const archivoUrl = (evidenciaId: number) =>
    `/api/cliente-portal/solicitudes/${solicitudId}/paradas/${paradaId}/evidencias/${evidenciaId}/archivo`;

  if (!cantidadEvidencias) return null;

  return (
    <>
      <button
        type="button"
        onClick={abrir}
        className="text-xs font-medium text-[var(--accent)] underline"
      >
        Ver evidencias ({cantidadEvidencias})
      </button>

      {abierto ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          onClick={cerrar}
        >
          <div
            className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="font-medium">Evidencias — {lugarNombre}</h3>
              <button
                type="button"
                onClick={cerrar}
                className="rounded px-2 py-1 text-sm text-[var(--muted)] hover:bg-[var(--thead)]"
              >
                Cerrar ✕
              </button>
            </div>

            {cargando ? <p className="text-sm text-[var(--muted)]">Cargando…</p> : null}
            {error ? <p className="text-sm text-red-500">{error}</p> : null}

            {!cargando && !error ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {(evidencias ?? []).map((ev) => (
                  <button
                    key={ev.id}
                    type="button"
                    onClick={() => setSeleccionada(ev)}
                    className="group overflow-hidden rounded-lg border border-[var(--border)] text-left"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={archivoUrl(ev.id)}
                      alt={ev.nombreOriginal}
                      loading="lazy"
                      className="h-28 w-full object-cover transition group-hover:opacity-80"
                    />
                    <div className="p-1.5">
                      <p className="truncate text-[11px] text-[var(--muted)]">
                        {ev.capturadoEn ? ev.capturadoEn.slice(0, 16).replace("T", " ") : "—"}
                      </p>
                      <p className="truncate text-[11px] text-[var(--muted)]">{ev.tipo}</p>
                    </div>
                  </button>
                ))}
                {evidencias && !evidencias.length ? (
                  <p className="col-span-full text-sm text-[var(--muted)]">Sin evidencias.</p>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {seleccionada ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setSeleccionada(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={archivoUrl(seleccionada.id)}
            alt={seleccionada.nombreOriginal}
            className="max-h-[90vh] max-w-full rounded-lg object-contain"
          />
        </div>
      ) : null}
    </>
  );
}
