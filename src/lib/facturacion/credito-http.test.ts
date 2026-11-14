import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/tenant',()=>({requireTenantFacturacion:vi.fn()}));
vi.mock('@/lib/permisos',()=>({permisosEfectivos:vi.fn(),listarPermisosUsuario:vi.fn()}));
vi.mock('./credito',()=>({guardarPerfilCredito:vi.fn(),obtenerPerfilCredito:vi.fn(),respuestaErrorCredito:()=>({error:'inválido',status:400}),ErrorCredito:class extends Error{}}));
import { requireTenantFacturacion } from '@/lib/tenant';
import { permisosEfectivos, listarPermisosUsuario } from '@/lib/permisos';
import { permisosDefaultPorRol } from '@/lib/permisos-shared';
import { tieneAccionCatalogo } from '@/lib/permisos-catalogo';
import { ROLES } from '@/lib/roles';
import { guardarPerfilCredito } from './credito';
import { perfilCreditoHttp } from './credito-http';
import { GET, PUT } from '@/app/api/empresas/[slug]/facturacion/clientes/[id]/credito/route';
beforeEach(()=>{vi.resetAllMocks();vi.mocked(requireTenantFacturacion).mockResolvedValue({session:{id:3,rol:'Facturador',username:'actor'},empresa:{id:7}} as never);vi.mocked(permisosEfectivos).mockResolvedValue([]);});
it('usuario que puede emitir no obtiene autorización para aprobar crédito',async()=>{
 const r=await perfilCreditoHttp(new Request('http://local/x?entidad=9',{method:'PUT',body:'{}'}),'empresa','2',true);
 expect(r.status).toBe(403);expect(guardarPerfilCredito).not.toHaveBeenCalled();
});
it('ni Admin existente recibe la nueva capacidad sin concesión explícita',async()=>{
 vi.mocked(requireTenantFacturacion).mockResolvedValue({session:{id:3,rol:'Admin',username:'actor'},empresa:{id:7}} as never);
 vi.mocked(listarPermisosUsuario).mockResolvedValue([]);
 expect((await perfilCreditoHttp(new Request('http://local/x?entidad=9'),'empresa','2',false)).status).toBe(403);
 for(const rol of ROLES) expect(tieneAccionCatalogo(permisosDefaultPorRol(rol),'facturacion','administrar_credito')).toBe(false);
});
it('guard de empresa deniega antes de tocar servicios',async()=>{
 vi.mocked(requireTenantFacturacion).mockResolvedValue({error:new Response(null,{status:403})} as never);
 const r=await perfilCreditoHttp(new Request('http://local/x?entidad=9'),'ajena','2',false);
 expect(r.status).toBe(403);expect(permisosEfectivos).not.toHaveBeenCalled();
});
it('capacidad explícita delega ámbito y actor del guard, no del cuerpo',async()=>{
 vi.mocked(permisosEfectivos).mockResolvedValue([{modulo:'facturacion',puedeVer:true,puedeCrear:false,puedeEditar:false,puedeEliminar:false},{modulo:'facturacion_credito',puedeVer:true,puedeCrear:false,puedeEditar:false,puedeEliminar:false}]);
 const body={dias:30,aprobada:true,revision:0,motivo:'Regla autorizada'};
 const r=await perfilCreditoHttp(new Request('http://local/x?entidad=9',{method:'PUT',body:JSON.stringify(body)}),'empresa','2',true);
 expect(r.status).toBe(200);expect(guardarPerfilCredito).toHaveBeenCalledWith({empresaId:7,usuarioId:3,usuario:'actor'},9,2,body);
});
it.each([GET,PUT])('ruta real de perfil deniega sin grant y no llama al escritor',async handler=>{
 const r=await handler(new Request('http://local/x?entidad=9',{method:'PUT',body:'{}'}),{params:Promise.resolve({slug:'empresa',id:'2'})});
 expect(r.status).toBe(403);expect(guardarPerfilCredito).not.toHaveBeenCalled();
});
it('Admin con concesión explícita puede administrar; no se requiere ni concede otro rol',async()=>{
 vi.mocked(requireTenantFacturacion).mockResolvedValue({session:{id:3,rol:'Admin',username:'actor'},empresa:{id:7}} as never);
 vi.mocked(listarPermisosUsuario).mockResolvedValue([{modulo:'facturacion_credito',puedeVer:true,puedeCrear:false,puedeEditar:false,puedeEliminar:false}]);
 expect((await perfilCreditoHttp(new Request('http://local/x?entidad=9'),'empresa','2',false)).status).toBe(200);
 expect(permisosEfectivos).not.toHaveBeenCalled();
});
