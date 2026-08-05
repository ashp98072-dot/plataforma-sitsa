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
  auxiliares?: string[];
  evidencias: number;
};

export default function TmsPage() {
  const slug = String(useParams().slug);
  const [planes, setPlanes] = useState<Plan[]>([]);
  const [placasFlota, setPlacasFlota] = useState<string[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  type EmpOps = { id: number; codigo: string; nombre: string; categoriaOps: string };
  const [form, setForm] = useState({
    codigo: "",
    fechaPlan: new Date().toISOString().slice(0, 10),
    horaCarga: "08:00",
    clienteNombre: "",
    placa: "",
    pilotoEmpleadoId: 0,
    pilotoNombre: "",
    auxiliarEmpleadoIds: [] as number[],
    auxiliarNombres: [] as string[],
    tipoTraslado: "",
    lugarCarga: "",
    lugarDescarga: "",
  });
  const [auxInput, setAuxInput] = useState("");
  const [edit, setEdit] = useState({
    pilotoNombre: "",
    auxiliarNombre: "",
    placa: "",
    estado: "Programado",
  });
  const [msg, setMsg] = useState("");
  const [catalogoMsg, setCatalogoMsg] = useState("");
  const [pilotos, setPilotos] = useState<EmpOps[]>([]);
  const [auxiliares, setAuxiliares] = useState<EmpOps[]>([]);
  const [counts, setCounts] = useState({
    clientes: 0,
    lugares: 0,
    unidades: 0,
    personal: 0,
  });

  const cargar = useCallback(async () => {
    const [res, cat, pil, aux] = await Promise.all([
      fetch(`/api/empresas/${slug}/tms/planes`),
      fetch(`/api/empresas/${slug}/tms/catalogos`),
      fetch(`/api/empresas/${slug}/rrhh/personal-ops?tipo=Piloto`),
      fetch(`/api/empresas/${slug}/rrhh/personal-ops?tipo=Auxiliar`),
    ]);
    const data = await res.json();
    const c = await cat.json();
    const p = await pil.json();
    const a = await aux.json();
    if (res.ok) {
      setPlanes(data.planes ?? []);
      setPlacasFlota(data.placasFlota ?? []);
    }
    if (cat.ok) {
      setCounts({
        clientes: (c.clientes ?? []).length,
        lugares: (c.lugares ?? []).length,
        unidades: (c.unidades ?? []).length,
        personal: (c.personal ?? []).length,
      });
    }
    if (pil.ok) setPilotos(p.personal ?? []);
    if (aux.ok) setAuxiliares(a.personal ?? []);
  }, [slug]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  function totalAux() {
    return form.auxiliarEmpleadoIds.length + form.auxiliarNombres.length;
  }

  function toggleAux(id: number) {
    setForm((f) => {
      const has = f.auxiliarEmpleadoIds.includes(id);
      if (has) {
        return {
          ...f,
          auxiliarEmpleadoIds: f.auxiliarEmpleadoIds.filter((x) => x !== id),
        };
      }
      if (f.auxiliarEmpleadoIds.length + f.auxiliarNombres.length >= 8) return f;
      return { ...f, auxiliarEmpleadoIds: [...f.auxiliarEmpleadoIds, id] };
    });
  }

  function agregarAuxNombre() {
    const t = auxInput.trim();
    if (t.length < 2) return;
    setForm((f) => {
      if (f.auxiliarEmpleadoIds.length + f.auxiliarNombres.length >= 8) return f;
      if (
        f.auxiliarNombres.some(
          (n) => n.toLowerCase() === t.toLowerCase(),
        )
      ) {
        return f;
      }
      return { ...f, auxiliarNombres: [...f.auxiliarNombres, t] };
    });
    setAuxInput("");
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.pilotoEmpleadoId && !form.pilotoNombre.trim()) {
      setMsg("Indica el piloto (elige de RRHH o escríbelo).");
      return;
    }
    const res = await fetch(`/api/empresas/${slug}/tms/planes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        pilotoEmpleadoId: form.pilotoEmpleadoId || undefined,
        pilotoNombre: form.pilotoNombre.trim() || undefined,
        auxiliarEmpleadoIds: form.auxiliarEmpleadoIds.length
          ? form.auxiliarEmpleadoIds
          : undefined,
        auxiliarNombres: form.auxiliarNombres.length
          ? form.auxiliarNombres
          : undefined,
      }),
    });
    const data = await res.json();
    setMsg(data.mensaje || data.error);
    if (res.ok) {
      setForm((f) => ({
        ...f,
        codigo: "",
        pilotoEmpleadoId: 0,
        pilotoNombre: "",
        auxiliarEmpleadoIds: [],
        auxiliarNombres: [],
        placa: "",
        clienteNombre: "",
      }));
      setAuxInput("");
      await cargar();
    }
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
    const inputEl = document.createElement("input");
    inputEl.type = "file";
    inputEl.accept = "image/*";
    inputEl.onchange = async () => {
      const file = inputEl.files?.[0];
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
    inputEl.click();
  }

  const input =
    "rounded border border-[var(--border)] bg-[#0b1217] px-2 py-1 text-sm";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">TMS / Logística</h1>
        <p className="text-sm text-[var(--muted)]">
          Planes de viaje. Puedes asignar hasta 8 auxiliares. Las placas salen
          de Flota / Predios (propias y compartidas). Al registrar salida el
          piloto se enlaza al plan.
        </p>
      </div>

      <div className="grid gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm sm:grid-cols-4">
        <p>Clientes: {counts.clientes}</p>
        <p>Lugares: {counts.lugares}</p>
        <p>Unidades flota: {placasFlota.length || counts.unidades}</p>
        <p>
          RRHH ops: {pilotos.length} pilotos / {auxiliares.length} aux
        </p>
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
        <input
          className={input}
          placeholder="Código plan"
          value={form.codigo}
          onChange={(e) => setForm({ ...form, codigo: e.target.value })}
          required
        />
        <input
          type="date"
          className={input}
          value={form.fechaPlan}
          onChange={(e) => setForm({ ...form, fechaPlan: e.target.value })}
        />
        <input
          className={input}
          placeholder="Hora carga"
          value={form.horaCarga}
          onChange={(e) => setForm({ ...form, horaCarga: e.target.value })}
        />
        <input
          className={input}
          placeholder="Cliente"
          value={form.clienteNombre}
          onChange={(e) => setForm({ ...form, clienteNombre: e.target.value })}
        />
        <label className="text-xs text-[var(--muted)] md:col-span-1">
          Placa (flota)
          <input
            className={`${input} mt-1 w-full font-mono uppercase`}
            placeholder="Ej. C-015BNG"
            value={form.placa}
            list="placas-tms-flota"
            onChange={(e) => setForm({ ...form, placa: e.target.value })}
          />
          <datalist id="placas-tms-flota">
            {placasFlota.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </label>
        <label className="text-xs text-[var(--muted)]">
          Piloto (escribe o elige de RRHH)
          <input
            className={`${input} mt-1 w-full`}
            placeholder="Ej. Walter Villagrán"
            value={
              form.pilotoEmpleadoId
                ? pilotos.find((p) => p.id === form.pilotoEmpleadoId)?.nombre ??
                  form.pilotoNombre
                : form.pilotoNombre
            }
            list="pilotos-rrhh-tms"
            onChange={(e) => {
              const val = e.target.value;
              const match = pilotos.find(
                (p) => p.nombre.toLowerCase() === val.trim().toLowerCase(),
              );
              setForm({
                ...form,
                pilotoNombre: val,
                pilotoEmpleadoId: match ? match.id : 0,
              });
            }}
          />
          <datalist id="pilotos-rrhh-tms">
            {pilotos.map((p) => (
              <option key={p.id} value={p.nombre}>
                {p.codigo}
              </option>
            ))}
          </datalist>
        </label>

        <div className="md:col-span-3 space-y-2 rounded border border-[var(--border)] p-3">
          <p className="text-xs text-[var(--muted)]">
            Auxiliares (máx. 8) — {totalAux()}/8. Marca de RRHH o escribe y
            pulsa Enter.
          </p>
          <div className="flex gap-2">
            <input
              className={`${input} flex-1`}
              placeholder="Escribir auxiliar y Enter"
              value={auxInput}
              onChange={(e) => setAuxInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  agregarAuxNombre();
                }
              }}
              disabled={totalAux() >= 8}
            />
            <button
              type="button"
              className="rounded bg-[#334155] px-3 py-1 text-xs text-white"
              onClick={() => agregarAuxNombre()}
            >
              Agregar
            </button>
          </div>
          {form.auxiliarNombres.length ? (
            <ul className="flex flex-wrap gap-2">
              {form.auxiliarNombres.map((n) => (
                <li
                  key={n}
                  className="flex items-center gap-1 rounded border border-sky-700 bg-sky-950/30 px-2 py-1 text-xs"
                >
                  {n}
                  <button
                    type="button"
                    className="text-red-300"
                    onClick={() =>
                      setForm((f) => ({
                        ...f,
                        auxiliarNombres: f.auxiliarNombres.filter((x) => x !== n),
                      }))
                    }
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex max-h-28 flex-wrap gap-2 overflow-y-auto">
            {auxiliares.map((p) => {
              const on = form.auxiliarEmpleadoIds.includes(p.id);
              return (
                <label
                  key={p.id}
                  className={[
                    "flex cursor-pointer items-center gap-1 rounded border px-2 py-1 text-xs",
                    on
                      ? "border-sky-500 bg-sky-950/40"
                      : "border-[var(--border)]",
                  ].join(" ")}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!on && totalAux() >= 8}
                    onChange={() => toggleAux(p.id)}
                  />
                  {p.nombre}
                </label>
              );
            })}
          </div>
        </div>

        <input
          className={input}
          placeholder="Lugar carga"
          value={form.lugarCarga}
          onChange={(e) => setForm({ ...form, lugarCarga: e.target.value })}
        />
        <input
          className={input}
          placeholder="Lugar descarga"
          value={form.lugarDescarga}
          onChange={(e) => setForm({ ...form, lugarDescarga: e.target.value })}
        />
        <input
          className={input}
          placeholder="Tipo traslado"
          value={form.tipoTraslado}
          onChange={(e) => setForm({ ...form, tipoTraslado: e.target.value })}
        />
        <button className="rounded bg-[var(--accent)] px-3 py-1 text-sm text-white">
          Crear plan
        </button>
      </form>

      {selected ? (
        <div className="grid gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 md:grid-cols-4">
          <p className="md:col-span-4 text-sm text-[var(--muted)]">
            Editando plan #{selected} (cambio mismo día)
          </p>
          <input
            className={input}
            placeholder="Nuevo piloto"
            value={edit.pilotoNombre}
            onChange={(e) => setEdit({ ...edit, pilotoNombre: e.target.value })}
          />
          <input
            className={input}
            placeholder="Nuevo auxiliar (texto)"
            value={edit.auxiliarNombre}
            onChange={(e) =>
              setEdit({ ...edit, auxiliarNombre: e.target.value })
            }
          />
          <input
            className={input}
            placeholder="Nueva placa"
            value={edit.placa}
            onChange={(e) => setEdit({ ...edit, placa: e.target.value })}
          />
          <select
            className={input}
            value={edit.estado}
            onChange={(e) => setEdit({ ...edit, estado: e.target.value })}
          >
            {[
              "Programado",
              "En ruta",
              "Cargado",
              "Descargado",
              "Cerrado",
              "Cancelado",
            ].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void actualizarPlan()}
            className="rounded bg-[#1F6AA5] px-3 py-1 text-sm"
          >
            Guardar cambios
          </button>
          <button
            type="button"
            onClick={() => void subirEvidencia("Carga")}
            className="rounded bg-[#0d9488] px-3 py-1 text-sm"
          >
            Evidencia carga
          </button>
          <button
            type="button"
            onClick={() => void subirEvidencia("Descarga")}
            className="rounded bg-[#0f766e] px-3 py-1 text-sm"
          >
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
              <th className="px-3 py-2">Auxiliares</th>
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
                <td className="px-3 py-2">
                  {String(p.fecha_plan).slice(0, 10)}
                </td>
                <td className="px-3 py-2">{p.cliente ?? "—"}</td>
                <td className="px-3 py-2">{p.placa ?? "—"}</td>
                <td className="px-3 py-2">{p.piloto ?? "—"}</td>
                <td className="max-w-[200px] px-3 py-2 text-xs">
                  {(p.auxiliares ?? []).length
                    ? p.auxiliares!.join(", ")
                    : (p.auxiliar ?? "—")}
                </td>
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
