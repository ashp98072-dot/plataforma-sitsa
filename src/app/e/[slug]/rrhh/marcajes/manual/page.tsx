"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { horaAhora } from "@/lib/rrhh/dates";
import { useEmpresaSession } from "@/lib/empresa-session";

type Emp = {
  id: number;
  numeroEmpleado: string;
  codigo: string;
  nombre: string;
};

type PreviewEstado = "valida" | "actualizar" | "conflicto" | "error";

type PreviewFila = {
  filaExcel: number;
  numeroEmpleado: string;
  empleadoId?: number;
  nombre?: string;
  fecha: string;
  entrada: string | null;
  salida: string | null;
  observacion: string | null;
  estado: PreviewEstado;
  accion?: "crear" | "completar";
  detalle: string;
};

type ResumenImportacion = {
  total: number;
  validas: number;
  actualizables: number;
  conflictos: number;
  errores: number;
  creados?: number;
  completados?: number;
  omitidos?: number;
};

type RespuestaImportacion = {
  accion: "validar" | "importar";
  mensaje?: string;
  resumen: ResumenImportacion;
  filas: PreviewFila[];
  erroresDetalle?: string[];
};

async function leerJsonSeguro(
  res: Response,
): Promise<Record<string, unknown>> {
  const texto = await res.text();

  if (!texto.trim()) {
    return {};
  }

  try {
    return JSON.parse(texto) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function estadoLabel(estado: PreviewEstado): string {
  switch (estado) {
    case "valida":
      return "Nuevo";
    case "actualizar":
      return "Completar";
    case "conflicto":
      return "Conflicto";
    case "error":
      return "Error";
  }
}

function estadoClass(estado: PreviewEstado): string {
  switch (estado) {
    case "valida":
      return "text-emerald-300";
    case "actualizar":
      return "text-sky-300";
    case "conflicto":
      return "text-amber-300";
    case "error":
      return "text-red-300";
  }
}

/** Corrección RRHH como Control de Asistencias: fecha + hora + guardar. */
export default function MarcajeManualPage() {
  const slug = String(useParams().slug);
  const router = useRouter();
  const { rol } = useEmpresaSession();

  const [empleados, setEmpleados] = useState<Emp[]>([]);
  const [buscar, setBuscar] = useState("");
  const [empleadoId, setEmpleadoId] = useState(0);
  const [codigo, setCodigo] = useState("");
  const [numeroEmpleado, setNumeroEmpleado] = useState("");

  const [fecha, setFecha] = useState(
    new Date().toISOString().slice(0, 10),
  );

  const [hora, setHora] = useState(horaAhora());
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const [correccion, setCorreccion] = useState<{
    entradaActual?: string;
    salidaActual?: string;
  } | null>(null);

  const [registros, setRegistros] = useState<
    Record<string, unknown>[]
  >([]);

  const [fechaFiltro, setFechaFiltro] = useState(
    new Date().toISOString().slice(0, 10),
  );

  const [allowed, setAllowed] = useState(false);

  const [archivoExcel, setArchivoExcel] = useState<File | null>(
    null,
  );

  const [validando, setValidando] = useState(false);
  const [importando, setImportando] = useState(false);

  const [resultadoImport, setResultadoImport] =
    useState<RespuestaImportacion | null>(null);

  const [errorImport, setErrorImport] = useState("");
  const [mensajeImport, setMensajeImport] = useState("");

  const cargar = useCallback(async () => {
    if (rol === "Marcaje") {
      router.replace(`/e/${slug}/rrhh/marcajes`);
      return;
    }

    setAllowed(true);

    try {
      const res = await fetch(
        `/api/empresas/${slug}/empleados`,
      );

      const data = await leerJsonSeguro(res);

      if (!res.ok) {
        setEmpleados([]);
        return;
      }

      setEmpleados(
        Array.isArray(data.empleados)
          ? (data.empleados as Emp[])
          : [],
      );
    } catch {
      setEmpleados([]);
    }
  }, [slug, router, rol]);

  const cargarRegistros = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/empresas/${slug}/rrhh/marcajes?desde=${fechaFiltro}&hasta=${fechaFiltro}`,
      );

      const data = await leerJsonSeguro(res);

      setRegistros(
        Array.isArray(data.marcajes)
          ? (data.marcajes as Record<string, unknown>[])
          : [],
      );
    } catch {
      setRegistros([]);
    }
  }, [slug, fechaFiltro]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  useEffect(() => {
    void cargarRegistros();
  }, [cargarRegistros]);

  const filtrados = useMemo(() => {
    const q = buscar.trim().toLowerCase();

    if (!q) {
      return empleados.slice(0, 80);
    }

    return empleados
      .filter((e) => {
        const numero = (e.numeroEmpleado || "").toLowerCase();
        const codigoInterno = (e.codigo || "").toLowerCase();

        return (
          e.nombre.toLowerCase().includes(q) ||
          numero.includes(q) ||
          codigoInterno.includes(q)
        );
      })
      .slice(0, 80);
  }, [empleados, buscar]);

  useEffect(() => {
    if (!empleadoId) {
      setCodigo("");
      setNumeroEmpleado("");
      return;
    }

    const e = empleados.find(
      (x) => x.id === empleadoId,
    );

    if (!e) {
      return;
    }

    setCodigo(e.codigo);
    setNumeroEmpleado(e.numeroEmpleado);
  }, [empleadoId, empleados]);

  async function enviar(
    correccionTipo?: "entrada" | "salida",
  ) {
    setError("");
    setMsg("");

    if (!empleadoId) {
      setError("Selecciona un empleado.");
      return;
    }

    try {
      const res = await fetch(
        `/api/empresas/${slug}/rrhh/marcajes`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            empleadoId,
            codigo: codigo || undefined,
            fechaJornada: fecha,
            hora,
            correccion: correccionTipo ?? null,
          }),
        },
      );

      const data = await leerJsonSeguro(res);

      if (
        res.status === 409 &&
        data.code === "NEEDS_CORRECTION"
      ) {
        setCorreccion({
          entradaActual:
            typeof data.entradaActual === "string"
              ? data.entradaActual
              : undefined,
          salidaActual:
            typeof data.salidaActual === "string"
              ? data.salidaActual
              : undefined,
        });

        setError(
          typeof data.error === "string"
            ? data.error
            : "El registro requiere corrección.",
        );

        return;
      }

      if (!res.ok) {
        setError(
          typeof data.error === "string"
            ? data.error
            : "No se pudo guardar el marcaje.",
        );
        return;
      }

      setMsg(
        typeof data.mensaje === "string"
          ? data.mensaje
          : "Marcaje guardado.",
      );

      setCorreccion(null);
      setFechaFiltro(fecha);

      await cargarRegistros();
    } catch {
      setError("Error de red al guardar el marcaje.");
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await enviar();
  }

  function cambiarArchivo(
    e: ChangeEvent<HTMLInputElement>,
  ) {
    const file = e.target.files?.[0] ?? null;

    setArchivoExcel(file);
    setResultadoImport(null);
    setErrorImport("");
    setMensajeImport("");
  }

  async function procesarExcel(
    accion: "validar" | "importar",
  ) {
    if (!archivoExcel) {
      setErrorImport("Selecciona un archivo Excel.");
      return;
    }

    setErrorImport("");
    setMensajeImport("");

    if (accion === "validar") {
      setValidando(true);
    } else {
      setImportando(true);
    }

    try {
      const formData = new FormData();

      formData.set("archivo", archivoExcel);
      formData.set("accion", accion);

      const res = await fetch(
        `/api/empresas/${slug}/rrhh/marcajes/importar`,
        {
          method: "POST",
          body: formData,
        },
      );

      const texto = await res.text();

      let data: Record<string, unknown> = {};

      if (texto.trim()) {
        try {
          data = JSON.parse(texto) as Record<
            string,
            unknown
          >;
        } catch {
          data = {};
        }
      }

      if (!res.ok) {
        setErrorImport(
          typeof data.error === "string"
            ? data.error
            : `No se pudo ${
                accion === "validar"
                  ? "validar"
                  : "importar"
              } el archivo.`,
        );

        return;
      }

      const respuesta =
        data as unknown as RespuestaImportacion;

      setResultadoImport(respuesta);

      if (accion === "importar") {
        setMensajeImport(
          respuesta.mensaje ??
            "Importación finalizada correctamente.",
        );

        setFechaFiltro(fecha);
        await cargarRegistros();
      }
    } catch {
      setErrorImport(
        "Error de red al procesar el archivo Excel.",
      );
    } finally {
      setValidando(false);
      setImportando(false);
    }
  }

  const input =
    "mt-1 w-full rounded border border-[var(--border)] bg-[var(--input)] px-2 py-2 text-sm";

  const importables =
    (resultadoImport?.resumen.validas ?? 0) +
    (resultadoImport?.resumen.actualizables ?? 0);

  const filasPreview =
    resultadoImport?.filas.slice(0, 100) ?? [];

  if (!allowed) {
    return (
      <p className="text-sm text-[var(--muted)]">
        Cargando…
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">
          Control de Asistencias Diarias (Modo Manual RRHH)
        </h1>

        <p className="text-sm text-[var(--muted)]">
          Registro individual y carga masiva de entradas y
          salidas. El personal utiliza el{" "}
          <Link
            href={`/e/${slug}/rrhh/marcajes`}
            className="text-[var(--accent)] underline"
          >
            kiosko
          </Link>
          .
        </p>
      </div>

      <form
        onSubmit={onSubmit}
        className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"
      >
        <h2 className="font-medium">
          Registrar / forzar marcaje manual
        </h2>

        <label className="block text-sm text-[var(--muted)]">
          Buscar por nombre o número de empleado
          <div className="mt-1 flex gap-2">
            <input
              className={`${input} mt-0`}
              value={buscar}
              onChange={(e) =>
                setBuscar(e.target.value)
              }
              placeholder="Ej. 000009 o parte del nombre…"
            />
          </div>
        </label>

        <label className="block text-sm text-[var(--muted)]">
          Seleccionar empleado
          <select
            className={input}
            value={empleadoId}
            onChange={(e) =>
              setEmpleadoId(Number(e.target.value))
            }
          >
            <option value={0}>
              [ Realice una búsqueda ]
            </option>

            {filtrados.map((e) => (
              <option key={e.id} value={e.id}>
                {e.numeroEmpleado || e.codigo} —{" "}
                {e.nombre}
              </option>
            ))}
          </select>
        </label>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm text-[var(--muted)]">
            No. empleado
            <input
              className={input}
              value={numeroEmpleado}
              readOnly
              placeholder="Se completa al seleccionar"
            />
          </label>

          <label className="text-sm text-[var(--muted)]">
            Fecha del registro
            <input
              type="date"
              className={input}
              value={fecha}
              onChange={(e) =>
                setFecha(e.target.value)
              }
              required
            />
          </label>

          <label className="text-sm text-[var(--muted)]">
            Hora del registro
            <input
              type="time"
              step={1}
              className={input}
              value={
                hora.length === 8
                  ? hora.slice(0, 8)
                  : hora
              }
              onChange={(e) => {
                const v = e.target.value;

                setHora(
                  v.length === 5
                    ? `${v}:00`
                    : v,
                );
              }}
              required
            />
          </label>
        </div>

        <p className="text-sm text-[var(--muted)]">
          Se registrará con fecha {fecha} a las{" "}
          {hora || "—"}
          {numeroEmpleado
            ? ` · empleado ${numeroEmpleado}`
            : " (selecciona un empleado)"}.
        </p>

        {correccion ? (
          <div className="rounded-lg border border-amber-700/40 bg-amber-950/30 p-4 text-sm">
            <p>
              Ya existe un registro completo ese día.
              <br />
              Entrada:{" "}
              {correccion.entradaActual ?? "—"}
              <br />
              Salida:{" "}
              {correccion.salidaActual ?? "—"}
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded bg-[var(--accent)] px-3 py-2 text-white"
                onClick={() =>
                  void enviar("entrada")
                }
              >
                Corregir entrada
              </button>

              <button
                type="button"
                className="rounded bg-[#6b3d8a] px-3 py-2 text-white"
                onClick={() =>
                  void enviar("salida")
                }
              >
                Corregir salida
              </button>

              <button
                type="button"
                className="rounded bg-[#37474F] px-3 py-2 text-white"
                onClick={() =>
                  setCorreccion(null)
                }
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : null}

        {error ? (
          <p className="text-sm text-red-300">
            {error}
          </p>
        ) : null}

        {msg ? (
          <p className="text-sm text-emerald-300">
            {msg}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={!empleadoId}
          className="rounded bg-[#1B5E20] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Guardar Marcaje Manual
        </button>
      </form>

      <section className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-medium">
              Importación masiva desde Excel
            </h2>

            <p className="mt-1 text-sm text-[var(--muted)]">
              Registra entradas y salidas de varios
              empleados mediante una plantilla Excel. El
              sistema valida el archivo antes de guardar los
              marcajes.
            </p>
          </div>

          <a
            href={`/api/empresas/${slug}/rrhh/marcajes/importar`}
            className="rounded bg-[#37474F] px-3 py-2 text-sm text-white"
          >
            Descargar plantilla Excel
          </a>
        </div>

        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3">
          <p className="text-sm font-medium">
            Columnas esperadas
          </p>

          <p className="mt-1 text-xs text-[var(--muted)]">
            numero_empleado · fecha · entrada · salida ·
            observacion
          </p>

          <p className="mt-2 text-xs text-[var(--muted)]">
            La importación no sobrescribe silenciosamente
            entradas o salidas existentes. Los conflictos se
            muestran antes de importar.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <input
            type="file"
            accept=".xlsx,.xlsm"
            onChange={cambiarArchivo}
            className={input}
          />

          <button
            type="button"
            disabled={
              !archivoExcel ||
              validando ||
              importando
            }
            onClick={() =>
              void procesarExcel("validar")
            }
            className="self-end rounded bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {validando
              ? "Validando…"
              : "Validar archivo"}
          </button>
        </div>

        {archivoExcel ? (
          <p className="text-xs text-[var(--muted)]">
            Archivo seleccionado: {archivoExcel.name}
          </p>
        ) : null}

        {errorImport ? (
          <p className="text-sm text-red-300">
            {errorImport}
          </p>
        ) : null}

        {mensajeImport ? (
          <p className="text-sm text-emerald-300">
            {mensajeImport}
          </p>
        ) : null}

        {resultadoImport ? (
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              <div className="rounded-lg border border-[var(--border)] p-3">
                <p className="text-xs text-[var(--muted)]">
                  Total
                </p>
                <p className="text-xl font-semibold">
                  {resultadoImport.resumen.total}
                </p>
              </div>

              <div className="rounded-lg border border-[var(--border)] p-3">
                <p className="text-xs text-[var(--muted)]">
                  Nuevos
                </p>
                <p className="text-xl font-semibold text-emerald-300">
                  {resultadoImport.resumen.validas}
                </p>
              </div>

              <div className="rounded-lg border border-[var(--border)] p-3">
                <p className="text-xs text-[var(--muted)]">
                  Actualizables
                </p>
                <p className="text-xl font-semibold text-sky-300">
                  {resultadoImport.resumen.actualizables}
                </p>
              </div>

              <div className="rounded-lg border border-[var(--border)] p-3">
                <p className="text-xs text-[var(--muted)]">
                  Conflictos
                </p>
                <p className="text-xl font-semibold text-amber-300">
                  {resultadoImport.resumen.conflictos}
                </p>
              </div>

              <div className="rounded-lg border border-[var(--border)] p-3">
                <p className="text-xs text-[var(--muted)]">
                  Errores
                </p>
                <p className="text-xl font-semibold text-red-300">
                  {resultadoImport.resumen.errores}
                </p>
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
              <table className="min-w-full text-left text-xs">
                <thead className="bg-[var(--thead)] text-[var(--muted)]">
                  <tr>
                    <th className="px-2 py-2">
                      Fila
                    </th>
                    <th className="px-2 py-2">
                      No. empleado
                    </th>
                    <th className="px-2 py-2">
                      Empleado
                    </th>
                    <th className="px-2 py-2">
                      Fecha
                    </th>
                    <th className="px-2 py-2">
                      Entrada
                    </th>
                    <th className="px-2 py-2">
                      Salida
                    </th>
                    <th className="px-2 py-2">
                      Estado
                    </th>
                    <th className="px-2 py-2">
                      Detalle
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {filasPreview.map((fila) => (
                    <tr
                      key={`${fila.filaExcel}-${fila.numeroEmpleado}`}
                      className="border-t border-[var(--border)]"
                    >
                      <td className="px-2 py-2">
                        {fila.filaExcel}
                      </td>

                      <td className="px-2 py-2 font-mono">
                        {fila.numeroEmpleado}
                      </td>

                      <td className="px-2 py-2">
                        {fila.nombre ?? "—"}
                      </td>

                      <td className="px-2 py-2">
                        {fila.fecha || "—"}
                      </td>

                      <td className="px-2 py-2">
                        {fila.entrada ?? "—"}
                      </td>

                      <td className="px-2 py-2">
                        {fila.salida ?? "—"}
                      </td>

                      <td
                        className={`px-2 py-2 font-medium ${estadoClass(
                          fila.estado,
                        )}`}
                      >
                        {estadoLabel(fila.estado)}
                      </td>

                      <td className="px-2 py-2">
                        {fila.detalle}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {resultadoImport.filas.length > 100 ? (
              <p className="text-xs text-[var(--muted)]">
                Mostrando 100 de{" "}
                {resultadoImport.filas.length} filas.
              </p>
            ) : null}

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                disabled={
                  importables === 0 ||
                  importando ||
                  validando
                }
                onClick={() =>
                  void procesarExcel("importar")
                }
                className="rounded bg-[#1B5E20] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {importando
                  ? "Importando…"
                  : `Importar marcajes (${importables})`}
              </button>

              <button
                type="button"
                onClick={() => {
                  setResultadoImport(null);
                  setErrorImport("");
                  setMensajeImport("");
                }}
                className="rounded border border-[var(--border)] px-4 py-2 text-sm"
              >
                Limpiar vista previa
              </button>
            </div>

            {resultadoImport.accion === "importar" ? (
              <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3 text-sm">
                <p className="font-medium">
                  Resultado final
                </p>
                <p className="mt-1 text-[var(--muted)]">
                  Creados:{" "}
                  {resultadoImport.resumen.creados ?? 0} ·
                  Completados:{" "}
                  {resultadoImport.resumen.completados ??
                    0}{" "}
                  · Omitidos:{" "}
                  {resultadoImport.resumen.omitidos ?? 0}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <label className="text-sm text-[var(--muted)]">
            Filtrar por fecha jornada
            <input
              type="date"
              className={input}
              value={fechaFiltro}
              onChange={(e) =>
                setFechaFiltro(e.target.value)
              }
            />
          </label>

          <button
            type="button"
            className="rounded bg-[#37474F] px-3 py-2 text-sm text-white"
            onClick={() =>
              void cargarRegistros()
            }
          >
            Cargar registros
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-[var(--thead)] text-[var(--muted)]">
              <tr>
                <th className="px-2 py-2">
                  Código
                </th>
                <th className="px-2 py-2">
                  Empleado
                </th>
                <th className="px-2 py-2">
                  Entrada
                </th>
                <th className="px-2 py-2">
                  Salida
                </th>
                <th className="px-2 py-2">
                  Estado
                </th>
              </tr>
            </thead>

            <tbody>
              {registros.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-2 py-3 text-[var(--muted)]"
                  >
                    Sin registros ese día.
                  </td>
                </tr>
              ) : (
                registros.map((r) => (
                  <tr
                    key={String(r.id)}
                    className="border-t border-[var(--border)]"
                  >
                    <td className="px-2 py-1.5">
                      {String(r.codigo ?? "")}
                    </td>

                    <td className="px-2 py-1.5">
                      {String(r.nombre ?? "")}
                    </td>

                    <td className="px-2 py-1.5">
                      {String(r.entrada ?? "—")}
                    </td>

                    <td className="px-2 py-1.5">
                      {String(r.salida ?? "—")}
                    </td>

                    <td className="px-2 py-1.5">
                      {String(
                        r.incidencia ??
                          r.estado ??
                          "",
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}