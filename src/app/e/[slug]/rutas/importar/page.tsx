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
 *
 * La resolución de cliente se decide POR GRUPO (sección "Clientes por
 * resolver"): una sola decisión por nombre normalizado se aplica a TODAS
 * las filas de ese cliente Excel — no se pide elegir cliente fila por
 * fila cuando un mismo cliente aparece en muchas rutas.
 */

type ClienteOpt = { id: number; nombre: string };

type EstadoFilaRuta = "nueva" | "omitir" | "cliente_nuevo" | "cliente_ambiguo" | "duplicado_en_archivo" | "error";

type PreviewFilaRuta = {
  filaExcel: number;
  codigo: string;
  clienteExcel: string;
  clienteExcelNormalizado: string;
  lugarCargaExcel: string;
  horaExcel: string | null;
  contactoExcel: string;
  destinoExcel: string;
  estado: EstadoFilaRuta;
  detalle: string;
  clienteId: number | null;
  clienteNombre: string | null;
  ubicacionId: number | null;
  ubicacionEsNueva: boolean;
  contactoId: number | null;
  contactoEsNuevo: boolean;
  rutaExistenteId: number | null;
  clienteActualId: number | null;
  clienteActualNombre: string | null;
  cambioClienteDetectado: boolean;
};

type TipoGrupoCliente = "ambiguo" | "nuevo";

type CandidatoCliente = { id: number; nombre: string };

type GrupoClientePendiente = {
  clienteExcelNormalizado: string;
  clienteExcelNombre: string;
  tipo: TipoGrupoCliente;
  candidatos: CandidatoCliente[];
  filas: number[];
  cantidadFilas: number;
};

type ResumenPreviewRutas = {
  registrosDetectados: number;
  filasIncompletas: number;
  duplicadosEnArchivo: number;
  rutasListas: number;
  codigosExistentes: number;
  rutasPendientesCliente: number;
  clientesUnicosPorResolver: number;
  clientesAmbiguosUnicos: number;
  clientesNuevosUnicos: number;
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

type RespuestaValidar = {
  accion: "validar";
  filas: PreviewFilaRuta[];
  resumen: ResumenPreviewRutas;
  clientesPorResolver: GrupoClientePendiente[];
  erroresDetalle: string[];
};
type RespuestaImportar = { accion: "importar"; resultado: ResultadoImportacionRutas };

/** Decisión por fila (solo lo que es inherentemente por código, no por cliente). */
type DecisionFila = { actualizarExistente?: boolean; confirmarCambioCliente?: boolean };

const ESTADO_LABEL: Record<EstadoFilaRuta, string> = {
  nueva: "Ruta nueva",
  omitir: "Código ya existe — se omite",
  cliente_nuevo: "Cliente no encontrado",
  cliente_ambiguo: "Cliente ambiguo",
  duplicado_en_archivo: "Duplicado en el archivo",
  error: "Error",
};

const ESTADO_CLASS: Record<EstadoFilaRuta, string> = {
  nueva: "text-emerald-300",
  omitir: "text-[var(--muted)]",
  cliente_nuevo: "text-amber-300",
  cliente_ambiguo: "text-amber-300",
  duplicado_en_archivo: "text-red-300",
  error: "text-red-300",
};

const input = "mt-1 w-full rounded border border-[var(--border)] bg-[var(--input)] px-2 py-2 text-sm";

async function leerJsonSeguro(res: Response): Promise<Record<string, unknown>> {
  const texto = await res.text();
  if (!texto.trim()) return {};
  try {
    return JSON.parse(texto) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Verifica en runtime que la respuesta de accion=validar tenga la forma
 * esperada ANTES de guardarla en el estado — un contrato roto entre
 * backend y frontend (p. ej. una colección que el backend deja de
 * mandar) no debe tumbar la página entera con un `.length`/`.map` sobre
 * `undefined`. Si algo no cuadra, se registra en consola (el error real
 * no se oculta) y se le pide al usuario reintentar, sin crashear.
 */
function respuestaValidarValida(data: Record<string, unknown>): data is RespuestaValidar {
  return (
    data.accion === "validar" &&
    Array.isArray(data.filas) &&
    Array.isArray(data.clientesPorResolver) &&
    Array.isArray(data.erroresDetalle) &&
    typeof data.resumen === "object" &&
    data.resumen !== null
  );
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
  const [decisionesFila, setDecisionesFila] = useState<Record<number, DecisionFila>>({});
  /** clienteExcelNormalizado -> clienteId elegido (-1 = crear nuevo). Una decisión cubre TODAS las filas de ese cliente. */
  const [decisionesCliente, setDecisionesCliente] = useState<Record<string, number>>({});

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
    setDecisionesFila({});
    setDecisionesCliente({});
    setError("");
    setMensaje("");
  }

  function setDecisionFila(filaExcel: number, patch: Partial<DecisionFila>) {
    setDecisionesFila((d) => ({ ...d, [filaExcel]: { ...d[filaExcel], ...patch } }));
  }

  function setDecisionCliente(clienteExcelNormalizado: string, clienteIdElegido: number) {
    setDecisionesCliente((d) => ({ ...d, [clienteExcelNormalizado]: clienteIdElegido }));
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
      if (!respuestaValidarValida(data)) {
        console.error("Respuesta de accion=validar con forma inesperada:", data);
        setError("No se pudo interpretar la previsualización. Intenta nuevamente.");
        return;
      }
      setPreview(data);
      setDecisionesFila({});
      setDecisionesCliente({});
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
      const listaDecisionesFila = Object.entries(decisionesFila).map(([filaExcel, d]) => ({
        filaExcel: Number(filaExcel),
        ...d,
      }));
      formData.set("decisiones", JSON.stringify(listaDecisionesFila));
      const listaDecisionesCliente = Object.entries(decisionesCliente).map(([clienteExcelNormalizado, clienteIdElegido]) => ({
        clienteExcelNormalizado,
        clienteIdElegido,
      }));
      formData.set("decisionesCliente", JSON.stringify(listaDecisionesCliente));
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

  // Defensas de UI (además del contrato ya corregido en el backend): estas
  // colecciones NUNCA deberían venir ausentes, pero si algún día vuelven a
  // faltar, la pantalla se degrada con listas vacías en vez de caerse.
  const filasPreview = preview?.filas ?? [];
  const clientesPorResolverPreview = preview?.clientesPorResolver ?? [];
  const erroresDetallePreview = preview?.erroresDetalle ?? [];

  const gruposPendientes = clientesPorResolverPreview.filter(
    (g) => decisionesCliente[g.clienteExcelNormalizado] === undefined,
  ).length;

  function nombreClientePorId(id: number): string {
    return clientes.find((c) => c.id === id)?.nombre ?? `#${id}`;
  }

  /** Texto derivado para la columna Decisión de una fila cuyo cliente depende de un grupo. */
  function textoDecisionGrupo(fila: PreviewFilaRuta): string {
    const elegido = decisionesCliente[fila.clienteExcelNormalizado];
    if (elegido === undefined) return "Pendiente en Clientes por resolver";
    if (elegido === -1) return `Creará cliente nuevo: "${fila.clienteExcel}"`;
    return `Usará: ${nombreClientePorId(elegido)}`;
  }

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
        <div className="flex flex-wrap gap-2">
          <a href={`/api/empresas/${slug}/tms/rutas/importar`} className="rounded bg-[#1F6AA5] px-3 py-2 text-xs text-white">
            Descargar formato Excel
          </a>
          <Link href={`/e/${slug}/rutas`} className="rounded border border-[var(--border)] px-3 py-2 text-xs">
            ← Volver a Rutas
          </Link>
        </div>
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3 text-xs text-[var(--muted)]">
        <p>
          El formato incluye encabezados claros, una fila amarilla de ejemplo y una hoja AYUDA.
          Debes llenar: Código de ruta · Cliente · Lugar de carga · Hora habitual · Contacto · Destino.
        </p>
        <p className="mt-1">
          Los códigos que ya existen se omiten por defecto — puedes marcarlos individualmente para
          actualizar. Si un mismo cliente aparece en varias rutas, se resuelve UNA sola vez en
          &quot;Clientes por resolver&quot; y se aplica a todas.
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
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
              <ResumenCard label="Registros detectados" value={preview.resumen.registrosDetectados ?? 0} />
              <ResumenCard label="Rutas listas" value={preview.resumen.rutasListas ?? 0} className="text-emerald-300" />
              <ResumenCard label="Códigos existentes" value={preview.resumen.codigosExistentes ?? 0} />
              <ResumenCard label="Filas incompletas" value={preview.resumen.filasIncompletas ?? 0} className="text-red-300" />
              <ResumenCard label="Duplicados en archivo" value={preview.resumen.duplicadosEnArchivo ?? 0} className="text-red-300" />
              <ResumenCard label="Rutas pendientes de cliente" value={preview.resumen.rutasPendientesCliente ?? 0} className="text-amber-300" />
              <ResumenCard label="Clientes únicos por resolver" value={preview.resumen.clientesUnicosPorResolver ?? 0} className="text-amber-300" />
              <ResumenCard label="— ambiguos" value={preview.resumen.clientesAmbiguosUnicos ?? 0} className="text-amber-300" />
              <ResumenCard label="— nuevos" value={preview.resumen.clientesNuevosUnicos ?? 0} className="text-amber-300" />
            </div>

            {clientesPorResolverPreview.length ? (
              <div className="space-y-2 rounded-lg border border-amber-700/50 bg-[var(--panel)] p-3">
                <p className="text-sm font-medium">
                  Clientes por resolver ({clientesPorResolverPreview.length})
                  {gruposPendientes > 0 ? (
                    <span className="ml-2 text-xs font-normal text-amber-300">
                      {gruposPendientes} sin decisión — esas filas no se importarán hasta resolverse.
                    </span>
                  ) : null}
                </p>
                <div className="space-y-2">
                  {clientesPorResolverPreview.map((g) => (
                    <GrupoClienteRow
                      key={g.clienteExcelNormalizado}
                      grupo={g}
                      clientes={clientes}
                      valor={decisionesCliente[g.clienteExcelNormalizado]}
                      onChange={(v) => setDecisionCliente(g.clienteExcelNormalizado, v)}
                    />
                  ))}
                </div>
              </div>
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
                  {filasPreview.map((f) => (
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
                        <FilaDecision
                          fila={f}
                          decision={decisionesFila[f.filaExcel]}
                          textoGrupo={
                            f.estado === "cliente_ambiguo" || f.estado === "cliente_nuevo" ? textoDecisionGrupo(f) : null
                          }
                          onChange={(patch) => setDecisionFila(f.filaExcel, patch)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {erroresDetallePreview.length ? (
              <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3">
                <p className="text-xs font-medium text-red-300">Detalle de filas con problema</p>
                <ul className="mt-1 space-y-0.5 text-[11px] text-[var(--muted)]">
                  {erroresDetallePreview.map((linea, i) => (
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
                  setDecisionesFila({});
                  setDecisionesCliente({});
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

function GrupoClienteRow({
  grupo,
  clientes,
  valor,
  onChange,
}: {
  grupo: GrupoClientePendiente;
  clientes: ClienteOpt[];
  valor: number | undefined;
  onChange: (clienteIdElegido: number) => void;
}) {
  const opciones = grupo.tipo === "ambiguo" ? grupo.candidatos : clientes;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded border border-[var(--border)] bg-[var(--card)] p-2 text-xs">
      <span className="min-w-[160px] font-medium">
        {grupo.clienteExcelNombre} — {grupo.cantidadFilas} ruta(s)
      </span>
      <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${grupo.tipo === "ambiguo" ? "bg-amber-900/40 text-amber-200" : "bg-sky-900/40 text-sky-200"}`}>
        {grupo.tipo === "ambiguo" ? "Ambiguo" : "No encontrado"}
      </span>
      <select
        className="rounded border border-[var(--border)] bg-[var(--input)] px-1.5 py-1"
        value={valor ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          if (v) onChange(v === "-1" ? -1 : Number(v));
        }}
      >
        <option value="">— Elegir cliente —</option>
        <option value="-1">Crear cliente nuevo: &quot;{grupo.clienteExcelNombre}&quot;</option>
        {opciones.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nombre}
          </option>
        ))}
      </select>
    </div>
  );
}

function FilaDecision({
  fila,
  decision,
  textoGrupo,
  onChange,
}: {
  fila: PreviewFilaRuta;
  decision: DecisionFila | undefined;
  textoGrupo: string | null;
  onChange: (patch: Partial<DecisionFila>) => void;
}) {
  const controles: ReactNode[] = [];

  if (textoGrupo) {
    controles.push(
      <span key="grupo" className="text-[11px] text-[var(--muted)]">
        {textoGrupo}
      </span>,
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

    // El cliente actual de la ruta puede diferir del que trae el Excel
    // (match exacto a OTRO cliente, o todavía sin resolver por ser
    // ambiguo/nuevo). Nunca se reasigna sin marcar esto explícitamente —
    // el servidor lo exige aparte, esto es solo para que quede visible
    // antes de confirmar.
    const podriaCambiarCliente = fila.clienteActualNombre != null && (fila.cambioClienteDetectado || Boolean(textoGrupo));
    if (decision?.actualizarExistente && podriaCambiarCliente) {
      controles.push(
        <label key="cambiocliente" className="flex items-center gap-1 text-[11px] text-amber-300">
          <input
            type="checkbox"
            checked={decision?.confirmarCambioCliente ?? false}
            onChange={(e) => onChange({ confirmarCambioCliente: e.target.checked })}
          />
          Ruta actualmente de &quot;{fila.clienteActualNombre}&quot; — confirmar reasignar a otro cliente
        </label>,
      );
    }
  }

  if (!controles.length) return <span className="text-[11px] text-[var(--muted)]">—</span>;
  return <div className="flex flex-col gap-1">{controles}</div>;
}
