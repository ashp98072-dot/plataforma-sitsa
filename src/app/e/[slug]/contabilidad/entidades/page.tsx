"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";

type Entidad = { id: number; codigo: string; nombre: string; activa: number; puede_editar?: number };
type Usuario = { id: number; username: string; nombre: string | null };
type Asignacion = { entidad_id: number; usuario_id: number; username: string; puede_editar: number };
const campo = "rounded border border-[var(--border)] bg-[var(--input)] px-3 py-2";
const boton = "rounded bg-[var(--accent)] px-3 py-2 text-sm disabled:opacity-50";

export default function EntidadesContablesPage() {
  const slug = String(useParams().slug);
  const [entidades, setEntidades] = useState<Entidad[]>([]);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [asignaciones, setAsignaciones] = useState<Asignacion[]>([]);
  const [admin, setAdmin] = useState(false);
  const [disponible, setDisponible] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [codigo, setCodigo] = useState("");
  const [nombre, setNombre] = useState("");
  const [entidadId, setEntidadId] = useState("");
  const [usuarioId, setUsuarioId] = useState("");
  const [acceso, setAcceso] = useState("ver");

  const cargar = useCallback((signal?: AbortSignal) => {
    return fetch(`/api/empresas/${slug}/contabilidad/entidades`, { cache: "no-store", signal }).then(async (res) => {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo cargar la configuración.");
      if (signal?.aborted) return;
      setError("");
      setEntidades(data.entidades); setUsuarios(data.usuarios); setAsignaciones(data.asignaciones);
      setAdmin(data.puedeAdministrar === true); setDisponible(true);
    }).catch((e: unknown) => {
      if (signal?.aborted) return;
      setDisponible(false); setAdmin(false); setEntidades([]); setUsuarios([]); setAsignaciones([]);
      setError(e instanceof Error ? e.message : "Error de conexión.");
    });
  }, [slug]);
  useEffect(() => {
    const controller = new AbortController();
    void cargar(controller.signal);
    return () => controller.abort();
  }, [cargar]);

  async function guardar(payload: Record<string, unknown>) {
    if (ocupado || !admin || !disponible) return false;
    setOcupado(true); setError(""); setMensaje("");
    try {
      const res = await fetch(`/api/empresas/${slug}/contabilidad/entidades`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo guardar.");
      setMensaje(data.mensaje); await cargar(); return true;
    } catch (e) { setError(e instanceof Error ? e.message : "Error de conexión."); return false; }
    finally { setOcupado(false); }
  }
  async function crear(e: FormEvent) {
    e.preventDefault();
    if (await guardar({ accion: "crear", codigo, nombre })) { setCodigo(""); setNombre(""); }
  }

  return <div className="space-y-5 p-4">
    <Link href={`/e/${slug}/contabilidad`} className="text-sm underline">← Volver a Contabilidad</Link>
    <h1 className="text-2xl font-semibold">Entidades contables</h1>
    <p className="rounded border border-[var(--border)] p-3 text-sm">
      Preparación de la separación KT/Mónaco. Crear entidades no mueve cuentas, partidas ni saldos.
      Las pantallas contables existentes siguen trabajando por empresa operativa; los accesos definidos aquí solo afectan este catálogo por ahora.
      No importar movimientos de ambas razones sociales hasta completar la siguiente fase.
    </p>
    <button type="button" className={boton} disabled={ocupado} onClick={() => void cargar()}>Actualizar</button>
    {error && <p role="alert" className="text-red-500">{error}</p>}
    {mensaje && <p role="status">{mensaje}</p>}
    {admin && disponible && <>
      <form onSubmit={crear} className="flex flex-wrap gap-3 rounded border border-[var(--border)] p-4">
        <h2 className="w-full font-semibold">Nueva entidad — solo Admin</h2>
        <label>Código <input className={campo} value={codigo} onChange={(e) => setCodigo(e.target.value)} maxLength={40} pattern="[A-Za-z0-9_-]+" placeholder="KT o MONACO" required /></label>
        <label>Razón social / nombre <input className={campo} value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={200} required /></label>
        <button className={boton} disabled={ocupado}>Crear entidad</button>
      </form>
      <form onSubmit={(e) => { e.preventDefault(); void guardar({ accion: "acceso", entidadId: Number(entidadId), usuarioId: Number(usuarioId), acceso }); }} className="flex flex-wrap gap-3 rounded border border-[var(--border)] p-4">
        <h2 className="w-full font-semibold">Asignar acceso</h2>
        <p className="w-full text-sm">El usuario también necesita acceso a esta empresa y permiso de Contabilidad. Esta asignación no concede esos permisos.</p>
        <label>Entidad <select className={campo} required value={entidadId} onChange={(e) => setEntidadId(e.target.value)}>
          <option value="">Seleccionar</option>{entidades.filter((e) => Number(e.activa) === 1).map((e) => <option key={e.id} value={e.id}>{e.codigo} — {e.nombre}</option>)}
        </select></label>
        <label>Usuario <select className={campo} required value={usuarioId} onChange={(e) => setUsuarioId(e.target.value)}>
          <option value="">Seleccionar</option>{usuarios.map((u) => <option key={u.id} value={u.id}>{u.nombre ?? u.username} ({u.username})</option>)}
        </select></label>
        <label>Acceso <select className={campo} value={acceso} onChange={(e) => setAcceso(e.target.value)}><option value="ver">Consulta</option><option value="editar">Consulta y edición (preparado para siguiente fase)</option></select></label>
        <button className={boton} disabled={ocupado}>Guardar acceso</button>
      </form>
    </>}
    {disponible && <section className="space-y-3">
      <h2 className="font-semibold">{admin ? "Entidades de esta empresa" : "Mis entidades asignadas"}</h2>
      {!entidades.length && <p>No hay entidades disponibles.</p>}
      {entidades.map((e) => <article key={e.id} className="space-y-2 rounded border border-[var(--border)] p-4">
        <h3>{e.codigo} — {e.nombre} · {Number(e.activa) === 1 ? "Activa" : "Inactiva"}</h3>
        {admin && <>
          <button type="button" className={boton} disabled={ocupado} onClick={() => {
            if (confirm(`${Number(e.activa) === 1 ? "Desactivar" : "Reactivar"} ${e.codigo}? No se eliminarán datos. Al reactivar se conservan los accesos asignados.`)) void guardar({ accion: "estado", entidadId: e.id, activa: Number(e.activa) !== 1 });
          }}>{Number(e.activa) === 1 ? "Desactivar" : "Reactivar"}</button>
          <ul>{asignaciones.filter((a) => a.entidad_id === e.id).map((a) => <li key={a.usuario_id} className="flex flex-wrap items-center gap-2 py-1">
            {a.username} · {Number(a.puede_editar) === 1 ? "Consulta y edición" : "Consulta"}
            <button type="button" className="text-red-500 underline disabled:opacity-50" disabled={ocupado} onClick={() => {
              if (confirm(`¿Revocar el acceso de ${a.username} a ${e.codigo}?`)) void guardar({ accion: "acceso", entidadId: e.id, usuarioId: a.usuario_id, acceso: "revocar" });
            }}>Revocar</button>
          </li>)}</ul>
        </>}
      </article>)}
    </section>}
  </div>;
}
