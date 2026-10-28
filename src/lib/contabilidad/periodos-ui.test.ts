import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {ControlPeriodos} from '@/components/contabilidad/control-periodos';
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
});
