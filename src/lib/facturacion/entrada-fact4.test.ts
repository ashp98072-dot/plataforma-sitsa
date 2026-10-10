import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantFacturacion: vi.fn() }));
vi.mock("@/lib/facturacion/contexto-factura", () => ({
  fact4Disponible: vi.fn(),
  leerRetencionIvaCliente: vi.fn(),
  listarEntidadesEmisoras: vi.fn(),
  MENSAJE_FALTA_MIGRACION_FACT4: "Falta aplicar la migración FACT-4 (líneas, condición de pago y retención). No se modificó nada.",
}));

import { requireTenantFacturacion } from "@/lib/tenant";
import { fact4Disponible, leerRetencionIvaCliente, listarEntidadesEmisoras } from "@/lib/facturacion/contexto-factura";
import { resolverEntradaFact4, fact4CamposSchema } from "./entrada-fact4";
import { z } from "zod";

const LINEA = { planIds: [1, 2], cantidad: 2, descripcion: "Flete", precioUnitario: 500, clasificacion: "SERVICIO" as const, precioIncluyeIva: true };
const base = { slug: "prueba", empresaId: 7, clienteId: 20 };
const SIN_PERMISO = { error: new Response(null, { status: 403 }) } as Awaited<ReturnType<typeof requireTenantFacturacion>>;
const CON_PERMISO = { empresa: { id: 7 }, session: { id: 3 } } as unknown as Awaited<ReturnType<typeof requireTenantFacturacion>>;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(fact4Disponible).mockResolvedValue(true);
  vi.mocked(leerRetencionIvaCliente).mockResolvedValue(15);
  vi.mocked(listarEntidadesEmisoras).mockResolvedValue([{ id: 1, codigo: "KT", nombre: "Kuiqtrans" }, { id: 2, codigo: "MON", nombre: "Mónaco" }]);
  vi.mocked(requireTenantFacturacion).mockResolvedValue(SIN_PERMISO);
});

describe("resolverEntradaFact4 — migración ausente y modelo anterior (sin fallback silencioso)", () => {
  it("migración ausente → 503 explícito y no se lee ni se resuelve nada más", async () => {
    vi.mocked(fact4Disponible).mockResolvedValue(false);
    for (const entrada of [
      { lineas: [LINEA], entidadId: 1, condicionPago: "CREDITO" as const },
      { lineas: [LINEA], entidadId: 1, condicionPago: "CONTADO" as const, cuentaBancariaId: 4, retencionIvaPct: 15 },
      {}, // payload del modelo anterior: tampoco se degrada
    ]) {
      const r = await resolverEntradaFact4({ ...base, entrada });
      expect(r).toMatchObject({ ok: false, status: 503, error: expect.stringContaining("migración FACT-4") });
    }
    expect(leerRetencionIvaCliente).not.toHaveBeenCalled();
    expect(listarEntidadesEmisoras).not.toHaveBeenCalled();
    expect(requireTenantFacturacion).not.toHaveBeenCalled();
  });

  it("con la migración aplicada, un payload sin líneas (modelo anterior) → 400: no se acepta ni se degrada", async () => {
    const r = await resolverEntradaFact4({ ...base, entrada: {} });
    expect(r).toMatchObject({ ok: false, status: 400, error: expect.stringContaining("líneas") });
    const r2 = await resolverEntradaFact4({ ...base, entrada: { condicionPago: "CREDITO", entidadId: 1 } });
    expect(r2).toMatchObject({ ok: false, status: 400 });
    expect(leerRetencionIvaCliente).not.toHaveBeenCalled();
  });
});

describe("resolverEntradaFact4 — condición de pago", () => {
  it("con líneas, la condición de pago es obligatoria", async () => {
    const r = await resolverEntradaFact4({ ...base, entrada: { lineas: [LINEA], entidadId: 1 } });
    expect(r).toMatchObject({ ok: false, status: 400, error: expect.stringContaining("condición de pago") });
  });
});

describe("resolverEntradaFact4 — retención de IVA (precarga, permiso, congelado)", () => {
  it("sin retencionIvaPct usa la configurada del cliente y la registra como configurada", async () => {
    const r = await resolverEntradaFact4({ ...base, entrada: { lineas: [LINEA], entidadId: 1, condicionPago: "CREDITO" } });
    expect(r).toMatchObject({ ok: true, datos: { retencionIvaPct: 15, retencionIvaClientePct: 15 } });
    expect(requireTenantFacturacion).not.toHaveBeenCalled();
  });

  it("enviar el MISMO valor configurado no exige permiso", async () => {
    const r = await resolverEntradaFact4({ ...base, entrada: { lineas: [LINEA], entidadId: 1, condicionPago: "CREDITO", retencionIvaPct: 15 } });
    expect(r).toMatchObject({ ok: true, datos: { retencionIvaPct: 15 } });
    expect(requireTenantFacturacion).not.toHaveBeenCalled();
  });

  it("CAMBIAR la retención sin «Editar requisitos de clientes» → 403 (y nada se guarda)", async () => {
    const r = await resolverEntradaFact4({ ...base, entrada: { lineas: [LINEA], entidadId: 1, condicionPago: "CREDITO", retencionIvaPct: 30 } });
    expect(r).toMatchObject({ ok: false, status: 403 });
    expect(requireTenantFacturacion).toHaveBeenCalledWith("prueba", "editar_requisitos");
  });

  it("CAMBIAR la retención con permiso → se aplica 30 y queda registrado que el cliente tiene 15", async () => {
    vi.mocked(requireTenantFacturacion).mockResolvedValue(CON_PERMISO);
    const r = await resolverEntradaFact4({ ...base, entrada: { lineas: [LINEA], entidadId: 1, condicionPago: "CREDITO", retencionIvaPct: 30 } });
    expect(r).toMatchObject({ ok: true, datos: { retencionIvaPct: 30, retencionIvaClientePct: 15 } });
  });

  it("reenviar la retención ya congelada en el borrador no exige permiso", async () => {
    const r = await resolverEntradaFact4({
      ...base, retencionVigente: 30,
      entrada: { lineas: [LINEA], entidadId: 1, condicionPago: "CREDITO", retencionIvaPct: 30 },
    });
    expect(r).toMatchObject({ ok: true, datos: { retencionIvaPct: 30, retencionIvaClientePct: 15 } });
    expect(requireTenantFacturacion).not.toHaveBeenCalled();
  });

  it("solo 0/15/30: 10 y 12 → 400 (aunque el usuario tenga permiso)", async () => {
    vi.mocked(requireTenantFacturacion).mockResolvedValue(CON_PERMISO);
    for (const v of [10, 12, 100, -15]) {
      const r = await resolverEntradaFact4({ ...base, entrada: { lineas: [LINEA], entidadId: 1, condicionPago: "CREDITO", retencionIvaPct: v } });
      expect(r, String(v)).toMatchObject({ ok: false, status: 400 });
    }
  });

  it("cliente sin retención configurada (0) y sin override → 0", async () => {
    vi.mocked(leerRetencionIvaCliente).mockResolvedValue(0);
    const r = await resolverEntradaFact4({ ...base, entrada: { lineas: [LINEA], entidadId: 1, condicionPago: "CREDITO" } });
    expect(r).toMatchObject({ ok: true, datos: { retencionIvaPct: 0, retencionIvaClientePct: 0 } });
  });
});

describe("resolverEntradaFact4 — entidad emisora", () => {
  it("con varias entidades y sin elegir → 400", async () => {
    const r = await resolverEntradaFact4({ ...base, entrada: { lineas: [LINEA], condicionPago: "CREDITO" } });
    expect(r).toMatchObject({ ok: false, status: 400, error: expect.stringContaining("entidad emisora") });
  });

  it("con una sola entidad la usa sin preguntar", async () => {
    vi.mocked(listarEntidadesEmisoras).mockResolvedValue([{ id: 9, codigo: "KT", nombre: "Kuiqtrans" }]);
    const r = await resolverEntradaFact4({ ...base, entrada: { lineas: [LINEA], condicionPago: "CREDITO" } });
    expect(r).toMatchObject({ ok: true, datos: { entidadId: 9 } });
  });

  it("sin entidades configuradas, la entidad emisora es OBLIGATORIA: 400 (no se factura sin entidad)", async () => {
    vi.mocked(listarEntidadesEmisoras).mockResolvedValue([]);
    const r = await resolverEntradaFact4({ ...base, entrada: { lineas: [LINEA], condicionPago: "CREDITO" } });
    expect(r).toMatchObject({ ok: false, status: 400, error: expect.stringContaining("entidades emisoras") });
  });

  it("al contado con banco, la entidad se deriva del banco (no se exige elegirla)", async () => {
    const r = await resolverEntradaFact4({ ...base, entrada: { lineas: [LINEA], condicionPago: "CONTADO", cuentaBancariaId: 4 } });
    expect(r).toMatchObject({ ok: true, datos: { entidadId: null, cuentaBancariaId: 4, condicionPago: "CONTADO" } });
    expect(listarEntidadesEmisoras).not.toHaveBeenCalled();
  });
});

describe("fact4CamposSchema — forma del payload", () => {
  const s = z.object(fact4CamposSchema);
  it("rechaza clasificación inválida, líneas sin viajes, IVA sin booleano y condición desconocida", () => {
    expect(s.safeParse({ lineas: [{ ...LINEA, clasificacion: "OTRO" }] }).success).toBe(false);
    expect(s.safeParse({ lineas: [{ ...LINEA, planIds: [] }] }).success).toBe(false);
    expect(s.safeParse({ lineas: [{ ...LINEA, precioIncluyeIva: "true" }] }).success).toBe(false);
    expect(s.safeParse({ lineas: [{ ...LINEA, precioIncluyeIva: undefined }] }).success).toBe(false);
    expect(s.safeParse({ condicionPago: "LEASING" }).success).toBe(false);
    expect(s.safeParse({ lineas: [] }).success).toBe(false);
  });
  it("acepta un payload completo", () => {
    expect(s.safeParse({ lineas: [LINEA], entidadId: 1, condicionPago: "CONTADO", cuentaBancariaId: 3, retencionIvaPct: 15 }).success).toBe(true);
  });
});
