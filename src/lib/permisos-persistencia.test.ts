import { beforeEach, describe, expect, it, vi } from "vitest";
const conn = vi.hoisted(() => ({beginTransaction:vi.fn(),query:vi.fn(),execute:vi.fn(),commit:vi.fn(),rollback:vi.fn(),release:vi.fn()}));
vi.mock("@/lib/db",()=>({getPool:()=>({getConnection:async()=>conn}),query:vi.fn()}));
import { guardarPermisosUsuario } from "./permisos";
import { VERSION_PERMISOS } from "./permisos-catalogo";
const fila = {modulo:"facturacion",puedeVer:true,puedeCrear:false,puedeEditar:true,puedeEliminar:false};
beforeEach(()=>vi.resetAllMocks());
describe("persistencia de matriz V2",()=>{
  it("guarda grants y denegaciones en una sola transacción",async()=>{
    await guardarPermisosUsuario(10,[fila,{...fila,modulo:"facturacion_emitir",puedeVer:false,puedeEditar:false}]);
    expect(conn.beginTransaction).toHaveBeenCalledOnce();
    expect(conn.commit).toHaveBeenCalledOnce();
    expect(conn.rollback).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledOnce();
    expect(conn.execute).toHaveBeenCalledWith(expect.stringContaining("INSERT"),[10,"facturacion_emitir",0,0,0,0]);
    expect(conn.execute).toHaveBeenCalledWith(expect.stringContaining("INSERT"),[10,VERSION_PERMISOS,1,0,0,0]);
  });
  it("si falla un INSERT no deja una matriz parcialmente reemplazada",async()=>{
    conn.execute.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("fallo de prueba"));
    await expect(guardarPermisosUsuario(10,[fila])).rejects.toThrow("fallo de prueba");
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledOnce();
  });
  it("schema antiguo sin cuatro flags se rechaza ANTES del DELETE",async()=>{
    conn.query.mockRejectedValueOnce(new Error("columna ausente"));
    await expect(guardarPermisosUsuario(10,[fila])).rejects.toThrow("columna ausente");
    expect(conn.execute).not.toHaveBeenCalled();
    expect(conn.rollback).toHaveBeenCalledOnce();
  });
});
