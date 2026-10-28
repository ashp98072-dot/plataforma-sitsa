import {Children,createElement,isValidElement,type ReactNode} from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {ControlPeriodos,EtiquetaPeriodo,MotivoOperacion,TablaPeriodos} from '@/components/contabilidad/control-periodos';
import {CAPACIDADES_PERIODOS,permisoPeriodo} from './periodos-contrato';
import {PERMISOS_CONT_PERIODOS,permisosDefaultPorRol,moduloEmpresaDelPermiso} from '@/lib/permisos-shared';
import {CATALOGO_PERMISOS} from '@/lib/permisos-catalogo';
describe('C3C2 render estático y catálogo (no prueba DOM)',()=>{
  it('no ofrece activación automática ni bypass en render inicial',()=>{
    const html=renderToStaticMarkup(createElement(ControlPeriodos,{slug:'lab',actorId:41}));
    expect(html).toContain('Abrir no activa el control');expect(html).toContain('Seleccionar');expect(html).not.toContain('Aprobar y ejecutar');
  });
  it('permisos caben en VARCHAR40 y ningún rol Admin recibe grants nuevos por defecto',()=>{
    expect(PERMISOS_CONT_PERIODOS).toHaveLength(CAPACIDADES_PERIODOS.length);
    for(const cap of CAPACIDADES_PERIODOS){const key=permisoPeriodo(cap);expect(key.length).toBeLessThanOrEqual(40);expect(moduloEmpresaDelPermiso(key)).toBe('contabilidad');
      expect(permisosDefaultPorRol('Admin').find(p=>p.modulo===key)?.puedeVer).toBe(false);
      expect(CATALOGO_PERMISOS.find(m=>m.id==='contabilidad')?.acciones.some(a=>a.modulo===key)).toBe(true);
    }
  });
  it('motivo tiene etiqueta encima, ayuda asociada y tamaño legible sin depender del placeholder',()=>{
    const html=renderToStaticMarkup(createElement(MotivoOperacion,{value:'',disabled:false,onChange:()=>{}}));
    expect(html.indexOf('<label')).toBeLessThan(html.indexOf('<textarea'));
    expect(html).toContain('for="motivo-periodo"');expect(html).toContain('aria-describedby="motivo-periodo-ayuda"');
    expect(html).toContain('min-h-[100px]');expect(html).toContain('maxLength="1000"');expect(html).toContain('20 a 1000 caracteres');
    expect(html).toContain('bg-[var(--input)]');expect(html).toContain('text-[var(--text)]');
  });
  const periodo={id:7,codigo:'ENE2026',estado:'CONFIGURADO',version:3,revision_cierre:0,fechaInicio:'2026-01-01',fechaFin:'2026-01-31'};
  it('tabla muestra columnas, fechas y estados textuales con desplazamiento en pantallas pequeñas',()=>{
    const html=renderToStaticMarkup(createElement(TablaPeriodos,{periodos:[periodo],control:'NO_ACTIVADO',capacidades:['abrir'],busy:false,onAction:()=>{}}));
    for(const texto of ['Código','Fechas','Estado','Versión','Acciones','ENE2026','2026-01-01','2026-01-31','CONFIGURADO','overflow-x-auto'])expect(html).toContain(texto);
    for(const estado of ['CONFIGURADO','ABIERTO','CERRADO'])expect(renderToStaticMarkup(createElement(EtiquetaPeriodo,{estado}))).toContain(estado);
  });
  it('conserva restricciones de acciones por permiso y control activo',()=>{
    const html=(estado:string,control:string,capacidades:Parameters<typeof TablaPeriodos>[0]['capacidades'])=>renderToStaticMarkup(createElement(TablaPeriodos,{periodos:[{...periodo,estado}],control,capacidades,busy:false,onAction:()=>{}}));
    expect(html('CONFIGURADO','NO_ACTIVADO',[])).not.toContain('>Abrir</button>');
    expect(html('CONFIGURADO','NO_ACTIVADO',['abrir'])).toContain('>Abrir</button>');
    expect(html('ABIERTO','NO_ACTIVADO',['cerrar'])).not.toContain('Cerrar para nuevos registros');
    expect(html('ABIERTO','ACTIVO',['cerrar'])).toContain('Cerrar para nuevos registros');
    expect(html('CERRADO','ACTIVO',[])).not.toContain('Solicitar reapertura');
    expect(html('CERRADO','ACTIVO',['reabrir_solicitar'])).toContain('Solicitar reapertura');
  });
  it('botones no permiten operaciones mientras están ocupados y muestra ausencia de períodos',()=>{
    const html=renderToStaticMarkup(createElement(TablaPeriodos,{periodos:[periodo],control:'NO_ACTIVADO',capacidades:['abrir'],busy:true,onAction:()=>{}}));
    expect(html).toContain('disabled=""');
    expect(renderToStaticMarkup(createElement(TablaPeriodos,{periodos:[],control:'NO_ACTIVADO',capacidades:[],busy:false,onAction:()=>{}}))).toContain('No hay períodos configurados');
  });
  it('el callback de Abrir conserva el identificador y la versión (sin montar DOM ni ejecutar API)',()=>{
    const actions:Record<string,unknown>[]=[];
    const tree=TablaPeriodos({periodos:[periodo],control:'NO_ACTIVADO',capacidades:['abrir'],busy:false,onAction:a=>actions.push(a)});
    function recorrer(node:ReactNode){
      Children.forEach(node,child=>{
        if(!isValidElement<{children?:ReactNode;onClick?:()=>void}>(child))return;
        if(child.type==='button'&&child.props.children==='Abrir')child.props.onClick?.();
        recorrer(child.props.children);
      });
    }
    recorrer(tree);expect(actions).toEqual([{accion:'abrir',periodoId:7,version:3}]);
  });
});
