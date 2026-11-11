"use client";
import { useEffect, useState } from "react";
import { CatalogoSearchSelect } from "@/components/tms/catalogo-search-select";
import type { CatalogosTerceros } from "@/lib/flota/cb2/terceros-model";
import { jsonCB2, type CatalogosCB2 } from "./client";
import { input, button } from "./controles";
const vacio: CatalogosTerceros = { pilotos: [], unidades: [], asociaciones: [] };
export function TercerosCB2({ api, cat, admin, recargar, actorId, activo = true }: { api: string; cat: CatalogosCB2; admin: boolean; recargar: () => void; actorId?: number; activo?: boolean }) {
  const [datos, setDatos] = useState<{ api: string; catalogos: CatalogosTerceros } | null>(null), [refresh, setRefresh] = useState(0);
  const [error, setError] = useState(""), [mensaje, setMensaje] = useState(""), [busy, setBusy] = useState(false);
  const [buscarPiloto, setBuscarPiloto] = useState(""), [buscarUnidad, setBuscarUnidad] = useState(""), [buscarAsociacion, setBuscarAsociacion] = useState("");
  const [pilotoId, setPilotoId] = useState(""), [unidadId, setUnidadId] = useState("");
  const catalogos = datos?.api === api ? datos.catalogos : vacio, cargado = datos?.api === api;
  useEffect(() => {
    if (!activo || !cat.tercerosHabilitados) return;
    const ac = new AbortController();
    jsonCB2<CatalogosTerceros>(`${api}/terceros`, { signal: ac.signal }).then(d => {
      if (!Array.isArray(d.pilotos) || !Array.isArray(d.unidades) || !Array.isArray(d.asociaciones)) throw Error("Catálogos de terceros incompletos.");
      if (!ac.signal.aborted) { setDatos({ api, catalogos: d }); setError(""); }
    }).catch(e => { if (!ac.signal.aborted) setError(e.message); });
    return () => ac.abort();
  }, [api, activo, cat.tercerosHabilitados, refresh]);
  function actualizar() { setRefresh(n => n + 1); recargar(); }
  async function enviar(body: object, method = "POST", entidad = "Asociación") {
    if (busy || !cargado) return; setBusy(true); setError(""); setMensaje("");
    try {
      const r = await jsonCB2<{ id: number; existente?: boolean; estado?: string }>(`${api}/terceros`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      setMensaje(method === "PATCH" ? `Asociación #${r.id}: ${r.estado}. Vuelve a analizar el Excel para actualizar el reconocimiento.` : `${entidad} #${r.id} ${r.existente ? "existente; no se duplicó" : entidad === "Piloto" ? "registrado" : "registrada"}.${entidad === "Asociación" && !r.existente ? " PENDIENTE: debe verificarla otro administrador con un ID distinto." : ""}`);
      actualizar();
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar."); }
    finally { setBusy(false); }
  }
  const contiene = (texto: string, busqueda: string) => texto.toLocaleLowerCase().includes(busqueda.trim().toLocaleLowerCase());
  if (!cat.tercerosHabilitados) return <section aria-label="Tercerizados y verificación"><h2>Pilotos, unidades y asociaciones tercerizadas</h2><p role="status">Política D2 aprobada. Tercerizados deshabilitados por configuración; la activación corresponde al propietario.</p><p>Registrar primero las identidades de la empresa y después relacionarlas. Otro administrador verifica cada asociación. No se crean empleados ni vehículos propios.</p></section>;
  return <section aria-label="Tercerizados y verificación" className="space-y-6"><h2 className="text-lg font-semibold">Tercerizados de la empresa</h2><p>Registra cada identidad una sola vez con una referencia real y estable. Un piloto puede usar varias unidades y una unidad puede tener varios pilotos; verifica cada asociación por separado.</p>
    <button type="button" className={button} disabled={busy} onClick={actualizar}>Actualizar catálogos de terceros</button>{!cargado && !error && <p role="status">Cargando catálogos…</p>}{mensaje && <p role="status">{mensaje}</p>}{error && <p role="alert">{error}</p>}
    <section aria-label="Pilotos tercerizados" className="space-y-3"><h3 className="font-semibold">Pilotos tercerizados</h3><label>Buscar piloto tercerizado<input className={input} value={buscarPiloto} onChange={e => setBuscarPiloto(e.target.value)}/></label>
      <ul>{catalogos.pilotos.filter(p => contiene(`${p.id} ${p.nombre} ${p.referencia}`, buscarPiloto)).map(p => <li key={p.id}>{p.nombre} · ID #{p.id} · Referencia: {p.referencia}</li>)}</ul>
      {admin && <form aria-label="Registrar piloto tercerizado" onSubmit={e => { e.preventDefault(); void enviar({ recurso: "PILOTO", ...Object.fromEntries(new FormData(e.currentTarget)) }, "POST", "Piloto"); }}><fieldset disabled={busy || !cargado}><label>Referencia estable del piloto<input className={input} name="referencia" required maxLength={160}/></label><label>Nombre del piloto<input className={input} name="nombre" required maxLength={160}/></label><button className={button}>Registrar piloto</button></fieldset></form>}
    </section>
    <section aria-label="Vehículos y motocicletas tercerizados" className="space-y-3"><h3 className="font-semibold">Vehículos y motocicletas tercerizados</h3><label>Buscar unidad tercerizada<input className={input} value={buscarUnidad} onChange={e => setBuscarUnidad(e.target.value)}/></label>
      <ul>{catalogos.unidades.filter(u => contiene(`${u.id} ${u.placa} ${u.referencia} ${u.tipo} ${u.descripcion}`, buscarUnidad)).map(u => <li key={u.id}>{u.placa} · {u.tipo} · ID #{u.id} · {u.descripcion} · Referencia: {u.referencia}</li>)}</ul>
      {admin && <form aria-label="Registrar unidad tercerizada" onSubmit={e => { e.preventDefault(); void enviar({ recurso: "UNIDAD", ...Object.fromEntries(new FormData(e.currentTarget)) }, "POST", "Unidad"); }}><fieldset disabled={busy || !cargado}><label>Referencia estable de unidad<input className={input} name="referencia" required maxLength={160}/></label><label>Placa<input className={input} name="placa" required maxLength={160}/></label><label>Tipo<select className={input} name="tipo"><option>VEHICULO</option><option>MOTOCICLETA</option></select></label><label>Descripción de unidad<input className={input} name="descripcion" required maxLength={160}/></label><button className={button}>Registrar unidad</button></fieldset></form>}
    </section>
    <section aria-label="Asociaciones tercerizadas" className="space-y-3"><h3 className="font-semibold">Asociaciones</h3><p>Selecciona identidades ya registradas. Admin A crea la asociación PENDIENTE; Admin B, con ID distinto, revisa el respaldo y verifica. El reconocimiento del Excel exige nombre + placa únicos y asociación VERIFICADA.</p>
      {admin && <form aria-label="Crear asociación tercerizada" onSubmit={e => { e.preventDefault(); if (!pilotoId || !unidadId) { setError("Selecciona un piloto y una unidad registrados."); return; } void enviar({ recurso: "ASOCIACION", pilotoId: Number(pilotoId), unidadId: Number(unidadId), ...Object.fromEntries(new FormData(e.currentTarget)) }); }}><fieldset disabled={busy || !cargado}>
        <CatalogoSearchSelect label="Piloto registrado" placeholder="Buscar nombre o referencia" value={pilotoId} onChange={setPilotoId} options={catalogos.pilotos.map(p => ({ value: String(p.id), label: p.nombre, detail: `#${p.id} · ${p.referencia}` }))} inputClassName={input}/>
        <CatalogoSearchSelect label="Unidad registrada" placeholder="Buscar placa o referencia" value={unidadId} onChange={setUnidadId} options={catalogos.unidades.map(u => ({ value: String(u.id), label: u.placa, detail: `#${u.id} · ${u.tipo} · ${u.referencia} · ${u.descripcion}` }))} inputClassName={input}/>
        <label>Relación<select className={input} name="relacion"><option>CONTRATISTA</option><option>INDEPENDIENTE</option><option>TERCERIZADO</option></select></label><label>Referencia del respaldo de la asociación<input className={input} name="evidencia" required maxLength={160}/></label><button className={button} disabled={!pilotoId || !unidadId}>Crear asociación pendiente</button></fieldset></form>}
      <label>Buscar asociación<input className={input} value={buscarAsociacion} onChange={e => setBuscarAsociacion(e.target.value)}/></label>
      <ul>{catalogos.asociaciones.filter(a => contiene(`${a.id} ${a.nombre} ${a.placa} ${a.estado} ${a.piloto_referencia} ${a.unidad_referencia}`, buscarAsociacion)).map(a => {
        const puedeVerificar = !!actorId && !!a.creado_por && a.creado_por !== actorId;
        return <li key={a.id} className="my-3">Asociación #{a.id}: {a.nombre} · piloto #{a.piloto_id} + {a.placa} · {a.tipo} · unidad #{a.unidad_id} · {a.relacion} · {a.estado}<p>Creado por administrador #{a.creado_por ?? "No disponible"} · Verificado por #{a.verificado_por ?? "Pendiente"}</p>
          {!puedeVerificar && admin && <p>No puedes autoverificar. Cambiar de sesión con la misma cuenta no cambia su ID.</p>}
          {admin && <form aria-label={`Revisar asociación ${a.id}`} key={`${a.id}:${a.revision}:${actorId}`} onSubmit={e => { e.preventDefault(); const estado = new FormData(e.currentTarget).get("estado"); if (estado === "VERIFICADA" && !puedeVerificar) { setError("La verificación exige otro administrador distinto del creador."); return; } void enviar({ id: a.id, revision: a.revision, estado }, "PATCH"); }}><fieldset disabled={busy || !cargado}><label>Nuevo estado de asociación #{a.id}<select className={input} name="estado" defaultValue={puedeVerificar ? "VERIFICADA" : "REVOCADA"}><option disabled={!puedeVerificar}>VERIFICADA</option><option>REVOCADA</option></select></label><button className={button}>Revisar asociación #{a.id}</button></fieldset></form>}</li>;
      })}</ul>
    </section>
  </section>;
}
