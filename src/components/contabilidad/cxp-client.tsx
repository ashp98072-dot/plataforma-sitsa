"use client";

import { useEffect, useState } from "react";

type Entidad = { id: number; codigo: string; nombre: string; activa: number };
type Config = { regimenFiscal: "GENERAL" | "PEQUENO_CONTRIBUYENTE"; sujetoIsr: boolean; cuentaProveedorId: number | null; cuentaAnticipoId: number | null; cuentaGastoId: number | null; activo: boolean };
type Proveedor = { id: number; nombre: string; nit: string | null; activo: boolean; fiscal: Config | null };
type Cuenta = { id: number; codigo: string; nombre: string; tipo: string };
type Factura = {
  id: number; proveedorId: number; proveedorNombre: string; serie: string; numero: string; fechaDocumento: string; fechaVencimiento: string | null; baseNeto: string; ivaMonto: string;
  totalDocumento: string; isrMonto: string; isrPorcentaje: string; totalNetoPagar: string; estadoAdmin: string; motivoAnulacion: string | null;
  retencionIsr: string; montoPagadero: string; pagado: string; saldo: string; estadoFinanciero: "PENDIENTE" | "PARCIAL" | "PAGADA" | "ANULADA";
};
type Calculo = {
  baseNeto: string; ivaMonto: string; totalDocumento: string; isrPorcentaje: string; isrMonto: string; isrTramo: string; isrFijo: string; isrVariable: string;
  totalNetoPagar: string; reglaIsr: string; advertencias: string[]; proveedorNombre: string;
};
type Pago = {
  id: number; proveedorNombre: string; fechaPago: string; montoTotal: string; medioPago: string; referencia: string; observaciones: string | null; estado: "REGISTRADO" | "REVERSADO";
  motivoReversion: string | null; aplicaciones: { facturaId: number; documento?: string; monto: string }[];
};

const campo = "rounded border border-[var(--border)] bg-[var(--input)] p-2 text-sm";
const boton = "rounded border border-[var(--border)] px-3 py-1 text-sm hover:bg-[var(--input)] disabled:opacity-50";
const q = (n: string) => `Q${Number(n).toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ESTADO_FIN: Record<Factura["estadoFinanciero"], string> = { PENDIENTE: "Pendiente", PARCIAL: "Pago parcial", PAGADA: "Pagada", ANULADA: "Anulada" };
async function api(url: string, init?: RequestInit) {
  const res = await fetch(url, { cache: "no-store", ...init });
  const data = await res.json().catch(() => ({ error: "Respuesta inválida del servidor." }));
  if (!res.ok) throw new Error(data.error || "No se pudo completar la operación.");
  return data;
}
const post = (url: string, method: string, body: unknown) => api(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const nuevaClave = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k${Date.now()}${Math.random().toString(36).slice(2, 10)}`);

export function CxpClient({ slug, puedeVer, puedeRegistrar, puedeAnular, puedeVerFiscal, puedeEditarFiscal, puedeVerPagos = false, puedeRegistrarPago = false, puedeReversarPago = false }: {
  slug: string; puedeVer: boolean; puedeRegistrar: boolean; puedeAnular: boolean; puedeVerFiscal: boolean; puedeEditarFiscal: boolean;
  puedeVerPagos?: boolean; puedeRegistrarPago?: boolean; puedeReversarPago?: boolean;
}) {
  const [entidades, setEntidades] = useState<Entidad[]>([]);
  const [entidadId, setEntidadId] = useState("");
  const [vista, setVista] = useState<"facturas" | "pagos" | "proveedores">(puedeVer ? "facturas" : puedeVerPagos ? "pagos" : "proveedores");
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
    <h1 className="text-2xl font-semibold">Cuentas por pagar</h1>
    <p className="text-sm text-[var(--muted)]">Facturas y pagos a proveedores registrados en plataforma. Informativo: no genera pólizas ni sustituye aún a Milenium. La retención de ISR se resta del total de la factura (no es un pago al proveedor). Siguen bloqueados, sin regla confirmada: fracciones de centavo en el ISR, factura especial y retención de IVA.</p>
    <label className="block text-sm">Libro contable (entidad)
      <select className={`${campo} ml-2`} value={entidadId} onChange={e => setEntidadId(e.target.value)} aria-label="Entidad">
        <option value="">Seleccionar entidad</option>{entidades.map(e => <option key={e.id} value={e.id}>{e.codigo} — {e.nombre}</option>)}
      </select></label>
    {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
    {entidadId && <>
      <div className="flex gap-2">
        {puedeVer && <button type="button" className={boton} aria-pressed={vista === "facturas"} onClick={() => setVista("facturas")}>Facturas</button>}
        {puedeVerPagos && <button type="button" className={boton} aria-pressed={vista === "pagos"} onClick={() => setVista("pagos")}>Pagos</button>}
        {(puedeVerFiscal || puedeVer) && <button type="button" className={boton} aria-pressed={vista === "proveedores"} onClick={() => setVista("proveedores")}>Proveedores y configuración fiscal</button>}
      </div>
      {vista === "facturas" && puedeVer && <Facturas key={`f${entidadId}`} slug={slug} entidadId={entidadId} puedeRegistrar={puedeRegistrar} puedeAnular={puedeAnular} />}
      {vista === "pagos" && puedeVerPagos && <Pagos key={`g${entidadId}`} slug={slug} entidadId={entidadId} puedeRegistrar={puedeRegistrarPago} puedeReversar={puedeReversarPago} />}
      {vista === "proveedores" && <Proveedores key={`p${entidadId}`} slug={slug} entidadId={entidadId} puedeVerFiscal={puedeVerFiscal} puedeEditar={puedeEditarFiscal} />}
    </>}
  </div>;
}

function Facturas({ slug, entidadId, puedeRegistrar, puedeAnular }: { slug: string; entidadId: string; puedeRegistrar: boolean; puedeAnular: boolean }) {
  const base = `/api/empresas/${slug}/contabilidad/cxp`;
  const [version, setVersion] = useState(0);
  const [estado, setEstado] = useState(""), [texto, setTexto] = useState("");
  const [lista, setLista] = useState<{ total: number; facturas: Factura[] } | null>(null);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [msg, setMsg] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [f, setF] = useState({ proveedorId: "", serie: "", numero: "", fechaDocumento: "", fechaVencimiento: "", baseNeto: "", ivaMonto: "", observaciones: "" });
  const [calculo, setCalculo] = useState<Calculo | null>(null);
  const [anulando, setAnulando] = useState<number | null>(null), [motivo, setMotivo] = useState("");

  useEffect(() => {
    const ac = new AbortController();
    const sp = new URLSearchParams({ entidad: entidadId }); if (estado) sp.set("estado", estado); if (texto) sp.set("q", texto);
    fetch(`${base}/facturas?${sp}`, { cache: "no-store", signal: ac.signal }).then(async r => ({ ok: r.ok, d: await r.json() }))
      .then(({ ok, d }) => { if (ac.signal.aborted) return; if (ok) setLista(d); else setError(d.error ?? "No se pudo cargar."); })
      .catch(() => { if (!ac.signal.aborted) setError("No se pudo cargar las facturas."); });
    return () => ac.abort();
  }, [base, entidadId, estado, texto, version]);
  useEffect(() => {
    if (!puedeRegistrar) return;
    const ac = new AbortController();
    fetch(`${base}/proveedores?entidad=${entidadId}&activos=1`, { cache: "no-store", signal: ac.signal }).then(async r => ({ ok: r.ok, d: await r.json() }))
      .then(({ ok, d }) => { if (!ac.signal.aborted && ok) setProveedores(d.proveedores); }).catch(() => undefined);
    return () => ac.abort();
  }, [base, entidadId, puedeRegistrar, version]);

  const cuerpo = () => ({ ...f, proveedorId: Number(f.proveedorId), baseNeto: f.baseNeto, ivaMonto: f.ivaMonto || "0", fechaVencimiento: f.fechaVencimiento || null });
  async function calcular() {
    setBusy(true); setError(""); setMsg("");
    try { setCalculo(await post(`${base}/facturas/preview?entidad=${entidadId}`, "POST", cuerpo())); } catch (e) { setCalculo(null); setError(e instanceof Error ? e.message : "Error"); } finally { setBusy(false); }
  }
  async function registrar() {
    setBusy(true); setError(""); setMsg("");
    try {
      const r = await post(`${base}/facturas?entidad=${entidadId}`, "POST", cuerpo());
      setMsg(`Factura registrada (CxP #${r.factura.id}).${r.advertencias?.length ? ` ${r.advertencias.join(" ")}` : ""}`);
      setF({ proveedorId: f.proveedorId, serie: "", numero: "", fechaDocumento: "", fechaVencimiento: "", baseNeto: "", ivaMonto: "", observaciones: "" }); setCalculo(null); setVersion(v => v + 1);
    } catch (e) { setError(e instanceof Error ? e.message : "Error"); } finally { setBusy(false); }
  }
  async function anular(id: number) {
    setBusy(true); setError(""); setMsg("");
    try { await post(`${base}/facturas/${id}/anular?entidad=${entidadId}`, "POST", { motivo }); setAnulando(null); setMotivo(""); setMsg("Factura anulada."); setVersion(v => v + 1); }
    catch (e) { setError(e instanceof Error ? e.message : "Error"); if (/Actualiza/.test(String(e))) setVersion(v => v + 1); } finally { setBusy(false); }
  }
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setF({ ...f, [k]: e.target.value }); setCalculo(null); };
  const configurados = proveedores.filter(p => p.fiscal?.activo);

  return <section className="space-y-4">
    {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
    {msg && <p role="status" className="text-sm text-emerald-400">{msg}</p>}
    {puedeRegistrar && <fieldset disabled={busy} className="space-y-2 rounded border border-[var(--border)] p-3">
      <legend className="px-1 text-sm font-medium">Registrar factura de proveedor</legend>
      <div className="grid gap-2 sm:grid-cols-4">
        <select className={campo} aria-label="Proveedor" value={f.proveedorId} onChange={set("proveedorId")}><option value="">Proveedor (configurado)</option>{configurados.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select>
        <input className={campo} placeholder="Serie (opcional)" value={f.serie} onChange={set("serie")} />
        <input className={campo} placeholder="Número" value={f.numero} onChange={set("numero")} />
        <label className="text-xs">Fecha<input type="date" className={`${campo} block w-full`} value={f.fechaDocumento} onChange={set("fechaDocumento")} /></label>
        <label className="text-xs">Vencimiento (manual)<input type="date" className={`${campo} block w-full`} value={f.fechaVencimiento} onChange={set("fechaVencimiento")} /></label>
        <input className={campo} inputMode="decimal" placeholder="Valor neto (sin IVA)" value={f.baseNeto} onChange={set("baseNeto")} />
        <input className={campo} inputMode="decimal" placeholder="IVA" value={f.ivaMonto} onChange={set("ivaMonto")} />
        <input className={campo} placeholder="Observaciones" value={f.observaciones} onChange={set("observaciones")} />
      </div>
      <div className="flex gap-2"><button type="button" className={boton} onClick={calcular}>Calcular retención</button>
        <button type="button" className={boton} onClick={registrar} disabled={!calculo}>Registrar</button></div>
      {calculo && <dl className="grid max-w-md grid-cols-2 gap-x-4 gap-y-1 text-sm" aria-label="Desglose de la factura">
        <dt>Valor neto (sin IVA)</dt><dd className="text-right">{q(calculo.baseNeto)}</dd>
        <dt>IVA</dt><dd className="text-right">{q(calculo.ivaMonto)}</dd>
        <dt>Total de la factura</dt><dd className="text-right">{q(calculo.totalDocumento)}</dd>
        <dt>Retención de ISR{Number(calculo.isrMonto) > 0 ? ` (${calculo.isrTramo === "FIJO_MAS_SIETE_POR_CIENTO" ? `${q(calculo.isrFijo)} + ${calculo.isrPorcentaje}% del excedente` : `${calculo.isrPorcentaje}% del valor neto`})` : ""}</dt><dd className="text-right">− {q(calculo.isrMonto)}</dd>
        <dt className="font-semibold">Monto pagadero al proveedor</dt><dd className="text-right font-semibold">{q(calculo.totalNetoPagar)}</dd>
      </dl>}
      {calculo?.advertencias.map(a => <p key={a} className="text-sm text-amber-400">{a}</p>)}
    </fieldset>}
    <div className="flex gap-2">
      <select className={campo} aria-label="Estado" value={estado} onChange={e => setEstado(e.target.value)}><option value="">Todas</option><option value="REGISTRADA">Registradas</option><option value="ANULADA">Anuladas</option></select>
      <input className={campo} placeholder="Buscar proveedor o número" value={texto} onChange={e => setTexto(e.target.value)} />
    </div>
    <div className="overflow-auto"><table className="w-full text-sm"><thead><tr>{["Fecha", "Proveedor", "Documento", "Valor neto", "IVA", "Total", "Retención ISR", "Monto pagadero", "Pagado", "Saldo", "Situación", ""].map(t => <th key={t} className="p-2 text-left">{t}</th>)}</tr></thead>
      <tbody>{lista?.facturas.map(x => <tr key={x.id} className="border-t border-[var(--border)] align-top">
        <td className="p-2">{x.fechaDocumento}{x.fechaVencimiento && <small className="block">Vence {x.fechaVencimiento}</small>}</td><td>{x.proveedorNombre}</td><td>{x.serie ? `${x.serie}-` : ""}{x.numero}</td>
        <td>{q(x.baseNeto)}</td><td>{q(x.ivaMonto)}</td><td>{q(x.totalDocumento)}</td>
        <td>{q(x.retencionIsr)}{Number(x.isrMonto) > 0 && <small className="block">tasa {x.isrPorcentaje}%</small>}</td><td>{q(x.montoPagadero)}</td>
        <td>{q(x.pagado)}</td><td className="font-medium">{q(x.saldo)}</td>
        <td>{ESTADO_FIN[x.estadoFinanciero]}{x.motivoAnulacion && <small className="block">{x.motivoAnulacion}</small>}</td>
        <td>{puedeAnular && x.estadoAdmin === "REGISTRADA" && (anulando === x.id
          ? <span className="flex gap-1"><input className={campo} placeholder="Motivo" value={motivo} onChange={e => setMotivo(e.target.value)} /><button type="button" className={boton} disabled={busy || motivo.trim().length < 3} onClick={() => anular(x.id)}>Confirmar</button><button type="button" className={boton} onClick={() => setAnulando(null)}>Cancelar</button></span>
          : <button type="button" className={boton} onClick={() => { setAnulando(x.id); setMotivo(""); }}>Anular</button>)}</td>
      </tr>)}</tbody></table></div>
    <p className="text-xs text-[var(--muted)]">{lista ? `${lista.total} facturas.` : "Cargando…"} Saldo = monto pagadero − pagado. La retención de ISR no es un pago al proveedor. Una factura anulada no libera su serie y número.</p>
  </section>;
}

/** Centavos enteros de un texto de importe (solo para mostrar el total tecleado; el servidor valida y calcula todo). */
const centavos = (t: string) => { const n = Number(t.replace(",", ".")); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0; };

function Pagos({ slug, entidadId, puedeRegistrar, puedeReversar }: { slug: string; entidadId: string; puedeRegistrar: boolean; puedeReversar: boolean }) {
  const base = `/api/empresas/${slug}/contabilidad/cxp`;
  const [version, setVersion] = useState(0);
  const [lista, setLista] = useState<{ total: number; pagos: Pago[] } | null>(null);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [facturas, setFacturas] = useState<Factura[]>([]);
  const [msg, setMsg] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [f, setF] = useState({ proveedorId: "", fechaPago: "", medioPago: "", referencia: "", observaciones: "" });
  const [montos, setMontos] = useState<Record<number, string>>({});
  const [clave, setClave] = useState(nuevaClave);
  const [reversando, setReversando] = useState<number | null>(null), [motivo, setMotivo] = useState("");

  useEffect(() => {
    const ac = new AbortController();
    fetch(`${base}/pagos?entidad=${entidadId}`, { cache: "no-store", signal: ac.signal }).then(async r => ({ ok: r.ok, d: await r.json() }))
      .then(({ ok, d }) => { if (ac.signal.aborted) return; if (ok) setLista(d); else setError(d.error ?? "No se pudo cargar."); })
      .catch(() => { if (!ac.signal.aborted) setError("No se pudieron cargar los pagos."); });
    return () => ac.abort();
  }, [base, entidadId, version]);
  useEffect(() => {
    if (!puedeRegistrar) return;
    const ac = new AbortController();
    fetch(`${base}/proveedores?entidad=${entidadId}&activos=1`, { cache: "no-store", signal: ac.signal }).then(async r => ({ ok: r.ok, d: await r.json() }))
      .then(({ ok, d }) => { if (!ac.signal.aborted && ok) setProveedores(d.proveedores); }).catch(() => undefined);
    return () => ac.abort();
  }, [base, entidadId, puedeRegistrar]);
  useEffect(() => {
    if (!puedeRegistrar || !f.proveedorId) return;
    const ac = new AbortController();
    fetch(`${base}/facturas?entidad=${entidadId}&proveedorId=${f.proveedorId}&estado=REGISTRADA&pageSize=100`, { cache: "no-store", signal: ac.signal }).then(async r => ({ ok: r.ok, d: await r.json() }))
      .then(({ ok, d }) => { if (!ac.signal.aborted && ok) setFacturas((d.facturas as Factura[]).filter(x => Number(x.saldo) > 0)); }).catch(() => undefined);
    return () => ac.abort();
  }, [base, entidadId, puedeRegistrar, f.proveedorId, version]);

  const totalCentavos = Object.values(montos).reduce((s, t) => s + centavos(t), 0);
  async function registrar() {
    setBusy(true); setError(""); setMsg("");
    try {
      const aplicaciones = Object.entries(montos).filter(([, t]) => centavos(t) > 0).map(([id, t]) => ({ facturaId: Number(id), monto: t.replace(",", ".") }));
      const r = await post(`${base}/pagos?entidad=${entidadId}`, "POST", { ...f, proveedorId: Number(f.proveedorId), claveIdempotencia: clave, aplicaciones });
      setMsg(r.repetido ? `Este pago ya estaba registrado (#${r.pago.id}); no se duplicó.` : `Pago registrado (#${r.pago.id}) por ${q(r.pago.montoTotal)}.`);
      setMontos({}); setF({ ...f, medioPago: "", referencia: "", observaciones: "" }); setClave(nuevaClave()); setVersion(v => v + 1);
    } catch (e) { setError(e instanceof Error ? e.message : "Error"); if (/Actualiza/.test(String(e))) setVersion(v => v + 1); } finally { setBusy(false); }
  }
  async function reversar(id: number) {
    setBusy(true); setError(""); setMsg("");
    try { await post(`${base}/pagos/${id}/reversar?entidad=${entidadId}`, "POST", { motivo }); setReversando(null); setMotivo(""); setMsg("Pago reversado: el saldo de sus facturas se recuperó."); setVersion(v => v + 1); }
    catch (e) { setError(e instanceof Error ? e.message : "Error"); } finally { setBusy(false); }
  }
  const configurados = proveedores.filter(p => p.fiscal?.activo);

  return <section className="space-y-4">
    {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
    {msg && <p role="status" className="text-sm text-emerald-400">{msg}</p>}
    {puedeRegistrar && <fieldset disabled={busy} className="space-y-2 rounded border border-[var(--border)] p-3">
      <legend className="px-1 text-sm font-medium">Registrar pago a proveedor</legend>
      <p className="text-xs text-[var(--muted)]">Un pago se aplica a una o varias facturas de UN proveedor; el total es la suma de lo aplicado. Se paga el monto pagadero (total − retención de ISR).</p>
      <div className="grid gap-2 sm:grid-cols-4">
        <select className={campo} aria-label="Proveedor del pago" value={f.proveedorId} onChange={e => { setF({ ...f, proveedorId: e.target.value }); setMontos({}); setFacturas([]); }}><option value="">Proveedor</option>{configurados.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select>
        <label className="text-xs">Fecha del pago<input type="date" className={`${campo} block w-full`} value={f.fechaPago} onChange={e => setF({ ...f, fechaPago: e.target.value })} /></label>
        <input className={campo} placeholder="Medio (transferencia, cheque…)" value={f.medioPago} onChange={e => setF({ ...f, medioPago: e.target.value })} />
        <input className={campo} placeholder="Referencia" value={f.referencia} onChange={e => setF({ ...f, referencia: e.target.value })} />
        <input className={`${campo} sm:col-span-4`} placeholder="Observaciones" value={f.observaciones} onChange={e => setF({ ...f, observaciones: e.target.value })} />
      </div>
      {f.proveedorId && (facturas.length === 0 ? <p className="text-sm">Este proveedor no tiene facturas con saldo pendiente.</p>
        : <table className="w-full text-sm"><thead><tr>{["Documento", "Total", "Retención ISR", "Monto pagadero", "Pagado", "Saldo", "Aplicar a este pago"].map(t => <th key={t} className="p-2 text-left">{t}</th>)}</tr></thead>
          <tbody>{facturas.map(x => <tr key={x.id} className="border-t border-[var(--border)]">
            <td className="p-2">{x.serie ? `${x.serie}-` : ""}{x.numero}</td><td>{q(x.totalDocumento)}</td><td>{q(x.retencionIsr)}</td><td>{q(x.montoPagadero)}</td><td>{q(x.pagado)}</td><td className="font-medium">{q(x.saldo)}</td>
            <td><span className="flex gap-1"><input className={`${campo} w-32`} inputMode="decimal" aria-label={`Monto a aplicar a ${x.numero}`} placeholder="0.00" value={montos[x.id] ?? ""} onChange={e => setMontos({ ...montos, [x.id]: e.target.value })} />
              <button type="button" className={boton} onClick={() => setMontos({ ...montos, [x.id]: x.saldo })}>Pagar saldo</button></span></td>
          </tr>)}</tbody></table>)}
      <div className="flex items-center gap-3"><button type="button" className={boton} onClick={registrar} disabled={busy || !f.proveedorId || !f.fechaPago || totalCentavos === 0}>Registrar pago</button>
        <span className="text-sm">Total a pagar: <strong>{q((totalCentavos / 100).toFixed(2))}</strong></span></div>
    </fieldset>}
    <div className="overflow-auto"><table className="w-full text-sm"><thead><tr>{["Fecha", "Proveedor", "Medio / referencia", "Facturas aplicadas", "Total pagado", "Estado", ""].map(t => <th key={t} className="p-2 text-left">{t}</th>)}</tr></thead>
      <tbody>{lista?.pagos.map(p => <tr key={p.id} className="border-t border-[var(--border)] align-top">
        <td className="p-2">{p.fechaPago}</td><td>{p.proveedorNombre}</td><td>{[p.medioPago, p.referencia].filter(Boolean).join(" · ") || "—"}</td>
        <td>{p.aplicaciones.map(a => <span key={a.facturaId} className="block">{a.documento}: {q(a.monto)}</span>)}</td><td>{q(p.montoTotal)}</td>
        <td>{p.estado === "REVERSADO" ? "Reversado" : "Registrado"}{p.motivoReversion && <small className="block">{p.motivoReversion}</small>}</td>
        <td>{puedeReversar && p.estado === "REGISTRADO" && (reversando === p.id
          ? <span className="flex gap-1"><input className={campo} placeholder="Motivo" value={motivo} onChange={e => setMotivo(e.target.value)} /><button type="button" className={boton} disabled={busy || motivo.trim().length < 3} onClick={() => reversar(p.id)}>Confirmar</button><button type="button" className={boton} onClick={() => setReversando(null)}>Cancelar</button></span>
          : <button type="button" className={boton} onClick={() => { setReversando(p.id); setMotivo(""); }}>Reversar</button>)}</td>
      </tr>)}</tbody></table></div>
    <p className="text-xs text-[var(--muted)]">{lista ? `${lista.total} pagos.` : "Cargando…"} Un pago reversado deja de contar y devuelve el saldo a sus facturas; no se borra.</p>
  </section>;
}

function Proveedores({ slug, entidadId, puedeVerFiscal, puedeEditar }: { slug: string; entidadId: string; puedeVerFiscal: boolean; puedeEditar: boolean }) {
  const base = `/api/empresas/${slug}/contabilidad/cxp`;
  const [version, setVersion] = useState(0);
  const [lista, setLista] = useState<Proveedor[]>([]), [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [edit, setEdit] = useState<Proveedor | null>(null);
  const [cfg, setCfg] = useState<Config>({ regimenFiscal: "GENERAL", sujetoIsr: false, cuentaProveedorId: null, cuentaAnticipoId: null, cuentaGastoId: null, activo: true });
  const [msg, setMsg] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => {
    const ac = new AbortController();
    fetch(`${base}/proveedores?entidad=${entidadId}`, { cache: "no-store", signal: ac.signal }).then(async r => ({ ok: r.ok, d: await r.json() }))
      .then(({ ok, d }) => { if (ac.signal.aborted) return; if (ok) setLista(d.proveedores); else setError(d.error ?? "No se pudo cargar."); }).catch(() => undefined);
    if (puedeVerFiscal) fetch(`${base}/cuentas?entidad=${entidadId}`, { cache: "no-store", signal: ac.signal }).then(async r => ({ ok: r.ok, d: await r.json() }))
      .then(({ ok, d }) => { if (!ac.signal.aborted && ok) setCuentas(d.cuentas); }).catch(() => undefined);
    return () => ac.abort();
  }, [base, entidadId, puedeVerFiscal, version]);
  async function guardar() {
    if (!edit) return;
    setBusy(true); setError(""); setMsg("");
    try { await post(`${base}/proveedores/${edit.id}/fiscal?entidad=${entidadId}`, "PUT", cfg); setMsg("Configuración guardada. No cambia facturas ya registradas."); setEdit(null); setVersion(v => v + 1); }
    catch (e) { setError(e instanceof Error ? e.message : "Error"); } finally { setBusy(false); }
  }
  const selector = (k: "cuentaProveedorId" | "cuentaAnticipoId" | "cuentaGastoId", etiqueta: string, tipo: string) => <label className="text-xs">{etiqueta}
    <select className={`${campo} block w-full`} value={cfg[k] ?? ""} onChange={e => setCfg({ ...cfg, [k]: e.target.value ? Number(e.target.value) : null })}>
      <option value="">Sin asignar</option>{cuentas.filter(c => c.tipo === tipo).map(c => <option key={c.id} value={c.id}>{c.codigo} — {c.nombre}</option>)}</select></label>;
  return <section className="space-y-3">
    {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
    {msg && <p role="status" className="text-sm text-emerald-400">{msg}</p>}
    <p className="text-xs text-[var(--muted)]">Un proveedor debe tener configuración fiscal para esta entidad antes de registrarle facturas. El maestro comercial se edita en Compras → Proveedores.</p>
    <div className="overflow-auto"><table className="w-full text-sm"><thead><tr>{["Proveedor", "NIT", "Régimen", "Sujeto a ISR", "Estado", ""].map(t => <th key={t} className="p-2 text-left">{t}</th>)}</tr></thead>
      <tbody>{lista.map(p => <tr key={p.id} className="border-t border-[var(--border)]">
        <td className="p-2">{p.nombre}{!p.activo && <small className="block">Inactivo en Compras</small>}</td><td>{p.nit ?? "—"}</td>
        <td>{p.fiscal ? (p.fiscal.regimenFiscal === "GENERAL" ? "General" : "Pequeño contribuyente") : "Sin configurar"}</td><td>{p.fiscal ? (p.fiscal.sujetoIsr ? "Sí" : "No") : "—"}</td>
        <td>{p.fiscal ? (p.fiscal.activo ? "Activa" : "Inactiva") : "Pendiente"}</td>
        <td>{puedeEditar && <button type="button" className={boton} onClick={() => { setEdit(p); setCfg(p.fiscal ?? { regimenFiscal: "GENERAL", sujetoIsr: false, cuentaProveedorId: null, cuentaAnticipoId: null, cuentaGastoId: null, activo: true }); }}>{p.fiscal ? "Editar" : "Configurar"}</button>}</td>
      </tr>)}</tbody></table></div>
    {edit && <fieldset disabled={busy} className="space-y-2 rounded border border-[var(--border)] p-3">
      <legend className="px-1 text-sm font-medium">Configuración fiscal — {edit.nombre}</legend>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="text-xs">Régimen<select className={`${campo} block w-full`} value={cfg.regimenFiscal} onChange={e => { const r = e.target.value as Config["regimenFiscal"]; setCfg({ ...cfg, regimenFiscal: r, sujetoIsr: r === "PEQUENO_CONTRIBUYENTE" ? false : cfg.sujetoIsr }); }}>
          <option value="GENERAL">General</option><option value="PEQUENO_CONTRIBUYENTE">Pequeño contribuyente</option></select></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={cfg.sujetoIsr} disabled={cfg.regimenFiscal === "PEQUENO_CONTRIBUYENTE"} onChange={e => setCfg({ ...cfg, sujetoIsr: e.target.checked })} />Sujeto a retención de ISR</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={cfg.activo} onChange={e => setCfg({ ...cfg, activo: e.target.checked })} />Configuración activa</label>
        {selector("cuentaProveedorId", "Cuenta de proveedores (Pasivo)", "Pasivo")}{selector("cuentaAnticipoId", "Cuenta de anticipo a proveedores (Activo)", "Activo")}{selector("cuentaGastoId", "Cuenta de gasto por defecto (Gasto)", "Gasto")}
      </div>
      <div className="flex gap-2"><button type="button" className={boton} onClick={guardar}>Guardar</button><button type="button" className={boton} onClick={() => setEdit(null)}>Cancelar</button></div>
    </fieldset>}
  </section>;
}
