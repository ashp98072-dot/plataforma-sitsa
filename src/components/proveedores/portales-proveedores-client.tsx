"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type Portal = {
  id: number;
  proveedor: string;
  nombrePortal: string;
  url: string;
  usuarioPortal: string;
  asignadoUsuarioId: number;
  asignadoUsername: string;
  asignadoNombre: string | null;
  notas: string | null;
  activo: boolean;
};

type Usuario = {
  id: number;
  username: string;
  nombre: string | null;
  rol: string;
};

const FORM_INICIAL = {
  id: 0,
  proveedor: "",
  nombrePortal: "",
  url: "",
  usuarioPortal: "",
  password: "",
  asignadoUsuarioId: 0,
  notas: "",
  activo: true,
};

export function PortalesProveedoresClient({ slug }: { slug: string }) {
  const [portales, setPortales] = useState<Portal[]>([]);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [puedeAdministrar, setPuedeAdministrar] = useState(false);
  const [puedeCrear, setPuedeCrear] = useState(false);
  const [usuarioActualId, setUsuarioActualId] = useState(0);
  const [form, setForm] = useState(FORM_INICIAL);
  const [passwords, setPasswords] = useState<Record<number, string>>({});
  const [cargando, setCargando] = useState(true);
  const [mensaje, setMensaje] = useState("");
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    const res = await fetch(`/api/empresas/${slug}/portales-proveedores`, {
      cache: "no-store",
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? "No se pudieron cargar los portales.");
    setPortales(body.portales ?? []);
    setUsuarios(body.usuariosAsignables ?? []);
    setPuedeAdministrar(Boolean(body.puedeAdministrar));
    setPuedeCrear(Boolean(body.puedeCrear));
    setUsuarioActualId(Number(body.usuarioActualId ?? 0));
    setForm((actual) => ({
      ...actual,
      asignadoUsuarioId:
        actual.asignadoUsuarioId ||
        body.usuariosAsignables?.[0]?.id ||
        Number(body.usuarioActualId ?? 0),
    }));
  }, [slug]);

  useEffect(() => {
    const inicio = window.setTimeout(() => {
      void cargar()
        .catch((e) => setError(e instanceof Error ? e.message : "Error al cargar."))
        .finally(() => setCargando(false));
    }, 0);
    return () => window.clearTimeout(inicio);
  }, [cargar]);

  async function guardar(ev: FormEvent) {
    ev.preventDefault();
    setError("");
    setMensaje("");
    const res = await fetch(`/api/empresas/${slug}/portales-proveedores`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const body = await res.json();
    if (!res.ok) {
      setError(body.error ?? "No se pudo guardar.");
      return;
    }
    setMensaje(body.mensaje);
    setForm({
      ...FORM_INICIAL,
      asignadoUsuarioId: usuarios[0]?.id ?? usuarioActualId,
    });
    setPasswords({});
    await cargar();
  }

  function editar(portal: Portal) {
    setForm({
      id: portal.id,
      proveedor: portal.proveedor,
      nombrePortal: portal.nombrePortal,
      url: portal.url,
      usuarioPortal: portal.usuarioPortal,
      password: "",
      asignadoUsuarioId: portal.asignadoUsuarioId,
      notas: portal.notas ?? "",
      activo: portal.activo,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function revelar(id: number) {
    if (passwords[id]) {
      setPasswords((actual) => {
        const siguiente = { ...actual };
        delete siguiente[id];
        return siguiente;
      });
      return;
    }
    setError("");
    const res = await fetch(
      `/api/empresas/${slug}/portales-proveedores/${id}/revelar`,
      { method: "POST" },
    );
    const body = await res.json();
    if (!res.ok) {
      setError(body.error ?? "No se pudo mostrar la contraseña.");
      return;
    }
    setPasswords((actual) => ({ ...actual, [id]: body.password }));
  }

  async function copiar(valor: string, etiqueta: string) {
    await navigator.clipboard.writeText(valor);
    setMensaje(`${etiqueta} copiado.`);
  }

  async function eliminar(id: number) {
    if (!window.confirm("¿Eliminar este portal y su credencial?")) return;
    const res = await fetch(`/api/empresas/${slug}/portales-proveedores/${id}`, {
      method: "DELETE",
    });
    const body = await res.json();
    if (!res.ok) {
      setError(body.error ?? "No se pudo eliminar.");
      return;
    }
    setMensaje(body.mensaje);
    await cargar();
  }

  const input = "rounded border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm";

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Accesos de proveedores</h1>
        <p className="text-sm text-[var(--muted)]">
          Módulo interno de Operaciones para consultar enlaces y credenciales
          asignados exclusivamente a tu usuario.
        </p>
      </header>

      {error ? <p className="rounded border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">{error}</p> : null}
      {mensaje ? <p className="rounded border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-200">{mensaje}</p> : null}

      {puedeCrear ? (
        <form onSubmit={guardar} className="grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 md:grid-cols-2 xl:grid-cols-3">
          <h2 className="text-lg font-semibold md:col-span-2 xl:col-span-3">
            {form.id ? "Editar portal" : "Registrar portal"}
          </h2>
          <label className="text-sm">Proveedor<input className={`${input} mt-1 w-full`} value={form.proveedor} onChange={(e) => setForm({ ...form, proveedor: e.target.value })} required /></label>
          <label className="text-sm">Nombre del portal<input className={`${input} mt-1 w-full`} value={form.nombrePortal} onChange={(e) => setForm({ ...form, nombrePortal: e.target.value })} required /></label>
          <label className="text-sm">Enlace<input className={`${input} mt-1 w-full`} type="url" placeholder="https://..." value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} required /></label>
          <label className="text-sm">Usuario del proveedor<input className={`${input} mt-1 w-full`} value={form.usuarioPortal} onChange={(e) => setForm({ ...form, usuarioPortal: e.target.value })} required /></label>
          <label className="text-sm">Contraseña{form.id ? " (vacío conserva la actual)" : ""}<input className={`${input} mt-1 w-full`} type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required={!form.id} /></label>
          {puedeAdministrar ? <label className="text-sm">Asignar a usuario<select className={`${input} mt-1 w-full`} value={form.asignadoUsuarioId} onChange={(e) => setForm({ ...form, asignadoUsuarioId: Number(e.target.value) })} required><option value={0}>Seleccionar…</option>{usuarios.map((u) => <option key={u.id} value={u.id}>{u.nombre ?? u.username} · {u.rol} ({u.username})</option>)}</select></label> : <p className="self-end rounded border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm text-[var(--muted)]">Este acceso se guardará únicamente para tu usuario.</p>}
          <label className="text-sm md:col-span-2 xl:col-span-3">Notas<textarea className={`${input} mt-1 min-h-20 w-full`} value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.activo} onChange={(e) => setForm({ ...form, activo: e.target.checked })} /> Portal activo</label>
          <div className="flex gap-2 md:col-span-2 xl:col-span-3">
            <button className="rounded bg-[var(--accent)] px-4 py-2 text-sm text-white" type="submit">{form.id ? "Guardar cambios" : "Guardar portal"}</button>
            {form.id ? <button className="rounded bg-slate-600 px-4 py-2 text-sm" type="button" onClick={() => setForm({ ...FORM_INICIAL, asignadoUsuarioId: usuarios[0]?.id ?? usuarioActualId })}>Cancelar</button> : null}
          </div>
        </form>
      ) : null}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{puedeAdministrar ? "Portales registrados" : "Mis portales asignados"}</h2>
          <span className="text-sm text-[var(--muted)]">{portales.length} portal(es)</span>
        </div>
        {cargando ? <p className="text-sm text-[var(--muted)]">Cargando…</p> : null}
        {!cargando && !portales.length ? <p className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm text-[var(--muted)]">No hay portales asignados.</p> : null}
        <div className="grid gap-4 lg:grid-cols-2">
          {portales.map((p) => (
            <article key={p.id} className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
              <div className="flex items-start justify-between gap-3">
                <div><h3 className="font-semibold">{p.proveedor}</h3><p className="text-sm text-[var(--muted)]">{p.nombrePortal}</p></div>
                {!p.activo ? <span className="rounded bg-slate-500/20 px-2 py-1 text-xs">Inactivo</span> : null}
              </div>
              <div className="rounded-lg bg-[var(--input)] p-3 text-sm">
                <p><span className="text-[var(--muted)]">Usuario:</span> {p.usuarioPortal}</p>
                <p className="break-all"><span className="text-[var(--muted)]">Contraseña:</span> {passwords[p.id] ?? "••••••••••••"}</p>
              </div>
              {p.notas ? <p className="text-sm">{p.notas}</p> : null}
              {puedeAdministrar ? <p className="text-xs text-[var(--muted)]">Asignado a: {p.asignadoNombre ?? p.asignadoUsername} ({p.asignadoUsername})</p> : null}
              <div className="flex flex-wrap gap-2">
                <a href={p.url} target="_blank" rel="noopener noreferrer" className="rounded bg-[var(--accent)] px-3 py-1.5 text-sm text-white">Abrir portal</a>
                <button type="button" className="rounded bg-slate-700 px-3 py-1.5 text-sm" onClick={() => void copiar(p.usuarioPortal, "Usuario")}>Copiar usuario</button>
                <button type="button" className="rounded bg-slate-700 px-3 py-1.5 text-sm" onClick={() => void revelar(p.id)}>{passwords[p.id] ? "Ocultar contraseña" : "Mostrar contraseña"}</button>
                {passwords[p.id] ? <button type="button" className="rounded bg-slate-700 px-3 py-1.5 text-sm" onClick={() => void copiar(passwords[p.id], "Contraseña")}>Copiar contraseña</button> : null}
                {puedeCrear ? <><button type="button" className="rounded bg-amber-700 px-3 py-1.5 text-sm" onClick={() => editar(p)}>Editar</button><button type="button" className="rounded bg-red-800 px-3 py-1.5 text-sm" onClick={() => void eliminar(p.id)}>Eliminar</button></> : null}
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
