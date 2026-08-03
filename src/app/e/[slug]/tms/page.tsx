"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";

type Plan = {
  id: number;
  codigo: string;
  fecha_plan: string;
  hora_carga: string | null;
  estado: string;
  cliente: string | null;
  placa: string | null;
  piloto: string | null;
  auxiliar: string | null;
  evidencias: number;
};

export default function TmsPage() {
  const slug = String(useParams().slug);
  const [planes, setPlanes] = useState<Plan[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [form, setForm] = useState({
    codigo: "",
    fechaPlan: new Date().toISOString().slice(0, 10),
    horaCarga: "08:00",
    clienteNombre: "",
    placa: "",
    pilotoNombre: "",
    auxiliarNombre: "",
    tipoTraslado: "",
    lugarCarga: "",
    lugarDescarga: "",
  });
  const [edit, setEdit] = useState({
    pilotoNombre: "",
    auxiliarNombre: "",
    placa: "",
    estado: "Programado",
  });
  const [msg, setMsg] = useState("");
  const [catalogoMsg, setCatalogoMsg] = useState("");
  const [counts, setCounts] = useState({
    clientes: 0,
    lugares: 0,
    unidades: 0,
    personal: 0,
  });

  const cargar = useCallback(async () => {
    const [res, cat] = await Promise.all([
      fetch(`/api/empresas/${slug}/tms/planes`),
      fetch(`/api/empresas/${slug}/tms/catalogos`),
    ]);
    const data = await res.json();
    const c = await cat.json();
    if (res.ok) setPlanes(data.planes ?? []);
    if (cat.ok) {
      setCounts({
        clientes: (c.clientes ?? []).length,
        lugares: (c.lugares ?? []).length,
        unidades: (c.unidades ?? []).length,
        personal: (c.personal ?? []).length,
      });
    }
  }, [slug]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const res = await fetch(`/api/empresas/${slug}/tms/planes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    setMsg(data.mensaje || data.error);
    if (res.ok) await cargar();
  }

  async function actualizarPlan() {
    if (!selected) return;
    const res = await fetch(`/api/empresas/${slug}/tms/planes`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: selected, ...edit }),
    });
    const data = await res.json();
    setMsg(data.mensaje || data.error);
    if (res.ok) await cargar();
  }

  async function subirEvidencia(tipo: "Carga" | "Descarga") {
    if (!selected) {
      setMsg("Selecciona un plan.");
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      let latitud: number | undefined;
      let longitud: number | undefined;
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            timeout: 5000,
          }),
        );
        latitud = pos.coords.latitude;
        longitud = pos.coords.longitude;
      } catch {
        /* geo opcional */
      }
      const fd = new FormData();
      fd.set("planId", String(selected));
      fd.set("tipo", tipo);
      fd.set("file", file);
      if (latitud != null) fd.set("latitud", String(latitud));
      if (longitud != null) fd.set("longitud", String(longitud));
      const res = await fetch(`/api/empresas/${slug}/tms/evidencias`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      setMsg(data.mensaje || data.error);
      if (res.ok) await cargar();
    };
    input.click();
  }

  const input =
    "rounded border border-[var(--border)] bg-[#0b1217] px-2 py-1 text-sm";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">TMS / Logística</h1>
        <p className="text-sm text-[var(--muted)]">
          Planes de viaje, cambios de piloto/auxiliar el mismo día, evidencias
          con foto + geo.
        </p>
      </div>

      <div className="grid gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm sm:grid-cols-4">
        <p>Clientes: {counts.clientes}</p>
        <p>Lugares: {counts.lugares}</p>
        <p>Unidades: {counts.unidades}</p>
        <p>Personal: {counts.personal}</p>
        <button
          type="button"
          className="rounded bg-[#334155] px-2 py-1 text-xs sm:col-span-4"
          onClick={async () => {
            const res = await fetch(`/api/empresas/${slug}/tms/catalogos`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                kind: "cliente",
                nombre: `Cliente ${Date.now().toString().slice(-4)}`,
              }),
            });
            const data = await res.json();
            setCatalogoMsg(data.mensaje || data.error);
            if (res.ok) await cargar();
          }}
        >
          + Cliente rápido
        </button>
        {catalogoMsg ? (
          <p className="text-emerald-300 sm:col-span-4">{catalogoMsg}</p>
        ) : null}
      </div>

      <form
        onSubmit={onSubmit}
        className="grid gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 md:grid-cols-3"
      >
        <input className={input} placeholder="Código plan" value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })} required />
        <input type="date" className={input} value={form.fechaPlan} onChange={(e) => setForm({ ...form, fechaPlan: e.target.value })} />
        <input className={input} placeholder="Hora carga" value={form.horaCarga} onChange={(e) => setForm({ ...form, horaCarga: e.target.value })} />
        <input className={input} placeholder="Cliente" value={form.clienteNombre} onChange={(e) => setForm({ ...form, clienteNombre: e.target.value })} />
        <input className={input} placeholder="Placa unidad" value={form.placa} onChange={(e) => setForm({ ...form, placa: e.target.value })} />
        <input className={input} placeholder="Piloto" value={form.pilotoNombre} onChange={(e) => setForm({ ...form, pilotoNombre: e.target.value })} />
        <input className={input} placeholder="Auxiliar" value={form.auxiliarNombre} onChange={(e) => setForm({ ...form, auxiliarNombre: e.target.value })} />
        <input className={input} placeholder="Lugar carga" value={form.lugarCarga} onChange={(e) => setForm({ ...form, lugarCarga: e.target.value })} />
        <input className={input} placeholder="Lugar descarga" value={form.lugarDescarga} onChange={(e) => setForm({ ...form, lugarDescarga: e.target.value })} />
        <input className={input} placeholder="Tipo traslado" value={form.tipoTraslado} onChange={(e) => setForm({ ...form, tipoTraslado: e.target.value })} />
        <button className="rounded bg-[var(--accent)] px-3 py-1 text-sm text-white">Crear plan</button>
      </form>

      {selected ? (
        <div className="grid gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 md:grid-cols-4">
          <p className="md:col-span-4 text-sm text-[var(--muted)]">
            Editando plan #{selected} (cambio mismo día)
          </p>
          <input className={input} placeholder="Nuevo piloto" value={edit.pilotoNombre} onChange={(e) => setEdit({ ...edit, pilotoNombre: e.target.value })} />
          <input className={input} placeholder="Nuevo auxiliar" value={edit.auxiliarNombre} onChange={(e) => setEdit({ ...edit, auxiliarNombre: e.target.value })} />
          <input className={input} placeholder="Nueva placa" value={edit.placa} onChange={(e) => setEdit({ ...edit, placa: e.target.value })} />
          <select className={input} value={edit.estado} onChange={(e) => setEdit({ ...edit, estado: e.target.value })}>
            {["Programado", "En ruta", "Cargado", "Descargado", "Cerrado", "Cancelado"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <button type="button" onClick={() => void actualizarPlan()} className="rounded bg-[#1F6AA5] px-3 py-1 text-sm">
            Guardar cambios
          </button>
          <button type="button" onClick={() => void subirEvidencia("Carga")} className="rounded bg-[#0d9488] px-3 py-1 text-sm">
            Evidencia carga
          </button>
          <button type="button" onClick={() => void subirEvidencia("Descarga")} className="rounded bg-[#0f766e] px-3 py-1 text-sm">
            Evidencia descarga
          </button>
        </div>
      ) : null}

      {msg ? <p className="text-sm text-emerald-300">{msg}</p> : null}

      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-[#1F6AA5] text-white">
            <tr>
              <th className="px-3 py-2">Código</th>
              <th className="px-3 py-2">Fecha</th>
              <th className="px-3 py-2">Cliente</th>
              <th className="px-3 py-2">Placa</th>
              <th className="px-3 py-2">Piloto</th>
              <th className="px-3 py-2">Auxiliar</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2">Evid.</th>
            </tr>
          </thead>
          <tbody>
            {planes.map((p) => (
              <tr
                key={p.id}
                className={[
                  "cursor-pointer border-t border-[var(--border)]",
                  selected === p.id ? "bg-white/5" : "",
                ].join(" ")}
                onClick={() => setSelected(p.id)}
              >
                <td className="px-3 py-2">{p.codigo}</td>
                <td className="px-3 py-2">{String(p.fecha_plan).slice(0, 10)}</td>
                <td className="px-3 py-2">{p.cliente ?? "—"}</td>
                <td className="px-3 py-2">{p.placa ?? "—"}</td>
                <td className="px-3 py-2">{p.piloto ?? "—"}</td>
                <td className="px-3 py-2">{p.auxiliar ?? "—"}</td>
                <td className="px-3 py-2">{p.estado}</td>
                <td className="px-3 py-2">{Number(p.evidencias ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
