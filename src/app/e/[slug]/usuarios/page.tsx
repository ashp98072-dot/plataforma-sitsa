"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useParams, useRouter } from "next/navigation";
import {
  GRUPOS_PERMISOS,
  catalogoPermisosRol,
  grupoPrincipalDelRol,
  labelPermiso,
  labelRol,
  mergePermisosConCatalogo,
  permisosDefaultPorRol,
  type GrupoPermisosId,
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

// OPS-1: se agregan los 4 roles operativos nuevos; "Operaciones" se
// mantiene (legado, usuarios existentes sin migrar) — ver
// src/lib/roles.ts para la lista canónica (esta lista local solo existe
// para el <select> de este formulario, no duplica lógica de permisos).
const ROLES = [
  "Admin",
  "RRHH",
  "Marcaje",
  "Contabilidad",
  "Operaciones",
  "GerenteOperaciones",
  "JefeOperaciones",
  "AuxiliarOperaciones",
  "Facturador",
  "CoordinadorPredios",
  "CoordinadorCompras",
  "Piloto",
  "Visualizador",
] as const;

const FLAGS = [
  ["puedeVer", "Ver"],
  ["puedeCrear", "Crear"],
  ["puedeEditar", "Editar"],
  ["puedeEliminar", "Eliminar"],
] as const;

function clonePermisos(rol: string): PermisoModulo[] {
  return permisosDefaultPorRol(rol as RolGlobal).map((p) => ({ ...p }));
}

function IconChevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className={[
        "h-3.5 w-3.5 shrink-0 transition-transform",
        open ? "rotate-90" : "",
      ].join(" ")}
      fill="currentColor"
      aria-hidden
    >
      <path d="M7 5l6 5-6 5V5z" />
    </svg>
  );
}

function iconGrupo(id: GrupoPermisosId): ReactNode {
  const cls = "h-4 w-4";
  switch (id) {
    case "rrhh":
      return (
        <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="3" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a3 3 0 0 1 0 5.74" />
        </svg>
      );
    case "operaciones":
      return (
        <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M3 7h13l5 5v5H3V7z" />
          <circle cx="7.5" cy="17.5" r="1.5" />
          <circle cx="17.5" cy="17.5" r="1.5" />
        </svg>
      );
    case "flota":
      return (
        <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="3" y="10" width="18" height="8" rx="1.5" />
          <path d="M5 10V7h8l4 3" />
          <circle cx="7.5" cy="18" r="1.5" />
          <circle cx="16.5" cy="18" r="1.5" />
        </svg>
      );
    case "contabilidad":
      return (
        <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="4" y="3" width="16" height="18" rx="2" />
          <path d="M8 8h8M8 12h8M8 16h5" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
        </svg>
      );
  }
}

function PermisosTable({
  modulos,
  permisos,
  onChange,
}: {
  modulos: string[];
  permisos: PermisoModulo[];
  onChange: (
    modulo: string,
    flag: keyof Omit<PermisoModulo, "modulo">,
    value: boolean,
  ) => void;
}) {
  const byMod = useMemo(
    () => new Map(permisos.map((p) => [p.modulo, p])),
    [permisos],
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead className="bg-[var(--input)] text-[var(--muted)]">
          <tr>
            <th className="px-2 py-2">Módulo</th>
            {FLAGS.map(([, label]) => (
              <th key={label} className="px-2 py-2">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {modulos.map((m) => {
            const p = byMod.get(m) ?? {
              modulo: m,
              puedeVer: false,
              puedeCrear: false,
              puedeEditar: false,
              puedeEliminar: false,
            };
            return (
              <tr key={m} className="border-t border-[var(--border)]">
                <td className="px-2 py-1.5">{labelPermiso(m)}</td>
                {FLAGS.map(([flag]) => (
                  <td key={flag} className="px-2 py-1.5">
                    <input
                      type="checkbox"
                      checked={p[flag]}
                      onChange={(e) => onChange(m, flag, e.target.checked)}
                    />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
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
  const [abiertos, setAbiertos] = useState<Record<string, boolean>>({
    rrhh: true,
  });
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const catalogoRol = useMemo(
    () => (rol === "Admin" ? [] : catalogoPermisosRol(rol as RolGlobal)),
    [rol],
  );

  const gruposVisibles = useMemo(() => {
    const set = new Set(catalogoRol);
    return GRUPOS_PERMISOS.map((g) => ({
      ...g,
      modulos: g.modulos.filter((m) => set.has(m)),
    })).filter((g) => g.modulos.length > 0);
  }, [catalogoRol]);

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

  function abrirGrupoPrincipal(r: string) {
    if (r === "Admin") return;
    const principal = grupoPrincipalDelRol(r as RolGlobal);
    setAbiertos({ [principal]: true });
  }

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
    setAbiertos({ rrhh: true });
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
    setPermisos(
      mergePermisosConCatalogo(
        u.rol as RolGlobal,
        u.permisos?.length ? u.permisos : clonePermisos(u.rol),
      ),
    );
    abrirGrupoPrincipal(u.rol);
    setMsg("");
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function toggleEmpresa(id: number) {
    if (rol === "Marcaje") {
      setEmpresaIds((prev) => (prev.includes(id) ? [] : [id]));
      return;
    }
    setEmpresaIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function setPermisoFlag(
    modulo: string,
    flag: keyof Omit<PermisoModulo, "modulo">,
    value: boolean,
  ) {
    setPermisos((prev) => {
      const exists = prev.some((p) => p.modulo === modulo);
      if (!exists) {
        return [
          ...prev,
          {
            modulo,
            puedeVer: flag === "puedeVer" ? value : false,
            puedeCrear: flag === "puedeCrear" ? value : false,
            puedeEditar: flag === "puedeEditar" ? value : false,
            puedeEliminar: flag === "puedeEliminar" ? value : false,
          },
        ];
      }
      return prev.map((p) =>
        p.modulo === modulo ? { ...p, [flag]: value } : p,
      );
    });
  }

  function marcarGrupo(
    modulos: string[],
    value: boolean,
    soloVer = false,
  ) {
    setPermisos((prev) => {
      const map = new Map(prev.map((p) => [p.modulo, { ...p }]));
      for (const m of modulos) {
        map.set(m, {
          modulo: m,
          puedeVer: value,
          puedeCrear: soloVer ? false : value,
          puedeEditar: soloVer ? false : value,
          puedeEliminar: soloVer ? false : value,
        });
      }
      return [...map.values()];
    });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setMsg("");
    // Solo Admin puede ir sin empresas concretas si marca "todas".
    // Marcaje: una sola empresa (lugar del kiosco) — usa geocerca RRHH de ese lugar.
    if (rol === "Marcaje") {
      if (empresaIds.length !== 1) {
        setError(
          "Usuario Marcaje: elige exactamente una empresa (lugar). Usará la geocerca configurada por RRHH ahí.",
        );
        return;
      }
    }
    const todas =
      rol === "Admin" ? true : rol === "Marcaje" ? false : Boolean(accesoTodas);
    if (!todas && empresaIds.length === 0) {
      setError("Selecciona al menos una empresa, o marca acceso a todas.");
      return;
    }
    const payload = {
      username,
      password: password || undefined,
      nombre,
      rol,
      accesoTodas: todas,
      activo,
      empresaIds: todas ? [] : empresaIds,
      permisos:
        rol === "Admin"
          ? undefined
          : mergePermisosConCatalogo(rol as RolGlobal, permisos),
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
    "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-sm w-full";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Usuarios y permisos</h1>
        <p className="text-sm text-[var(--muted)]">
          Abre cada área (RRHH, Operaciones, Flota, Contabilidad) para marcar
          qué puede Ver / Crear / Editar / Eliminar. Contexto: {slug}
        </p>
        <a
          href={`/e/${slug}/admin/limpiar`}
          className="mt-2 inline-block text-xs text-amber-200 underline"
        >
          Limpiar datos por módulo (RRHH / Flota / Operaciones…) →
        </a>
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
            Rol / perfil
            <select
              className={`${input} mt-1`}
              value={rol}
              onChange={(e) => {
                const r = e.target.value;
                setRol(r);
                setPermisos(clonePermisos(r));
                abrirGrupoPrincipal(r);
                // Solo Admin implica acceso a todas; Marcaje = un solo lugar
                if (r === "Admin") setAccesoTodas(true);
                if (r === "Marcaje") {
                  setAccesoTodas(false);
                  setEmpresaIds((prev) =>
                    prev.length === 1 ? prev : prev.slice(0, 1),
                  );
                }
              }}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {labelRol(r)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {rol === "Marcaje" ? (
          <p className="rounded-lg border border-sky-800/40 bg-sky-950/30 px-3 py-2 text-xs text-sky-100">
            Kiosco de marcaje: solo registra entrada/salida en la empresa
            (lugar) que elijas. Usa latitud, longitud y radio que RRHH configure
            en Configuración de esa empresa.
          </p>
        ) : null}

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={rol === "Admin" ? true : accesoTodas}
            disabled={rol === "Admin" || rol === "Marcaje"}
            onChange={(e) => setAccesoTodas(e.target.checked)}
          />
          Acceso a todas las empresas
          {rol === "Admin" ? (
            <span className="text-xs text-[var(--muted)]">
              (Admin siempre tiene acceso a todas)
            </span>
          ) : null}
          {rol === "Marcaje" ? (
            <span className="text-xs text-[var(--muted)]">
              (Marcaje: una sola empresa / lugar)
            </span>
          ) : null}
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
          <p className="mb-1 text-sm text-[var(--muted)]">
            {rol === "Marcaje" ? "Lugar (empresa del kiosco)" : "Empresas"}
          </p>
          <div className="flex flex-wrap gap-2">
            {empresas.map((e) => (
              <label
                key={e.id}
                className="flex items-center gap-1 rounded border border-[var(--border)] px-2 py-1 text-sm"
              >
                <input
                  type={rol === "Marcaje" ? "radio" : "checkbox"}
                  name={rol === "Marcaje" ? "lugar-marcaje" : undefined}
                  checked={
                    rol === "Marcaje"
                      ? empresaIds.includes(e.id)
                      : empresaIds.includes(e.id) || accesoTodas
                  }
                  disabled={accesoTodas && rol !== "Marcaje"}
                  onChange={() => toggleEmpresa(e.id)}
                />
                {e.codigo}
              </label>
            ))}
          </div>
        </div>

        {rol !== "Admin" ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">
              Permisos por área — perfil {labelRol(rol)}
            </p>
            <p className="text-xs text-[var(--muted)]">
              Pulsa cada bloque para desglosar sus módulos. Puedes dar acceso
              cruzado (ej. Operaciones → Planillas) abriendo RRHH aunque el
              perfil sea otro.
            </p>

            {gruposVisibles.map((g) => {
              const open = Boolean(abiertos[g.id]);
              const activos = g.modulos.filter((m) => {
                const p = permisos.find((x) => x.modulo === m);
                return p && (p.puedeVer || p.puedeCrear || p.puedeEditar || p.puedeEliminar);
              }).length;
              return (
                <div
                  key={g.id}
                  className="overflow-hidden rounded-xl border border-[var(--border)]"
                >
                  <button
                    type="button"
                    onClick={() =>
                      setAbiertos((prev) => ({
                        ...prev,
                        [g.id]: !prev[g.id],
                      }))
                    }
                    className="flex w-full items-center gap-2 bg-[var(--thead)] px-3 py-2.5 text-left text-sm"
                  >
                    <IconChevron open={open} />
                    <span className="text-[var(--accent-2)]">
                      {iconGrupo(g.id)}
                    </span>
                    <span className="flex-1 font-medium">{g.titulo}</span>
                    <span className="text-[10px] text-[var(--muted)]">
                      {activos}/{g.modulos.length} activos
                    </span>
                  </button>
                  {open ? (
                    <div className="space-y-2 p-3">
                      <p className="text-xs text-[var(--muted)]">
                        {g.descripcion}
                      </p>
                      <div className="flex flex-wrap gap-2 text-xs">
                        <button
                          type="button"
                          className="rounded bg-[#1F6AA5] px-2 py-1 text-white"
                          onClick={() => marcarGrupo(g.modulos, true)}
                        >
                          Marcar todo
                        </button>
                        <button
                          type="button"
                          className="rounded bg-[#37474F] px-2 py-1 text-white"
                          onClick={() => marcarGrupo(g.modulos, true, true)}
                        >
                          Solo Ver
                        </button>
                        <button
                          type="button"
                          className="rounded bg-[#5C2525] px-2 py-1 text-white"
                          onClick={() => marcarGrupo(g.modulos, false)}
                        >
                          Quitar
                        </button>
                      </div>
                      <PermisosTable
                        modulos={g.modulos}
                        permisos={permisos}
                        onChange={setPermisoFlag}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
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
                <td className="px-3 py-2">{labelRol(u.rol)}</td>
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
