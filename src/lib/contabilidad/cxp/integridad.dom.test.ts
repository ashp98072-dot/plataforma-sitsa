// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { CxpIntegridad } from "@/components/contabilidad/cxp-integridad";
import { CxpClient } from "@/components/contabilidad/cxp-client";
import { CxpEstadoCuenta } from "@/components/contabilidad/cxp-estado-cuenta";
import { LIMITE_LINEAS, ROTULO_INTEGRIDAD, type RespuestaIntegridad } from "./integridad-shared";
import { desgloseFacturaLectura } from "./saldo-lectura";

let root:Root|undefined;
afterEach(async()=>{if(root)await act(async()=>root!.unmount());root=undefined;document.body.innerHTML="";vi.unstubAllGlobals();});
function mount(){vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);const node=document.createElement("div");document.body.append(node);root=createRoot(node);return node;}
function datos(extra:Partial<RespuestaIntegridad>={}):RespuestaIntegridad{
  const fin=desgloseFacturaLectura(1,"REGISTRADA",{totalDocumento:"112.00",isrMonto:"5.00",totalNetoPagar:"107.00"},"107.01");
  return {entidadId:5,filtros:{},facturasEnAmbito:10,facturasRevisadas:10,totalAdvertencias:1,facturasConAnomalias:1,porCodigo:{SOBREAPLICACION:1},
    filas:[{entidadId:5,facturaId:1,proveedorId:3,proveedor:"Proveedor QA",documento:"A-1",estadoAdmin:"REGISTRADA",montoPagadero:fin.montoPagadero,pagado:fin.pagado,excesoAplicado:fin.excesoAplicado,advertencia:fin.advertenciasIntegridad[0]}],
    page:1,pageSize:25,pagosVisibles:false,pagosDisponibles:true,limitaciones:["Sólo comprobaciones autorizadas."],rotulo:ROTULO_INTEGRIDAD,...extra};
}
it("renderiza importes exactos, advertencia y navegación a proveedor sin detalle de pagos",async()=>{
  const consultar=vi.fn();vi.stubGlobal("fetch",vi.fn(async()=>Response.json(datos())));const node=mount();
  await act(async()=>root!.render(createElement(CxpIntegridad,{slug:"qa",entidadId:"5",onConsultarProveedor:consultar})));
  expect(node.textContent).toContain("Facturas revisadas: 10 de 10");expect(node.textContent).toContain("SOBREAPLICACION");
  expect(node.textContent).toMatch(/Q\s107\.01/);expect(node.textContent).toMatch(/Q\s0\.01/);
  expect(node.textContent).toContain("no representan crédito ni saldo a favor");
  expect(node.querySelector('option[value="PAGO_DESCUADRADO"]')).toBeNull();
  const button=[...node.querySelectorAll("button")].find(b=>b.textContent==="Consultar proveedor")!;
  await act(async()=>button.click());expect(consultar).toHaveBeenCalledWith(3);
});
it("pagos autorizados se distinguen de facturas y reversos no suman a pagado vigente",async()=>{
  const response=datos({pagosVisibles:true,limitaciones:[LIMITE_LINEAS]});
  response.filas.push({entidadId:5,facturaId:null,proveedorId:4,proveedor:"Otro QA",documento:null,estadoAdmin:null,montoPagadero:null,pagado:null,excesoAplicado:null,
    advertencia:{codigo:"PAGO_DESCUADRADO",pagoId:99,mensaje:"Descuadre de pago",detalle:{}},pago:{id:99,estado:"REVERSADO",montoTotal:"10.01",sumaAplicaciones:"0.00",montoAplicado:null}});
  vi.stubGlobal("fetch",vi.fn(async()=>Response.json(response)));const node=mount();
  await act(async()=>root!.render(createElement(CxpIntegridad,{slug:"qa",entidadId:"5",onConsultarProveedor:vi.fn()})));
  expect(node.textContent).toContain("Sin factura individual");expect(node.textContent).toContain("REVERSADO (no suma al pagado vigente)");
  expect(node.textContent).toMatch(/Q\s10\.01/);expect(node.textContent).toContain(LIMITE_LINEAS);
  expect(node.querySelector('option[value="PAGADO_NO_COINCIDE_CON_LINEAS"]')?.hasAttribute("disabled")).toBe(true);
});
it("paginación solicita servidor y oculta filas/contadores de la página anterior durante carga",async()=>{
  let responder:((value:Response)=>void)|undefined;
  const fetchMock=vi.fn(async(url:string)=>url.includes("page=2")?new Promise<Response>(resolve=>{responder=resolve;}):Response.json(datos({totalAdvertencias:26})));
  vi.stubGlobal("fetch",fetchMock);const node=mount();
  await act(async()=>root!.render(createElement(CxpIntegridad,{slug:"qa",entidadId:"5",onConsultarProveedor:vi.fn()})));
  await act(async()=>[...node.querySelectorAll("button")].find(b=>b.textContent==="Siguiente")!.click());
  expect(fetchMock.mock.calls.at(-1)?.[0]).toContain("page=2");expect(node.querySelectorAll("tbody tr")).toHaveLength(0);
  expect(node.textContent).toContain("Cargando revisión");expect(node.textContent).not.toContain("Facturas revisadas:");
  await act(async()=>responder!(Response.json(datos({page:2,totalAdvertencias:26,filas:[]}))));
  expect(node.textContent).toContain("Página 2 de 2");
});
it("error controlado no conserva resultados ni afirma integridad, y aplica filtro de estado",async()=>{
  const fetchMock=vi.fn(async(url:string)=>url.includes("estado=ANULADA")?Response.json({error:"Esquema pendiente"},{status:503}):Response.json(datos()));
  vi.stubGlobal("fetch",fetchMock);const node=mount();
  await act(async()=>root!.render(createElement(CxpIntegridad,{slug:"qa",entidadId:"5",onConsultarProveedor:vi.fn()})));
  const select=node.querySelectorAll("select")[1];
  await act(async()=>{select.value="ANULADA";select.dispatchEvent(new Event("change",{bubbles:true}));});
  await act(async()=>node.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));
  expect(fetchMock.mock.calls.at(-1)?.[0]).toContain("estado=ANULADA");expect(node.querySelector('[role="alert"]')?.textContent).toBe("Esquema pendiente");
  expect(node.querySelectorAll("tbody tr")).toHaveLength(0);
});
it("una respuesta tardía de otra entidad no reemplaza la entidad vigente",async()=>{
  let primera:((value:Response)=>void)|undefined;
  vi.stubGlobal("fetch",vi.fn(async(url:string)=>url.includes("entidad=5")?new Promise<Response>(resolve=>{primera=resolve;}):Response.json(datos({entidadId:6,filas:[],totalAdvertencias:0}))));
  const node=mount();const onConsultarProveedor=vi.fn();
  await act(async()=>root!.render(createElement(CxpIntegridad,{slug:"qa",entidadId:"5",onConsultarProveedor})));
  await act(async()=>root!.render(createElement(CxpIntegridad,{slug:"qa",entidadId:"6",onConsultarProveedor})));
  await act(async()=>primera!(Response.json(datos())));
  expect(node.textContent).toContain("Entidad #6");expect(node.textContent).not.toContain("Proveedor QA");
});
it("sin permiso de facturas no ofrece pestaña Integridad; conserva las demás pestañas autorizadas",async()=>{
  vi.stubGlobal("fetch",vi.fn(async()=>Response.json({entidades:[{id:5,codigo:"QA",nombre:"Sintética",activa:1}]})));const node=mount();
  await act(async()=>root!.render(createElement(CxpClient,{slug:"qa",puedeVer:false,puedeRegistrar:false,puedeAnular:false,puedeVerFiscal:false,puedeEditarFiscal:false})));
  expect([...node.querySelectorAll("button")].some(b=>b.textContent==="Integridad")).toBe(false);
});
it("la navegación existente abre el proveedor inicial incluyendo pagadas y anuladas",async()=>{
  const calls:string[]=[];
  vi.stubGlobal("fetch",vi.fn(async(url:string)=>{calls.push(url);return url.includes("/proveedores?")?Response.json({proveedores:[]}):Response.json({error:"Controlado"},{status:503});}));
  mount();await act(async()=>root!.render(createElement(CxpEstadoCuenta,{slug:"qa",entidadId:"5",proveedorInicial:3})));
  const req=calls.find(u=>u.includes("/estado-cuenta?"))!;expect(req).toContain("proveedorId=3");expect(req).toContain("incluirPagadas=1");expect(req).toContain("incluirAnuladas=1");
});
it("el módulo conserva sus pestañas y navega desde Integridad al estado de cuenta del proveedor",async()=>{
  const calls:string[]=[];
  vi.stubGlobal("fetch",vi.fn(async(url:string)=>{
    calls.push(url);
    if(url.endsWith("/entidades"))return Response.json({entidades:[{id:5,codigo:"QA",nombre:"Sintética",activa:1}]});
    if(url.includes("/integridad?"))return Response.json(datos());
    if(url.includes("/facturas?"))return Response.json({facturas:[],total:0});
    if(url.includes("/proveedores?"))return Response.json({proveedores:[]});
    if(url.includes("/estado-cuenta?"))return Response.json({error:"Controlado"},{status:503});
    throw new Error("Solicitud inesperada");
  }));
  const node=mount();
  await act(async()=>root!.render(createElement(CxpClient,{slug:"qa",puedeVer:true,puedeRegistrar:false,puedeAnular:false,puedeVerFiscal:true,puedeEditarFiscal:false,puedeVerPagos:true,puedeVerBitacora:true})));
  for(const label of ["Facturas","Pagos","Proveedores y configuración fiscal","Estado de cuenta","Antigüedad de saldos","Bitácora","Integridad"]){
    expect([...node.querySelectorAll("button")].some(b=>b.textContent===label)).toBe(true);
  }
  await act(async()=>[...node.querySelectorAll("button")].find(b=>b.textContent==="Integridad")!.click());
  expect(node.querySelector('[data-testid="cxp-integridad"]')).not.toBeNull();
  await act(async()=>[...node.querySelectorAll("button")].find(b=>b.textContent==="Consultar proveedor")!.click());
  const req=calls.find(u=>u.includes("/estado-cuenta?"))!;
  expect(req).toContain("entidad=5");expect(req).toContain("proveedorId=3");expect(req).toContain("incluirPagadas=1");expect(req).toContain("incluirAnuladas=1");
});
