"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

type Personal = {
  id: number;
  nombre: string;
  tipo: string;
  tipoVinculo: "propio" | "compartido" | "externo";
  activo: boolean;
  telefono: string | null;
  licencia: string | null;
  idEmpleado: number | null;
  empresaOrigenNombre: string | null;
  empresaOrigenTexto: string | null;
  origen: string;
};

type EmpleadoOtra = {
  empleadoId: number;
  nombre: string;
  empresaId: number;
  empresaNombre: string;
  codigo: string | null;
};

const inputCls = "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm text-[var(--text)]";
const btn = "rounded bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50";
const btnSec = "rounded border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text)]";

function badge(tv: Personal["tipoVinculo"]): string {
  if (tv === "compartido") return "bg-violet-600";
  if (tv === "externo") return "bg-amber-600";
  return "bg-emerald-600";
}

export default function PersonalOperativoClient() {
  const slug = String(useParams().slug);

  const [personal, setPersonal] = useState<Personal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  // Filtros
  const [fVinculo, setFVinculo] = useState("");
  const [fTipo, setFTipo] = useState("");
  const [fActivo, setFActivo] = useState("");
  const [fQ, setFQ] = useState("");

  // Alta de externo
  const [nuevoExterno, setNuevoExterno] = useState({ nombre: "", tipo: "Piloto", telefono: "", licencia: "", empresaOrigenTexto: "" });

  // Habilitar compartido
  const [buscarTipo, setBuscarTipo] = useState<"Piloto" | "Auxiliar">("Piloto");
  const [buscarQ, setBuscarQ] = useState("");
  const [candidatos, setCandidatos] = useState<EmpleadoOtra[]>([]);
  const [buscando, setBuscando] = useState(false);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const p = new URLSearchParams();
      if (fVinculo) p.set("tipoVinculo", fVinculo);
      if (fTipo) p.set("tipo", fTipo);
      if (fActivo) p.set("activo", fActivo);
      if (fQ.trim()) p.set("q", fQ.trim());
      const res = await fetch(`/api/empresas/${slug}/tms/personal-operativo?${p.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "No se pudo cargar."); return; }
      setPersonal((data.personal ?? []) as Personal[]);
      if (data.aviso) setError(data.aviso);
    } catch {
      setError("Error de conexión.");
    } finally {
      setLoading(false);
    }
  }, [slug, fVinculo, fTipo, fActivo, fQ]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargar();
  }, [cargar]);

  async function accion(fn: () => Promise<Response>, okMsg: string) {
    setError("");
    setMsg("");
    try {
      const res = await fn();
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "No se pudo completar la acción."); return false; }
      setMsg(okMsg);
      await cargar();
      return true;
    } catch {
      setError("Error de conexión.");
      return false;
    }
  }

  async function crearExterno() {
    if (!nuevoExterno.nombre.trim()) { setError("Indica el nombre del personal externo."); return; }
    const ok = await accion(
      () => fetch(`/api/empresas/${slug}/tms/personal-operativo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: nuevoExterno.nombre.trim(),
          tipo: nuevoExterno.tipo,
          telefono: nuevoExterno.telefono.trim() || undefined,
          licencia: nuevoExterno.licencia.trim() || undefined,
          empresaOrigenTexto: nuevoExterno.empresaOrigenTexto.trim() || undefined,
        }),
      }),
      "Personal externo creado.",
    );
    if (ok) setNuevoExterno({ nombre: "", tipo: "Piloto", telefono: "", licencia: "", empresaOrigenTexto: "" });
  }

  const buscarCandidatos = useCallback(async () => {
    setBuscando(true);
    try {
      const p = new URLSearchParams({ tipo: buscarTipo });
      if (buscarQ.trim()) p.set("q", buscarQ.trim());
      const res = await fetch(`/api/empresas/${slug}/tms/personal-operativo/buscar-empleados?${p.toString()}`);
      const data = await res.json().catch(() => ({}));
      setCandidatos(res.ok ? ((data.empleados ?? []) as EmpleadoOtra[]) : []);
    } catch {
      setCandidatos([]);
    } finally {
      setBuscando(false);
    }
  }, [slug, buscarTipo, buscarQ]);

  async function habilitar(empleadoId: number) {
    await accion(
      () => fetch(`/api/empresas/${slug}/tms/personal-operativo/habilitar-compartido`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ empleadoId, tipo: buscarTipo }),
      }),
      "Personal compartido habilitado.",
    );
    setCandidatos((c) => c.filter((x) => x.empleadoId !== empleadoId));
  }

  function toggleActivo(pp: Personal) {
    void accion(
      () => fetch(`/api/empresas/${slug}/tms/personal-operativo/${pp.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activo: !pp.activo }),
      }),
      pp.activo ? "Personal desactivado (viajes/viáticos históricos intactos)." : "Personal reactivado.",
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Operaciones</p>
        <h1 className="mt-1 text-2xl font-semibold text-[var(--text)]">Personal operativo</h1>
        <p className="text-sm text-[var(--muted)]">
          Pilotos y auxiliares utilizables en{" "}
          <Link href={`/e/${slug}/programacion`} className="text-[var(--accent)] hover:underline">Programación</Link>:
          propios, compartidos (de otra empresa del grupo, sin entrar a esta planilla) y externos (sin RRHH).
          Otorgar un viático a cualquiera de ellos <strong>nunca</strong> genera planilla, IGSS, prestaciones, descuentos ni boleta.
        </p>
      </div>

      {error ? <p className="text-sm text-rose-500">{error}</p> : null}
      {msg ? <p className="text-sm text-emerald-500">{msg}</p> : null}

      {/* Alta de externo + habilitar compartido */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <h2 className="text-sm font-semibold text-[var(--text)]">Crear personal externo</h2>
          <p className="mb-2 text-xs text-[var(--muted)]">Persona que no existe en RRHH. Solo registro operativo.</p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-[var(--muted)]">Nombre
              <input className={`${inputCls} mt-0.5 block`} value={nuevoExterno.nombre} onChange={(e) => setNuevoExterno((f) => ({ ...f, nombre: e.target.value }))} />
            </label>
            <label className="text-xs text-[var(--muted)]">Tipo
              <select className={`${inputCls} mt-0.5 block`} value={nuevoExterno.tipo} onChange={(e) => setNuevoExterno((f) => ({ ...f, tipo: e.target.value }))}>
                <option>Piloto</option>
                <option>Auxiliar</option>
              </select>
            </label>
            <label className="text-xs text-[var(--muted)]">Teléfono
              <input className={`${inputCls} mt-0.5 block`} value={nuevoExterno.telefono} onChange={(e) => setNuevoExterno((f) => ({ ...f, telefono: e.target.value }))} />
            </label>
            <label className="text-xs text-[var(--muted)]">Licencia (piloto)
              <input className={`${inputCls} mt-0.5 block`} value={nuevoExterno.licencia} onChange={(e) => setNuevoExterno((f) => ({ ...f, licencia: e.target.value }))} />
            </label>
            <label className="text-xs text-[var(--muted)]">Empresa / origen
              <input className={`${inputCls} mt-0.5 block`} placeholder="texto libre" value={nuevoExterno.empresaOrigenTexto} onChange={(e) => setNuevoExterno((f) => ({ ...f, empresaOrigenTexto: e.target.value }))} />
            </label>
            <button type="button" className={btn} onClick={() => void crearExterno()}>+ Crear externo</button>
          </div>
        </section>

        <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <h2 className="text-sm font-semibold text-[var(--text)]">Habilitar empleado de otra empresa</h2>
          <p className="mb-2 text-xs text-[var(--muted)]">
            Personal compartido: opera para esta empresa sin salir de su empresa de origen ni entrar a esta planilla.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-[var(--muted)]">Tipo
              <select className={`${inputCls} mt-0.5 block`} value={buscarTipo} onChange={(e) => setBuscarTipo(e.target.value as "Piloto" | "Auxiliar")}>
                <option>Piloto</option>
                <option>Auxiliar</option>
              </select>
            </label>
            <label className="text-xs text-[var(--muted)]">Buscar
              <input className={`${inputCls} mt-0.5 block`} value={buscarQ} onChange={(e) => setBuscarQ(e.target.value)} placeholder="nombre o código" />
            </label>
            <button type="button" className={btnSec} disabled={buscando} onClick={() => void buscarCandidatos()}>{buscando ? "Buscando…" : "Buscar"}</button>
          </div>
          {candidatos.length ? (
            <ul className="mt-2 divide-y divide-[var(--border)] text-xs">
              {candidatos.map((c) => (
                <li key={c.empleadoId} className="flex items-center justify-between py-1.5">
                  <span>{c.nombre} <span className="text-[var(--muted)]">· {c.empresaNombre}{c.codigo ? ` · ${c.codigo}` : ""}</span></span>
                  <button type="button" className={btn} onClick={() => void habilitar(c.empleadoId)}>Habilitar</button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>

      {/* Filtros + listado */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-[var(--muted)]">Vínculo
            <select className={`${inputCls} mt-0.5 block`} value={fVinculo} onChange={(e) => setFVinculo(e.target.value)}>
              <option value="">Todos</option>
              <option value="propio">Propios</option>
              <option value="compartido">Compartidos</option>
              <option value="externo">Externos</option>
            </select>
          </label>
          <label className="text-xs text-[var(--muted)]">Tipo
            <select className={`${inputCls} mt-0.5 block`} value={fTipo} onChange={(e) => setFTipo(e.target.value)}>
              <option value="">Todos</option>
              <option value="Piloto">Pilotos</option>
              <option value="Auxiliar">Auxiliares</option>
            </select>
          </label>
          <label className="text-xs text-[var(--muted)]">Estado
            <select className={`${inputCls} mt-0.5 block`} value={fActivo} onChange={(e) => setFActivo(e.target.value)}>
              <option value="">Todos</option>
              <option value="1">Activos</option>
              <option value="0">Inactivos</option>
            </select>
          </label>
          <label className="text-xs text-[var(--muted)]">Buscar
            <input className={`${inputCls} mt-0.5 block`} value={fQ} onChange={(e) => setFQ(e.target.value)} />
          </label>
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[var(--input)] text-[var(--muted)]">
              <tr>
                <th className="px-2 py-2">Nombre</th>
                <th className="px-2 py-2">Tipo</th>
                <th className="px-2 py-2">Vínculo</th>
                <th className="px-2 py-2">Origen</th>
                <th className="px-2 py-2">Teléfono</th>
                <th className="px-2 py-2">Licencia</th>
                <th className="px-2 py-2">Estado</th>
                <th className="px-2 py-2">Acción</th>
              </tr>
            </thead>
            <tbody>
              {personal.map((pp) => (
                <tr key={pp.id} className="border-t border-[var(--border)]">
                  <td className="px-2 py-1.5">{pp.nombre}</td>
                  <td className="px-2 py-1.5">{pp.tipo}</td>
                  <td className="px-2 py-1.5">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium text-white ${badge(pp.tipoVinculo)}`}>{pp.tipoVinculo}</span>
                  </td>
                  <td className="px-2 py-1.5">{pp.empresaOrigenNombre || pp.empresaOrigenTexto || "—"}</td>
                  <td className="px-2 py-1.5">{pp.telefono ?? "—"}</td>
                  <td className="px-2 py-1.5">{pp.licencia ?? "—"}</td>
                  <td className="px-2 py-1.5">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium text-white ${pp.activo ? "bg-emerald-600" : "bg-slate-500"}`}>
                      {pp.activo ? "Activo" : "Inactivo"}
                    </span>
                  </td>
                  <td className="px-2 py-1.5">
                    <button type="button" className={pp.activo ? "text-amber-400 hover:underline" : "text-emerald-400 hover:underline"} onClick={() => toggleActivo(pp)}>
                      {pp.activo ? "Desactivar" : "Activar"}
                    </button>
                  </td>
                </tr>
              ))}
              {!personal.length && !loading ? (
                <tr><td colSpan={8} className="px-2 py-4 text-[var(--muted)]">Sin personal con estos filtros.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
