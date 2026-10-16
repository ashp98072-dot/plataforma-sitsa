"use client";
import { useCallback, useEffect, useState } from "react";
import { ESTADOS_C2C, etiquetaDiferencia, type Diferencia, type EstadoC2c } from "@/lib/flota/combustible-c2c-shared";

const input = "rounded border border-[var(--border)] bg-[var(--input)] p-2 text-xs";
const boton = "rounded border border-[var(--border)] px-2 py-1 text-xs font-medium hover:bg-[var(--input)] disabled:opacity-50";
const ETIQUETA: Record<EstadoC2c, string> = {
  PENDIENTE: "Pendiente", COINCIDENCIA_EXACTA: "Exacta", COINCIDENCIA_CON_DIFERENCIAS: "Con diferencias", SIN_VALE_INTERNO: "Sin vale interno",
  VALE_INTERNO_SIN_REPORTE: "Vale sin reporte", AMBIGUA: "Ambigua", DESCARTADA_MANUAL: "Descartada",
};
const COLOR: Record<EstadoC2c, string> = {
  PENDIENTE: "text-[var(--muted)]", COINCIDENCIA_EXACTA: "text-emerald-300", COINCIDENCIA_CON_DIFERENCIAS: "text-amber-300", SIN_VALE_INTERNO: "text-rose-300",
  VALE_INTERNO_SIN_REPORTE: "text-rose-300", AMBIGUA: "text-orange-300", DESCARTADA_MANUAL: "text-[var(--muted)]",
};
type Vale = { id: number; numeroVale: string; placa: string | null; fechaConsumo: string | null; galones: string; monto: string; precio: string | null; estado: string; estacion: string | null; fondo: Record<string, unknown> | null; sugerido?: boolean };
type Fila = {
  id: number; hoja: string; filaExcel: number; posibleDuplicado: boolean; duplicadoPrevio: boolean; estado: EstadoC2c; modo: string | null; confirmado: boolean;
  proveedor: { vale: string; placa: string; fechaReporte: string | null; galones: string | null; precio: string | null; total: string | null; piloto: string };
  vale: Vale | null; diferencias: Diferencia[]; candidatos: number; motivo: string | null;
};
type Lista = { importacion: { id: number; proveedor: string; archivo: string }; resumen: Record<string, number>; totalReal: number; filas: Fila[] };
type Candidato = Vale & { disponible: boolean; diferencias: Diferencia[] };
type SinReporte = { id: number; numeroVale: string; placa: string | null; fechaConsumo: string | null; galones: string; monto: string; estado: string; estacion: string | null };
type Importacion = { id: number; archivo: string; proveedor: string };

export function Badges({ diferencias }: { diferencias: Diferencia[] }) {
  if (!diferencias.length) return <span className="text-[var(--muted)]">—</span>;
  return <div className="flex flex-wrap gap-1">{diferencias.map(d => (
    <span key={d.campo} className={`rounded border px-1 ${d.tipo === "DISTINTA" ? "border-amber-500 text-amber-300" : "border-[var(--border)] text-[var(--muted)]"}`}
      title={`Proveedor: ${d.proveedor ?? "—"} · Interno: ${d.interno ?? "—"}`}>{etiquetaDiferencia(d)}<small className="block">{d.proveedor ?? "—"} → {d.interno ?? "—"}</small></span>
  ))}</div>;
}

export function CombustibleConciliacionProveedor({ slug, puedeConciliar }: { slug: string; puedeConciliar: boolean }) {
  const base = `/api/empresas/${slug}/flota/combustible`;
  const [importaciones, setImportaciones] = useState<Importacion[]>([]), [importacionId, setImportacionId] = useState(""), [vista, setVista] = useState<"filas" | "sin-reporte">("filas");
  const [estado, setEstado] = useState(""), [busqueda, setBusqueda] = useState(""), [data, setData] = useState<Lista | null>(null), [sin, setSin] = useState<SinReporte[]>([]);
  const [fSin, setFSin] = useState({ desde: "", hasta: "", estado: "", placa: "" });
  const [error, setError] = useState(""), [aviso, setAviso] = useState(""), [busy, setBusy] = useState(false);
  const [abierta, setAbierta] = useState<Fila | null>(null), [cands, setCands] = useState<Candidato[]>([]), [q, setQ] = useState(""), [motivo, setMotivo] = useState("");

  useEffect(() => { fetch(`${base}/importaciones`).then(r => r.json()).then(d => setImportaciones(d.items ?? [])).catch(() => setError("No se pudieron cargar las importaciones.")); }, [base]);
  const [version, setVersion] = useState(0);
  const cargar = useCallback(async () => { setVersion(v => v + 1); }, []);
  useEffect(() => {
    if (vista !== "filas" || !importacionId) return;
    const ac = new AbortController();
    const sp = new URLSearchParams(); if (estado) sp.set("estado", estado); if (busqueda) sp.set("q", busqueda);
    fetch(`${base}/importaciones/${importacionId}/conciliacion?${sp}`, { signal: ac.signal })
      .then(async r => ({ ok: r.ok, d: await r.json() }))
      .then(({ ok, d }) => { if (ac.signal.aborted) return; if (ok) setData(d); else setError(d.error ?? "No se pudo cargar la conciliación."); })
      .catch(() => { if (!ac.signal.aborted) setError("No se pudo cargar la conciliación."); });
    return () => ac.abort();
  }, [base, importacionId, estado, busqueda, vista, version]);
  useEffect(() => {
    if (vista !== "sin-reporte") return;
    const ac = new AbortController();
    const sp = new URLSearchParams(); for (const [k, v] of Object.entries(fSin)) if (v) sp.set(k, v);
    fetch(`${base}/conciliacion-proveedor/vales-sin-reporte?${sp}`, { signal: ac.signal })
      .then(async r => ({ ok: r.ok, d: await r.json() }))
      .then(({ ok, d }) => { if (ac.signal.aborted) return; if (ok) setSin(d.vales); else setError(d.error ?? "No se pudieron cargar los vales."); })
      .catch(() => { if (!ac.signal.aborted) setError("No se pudieron cargar los vales."); });
    return () => ac.abort();
  }, [base, fSin, vista]);

  async function post(url: string, body?: unknown) {
    setBusy(true); setError(""); setAviso("");
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error ?? "No se pudo completar la acción."); if (r.status === 409) await cargar(); return false; }
      return d;
    } finally { setBusy(false); }
  }
  async function recalcular() {
    const d = await post(`${base}/importaciones/${importacionId}/conciliacion`);
    if (d) { setAviso(`Recalculado: ${d.exactas} exactas · ${d.conDiferencias} con diferencias · ${d.sinVale} sin vale · ${d.ambiguas} ambiguas · ${d.manualesConservadas} manuales conservadas.`); await cargar(); }
  }
  async function accion(f: Fila, body: Record<string, unknown>) {
    const d = await post(`${base}/conciliacion-proveedor/filas/${f.id}`, { ...body, esperado: { estado: f.estado === "PENDIENTE" ? null : f.estado, cargaVinculadaId: f.vale && !f.vale.sugerido ? f.vale.id : null } });
    if (d) { setAbierta(null); await cargar(); }
  }
  async function abrir(f: Fila, texto = "") {
    setAbierta(f); setQ(texto); setMotivo("");
    const r = await fetch(`${base}/conciliacion-proveedor/filas/${f.id}?q=${encodeURIComponent(texto)}`), d = await r.json();
    setCands(r.ok ? d.candidatos : []);
  }
  const r = data?.resumen ?? {};
  const contador = (t: string, n: number) => <div key={t} className="rounded border border-[var(--border)] p-2 text-center"><strong className="block text-lg">{n}</strong><small>{t}</small></div>;

  return <section className="space-y-3">
    <p className="text-xs text-[var(--muted)]">Compara los reportes del proveedor con los vales internos por proveedor + número de vale. La fecha del reporte no certifica consumo y el piloto es solo informativo. Nada de esto modifica los vales.</p>
    <div className="flex flex-wrap items-end gap-2">
      <label className="text-xs">Importación<select className={`${input} block`} value={importacionId} onChange={e => { setImportacionId(e.target.value); setEstado(""); setBusqueda(""); }}>
        <option value="">Selecciona…</option>{importaciones.map(i => <option key={i.id} value={i.id}>#{i.id} · {i.proveedor} · {i.archivo}</option>)}</select></label>
      <button type="button" className={boton} onClick={() => setVista("filas")} aria-pressed={vista === "filas"}>Filas del reporte</button>
      <button type="button" className={boton} onClick={() => setVista("sin-reporte")} aria-pressed={vista === "sin-reporte"}>Vales internos sin reporte</button>
      {puedeConciliar && importacionId && <button type="button" className={boton} disabled={busy} onClick={recalcular}>Recalcular conciliación</button>}
    </div>
    {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
    {aviso && <p role="status" className="text-xs text-emerald-300">{aviso}</p>}

    {vista === "filas" && data && <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {contador("Exactas", r.COINCIDENCIA_EXACTA ?? 0)}{contador("Con diferencias", r.COINCIDENCIA_CON_DIFERENCIAS ?? 0)}{contador("Sin vale interno", r.SIN_VALE_INTERNO ?? 0)}
        {contador("Ambiguas", r.AMBIGUA ?? 0)}{contador("Pendientes", r.PENDIENTE ?? 0)}
      </div>
      <div className="flex flex-wrap gap-2">
        <select className={input} aria-label="Resultado" value={estado} onChange={e => setEstado(e.target.value)}>
          <option value="">Todos los resultados</option>{ESTADOS_C2C.filter(e => e !== "VALE_INTERNO_SIN_REPORTE").map(e => <option key={e} value={e}>{ETIQUETA[e]}</option>)}</select>
        <input className={input} placeholder="Buscar vale o placa" value={busqueda} onChange={e => setBusqueda(e.target.value)} />
      </div>
      <div className="overflow-auto"><table className="w-full text-xs"><thead><tr>{["Proveedor", "Importación", "Hoja/fila", "Vale proveedor", "Vale interno", "Placa prov. / int.", "Fecha reporte", "Fecha consumo", "Galones", "Monto", "Resultado", "Diferencias", "Acciones"].map(t => <th key={t} className="p-2 text-left">{t}</th>)}</tr></thead>
        <tbody>{data.filas.map(f => <tr key={f.id} className="border-t border-[var(--border)] align-top">
          <td className="p-2">{data.importacion.proveedor}</td><td>#{data.importacion.id}</td><td>{f.hoja} / {f.filaExcel}</td>
          <td>{f.proveedor.vale}{(f.posibleDuplicado || f.duplicadoPrevio) && <small className="block text-amber-300">Posible duplicado</small>}</td>
          <td>{f.vale ? <>{f.vale.numeroVale}{f.vale.sugerido && <small className="block text-amber-300">Sugerido: requiere revisión</small>}<small className="block">{f.vale.estado}{f.vale.estacion ? ` · ${f.vale.estacion}` : ""}</small>{f.vale.fondo && <small className="block text-[var(--muted)]">Fondo: {JSON.stringify(f.vale.fondo)}</small>}</> : f.estado === "AMBIGUA" ? `${f.candidatos} candidatos` : "—"}</td>
          <td>{f.proveedor.placa || "—"} / {f.vale?.placa ?? "—"}</td><td>{f.proveedor.fechaReporte ?? "—"}</td><td>{f.vale?.fechaConsumo ?? "—"}</td>
          <td>{f.proveedor.galones ?? "—"}{f.vale && <small className="block">int. {f.vale.galones}</small>}</td><td>{f.proveedor.total ?? "—"}{f.vale && <small className="block">int. {f.vale.monto}</small>}</td>
          <td className={COLOR[f.estado]}>{ETIQUETA[f.estado]}{f.modo === "MANUAL" && <small className="block">Manual</small>}{f.motivo && f.estado === "AMBIGUA" && <small className="block">{f.motivo}</small>}</td>
          <td><Badges diferencias={f.diferencias} /></td>
          <td>{puedeConciliar && <button type="button" className={boton} onClick={() => abrir(f)}>{f.estado === "COINCIDENCIA_EXACTA" ? "Cambiar" : "Revisar"}</button>}</td>
        </tr>)}</tbody></table></div>
      <p className="text-xs text-[var(--muted)]">{data.totalReal} filas canónicas.</p>
    </>}

    {abierta && <div role="dialog" aria-label="Conciliación manual" className="space-y-2 rounded border border-[var(--border)] p-3 text-xs">
      <h4 className="font-semibold">Fila {abierta.hoja}/{abierta.filaExcel} · vale {abierta.proveedor.vale}</h4>
      <p>Proveedor: placa {abierta.proveedor.placa || "—"} · fecha {abierta.proveedor.fechaReporte ?? "—"} · {abierta.proveedor.galones ?? "—"} gal · Q{abierta.proveedor.total ?? "—"} · piloto (informativo) {abierta.proveedor.piloto || "—"}</p>
      <div className="flex gap-2"><input className={input} placeholder="Buscar vale interno o placa" value={q} onChange={e => setQ(e.target.value)} /><button type="button" className={boton} onClick={() => abrir(abierta, q)}>Buscar</button></div>
      <table className="w-full"><tbody>{cands.map(c => <tr key={c.id} className="border-t border-[var(--border)] align-top">
        <td className="p-1">{c.numeroVale}<small className="block">{c.estado}{c.estacion ? ` · ${c.estacion}` : ""}</small></td><td>{c.placa ?? "—"}</td><td>{c.fechaConsumo ?? "—"}</td><td>{c.galones} gal · Q{c.monto}</td>
        <td><Badges diferencias={c.diferencias} /></td>
        <td>{c.disponible ? <button type="button" className={boton} disabled={busy} onClick={() => accion(abierta, { accion: "confirmar", cargaId: c.id })}>{c.diferencias.some(d => d.tipo === "DISTINTA") ? "Confirmar con diferencias" : "Confirmar"}</button> : <small>Ya conciliado con otra fila</small>}</td>
      </tr>)}</tbody></table>
      {!cands.length && <p className="text-[var(--muted)]">Sin candidatos para esta búsqueda.</p>}
      <div className="flex flex-wrap items-center gap-2">
        {abierta.vale && !abierta.vale.sugerido && <button type="button" className={boton} disabled={busy} onClick={() => accion(abierta, { accion: "quitar" })}>Quitar vínculo</button>}
        <input className={input} placeholder="Motivo del descarte" value={motivo} onChange={e => setMotivo(e.target.value)} />
        <button type="button" className={boton} disabled={busy || motivo.trim().length < 3} onClick={() => accion(abierta, { accion: "descartar", motivo })}>Descartar</button>
        {abierta.modo === "MANUAL" && <button type="button" className={boton} disabled={busy} onClick={() => accion(abierta, { accion: "restablecer" })}>Restablecer a automático</button>}
        <button type="button" className={boton} onClick={() => setAbierta(null)}>Cerrar</button>
      </div>
    </div>}

    {vista === "sin-reporte" && <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <label className="text-xs">Consumo desde<input type="date" className={`${input} block`} value={fSin.desde} onChange={e => setFSin({ ...fSin, desde: e.target.value })} /></label>
        <label className="text-xs">hasta<input type="date" className={`${input} block`} value={fSin.hasta} onChange={e => setFSin({ ...fSin, hasta: e.target.value })} /></label>
        <select className={input} aria-label="Estado del vale" value={fSin.estado} onChange={e => setFSin({ ...fSin, estado: e.target.value })}><option value="">Todos los estados</option><option>PENDIENTE</option><option>APROBADO</option><option>RECHAZADO</option></select>
        <input className={input} placeholder="Unidad / placa" value={fSin.placa} onChange={e => setFSin({ ...fSin, placa: e.target.value })} />
      </div>
      <p className="text-xs text-[var(--muted)]">El rango filtra por fecha de consumo del vale (no por fecha de reporte).</p>
      <table className="w-full text-xs"><thead><tr>{["Vale", "Placa", "Fecha consumo", "Galones", "Monto", "Estado", "Estación"].map(t => <th key={t} className="p-2 text-left">{t}</th>)}</tr></thead>
        <tbody>{sin.map(v => <tr key={v.id} className="border-t border-[var(--border)]"><td className="p-2">{v.numeroVale}</td><td>{v.placa ?? "—"}</td><td>{v.fechaConsumo ?? "—"}</td><td>{v.galones}</td><td>Q{v.monto}</td><td>{v.estado}</td><td>{v.estacion ?? "—"}</td></tr>)}</tbody></table>
    </div>}
  </section>;
}
