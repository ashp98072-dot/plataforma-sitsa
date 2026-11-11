"use client";
import { useEffect, useState } from "react";
import { diagnosticarBusqueda, disponibles, revisar, type Catalogo, type Conductor, type Vehiculo } from "./contratos";
import { catalogoSintetico } from "./fixtures";

// Solo harness de laboratorio. No importado por app/, sin handlers de escritura.
export function PrototipoExternos({ cargar = async () => catalogoSintetico }: { cargar?: (empresa: string) => Promise<Catalogo> }) {
  const [empresa, setEmpresa] = useState("A");
  return <section><h1>Laboratorio de identidades externas</h1><p>D1–D5 NO APROBADAS. Datos sintéticos; no registra consumos.</p>
    <label>Empresa<select value={empresa} onChange={e => setEmpresa(e.target.value)}><option>A</option><option>B</option></select></label>
    <Contexto key={empresa} empresa={empresa} cargar={cargar} />
  </section>;
}
function Contexto({ empresa, cargar }: { empresa: string; cargar: (empresa: string) => Promise<Catalogo> }) {
  const [respuesta, setRespuesta] = useState<{ catalogo?: Catalogo; error?: string }>({});
  const [conductor, setConductor] = useState<Conductor>({ tipo: "EMPLEADO", empleadoId: 0, metodo: "MANUAL", motivo: "Selección sintética en laboratorio" });
  const [vehiculo, setVehiculo] = useState<Vehiculo>({ tipo: "CATALOGO", vehiculoId: 0 });
  const [nombre, setNombre] = useState(""); const [placa, setPlaca] = useState("");
  useEffect(() => {
    let vigente = true;
    cargar(empresa).then(catalogo => { if (vigente) setRespuesta({ catalogo }); }, () => { if (vigente) setRespuesta({ error: "No se pudo cargar el catálogo simulado." }); });
    return () => { vigente = false; };
  }, [empresa, cargar]);
  if (respuesta.error) return <p role="alert">{respuesta.error}</p>;
  if (!respuesta.catalogo) return <p role="status">Cargando catálogo sintético…</p>;
  const cat = disponibles(respuesta.catalogo, empresa), revision = revisar(empresa, conductor, vehiculo, cat);
  const diagnosticosBusqueda = [...(nombre ? diagnosticarBusqueda(cat, empresa, "conductor", nombre) : []), ...(placa ? diagnosticarBusqueda(cat, empresa, "vehiculo", placa) : [])];
  return <div>
    <label>Tipo conductor<select value={conductor.tipo} onChange={e => setConductor(e.target.value === "EMPLEADO" ? { tipo: "EMPLEADO", empleadoId: 0, metodo: "MANUAL", motivo: "Selección sintética en laboratorio" } : e.target.value === "EXTERNO" ? { tipo: "EXTERNO", externoId: 0 } : { tipo: "NO_IDENTIFICADO", motivo: "SIN_DATO", observacion: "Pendiente sintético", responsable: "Revisor demo" })}><option>EMPLEADO</option><option>EXTERNO</option><option>NO_IDENTIFICADO</option></select></label>
    {conductor.tipo !== "NO_IDENTIFICADO" && <label>Identidad conductor<select value={conductor.tipo === "EMPLEADO" ? conductor.empleadoId : conductor.externoId} onChange={e => setConductor(conductor.tipo === "EMPLEADO" ? { tipo: "EMPLEADO", empleadoId: Number(e.target.value), metodo: "MANUAL", motivo: "Selección sintética en laboratorio" } : { tipo: "EXTERNO", externoId: Number(e.target.value) })}><option value={0}>Seleccione</option>{(conductor.tipo === "EMPLEADO" ? cat.empleados : cat.conductores).map(e => <option key={e.id} value={e.id}>{e.nombre} (#{e.id})</option>)}</select></label>}
    <label>Tipo vehículo<select value={vehiculo.tipo} onChange={e => setVehiculo(e.target.value === "CATALOGO" ? { tipo: "CATALOGO", vehiculoId: 0 } : { tipo: "EXTERNO", externoId: 0 })}><option>CATALOGO</option><option>EXTERNO</option></select></label>
    <label>Identidad vehículo<select value={vehiculo.tipo === "CATALOGO" ? vehiculo.vehiculoId : vehiculo.externoId} onChange={e => setVehiculo(vehiculo.tipo === "CATALOGO" ? { tipo: "CATALOGO", vehiculoId: Number(e.target.value) } : { tipo: "EXTERNO", externoId: Number(e.target.value) })}><option value={0}>Seleccione</option>{(vehiculo.tipo === "CATALOGO" ? cat.unidades.map(e => ({ id: e.id, nombre: e.placa })) : cat.vehiculos).map(e => <option key={e.id} value={e.id}>{e.nombre} (#{e.id})</option>)}</select></label>
    <label>Buscar empleado<input value={nombre} onChange={e => setNombre(e.target.value)} /></label><label>Buscar placa<input value={placa} onChange={e => setPlaca(e.target.value)} /></label>
    <output aria-label="Resultado simulado">{revision.estado}</output>
    <section aria-label="Bloqueos de la selección actual" style={{ border: "2px solid #991b1b", padding: "0.75rem" }}>
      <h2>Bloqueos de la selección actual</h2>
      {revision.diagnosticos.length ? <ul>{revision.diagnosticos.map((d, i) => <li key={`${d.codigo}-${i}`} data-codigo={d.codigo}><strong>Bloqueo:</strong> {d.mensaje}</li>)}</ul> : <p>Sin bloqueos en la simulación. Esto no constituye autorización real.</p>}
    </section>
    <aside aria-label="Información de búsqueda" style={{ border: "1px dashed #1e40af", padding: "0.75rem" }}>
      <h2>Información de búsqueda</h2>
      <p>Estos avisos describen la consulta y no cambian la validación de la selección actual.</p>
      {diagnosticosBusqueda.length ? <ul>{diagnosticosBusqueda.map((d, i) => <li key={`${d.codigo}-${i}`} data-codigo={d.codigo}><strong>Información:</strong> {d.mensaje}</li>)}</ul> : <p>Sin avisos de búsqueda.</p>}
    </aside>
    <button type="button" disabled>Confirmar no disponible en laboratorio</button>
  </div>;
}
