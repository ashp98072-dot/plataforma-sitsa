"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  RRHH_SUBMODULOS,
  RRHH_SUBMODULO_LABEL,
  permisosDefaultPorRol,
  type PermisoModulo,
} from "@/lib/permisos-shared";
import type { RolGlobal } from "@/lib/roles";

type Empresa = { id: number; nombre: string; codigo: string };
type Usuario = {
  id: number;
  username: string;
  nombre: string | null;
  email: string | null;
  rol: string;
  activo: boolean;
  accesoTodas: boolean;
  empresas: number[];
  permisos: PermisoModulo[];
};

const ROLES = [
  "Admin",
  "RRHH",
  "Contabilidad",
  "Operaciones",
  "CoordinadorPredios",
  "Visualizador",
] as const;

function clonePermisos(rol: string): PermisoModulo[] {
  return permisosDefaultPorRol(rol as RolGlobal).map((p) => ({ ...p }));
}

function mergePermisos(base: PermisoModulo[]): PermisoModulo[] {
  const map = new Map(base.map((p) => [p.modulo, p]));
  return RRHH_SUBMODULOS.map(
    (m) =>
      map.get(m) ?? {
        modulo: m,
        puedeVer: false,
        puedeCrear: false,
        puedeEditar: false,
        puedeEliminar: false,
      },
  );
}

export default function UsuariosPage() {
  const slug = String(useParams().slug);
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [editId, setEditId] = useState<number | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [nombre, setNombre] = useState("");
  const [rol, setRol] = useState<string>("RRHH");
  const [accesoTodas, setAccesoTodas] = useState(false);
  const [activo, setActivo] = useState(true);
  const [empresaIds, setEmpresaIds] = useState<number[]>([]);
  const [permisos, setPermisos] = useState<PermisoModulo[]>(() =>
    clonePermisos("RRHH"),
  );
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    const me = await fetch("/api/auth/me").then((r) => r.json());
    if (me.user?.rol !== "Admin") {
      setAllowed(false);
      router.replace(`/e/${slug}/dashboard-rrhh`);
      return;
    }
    setAllowed(true);
    if (me.empresas) setEmpresas(me.empresas);

    const u = await fetch("/api/usuarios").then((r) => r.json());
    if (u.usuarios) setUsuarios(u.usuarios);
  }, [router, slug]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  function resetForm() {
    setEditId(null);
    setUsername("");
    setPassword("");
    setNombre("");
    setRol("RRHH");
    setAccesoTodas(false);
    setActivo(true);
    setEmpresaIds([]);
    setPermisos(clonePermisos("RRHH"));
  }

  function empezarEdicion(u: Usuario) {
    setEditId(u.id);
    setUsername(u.username);
    setPassword("");
    setNombre(u.nombre ?? "");
    setRol(u.rol);
    setAccesoTodas(u.accesoTodas);
    setActivo(u.activo);
    setEmpresaIds([...u.empresas]);
    setPermisos(mergePermisos(u.permisos ?? clonePermisos(u.rol)));
    setMsg("");
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function toggleEmpresa(id: number) {
    setEmpresaIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function setPermisoFlag(
    modulo: string,
    flag: keyof Omit<PermisoModulo, "modulo">,
    value: boolean,
  ) {
    setPermisos((prev) =>
      prev.map((p) => (p.modulo === modulo ? { ...p, [flag]: value } : p)),
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setMsg("");
    const payload = {
      username,
      password: password || undefined,
      nombre,
      rol,
      accesoTodas:
        accesoTodas ||
        rol === "RRHH" ||
        rol === "Contabilidad" ||
        rol === "Admin",
      activo,
      empresaIds,
      permisos: rol === "Admin" ? undefined : permisos,
    };

    const res = await fetch("/api/usuarios", {
      method: editId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        editId
          ? { id: editId, ...payload, password: password || undefined }
          : { ...payload, password: password || "" },
      ),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Error");
      return;
    }
    setMsg(data.mensaje);
    resetForm();
    await cargar();
  }

  if (!allowed) {
    return (
      <p className="text-sm text-[var(--muted)]">
        Solo el administrador puede gestionar usuarios…
      </p>
    );
  }

  const input =
    "rounded border border-[var(--border)] bg-[#0b1217] px-2 py-1 text-sm w-full";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Usuarios y permisos</h1>
        <p className="text-sm text-[var(--muted)]">
          Solo Admin. Asigna empresas y marca qué puede hacer cada usuario por
          módulo (Ver / Crear / Editar / Eliminar). Contexto: {slug}
        </p>
      </div>

      <form
        onSubmit={onSubmit}
        className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">
            {editId ? `Editar: ${username}` : "Crear usuario"}
          </h2>
          {editId ? (
            <button
              type="button"
              className="rounded bg-[#334155] px-3 py-1 text-sm"
              onClick={resetForm}
            >
              Cancelar edición
            </button>
          ) : null}
        </div>

        <div className="grid gap-2 md:grid-cols-2">
          <label className="text-sm text-[var(--muted)]">
            Usuario
            <input
              className={`${input} mt-1`}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              disabled={editId != null}
            />
          </label>
          <label className="text-sm text-[var(--muted)]">
            Contraseña{editId ? " (dejar vacío = no cambiar)" : ""}
            <input
              type="password"
              className={`${input} mt-1`}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required={editId == null}
              minLength={editId ? 0 : 4}
            />
          </label>
          <label className="text-sm text-[var(--muted)]">
            Nombre
            <input
              className={`${input} mt-1`}
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
            />
          </label>
          <label className="text-sm text-[var(--muted)]">
            Rol
            <select
              className={`${input} mt-1`}
              value={rol}
              onChange={(e) => {
                const r = e.target.value;
                setRol(r);
                setPermisos(clonePermisos(r));
                if (r === "RRHH" || r === "Contabilidad" || r === "Admin") {
                  setAccesoTodas(true);
                }
              }}
            >
              {ROLES.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={accesoTodas}
            onChange={(e) => setAccesoTodas(e.target.checked)}
          />
          Acceso a todas las empresas
        </label>

        {editId ? (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={activo}
              onChange={(e) => setActivo(e.target.checked)}
            />
            Usuario activo
          </label>
        ) : null}

        <div>
          <p className="mb-1 text-sm text-[var(--muted)]">Empresas</p>
          <div className="flex flex-wrap gap-2">
            {empresas.map((e) => (
              <label
                key={e.id}
                className="flex items-center gap-1 rounded border border-[var(--border)] px-2 py-1 text-sm"
              >
                <input
                  type="checkbox"
                  checked={empresaIds.includes(e.id) || accesoTodas}
                  disabled={accesoTodas}
                  onChange={() => toggleEmpresa(e.id)}
                />
                {e.codigo}
              </label>
            ))}
          </div>
        </div>

        {rol !== "Admin" ? (
          <div>
            <p className="mb-2 text-sm font-medium">
              Permisos RRHH por módulo
            </p>
            <p className="mb-2 text-xs text-[var(--muted)]">
              Ejemplo: RRHH puede tener “Ver empleados” y “Crear empleado”, pero
              sin “Eliminar”.
            </p>
            <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#0d1522] text-[var(--muted)]">
                  <tr>
                    <th className="px-2 py-2">Módulo</th>
                    <th className="px-2 py-2">Ver</th>
                    <th className="px-2 py-2">Crear</th>
                    <th className="px-2 py-2">Editar</th>
                    <th className="px-2 py-2">Eliminar</th>
                  </tr>
                </thead>
                <tbody>
                  {permisos.map((p) => (
                    <tr key={p.modulo} className="border-t border-[var(--border)]">
                      <td className="px-2 py-1.5">
                        {RRHH_SUBMODULO_LABEL[
                          p.modulo as keyof typeof RRHH_SUBMODULO_LABEL
                        ] ?? p.modulo}
                      </td>
                      {(
                        [
                          ["puedeVer", "Ver"],
                          ["puedeCrear", "Crear"],
                          ["puedeEditar", "Editar"],
                          ["puedeEliminar", "Eliminar"],
                        ] as const
                      ).map(([flag]) => (
                        <td key={flag} className="px-2 py-1.5">
                          <input
                            type="checkbox"
                            checked={p[flag]}
                            onChange={(e) =>
                              setPermisoFlag(p.modulo, flag, e.target.checked)
                            }
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <p className="text-sm text-[var(--muted)]">
            Admin tiene acceso completo; no necesita matriz de permisos.
          </p>
        )}

        <button className="rounded bg-[var(--accent)] px-4 py-2 text-sm text-white">
          {editId ? "Guardar cambios" : "Crear usuario"}
        </button>
      </form>

      {error ? <p className="text-sm text-red-300">{error}</p> : null}
      {msg ? <p className="text-sm text-emerald-300">{msg}</p> : null}

      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-[#334155] text-white">
            <tr>
              <th className="px-3 py-2">Usuario</th>
              <th className="px-3 py-2">Nombre</th>
              <th className="px-3 py-2">Rol</th>
              <th className="px-3 py-2">Todas</th>
              <th className="px-3 py-2">Activo</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {usuarios.map((u) => (
              <tr key={u.id} className="border-t border-[var(--border)]">
                <td className="px-3 py-2">{u.username}</td>
                <td className="px-3 py-2">{u.nombre || "—"}</td>
                <td className="px-3 py-2">{u.rol}</td>
                <td className="px-3 py-2">{u.accesoTodas ? "Sí" : "No"}</td>
                <td className="px-3 py-2">{u.activo ? "Sí" : "No"}</td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    className="text-[var(--accent-2)] underline"
                    onClick={() => empezarEdicion(u)}
                  >
                    Editar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
