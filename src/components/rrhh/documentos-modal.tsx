"use client";

import { useCallback, useEffect, useState } from "react";
import { EXT_PERMITIDAS, MAX_UPLOAD_BYTES } from "@/lib/uploads-constants";

const MAX_UPLOAD_MB = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024));

/**
 * RRHH-EXPEDIENTES-UPLOAD-STABILITY (sección 3 del ticket) — valida
 * tamaño y extensión ANTES de crear la petición; si no pasa, nunca se
 * hace fetch. Usa el mismo límite que ya hace cumplir guardarUpload()
 * server-side (src/lib/uploads.ts, vía uploads-constants.ts) — una sola
 * fuente de verdad, no un número inventado aparte. Este límite es el de
 * la APLICACIÓN; el límite real sostenible del proxy/hosting de
 * Hostinger no está verificado (no hay config de nginx/Passenger en este
 * repo) — ver el reporte del ticket.
 */
export function validarArchivo(file: File): string | null {
  const ext = `.${file.name.split(".").pop()?.toLowerCase() ?? ""}`;
  if (!EXT_PERMITIDAS.has(ext)) {
    return "Formato no permitido. Usa: jpg, png, webp, bmp o pdf.";
  }
  if (file.size <= 0) return "El archivo está vacío.";
  if (file.size > MAX_UPLOAD_BYTES) {
    return `El archivo supera el máximo de ${MAX_UPLOAD_MB} MB.`;
  }
  return null;
}

const TIPOS_DOCUMENTO = [
  "DPI",
  "Contrato",
  "Licencia",
  "Antecedentes",
  "Otro",
] as const;

type Doc = {
  id: number;
  tipoDocumento: string;
  nombreOriginal: string | null;
  subidoEn: string;
};

type Props = {
  slug: string;
  empleadoId: number;
  empleadoNombre: string;
  puedeEditar?: boolean;
  onClose: () => void;
  onChanged?: () => void;
};

export function DocumentosModal({
  slug,
  empleadoId,
  empleadoNombre,
  puedeEditar = true,
  onClose,
  onChanged,
}: Props) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [tipo, setTipo] = useState<(typeof TIPOS_DOCUMENTO)[number]>("DPI");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [loading, setLoading] = useState(false);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `/api/empresas/${slug}/empleados/${empleadoId}/documentos`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error");
      setDocs(data.documentos ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }, [slug, empleadoId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function subir() {
    if (!puedeEditar || !file) return;
    setError("");
    setMensaje("");
    // Gate obligatorio (sección 3/10-D del ticket): si no pasa, NUNCA se
    // hace fetch — nunca depender solo de que el backend lo rechace.
    const problema = validarArchivo(file);
    if (problema) {
      setError(problema);
      return;
    }
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("tipo", tipo);
      const res = await fetch(
        `/api/empresas/${slug}/empleados/${empleadoId}/documentos`,
        { method: "POST", body: fd },
      );
      let data: { error?: string; mensaje?: string } = {};
      try {
        data = await res.json();
      } catch {
        setError(`Error del servidor (${res.status}). Revisa el Redeploy.`);
        return;
      }
      if (!res.ok) {
        setError(data.error ?? `No se pudo subir (${res.status})`);
        return;
      }
      setMensaje(data.mensaje ?? "Documento subido.");
      setFile(null);
      await cargar();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red al subir");
    } finally {
      setLoading(false);
    }
  }

  async function eliminar(id: number) {
    if (!puedeEditar) return;
    if (!confirm("¿Eliminar este documento?")) return;
    const res = await fetch(
      `/api/empresas/${slug}/empleados/documentos/${id}`,
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
            <h3 className="text-lg font-semibold">Expediente</h3>
            <p className="text-sm text-[var(--muted)]">{empleadoNombre}</p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Doble clic en la fila del empleado abre este panel.
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
            <label className="block text-sm text-[var(--muted)]">
              Tipo
              <select
                className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm"
                value={tipo}
                onChange={(e) =>
                  setTipo(e.target.value as (typeof TIPOS_DOCUMENTO)[number])
                }
              >
                {TIPOS_DOCUMENTO.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <input
              type="file"
              accept=".jpg,.jpeg,.png,.webp,.bmp,.pdf,image/*,application/pdf"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setError("");
                if (f) {
                  const problema = validarArchivo(f);
                  if (problema) {
                    setError(problema);
                    setFile(null);
                    e.target.value = "";
                    return;
                  }
                }
                setFile(f);
              }}
              className="block w-full text-sm text-[var(--muted)]"
            />
            <button
              type="button"
              disabled={!file}
              onClick={() => void subir()}
              className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm text-white disabled:opacity-40"
            >
              Subir archivo
            </button>
            <p className="text-xs text-[var(--muted)]">
              Formatos: jpg, png, webp, bmp, pdf · máx. {MAX_UPLOAD_MB} MB
            </p>
          </div>
        ) : null}

        {error ? <p className="mt-2 text-sm text-[#f0a0a0]">{error}</p> : null}
        {mensaje ? <p className="mt-2 text-sm text-[#8fd4a0]">{mensaje}</p> : null}

        <ul className="mt-4 space-y-2">
          {loading ? (
            <li className="text-sm text-[var(--muted)]">Cargando…</li>
          ) : docs.length === 0 ? (
            <li className="text-sm text-[var(--muted)]">Sin documentos.</li>
          ) : (
            docs.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {d.tipoDocumento}: {d.nombreOriginal || "archivo"}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <a
                    href={`/api/empresas/${slug}/empleados/documentos/${d.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded bg-[#1F6AA5] px-2 py-1 text-xs text-white"
                  >
                    Ver
                  </a>
                  {puedeEditar ? (
                    <button
                      type="button"
                      onClick={() => void eliminar(d.id)}
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
