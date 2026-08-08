"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import { ClienteSearch } from "@/components/tms/cliente-search";

type ParadaForm = {
  lugarNombre: string;
  tipo: "Carga" | "Descarga" | "Entrega";
  requiereEvidencia: boolean;
};

type PlanParada = {
  id: number;
  orden: number;
  lugar_nombre: string;
  tipo: string;
  requiere_evidencia: boolean;
  evidencias: number;
};

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
  paradas?: PlanParada[];
  paradasPendientes?: number;
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
    clienteId: 0,
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
  type ClienteCat = {
    id: number;
    nombre: string;
    nit?: string | null;
    telefono?: string | null;
    estado?: string | null;
  };
  const [clientesCat, setClientesCat] = useState<ClienteCat[]>([]);
  const [savingPlan, setSavingPlan] = useState(false);
  const [paradasForm, setParadasForm] = useState<ParadaForm[]>([
    { lugarNombre: "", tipo: "Carga", requiereEvidencia: true },
    { lugarNombre: "", tipo: "Entrega", requiereEvidencia: true },
  ]);
  const [editParadas, setEditParadas] = useState<ParadaForm[]>([]);
  const [auxInput, setAuxInput] = useState("");
  const [edit, setEdit] = useState({
    pilotoNombre: "",
    placa: "",
    estado: "Programado",
  });
  const [editAuxEmpleadoIds, setEditAuxEmpleadoIds] = useState<number[]>([]);
  const [editAuxNombres, setEditAuxNombres] = useState<string[]>([]);
  const [editAuxInput, setEditAuxInput] = useState("");
  const [nuevaParadaNombre, setNuevaParadaNombre] = useState("");
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
  type AudRow = {
    id: number;
    usuario: string | null;
    accion: string;
    modulo: string | null;
    detalle: string | null;
    creadoEn: string;
  };
  const [bitacora, setBitacora] = useState<AudRow[]>([]);
  const [mostrarBitacora, setMostrarBitacora] = useState(false);

  const cargarBitacora = useCallback(async () => {
    const res = await fetch(
      `/api/empresas/${slug}/auditoria?modulo=tms&limite=150`,
    );
    const data = await res.json().catch(() => ({}));
    if (res.ok) setBitacora((data.auditoria ?? []) as AudRow[]);
  }, [slug]);

  const sugerirCodigo = useCallback(
    async (fecha: string) => {
      const res = await fetch(
        `/api/empresas/${slug}/tms/planes?nextCodigo=1&fecha=${encodeURIComponent(fecha)}`,
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.codigo) {
        setForm((f) => ({ ...f, codigo: String(data.codigo) }));
      }
    },
    [slug],
  );

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
      const clientes = (c.clientes ?? []) as ClienteCat[];
      setClientesCat(clientes);
      setCounts({
        clientes: clientes.length,
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

  useEffect(() => {
    void sugerirCodigo(form.fechaPlan);
    // Solo al montar / cambiar fecha (no en cada keystroke de otros campos)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intencional
  }, [form.fechaPlan, sugerirCodigo]);

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
    if (savingPlan) return;
    if (!form.clienteId && !form.clienteNombre.trim()) {
      setMsg("Busca y selecciona un cliente (o escribe el nombre).");
      return;
    }
    if (!form.pilotoEmpleadoId && !form.pilotoNombre.trim()) {
      setMsg("Indica el piloto (elige de RRHH o escríbelo).");
      return;
    }
    const paradas = paradasForm
      .filter((p) => p.lugarNombre.trim())
      .map((p) => ({
        lugarNombre: p.lugarNombre.trim(),
        tipo: p.tipo,
        requiereEvidencia: p.requiereEvidencia,
      }));
    if (!paradas.length) {
      setMsg("Agrega al menos una parada (lugar) con evidencia de producto.");
      return;
    }
    setSavingPlan(true);
    setMsg("");
    try {
      const res = await fetch(`/api/empresas/${slug}/tms/planes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          codigo: form.codigo || undefined,
          fechaPlan: form.fechaPlan,
          horaCarga: form.horaCarga,
          tipoTraslado: form.tipoTraslado || undefined,
          clienteId: form.clienteId || undefined,
          clienteNombre: form.clienteNombre.trim() || undefined,
          placa: form.placa || undefined,
          pilotoEmpleadoId: form.pilotoEmpleadoId || undefined,
          pilotoNombre: form.pilotoNombre.trim() || undefined,
          auxiliarEmpleadoIds: form.auxiliarEmpleadoIds.length
            ? form.auxiliarEmpleadoIds
            : undefined,
          auxiliarNombres: form.auxiliarNombres.length
            ? form.auxiliarNombres
            : undefined,
          paradas,
          lugarCarga: paradas.find((p) => p.tipo === "Carga")?.lugarNombre,
          lugarDescarga: paradas.find(
            (p) => p.tipo === "Descarga" || p.tipo === "Entrega",
          )?.lugarNombre,
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
          clienteId: 0,
          clienteNombre: "",
          tipoTraslado: "",
        }));
        setParadasForm([
          { lugarNombre: "", tipo: "Carga", requiereEvidencia: true },
          { lugarNombre: "", tipo: "Entrega", requiereEvidencia: true },
        ]);
        setAuxInput("");
        await Promise.all([
          cargar(),
          sugerirCodigo(form.fechaPlan),
          mostrarBitacora ? cargarBitacora() : Promise.resolve(),
        ]);
      }
    } finally {
      setSavingPlan(false);
    }
  }

  function totalAuxEdit() {
    return editAuxEmpleadoIds.length + editAuxNombres.length;
  }

  function toggleAuxEdit(id: number) {
    setEditAuxEmpleadoIds((ids) => {
      if (ids.includes(id)) return ids.filter((x) => x !== id);
      if (ids.length + editAuxNombres.length >= 8) return ids;
      return [...ids, id];
    });
  }

  function agregarAuxNombreEdit() {
    const t = editAuxInput.trim();
    if (t.length < 2) return;
    if (totalAuxEdit() >= 8) return;
    if (editAuxNombres.some((n) => n.toLowerCase() === t.toLowerCase())) {
      setEditAuxInput("");
      return;
    }
    // Si coincide con RRHH, marcar checkbox en vez de texto libre
    const match = auxiliares.find(
      (a) => a.nombre.toLowerCase() === t.toLowerCase(),
    );
    if (match) {
      setEditAuxEmpleadoIds((ids) =>
        ids.includes(match.id) ? ids : [...ids, match.id].slice(0, 8),
      );
    } else {
      setEditAuxNombres((list) => [...list, t].slice(0, 8));
    }
    setEditAuxInput("");
  }

  async function actualizarPlan() {
    if (!selected) return;
    const paradas = editParadas
      .filter((p) => p.lugarNombre.trim())
      .map((p) => ({
        lugarNombre: p.lugarNombre.trim(),
        tipo: p.tipo,
        requiereEvidencia: p.requiereEvidencia,
      }));
    const res = await fetch(`/api/empresas/${slug}/tms/planes`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: selected,
        pilotoNombre: edit.pilotoNombre.trim() || undefined,
        placa: edit.placa.trim() || undefined,
        estado: edit.estado,
        auxiliarEmpleadoIds: editAuxEmpleadoIds,
        auxiliarNombres: editAuxNombres,
        paradas: paradas.length ? paradas : undefined,
      }),
    });
    const data = await res.json();
    setMsg(data.mensaje || data.error);
    if (res.ok) {
      await cargar();
      if (mostrarBitacora) await cargarBitacora();
    }
  }

  function labelAccionAud(accion: string): string {
    switch (accion) {
      case "crear_ruta":
        return "Creó ruta";
      case "editar_ruta":
        return "Editó ruta";
      case "cancelar_ruta":
        return "Canceló ruta";
      case "salida_viaje":
        return "Salida (piloto)";
      case "llegada_viaje":
        return "Llegada / cierre";
      case "eliminar_evidencia":
        return "Eliminó evidencia";
      default:
        return accion;
    }
  }

  function seleccionarPlan(p: Plan) {
    setSelected(p.id);
    setEdit({
      pilotoNombre: p.piloto ?? "",
      placa: p.placa ?? "",
      estado: p.estado || "Programado",
    });
    setEditParadas(
      (p.paradas ?? []).map((x) => ({
        lugarNombre: x.lugar_nombre,
        tipo: (["Carga", "Descarga", "Entrega"].includes(x.tipo)
          ? x.tipo
          : "Entrega") as ParadaForm["tipo"],
        requiereEvidencia: x.requiere_evidencia,
      })),
    );
    // Precargar auxiliares actuales (nombres; RRHH si coincide)
    const nombres = p.auxiliares?.length
      ? p.auxiliares
      : p.auxiliar
        ? p.auxiliar.split(",").map((x) => x.trim()).filter(Boolean)
        : [];
    const ids: number[] = [];
    const libres: string[] = [];
    for (const n of nombres) {
      const match = auxiliares.find(
        (a) => a.nombre.toLowerCase() === n.toLowerCase(),
      );
      if (match) ids.push(match.id);
      else libres.push(n);
    }
    setEditAuxEmpleadoIds(ids.slice(0, 8));
    setEditAuxNombres(libres.slice(0, 8 - ids.length));
    setEditAuxInput("");
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
    "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-sm";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">TMS / Logística</h1>
        <p className="text-sm text-[var(--muted)]">
          Planes de viaje. El código se genera solo. Busca el cliente del
          catálogo compartido. Hasta 8 auxiliares; placas de Flota (propias y
          compartidas).
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
            const nombre = window.prompt("Nombre del cliente:");
            if (!nombre?.trim()) return;
            const res = await fetch(`/api/empresas/${slug}/tms/catalogos`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                kind: "cliente",
                nombre: nombre.trim(),
              }),
            });
            const data = await res.json();
            setCatalogoMsg(data.mensaje || data.error);
            if (res.ok) {
              await cargar();
              if (data.id) {
                setForm((f) => ({
                  ...f,
                  clienteId: Number(data.id),
                  clienteNombre: nombre.trim(),
                }));
              }
            }
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
        <label className="text-xs text-[var(--muted)]">
          Código plan (automático)
          <input
            className={`${input} mt-1 w-full font-mono`}
            placeholder="Se genera solo…"
            value={form.codigo}
            readOnly
            title="Se genera automáticamente según la fecha"
          />
        </label>
        <label className="text-xs text-[var(--muted)]">
          Fecha
          <input
            type="date"
            className={`${input} mt-1 w-full`}
            value={form.fechaPlan}
            onChange={(e) =>
              setForm({ ...form, fechaPlan: e.target.value })
            }
          />
        </label>
        <label className="text-xs text-[var(--muted)]">
          Hora carga
          <input
            className={`${input} mt-1 w-full`}
            placeholder="Hora carga"
            value={form.horaCarga}
            onChange={(e) => setForm({ ...form, horaCarga: e.target.value })}
          />
        </label>
        <ClienteSearch
          clientes={clientesCat}
          valueNombre={form.clienteNombre}
          valueId={form.clienteId}
          inputClassName={input}
          onChange={({ clienteId, clienteNombre }) =>
            setForm((f) => ({ ...f, clienteId, clienteNombre }))
          }
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
          placeholder="Tipo traslado"
          value={form.tipoTraslado}
          onChange={(e) => setForm({ ...form, tipoTraslado: e.target.value })}
        />

        <div className="md:col-span-3 space-y-2 rounded border border-[var(--border)] p-3">
          <p className="text-xs text-[var(--muted)]">
            Paradas / lugares (ej. 3 puntos). En cada una el piloto debe subir
            evidencia del producto.
          </p>
          {paradasForm.map((p, idx) => (
            <div key={idx} className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-[var(--muted)] w-6">{idx + 1}.</span>
              <input
                className={`${input} min-w-[160px] flex-1`}
                placeholder="Nombre del lugar"
                value={p.lugarNombre}
                onChange={(e) =>
                  setParadasForm((list) =>
                    list.map((x, i) =>
                      i === idx ? { ...x, lugarNombre: e.target.value } : x,
                    ),
                  )
                }
              />
              <select
                className={input}
                value={p.tipo}
                onChange={(e) =>
                  setParadasForm((list) =>
                    list.map((x, i) =>
                      i === idx
                        ? {
                            ...x,
                            tipo: e.target.value as ParadaForm["tipo"],
                          }
                        : x,
                    ),
                  )
                }
              >
                <option value="Carga">Carga</option>
                <option value="Entrega">Entrega</option>
                <option value="Descarga">Descarga</option>
              </select>
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={p.requiereEvidencia}
                  onChange={(e) =>
                    setParadasForm((list) =>
                      list.map((x, i) =>
                        i === idx
                          ? { ...x, requiereEvidencia: e.target.checked }
                          : x,
                      ),
                    )
                  }
                />
                Evidencia
              </label>
              <button
                type="button"
                className="text-xs text-red-300"
                onClick={() =>
                  setParadasForm((list) => list.filter((_, i) => i !== idx))
                }
              >
                Quitar
              </button>
            </div>
          ))}
          <button
            type="button"
            className="rounded bg-[#334155] px-2 py-1 text-xs text-white"
            onClick={() =>
              setParadasForm((list) => [
                ...list,
                {
                  lugarNombre: "",
                  tipo: "Entrega",
                  requiereEvidencia: true,
                },
              ])
            }
          >
            + Agregar parada
          </button>
        </div>

        <button
          type="submit"
          disabled={savingPlan}
          className="rounded bg-[var(--accent)] px-3 py-1 text-sm text-white disabled:opacity-60"
        >
          {savingPlan ? "Creando…" : "Crear plan"}
        </button>
      </form>

      {selected ? (
        <div className="grid gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 md:grid-cols-4">
          <p className="md:col-span-4 text-sm text-[var(--muted)]">
            Editando plan #{selected} (cambio mismo día)
          </p>
          <input
            className={input}
            placeholder="Piloto"
            value={edit.pilotoNombre}
            onChange={(e) => setEdit({ ...edit, pilotoNombre: e.target.value })}
          />
          <input
            className={input}
            placeholder="Placa"
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

          <div className="md:col-span-4 space-y-2 rounded border border-[var(--border)] p-3">
            <p className="text-xs text-[var(--muted)]">
              Auxiliares (máx. 8) — {totalAuxEdit()}/8. Marca de RRHH o escribe
              y pulsa Enter / Agregar.
            </p>
            <div className="flex gap-2">
              <input
                className={`${input} flex-1`}
                placeholder="Escribir auxiliar y Enter"
                value={editAuxInput}
                onChange={(e) => setEditAuxInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    agregarAuxNombreEdit();
                  }
                }}
                disabled={totalAuxEdit() >= 8}
              />
              <button
                type="button"
                className="rounded bg-[#334155] px-3 py-1 text-xs text-white disabled:opacity-40"
                disabled={totalAuxEdit() >= 8}
                onClick={() => agregarAuxNombreEdit()}
              >
                Agregar
              </button>
            </div>
            {editAuxNombres.length ? (
              <ul className="flex flex-wrap gap-2">
                {editAuxNombres.map((n) => (
                  <li
                    key={n}
                    className="flex items-center gap-1 rounded border border-sky-700 bg-sky-950/30 px-2 py-1 text-xs"
                  >
                    {n}
                    <button
                      type="button"
                      className="text-red-300"
                      onClick={() =>
                        setEditAuxNombres((list) =>
                          list.filter((x) => x !== n),
                        )
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
                const on = editAuxEmpleadoIds.includes(p.id);
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
                      disabled={!on && totalAuxEdit() >= 8}
                      onChange={() => toggleAuxEdit(p.id)}
                    />
                    {p.nombre}
                  </label>
                );
              })}
            </div>
          </div>

          <div className="md:col-span-4 space-y-2 rounded border border-[var(--border)] p-3">
            <p className="text-xs font-medium">Paradas del plan</p>
            {editParadas.map((p, idx) => (
              <div key={idx} className="flex flex-wrap items-center gap-2">
                <span className="w-6 text-xs text-[var(--muted)]">{idx + 1}.</span>
                <input
                  className={`${input} min-w-[160px] flex-1`}
                  value={p.lugarNombre}
                  onChange={(e) =>
                    setEditParadas((list) =>
                      list.map((x, i) =>
                        i === idx ? { ...x, lugarNombre: e.target.value } : x,
                      ),
                    )
                  }
                />
                <select
                  className={input}
                  value={p.tipo}
                  onChange={(e) =>
                    setEditParadas((list) =>
                      list.map((x, i) =>
                        i === idx
                          ? {
                              ...x,
                              tipo: e.target.value as ParadaForm["tipo"],
                            }
                          : x,
                      ),
                    )
                  }
                >
                  <option value="Carga">Carga</option>
                  <option value="Entrega">Entrega</option>
                  <option value="Descarga">Descarga</option>
                </select>
                <label className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={p.requiereEvidencia}
                    onChange={(e) =>
                      setEditParadas((list) =>
                        list.map((x, i) =>
                          i === idx
                            ? { ...x, requiereEvidencia: e.target.checked }
                            : x,
                        ),
                      )
                    }
                  />
                  Evidencia
                </label>
                <button
                  type="button"
                  className="text-xs text-red-300"
                  onClick={() =>
                    setEditParadas((list) => list.filter((_, i) => i !== idx))
                  }
                >
                  Quitar
                </button>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <input
                className={`${input} flex-1`}
                placeholder="Nueva parada…"
                value={nuevaParadaNombre}
                onChange={(e) => setNuevaParadaNombre(e.target.value)}
              />
              <button
                type="button"
                className="rounded bg-[#334155] px-2 py-1 text-xs text-white"
                onClick={() => {
                  const n = nuevaParadaNombre.trim();
                  if (!n) return;
                  setEditParadas((list) => [
                    ...list,
                    {
                      lugarNombre: n,
                      tipo: "Entrega",
                      requiereEvidencia: true,
                    },
                  ]);
                  setNuevaParadaNombre("");
                }}
              >
                + Parada
              </button>
            </div>
            {(() => {
              const plan = planes.find((x) => x.id === selected);
              if (!plan?.paradas?.length) return null;
              return (
                <ul className="mt-1 space-y-0.5 text-[11px] text-[var(--muted)]">
                  {plan.paradas.map((pp) => (
                    <li key={pp.id}>
                      {pp.orden}. {pp.lugar_nombre} ({pp.tipo}) ·{" "}
                      {pp.evidencias > 0
                        ? `${pp.evidencias} foto(s)`
                        : pp.requiere_evidencia
                          ? "pendiente"
                          : "sin evidencia req."}
                    </li>
                  ))}
                </ul>
              );
            })()}
          </div>

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

      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-medium">Bitácora de rutas</h2>
            <p className="text-[11px] text-[var(--muted)]">
              Quién crea, edita, cancela, sale, cierra o elimina evidencias — con
              fecha y hora.
            </p>
          </div>
          <button
            type="button"
            className="rounded bg-[#334155] px-3 py-1.5 text-xs text-white"
            onClick={() => {
              const next = !mostrarBitacora;
              setMostrarBitacora(next);
              if (next) void cargarBitacora();
            }}
          >
            {mostrarBitacora ? "Ocultar bitácora" : "Ver bitácora"}
          </button>
        </div>
        {mostrarBitacora ? (
          <div className="max-h-80 overflow-auto rounded border border-[var(--border)]">
            <table className="min-w-full text-left text-xs">
              <thead className="sticky top-0 bg-[#1e293b] text-[var(--muted)]">
                <tr>
                  <th className="px-2 py-1.5">Fecha / hora</th>
                  <th className="px-2 py-1.5">Usuario</th>
                  <th className="px-2 py-1.5">Acción</th>
                  <th className="px-2 py-1.5">Detalle</th>
                </tr>
              </thead>
              <tbody>
                {bitacora.map((a) => (
                  <tr
                    key={a.id}
                    className="border-t border-[var(--border)] align-top"
                  >
                    <td className="whitespace-nowrap px-2 py-1.5 font-mono text-[10px] text-sky-300">
                      {a.creadoEn || "—"}
                    </td>
                    <td className="px-2 py-1.5 font-medium">
                      {a.usuario || "—"}
                    </td>
                    <td className="px-2 py-1.5 text-amber-200">
                      {labelAccionAud(a.accion)}
                    </td>
                    <td className="px-2 py-1.5 text-[var(--muted)]">
                      {a.detalle || "—"}
                    </td>
                  </tr>
                ))}
                {!bitacora.length ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-2 py-3 text-[var(--muted)]"
                    >
                      Aún no hay movimientos registrados. Se irán guardando al
                      crear/editar rutas, salidas, llegadas y borrados de
                      evidencias.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

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
              <th className="px-3 py-2">Paradas</th>
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
                onClick={() => seleccionarPlan(p)}
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
                <td className="px-3 py-2 text-xs">
                  {(p.paradas ?? []).length
                    ? `${p.paradas!.length}${
                        p.paradasPendientes
                          ? ` · ${p.paradasPendientes} pend.`
                          : " · ok"
                      }`
                    : "—"}
                </td>
                <td className="px-3 py-2">{Number(p.evidencias ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
