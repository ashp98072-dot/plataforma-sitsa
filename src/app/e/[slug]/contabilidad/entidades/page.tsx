"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";

type Entidad = { id: number; codigo: string; nombre: string; activa: number; puede_editar?: number };
const campo = "rounded border border-[var(--border)] bg-[var(--input)] px-3 py-2";
const boton = "rounded bg-[var(--accent)] px-3 py-2 text-sm disabled:opacity-50";

export default function EntidadesContablesPage() {
  const slug = String(useParams().slug);
  const [entidades, setEntidades] = useState<Entidad[]>([]);
  const [admin, setAdmin] = useState(false);
  const [disponible, setDisponible] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [codigo, setCodigo] = useState("");
  const [nombre, setNombre] = useState("");

  const cargar = useCallback((signal?: AbortSignal) => {
    return fetch(`/api/empresas/${slug}/contabilidad/entidades`, { cache: "no-store", signal }).then(async (res) => {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo cargar la configuración.");
      if (signal?.aborted) return;
      setError("");
      setEntidades(data.entidades);
      setAdmin(data.puedeAdministrar === true); setDisponible(true);
    }).catch((e: unknown) => {
      if (signal?.aborted) return;
      setDisponible(false); setAdmin(false); setEntidades([]);
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
    <h1 className="text-2xl font-semibold">Libros contables de esta empresa</h1>
    <p className="rounded border border-[var(--border)] p-3 text-sm">
      Crear entidades no mueve cuentas, partidas ni saldos antiguos.
      Los permisos se administran únicamente en Administración → Usuarios y aplican a los libros de esta empresa.
      La importación de Milenium sigue pendiente de homologación y conciliación.
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
    </>}
    {disponible && <section className="space-y-3">
      <h2 className="font-semibold">Libros de esta empresa</h2>
      {!entidades.length && <p>No hay entidades disponibles.</p>}
      {entidades.map((e) => <article key={e.id} className="space-y-2 rounded border border-[var(--border)] p-4">
        <h3>{e.codigo} — {e.nombre} · {Number(e.activa) === 1 ? "Activa" : "Inactiva"}</h3>
        {admin && <>
          <button type="button" className={boton} disabled={ocupado} onClick={() => {
            if (confirm(`${Number(e.activa) === 1 ? "Desactivar" : "Reactivar"} ${e.codigo}? No se eliminarán datos.`)) void guardar({ accion: "estado", entidadId: e.id, activa: Number(e.activa) !== 1 });
          }}>{Number(e.activa) === 1 ? "Desactivar" : "Reactivar"}</button>
        </>}
      </article>)}
    </section>}
  </div>;
}
