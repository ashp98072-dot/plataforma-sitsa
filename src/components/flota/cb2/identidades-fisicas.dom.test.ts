// @vitest-environment happy-dom
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
import {IdentidadesFisicas} from './identidades-fisicas';
it('inspeccion no aprueba; propuesta exige evidencia y confirmacion independiente',async()=>{
 (globalThis as Record<string,unknown>).IS_REACT_ACT_ENVIRONMENT=true;
 const f=vi.fn(async(url:string,init?:RequestInit)=>Response.json(init?.method==='POST'?{id:1,estado:'PROPUESTA'}:url.includes('?vehiculos=')?{compatible:true,motivo:'',vehiculos:[{id:651,empresaId:1,placa:'C092BXF',tipo:'TC',chasis:'LABVIN092BXF01',revision:'a'.repeat(64),referencias:[]},{id:1300,empresaId:2,placa:'C092BXF',tipo:'TC',chasis:'LABVIN092BXF01',revision:'b'.repeat(64),referencias:[]}]}:[]));vi.stubGlobal('fetch',f);
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 async function texto(el:HTMLInputElement|HTMLTextAreaElement,value:string){await act(async()=>{Object.getOwnPropertyDescriptor(el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));});}
 try{await act(async()=>root.render(createElement(IdentidadesFisicas,{api:'/lab',activo:true,recargar:vi.fn()})));
  await texto(host.querySelector('input')!,'651,1300');await act(async()=>host.querySelector('button')!.click());
  const proponer=[...host.querySelectorAll('button')].find(b=>b.textContent==='Crear propuesta sin mover históricos')!;expect(proponer.disabled).toBe(true);
  expect(f.mock.calls.every(c=>!c[1]?.method)).toBe(true);await texto(host.querySelector('textarea')!,'Expediente y serie revisados fisicamente');expect(proponer.disabled).toBe(true);
  await act(async()=>host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());expect(proponer.disabled).toBe(false);await act(async()=>proponer.click());
  const writes=f.mock.calls.filter(c=>c[1]?.method);expect(writes).toHaveLength(1);expect(writes[0][1]?.method).toBe('POST');expect(JSON.parse(String(writes[0][1]?.body))).toMatchObject({ids:[651,1300],confirmado:true});expect(host.textContent).not.toContain('Estado: APROBADA');
 }finally{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();}
});
