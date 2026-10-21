import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantFacturacion: vi.fn() }));
vi.mock("@/lib/facturacion/contexto-factura", () => ({
  fact4Disponible: vi.fn(),
  leerRetencionIvaCliente: vi.fn(),
  listarCuentasBancarias: vi.fn(),
  listarEntidadesEmisoras: vi.fn(),
}));

import { requireTenantFacturacion } from "@/lib/tenant";
import {
  fact4Disponible,
  leerRetencionIvaCliente,
  listarCuentasBancarias,
  listarEntidadesEmisoras,
} from "@/lib/facturacion/contexto-factura";
import { GET } from "./route";

const ctx = { params: Promise.resolve({ slug: "prueba" }) };
const OK = { empresa: { id: 7 }, session: { id: 3 } } as unknown as Awaited<ReturnType<typeof requireTenantFacturacion>>;
const NO = { error: new Response(null, { status: 403 }) } as Awaited<ReturnType<typeof requireTenantFacturacion>>;
const get = (q = "?clienteId=20") => GET(new Request(`http://localhost/x${q}`), ctx);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantFacturacion).mockResolvedValue(OK);
  vi.mocked(fact4Disponible).mockResolvedValue(true);
  vi.mocked(leerRetencionIvaCliente).mockResolvedValue(15);
  vi.mocked(listarEntidadesEmisoras).mockResolvedValue([{ id: 1, codigo: "MON", nombre: "Mónaco" }]);
  vi.mocked(listarCuentasBancarias).mockResolvedValue([
    { id: 4, entidadId: 1, entidadNombre: "Mónaco", banco: "Banco Industrial", alias: "Monetaria Q", referencia: "***1234", moneda: "GTQ" },
  ]);
});

describe("GET /facturacion/facturas/contexto", () => {
  it("exige facturacion:crear ANTES de leer nada", async () => {
    vi.mocked(requireTenantFacturacion).mockResolvedValue(NO);
    const res = await get();
    expect(res.status).toBe(403);
    expect(requireTenantFacturacion).toHaveBeenCalledWith("prueba", "crear");
    expect(listarEntidadesEmisoras).not.toHaveBeenCalled();
  });

  it("clienteId inválido → 400", async () => {
    expect((await get("")).status).toBe(400);
    expect((await get("?clienteId=abc")).status).toBe(400);
    expect((await get("?clienteId=-3")).status).toBe(400);
  });

  it("devuelve entidades, bancos, retención configurada y 0/15/30; todo acotado a la empresa del guard", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b).toMatchObject({
      fact4Disponible: true,
      retencionIvaClientePct: 15,
      retencionesPermitidas: [0, 15, 30],
      entidades: [{ id: 1 }],
      cuentasBancarias: [{ id: 4, banco: "Banco Industrial" }],
    });
    expect(listarEntidadesEmisoras).toHaveBeenCalledWith(7);
    expect(listarCuentasBancarias).toHaveBeenCalledWith(7);
    expect(leerRetencionIvaCliente).toHaveBeenCalledWith(7, 20);
  });

  it("puedeCambiarRetencion refleja el permiso «Editar requisitos de clientes»", async () => {
    vi.mocked(requireTenantFacturacion).mockImplementation((async (_s: string, accion: string) => (accion === "editar_requisitos" ? NO : OK)) as never);
    expect((await (await get()).json()).puedeCambiarRetencion).toBe(false);
    vi.mocked(requireTenantFacturacion).mockResolvedValue(OK);
    expect((await (await get()).json()).puedeCambiarRetencion).toBe(true);
  });

  it("sin la migración FACT-4: fact4Disponible=false y no consulta nada más", async () => {
    vi.mocked(fact4Disponible).mockResolvedValue(false);
    const b = await (await get()).json();
    expect(b).toMatchObject({ fact4Disponible: false, entidades: [], cuentasBancarias: [], puedeCambiarRetencion: false });
    expect(listarEntidadesEmisoras).not.toHaveBeenCalled();
  });
});
