import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantViaticosAny: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/firmas/firmas-lectura", () => ({ listarFirmasViatico: vi.fn() }));

import { requireTenantViaticosAny } from "@/lib/tenant";
import { query } from "@/lib/db";
import { listarFirmasViatico } from "@/lib/firmas/firmas-lectura";
import { GET } from "./route";

const ctx = { params: Promise.resolve({ slug: "prueba", id: "10" }) };

const FIRMA_AUTORIZACION = {
  id: 1,
  accion: "AUTORIZAR_VIATICO",
  codigoFirma: "SIG-20260831-AAAA1111",
  fechaHoraServidor: "2026-08-31 08:15:00",
  metodo: "FIRMA_MANUSCRITA",
  usuarioId: 3,
  empleadoId: null,
  nombreFirmante: "Juan Pérez",
  rolFirmante: "Jefe de Operaciones",
  origenFirma: "DIBUJADA" as const,
  tieneImagen: true,
  hashPayload: "a".repeat(64),
};

const FIRMA_LIQUIDACION = {
  ...FIRMA_AUTORIZACION,
  id: 2,
  accion: "LIQUIDAR_VIATICO",
  codigoFirma: "SIG-20260831-BBBB2222",
  fechaHoraServidor: "2026-08-31 17:00:00",
  metodo: "PASSWORD",
  nombreFirmante: "María López",
  rolFirmante: "Facturador",
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantViaticosAny).mockResolvedValue(
    { empresa: { id: 7 }, session: { id: 3, username: "jefe1", nombre: "Ana López", rol: "JefeOperaciones" } } as Awaited<ReturnType<typeof requireTenantViaticosAny>>,
  );
  vi.mocked(query).mockResolvedValue([{ id: 10 }] as unknown as Awaited<ReturnType<typeof query>>);
});
afterEach(() => vi.restoreAllMocks());

describe("GET /tms/viaticos/[id]/firmas", () => {
  it("10) exige tenant/permiso ANTES de tocar la base de datos", async () => {
    vi.mocked(requireTenantViaticosAny).mockResolvedValue({ error: new Response(null, { status: 403 }) } as Awaited<ReturnType<typeof requireTenantViaticosAny>>);
    const res = await GET(new Request("http://localhost/x"), ctx);
    expect(res.status).toBe(403);
    expect(query).not.toHaveBeenCalled();
    expect(listarFirmasViatico).not.toHaveBeenCalled();
  });

  it("valida que el viático pertenece a la empresa (empresaId de la SESIÓN, nunca del cliente) -> 404 si no existe", async () => {
    vi.mocked(query).mockResolvedValue([] as unknown as Awaited<ReturnType<typeof query>>);
    const res = await GET(new Request("http://localhost/x"), ctx);
    expect(res.status).toBe(404);
    expect(listarFirmasViatico).not.toHaveBeenCalled();
    const [, params] = vi.mocked(query).mock.calls[0];
    expect(params).toEqual([10, 7]);
  });

  it("11) devuelve la firma de autorización cuando existe", async () => {
    vi.mocked(listarFirmasViatico).mockResolvedValue([FIRMA_AUTORIZACION]);
    const res = await GET(new Request("http://localhost/x"), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.firmas).toHaveLength(1);
    expect(body.firmas[0].accion).toBe("AUTORIZAR_VIATICO");
    expect(listarFirmasViatico).toHaveBeenCalledWith(7, 10);
  });

  it("12) devuelve la firma de liquidación cuando existe (además de la de autorización)", async () => {
    vi.mocked(listarFirmasViatico).mockResolvedValue([FIRMA_AUTORIZACION, FIRMA_LIQUIDACION]);
    const res = await GET(new Request("http://localhost/x"), ctx);
    const body = await res.json();
    expect(body.firmas).toHaveLength(2);
    expect(body.firmas.map((f: { accion: string }) => f.accion)).toEqual(["AUTORIZAR_VIATICO", "LIQUIDAR_VIATICO"]);
  });

  it("16) viático sin firmas -> [] (200, no error)", async () => {
    vi.mocked(listarFirmasViatico).mockResolvedValue([]);
    const res = await GET(new Request("http://localhost/x"), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.firmas).toEqual([]);
  });

  it("14/15) el listado devuelto por el endpoint nunca incluye imagen_ruta/ip/user_agent/sesion_id (la lib ya no los expone)", async () => {
    vi.mocked(listarFirmasViatico).mockResolvedValue([FIRMA_AUTORIZACION]);
    const res = await GET(new Request("http://localhost/x"), ctx);
    const body = await res.json();
    const firma = body.firmas[0];
    expect(firma.imagenRuta).toBeUndefined();
    expect(firma.ip).toBeUndefined();
    expect(firma.userAgent).toBeUndefined();
    expect(firma.sesionId).toBeUndefined();
    expect(firma.payloadCanonico).toBeUndefined();
  });

  it("ID inválido -> 400, sin tocar la base de datos", async () => {
    const res = await GET(new Request("http://localhost/x"), { params: Promise.resolve({ slug: "prueba", id: "abc" }) });
    expect(res.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it("500 real: una excepción no controlada se captura y responde JSON {error}, nunca un 500 sin cuerpo", async () => {
    vi.mocked(listarFirmasViatico).mockRejectedValue(new Error("fallo real de DB"));
    const res = await GET(new Request("http://localhost/x"), ctx);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(typeof body.error).toBe("string");
  });
});
