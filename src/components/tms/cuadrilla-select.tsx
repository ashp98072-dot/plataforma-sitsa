"use client";

import { useState } from "react";
import { CatalogoSearchSelect } from "./catalogo-search-select";
import type { IntegranteCuadrilla } from "@/lib/tms/cuadrilla-contrato";
import type { OcupacionRecurso } from "./piloto-select";

export function CuadrillaSelect({ integrantes, empleados, ocupados, excluidos, disabled, onChange }: {
  integrantes: IntegranteCuadrilla[]; empleados: { id: number; nombre: string; codigo: string }[];
  ocupados: Record<number, OcupacionRecurso>; excluidos: number[]; disabled: boolean;
  onChange: (integrantes: IntegranteCuadrilla[]) => void;
}) {
  const [externo, setExterno] = useState({ nombre: "", identificacion: "", telefono: "" });
  const clase = "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm";
  const opciones = integrantes.length >= 200 ? [] : empleados.filter((e) => !ocupados[e.id] && !excluidos.includes(e.id) && !integrantes.some((i) => i.empleadoId === e.id));
  return <fieldset disabled={disabled} className="md:col-span-3 space-y-3 rounded border border-[var(--border)] p-3">
    <legend className="px-1 font-semibold">Cuadrilla</legend>
    <p className="text-xs text-[var(--muted)]">Rol independiente de auxiliares. No genera viáticos automáticamente.</p>
    <CatalogoSearchSelect label="Integrante interno" placeholder="Buscar empleado..." value="" inputClassName={clase}
      options={opciones.map((e) => ({ value: String(e.id), label: e.nombre, detail: e.codigo }))}
      onChange={(v) => {
        const e = opciones.find((o) => o.id === Number(v));
        if (e) onChange([...integrantes, { tipo: "INTERNO", empleadoId: e.id, nombre: e.nombre, identificacion: null, telefono: null }]);
      }} />
    <div className="flex flex-wrap items-end gap-2">
      <label className="text-xs">Nombre externo *<input className={`${clase} block`} maxLength={200} value={externo.nombre} onChange={(e) => setExterno({ ...externo, nombre: e.target.value })} /></label>
      <label className="text-xs">Identificación<input className={`${clase} block`} maxLength={100} value={externo.identificacion} onChange={(e) => setExterno({ ...externo, identificacion: e.target.value })} /></label>
      <label className="text-xs">Teléfono<input className={`${clase} block`} maxLength={50} value={externo.telefono} onChange={(e) => setExterno({ ...externo, telefono: e.target.value })} /></label>
      <button type="button" className={clase} disabled={!externo.nombre.trim() || integrantes.length >= 200} onClick={() => {
        onChange([...integrantes, { tipo: "EXTERNO", empleadoId: null, nombre: externo.nombre.trim(), identificacion: externo.identificacion.trim() || null, telefono: externo.telefono.trim() || null }]);
        setExterno({ nombre: "", identificacion: "", telefono: "" });
      }}>Agregar externo</button>
    </div>
    <ul className="space-y-1">{integrantes.map((i, n) => <li key={`${i.empleadoId ?? "externo"}-${n}`} className="flex items-center justify-between gap-2 text-sm">
      <span>{i.nombre} · {i.tipo === "INTERNO" ? "Interno" : "Externo"}{i.identificacion ? ` · ${i.identificacion}` : ""}{i.telefono ? ` · ${i.telefono}` : ""}</span>
      <button type="button" className={clase} aria-label={`Quitar ${i.nombre}`} onClick={() => onChange(integrantes.filter((_, j) => j !== n))}>Quitar</button>
    </li>)}</ul>
  </fieldset>;
}
