import { beforeEach,it,expect,vi } from "vitest";
import type { PoolConnection } from "mysql2/promise";
const m=vi.hoisted(()=>({saldo:21.62}));
vi.mock("@/lib/db",()=>({getPool:vi.fn(),query:vi.fn(async()=>[])}));
vi.mock("./vacaciones-sync-estado",()=>({marcarVacacionesDirty:vi.fn(),candidatosVacaciones:vi.fn(),sincronizarCandidatoVacaciones:vi.fn()}));
import { contarDiasHabiles,registrarVacacionesFifoEnConexion } from "./vacaciones";
const query=vi.fn(async(sql:string)=>{void sql;return [[{id:1,periodo_inicio:"2026-01-01",periodo_fin:"2026-12-31",dias_disponibles:m.saldo}]];});
const execute=vi.fn(async(sql:string,p:unknown[])=>{if(sql.startsWith("UPDATE saldos_vacaciones"))m.saldo=Number(p[0]);return [{insertId:1}];});
const conn={query,execute} as unknown as PoolConnection;
const input={empresaId:7,idEmpleado:1,fechaInicio:"2026-06-01",fechaFin:"2026-06-01",diasATomar:1};
beforeEach(()=>{vi.clearAllMocks();m.saldo=21.62;});
it("backend real cuenta un lunes y FIFO con 21.62 admite 1",async()=>{
  const dias=await contarDiasHabiles(7,input.fechaInicio,input.fechaFin);expect(dias).toBe(1);
  expect((await registrarVacacionesFifoEnConexion(conn,{...input,diasATomar:dias})).ok).toBe(true);
  expect(m.saldo).toBeCloseTo(20.62);
  expect(query.mock.calls[0][0]).toContain("FOR UPDATE");
});
it("solicitud mayor al saldo no escribe ni cambia saldo",async()=>{
  expect((await registrarVacacionesFifoEnConexion(conn,{...input,diasATomar:22})).ok).toBe(false);
  expect(execute).not.toHaveBeenCalled();expect(m.saldo).toBe(21.62);
});
it("NaN/Infinity no llegan a lecturas/escrituras FIFO",async()=>{
  for(const diasATomar of [NaN,Infinity])expect((await registrarVacacionesFifoEnConexion(conn,{...input,diasATomar})).ok).toBe(false);
  expect(query).not.toHaveBeenCalled();expect(execute).not.toHaveBeenCalled();
});
