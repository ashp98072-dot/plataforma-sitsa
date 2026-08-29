"use client";

import { useCallback, useEffect, useState, useRef, type FormEvent } from "react";
import { useParams } from "next/navigation";

type Entidad = { id: number; codigo: string; nombre: string; activa: number; puede_editar?: number };
async function respuesta(res: Response) {
  const data = await res.json().catch(() => ({ error: "Respuesta inválida del servidor." }));
  if (!res.ok) throw new Error(data.error || "No se pudo completar la operación.");
  return data;
}
export default function ContabilidadPage() {
  const slug = String(useParams().slug);
  return <SeleccionContable key={slug} slug={slug} />;
}
function SeleccionContable({ slug }: { slug: string }) {
  const [entidades, setEntidades] = useState<Entidad[]>([]);
  const [seleccion, setSeleccion] = useState("");
  const [admin, setAdmin] = useState(false);
  const [escritura, setEscritura] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/empresas/${slug}/contabilidad/entidades`, { cache: "no-store", signal: controller.signal })
      .then(respuesta).then((data) => {
        if (controller.signal.aborted) return;
        setEntidades(data.entidades.filter((e: Entidad) => Number(e.activa) === 1));
        setAdmin(data.puedeAdministrar === true);
        setEscritura(data.puedeEscribir === true);
      }).catch((e) => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [slug]);
  const entidad = entidades.find((e) => String(e.id) === seleccion);
  return <div className="space-y-4">
    <h1 className="text-2xl font-semibold">Contabilidad por entidad</h1>
    <p>Selecciona la razón social. Los clientes y la operación compartida no se modifican.</p>
    <label>Entidad contable <select aria-label="Entidad contable" value={seleccion} onChange={(e) => setSeleccion(e.target.value)} className="rounded border border-[var(--border)] bg-[var(--input)] p-2">
      <option value="">Seleccionar KT / Mónaco</option>
      {entidades.map((e) => <option key={e.id} value={e.id}>{e.codigo} — {e.nombre}</option>)}
    </select></label>
    <p className="text-sm">Si no hay entidades, Admin debe crearlas y asignar accesos desde Configurar entidades contables. Los registros antiguos sin entidad no aparecen en estos libros; no se han movido ni eliminado.</p>
    {admin && <a className="text-sm underline" href={`/e/${slug}/contabilidad/entidades`}>Configurar entidades contables</a>}
    {error && <p role="alert" className="text-red-500">{error}</p>}
    {entidad && <LibroContable key={entidad.id} slug={slug} entidadId={entidad.id} puedeEditar={escritura && (admin || Number(entidad.puede_editar) === 1)} />}
  </div>;
}
function LibroContable({ slug, entidadId, puedeEditar }: { slug: string; entidadId: number; puedeEditar: boolean }) {
  const base = `/api/empresas/${slug}/contabilidad`;
  const api = useCallback((tipo: string) => `${base}/${tipo}?entidad=${entidadId}`, [base, entidadId]);
  const vivo = useRef(true);
  const enviando = useRef(false);
  const [ocupado, setOcupado] = useState(false);
  const [cuentas, setCuentas] = useState<Record<string, unknown>[]>([]);
  const [asientos, setAsientos] = useState<Record<string, unknown>[]>([]);
  const [cxc, setCxc] = useState<Record<string, unknown>[]>([]);
  const [cxp, setCxp] = useState<Record<string, unknown>[]>([]);
  const [codigo, setCodigo] = useState("");
  const [nombre, setNombre] = useState("");
  const [tipo, setTipo] = useState("Activo");
  const [cliente, setCliente] = useState("");
  const [proveedor, setProveedor] = useState("");
  const [monto, setMonto] = useState(0);
  const [msg, setMsg] = useState("");

  const cargar = useCallback((signal?: AbortSignal) => Promise.all(
    ["cuentas", "asientos", "cxc", "cxp"].map((tipo) => fetch(api(tipo), { cache: "no-store", signal }).then(respuesta)),
  ), [api]);
  const mostrar = useCallback((datos: Awaited<ReturnType<typeof cargar>>) => {
    if (!vivo.current) return;
    const [c, a, cx, cp] = datos;
    setCuentas(c.cuentas); setAsientos(a.asientos); setCxc(cx.cxc); setCxp(cp.cxp);
  }, []);
  const fallo = useCallback((e: unknown) => {
    if (!vivo.current) return;
    setCuentas([]); setAsientos([]); setCxc([]); setCxp([]);
    setMsg(e instanceof Error ? e.message : "Error de conexión.");
  }, []);
  useEffect(() => {
    vivo.current = true;
    const controller = new AbortController();
    cargar(controller.signal).then((datos) => {
      if (!controller.signal.aborted) mostrar(datos);
    }).catch((e) => { if (!controller.signal.aborted) fallo(e); });
    return () => { vivo.current = false; controller.abort(); };
  }, [cargar, mostrar, fallo]);

  async function guardar(tipoRegistro: string, body: Record<string, unknown>) {
    if (!puedeEditar || enviando.current) return false;
    enviando.current = true; setOcupado(true); setMsg("");
    try {
      const data = await fetch(api(tipoRegistro), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(respuesta);
      if (!vivo.current) return false;
      setMsg(data.mensaje); await cargar().then(mostrar).catch(fallo); return true;
    } catch (e) { if (vivo.current) setMsg(e instanceof Error ? e.message : "Error de conexión."); return false; }
    finally { enviando.current = false; if (vivo.current) setOcupado(false); }
  }
  async function crearCuenta(e: FormEvent) {
    e.preventDefault();
    if (await guardar("cuentas", { codigo, nombre, tipo })) { setCodigo(""); setNombre(""); }
  }
  async function asientoDemo() {
    const activas = cuentas.filter((c) => Number(c.activa) === 1);
    if (activas.length < 2) { setMsg("Crea al menos 2 cuentas activas para un asiento demo."); return; }
    if (!confirm("Esto registra una partida de prueba de Q100 en la entidad seleccionada. ¿Continuar?")) return;
    await guardar("asientos", { numero: `A-${Date.now()}`, fecha: new Date().toLocaleDateString("en-CA", { timeZone: "America/Guatemala" }), glosa: "Asiento de prueba",
      lineas: [{ cuentaId: Number(activas[0].id), debe: 100, haber: 0 }, { cuentaId: Number(activas[1].id), debe: 0, haber: 100 }] });
  }
  async function crearCxc() {
    if (await guardar("cxc", { cliente, fecha: new Date().toLocaleDateString("en-CA", { timeZone: "America/Guatemala" }), monto })) setCliente("");
  }
  async function crearCxp() {
    if (await guardar("cxp", { proveedor, fecha: new Date().toLocaleDateString("en-CA", { timeZone: "America/Guatemala" }), monto })) setProveedor("");
  }

  return (
    <fieldset disabled={!puedeEditar || ocupado} className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Contabilidad</h1>
        <p className="text-sm text-[var(--muted)]">
          Plan de cuentas, asientos y CxC/CxP de la entidad seleccionada.
          La captura completa y la importación desde Milenium corresponden a las siguientes fases.
        </p>
      </div>

      <form onSubmit={crearCuenta} className="flex flex-wrap gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <input className="rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1" placeholder="Código" value={codigo} onChange={(e) => setCodigo(e.target.value)} required />
        <input className="rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1" placeholder="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} required />
        <select className="rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1" value={tipo} onChange={(e) => setTipo(e.target.value)}>
          {["Activo", "Pasivo", "Capital", "Ingreso", "Gasto"].map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <button className="rounded bg-[var(--accent)] px-3 py-1 text-sm">Crear cuenta</button>
        <button type="button" onClick={() => void asientoDemo()} className="rounded bg-[#6A1B9A] px-3 py-1 text-sm">
          Asiento demo
        </button>
      </form>

      <div className="flex flex-wrap gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <input className="rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1" placeholder="Cliente CxC" value={cliente} onChange={(e) => setCliente(e.target.value)} />
        <input className="rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1" placeholder="Proveedor CxP" value={proveedor} onChange={(e) => setProveedor(e.target.value)} />
        <input type="number" className="w-28 rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1" value={monto} onChange={(e) => setMonto(Number(e.target.value))} />
        <button type="button" onClick={() => void crearCxc()} className="rounded bg-[var(--accent-2)] px-3 py-1 text-sm">CxC</button>
        <button type="button" onClick={() => void crearCxp()} className="rounded bg-[#0f766e] px-3 py-1 text-sm">CxP</button>
      </div>

      {!puedeEditar && <p>Acceso de solo lectura.</p>}
      {msg ? <p role="status" className="text-sm">{msg}</p> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-[var(--border)] p-4">
          <h2 className="font-medium">Cuentas</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {cuentas.map((c) => (
              <li key={String(c.id)}>
                {String(c.codigo)} — {String(c.nombre)} ({String(c.tipo)})
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-[var(--border)] p-4">
          <h2 className="font-medium">Asientos recientes</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {asientos.map((a) => (
              <li key={String(a.id)}>
                {String(a.numero)} · {String(a.fecha).slice(0, 10)} · {String(a.glosa ?? "")}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-[var(--border)] p-4">
          <h2 className="font-medium">CxC ({cxc.length})</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {cxc.map((r) => (
              <li key={String(r.id)}>
                {String(r.cliente)} · Q{Number(r.saldo).toFixed(2)} · {String(r.estado)}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-[var(--border)] p-4">
          <h2 className="font-medium">CxP ({cxp.length})</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {cxp.map((r) => (
              <li key={String(r.id)}>
                {String(r.proveedor)} · Q{Number(r.saldo).toFixed(2)} · {String(r.estado)}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </fieldset>
  );
}
