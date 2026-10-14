"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { MESES_ES, type CumpleaniosEmpleado, type ListadoCumpleanios } from "@/lib/rrhh/cumpleanios-shared";
import { useEmpresaSession } from "@/lib/empresa-session";
import { tienePermiso } from "@/lib/permisos-shared";
import { ComprobantesCumpleaniosModal } from "@/components/rrhh/comprobantes-cumpleanios-modal";

const input = "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-sm";

/** Mes/año actuales en la zona de Guatemala (UTC−6, sin horario de verano), sin depender de la zona del navegador. */
function mesAnioActual(): { mes: number; anio: number } {
  const g = new Date(Date.now() - 6 * 60 * 60 * 1000);
  return { mes: g.getUTCMonth() + 1, anio: g.getUTCFullYear() };
}

function fechaVisible(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/**
 * RRHH → Reportes → Cumpleaños por mes. Lista de empleados que cumplen años en el mes elegido (por defecto, el mes actual y solo
 * Activos), con exportación a Excel para preparar pedidos de vales. No muestra DPI, NIT, IGSS, dirección ni teléfono.
 */
export default function CumpleaniosPage() {
  const slug = String(useParams().slug);
  const actual = mesAnioActual();
  const [mes, setMes] = useState(actual.mes);
  const [anio, setAnio] = useState(actual.anio);
  const [incluirInactivos, setIncluirInactivos] = useState(false);
  const [datos, setDatos] = useState<(ListadoCumpleanios & { empresa?: string }) | null>(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);
  // Comprobantes: los permisos solo habilitan controles; el servidor los vuelve a exigir.
  const { rol, permisos } = useEmpresaSession();
  const puedeAdjuntar = rol === "Admin" || tienePermiso(permisos, "empleados", "editar") || tienePermiso(permisos, "empleados", "crear");
  const puedeEliminar = rol === "Admin" || tienePermiso(permisos, "empleados", "eliminar");
  const [comprobantes, setComprobantes] = useState<CumpleaniosEmpleado | null>(null);
  const [refresco, setRefresco] = useState(0);

  const consulta = useCallback(
    (formato: "json" | "xlsx") =>
      `/api/empresas/${slug}/rrhh/cumpleanios?${new URLSearchParams({
        mes: String(mes),
        anio: String(anio),
        incluirInactivos: incluirInactivos ? "1" : "0",
        formato,
      })}`,
    [slug, mes, anio, incluirInactivos],
  );

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      setCargando(true);
      try {
        const res = await fetch(consulta("json"), { cache: "no-store", signal: controller.signal });
        const data = await res.json().catch(() => ({}));
        if (controller.signal.aborted) return;
        if (!res.ok) {
          setDatos(null);
          setError(data.error ?? "No se pudo cargar el listado.");
        } else {
          setError("");
          setDatos(data as ListadoCumpleanios);
        }
      } catch {
        if (!controller.signal.aborted) {
          setDatos(null);
          setError("Error de conexión.");
        }
      } finally {
        if (!controller.signal.aborted) setCargando(false);
      }
    })();
    return () => controller.abort();
  }, [consulta, refresco]);

  const anios = Array.from({ length: 5 }, (_, i) => actual.anio - 1 + i);
  const mostrarEstado = datos?.incluirInactivos === true;
  // Solo se puede exportar un listado ya cargado, sin error y con al menos un empleado.
  const puedeExportar = !cargando && !error && datos != null && datos.total > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Cumpleaños por mes</h1>
        <p className="text-sm text-[var(--muted)]">
          Empleados que cumplen años en el mes elegido, para preparar pedidos (por ejemplo, vales).{" "}
          <Link href={`/e/${slug}/rrhh/reportes`} className="text-[var(--accent)] underline">
            ← Reportes
          </Link>
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
          Mes
          <select aria-label="Mes" className={input} value={mes} onChange={(e) => setMes(Number(e.target.value))}>
            {MESES_ES.map((nombre, i) => (
              <option key={nombre} value={i + 1}>{nombre}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
          Año
          <select aria-label="Año" className={input} value={anio} onChange={(e) => setAnio(Number(e.target.value))}>
            {anios.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 pb-1 text-xs">
          <input type="checkbox" checked={incluirInactivos} onChange={(e) => setIncluirInactivos(e.target.checked)} />
          Incluir bajas
        </label>
        {puedeExportar ? (
          <a href={consulta("xlsx")} className="rounded bg-[#0d9488] px-3 py-1 text-sm text-white">
            Excel
          </a>
        ) : (
          // Deshabilitado de verdad (no es un enlace): mientras carga o si no hay empleados no inicia ninguna descarga.
          <button
            type="button"
            disabled
            title={cargando ? "Cargando el listado…" : "No hay empleados que exportar"}
            className="cursor-not-allowed rounded bg-[#0d9488] px-3 py-1 text-sm text-white opacity-40"
          >
            Excel
          </button>
        )}
      </div>

      {error ? <p role="alert" className="text-sm text-rose-300">{error}</p> : null}
      <p className="text-xs text-[var(--muted)]" aria-live="polite">
        {datos ? `${MESES_ES[datos.mes - 1]} ${datos.anio} · ${datos.total} ${datos.total === 1 ? "empleado" : "empleados"}` : ""}
        {cargando ? " · cargando…" : ""}
        {datos?.truncado ? " · se muestran solo los primeros registros" : ""}
      </p>

      <div className="max-h-[70vh] overflow-auto rounded-xl border border-[var(--border)]">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-[var(--thead)] text-[var(--muted)]">
            <tr>
              <th className="px-2 py-2">Código</th>
              <th className="px-2 py-2">Empleado</th>
              <th className="px-2 py-2">Fecha de cumpleaños</th>
              <th className="px-2 py-2">Edad que cumple</th>
              <th className="px-2 py-2">Puesto</th>
              <th className="px-2 py-2">Área</th>
              <th className="px-2 py-2">Comprobante</th>
              {mostrarEstado ? <th className="px-2 py-2">Estado</th> : null}
            </tr>
          </thead>
          <tbody>
            {(datos?.empleados ?? []).map((e) => (
              <tr key={e.id} className="border-t border-[var(--border)]">
                <td className="px-2 py-1.5 font-mono">{e.codigo}</td>
                <td className="px-2 py-1.5">{e.nombre}</td>
                <td className="whitespace-nowrap px-2 py-1.5">{fechaVisible(e.fecha)}</td>
                <td className="px-2 py-1.5">{e.edad ?? "—"}</td>
                <td className="px-2 py-1.5">{e.puesto || "—"}</td>
                <td className="px-2 py-1.5">{e.area || "—"}</td>
                <td className="whitespace-nowrap px-2 py-1.5">
                  <span className={e.comprobantes ? "" : "text-[var(--muted)]"}>
                    {e.comprobantes === 0 ? "Sin comprobante" : e.comprobantes === 1 ? "1 archivo" : `${e.comprobantes} archivos`}
                  </span>{" "}
                  <button
                    type="button"
                    onClick={() => setComprobantes(e)}
                    className="rounded border border-[var(--border)] px-2 py-0.5 text-[11px] hover:border-[var(--accent)]"
                    aria-label={`${puedeAdjuntar ? "Ver o adjuntar" : "Ver"} comprobante de ${e.nombre}`}
                  >
                    {puedeAdjuntar ? "Ver / Adjuntar" : "Ver"}
                  </button>
                </td>
                {mostrarEstado ? <td className="px-2 py-1.5">{e.estado}</td> : null}
              </tr>
            ))}
            {datos && !datos.empleados.length ? (
              <tr>
                <td colSpan={mostrarEstado ? 8 : 7} className="px-3 py-6 text-center text-[var(--muted)]">
                  Nadie cumple años en {MESES_ES[datos.mes - 1].toLowerCase()}.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {comprobantes ? (
        <ComprobantesCumpleaniosModal
          slug={slug}
          empleadoId={comprobantes.id}
          codigo={comprobantes.codigo}
          nombre={comprobantes.nombre}
          fechaUi={fechaVisible(comprobantes.fecha)}
          anio={datos?.anio ?? anio}
          puedeAdjuntar={puedeAdjuntar}
          puedeEliminar={puedeEliminar}
          onClose={() => setComprobantes(null)}
          onCambio={() => setRefresco((n) => n + 1)}
        />
      ) : null}
    </div>
  );
}
