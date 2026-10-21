import { beforeEach,it,expect,vi } from "vitest";
import { createHash } from "crypto";
const m=vi.hoisted(()=>({guard:vi.fn(),list:vi.fn(),confirm:vi.fn(),annul:vi.fn(),evidence:vi.fn(),upload:vi.fn(),path:vi.fn(),read:vi.fn(),unlink:vi.fn()}));
vi.mock("@/lib/tenant",()=>({requireTenantFacturacion:m.guard}));
vi.mock("@/lib/uploads",()=>({guardarUpload:m.upload,validarRutaArchivoEmpresa:m.path}));
vi.mock("fs/promises",()=>({readFile:m.read,unlink:m.unlink}));
vi.mock("./confirmaciones-bancarias",async()=>{
  const actual=await vi.importActual<typeof import("./confirmaciones-bancarias")>("./confirmaciones-bancarias");
  return {...actual,listarConfirmacionesBancarias:m.list,confirmarIngresoBancario:m.confirm,anularConfirmacionBancaria:m.annul,evidenciaConfirmacionBancaria:m.evidence};
});
import { confirmacionesGet,confirmacionesPost,confirmacionAnular,confirmacionEvidencia } from "./confirmaciones-bancarias-api";
const params={slug:"tenant",id:"5",confirmacionId:"10"};
const valid={pagoId:null,cuentaBancariaId:1,monto:"10.00",fechaAcreditacion:"2026-10-13",referencia:"R",observaciones:null,idempotencyKey:"idempotencia-123456"};
const req=(d:unknown)=>new Request("http://local",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(d)});
beforeEach(()=>{vi.clearAllMocks();m.guard.mockResolvedValue({empresa:{id:7},session:{id:4,username:"actor"}});m.list.mockResolvedValue({confirmaciones:[]});m.confirm.mockResolvedValue({id:10,idempotente:false});m.annul.mockResolvedValue({id:10});m.path.mockReturnValue(null);m.unlink.mockResolvedValue(undefined);});
it("GET exige permiso propio y toma tenant del guard",async()=>{expect((await confirmacionesGet(params)).status).toBe(200);expect(m.guard).toHaveBeenCalledWith("tenant","ver_confirmaciones_bancarias");expect(m.list).toHaveBeenCalledWith(7,5);});
it("POST exige confirmar_banco, no pagos; actor y tenant server-side",async()=>{expect((await confirmacionesPost(req(valid),params)).status).toBe(201);expect(m.guard).toHaveBeenCalledWith("tenant","confirmar_banco");expect(m.confirm).toHaveBeenCalledWith({empresaId:7,usuarioId:4,usuario:"actor"},5,{...valid,cobroId:null},null);});
it("anular exige permiso específico y motivo obligatorio",async()=>{expect((await confirmacionAnular(req({motivo:"Error"}),params)).status).toBe(200);expect(m.guard).toHaveBeenCalledWith("tenant","anular_confirmacion");expect((await confirmacionAnular(req({motivo:" "}),params)).status).toBe(400);expect(m.annul).toHaveBeenCalledTimes(1);});
it.each(["get","post","anular","evidencia"])("%s sin permiso no consulta ni escribe",async mode=>{m.guard.mockResolvedValue({error:Response.json({error:"Sin permiso"},{status:403})});const res=mode==="get"?await confirmacionesGet(params):mode==="post"?await confirmacionesPost(req(valid),params):mode==="anular"?await confirmacionAnular(req({motivo:"Error"}),params):await confirmacionEvidencia(params);expect(res.status).toBe(403);expect(m.list).not.toHaveBeenCalled();expect(m.confirm).not.toHaveBeenCalled();expect(m.annul).not.toHaveBeenCalled();expect(m.evidence).not.toHaveBeenCalled();});
it("no acepta empresa/entidad/paths arbitrarios del navegador",async()=>{expect((await confirmacionesPost(req({...valid,empresaId:8,evidencia_ruta:"etc/passwd"}),params)).status).toBe(400);expect(m.confirm).not.toHaveBeenCalled();});
it("evidencia comprueba permiso/tenant y no sirve paths ajenos",async()=>{m.evidence.mockResolvedValue({evidencia_ruta:"empresas/8/evidencias/x.pdf"});expect((await confirmacionEvidencia(params)).status).toBe(404);expect(m.evidence).toHaveBeenCalledWith(7,5,10);});
it("idempotente retorna 200; error interno seguro sin stack",async()=>{m.confirm.mockResolvedValue({id:10,idempotente:true});expect((await confirmacionesPost(req(valid),params)).status).toBe(200);m.confirm.mockRejectedValue(new Error("secreto interno"));const r=await confirmacionesPost(req(valid),params);expect(r.status).toBe(500);expect(await r.text()).not.toContain("secreto");});
it("multipart evidencia válida guarda SHA/metadata; falsa no llega al almacenamiento",async()=>{
  m.upload.mockResolvedValue({relative:"empresas/7/evidencias/x.pdf",original:"x.pdf",size:14});
  const multipart=(body:string,name:string,mime:string)=>{const f=new FormData();f.set("datos",JSON.stringify(valid));f.set("evidencia",new File([body],name,{type:mime}));return new Request("http://local",{method:"POST",body:f});};
  expect((await confirmacionesPost(multipart("%PDF-1.7 datos","x.pdf","application/pdf"),params)).status).toBe(201);
  expect(m.confirm.mock.calls[0][3]).toMatchObject({mime:"application/pdf",ruta:"empresas/7/evidencias/x.pdf",sha256:createHash("sha256").update("%PDF-1.7 datos").digest("hex")});
  expect((await confirmacionesPost(multipart("%PDF-1.7 datos","x.png","image/png"),params)).status).toBe(400);
  expect(m.upload).toHaveBeenCalledTimes(1);
});
it("evidencia protegida entrega attachment/no-store/nosniff sin path ni nombre arbitrario",async()=>{
  const b=Buffer.from("%PDF-1.7 datos");m.path.mockReturnValue("fixture-seguro");m.read.mockResolvedValue(b);
  m.evidence.mockResolvedValue({evidencia_ruta:"empresas/7/evidencias/x.pdf",evidencia_mime:"application/pdf",evidencia_sha256:createHash("sha256").update(b).digest("hex")});
  const r=await confirmacionEvidencia(params);expect(r.status).toBe(200);expect(r.headers.get("Cache-Control")).toBe("private, no-store");expect(r.headers.get("X-Content-Type-Options")).toBe("nosniff");expect(r.headers.get("Content-Disposition")).toContain("attachment");expect(r.headers.get("Content-Disposition")).not.toContain("fixture");
});
