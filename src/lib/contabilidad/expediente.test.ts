import {describe,it,expect} from 'vitest';
import {evaluarEvidencias,evidenciaEntrada,type Evidencia} from './expediente-contrato';
const base:Evidencia={codigo:'POLITICA',version:1,estado:'VERIFICADA_TECNICAMENTE',referencia:'documento',huellaDocumento:'a'.repeat(64),justificacion:'verificacion documentada',creadoPor:1,creadoEn:'2030-01-01',huellaBase:'base',integra:true};
describe('C3C12 integridad documental',()=>{
 it('rechaza corrupcion historica aun con sucesora integra',()=>{expect(evaluarEvidencias([{...base,version:2},{...base,integra:false}],'base')).toContain('EVIDENCIA_INTEGRA_INVALIDA:POLITICA:1');});
 it('rechaza huecos y versiones duplicadas',()=>{for(const vs of [[2],[1,1],[1,3]])expect(evaluarEvidencias(vs.map(version=>({...base,version})),'base')).toContain('CADENA_EVIDENCIA_INVALIDA:POLITICA');});
 it('revocacion no restaura una version anterior',()=>{expect(evaluarEvidencias([{...base,version:2,estado:'REVOCADA'},base],'base')).toContain('EVIDENCIA_REVOCADA:POLITICA');});
 it('detecta huellas desactualizadas',()=>{expect(evaluarEvidencias([base],'otra')).toContain('EVIDENCIA_DESACTUALIZADA:POLITICA');});
 it('referencia y hash no conceden verificacion ni autenticidad',()=>{expect(evaluarEvidencias([{...base,estado:'NO_VERIFICADA'}],'base')).toContain('EVIDENCIA_NO_VERIFICADA:POLITICA');});
 it('contrato rechaza campos desconocidos y estados formales',()=>{expect(evidenciaEntrada.safeParse({estado:'APROBADA'}).success).toBe(false);});
});
