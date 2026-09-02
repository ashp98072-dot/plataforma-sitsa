"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type UsuarioPortal = {
  id: number;
  nombre: string;
  email: string;
  activo: boolean;
  debeCambiarPassword: boolean;
  ultimoAcceso: string | null;
  creadoEn: string;
};

type Props = { slug: string; clienteId: number; puedeEditar: boolean };

const FORM_VACIO = { nombre: "", email: "", passwordInicial: "", confirmarPassword: "" };

function fecha(v: string | null): string {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleString("es-GT", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return v;
  }
}

/**
 * CLIENTE-PORTAL-1C — panel "Acceso Portal" de un cliente: listado +
 * alta + activar/desactivar + reset de contraseña temporal. Llama
 * exclusivamente a /api/empresas/[slug]/clientes/[id]/portal-usuarios*
 * (nunca al endpoint TMS-scoped ni a un tms_clientes.id) — el servidor
 * resuelve la relación real, este componente solo conoce clientes.id.
 */
export function PortalUsuariosPanel({ slug, clienteId, puedeEditar }: Props) {
  const [usuarios, setUsuarios] = useState<UsuarioPortal[]>([]);
  const [loading, setLoading] = useState(true);
  const [sincronizado, setSincronizado] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState(FORM_VACIO);
  const [creando, setCreando] = useState(false);
  const [creado, setCreado] = useState<{ nombre: string; email: string } | null>(null);
  const [accionEnCurso, setAccionEnCurso] = useState<number | null>(null);
  const [resetId, setResetId] = useState<number | null>(null);
  const [passwordReset, setPasswordReset] = useState("");

  const base = `/api/empresas/${slug}/clientes/${clienteId}/portal-usuarios`;

  const cargar = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(base);
      const data = await res.json();
      if (res.status === 409 && data.sincronizado === false) {
        setSincronizado(false);
        setUsuarios([]);
        return;
      }
      setSincronizado(true);
      if (!res.ok) {
        setError(data.error || "No se pudo cargar el listado.");
        return;
      }
      setUsuarios(data.usuarios ?? []);
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargar();
  }, [cargar]);

  async function onCrear(e: FormEvent) {
    e.preventDefault();
    if (!puedeEditar || creando) return;
    setError("");
    if (form.passwordInicial !== form.confirmarPassword) {
      setError("La confirmación de contraseña no coincide.");
      return;
    }
    setCreando(true);
    try {
      const res = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "No se pudo crear el acceso.");
        return;
      }
      setCreado({ nombre: form.nombre, email: form.email });
      setForm(FORM_VACIO);
      await cargar();
    } finally {
      setCreando(false);
    }
  }

  async function onActivar(usuarioId: number, activo: boolean) {
    if (!puedeEditar) return;
    setAccionEnCurso(usuarioId);
    setError("");
    try {
      const res = await fetch(`${base}/${usuarioId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "activar", activo }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "No se pudo actualizar el acceso.");
        return;
      }
      await cargar();
    } finally {
      setAccionEnCurso(null);
    }
  }

  async function onResetear(usuarioId: number) {
    if (!puedeEditar || passwordReset.length < 6) return;
    setAccionEnCurso(usuarioId);
    setError("");
    try {
      const res = await fetch(`${base}/${usuarioId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "resetear", passwordNueva: passwordReset }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "No se pudo reiniciar la contraseña.");
        return;
      }
      setResetId(null);
      setPasswordReset("");
      await cargar();
    } finally {
      setAccionEnCurso(null);
    }
  }

  if (loading) {
    return <p className="text-sm text-[var(--muted)]">Cargando…</p>;
  }

  if (!sincronizado) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <p className="text-sm text-amber-600 dark:text-amber-300">
          Este cliente todavía no está sincronizado con TMS.
        </p>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Un cliente Inactivo no se sincroniza automáticamente. Márcalo como
          Activo desde el listado de Clientes y vuelve a intentarlo.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {error ? (
        <p className="text-sm text-red-500" role="alert">
          {error}
        </p>
      ) : null}

      {creado ? (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm">
          <p className="font-medium text-emerald-700 dark:text-emerald-300">
            Acceso creado correctamente. El usuario deberá cambiar su
            contraseña en el primer ingreso.
          </p>
          <p className="mt-1 text-[var(--muted)]">
            {creado.nombre} · {creado.email}
          </p>
          <p className="mt-2 text-[var(--muted)]">
            URL del portal:{" "}
            <span className="font-mono">/cliente-portal/login</span>
          </p>
          <button
            type="button"
            className="mt-2 text-xs underline text-[var(--muted)]"
            onClick={() => setCreado(null)}
          >
            Cerrar
          </button>
        </div>
      ) : null}

      {puedeEditar ? (
        <form
          onSubmit={onCrear}
          className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"
        >
          <h2 className="font-medium">Crear acceso</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              className="rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm"
              placeholder="Nombre *"
              required
              minLength={2}
              value={form.nombre}
              onChange={(e) => setForm({ ...form, nombre: e.target.value })}
            />
            <input
              type="email"
              className="rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm"
              placeholder="Email *"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
            <input
              type="password"
              className="rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm"
              placeholder="Contraseña temporal *"
              required
              minLength={6}
              value={form.passwordInicial}
              onChange={(e) => setForm({ ...form, passwordInicial: e.target.value })}
            />
            <input
              type="password"
              className="rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm"
              placeholder="Confirmar contraseña temporal *"
              required
              minLength={6}
              value={form.confirmarPassword}
              onChange={(e) => setForm({ ...form, confirmarPassword: e.target.value })}
            />
          </div>
          <button
            type="submit"
            disabled={creando}
            className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm text-white disabled:opacity-60"
          >
            {creando ? "Creando…" : "Crear acceso"}
          </button>
        </form>
      ) : null}

      <section className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="font-medium">Usuarios del portal</h2>
        <div className="table-scroll rounded-xl border border-[var(--border)]">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-[var(--thead)] text-xs uppercase text-[var(--muted)]">
              <tr>
                <th className="px-3 py-2">Nombre</th>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2">Debe cambiar contraseña</th>
                <th className="px-3 py-2">Último acceso</th>
                <th className="px-3 py-2">Creado</th>
                {puedeEditar ? <th className="px-3 py-2" /> : null}
              </tr>
            </thead>
            <tbody>
              {usuarios.map((u) => (
                <tr key={u.id} className="border-t border-[var(--border)] align-top">
                  <td className="px-3 py-2">{u.nombre}</td>
                  <td className="px-3 py-2 text-xs">{u.email}</td>
                  <td className="px-3 py-2 text-xs">
                    {u.activo ? (
                      <span className="text-emerald-600 dark:text-emerald-300">Activo</span>
                    ) : (
                      <span className="text-red-500">Inactivo</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">{u.debeCambiarPassword ? "Sí" : "No"}</td>
                  <td className="px-3 py-2 text-xs">{fecha(u.ultimoAcceso)}</td>
                  <td className="px-3 py-2 text-xs">{fecha(u.creadoEn)}</td>
                  {puedeEditar ? (
                    <td className="px-3 py-2 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={accionEnCurso === u.id}
                          className="text-[var(--accent)] underline disabled:opacity-60"
                          onClick={() => onActivar(u.id, !u.activo)}
                        >
                          {u.activo ? "Desactivar" : "Reactivar"}
                        </button>
                        {resetId === u.id ? (
                          <span className="flex items-center gap-1">
                            <input
                              type="password"
                              placeholder="Nueva contraseña"
                              minLength={6}
                              className="w-32 rounded border border-[var(--border)] bg-[var(--input)] px-1.5 py-1 text-xs"
                              value={passwordReset}
                              onChange={(e) => setPasswordReset(e.target.value)}
                            />
                            <button
                              type="button"
                              disabled={accionEnCurso === u.id || passwordReset.length < 6}
                              className="text-[var(--accent)] underline disabled:opacity-60"
                              onClick={() => onResetear(u.id)}
                            >
                              Guardar
                            </button>
                            <button
                              type="button"
                              className="text-[var(--muted)] underline"
                              onClick={() => {
                                setResetId(null);
                                setPasswordReset("");
                              }}
                            >
                              Cancelar
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="text-[var(--muted)] underline"
                            onClick={() => {
                              setResetId(u.id);
                              setPasswordReset("");
                            }}
                          >
                            Reiniciar contraseña
                          </button>
                        )}
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
              {!usuarios.length ? (
                <tr>
                  <td
                    colSpan={puedeEditar ? 7 : 6}
                    className="px-3 py-6 text-center text-[var(--muted)]"
                  >
                    Este cliente todavía no tiene usuarios del portal.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
