import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoria: vi.fn() }));
vi.mock("@/lib/rrhh/colaborador-session", () => ({ getColaboradorSession: vi.fn() }));
vi.mock("@/lib/rrhh/empleados", () => ({ obtenerEmpleado: vi.fn() }));
vi.mock("@/lib/flota/viajes-piloto", () => ({ colaboradorParticipaEnViaje: vi.fn() }));
vi.mock("@/lib/flota/schema", () => ({
  asegurarSchemaFlota: vi.fn(() => Promise.resolve()),
  asegurarSchemaFlotaLectura: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/lib/flota/combustible", () => ({
  registrarCargaCombustible: vi.fn(() => Promise.resolve(1)),
  listarCargasCombustibleViaje: vi.fn(() => Promise.resolve([])),
  obtenerArchivoCargaCombustible: vi.fn(),
}));
vi.mock("@/lib/uploads", async () => {
  const actual = await vi.importActual<typeof import("@/lib/uploads")>("@/lib/uploads");
  return {
    ...actual,
    absPathFromRelative: vi.fn((p: string) => p),
    contentTypeFor: vi.fn(() => "image/jpeg"),
  };
});

import { query } from "@/lib/db";
import { colaboradorParticipaEnViaje } from "@/lib/flota/viajes-piloto";
import { registrarCargaCombustible } from "@/lib/flota/combustible";
import { getColaboradorSession } from "@/lib/rrhh/colaborador-session";
import { obtenerEmpleado } from "@/lib/rrhh/empleados";
import { UploadValidationError } from "@/lib/uploads";
import { GET, POST } from "./route";

const ctx = { params: Promise.resolve({ id: "5" }) };

function formData(fields: Record<string, string>, conFoto = true) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  if (conFoto) form.set("file", new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }), "vale.jpg");
  return form;
}

function req(form: FormData) {
  return new Request("http://localhost/api/portal/viajes/5/combustible", { method: "POST", body: form });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getColaboradorSession).mockResolvedValue(
    { empresaId: 7, empleadoId: 42 } as Awaited<ReturnType<typeof getColaboradorSession>>,
  );
  vi.mocked(obtenerEmpleado).mockResolvedValue(
    { nombre: "Juan Pérez", codigo: "E001" } as unknown as Awaited<ReturnType<typeof obtenerEmpleado>>,
  );
  vi.mocked(colaboradorParticipaEnViaje).mockResolvedValue({ viajeId: 5, planId: 30, estado: "abierto" });
  vi.mocked(query).mockResolvedValue([{ vehiculo_id: 3, piloto_nombre: "Juan Pérez" }] as never);
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/portal/viajes/[id]/combustible", () => {
  it("exige participación en el viaje ANTES de tocar la lib", async () => {
    vi.mocked(colaboradorParticipaEnViaje).mockResolvedValue(null);
    const res = await POST(req(formData({ tipoCombustible: "diesel", galones: "40", monto: "850" })), ctx);
    expect(res.status).toBe(403);
    expect(registrarCargaCombustible).not.toHaveBeenCalled();
  });

  it("viaje NO abierto (ya cerrado) -> 409, sin llamar a la lib", async () => {
    vi.mocked(colaboradorParticipaEnViaje).mockResolvedValue({ viajeId: 5, planId: 30, estado: "cerrado" });
    const res = await POST(req(formData({ tipoCombustible: "diesel", galones: "40", monto: "850" })), ctx);
    expect(res.status).toBe(409);
    expect(registrarCargaCombustible).not.toHaveBeenCalled();
  });

  it("tipo de combustible inválido -> 400", async () => {
    const res = await POST(req(formData({ tipoCombustible: "premium", galones: "40", monto: "850" })), ctx);
    expect(res.status).toBe(400);
    expect(registrarCargaCombustible).not.toHaveBeenCalled();
  });

  it("galones <= 0 -> 400", async () => {
    const res = await POST(req(formData({ tipoCombustible: "diesel", galones: "0", monto: "850" })), ctx);
    expect(res.status).toBe(400);
    expect(registrarCargaCombustible).not.toHaveBeenCalled();
  });

  it("monto <= 0 -> 400", async () => {
    const res = await POST(req(formData({ tipoCombustible: "diesel", galones: "40", monto: "0" })), ctx);
    expect(res.status).toBe(400);
    expect(registrarCargaCombustible).not.toHaveBeenCalled();
  });

  it("sin foto del vale -> 400, sin llamar a la lib", async () => {
    const res = await POST(req(formData({ tipoCombustible: "diesel", galones: "40", monto: "850" }, false)), ctx);
    expect(res.status).toBe(400);
    expect(registrarCargaCombustible).not.toHaveBeenCalled();
  });

  it("registra correctamente con km y gasolinera opcionales", async () => {
    const res = await POST(
      req(formData({ tipoCombustible: "diesel", galones: "40", monto: "850.50", km: "12000", gasolinera: "Shell Zona 10" })),
      ctx,
    );
    expect(res.status).toBe(200);
    expect(registrarCargaCombustible).toHaveBeenCalledWith(
      expect.objectContaining({
        empresaId: 7, vehiculoId: 3, viajeId: 5, empleadoId: 42, pilotoNombre: "Juan Pérez",
        tipoCombustible: "diesel", galones: 40, monto: 850.5, km: 12000, gasolinera: "Shell Zona 10",
        username: "portal:E001",
      }),
    );
  });

  it("sin km ni gasolinera -> se pasan como null (no como cadena vacía)", async () => {
    const res = await POST(req(formData({ tipoCombustible: "gasolina", galones: "10", monto: "200" })), ctx);
    expect(res.status).toBe(200);
    expect(registrarCargaCombustible).toHaveBeenCalledWith(
      expect.objectContaining({ km: null, gasolinera: null }),
    );
  });

  it("propaga el status real de UploadValidationError (p.ej. 413), nunca lo esconde como 500", async () => {
    vi.mocked(registrarCargaCombustible).mockRejectedValue(new UploadValidationError("Archivo demasiado grande.", 413));
    const res = await POST(req(formData({ tipoCombustible: "diesel", galones: "40", monto: "850" })), ctx);
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error).toBe("Archivo demasiado grande.");
  });

  it("una excepción no controlada se captura y responde JSON {error}, nunca un 500 sin cuerpo", async () => {
    vi.mocked(registrarCargaCombustible).mockRejectedValue(new Error("fallo real de DB"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await POST(req(formData({ tipoCombustible: "diesel", galones: "40", monto: "850" })), ctx);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(typeof body.error).toBe("string");
    errorSpy.mockRestore();
  });
});

describe("GET /api/portal/viajes/[id]/combustible", () => {
  it("exige participación en el viaje", async () => {
    vi.mocked(colaboradorParticipaEnViaje).mockResolvedValue(null);
    const res = await GET(new Request("http://localhost/x"), ctx);
    expect(res.status).toBe(403);
  });

  it("lista las cargas propias del viaje con su url de foto", async () => {
    const { listarCargasCombustibleViaje } = await import("@/lib/flota/combustible");
    vi.mocked(listarCargasCombustibleViaje).mockResolvedValue([
      { id: 1, viajeId: 5, tipoCombustible: "diesel", galones: 40, monto: 850.5, km: 12000, gasolinera: "Shell Zona 10", nombreArchivo: "vale.jpg", estado: "PENDIENTE", motivoRechazo: null, creadoPor: "portal:E001", creadoEn: "2026-09-03 10:00:00" },
    ]);
    const res = await GET(new Request("http://localhost/x"), ctx);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.cargas[0].url).toBe("/api/portal/viajes/5/combustible?adjuntoId=1");
  });
});
