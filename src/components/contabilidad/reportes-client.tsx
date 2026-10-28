"use client";

import { useEffect, useState } from "react";
import {SelectorPeriodoReporte,ResumenPeriodoReporte,type OpcionPeriodo} from "./reporte-periodo";
import type {PeriodoReporte} from "@/lib/contabilidad/reportes/periodo";
import { NOTA_SALDO_ACUMULADO } from "@/lib/contabilidad/reportes/calculo";

type Entidad = { id: number; codigo: string; nombre: string; activa: number };
type Cuenta = { id: number; codigo: string; nombre: string };
type Vista = "diario" | "mayor" | "balance";

const campo = "min-h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] p-2 text-sm text-[var(--text)] disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-[var(--accent)]";
const boton = "rounded border border-[var(--border)] px-3 py-1 text-sm hover:bg-[var(--input)] disabled:opacity-50";
const q = (n: string) => Number(n).toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type DiarioApi = {
  totalAsientos: number; page: number; pageSize: number;
  asientos: { id: number; numero: string; fecha: string; glosa: string | null; usuario: string | null; totalDebe: string; totalHaber: string; cuadra: boolean;
    lineas: { cuentaId: number; codigo: string | null; cuenta: string | null; debe: string; haber: string }[] }[];
  totalesRango: { debe: string; haber: string; diferencia: string; asientosDescuadrados: number };
};
type MayorApi = {
  cuenta: { codigo: string; nombre: string }; nota: string;
  movimientos: { asientoId: number; numero: string; fecha: string; glosa: string | null; debe: string; haber: string; saldo: string }[];
  totales: { debe: string; haber: string; saldoFinal: string };
};
type BalanceApi = {
  filas: { cuentaId: number; codigo: string; nombre: string; debito: string; credito: string; saldoDeudor: string; saldoAcreedor: string }[];
  totales: { totalDebe: string; totalHaber: string; diferencia: string; totalSaldoDeudor: string; totalSaldoAcreedor: string; cuadra: boolean };
};

export function ReportesContablesClient(props: {slug:string;puedeDiario:boolean;puedeMayor:boolean;puedeBalance:boolean}) { return <ReportesLibro key={props.slug} {...props}/>; }
function ReportesLibro({ slug, puedeDiario, puedeMayor, puedeBalance }: { slug: string; puedeDiario: boolean; puedeMayor: boolean; puedeBalance: boolean }) {
  const base = `/api/empresas/${slug}/contabilidad/reportes`;
  const [entidades, setEntidades] = useState<Entidad[]>([]);
  const [entidadId, setEntidadId] = useState("");
  const [opciones,setOpciones]=useState<{entidadId:string;cuentas:Cuenta[];periodos:OpcionPeriodo[];calendarioDisponible:boolean}>();
  const cuentas=opciones?.entidadId===entidadId?opciones.cuentas:[];
  const periodos=opciones?.entidadId===entidadId?opciones.periodos:[];
  const cargandoOpciones=!!entidadId&&opciones?.entidadId!==entidadId;

  const [vista, setVista] = useState<Vista>(puedeDiario ? "diario" : puedeMayor ? "mayor" : "balance");
  const [f, setF] = useState({ periodo: "", desde: "", hasta: "", numero: "", cuentaId: "", sinMovimiento: false });
  const [page, setPage] = useState(1);
  // El resultado queda ligado a la consulta que lo produjo: al cambiar filtros se descarta solo (sin setState síncrono en el efecto).
  const [resultado, setResultado] = useState<{ clave: string; datos?: unknown; error?: string } | null>(null);
  const [errorOpciones, setErrorOpciones] = useState("");

  useEffect(() => {
    const ac = new AbortController();
    fetch(`${base}/opciones${entidadId ? `?entidad=${entidadId}` : ""}`, { cache: "no-store", signal: ac.signal }).then(async r => ({ ok: r.ok, d: await r.json() }))
      .then(({ ok, d }) => {
        if (ac.signal.aborted) return;
        if (!ok) return setErrorOpciones(d.error ?? "No se pudieron cargar las opciones.");
        setErrorOpciones("");setEntidades(d.entidades); setOpciones({entidadId,cuentas:d.cuentas,periodos:d.periodos??[],calendarioDisponible:d.calendarioDisponible!==false});
        if (!entidadId && d.entidades.filter((e: Entidad) => Number(e.activa) === 1).length === 1) setEntidadId(String(d.entidades.find((e: Entidad) => Number(e.activa) === 1).id));
      }).catch(() => { if (!ac.signal.aborted) setErrorOpciones("No se pudieron cargar las opciones."); });
    return () => ac.abort();
  }, [base, entidadId]);

  const periodoElegido=periodos.find(p=>String(p.id)===f.periodo);
  const listo = !!entidadId && !cargandoOpciones && (!f.periodo||!!periodoElegido) && (vista !== "mayor" || !!f.cuentaId);
  const consulta = (formato?: string) => {
    const sp = new URLSearchParams({ entidad: entidadId });
    if (f.desde) sp.set("desde", f.desde);
    if (f.hasta) sp.set("hasta", f.hasta);
    if (vista === "diario") { if (f.numero.trim()) sp.set("numero", f.numero.trim()); sp.set("page", String(page)); }
    if (vista === "mayor") sp.set("cuentaId", f.cuentaId);
    if (vista === "balance" && f.sinMovimiento) sp.set("sinMovimiento", "1");
    if (formato) sp.set("formato", formato);
    return `${base}/${vista}?${sp}`;
  };
  const clave = listo ? consulta() : "";
  useEffect(() => {
    if (!clave) return;
    const ac = new AbortController();
    fetch(clave, { cache: "no-store", signal: ac.signal }).then(async r => ({ ok: r.ok, d: await r.json() }))
      .then(({ ok, d }) => { if (!ac.signal.aborted) setResultado(ok ? { clave, datos: d } : { clave, error: d.error ?? "No se pudo generar el reporte." }); })
      .catch(() => { if (!ac.signal.aborted) setResultado({ clave, error: "No se pudo generar el reporte." }); });
    return () => ac.abort();
  }, [clave]);

  const cambiar = (k: keyof typeof f) => (e: { target: { value: string } }) => { setF({ ...f, [k]: e.target.value }); setPage(1); };
  const pestana = (v: Vista, texto: string, permitido: boolean) => permitido && <button type="button" className={boton} aria-pressed={vista === v} onClick={() => { setVista(v); setPage(1); }}>{texto}</button>;
  const actual = resultado?.clave === clave && clave ? resultado : null;
  const d = (actual?.datos ?? null) as (DiarioApi & MayorApi & BalanceApi & {periodoSeleccionado?:PeriodoReporte|null}) | null;
  const error = errorOpciones || actual?.error || "";
  const cargando = !!clave && !actual;

  return <div className="space-y-4 p-4">
    <h1 className="text-2xl font-semibold">Reportes contables</h1>
    <p className="text-sm text-[var(--muted)]">Salen únicamente de los asientos registrados (cont_asientos y su detalle) y del catálogo de cuentas de la entidad. No usan CxC, CxP ni Facturación.</p>
    <label className="block text-sm">Libro contable (entidad)
      <select className={`${campo} ml-2`} aria-label="Entidad" value={entidadId} onChange={e => { setEntidadId(e.target.value); setF({ ...f, cuentaId: "", periodo:"",desde:"",hasta:"" }); setPage(1); }}>
        <option value="">Seleccionar entidad</option>{entidades.map(e => <option key={e.id} value={e.id}>{e.codigo} — {e.nombre}{Number(e.activa) === 1 ? "" : " (inactiva)"}</option>)}
      </select></label>
    <div className="flex flex-wrap gap-2">{pestana("diario", "Diario", puedeDiario)}{pestana("mayor", "Mayor", puedeMayor)}{pestana("balance", "Balance de comprobación", puedeBalance)}</div>
    <div className="grid gap-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 sm:grid-cols-2 xl:grid-cols-3">
      <SelectorPeriodoReporte periodos={periodos} value={f.periodo} disabled={!entidadId||cargandoOpciones} onChange={periodo=>{setF({...f,periodo,desde:"",hasta:""});setPage(1);}}/>
      <label className="text-xs">Desde<input type="date" className={`${campo} block`} value={periodoElegido?.fechaInicio??f.desde} disabled={!!f.periodo} onChange={cambiar("desde")} /></label>
      <label className="text-xs">Hasta<input type="date" className={`${campo} block`} value={periodoElegido?.fechaFin??f.hasta} disabled={!!f.periodo} onChange={cambiar("hasta")} /></label>
      {vista === "diario" && <input className={campo} placeholder="Número de asiento (exacto)" value={f.numero} onChange={cambiar("numero")} />}
      {vista === "mayor" && <select className={campo} aria-label="Cuenta" value={f.cuentaId} onChange={cambiar("cuentaId")}><option value="">Seleccionar cuenta</option>{cuentas.map(c => <option key={c.id} value={c.id}>{c.codigo} — {c.nombre}</option>)}</select>}
      {vista === "balance" && <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={f.sinMovimiento} onChange={e => { setF({ ...f, sinMovimiento: e.target.checked }); setPage(1); }} />Incluir cuentas sin movimientos</label>}
      <a className={`${boton} ${listo ? "" : "pointer-events-none opacity-50"}`} href={listo ? consulta("xlsx") : undefined} aria-disabled={!listo}>Exportar Excel</a>
    </div>
    {cargandoOpciones&&<p role="status" className="text-sm text-[var(--muted)]">Cargando cuentas y per?odos del libro?</p>}
    {opciones?.entidadId===entidadId&&!opciones.calendarioDisponible&&<p role="note" className="rounded-lg border border-[var(--border)] p-3 text-sm">Calendario no disponible. Puedes consultar por fechas manuales; la selecci?n de per?odos requiere el esquema C3C-2.</p>}
    {d?.periodoSeleccionado&&<ResumenPeriodoReporte periodo={d.periodoSeleccionado}/>}
    {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
    {!entidadId && <p className="text-sm">Selecciona una entidad para consultar.</p>}
    {entidadId && vista === "mayor" && !f.cuentaId && <p className="text-sm">Selecciona una cuenta.</p>}
    {cargando && <p className="text-sm text-[var(--muted)]">Cargando…</p>}

    {d && vista === "diario" && <section className="space-y-3">
      {d.totalesRango.asientosDescuadrados > 0 && <p role="alert" className="text-sm text-red-500">Atención: {d.totalesRango.asientosDescuadrados} asiento(s) del rango no cuadran. Revisa los marcados.</p>}
      {d.asientos.map(a => <div key={a.id} className="rounded border border-[var(--border)] p-2">
        <p className="text-sm font-medium">{a.fecha} · {a.numero}{a.glosa ? ` · ${a.glosa}` : ""}{a.usuario ? <small className="text-[var(--muted)]"> · {a.usuario}</small> : null}</p>
        <table className="w-full text-sm"><thead><tr><th className="p-1 text-left">Cuenta</th><th className="text-left">Nombre</th><th className="text-right">Debe</th><th className="text-right">Haber</th></tr></thead>
          <tbody>{a.lineas.map((l, i) => <tr key={i} className="border-t border-[var(--border)]"><td className="p-1">{l.codigo ?? "(sin cuenta)"}</td><td>{l.cuenta ?? "—"}</td><td className="text-right">{Number(l.debe) ? q(l.debe) : ""}</td><td className="text-right">{Number(l.haber) ? q(l.haber) : ""}</td></tr>)}
            <tr className="border-t border-[var(--border)] font-medium"><td className="p-1" colSpan={2}>Total del asiento {a.cuadra ? "" : "— NO CUADRA"}</td><td className="text-right">{q(a.totalDebe)}</td><td className="text-right">{q(a.totalHaber)}</td></tr></tbody></table>
      </div>)}
      {d.asientos.length === 0 && !cargando && <p className="text-sm">No hay asientos para este filtro.</p>}
      <p className="text-sm font-medium">Total del rango: Debe {q(d.totalesRango.debe)} · Haber {q(d.totalesRango.haber)} · Diferencia {q(d.totalesRango.diferencia)}</p>
      <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
        <button type="button" className={boton} disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</button>
        <span>{d.totalAsientos} asientos · página {page} de {Math.max(1, Math.ceil(d.totalAsientos / d.pageSize))}</span>
        <button type="button" className={boton} disabled={page >= Math.ceil(d.totalAsientos / d.pageSize)} onClick={() => setPage(page + 1)}>Siguiente</button>
      </div>
    </section>}

    {d && vista === "mayor" && <section className="space-y-3">
      <p className="text-sm font-medium">{d.cuenta.codigo} — {d.cuenta.nombre}</p>
      <p role="note" className="rounded border border-[var(--border)] p-2 text-xs text-[var(--muted)]">{d.nota ?? NOTA_SALDO_ACUMULADO}</p>
      <div className="overflow-auto"><table className="w-full text-sm"><thead><tr>{["Fecha", "Asiento", "Glosa", "Debe", "Haber", "Saldo acumulado"].map(t => <th key={t} className="p-2 text-left">{t}</th>)}</tr></thead>
        <tbody>{d.movimientos.map((m, i) => <tr key={i} className="border-t border-[var(--border)]"><td className="p-2">{m.fecha}</td><td>{m.numero}</td><td>{m.glosa ?? ""}</td><td>{Number(m.debe) ? q(m.debe) : ""}</td><td>{Number(m.haber) ? q(m.haber) : ""}</td><td className="font-medium">{q(m.saldo)}</td></tr>)}
          <tr className="border-t border-[var(--border)] font-medium"><td className="p-2" colSpan={3}>Totales</td><td>{q(d.totales.debe)}</td><td>{q(d.totales.haber)}</td><td>{q(d.totales.saldoFinal)}</td></tr></tbody></table></div>
      {d.movimientos.length === 0 && !cargando && <p className="text-sm">La cuenta no tiene movimientos en el rango.</p>}
    </section>}

    {d && vista === "balance" && <section className="space-y-3">
      <div className="overflow-auto"><table className="w-full text-sm"><thead><tr>{["Código", "Cuenta", "Débito", "Crédito", "Saldo deudor", "Saldo acreedor"].map(t => <th key={t} className="p-2 text-left">{t}</th>)}</tr></thead>
        <tbody>{d.filas.map(r => <tr key={r.cuentaId} className="border-t border-[var(--border)]"><td className="p-2">{r.codigo}</td><td>{r.nombre}</td><td>{q(r.debito)}</td><td>{q(r.credito)}</td><td>{Number(r.saldoDeudor) ? q(r.saldoDeudor) : ""}</td><td>{Number(r.saldoAcreedor) ? q(r.saldoAcreedor) : ""}</td></tr>)}
          <tr className="border-t border-[var(--border)] font-medium"><td className="p-2" colSpan={2}>Totales</td><td>{q(d.totales.totalDebe)}</td><td>{q(d.totales.totalHaber)}</td><td>{q(d.totales.totalSaldoDeudor)}</td><td>{q(d.totales.totalSaldoAcreedor)}</td></tr></tbody></table></div>
      {d.filas.length === 0 && !cargando && <p className="text-sm">No hay movimientos en el rango.</p>}
      <p className={`text-sm font-medium ${d.totales.cuadra ? "" : "text-red-500"}`} role={d.totales.cuadra ? undefined : "alert"}>Total debe {q(d.totales.totalDebe)} · Total haber {q(d.totales.totalHaber)} · Diferencia {q(d.totales.diferencia)}{d.totales.cuadra ? "" : " — NO CUADRA: revisa los asientos."}</p>
    </section>}
  </div>;
}
