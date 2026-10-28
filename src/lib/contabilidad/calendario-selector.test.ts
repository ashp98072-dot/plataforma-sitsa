import {afterEach,describe,it,expect,vi} from 'vitest';
const hooks=vi.hoisted(()=>({setters:[] as ReturnType<typeof vi.fn>[],effect:undefined as undefined|(()=>undefined|(()=>void))}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),
  useState:(value:unknown)=>{const setter=vi.fn();hooks.setters.push(setter);return [value,setter];},
  useEffect:(effect:()=>undefined|(()=>void))=>{hooks.effect=effect;},
}));
import {CalendarioContable} from '@/components/contabilidad/calendario-contable';
afterEach(()=>{vi.unstubAllGlobals();hooks.setters=[];hooks.effect=undefined;});
function run(slug:string){
  const wrapper=CalendarioContable({slug,puedeCrear:false});
  const selector=wrapper.type as (p:{slug:string;puedeCrear:boolean})=>unknown;
  selector({slug,puedeCrear:false});return hooks.effect!();
}
describe('Selector: efectos simulados y promesas, NO componente montado ni DOM',()=>{
  it('limpia error y termina carga tras respuesta satisfactoria',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({entidades:[]})}));
    run('lab-a');await vi.waitFor(()=>expect(hooks.setters[3]).toHaveBeenCalledWith(false));
    expect(hooks.setters[2]).toHaveBeenCalledWith('');expect(hooks.setters[0]).toHaveBeenCalledWith([]);
  });
  it('ignora respuesta anterior incluso si fetch no respeta abort',async()=>{
    let resolve!:(value:unknown)=>void;
    vi.stubGlobal('fetch',vi.fn(()=>new Promise(r=>{resolve=r;})));
    const cleanup=run('lab-a');cleanup!();
    resolve({ok:true,json:async()=>({entidades:[{id:9,codigo:'ANTERIOR',activa:1}]})});
    await new Promise(r=>setTimeout(r,0));
    for(const setter of hooks.setters)expect(setter).not.toHaveBeenCalled();
  });
});
