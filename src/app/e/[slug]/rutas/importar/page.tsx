"use client";

import { useCallback, useEffect, useState, type ChangeEvent, type ReactNode } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

/**
 * VIAT-5 — Operaciones > Rutas > Importar Excel.
 *
 * Mismo patrón de 2 fases que RRHH > Marcajes > Importación manual
 * (accion=validar sin escribir nada, luego accion=importar con las
 * mismas filas + las decisiones que el usuario tomó en el preview):
 * ver src/app/e/[slug]/rrhh/marcajes/manual/page.tsx.
 *
 * NO convierte "Destino" en paradas — se importa tal cual a
 * destino_descripcion. NO sobrescribe códigos existentes salvo que el
 * usuario elija explícitamente "Actualizar" fila por fila (default:
 * Omitir). Cliente/ubicación/contacto se reutilizan si ya existen
 * (comparación normalizada); solo se crean cuando genuinamente no hay
 * coincidencia, y siempre visible antes de confirmar.
 */

type ClienteOpt = { id: number; nombre: string };

type EstadoFilaRuta =
  | "nueva"
  | "actualizar"
  | "omitir"
  | "cliente_nuevo"
  | "cliente_ambiguo"
  | "duplicado_en_archivo"
  | "error";

type CandidatoCliente = { id: number; nombre: string };

type PreviewFilaRuta = {
  filaExcel: number;
  codigo: string;
  clienteExcel: string;
  lugarCargaExcel: string;
  horaExcel: string | null;
  contactoExcel: string;
  destinoExcel: string;
  estado: EstadoFilaRuta;
  detalle: string;
  clienteId: number | null;
  clienteNombre: string | null;
  clienteCandidatos: CandidatoCliente[];
  ubicacionId: number | null;
  ubicacionEsNueva: boolean;
  contactoId: number | null;
  contactoEsNuevo: boolean;
  rutaExistenteId: number | null;
};

type ResumenPreviewRutas = {
  total: number;
  nuevas: number;
  actualizables: number;
  omitidas: number;
  clientesNuevos: number;
  clientesAmbiguos: number;
  duplicadosEnArchivo: number;
  errores: number;
};

type ResultadoImportacionRutas = {
  procesadas: number;
  creadas: number;
  actualizadas: number;
  omitidas: number;
  clientesCreados: number;
  ubicacionesCreadas: number;
  contactosCreados: number;
  errores: number;
  erroresDetalle: string[];
};

type RespuestaValidar = { accion: "validar"; filas: PreviewFilaRuta[]; resumen: ResumenPreviewRutas; erroresDetalle: string[] };
type RespuestaImportar = { accion: "importar"; resultado: ResultadoImportacionRutas };

/** Decisión tomada en pantalla para una fila (por filaExcel). -1 = crear cliente nuevo. */
type Decision = { clienteIdElegido?: number | -1; actualizarExistente?: boolean };

const ESTADO_LABEL: Record<EstadoFilaRuta, string> = {
  nueva: "Ruta nueva",
  actualizar: "Se actualizará",
  omitir: "Código ya existe — se omite",
  cliente_nuevo: "Cliente no encontrado",
  cliente_ambiguo: "Cliente ambiguo — elegir",
  duplicado_en_archivo: "Duplicado en el archivo",
  error: "Error",
};

const ESTADO_CLASS: Record<EstadoFilaRuta, string> = {
  nueva: "text-emerald-300",
  actualizar: "text-sky-300",
  omitir: "text-[var(--muted)]",
  cliente_nuevo: "text-amber-300",
  cliente_ambiguo: "text-amber-300",
  duplicado_en_archivo: "text-red-300",
  error: "text-red-300",
};

const input =
  "mt-1 w-full rounded border border-[var(--border)] bg-[var(--input)] px-2 py-2 text-sm";

async function leerJsonSeguro(res: Response): Promise<Record<string, unknown>> {
  const texto = await res.text();
  if (!texto.trim()) return {};
  try {
    return JSON.parse(texto) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export default function ImportarRutasPage() {
  const slug = String(useParams().slug);

  const [clientes, setClientes] = useState<ClienteOpt[]>([]);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [validando, setValidando] = useState(false);
  const [importando, setImportando] = useState(false);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [preview, setPreview] = useState<RespuestaValidar | null>(null);
  const [resultado, setResultado] = useState<ResultadoImportacionRutas | null>(null);
  const [decisiones, setDecisiones] = useState<Record<number, Decision>>({});

  const cargarClientes = useCallback(async () => {
    const res = await fetch(`/api/empresas/${slug}/tms/catalogos`);
    const data = await res.json().catch(() => ({}));
    if (res.ok) setClientes((data.clientes ?? []) as ClienteOpt[]);
  }, [slug]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargarClientes();
  }, [cargarClientes]);

  function cambiarArchivo(e: ChangeEvent<HTMLInputElement>) {
    setArchivo(e.target.files?.[0] ?? null);
    setPreview(null);
    setResultado(null);
    setDecisiones({});
    setError("");
    setMensaje("");
  }

  function setDecision(filaExcel: number, patch: Partial<Decision>) {
    setDecisiones((d) => ({ ...d, [filaExcel]: { ...d[filaExcel], ...patch } }));
  }

  async function previsualizar() {
    if (!archivo) {
      setError("Selecciona un archivo Excel (.xlsx).");
      return;
    }
    setError("");
    setMensaje("");
    setResultado(null);
    setValidando(true);
    try {
      const formData = new FormData();
      formData.set("archivo", archivo);
      formData.set("accion", "validar");
      const res = await fetch(`/api/empresas/${slug}/tms/rutas/importar`, { method: "POST", body: formData });
      const data = await leerJsonSeguro(res);
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "No se pudo validar el archivo.");
        return;
      }
      const respuesta = data as unknown as RespuestaValidar;
      setPreview(respuesta);
      setDecisiones({});
    } catch {
      setError("Error de conexión al validar el archivo.");
    } finally {
      setValidando(false);
    }
  }

  async function confirmar() {
    if (!archivo || !preview) return;
    setError("");
    setMensaje("");
    setImportando(true);
    try {
      const formData = new FormData();
      formData.set("archivo", archivo);
      formData.set("accion", "importar");
      const listaDecisiones = Object.entries(decisiones).map(([filaExcel, d]) => ({
        filaExcel: Number(filaExcel),
        ...d,
      }));
      formData.set("decisiones", JSON.stringify(listaDecisiones));
      const res = await fetch(`/api/empresas/${slug}/tms/rutas/importar`, { method: "POST", body: formData });
      const data = await leerJsonSeguro(res);
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "No se pudo completar la importación.");
        return;
      }
      const respuesta = data as unknown as RespuestaImportar;
      setResultado(respuesta.resultado);
      setMensaje("Importación finalizada.");
    } catch {
      setError("Error de conexión al importar.");
    } finally {
      setImportando(false);
    }
  }

  const pendientesDecision = (preview?.filas ?? []).filter(
    (f) => f.estado === "cliente_ambiguo" || f.estado === "cliente_nuevo",
  ).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Importar rutas desde Excel</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Carga el catálogo de códigos/rutas desde la hoja &quot;CODIGOS DATA&quot; de un Excel
            (.xlsx). Primero se previsualiza sin guardar nada; solo se escribe al confirmar.
          </p>
        </div>
        <Link href={`/e/${slug}/rutas`} className="rounded border border-[var(--border)] px-3 py-2 text-xs">
          ← Volver a Rutas
        </Link>
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3 text-xs text-[var(--muted)]">
        <p>Columnas esperadas en &quot;CODIGOS DATA&quot;: Código · Cliente · Lugar de carga · Hora · Contacto · Destino.</p>
        <p className="mt-1">
          Los códigos que ya existen se omiten por defecto — puedes marcarlos individualmente para
          actualizar. Los clientes se reutilizan por nombre; solo se crean nuevos cuando no hay
          coincidencia, y siempre quedan visibles antes de confirmar.
        </p>
      </div>

      <section className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <input type="file" accept=".xlsx" onChange={cambiarArchivo} className={input} />
          <button
            type="button"
            disabled={!archivo || validando || importando}
            onClick={() => void previsualizar()}
            className="self-end rounded bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {validando ? "Validando…" : "Previsualizar"}
          </button>
        </div>
        {archivo ? <p className="text-xs text-[var(--muted)]">Archivo seleccionado: {archivo.name}</p> : null}
        {error ? <p className="text-sm text-red-300">{error}</p> : null}
        {mensaje ? <p className="text-sm text-emerald-300">{mensaje}</p> : null}

        {preview ? (
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-4 lg:grid-cols-8">
              <ResumenCard label="Total" value={preview.resumen.total} />
              <ResumenCard label="Nuevas" value={preview.resumen.nuevas} className="text-emerald-300" />
              <ResumenCard label="Código ya existe (omitir)" value={preview.resumen.omitidas} />
              <ResumenCard label="Clientes nuevos" value={preview.resumen.clientesNuevos} className="text-amber-300" />
              <ResumenCard label="Clientes ambiguos" value={preview.resumen.clientesAmbiguos} className="text-amber-300" />
              <ResumenCard label="Duplicados en archivo" value={preview.resumen.duplicadosEnArchivo} className="text-red-300" />
              <ResumenCard label="Errores" value={preview.resumen.errores} className="text-red-300" />
            </div>

            {pendientesDecision > 0 ? (
              <p className="text-xs text-amber-300">
                {pendientesDecision} fila(s) requieren elegir el cliente antes de confirmar (o se
                crearán como cliente nuevo por defecto).
              </p>
            ) : null}

            <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
              <table className="min-w-full text-left text-xs">
                <thead className="bg-[var(--thead)] text-[var(--muted)]">
                  <tr>
                    <th className="px-2 py-2">Fila</th>
                    <th className="px-2 py-2">Código</th>
                    <th className="px-2 py-2">Cliente (Excel)</th>
                    <th className="px-2 py-2">Lugar de carga</th>
                    <th className="px-2 py-2">Hora</th>
                    <th className="px-2 py-2">Contacto</th>
                    <th className="px-2 py-2">Destino</th>
                    <th className="px-2 py-2">Estado</th>
                    <th className="px-2 py-2">Decisión</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.filas.map((f) => (
                    <tr key={f.filaExcel} className="border-t border-[var(--border)] align-top">
                      <td className="px-2 py-2">{f.filaExcel}</td>
                      <td className="px-2 py-2 font-mono">{f.codigo || "—"}</td>
                      <td className="px-2 py-2">{f.clienteExcel || "—"}</td>
                      <td className="px-2 py-2">{f.lugarCargaExcel || "—"}</td>
                      <td className="px-2 py-2">{f.horaExcel || "—"}</td>
                      <td className="px-2 py-2">{f.contactoExcel || "—"}</td>
                      <td className="px-2 py-2">{f.destinoExcel || "—"}</td>
                      <td className={`px-2 py-2 font-medium ${ESTADO_CLASS[f.estado]}`}>{ESTADO_LABEL[f.estado]}</td>
                      <td className="px-2 py-2">
                        <FilaDecision fila={f} clientes={clientes} decision={decisiones[f.filaExcel]} onChange={(patch) => setDecision(f.filaExcel, patch)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {preview.erroresDetalle.length ? (
              <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3">
                <p className="text-xs font-medium text-red-300">Detalle de filas con problema</p>
                <ul className="mt-1 space-y-0.5 text-[11px] text-[var(--muted)]">
                  {preview.erroresDetalle.map((linea, i) => (
                    <li key={i}>{linea}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                disabled={importando || validando}
                onClick={() => void confirmar()}
                className="rounded bg-[#1B5E20] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {importando ? "Importando…" : "Confirmar importación"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPreview(null);
                  setDecisiones({});
                }}
                className="rounded border border-[var(--border)] px-4 py-2 text-sm"
              >
                Limpiar vista previa
              </button>
            </div>
          </div>
        ) : null}

        {resultado ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3 text-sm">
            <p className="font-medium">Resultado final</p>
            <p className="mt-1 text-[var(--muted)]">
              Procesadas: {resultado.procesadas} · Creadas: {resultado.creadas} · Actualizadas:{" "}
              {resultado.actualizadas} · Omitidas: {resultado.omitidas} · Con error: {resultado.errores}
            </p>
            <p className="mt-1 text-[var(--muted)]">
              Clientes creados: {resultado.clientesCreados} · Ubicaciones creadas:{" "}
              {resultado.ubicacionesCreadas} · Contactos creados: {resultado.contactosCreados}
            </p>
            {resultado.erroresDetalle.length ? (
              <div className="mt-2">
                <p className="text-xs font-medium text-red-300">Errores</p>
                <ul className="mt-1 space-y-0.5 text-[11px] text-[var(--muted)]">
                  {resultado.erroresDetalle.map((linea, i) => (
                    <li key={i}>{linea}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <Link href={`/e/${slug}/rutas`} className="mt-3 inline-block rounded bg-[var(--accent)] px-3 py-1.5 text-xs text-white">
              Ver catálogo de Rutas
            </Link>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function ResumenCard({ label, value, className }: { label: string; value: number; className?: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] p-3">
      <p className="text-[10px] text-[var(--muted)]">{label}</p>
      <p className={`text-lg font-semibold ${className ?? ""}`}>{value}</p>
    </div>
  );
}

function FilaDecision({
  fila,
  clientes,
  decision,
  onChange,
}: {
  fila: PreviewFilaRuta;
  clientes: ClienteOpt[];
  decision: Decision | undefined;
  onChange: (patch: Partial<Decision>) => void;
}) {
  const necesitaCliente = fila.estado === "cliente_ambiguo" || fila.estado === "cliente_nuevo";
  const controles: ReactNode[] = [];

  if (necesitaCliente) {
    const opciones = fila.estado === "cliente_ambiguo" ? fila.clienteCandidatos : clientes;
    controles.push(
      <select
        key="cliente"
        className="rounded border border-[var(--border)] bg-[var(--input)] px-1.5 py-1 text-[11px]"
        value={decision?.clienteIdElegido ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          onChange({ clienteIdElegido: v === "-1" ? -1 : v ? Number(v) : undefined });
        }}
      >
        <option value="">— Elegir cliente —</option>
        <option value="-1">Crear cliente nuevo: &quot;{fila.clienteExcel}&quot;</option>
        {opciones.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nombre}
          </option>
        ))}
      </select>,
    );
  }

  if (fila.rutaExistenteId) {
    controles.push(
      <label key="actualizar" className="flex items-center gap-1 text-[11px]">
        <input
          type="checkbox"
          checked={decision?.actualizarExistente ?? false}
          onChange={(e) => onChange({ actualizarExistente: e.target.checked })}
        />
        Código {fila.codigo} ya existe — actualizar (si no, se omite)
      </label>,
    );
  }

  if (!controles.length) return <span className="text-[11px] text-[var(--muted)]">—</span>;
  return <div className="flex flex-col gap-1">{controles}</div>;
}
