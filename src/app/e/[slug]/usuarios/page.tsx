"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";

type Empresa = { id: number; nombre: string; codigo: string };
type Usuario = {
  id: number;
  username: string;
  nombre: string | null;
  rol: string;
  activo: boolean;
  accesoTodas: boolean;
  empresas: number[];
};

const ROLES = [
  "Admin",
  "RRHH",
  "Contabilidad",
  "Operaciones",
  "CoordinadorPredios",
  "Visualizador",
];

export default function UsuariosPage() {
  const slug = String(useParams().slug);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [nombre, setNombre] = useState("");
  const [rol, setRol] = useState("Operaciones");
  const [accesoTodas, setAccesoTodas] = useState(false);
  const [empresaIds, setEmpresaIds] = useState<number[]>([]);
  const [msg, setMsg] = useState("");

  const cargar = useCallback(async () => {
    const [u, me] = await Promise.all([
      fetch("/api/usuarios").then((r) => r.json()),
      fetch("/api/auth/me").then((r) => r.json()),
    ]);
    if (u.usuarios) setUsuarios(u.usuarios);
    if (me.empresas) setEmpresas(me.empresas);
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  function toggleEmpresa(id: number) {
    setEmpresaIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/usuarios", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
        password,
        nombre,
        rol,
        accesoTodas: accesoTodas || rol === "RRHH" || rol === "Contabilidad" || rol === "Admin",
        empresaIds,
      }),
    });
    const data = await res.json();
    setMsg(data.mensaje || data.error);
    if (res.ok) {
      setUsername("");
      setPassword("");
      setNombre("");
      await cargar();
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Usuarios y empresas</h1>
        <p className="text-sm text-[var(--muted)]">
          Como SKAS: asigna empresas al usuario. RRHH/Contabilidad/Admin pueden
          elegir cualquiera de las 5. Contexto actual: {slug}
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="grid gap-2 md:grid-cols-2">
          <input className="rounded border border-[var(--border)] bg-[#0b1217] px-2 py-1" placeholder="Usuario" value={username} onChange={(e) => setUsername(e.target.value)} required />
          <input type="password" className="rounded border border-[var(--border)] bg-[#0b1217] px-2 py-1" placeholder="Contraseña" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <input className="rounded border border-[var(--border)] bg-[#0b1217] px-2 py-1" placeholder="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} />
          <select className="rounded border border-[var(--border)] bg-[#0b1217] px-2 py-1" value={rol} onChange={(e) => setRol(e.target.value)}>
            {ROLES.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={accesoTodas} onChange={(e) => setAccesoTodas(e.target.checked)} />
          Acceso a todas las empresas (RRHH / Contabilidad / Admin)
        </label>
        <div>
          <p className="mb-1 text-sm text-[var(--muted)]">Empresas por usuario</p>
          <div className="flex flex-wrap gap-2">
            {empresas.map((e) => (
              <label key={e.id} className="flex items-center gap-1 rounded border border-[var(--border)] px-2 py-1 text-sm">
                <input
                  type="checkbox"
                  checked={empresaIds.includes(e.id)}
                  onChange={() => toggleEmpresa(e.id)}
                />
                {e.codigo}
              </label>
            ))}
          </div>
        </div>
        <button className="rounded bg-[var(--accent)] px-3 py-1 text-sm text-white">Crear usuario</button>
      </form>
      {msg ? <p className="text-sm text-emerald-300">{msg}</p> : null}

      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-[#334155] text-white">
            <tr>
              <th className="px-3 py-2">Usuario</th>
              <th className="px-3 py-2">Rol</th>
              <th className="px-3 py-2">Todas</th>
              <th className="px-3 py-2">Empresas IDs</th>
              <th className="px-3 py-2">Activo</th>
            </tr>
          </thead>
          <tbody>
            {usuarios.map((u) => (
              <tr key={u.id} className="border-t border-[var(--border)]">
                <td className="px-3 py-2">{u.username}</td>
                <td className="px-3 py-2">{u.rol}</td>
                <td className="px-3 py-2">{u.accesoTodas ? "Sí" : "No"}</td>
                <td className="px-3 py-2">{u.empresas.join(", ") || "—"}</td>
                <td className="px-3 py-2">{u.activo ? "Sí" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
