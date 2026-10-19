"use client";

import { useEffect, useState } from "react";

type Entidad = { id: number; codigo: string; nombre: string; activa: number };
type Documento = {
  facturaId: number; clienteId: number; cliente: string; numeroFactura: string | null; fechaEmision: string | null; estadoAdmin: "Emitida" | "Anulada";
  estadoFinanciero: "SIN_PAGOS" | "PARCIAL" | "PAGADA" | "ANULADA"; montoOriginal: string; totalPagado: string; saldoInformativo: string | null; cantidadPagos: number;
};
type Totales = { cantidad: number; montoOriginal: string; totalPagado: string; saldoInformativo: string };
type Cobro = { id: number; facturaId: number; numeroFactura: string | null; cliente: string; fechaPago: string; monto: string; medioPago: string | null; referencia: string | null; observaciones: string | null };
type Legado = { id: number; cliente: string; documento: string | null; fecha: string; vencimiento: string | null; monto: string; saldo: string; estado: string };

const campo = "rounded border border-[var(--border)] bg-[var(--input)] p-2 text-sm";
const boton = "rounded border border-[var(--border)] px-3 py-1 text-sm hover:bg-[var(--input)] disabled:opacity-50";
const q = (n: string) => `Q${Number(n).toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const SITUACION: Record<Documento["estadoFinanciero"], string> = { SIN_PAGOS: "Sin cobros", PARCIAL: "Cobro parcial", PAGADA: "Cobrada", ANULADA: "Anulada" };
const hoy = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Guatemala" });
async function api(url: string, init?: RequestInit) {
  const res = await fetch(url, { cache: "no-store", ...init });
  const data = await res.json().catch(() => ({ error: "Respuesta inválida del servidor." }));
  if (!res.ok) throw new Error(data.error || "No se pudo completar la operación.");
  return data;
}

export function CxcClient({ slug, puedeVer, puedeCobrar }: { slug: string; puedeVer: boolean; puedeCobrar: boolean }) {
  const [entidades, setEntidades] = useState<Entidad[]>([]);
  const [entidadId, setEntidadId] = useState("");
  const [vista, setVista] = useState<"documentos" | "cobros" | "legado">("documentos");
  const [error, setError] = useState("");
  useEffect(() => {
    const ac = new AbortController();
    fetch(`/api/empresas/${slug}/contabilidad/entidades`, { cache: "no-store", signal: ac.signal })
      .then(async r => ({ ok: r.ok, d: await r.json() }))
      .then(({ ok, d }) => {
        if (ac.signal.aborted) return;
        if (!ok) return setError(d.error ?? "No se pudieron cargar las entidades.");
        const activas = (d.entidades as Entidad[]).filter(e => Number(e.activa) === 1);
        setEntidades(activas);
        if (activas.length === 1) setEntidadId(String(activas[0].id));
      }).catch(() => { if (!ac.signal.aborted) setError("No se pudieron cargar las entidades."); });
    return () => ac.abort();
  }, [slug]);
  return <div className="space-y-4">
    <h1 className="text-2xl font-semibold">Cuentas por cobrar</h1>
    <p className="text-sm text-[var(--muted)]">Facturas emitidas a clientes y sus cobros, tal como se registran en Facturación. Saldo informativo = total de la factura − cobros registrados; no es la cartera legal de Milenium y no genera pólizas. Los registros manuales anteriores se consultan aparte, sin mezclarse con estos saldos.</p>
    <label className="block text-sm">Libro contable (entidad)
      <select className={`${campo} ml-2`} value={entidadId} onChange={e => setEntidadId(e.target.value)} aria-label="Entidad">
        <option value="">Seleccionar entidad</option>{entidades.map(e => <option key={e.id} value={e.id}>{e.codigo} — {e.nombre}</option>)}
      </select></label>
    {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
    {entidadId && puedeVer && <>
      <div className="flex gap-2">
        <button type="button" className={boton} aria-pressed={vista === "documentos"} onClick={() => setVista("documentos")}>Documentos</button>
        <button type="button" className={boton} aria-pressed={vista === "cobros"} onClick={() => setVista("cobros")}>Cobros</button>
        <button type="button" className={boton} aria-pressed={vista === "legado"} onClick={() => setVista("legado")}>Registros manuales (legado)</button>
      </div>
      {vista === "documentos" && <Documentos key={`d${entidadId}`} slug={slug} entidadId={entidadId} puedeCobrar={puedeCobrar} />}
      {vista === "cobros" && <Cobros key={`c${entidadId}`} slug={slug} entidadId={entidadId} />}
      {vista === "legado" && <LegadoManual key={`l${entidadId}`} slug={slug} entidadId={entidadId} />}
    </>}
    {!puedeVer && <p>Sin permiso para ver Cuentas por cobrar.</p>}
  </div>;
}

function Documentos({ slug, entidadId, puedeCobrar }: { slug: string; entidadId: string; puedeCobrar: boolean }) {
  const base = `/api/empresas/${slug}/contabilidad/cxc`;
  const [version, setVersion] = useState(0);
  const [f, setF] = useState({ alcance: "abiertas", textoCliente: "", numeroFactura: "", fechaDesde: "", fechaHasta: "" });
  const [page, setPage] = useState(1);
  const [lista, setLista] = useState<{ filas: Documento[]; totalReal: number; pageSize: number; porEntidad: Totales[] } | null>(null);
  const [msg, setMsg] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [cobrando, setCobrando] = useState<number | null>(null);
  const [c, setC] = useState({ fechaPago: hoy(), monto: "", medioPago: "", referencia: "", observaciones: "" });

  useEffect(() => {
    const ac = new AbortController();
    const sp = new URLSearchParams({ entidad: entidadId, alcance: f.alcance, page: String(page) });
    for (const k of ["textoCliente", "numeroFactura", "fechaDesde", "fechaHasta"] as const) if (f[k]) sp.set(k, f[k]);
    fetch(`${base}/documentos?${sp}`, { cache: "no-store", signal: ac.signal }).then(async r => ({ ok: r.ok, d: await r.json() }))
      .then(({ ok, d }) => { if (ac.signal.aborted) return; if (ok) { setLista(d); setError(""); } else setError(d.error ?? "No se pudo cargar."); })
      .catch(() => { if (!ac.signal.aborted) setError("No se pudieron cargar los documentos."); });
    return () => ac.abort();
  }, [base, entidadId, f, page, version]);

  const cambiar = (k: keyof typeof f) => (e: { target: { value: string } }) => { setF({ ...f, [k]: e.target.value }); setPage(1); };
  async function cobrar(facturaId: number) {
    setBusy(true); setError(""); setMsg("");
    try {
      await api(`${base}/cobros?entidad=${entidadId}`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ facturaId, fechaPago: c.fechaPago, monto: Number(c.monto.replace(",", ".")), medioPago: c.medioPago || null, referencia: c.referencia || null, observaciones: c.observaciones || null }) });
      setMsg("Cobro registrado."); setCobrando(null); setC({ fechaPago: hoy(), monto: "", medioPago: "", referencia: "", observaciones: "" }); setVersion(v => v + 1);
    } catch (e) { setError(e instanceof Error ? e.message : "Error"); setVersion(v => v + 1); } finally { setBusy(false); }
  }
  const tot = lista?.porEntidad[0];
  const paginas = lista ? Math.max(1, Math.ceil(lista.totalReal / lista.pageSize)) : 1;

  return <section className="space-y-4">
    {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
    {msg && <p role="status" className="text-sm text-emerald-400">{msg}</p>}
    <div className="flex flex-wrap gap-2">
      <select className={campo} aria-label="Situación" value={f.alcance} onChange={cambiar("alcance")}>
        <option value="abiertas">Con saldo pendiente</option><option value="todas">Todas</option><option value="pagadas">Cobradas</option><option value="anuladas">Anuladas</option></select>
      <input className={campo} placeholder="Buscar cliente" value={f.textoCliente} onChange={cambiar("textoCliente")} />
      <input className={campo} placeholder="Buscar factura / documento" value={f.numeroFactura} onChange={cambiar("numeroFactura")} />
      <label className="text-xs">Desde<input type="date" className={`${campo} block`} value={f.fechaDesde} onChange={cambiar("fechaDesde")} /></label>
      <label className="text-xs">Hasta<input type="date" className={`${campo} block`} value={f.fechaHasta} onChange={cambiar("fechaHasta")} /></label>
    </div>
    {tot && <dl className="grid max-w-xl grid-cols-2 gap-x-4 text-sm sm:grid-cols-4" aria-label="Totales del filtro">
      <div><dt className="text-xs text-[var(--muted)]">Facturado</dt><dd>{q(tot.montoOriginal)}</dd></div>
      <div><dt className="text-xs text-[var(--muted)]">Cobrado</dt><dd>{q(tot.totalPagado)}</dd></div>
      <div><dt className="text-xs text-[var(--muted)]">Saldo</dt><dd className="font-semibold">{q(tot.saldoInformativo)}</dd></div>
      <div><dt className="text-xs text-[var(--muted)]">Documentos</dt><dd>{tot.cantidad}</dd></div>
    </dl>}
    <div className="overflow-auto"><table className="w-full text-sm"><thead><tr>{["Fecha", "Cliente", "Documento", "Total", "Cobrado", "Saldo", "Situación", ""].map(t => <th key={t} className="p-2 text-left">{t}</th>)}</tr></thead>
      <tbody>{lista?.filas.map(x => <tr key={x.facturaId} className="border-t border-[var(--border)] align-top">
        <td className="p-2">{x.fechaEmision ?? "—"}</td><td>{x.cliente}</td><td>{x.numeroFactura ?? `#${x.facturaId}`}</td><td>{q(x.montoOriginal)}</td><td>{q(x.totalPagado)}</td>
        <td className="font-medium">{x.saldoInformativo == null ? "—" : q(x.saldoInformativo)}</td><td>{SITUACION[x.estadoFinanciero]}</td>
        <td>{puedeCobrar && x.estadoAdmin === "Emitida" && Number(x.saldoInformativo) > 0 && (cobrando === x.facturaId
          ? <div className="flex max-w-xs flex-col gap-1">
            <input type="date" className={campo} aria-label="Fecha del cobro" value={c.fechaPago} onChange={e => setC({ ...c, fechaPago: e.target.value })} />
            <span className="flex gap-1"><input className={`${campo} w-28`} inputMode="decimal" aria-label="Monto del cobro" placeholder="0.00" value={c.monto} onChange={e => setC({ ...c, monto: e.target.value })} />
              <button type="button" className={boton} onClick={() => setC({ ...c, monto: x.saldoInformativo ?? "" })}>Cobrar saldo</button></span>
            <input className={campo} placeholder="Medio (transferencia, cheque…)" value={c.medioPago} onChange={e => setC({ ...c, medioPago: e.target.value })} />
            <input className={campo} placeholder="Referencia" value={c.referencia} onChange={e => setC({ ...c, referencia: e.target.value })} />
            <input className={campo} placeholder="Observaciones" value={c.observaciones} onChange={e => setC({ ...c, observaciones: e.target.value })} />
            <span className="flex gap-1"><button type="button" className={boton} disabled={busy || !(Number(c.monto.replace(",", ".")) > 0) || !c.fechaPago} onClick={() => cobrar(x.facturaId)}>Registrar cobro</button>
              <button type="button" className={boton} onClick={() => setCobrando(null)}>Cancelar</button></span></div>
          : <button type="button" className={boton} onClick={() => { setCobrando(x.facturaId); setMsg(""); setError(""); }}>Cobrar</button>)}</td>
      </tr>)}</tbody></table></div>
    {lista && lista.filas.length === 0 && <p className="text-sm">No hay documentos para este filtro en el libro seleccionado.</p>}
    <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
      <button type="button" className={boton} disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</button>
      <span>{lista ? `${lista.totalReal} documentos · página ${page} de ${paginas}` : "Cargando…"}</span>
      <button type="button" className={boton} disabled={page >= paginas} onClick={() => setPage(page + 1)}>Siguiente</button>
    </div>
    <p className="text-xs text-[var(--muted)]">Saldo informativo — documentos registrados en plataforma. No es la cartera legal de Milenium. Un cobro no puede exceder el saldo pendiente. Los cobros registrados no se reversan desde esta pantalla (no existe esa función).</p>
  </section>;
}

function Cobros({ slug, entidadId }: { slug: string; entidadId: string }) {
  const base = `/api/empresas/${slug}/contabilidad/cxc`;
  const [f, setF] = useState({ textoCliente: "", numeroFactura: "", fechaDesde: "", fechaHasta: "" });
  const [page, setPage] = useState(1);
  const [lista, setLista] = useState<{ cobros: Cobro[]; totalReal: number; totalCobrado: string; pageSize: number } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const ac = new AbortController();
    const sp = new URLSearchParams({ entidad: entidadId, page: String(page) });
    for (const k of Object.keys(f) as (keyof typeof f)[]) if (f[k]) sp.set(k, f[k]);
    fetch(`${base}/cobros?${sp}`, { cache: "no-store", signal: ac.signal }).then(async r => ({ ok: r.ok, d: await r.json() }))
      .then(({ ok, d }) => { if (ac.signal.aborted) return; if (ok) { setLista(d); setError(""); } else setError(d.error ?? "No se pudo cargar."); })
      .catch(() => { if (!ac.signal.aborted) setError("No se pudieron cargar los cobros."); });
    return () => ac.abort();
  }, [base, entidadId, f, page]);
  const cambiar = (k: keyof typeof f) => (e: { target: { value: string } }) => { setF({ ...f, [k]: e.target.value }); setPage(1); };
  const paginas = lista ? Math.max(1, Math.ceil(lista.totalReal / lista.pageSize)) : 1;
  return <section className="space-y-4">
    {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
    <div className="flex flex-wrap gap-2">
      <input className={campo} placeholder="Buscar cliente" value={f.textoCliente} onChange={cambiar("textoCliente")} />
      <input className={campo} placeholder="Buscar factura / documento" value={f.numeroFactura} onChange={cambiar("numeroFactura")} />
      <label className="text-xs">Desde<input type="date" className={`${campo} block`} value={f.fechaDesde} onChange={cambiar("fechaDesde")} /></label>
      <label className="text-xs">Hasta<input type="date" className={`${campo} block`} value={f.fechaHasta} onChange={cambiar("fechaHasta")} /></label>
    </div>
    {lista && <p className="text-sm">Total cobrado en este filtro: <strong>{q(lista.totalCobrado)}</strong></p>}
    <div className="overflow-auto"><table className="w-full text-sm"><thead><tr>{["Fecha", "Cliente", "Documento", "Monto cobrado", "Medio", "Referencia", "Observaciones"].map(t => <th key={t} className="p-2 text-left">{t}</th>)}</tr></thead>
      <tbody>{lista?.cobros.map(x => <tr key={x.id} className="border-t border-[var(--border)]">
        <td className="p-2">{x.fechaPago}</td><td>{x.cliente}</td><td>{x.numeroFactura ?? `#${x.facturaId}`}</td><td>{q(x.monto)}</td><td>{x.medioPago ?? "—"}</td><td>{x.referencia ?? "—"}</td><td>{x.observaciones ?? "—"}</td>
      </tr>)}</tbody></table></div>
    {lista && lista.cobros.length === 0 && <p className="text-sm">No hay cobros para este filtro en el libro seleccionado.</p>}
    <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
      <button type="button" className={boton} disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</button>
      <span>{lista ? `${lista.totalReal} cobros · página ${page} de ${paginas}` : "Cargando…"}</span>
      <button type="button" className={boton} disabled={page >= paginas} onClick={() => setPage(page + 1)}>Siguiente</button>
    </div>
    <p className="text-xs text-[var(--muted)]">Los cobros se registran desde la pestaña Documentos. No existe reversión de cobros en la plataforma todavía.</p>
  </section>;
}

/** SOLO LECTURA. `cont_cxc` es el registro manual anterior: no se borra ni se migra, y NUNCA entra en los saldos de arriba. */
function LegadoManual({ slug, entidadId }: { slug: string; entidadId: string }) {
  const [lista, setLista] = useState<Legado[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const ac = new AbortController();
    fetch(`/api/empresas/${slug}/contabilidad/cxc?entidad=${entidadId}`, { cache: "no-store", signal: ac.signal }).then(async r => ({ ok: r.ok, d: await r.json() }))
      .then(({ ok, d }) => { if (ac.signal.aborted) return; if (ok) setLista(d.cxc); else setError(d.error ?? "No se pudo cargar."); })
      .catch(() => { if (!ac.signal.aborted) setError("No se pudieron cargar los registros manuales."); });
    return () => ac.abort();
  }, [slug, entidadId]);
  return <section className="space-y-3">
    {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
    <p className="rounded border border-amber-500/50 p-2 text-sm">Registros manuales anteriores (solo lectura). No son facturas ni tienen cobros: <strong>no forman parte de los saldos de Cuentas por cobrar</strong> y no se migran automáticamente. Ya no se crean desde aquí.</p>
    {lista && lista.length === 0 && <p className="text-sm">No hay registros manuales en este libro.</p>}
    {lista && lista.length > 0 && <div className="overflow-auto"><table className="w-full text-sm"><thead><tr>{["Fecha", "Cliente (texto)", "Documento (texto)", "Vencimiento", "Monto", "Saldo registrado", "Estado"].map(t => <th key={t} className="p-2 text-left">{t}</th>)}</tr></thead>
      <tbody>{lista.map(r => <tr key={r.id} className="border-t border-[var(--border)]"><td className="p-2">{r.fecha}</td><td>{r.cliente}</td><td>{r.documento ?? "—"}</td><td>{r.vencimiento ?? "—"}</td><td>{q(r.monto)}</td><td>{q(r.saldo)}</td><td>{r.estado}</td></tr>)}</tbody></table></div>}
  </section>;
}
