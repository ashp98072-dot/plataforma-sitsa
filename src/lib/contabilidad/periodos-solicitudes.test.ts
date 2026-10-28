import {beforeEach,describe,it,expect,vi} from 'vitest';
const m=vi.hoisted(()=>({query:vi.fn(),execute:vi.fn(),beginTransaction:vi.fn(),commit:vi.fn(),rollback:vi.fn(),release:vi.fn(),audit:vi.fn(),lock:vi.fn(),control:vi.fn()}));
vi.mock('@/lib/db',()=>({getPool:()=>({getConnection:async()=>m})}));
vi.mock('@/lib/auditoria',()=>({registrarAuditoriaTx:m.audit}));
vi.mock('./ambito',()=>({bloquearAmbito:m.lock}));
vi.mock('./periodos-control',()=>({bloquearControl:m.control}));
import {operarPeriodo} from './periodos';
let periodo:{id:number;estado:string;version:number};
let pendiente:boolean;
const ctx={empresaId:7,entidadId:9,actor:{id:45,username:'lab-aprobador'}};
const motivo='Prueba ficticia de solicitud y resolución segura';
const solicitud={id:2,tipo:'REABRIR',periodo_id:1,estado:'PENDIENTE',version:0,version_objeto:2,operadores_version:0,solicitante_id:44};
beforeEach(()=>{
  vi.resetAllMocks();periodo={id:1,estado:'CERRADO',version:2};pendiente=false;
  m.control.mockResolvedValue({estado:'ACTIVO',operadores_version:0});
  m.query.mockImplementation(async(sql:string)=>{
    if(sql.includes('FROM usuarios'))return [[{id:45,username:'ficticio',activo:1,rol_global:'Contabilidad',acceso_todas_empresas:1}]];
    if(sql.includes('FROM empresas'))return [[{activa:1,modulos_json:'["contabilidad"]'}]];
    if(sql.includes('FROM usuario_modulo'))return [[{modulo:'contabilidad_calendario_ver'},{modulo:'cont_periodos_reabrir_solicitar'},{modulo:'cont_periodos_reabrir_aprobar'}]];
    if(sql.includes('FROM cont_periodos_operadores'))return [[{usuario_id:45}]];
    if(sql.includes('FROM cont_periodos_historial'))return [[]];
    if(sql.includes('FROM cont_periodos_solicitudes'))return sql.includes("tipo='REABRIR'")? [pendiente?[{id:2}]:[]]:[[solicitud]];
    if(sql.includes('FROM cont_periodos '))return [[periodo]];
    throw Error('Consulta no prevista en prueba específica');
  });
  m.execute.mockResolvedValue([{insertId:6,affectedRows:1}]);
});
const pedir=()=>operarPeriodo(ctx,{accion:'reabrir_solicitar',periodoId:1,version:2,motivo,operacion:crypto.randomUUID()});
const resolver=(aprobar:boolean)=>operarPeriodo(ctx,{accion:'resolver',solicitudId:2,version:0,aprobar,motivo,operacion:crypto.randomUUID()});
describe('Reapertura: duplicados y solicitudes antiguas (solo mocks)',()=>{
  it('rechaza otra pendiente antes de insertar y revierte sin auditoría nueva',async()=>{
    pendiente=true;await expect(pedir()).rejects.toMatchObject({codigo:'SOLICITUD_PENDIENTE',status:409});
    expect(m.execute).not.toHaveBeenCalled();expect(m.rollback).toHaveBeenCalledOnce();expect(m.audit).not.toHaveBeenCalled();
    expect(m.query).toHaveBeenCalledWith(expect.stringContaining("estado='PENDIENTE'"),[7,9,1]);
    expect(m.lock.mock.invocationCallOrder[0]).toBeLessThan(m.query.mock.invocationCallOrder[0]);
  });
  it('crea una solicitud si no hay otra pendiente, conservando el ámbito y versión',async()=>{
    await expect(pedir()).resolves.toMatchObject({solicitudId:6,estado:'PENDIENTE'});
    expect(m.execute).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO cont_periodos_solicitudes'),expect.arrayContaining([7,9,'REABRIR',1]));
    expect(m.audit).toHaveBeenCalledOnce();expect(m.commit).toHaveBeenCalledOnce();
  });
  it('no ejecuta solicitud antigua aunque el período vuelva a estar cerrado',async()=>{
    periodo.version=4;await expect(resolver(true)).rejects.toMatchObject({codigo:'VERSION_CAMBIADA'});
    expect(m.execute).not.toHaveBeenCalled();expect(m.rollback).toHaveBeenCalledOnce();
  });
  it('no ejecuta solicitud antigua después de reabrir',async()=>{
    periodo={id:1,estado:'ABIERTO',version:3};await expect(resolver(true)).rejects.toMatchObject({codigo:'VERSION_CAMBIADA'});
    expect(m.execute).not.toHaveBeenCalled();
  });
  it('también rechaza estado ABIERTO aunque se presente la misma versión',async()=>{
    periodo.estado='ABIERTO';await expect(resolver(true)).rejects.toMatchObject({codigo:'TRANSICION_INVALIDA'});
    expect(m.execute).not.toHaveBeenCalled();
  });
  it('permite rechazar una obsoleta por otra persona autorizada, sin tocar el período',async()=>{
    periodo={id:1,estado:'ABIERTO',version:3};await expect(resolver(false)).resolves.toMatchObject({estado:'RECHAZADA',solicitanteId:44,decisorId:45});
    expect(m.execute.mock.calls.some(([sql])=>String(sql).startsWith('UPDATE cont_periodos SET'))).toBe(false);
    expect(m.audit).toHaveBeenCalledOnce();expect(m.commit).toHaveBeenCalledOnce();
  });
});
