"use client";
import { useState } from "react";
import { jsonCB2, type CatalogosCB2 } from "./client";
import { input, button } from "./controles";
export function TercerosCB2({ api, cat, admin, recargar, actorId }: { api: string; cat: CatalogosCB2; admin: boolean; recargar: () => void; actorId?: number }) {
  const [error, setError] = useState(""), [mensaje, setMensaje] = useState(""), [busy, setBusy] = useState(false), [busqueda, setBusqueda] = useState("");
  const pasos = <ol className="list-decimal space-y-2 pl-5"><li>Buscar primero la identidad y unidad existentes para evitar duplicados.</li><li>Registrar las referencias estables del piloto y del vehículo o motocicleta; queda PENDIENTE.</li><li>Otro responsable verifica la asociación y su respaldo.</li><li>Las próximas importaciones reconocen la asociación verificada cuando el nombre y la placa son únicos y compatibles. Homónimos, contradicciones y revocaciones requieren revisión manual.</li></ol>;
  if (!cat.tercerosHabilitados) return <section aria-label="Tercerizados y verificación" className="space-y-4"><h2 className="text-lg font-semibold">Pilotos y unidades tercerizadas</h2><p role="status" className="rounded border border-amber-600 p-3">Política D2 aprobada. Tercerizados deshabilitados por configuración; la activación corresponde al propietario después del merge.</p><h3>Registro y verificación al habilitar el módulo</h3>{pasos}<p>No se crean empleados ni vehículos propios. El registro real se realiza desde esta pantalla cuando el módulo esté habilitado.</p></section>;
  async function enviar(body: object, method: string) {
    if (busy) return; setBusy(true); setError(""); setMensaje("");
    try { const r = await jsonCB2<{ id: number; existente?: boolean; estado?: string }>(`${api}/terceros`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); setMensaje(method === "POST" ? r.existente ? `Asociación #${r.id} existente; no se duplicó. Consulta su estado.` : `Asociación #${r.id} PENDIENTE. Debe verificarla otro administrador con una cuenta distinta.` : `Asociación #${r.id}: ${r.estado}. Vuelve a analizar el Excel para actualizar el reconocimiento.`); recargar(); }
    catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar."); }
    finally { setBusy(false); }
  }
  return <section aria-label="Tercerizados y verificación" className="space-y-4"><h2 className="text-lg font-semibold">Pilotos y unidades tercerizadas</h2>{pasos}<p>Referencia estable de piloto y de unidad: no usar solo el nombre o la placa como identidad. Verificación por otro responsable; no se vincula a empleados.</p>
    <button type="button" className={button} disabled={busy} onClick={recargar}>Actualizar asociaciones</button>{mensaje && <p role="status">{mensaje}</p>}
    <label>Buscar tercero<input className={input} value={busqueda} onChange={e => setBusqueda(e.target.value)}/></label>
    <ul>{(cat.terceros ?? []).filter(a => `${a.nombre} ${a.placa} ${a.piloto_referencia} ${a.unidad_referencia}`.toLocaleLowerCase().includes(busqueda.toLocaleLowerCase())).map(a => {
      const puedeVerificar = !!actorId && !!a.creado_por && a.creado_por !== actorId;
      return <li key={a.id}>{a.nombre} · piloto #{a.piloto_id} · {a.placa} · {a.tipo} · unidad #{a.unidad_id} · {a.relacion} · {a.estado}
      <p>Creado por administrador #{a.creado_por ?? "No disponible"} · Verificado por #{a.verificado_por ?? "Pendiente"}</p>
      {!puedeVerificar && admin && <p>No puedes verificar esta asociación con la cuenta creadora. Cambiar de sesión con la misma cuenta no cambia su ID.</p>}
      {admin && <form key={`${a.id}:${a.revision}:${actorId}`} onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); if (f.get("estado") === "VERIFICADA" && !puedeVerificar) { setError("La verificación exige otro administrador distinto del creador."); return; } void enviar({ proveedorId: Number(f.get("proveedorId")), id: a.id, revision: a.revision, estado: f.get("estado") }, "PATCH"); }}><label>Proveedor para revisión #{a.id}<select name="proveedorId" required className={input}>{cat.proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label><label>Nuevo estado de asociación #{a.id}<select name="estado" className={input} defaultValue={puedeVerificar ? "VERIFICADA" : "REVOCADA"}><option disabled={!puedeVerificar}>VERIFICADA</option><option>REVOCADA</option></select></label><button className={button} disabled={busy}>Revisar asociación #{a.id}</button></form>}</li>;
    })}</ul>
    {admin && <form className="space-y-2" onSubmit={e => { e.preventDefault(); const datos = Object.fromEntries(new FormData(e.currentTarget)); void enviar({ ...datos, proveedorId: Number(datos.proveedorId) }, "POST"); }}>
      <label>Proveedor para contexto<select className={input} name="proveedorId" required>{cat.proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label>
      {[["pilotoReferencia", "Referencia estable del piloto"], ["nombre", "Nombre del piloto"], ["unidadReferencia", "Referencia estable de unidad"], ["placa", "Placa"], ["descripcion", "Descripción de unidad"], ["evidencia", "Referencia de verificación"]].map(([name, label]) => <label key={name}>{label}<input className={input} name={name} required maxLength={160}/></label>)}
      <label>Tipo<select className={input} name="tipo"><option>VEHICULO</option><option>MOTOCICLETA</option></select></label><label>Relación<select className={input} name="relacion"><option>CONTRATISTA</option><option>INDEPENDIENTE</option><option>TERCERIZADO</option></select></label>
      <button className={button} disabled={busy}>Registrar identidad pendiente</button>
    </form>}{error && <p role="alert">{error}</p>}
  </section>;
}
