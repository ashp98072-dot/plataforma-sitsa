"use client";

import { useEffect, useState } from "react";

type Rol = "PILOTO" | "AUXILIAR";
type EstadoHabilitacion = "HABILITADO" | "CAPACITACION";

type HabilitacionFila = { rol: Rol; estado: EstadoHabilitacion; activo: boolean };

type EmpleadoHabilitaciones = {
  id: number;
  codigo: string | null;
  nombre: string;
  puesto: string | null;
  categoriaOps: string | null;
  habilitaciones: HabilitacionFila[];
};

const inputCls = "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-xs";

/** "Sin habilitar" (sin fila activa) | el estado de la fila ACTIVA para ese rol, si existe. */
function valorDe(emp: EmpleadoHabilitaciones, rol: Rol): "" | EstadoHabilitacion {
  const fila = emp.habilitaciones.find((h) => h.rol === rol && h.activo);
  return fila?.estado ?? "";
}

/**
 * TMS-PROGRAMACION-HABILITACIONES-1 — administración de habilitaciones operativas (tms_personal_
 * habilitaciones): capa de elegibilidad para Piloto/Auxiliar en Programación, SEPARADA del puesto/
 * categoría contractual de RRHH (que esta pantalla nunca toca — ver nota explícita debajo del título) y
 * de tms_personal (catálogo operativo que se sigue creando solo al asignar un viaje real).
 *
 * Mismo permiso ya existente `tms` (ver/editar) — sin permiso nuevo, por decisión explícita del ticket.
 * Un empleado puede tener hasta 2 habilitaciones (una por rol), cada una con su propio selector de 3
 * estados: "Sin habilitar" (sin fila activa) / "Habilitado" / "En capacitación".
 */
export default function HabilitacionesPanel({ slug }: { slug: string }) {
  const [empleados, setEmpleados] = useState<EmpleadoHabilitaciones[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [guardandoClave, setGuardandoClave] = useState<string | null>(null);

  async function cargar() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/empresas/${slug}/tms/personal-habilitaciones`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `No se pudo cargar (${res.status}).`);
        return;
      }
      const data = await res.json();
      setEmpleados((data.empleados ?? []) as EmpleadoHabilitaciones[]);
    } catch {
      setError("Error de conexión.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void (async () => {
      await cargar();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  async function fijar(empleadoId: number, rol: Rol, estado: EstadoHabilitacion | null) {
    const clave = `${empleadoId}-${rol}`;
    setGuardandoClave(clave);
    setError("");
    setMsg("");
    try {
      const res = await fetch(`/api/empresas/${slug}/tms/personal-habilitaciones`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ empleadoId, rol, estado }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `No se pudo guardar (${res.status}).`);
        return;
      }
      setMsg("Habilitación actualizada.");
      await cargar();
    } catch {
      setError("Error de conexión.");
    } finally {
      setGuardandoClave(null);
    }
  }

  function Selector({ emp, rol }: { emp: EmpleadoHabilitaciones; rol: Rol }) {
    const clave = `${emp.id}-${rol}`;
    return (
      <select
        className={inputCls}
        value={valorDe(emp, rol)}
        disabled={guardandoClave === clave}
        onChange={(e) => {
          const v = e.target.value;
          void fijar(emp.id, rol, v === "" ? null : (v as EstadoHabilitacion));
        }}
      >
        <option value="">Sin habilitar</option>
        <option value="HABILITADO">Habilitado</option>
        <option value="CAPACITACION">En capacitación</option>
      </select>
    );
  }

  return (
    <div>
      <p className="text-sm font-medium">Habilitaciones operativas (Piloto / Auxiliar)</p>
      <p className="mt-1 text-[11px] text-[var(--muted)]">
        Estas habilitaciones NO modifican el puesto de RRHH — solo determinan si el empleado puede
        seleccionarse como Piloto/Auxiliar en Programación. &ldquo;En capacitación&rdquo; sigue permitiendo
        seleccionarlo, con una advertencia visual en el formulario.
      </p>
      {error ? <p className="mt-2 text-xs text-rose-300">{error}</p> : null}
      {msg ? <p className="mt-2 text-xs text-emerald-300">{msg}</p> : null}
      <div className="mt-3 max-h-96 overflow-auto rounded border border-[var(--border)]">
        <table className="min-w-full text-left text-xs">
          <thead className="sticky top-0 bg-[#1e293b] text-[var(--muted)]">
            <tr>
              <th className="px-2 py-1.5">Empleado</th>
              <th className="px-2 py-1.5">Puesto RRHH</th>
              <th className="px-2 py-1.5">Piloto</th>
              <th className="px-2 py-1.5">Auxiliar</th>
            </tr>
          </thead>
          <tbody>
            {empleados.map((emp) => (
              <tr key={emp.id} className="border-t border-[var(--border)] align-middle">
                <td className="px-2 py-1.5 font-medium">{emp.nombre}</td>
                <td className="px-2 py-1.5 text-[var(--muted)]">{emp.puesto || emp.categoriaOps || "—"}</td>
                <td className="px-2 py-1.5">
                  <Selector emp={emp} rol="PILOTO" />
                </td>
                <td className="px-2 py-1.5">
                  <Selector emp={emp} rol="AUXILIAR" />
                </td>
              </tr>
            ))}
            {!empleados.length && !loading ? (
              <tr>
                <td colSpan={4} className="px-2 py-3 text-[var(--muted)]">
                  Sin empleados activos.
                </td>
              </tr>
            ) : null}
            {loading ? (
              <tr>
                <td colSpan={4} className="px-2 py-3 text-[var(--muted)]">
                  Cargando…
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
