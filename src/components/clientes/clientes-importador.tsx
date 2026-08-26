"use client";

import { useState, type ChangeEvent } from "react";

type PreviewFila = {
  filaExcel: number;
  codigo: string | null;
  nombre: string;
  nit: string | null;
  tipo?: string;
  estado?: string;
  estadoValidacion: "NUEVO" | "ACTUALIZAR" | "OMITIR" | "ERROR";
  detalle: string;
};

type Preview = {
  resumen: { total: number; nuevos: number; actualizar: number; omitidos: number; errores: number };
  filas: PreviewFila[];
};

export function ClientesImportador({ slug, onImported }: { slug: string; onImported: () => Promise<void> }) {
  const [archivo, setArchivo] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");

  function seleccionar(e: ChangeEvent<HTMLInputElement>) {
    setArchivo(e.target.files?.[0] ?? null);
    setPreview(null);
    setError("");
    setMensaje("");
  }

  async function procesar(accion: "validar" | "importar") {
    if (!archivo || procesando) return;
    setProcesando(true);
    setError("");
    setMensaje("");
    try {
      const form = new FormData();
      form.set("archivo", archivo);
      form.set("accion", accion);
      const res = await fetch(`/api/empresas/${slug}/clientes/import`, { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "No se pudo procesar el archivo.");
        return;
      }
      if (accion === "validar") {
        setPreview(data as Preview);
        setMensaje("Validación terminada. Revisa el resultado antes de importar.");
      } else {
        setMensaje(data.mensaje ?? "Importación finalizada.");
        setPreview(null);
        setArchivo(null);
        await onImported();
      }
    } catch {
      setError("Error de conexión al procesar el Excel.");
    } finally {
      setProcesando(false);
    }
  }

  return (
    <section className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-medium">Importación masiva de clientes</h2>
          <p className="text-xs text-[var(--muted)]">Descarga el formato oficial, agrega los clientes y valida el archivo antes de guardarlo.</p>
        </div>
        <a
          href={`/api/empresas/${slug}/clientes/import`}
          className="rounded border border-[var(--border)] px-3 py-1.5 text-xs"
        >
          Descargar formato Excel
        </a>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input type="file" accept=".xlsx,.xlsm" onChange={seleccionar} className="min-w-[260px] flex-1 rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm" />
        <button type="button" disabled={!archivo || procesando} onClick={() => void procesar("validar")} className="rounded bg-[#37474F] px-3 py-1.5 text-sm text-white disabled:opacity-50">
          {procesando ? "Procesando…" : "Validar Excel"}
        </button>
        <button type="button" disabled={!archivo || !preview || preview.resumen.errores > 0 || procesando} onClick={() => void procesar("importar")} className="rounded bg-[var(--accent)] px-3 py-1.5 text-sm text-white disabled:opacity-50">
          Importar clientes masivamente
        </button>
      </div>
      {error ? <p className="text-sm text-red-300">{error}</p> : null}
      {mensaje ? <p className="text-sm text-emerald-300">{mensaje}</p> : null}
      {preview ? (
        <div className="space-y-2">
          <p className="text-xs text-[var(--muted)]">
            Total {preview.resumen.total} · Nuevos {preview.resumen.nuevos} · Actualizar {preview.resumen.actualizar} · Omitidos {preview.resumen.omitidos} · Errores {preview.resumen.errores}
          </p>
          <div className="max-h-80 overflow-auto rounded border border-[var(--border)]">
            <table className="min-w-full text-left text-xs">
              <thead className="sticky top-0 bg-[var(--thead)] text-[var(--muted)]">
                <tr><th className="px-2 py-2">Fila</th><th className="px-2 py-2">Código</th><th className="px-2 py-2">Cliente</th><th className="px-2 py-2">NIT</th><th className="px-2 py-2">Resultado</th></tr>
              </thead>
              <tbody>
                {preview.filas.map((fila) => (
                  <tr key={fila.filaExcel} className="border-t border-[var(--border)]">
                    <td className="px-2 py-2">{fila.filaExcel}</td><td className="px-2 py-2">{fila.codigo || "—"}</td><td className="px-2 py-2">{fila.nombre || "—"}</td><td className="px-2 py-2">{fila.nit || "—"}</td>
                    <td className={`px-2 py-2 ${fila.estadoValidacion === "ERROR" ? "text-red-300" : fila.estadoValidacion === "NUEVO" ? "text-emerald-300" : "text-amber-300"}`}><strong>{fila.estadoValidacion}</strong> · {fila.detalle}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}
