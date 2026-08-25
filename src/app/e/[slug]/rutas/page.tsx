"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ClienteSearch } from "@/components/tms/cliente-search";

type ClienteOpt = {
  id: number;
  nombre: string;
  codigo?: string | null;
  nit?: string | null;
  telefono?: string | null;
  estado?: string | null;
};

type UbicacionCliente = {
  id: number;
  nombre: string;
  direccion: string | null;
};

type ContactoCliente = {
  id: number;
  nombre: string;
  cargo: string | null;
  telefono: string | null;
};

type RutaParada = {
  id: number;
  orden: number;
  tipo: string;
  lugarNombre: string;
  clienteUbicacionId: number | null;
};

type ClienteRuta = {
  id: number;
  clienteId: number;
  clienteNombre: string;
  codigo: string;
  nombre: string | null;
  ubicacionCargaId: number | null;
  lugarCargaTexto: string | null;
  destinoDescripcion: string | null;
  horaHabitual: string | null;
  contactoClienteId: number | null;
  contactoNombre: string | null;
  contactoCargo: string | null;
  contactoTelefono: string | null;
  observaciones: string | null;
  activo: boolean;
  paradas: RutaParada[];
};

type ParadaForm = { tipo: string; lugarNombre: string; clienteUbicacionId: number | null };

const inputCls =
  "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm";

const FORM_VACIO = {
  codigo: "",
  nombre: "",
  ubicacionCargaId: null as number | null,
  lugarCargaTexto: "",
  destinoDescripcion: "",
  horaHabitual: "",
  contactoClienteId: null as number | null,
  observaciones: "",
};

/**
 * VIAT-4 (punto 2) — Operaciones > Rutas: catálogo maestro de rutas/
 * servicios preconfigurados por cliente (de la hoja "CODIGOS DATA" del
 * Excel real). Buscar por código, cliente, nombre o descripción de
 * destino; crear/editar/activar-desactivar (nunca hard-delete). Reutiliza
 * ClienteSearch (ya existente), tms_cliente_ubicaciones (VIAT-1) y
 * tms_cliente_contactos (VIAT-4) — no duplica direcciones ni teléfonos.
 *
 * VIAT-4b — código único POR EMPRESA (confirmado contra el Excel real:
 * 147 registros, 147 códigos únicos). `destinoDescripcion` es la
 * descripción operativa completa del destino (texto libre, formato tipo
 * "RUTA-X - punto1-punto2-punto3"), SEPARADA de las paradas estructuradas
 * de abajo — ambas se guardan y se muestran, ninguna reemplaza a la otra.
 */
export default function RutasPage() {
  const slug = String(useParams().slug);

  const [clientes, setClientes] = useState<ClienteOpt[]>([]);
  const [rutas, setRutas] = useState<ClienteRuta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  const [fCodigo, setFCodigo] = useState("");
  const [fClienteId, setFClienteId] = useState(0);
  const [fClienteNombre, setFClienteNombre] = useState("");
  const [fTexto, setFTexto] = useState("");

  const [mostrarForm, setMostrarForm] = useState(false);
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [form, setForm] = useState(FORM_VACIO);
  const [formClienteId, setFormClienteId] = useState(0);
  const [formClienteNombre, setFormClienteNombre] = useState("");
  const [paradasForm, setParadasForm] = useState<ParadaForm[]>([]);
  const [ubicacionesForm, setUbicacionesForm] = useState<UbicacionCliente[]>([]);
  const [contactosForm, setContactosForm] = useState<ContactoCliente[]>([]);
  const [guardando, setGuardando] = useState(false);

  const cargarClientes = useCallback(async () => {
    const res = await fetch(`/api/empresas/${slug}/tms/catalogos`);
    const data = await res.json().catch(() => ({}));
    if (res.ok) setClientes((data.clientes ?? []) as ClienteOpt[]);
  }, [slug]);

  const cargarRutas = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ todas: "1" });
      if (fCodigo.trim()) params.set("q", fCodigo.trim());
      else if (fTexto.trim()) params.set("q", fTexto.trim());
      if (fClienteId) params.set("clienteId", String(fClienteId));
      const res = await fetch(`/api/empresas/${slug}/tms/rutas?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "No se pudieron cargar las rutas.");
        return;
      }
      setRutas((data.rutas ?? []) as ClienteRuta[]);
      if (data.aviso) setError(data.aviso);
    } catch {
      setError("Error de conexión.");
    } finally {
      setLoading(false);
    }
  }, [slug, fCodigo, fTexto, fClienteId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargarClientes();
  }, [cargarClientes]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargarRutas();
  }, [cargarRutas]);

  // Ubicaciones/contactos del cliente elegido EN EL FORMULARIO (para armar carga/paradas/contacto).
  useEffect(() => {
    let ignore = false;
    (async () => {
      if (!formClienteId) {
        setUbicacionesForm([]);
        setContactosForm([]);
        return;
      }
      const [ru, rc] = await Promise.all([
        fetch(`/api/empresas/${slug}/tms/clientes/${formClienteId}/ubicaciones`),
        fetch(`/api/empresas/${slug}/tms/clientes/${formClienteId}/contactos`),
      ]);
      const [du, dc] = await Promise.all([ru.json().catch(() => ({})), rc.json().catch(() => ({}))]);
      if (ignore) return;
      setUbicacionesForm((du.ubicaciones ?? []) as UbicacionCliente[]);
      setContactosForm((dc.contactos ?? []) as ContactoCliente[]);
    })();
    return () => {
      ignore = true;
    };
  }, [slug, formClienteId]);

  function abrirNueva() {
    setEditandoId(null);
    setForm(FORM_VACIO);
    setFormClienteId(fClienteId || 0);
    setFormClienteNombre(fClienteNombre || "");
    setParadasForm([{ tipo: "Entrega", lugarNombre: "", clienteUbicacionId: null }]);
    setMostrarForm(true);
  }

  function abrirEditar(r: ClienteRuta) {
    setEditandoId(r.id);
    setForm({
      codigo: r.codigo,
      nombre: r.nombre ?? "",
      ubicacionCargaId: r.ubicacionCargaId,
      lugarCargaTexto: r.lugarCargaTexto ?? "",
      destinoDescripcion: r.destinoDescripcion ?? "",
      horaHabitual: r.horaHabitual ?? "",
      contactoClienteId: r.contactoClienteId,
      observaciones: r.observaciones ?? "",
    });
    setFormClienteId(r.clienteId);
    setFormClienteNombre(r.clienteNombre);
    setParadasForm(
      r.paradas.length
        ? r.paradas.map((p) => ({ tipo: p.tipo, lugarNombre: p.lugarNombre, clienteUbicacionId: p.clienteUbicacionId }))
        : [{ tipo: "Entrega", lugarNombre: "", clienteUbicacionId: null }],
    );
    setMostrarForm(true);
  }

  async function guardar() {
    if (!formClienteId) {
      setError("Selecciona el cliente de la ruta.");
      return;
    }
    const codigo = form.codigo.trim();
    if (!codigo) {
      setError("Indica el código de la ruta.");
      return;
    }
    setGuardando(true);
    setError("");
    setMsg("");
    const paradas = paradasForm.filter((p) => p.lugarNombre.trim());
    try {
      const body: Record<string, unknown> = {
        codigo,
        nombre: form.nombre.trim() || undefined,
        ubicacionCargaId: form.ubicacionCargaId ?? undefined,
        lugarCargaTexto: form.lugarCargaTexto.trim() || undefined,
        destinoDescripcion: form.destinoDescripcion.trim() || undefined,
        horaHabitual: form.horaHabitual.trim() || undefined,
        contactoClienteId: form.contactoClienteId ?? undefined,
        observaciones: form.observaciones.trim() || undefined,
        paradas,
      };
      if (!editandoId) body.clienteId = formClienteId;
      const res = editandoId
        ? await fetch(`/api/empresas/${slug}/tms/rutas/${editandoId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetch(`/api/empresas/${slug}/tms/rutas`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "No se pudo guardar.");
        return;
      }
      const guardada = data.ruta as ClienteRuta;
      setRutas((list) => {
        const existe = list.some((r) => r.id === guardada.id);
        const next = existe ? list.map((r) => (r.id === guardada.id ? guardada : r)) : [guardada, ...list];
        return next;
      });
      setMsg(data.mensaje ?? "Guardado.");
      setMostrarForm(false);
    } catch {
      setError("Error de conexión.");
    } finally {
      setGuardando(false);
    }
  }

  async function toggleActivo(r: ClienteRuta) {
    setError("");
    setMsg("");
    try {
      const res = await fetch(`/api/empresas/${slug}/tms/rutas/${r.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activo: !r.activo }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "No se pudo actualizar.");
        return;
      }
      const actualizada = data.ruta as ClienteRuta;
      setRutas((list) => list.map((x) => (x.id === actualizada.id ? actualizada : x)));
    } catch {
      setError("Error de conexión.");
    }
  }

  const rutasFiltradas = rutas;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Rutas</h1>
        <p className="text-sm text-[var(--muted)]">
          Catálogo maestro de rutas/servicios preconfigurados por cliente (código, lugar de carga
          habitual, hora habitual, contacto y destinos). Programación copia estos datos al crear un
          viaje — cambiar una ruta aquí nunca altera viajes ya creados.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <label className="text-xs text-[var(--muted)]">
          Código
          <input className={`${inputCls} mt-0.5 block w-28`} value={fCodigo} onChange={(e) => setFCodigo(e.target.value)} />
        </label>
        <div className="w-56">
          <ClienteSearch
            clientes={clientes}
            valueNombre={fClienteNombre}
            valueId={fClienteId}
            inputClassName={inputCls}
            onChange={({ clienteId, clienteNombre }) => {
              setFClienteId(clienteId);
              setFClienteNombre(clienteNombre);
            }}
          />
        </div>
        <label className="text-xs text-[var(--muted)]">
          Nombre/descripción
          <input className={`${inputCls} mt-0.5 block w-48`} value={fTexto} onChange={(e) => setFTexto(e.target.value)} />
        </label>
        <button type="button" className="rounded bg-[#334155] px-3 py-1.5 text-xs text-white" disabled={loading} onClick={() => void cargarRutas()}>
          {loading ? "Buscando…" : "Buscar"}
        </button>
        <button type="button" className="rounded bg-[var(--accent)] px-3 py-1.5 text-xs text-white" onClick={abrirNueva}>
          + Nueva ruta
        </button>
      </div>

      {error ? <p className="text-xs text-red-300">{error}</p> : null}
      {msg ? <p className="text-xs text-emerald-400">{msg}</p> : null}

      {mostrarForm ? (
        <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <p className="text-sm font-medium">{editandoId ? "Editar ruta" : "Nueva ruta"}</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-1">
              <ClienteSearch
                clientes={clientes}
                valueNombre={formClienteNombre}
                valueId={formClienteId}
                inputClassName={inputCls}
                onChange={({ clienteId, clienteNombre }) => {
                  setFormClienteId(clienteId);
                  setFormClienteNombre(clienteNombre);
                  setForm((f) => ({ ...f, ubicacionCargaId: null, contactoClienteId: null }));
                }}
              />
            </div>
            <label className="text-xs text-[var(--muted)]">
              Código
              <input className={`${inputCls} mt-0.5 w-full`} value={form.codigo} onChange={(e) => setForm((f) => ({ ...f, codigo: e.target.value }))} />
            </label>
            <label className="text-xs text-[var(--muted)]">
              Nombre/descripción
              <input className={`${inputCls} mt-0.5 w-full`} value={form.nombre} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))} />
            </label>

            <label className="text-xs text-[var(--muted)]">
              Lugar de carga (ubicación guardada)
              <select
                className={`${inputCls} mt-0.5 w-full`}
                value={form.ubicacionCargaId ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, ubicacionCargaId: Number(e.target.value) || null }))}
              >
                <option value="">— Ninguna —</option>
                {ubicacionesForm.map((u) => (
                  <option key={u.id} value={u.id}>{u.nombre}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-[var(--muted)]">
              Lugar de carga (texto libre, si no está en el catálogo)
              <input
                className={`${inputCls} mt-0.5 w-full`}
                value={form.lugarCargaTexto}
                onChange={(e) => setForm((f) => ({ ...f, lugarCargaTexto: e.target.value }))}
              />
            </label>
            <label className="text-xs text-[var(--muted)]">
              Hora habitual
              <input
                type="time"
                className={`${inputCls} mt-0.5 w-full`}
                value={form.horaHabitual}
                onChange={(e) => setForm((f) => ({ ...f, horaHabitual: e.target.value }))}
              />
            </label>
            <label className="text-xs text-[var(--muted)] sm:col-span-3">
              Destino (descripción operativa completa — como la usa Operaciones, ej. &quot;RUTA-A -
              punto1-punto2-punto3&quot;)
              <input
                className={`${inputCls} mt-0.5 w-full`}
                value={form.destinoDescripcion}
                onChange={(e) => setForm((f) => ({ ...f, destinoDescripcion: e.target.value }))}
              />
              <span className="mt-0.5 block text-[10px]">
                Esta descripción es lo que sale en el reporte tradicional (columna &quot;Lugar de
                Descarga&quot;). Las paradas estructuradas de abajo son un dato aparte, para
                seguimiento operativo — no la reemplazan.
              </span>
            </label>

            <label className="text-xs text-[var(--muted)] sm:col-span-2">
              Contacto del cliente
              <select
                className={`${inputCls} mt-0.5 w-full`}
                value={form.contactoClienteId ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, contactoClienteId: Number(e.target.value) || null }))}
              >
                <option value="">— Ninguno —</option>
                {contactosForm.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}{c.cargo ? ` (${c.cargo})` : ""}{c.telefono ? ` · ${c.telefono}` : ""}
                  </option>
                ))}
              </select>
              {formClienteId && !contactosForm.length ? (
                <span className="mt-0.5 block text-[10px] text-amber-300/90">
                  Este cliente no tiene contactos guardados todavía — agrégalos desde TMS ▸ Configuración.
                </span>
              ) : null}
            </label>
            <label className="text-xs text-[var(--muted)]">
              Observaciones
              <input className={`${inputCls} mt-0.5 w-full`} value={form.observaciones} onChange={(e) => setForm((f) => ({ ...f, observaciones: e.target.value }))} />
            </label>
          </div>

          <div className="space-y-2 rounded border border-[var(--border)] p-3">
            <p className="text-xs font-medium">Paradas estructuradas (opcional, uno o varios puntos con orden — para seguimiento operativo, aparte de la descripción de destino)</p>
            {paradasForm.map((p, idx) => (
              <div key={idx} className="flex flex-wrap items-center gap-2">
                <span className="w-6 text-xs text-[var(--muted)]">{idx + 1}.</span>
                <input
                  className={`${inputCls} min-w-[160px] flex-1`}
                  placeholder="Lugar / destino"
                  value={p.lugarNombre}
                  onChange={(e) =>
                    setParadasForm((list) => list.map((x, i) => (i === idx ? { ...x, lugarNombre: e.target.value, clienteUbicacionId: null } : x)))
                  }
                />
                <select
                  className={inputCls}
                  value={p.tipo}
                  onChange={(e) => setParadasForm((list) => list.map((x, i) => (i === idx ? { ...x, tipo: e.target.value } : x)))}
                >
                  <option value="Entrega">Entrega</option>
                  <option value="Descarga">Descarga</option>
                  <option value="Carga">Carga</option>
                </select>
                {ubicacionesForm.length ? (
                  <select
                    className={`${inputCls} max-w-[180px]`}
                    value={p.clienteUbicacionId ?? ""}
                    onChange={(e) => {
                      const id = Number(e.target.value);
                      const u = ubicacionesForm.find((x) => x.id === id);
                      setParadasForm((list) =>
                        list.map((x, i) => (i === idx ? { ...x, clienteUbicacionId: id || null, lugarNombre: u ? u.nombre : x.lugarNombre } : x)),
                      );
                    }}
                  >
                    <option value="">— Ubicación guardada —</option>
                    {ubicacionesForm.map((u) => (
                      <option key={u.id} value={u.id}>{u.nombre}</option>
                    ))}
                  </select>
                ) : null}
                <button type="button" className="text-xs text-red-300" onClick={() => setParadasForm((list) => list.filter((_, i) => i !== idx))}>
                  Quitar
                </button>
              </div>
            ))}
            <button
              type="button"
              className="rounded bg-[#334155] px-2 py-1 text-xs text-white"
              onClick={() => setParadasForm((list) => [...list, { tipo: "Entrega", lugarNombre: "", clienteUbicacionId: null }])}
            >
              + Agregar destino
            </button>
          </div>

          <div className="flex gap-2">
            <button type="button" disabled={guardando} onClick={() => void guardar()} className="rounded bg-[var(--accent)] px-3 py-1.5 text-xs text-white disabled:opacity-50">
              {guardando ? "Guardando…" : editandoId ? "Guardar cambios" : "Crear ruta"}
            </button>
            <button type="button" className="rounded border border-[var(--border)] px-3 py-1.5 text-xs" onClick={() => setMostrarForm(false)}>
              Cancelar
            </button>
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-[#1F6AA5] text-white">
            <tr>
              <th className="px-3 py-2">Código</th>
              <th className="px-3 py-2">Cliente</th>
              <th className="px-3 py-2">Nombre</th>
              <th className="px-3 py-2">Carga</th>
              <th className="px-3 py-2">Hora</th>
              <th className="px-3 py-2">Contacto</th>
              <th className="px-3 py-2">Destino (descripción)</th>
              <th className="px-3 py-2">Paradas estructuradas</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {rutasFiltradas.map((r) => (
              <tr key={r.id} className={`border-t border-[var(--border)] ${r.activo ? "" : "opacity-50"}`}>
                <td className="px-3 py-2 font-mono">{r.codigo}</td>
                <td className="px-3 py-2">{r.clienteNombre}</td>
                <td className="px-3 py-2">{r.nombre || "—"}</td>
                <td className="px-3 py-2 text-[11px]">{r.lugarCargaTexto || "—"}</td>
                <td className="px-3 py-2">{r.horaHabitual || "—"}</td>
                <td className="px-3 py-2 text-[11px]">
                  {r.contactoNombre ? `${r.contactoNombre}${r.contactoTelefono ? ` · ${r.contactoTelefono}` : ""}` : "—"}
                </td>
                <td className="px-3 py-2 text-[11px]">{r.destinoDescripcion || "—"}</td>
                <td className="px-3 py-2 text-[11px]">
                  {r.paradas.length ? r.paradas.map((p) => p.lugarNombre).join(" → ") : "—"}
                </td>
                <td className="px-3 py-2">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${r.activo ? "bg-emerald-900/50 text-emerald-200" : "bg-[var(--input)] text-[var(--muted)]"}`}>
                    {r.activo ? "Activa" : "Inactiva"}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <div className="flex gap-2 text-xs">
                    <button type="button" className="text-sky-300 hover:underline" onClick={() => abrirEditar(r)}>Editar</button>
                    <button
                      type="button"
                      className={r.activo ? "text-amber-300 hover:underline" : "text-emerald-300 hover:underline"}
                      onClick={() => void toggleActivo(r)}
                    >
                      {r.activo ? "Desactivar" : "Activar"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!rutasFiltradas.length && !loading ? (
              <tr>
                <td colSpan={10} className="px-3 py-4 text-[var(--muted)]">Sin rutas con este filtro.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
