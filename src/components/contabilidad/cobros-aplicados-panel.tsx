"use client";

import { useEffect, useRef, useState } from "react";
import { parsearMontoCobro } from "@/lib/contabilidad/cxc/monto";

/**
 * CxC-1 — Cobro multi-factura: un cobro de UN cliente aplicado a una o varias facturas del libro, e historial con anulación.
 * El servidor revalida todo (empresa, entidad, cliente, saldo, idempotencia); esta pantalla solo ayuda a capturar.
 * Los montos viajan como TEXTO decimal. No genera póliza, retención, nota de crédito ni anticipo.
 */
type ClienteSaldo = { clienteId: number; cliente: string; facturas: number; saldo: string };
type FacturaPendiente = { facturaId: number; numeroFactura: string | null; fechaEmision: string; total: string; cobrado: string; saldo: string };
type Cobro = {
  id: number; cliente: string; fechaCobro: string; montoTotal: string; medioPago: string | null; referencia: string | null; observaciones: string | null;
  estado: "VIGENTE" | "ANULADO"; creadoPor: string | null; creadoEn: string; anuladoPor: string | null; anuladoEn: string | null; motivoAnulacion: string | null;
  confirmacionActiva: boolean; aplicaciones: { facturaId: number; numeroFactura: string | null; monto: string }[];
};

const campo = "rounded border border-[var(--border)] bg-[var(--input)] p-2 text-sm";
const boton = "rounded border border-[var(--border)] px-3 py-1 text-sm hover:bg-[var(--input)] disabled:opacity-50";
const q = (n: string) => `Q${Number(n).toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const centavos = (n: number) => Math.round(n * 100);
const nuevaClave = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k${Date.now()}${Math.random().toString(36).slice(2, 12)}`);

async function api(url: string, init?: RequestInit) {
  const res = await fetch(url, { cache: "no-store", ...init });
  const data = await res.json().catch(() => ({ error: "Respuesta inválida del servidor." }));
  if (!res.ok) throw new Error(data.error || "No se pudo completar la operación.");
  return data;
}

export function CobrosAplicadosPanel({ slug, entidadId, puedeCobrar, puedeAnular }: { slug: string; entidadId: string; puedeCobrar: boolean; puedeAnular: boolean }) {
  const base = `/api/empresas/${slug}/contabilidad/cxc/cobros-aplicados`;
  const [version, setVersion] = useState(0);
  const [clientes, setClientes] = useState<ClienteSaldo[]>([]);
  const [clienteId, setClienteId] = useState("");
  const [facturas, setFacturas] = useState<FacturaPendiente[]>([]);
  const [montos, setMontos] = useState<Record<number, string>>({});
  const [f, setF] = useState({ fechaCobro: "", medioPago: "", referencia: "", observaciones: "" });
  const [msg, setMsg] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const clave = useRef<{ clave: string; huella: string } | null>(null);
  const [estado, setEstado] = useState("");
  const [lista, setLista] = useState<{ cobros: Cobro[]; totalReal: number } | null>(null);
  const [anulando, setAnulando] = useState<number | null>(null), [motivo, setMotivo] = useState("");

  useEffect(() => {
    if (!puedeCobrar) return;
    const ac = new AbortController();
    fetch(`${base}/clientes?entidad=${entidadId}`, { cache: "no-store", signal: ac.signal }).then(async r => ({ ok: r.ok, d: await r.json() }))
      .then(({ ok, d }) => { if (!ac.signal.aborted && ok) setClientes(d.clientes); }).catch(() => undefined);
    return () => ac.abort();
  }, [base, entidadId, puedeCobrar, version]);
  useEffect(() => {
    if (!puedeCobrar || !clienteId) return;
    const ac = new AbortController();
    fetch(`${base}/facturas?entidad=${entidadId}&clienteId=${clienteId}`, { cache: "no-store", signal: ac.signal }).then(async r => ({ ok: r.ok, d: await r.json() }))
      .then(({ ok, d }) => { if (!ac.signal.aborted && ok) setFacturas(d.facturas); }).catch(() => undefined);
    return () => ac.abort();
  }, [base, entidadId, puedeCobrar, clienteId, version]);
  useEffect(() => {
    const ac = new AbortController();
    const sp = new URLSearchParams({ entidad: entidadId }); if (estado) sp.set("estado", estado);
    fetch(`${base}?${sp}`, { cache: "no-store", signal: ac.signal }).then(async r => ({ ok: r.ok, d: await r.json() }))
      .then(({ ok, d }) => { if (ac.signal.aborted) return; if (ok) setLista(d); else setError(d.error ?? "No se pudo cargar."); })
      .catch(() => { if (!ac.signal.aborted) setError("No se pudo cargar el historial de cobros."); });
    return () => ac.abort();
  }, [base, entidadId, estado, version]);

  // Filas con monto escrito; cada una debe ser un importe válido (parsearMontoCobro) y no superar el saldo de su factura.
  const filas = facturas.map(x => ({ x, texto: (montos[x.facturaId] ?? "").trim(), monto: parsearMontoCobro(montos[x.facturaId] ?? "") }))
    .filter(r => r.texto !== "");
  const invalida = filas.some(r => r.monto === null || centavos(r.monto) > centavos(Number(r.x.saldo)));
  const totalCentavos = filas.reduce((s, r) => s + (r.monto === null ? 0 : centavos(r.monto)), 0);
  const total = (totalCentavos / 100).toFixed(2);
  const puedeRegistrar = !busy && !!clienteId && !!f.fechaCobro && filas.length > 0 && !invalida && totalCentavos > 0;

  async function registrar() {
    setBusy(true); setError(""); setMsg("");
    try {
      const cuerpo = {
        clienteId: Number(clienteId), fechaCobro: f.fechaCobro, medioPago: f.medioPago.trim() || null, referencia: f.referencia.trim() || null, observaciones: f.observaciones.trim() || null,
        aplicaciones: filas.map(r => ({ facturaId: r.x.facturaId, monto: (centavos(r.monto!) / 100).toFixed(2) })),
      };
      // La clave solo se conserva si el contenido es idéntico (reintento tras un corte); si algo cambió, se genera otra.
      const huella = JSON.stringify(cuerpo);
      if (!clave.current || clave.current.huella !== huella) clave.current = { clave: nuevaClave(), huella };
      const r = await api(base + `?entidad=${entidadId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...cuerpo, claveIdempotencia: clave.current.clave }) });
      setMsg(r.mensaje ?? "Cobro registrado.");
      clave.current = null; setMontos({}); setF({ ...f, medioPago: "", referencia: "", observaciones: "" }); setVersion(v => v + 1);
    } catch (e) { setError(e instanceof Error ? e.message : "Error"); } finally { setBusy(false); }
  }
  async function anular(id: number) {
    setBusy(true); setError(""); setMsg("");
    try { await api(`${base}/${id}/anular?entidad=${entidadId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ motivo }) }); setAnulando(null); setMotivo(""); setMsg("Cobro anulado: los saldos se restauraron."); setVersion(v => v + 1); }
    catch (e) { setError(e instanceof Error ? e.message : "Error"); } finally { setBusy(false); }
  }

  return <section className="space-y-4">
    {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
    {msg && <p role="status" className="text-sm text-emerald-400">{msg}</p>}
    {puedeCobrar && <fieldset disabled={busy} className="space-y-3 rounded border border-[var(--border)] p-3">
      <legend className="px-1 text-sm font-medium">Registrar cobro a varias facturas</legend>
      <p className="text-xs text-[var(--muted)]">Un cobro es de UN cliente y se aplica a una o varias de sus facturas emitidas de este libro. El total del cobro es la suma de lo aplicado; no se puede aplicar más que el saldo de cada factura.</p>
      <div className="grid gap-2 sm:grid-cols-4">
        <select className={campo} aria-label="Cliente del cobro" value={clienteId} onChange={e => { setClienteId(e.target.value); setMontos({}); setFacturas([]); clave.current = null; }}>
          <option value="">Cliente con saldo</option>{clientes.map(c => <option key={c.clienteId} value={c.clienteId}>{c.cliente} — {c.facturas} fact. · {q(c.saldo)}</option>)}</select>
        <label className="text-xs">Fecha del cobro<input type="date" className={`${campo} block w-full`} value={f.fechaCobro} onChange={e => setF({ ...f, fechaCobro: e.target.value })} /></label>
        <input className={campo} placeholder="Medio (transferencia, cheque…)" maxLength={40} value={f.medioPago} onChange={e => setF({ ...f, medioPago: e.target.value })} />
        <input className={campo} placeholder="Referencia / boleta" maxLength={120} value={f.referencia} onChange={e => setF({ ...f, referencia: e.target.value })} />
        <input className={`${campo} sm:col-span-4`} placeholder="Observaciones" maxLength={2000} value={f.observaciones} onChange={e => setF({ ...f, observaciones: e.target.value })} />
      </div>
      {clienteId && (facturas.length === 0 ? <p className="text-sm">Este cliente no tiene facturas con saldo en este libro.</p>
        : <div className="overflow-auto"><table className="w-full text-sm"><thead><tr>{["Factura", "Fecha", "Total", "Pagado / aplicado", "Saldo", "Monto a aplicar"].map(t => <th key={t} className="p-2 text-left">{t}</th>)}</tr></thead>
          <tbody>{facturas.map(x => {
            const texto = (montos[x.facturaId] ?? "").trim(), m = parsearMontoCobro(montos[x.facturaId] ?? "");
            const mal = texto !== "" && (m === null || centavos(m) > centavos(Number(x.saldo)));
            return <tr key={x.facturaId} className="border-t border-[var(--border)]">
              <td className="p-2">{x.numeroFactura ?? `#${x.facturaId}`}</td><td>{x.fechaEmision}</td><td>{q(x.total)}</td><td>{q(x.cobrado)}</td><td className="font-medium">{q(x.saldo)}</td>
              <td><span className="flex items-center gap-1"><input className={`${campo} w-32`} inputMode="decimal" autoComplete="off" placeholder="0.00" aria-label={`Monto a aplicar a ${x.numeroFactura ?? x.facturaId}`} aria-invalid={mal}
                value={montos[x.facturaId] ?? ""} onChange={e => setMontos({ ...montos, [x.facturaId]: e.target.value })} />
                <button type="button" className={boton} onClick={() => setMontos({ ...montos, [x.facturaId]: x.saldo })}>Saldo</button>
                {mal && <small className="text-red-500">Importe inválido o mayor al saldo</small>}</span></td></tr>;
          })}</tbody></table></div>)}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={boton} disabled={!puedeRegistrar} onClick={registrar}>Registrar cobro</button>
        <span className="text-sm">Total del cobro (suma aplicada): <strong>{q(total)}</strong> · Facturas: {filas.length}</span>
      </div>
    </fieldset>}

    <div className="flex items-center gap-2">
      <select className={campo} aria-label="Estado del cobro" value={estado} onChange={e => setEstado(e.target.value)}><option value="">Todos</option><option value="VIGENTE">Vigentes</option><option value="ANULADO">Anulados</option></select>
      <span className="text-xs text-[var(--muted)]">{lista ? `${lista.totalReal} cobros.` : "Cargando…"}</span>
    </div>
    <ul className="space-y-2 text-sm">{lista?.cobros.map(c => <li key={c.id} className="rounded border border-[var(--border)] p-2">
      <p className="font-medium">#{c.id} · {c.fechaCobro} · {c.cliente} · {q(c.montoTotal)} · <span className={c.estado === "ANULADO" ? "text-red-500" : "text-emerald-400"}>{c.estado === "ANULADO" ? "Anulado" : "Vigente"}</span>
        <small className="text-[var(--muted)]"> · {[c.medioPago, c.referencia].filter(Boolean).join(" · ") || "sin medio/referencia"}{c.creadoPor ? ` · registró ${c.creadoPor}` : ""}</small></p>
      <ul className="ml-3 list-disc text-xs">{c.aplicaciones.map(a => <li key={a.facturaId}>{a.numeroFactura ?? `#${a.facturaId}`}: {q(a.monto)}</li>)}</ul>
      {c.estado === "ANULADO" && <p className="text-xs text-[var(--muted)]">Anulado {c.anuladoEn}{c.anuladoPor ? ` por ${c.anuladoPor}` : ""} — {c.motivoAnulacion}. Se conserva para auditoría y ya no afecta saldos.</p>}
      {puedeAnular && c.estado === "VIGENTE" && (anulando === c.id
        ? <span className="mt-1 flex gap-1"><input className={campo} placeholder="Motivo de la anulación" maxLength={500} value={motivo} onChange={e => setMotivo(e.target.value)} />
          <button type="button" className={boton} disabled={busy || motivo.trim().length < 3} onClick={() => anular(c.id)}>Confirmar anulación</button>
          <button type="button" className={boton} onClick={() => setAnulando(null)}>Cancelar</button></span>
        : <button type="button" className={`${boton} mt-1`} disabled={c.confirmacionActiva} title={c.confirmacionActiva ? "Tiene una confirmación bancaria activa: anúlala primero." : undefined}
            onClick={() => { setAnulando(c.id); setMotivo(""); }}>Anular cobro</button>)}
      {c.estado === "VIGENTE" && c.confirmacionActiva && <small className="block text-xs text-amber-400">Tiene confirmación bancaria activa: no se puede anular hasta anular esa confirmación.</small>}
    </li>)}</ul>
    {lista && lista.cobros.length === 0 && <p className="text-sm">No hay cobros aplicados todavía.</p>}
  </section>;
}
