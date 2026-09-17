"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Proveedor } from "@/lib/compras/proveedor-schema";

export const camposFormulario = [
  ["nombre_comercial", "Nombre comercial", 200], ["razon_social", "Razón social", 250], ["nit", "NIT", 30],
  ["direccion", "Dirección", 500], ["telefono", "Teléfono", 50], ["correo", "Correo", 200],
  ["contacto_nombre", "Contacto", 200], ["contacto_telefono", "Teléfono contacto", 50], ["contacto_correo", "Correo contacto", 200],
  ["metodo_pago_habitual", "Método de pago habitual", 80], ["banco", "Banco", 150], ["numero_cuenta", "Número de cuenta", 100],
  ["tipo_cuenta", "Tipo de cuenta", 80], ["titular_cuenta", "Titular de cuenta", 200], ["dias_credito", "Días de crédito", 10],
  ["observaciones", "Observaciones", 10000],
] as const;
type Form = Record<string, string>;
export function ProveedoresComercialesClient({ slug, puedeCrear, puedeEditar }: { slug: string; puedeCrear: boolean; puedeEditar: boolean }) {
  const api = `/api/empresas/${encodeURIComponent(slug)}/compras/proveedores`;
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [buscar, setBuscar] = useState("");
  const [form, setForm] = useState<Form | null>(null);
  const [id, setId] = useState<number | null>(null);
  const [activo, setActivo] = useState(true);
  const [mensaje, setMensaje] = useState("");
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [ocupado, setOcupado] = useState(false);
  const bloqueo = useRef(false);
  const cargar = useCallback(async () => {
    const response = await fetch(api, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "No se pudo cargar el catálogo.");
    setProveedores(data.proveedores);
  }, [api]);
  useEffect(() => {
    const controller = new AbortController();
    fetch(api, { cache: "no-store", signal: controller.signal }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error("No se pudo cargar el catálogo.");
      return data;
    }).then(data => { if (!controller.signal.aborted) setProveedores(data.proveedores); })
      .catch(() => { if (!controller.signal.aborted) setMensaje("No se pudo cargar el catálogo."); });
    return () => controller.abort();
  }, [api]);
  function abrir(proveedor?: Proveedor) {
    setId(proveedor?.id ?? null); setActivo(proveedor?.activo ?? true); setErrores({}); setMensaje("");
    setForm(Object.fromEntries(camposFormulario.map(([c]) => [c, proveedor?.[c] == null ? "" : String(proveedor[c])])));
  }
  async function guardar(payload: Record<string, unknown>, proveedorId: number | null) {
    if (bloqueo.current) return;
    bloqueo.current = true; setOcupado(true); setMensaje(""); setErrores({});
    try {
      const response = await fetch(proveedorId === null ? api : `${api}/${proveedorId}`, { method: proveedorId === null ? "POST" : "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json();
      if (!response.ok) { setErrores(data.erroresCampos ?? {}); throw new Error(data.error || "No se pudo guardar."); }
      setForm(null); setMensaje("Proveedor guardado."); await cargar();
    } catch (error) { setMensaje(error instanceof Error ? error.message : "No se pudo guardar."); }
    finally { bloqueo.current = false; setOcupado(false); }
  }
  const q = buscar.trim().toLocaleLowerCase();
  const visibles = proveedores.filter(p => [p.nombre_comercial, p.razon_social, p.nit].some(v => v?.toLocaleLowerCase().includes(q)));
  const inputClass = "w-full rounded border border-[var(--border)] bg-[var(--input)] p-2";
  return <main className="p-6 space-y-5">
    <div className="flex justify-between gap-4"><h1 className="text-2xl font-semibold">Proveedores comerciales</h1>{puedeCrear && <button disabled={ocupado} className="rounded bg-[var(--accent)] px-4 py-2 text-white" onClick={() => abrir()}>Nuevo proveedor</button>}</div>
    <p className="text-sm text-[var(--muted)]">Catálogo de compras, independiente de Accesos proveedores.</p>
    {mensaje && <p role="status">{mensaje}</p>}
    {form && <form className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 space-y-4" onSubmit={e => {
      e.preventDefault(); const payload: Record<string, unknown> = { ...form, activo };
      payload.dias_credito = form.dias_credito.trim() === "" ? null : Number(form.dias_credito);
      void guardar(payload, id);
    }}><h2 className="font-semibold">{id === null ? "Nuevo proveedor" : "Editar proveedor"}</h2>
      <fieldset disabled={ocupado} className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {camposFormulario.map(([c, label, max]) => <label key={c}>{label}
          {c === "observaciones" ? <textarea className={inputClass} maxLength={max} value={form[c]} onChange={e => setForm({ ...form, [c]: e.target.value })} /> : <input className={inputClass} required={c === "nombre_comercial"} type={c === "dias_credito" ? "number" : c.includes("correo") ? "email" : "text"} min={c === "dias_credito" ? 0 : undefined} step={c === "dias_credito" ? 1 : undefined} maxLength={max} value={form[c]} onChange={e => setForm({ ...form, [c]: e.target.value })} aria-invalid={Boolean(errores[c])} />}
          {errores[c] && <span className="block text-red-400">{errores[c]}</span>}
        </label>)}
        <label><input type="checkbox" checked={activo} onChange={e => setActivo(e.target.checked)} /> Activo</label>
      </fieldset><div className="flex gap-3"><button className="rounded bg-[var(--accent)] px-4 py-2 text-white" disabled={ocupado} type="submit">{ocupado ? "Guardando…" : "Guardar"}</button><button disabled={ocupado} type="button" onClick={() => setForm(null)}>Cancelar</button></div>
    </form>}
    <label className="block">Buscar por nombre comercial, razón social o NIT<input className={inputClass} value={buscar} onChange={e => setBuscar(e.target.value)} /></label>
    <div className="overflow-x-auto rounded-xl border border-[var(--border)]"><table className="w-full text-sm"><thead><tr>{["Nombre comercial", "Razón social", "NIT", "Contacto", "Teléfono", "Método de pago", "Días crédito", "Estado", "Acciones"].map(h => <th className="p-3 text-left" key={h}>{h}</th>)}</tr></thead>
      <tbody>{visibles.map(p => <tr key={p.id} className="border-t border-[var(--border)]">{[p.nombre_comercial, p.razon_social, p.nit, p.contacto_nombre, p.telefono, p.metodo_pago_habitual, p.dias_credito, p.activo ? "Activo" : "Inactivo"].map((v, i) => <td className="p-3" key={i}>{v ?? "—"}</td>)}<td className="p-3">{puedeEditar && <div className="flex gap-3"><button disabled={ocupado} onClick={() => abrir(p)}>Editar</button><button disabled={ocupado} onClick={() => void guardar({ activo: !p.activo }, p.id)}>{p.activo ? "Inactivar" : "Reactivar"}</button></div>}</td></tr>)}
        {!visibles.length && <tr><td colSpan={9} className="p-4">No hay proveedores para mostrar.</td></tr>}
      </tbody></table></div>
  </main>;
}
