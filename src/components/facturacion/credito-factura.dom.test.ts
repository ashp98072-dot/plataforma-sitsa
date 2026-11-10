// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CreditoFactura } from './credito-factura';
import { FacturasPanel } from './facturas-panel';

let host: HTMLDivElement, root: Root;
const fetcher = vi.fn(), token = vi.fn();
const props = {slug:'qa',factura:1,cliente:20,entidad:9,fecha:'2026-07-15',borrador:true,onToken:token};
const reply = (body: unknown, status=200) => new Response(JSON.stringify(body), {status});
beforeEach(()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('fetch',fetcher);fetcher.mockReset();token.mockReset();
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
async function mount(extra: Partial<typeof props>={}) {await act(async()=>root.render(createElement(CreditoFactura,{...props,...extra})));}
async function click(text: string) {const b=[...host.querySelectorAll('button')].find(b=>b.textContent===text);expect(b).toBeTruthy();await act(async()=>b!.click());}
const preview='Revisar vencimiento para emisión';
it.each([
 ['POST',200,false],['POST',503,false],['PUT',200,false],['PUT',503,false],
 ['POST',200,true],['POST',503,true],['PUT',200,true],['PUT',503,true],
] as const)('solicitud obsoleta %s (%s), vigente termina primero: %s',async(method,status,vigentePrimero)=>{
 const pendientes: Array<(r:Response)=>void>=[];
 fetcher.mockImplementation((url:string,init?:RequestInit)=>init?.method==='POST'||init?.method==='PUT'
  ?new Promise<Response>(resolve=>pendientes.push(resolve))
  :Promise.resolve(url.includes('/clientes/')?reply({perfil:{dias:30,aprobada:1,revision:4}}):reply({vencimiento:null})));
 await mount();
 const motivo=host.querySelector('input[maxlength="500"]') as HTMLInputElement;
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(motivo,'Motivo autorizado QA');motivo.dispatchEvent(new Event('input',{bubbles:true}));});
 const botones=[...host.querySelectorAll('button')];
 const revisar=botones.find(b=>b.textContent===preview)!;
 const guardar=botones.find(b=>b.textContent==='Guardar perfil')!;
 // Ambos eventos se despachan antes del siguiente render que deshabilita los botones.
 await act(async()=>{(method==='PUT'?guardar:revisar).click();revisar.click();});
 expect(pendientes).toHaveLength(2);
 const obsoleta=()=>act(async()=>pendientes[0](reply(status===200
  ?{perfil:{revision:99},certificado:true,snapshot:{vencimiento:'2099-01-01',dias:99,fechaBase:props.fecha},token:'obsoleto'}
  :{error:'error obsoleto'},status)));
 const vigente=()=>act(async()=>pendientes[1](reply({certificado:true,snapshot:{vencimiento:'2026-08-14',dias:30,fechaBase:props.fecha},token:'vigente'})));
 if(vigentePrimero) await vigente();
 const antes=host.innerHTML, tokens=token.mock.calls.slice();
 await obsoleta();
 expect(host.innerHTML).toBe(antes);expect(token.mock.calls).toEqual(tokens);
 expect(revisar.disabled).toBe(!vigentePrimero);expect(guardar.disabled).toBe(!vigentePrimero);
 expect(host.querySelector('[role=alert]')).toBeNull();
 expect(token).not.toHaveBeenCalledWith('obsoleto');
 if(!vigentePrimero) await vigente();
 expect(revisar.disabled).toBe(false);expect(token).toHaveBeenLastCalledWith('vigente');
 expect(host.textContent).toContain('Confirma: vence 2026-08-14');
 // La revisión del perfil no es visible: verificarla en la siguiente petición de guardado.
 await click('Guardar perfil');
 const puts=fetcher.mock.calls.filter(([,init])=>init?.method==='PUT');
 expect(JSON.parse(puts.at(-1)![1].body).revision).toBe(4);
 await act(async()=>pendientes[2](reply({perfil:{revision:5}})));
});
it('403 de perfil oculta administración pero permite revisar con permiso de emisión',async()=>{
 fetcher.mockImplementation((url:string,init?:RequestInit)=>Promise.resolve(url.includes('/clientes/')?reply({error:'Sin permiso'},403):init?.method==='POST'?reply({certificado:true,snapshot:{vencimiento:'2026-08-14',dias:30,fechaBase:props.fecha},token:'confirmado'}):reply({vencimiento:null})));
 await mount();expect(host.textContent).not.toContain('Guardar perfil');await click(preview);expect(token).toHaveBeenLastCalledWith('confirmado');expect(host.textContent).toContain('2026-08-14');
});
it.each([403,409,503])('preview %s presenta error y elimina confirmación anterior',async status=>{
 fetcher.mockImplementation((url:string,init?:RequestInit)=>Promise.resolve(init?.method==='POST'?reply({error:`rechazo-${status}`},status):url.includes('/clientes/')?reply({error:'Sin permiso'},403):reply({vencimiento:null})));
 await mount();await click(preview);expect(host.querySelector('[role=alert]')?.textContent).toBe(`rechazo-${status}`);expect(token).toHaveBeenLastCalledWith(undefined);
});
it.each([200,403,409,503])('guardar perfil aprobado (%s) conserva revisión observada e invalida preview',async status=>{
 fetcher.mockImplementation((url:string,init?:RequestInit)=>Promise.resolve(url.includes('/clientes/')?init?.method==='PUT'?reply(status===200?{perfil:{revision:5}}:{error:`perfil-${status}`},status):reply({perfil:{dias:30,aprobada:1,revision:4}}):reply({vencimiento:null})));
 await mount();const input=host.querySelector('input[maxlength="500"]') as HTMLInputElement;
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'Motivo autorizado QA');input.dispatchEvent(new Event('input',{bubbles:true}));});
 await click('Guardar perfil');const sent=fetcher.mock.calls.find(([,i])=>i?.method==='PUT');expect(JSON.parse(sent![1].body)).toMatchObject({dias:30,aprobada:true,revision:4});expect(host.textContent).toContain(status===200?'Perfil guardado':`perfil-${status}`);expect(token).toHaveBeenLastCalledWith(undefined);
});
const cambiosContexto: Array<Partial<typeof props>>=[{fecha:'2026-07-16'},{cliente:21},{factura:2},{entidad:10}];
it.each(cambiosContexto.flatMap(cambio=>['POST','PUT'].flatMap(method=>[200,503].flatMap(status=>[false,true].map(nuevaPendiente=>({cambio,method,status,nuevaPendiente}))))))(
 'invalida $method con contexto $cambio, respuesta $status y nueva pendiente $nuevaPendiente',async({cambio,method,status,nuevaPendiente})=>{
 const pendientes: Array<(r:Response)=>void>=[];
 fetcher.mockImplementation((url:string,init?:RequestInit)=>init?.method==='POST'||init?.method==='PUT'
  ?new Promise<Response>(resolve=>pendientes.push(resolve))
  :Promise.resolve(url.includes('/clientes/')?reply({perfil:{dias:30,aprobada:1,revision:4}}):reply({vencimiento:null})));
 await mount();
 const motivo=host.querySelector('input[maxlength="500"]') as HTMLInputElement;
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(motivo,'Motivo autorizado QA');motivo.dispatchEvent(new Event('input',{bubbles:true}));});
 const boton=()=>[...host.querySelectorAll('button')].find(b=>b.textContent===preview)!;
 await click(method==='PUT'?'Guardar perfil':preview);
 expect(boton().disabled).toBe(true);
 await mount(cambio);
 expect(boton().disabled).toBe(false);expect(token).toHaveBeenLastCalledWith(undefined);
 if(nuevaPendiente) await click(preview);
 const antes=host.innerHTML, tokens=token.mock.calls.slice();
 await act(async()=>pendientes[0](reply(status===200
  ?{perfil:{revision:99},certificado:true,snapshot:{vencimiento:'2099-01-01',dias:99,fechaBase:props.fecha},token:'obsoleto'}
  :{error:'error obsoleto'},status)));
 expect(host.innerHTML).toBe(antes);expect(token.mock.calls).toEqual(tokens);
 expect(host.querySelector('[role=alert]')).toBeNull();
 expect(boton().disabled).toBe(nuevaPendiente);
 if(!nuevaPendiente) await click(preview);
 expect(pendientes).toHaveLength(2);
 const post=fetcher.mock.calls.filter(([,init])=>init?.method==='POST').at(-1)!;
 expect(post[0]).toContain(`/facturas/${cambio.factura??props.factura}/vencimiento`);
 expect(JSON.parse(post[1].body).fechaEmision).toBe(cambio.fecha??props.fecha);
 await act(async()=>pendientes[1](reply({certificado:true,snapshot:{vencimiento:'2026-08-15',dias:30,fechaBase:cambio.fecha??props.fecha},token:'nuevo'})));
 expect(boton().disabled).toBe(false);expect(token).toHaveBeenLastCalledWith('nuevo');
 expect(host.textContent).toContain('Confirma: vence 2026-08-15');
 await click('Guardar perfil');
 const put=fetcher.mock.calls.filter(([,init])=>init?.method==='PUT').at(-1)!;
 expect(put[0]).toContain(`/clientes/${cambio.cliente??props.cliente}/credito?entidad=${cambio.entidad??props.entidad}`);
 expect(JSON.parse(put[1].body).revision).toBe(4);
 await act(async()=>pendientes[2](reply({perfil:{revision:5}})));
});
it.each([200,403,409,503])('panel real revisa, envía token y procesa emisión %s sin ocultar errores',async status=>{
 let emitida=false;
 const f={id:1,clienteId:20,cliente:'Cliente sintético',numeroFactura:'QA-1',fechaEmision:'2026-07-15',montoTotal:100,totalPagado:0,saldo:100,estadoAdmin:'Borrador',estadoFinanciero:null,moneda:'GTQ',subtotal:null,iva:null,porcentajeIva:null,precioIncluyeIva:null,clienteNit:null,observaciones:null};
 fetcher.mockImplementation((url:string,init?:RequestInit)=>{
  if(url.endsWith('/emitir')){if(status===200)emitida=true;return Promise.resolve(reply(status===200?{mensaje:'Factura emitida.'}:{error:`emision-${status}`},status));}
  if(url.endsWith('/vencimiento'))return Promise.resolve(reply(init?.method==='POST'?{certificado:true,snapshot:{vencimiento:'2026-08-14',dias:30,fechaBase:props.fecha},token:'confirmacion-panel'}:{vencimiento:null}));
  if(url.includes('/credito?'))return Promise.resolve(reply({error:'Sin permiso'},403));
  if(url.endsWith('/facturas/1'))return Promise.resolve(reply({factura:{...f,estadoAdmin:emitida?'Emitida':'Borrador'},viajes:[],pagos:[],lineas:[],contabilidad:{entidadId:9,condicionPago:'CREDITO',modeloLineas:false,esquemaPendiente:false}}));
  return Promise.resolve(reply(url.includes('/catalogos')?{clientes:[]}:{facturas:[{...f,estadoAdmin:emitida?'Emitida':'Borrador'}],totalReal:1}));
 });
 await act(async()=>root.render(createElement(FacturasPanel,{slug:'qa',puedeEditar:false,puedeEmitir:true,puedeAnular:false,puedePagar:false,abrirFacturaId:null,onAbierta:()=>{},onCambio:()=>{}})));
 await click('Ver detalle');await click('Emitir factura');await click(preview);await click('Confirmar emisión');
 const sent=fetcher.mock.calls.find(([u])=>String(u).endsWith('/emitir'));expect(JSON.parse(sent![1].body).vencimientoToken).toBe('confirmacion-panel');
 expect(host.textContent).toContain(status===200?'Emitida':`emision-${status}`);
 if(status!==200)expect(host.textContent).toContain('Confirmar emisión');
});
