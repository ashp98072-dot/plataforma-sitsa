import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn(), execute: vi.fn(), getPool: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoria: vi.fn(), registrarAuditoriaTx: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenantGastos: vi.fn(), requireTenantProgramacion: vi.fn() }));

import { query } from "@/lib/db";
import { requireTenantGastos, requireTenantProgramacion } from "@/lib/tenant";
import { CATEGORIAS_OTROS_FONDOS, otrosFondosInstalado, reiniciarDeteccionOtrosFondos } from "@/lib/tms/plan-otros-fondos";
import { GET as destinoGET } from "@/app/api/empresas/[slug]/tms/planes/otros-fondos/destino/route";
import { fondosDiariosInstalado, reiniciarDeteccionFondosDiarios } from "@/lib/tms/fondos-diarios";
import { POST } from "@/app/api/empresas/[slug]/tms/fondos/diarios/resincronizar/route";

const RAIZ = process.cwd();
const leer = (ruta: string) => readFileSync(join(RAIZ, ruta), "utf8");

describe("Copiar programación NO genera solicitudes de fondos", () => {
  const archivos = [
    "src/lib/tms/programacion-lote.ts",
    "src/lib/tms/programacion-copia.ts",
    "src/lib/tms/programacion-copia-schema.ts",
    "src/app/api/empresas/[slug]/tms/programacion/copiar/route.ts",
    "src/app/api/empresas/[slug]/tms/programacion/copiar/validar/route.ts",
    "src/app/api/empresas/[slug]/tms/programacion/copiar/confirmar/route.ts",
  ];
  it.each(archivos)("%s no importa ni toca fondos", (ruta) => {
    const fuente = leer(ruta);
    expect(fuente).not.toMatch(/fondos-diarios|plan-otros-fondos|tms_plan_otros_fondos|tms\/fondos|tms_solicitud/);
    expect(fuente).not.toMatch(/entidad_requirente_id/);
  });
});

describe("Detección de la migración (compatibilidad sin migrar)", () => {
  beforeEach(() => { vi.mocked(query).mockReset(); reiniciarDeteccionFondosDiarios(); });
  it("con columnas ausentes la integración queda apagada y se cachea el resultado", async () => {
    vi.mocked(query).mockRejectedValue(new Error("Unknown column"));
    expect(await fondosDiariosInstalado()).toBe(false);
    const llamadas = vi.mocked(query).mock.calls.length;
    expect(await fondosDiariosInstalado()).toBe(false);
    expect(vi.mocked(query).mock.calls.length).toBe(llamadas);
  });
  it("con todas las sondas correctas queda instalada", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    expect(await fondosDiariosInstalado()).toBe(true);
  });
});

describe("POST /tms/fondos/diarios/resincronizar", () => {
  const ctx = { params: Promise.resolve({ slug: "demo" }) };
  const req = (cuerpo: unknown) => new Request("http://x/api", { method: "POST", body: JSON.stringify(cuerpo) });
  beforeEach(() => { vi.mocked(query).mockReset(); reiniciarDeteccionFondosDiarios(); vi.mocked(requireTenantGastos).mockReset(); });

  it("exige el permiso de editar Fondos: si la guarda niega, responde su error y no consulta nada", async () => {
    const error = new Response(JSON.stringify({ error: "Sin permiso" }), { status: 403 });
    vi.mocked(requireTenantGastos).mockResolvedValue({ error } as never);
    const res = await POST(req({ fecha: "2026-11-23", entidadRequirenteId: 1 }), ctx);
    expect(res.status).toBe(403);
    expect(requireTenantGastos).toHaveBeenCalledWith("demo", "editar");
    expect(query).not.toHaveBeenCalled();
  });

  it("rechaza cuerpos inválidos con 400", async () => {
    vi.mocked(requireTenantGastos).mockResolvedValue({ empresa: { id: 7 }, session: { id: 1, nombre: "A", username: "a" } } as never);
    for (const cuerpo of [{}, { fecha: "23/11/2026", entidadRequirenteId: 1 }, { fecha: "2026-11-23", entidadRequirenteId: -2 }]) {
      expect((await POST(req(cuerpo), ctx)).status).toBe(400);
    }
  });

  it("responde 409 si la migración aún no está aplicada", async () => {
    vi.mocked(requireTenantGastos).mockResolvedValue({ empresa: { id: 7 }, session: { id: 1, nombre: "A", username: "a" } } as never);
    vi.mocked(query).mockRejectedValue(new Error("Unknown column"));
    const res = await POST(req({ fecha: "2026-11-23", entidadRequirenteId: 1 }), ctx);
    expect(res.status).toBe(409);
  });
});

describe("Otros fondos del viaje (Fase 3): catálogo, detección y sugerencia de cuenta", () => {
  const ctx = { params: Promise.resolve({ slug: "demo" }) };
  const get = (qs: string) => destinoGET(new Request(`http://x/api?${qs}`), ctx);
  beforeEach(() => { vi.mocked(query).mockReset(); reiniciarDeteccionOtrosFondos(); vi.mocked(requireTenantProgramacion).mockReset(); });

  it("las categorías salen del catálogo compartido SIN «Viáticos» ni «Reintegro de gastos» e incluyen hospedaje, combustible, mantenimiento, cuadrilla extra, peajes, parqueo y otros", () => {
    expect(CATEGORIAS_OTROS_FONDOS).not.toContain("Viáticos");
    expect(CATEGORIAS_OTROS_FONDOS).not.toContain("Reintegro de gastos");
    for (const c of ["Hospedaje", "Combustible", "Mantenimiento", "Auxiliar extra", "Peajes", "Parqueo", "Otros"]) expect(CATEGORIAS_OTROS_FONDOS).toContain(c);
  });

  it("sin la migración de la Fase 3 la función queda apagada (negativo cacheado)", async () => {
    vi.mocked(query).mockRejectedValue(new Error("Unknown column"));
    expect(await otrosFondosInstalado()).toBe(false);
    const n = vi.mocked(query).mock.calls.length; expect(await otrosFondosInstalado()).toBe(false); expect(vi.mocked(query).mock.calls.length).toBe(n);
  });

  it("GET destino: exige permiso de editar Programación; valida empleado y método; 409 sin migración; 404 si el empleado no es de la empresa; devuelve la sugerencia de RRHH", async () => {
    vi.mocked(requireTenantProgramacion).mockResolvedValue({ error: new Response("{}", { status: 403 }) } as never);
    expect((await get("empleadoId=1")).status).toBe(403);
    expect(requireTenantProgramacion).toHaveBeenCalledWith("demo", "editar"); expect(query).not.toHaveBeenCalled();
    vi.mocked(requireTenantProgramacion).mockResolvedValue({ empresa: { id: 7 }, session: { id: 1 } } as never);
    expect((await get("empleadoId=abc")).status).toBe(400);
    expect((await get("empleadoId=1&metodo=Bitcoin")).status).toBe(400);
    vi.mocked(query).mockRejectedValue(new Error("Unknown column"));
    expect((await get("empleadoId=1&metodo=Transferencia")).status).toBe(409);
    reiniciarDeteccionOtrosFondos();
    vi.mocked(query).mockReset().mockResolvedValueOnce([] as never).mockResolvedValueOnce([] as never).mockResolvedValueOnce([] as never);
    expect((await get("empleadoId=1&metodo=Transferencia")).status).toBe(404);
    reiniciarDeteccionOtrosFondos();
    vi.mocked(query).mockReset().mockResolvedValueOnce([] as never).mockResolvedValueOnce([] as never).mockResolvedValueOnce([{ nombre: "Ana", cuenta_bancaria: "123", telefono: "5555" }] as never);
    const ok = await get("empleadoId=1&metodo=Transferencia");
    expect(ok.status).toBe(200); expect(await ok.json()).toEqual({ empleadoNombre: "Ana", destino: "123", tieneDato: true });
    // la consulta de RRHH va siempre acotada por la empresa de la SESIÓN (id 7), nunca por un dato del cliente
    expect(vi.mocked(query).mock.calls.at(-1)?.[1]).toEqual([1, 7]);
  });
});
