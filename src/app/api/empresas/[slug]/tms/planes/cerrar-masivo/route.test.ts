import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/tenant", () => ({ requireTenantViajesCerrar: vi.fn() }));
vi.mock("@/lib/tms/cierre-masivo", () => ({ MAX_PLANES_CIERRE_MASIVO: 200, cerrarViajesMasivo: vi.fn() }));

import { requireTenantViajesCerrar } from "@/lib/tenant";
import { cerrarViajesMasivo } from "@/lib/tms/cierre-masivo";
import { POST } from "./route";

const ctx = { params: Promise.resolve({ slug: "acme" }) };
const post = (body: unknown) => POST(new Request("http://x/api", { method: "POST", body: JSON.stringify(body) }), ctx);
const resultado = { tipo: "NORMAL", solicitados: 1, cerrados: [{ id: 1, codigo: "P-1" }], omitidos: [], errores: [] };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantViajesCerrar).mockResolvedValue({ session: { username: "jefe" }, empresa: { id: 7 } } as never);
  vi.mocked(cerrarViajesMasivo).mockResolvedValue(resultado as never);
});

describe("POST /tms/planes/cerrar-masivo — seguridad", () => {
  it("exige viajes_cerrar:editar; sin permiso devuelve el error del guard y no cierra nada", async () => {
    vi.mocked(requireTenantViajesCerrar).mockResolvedValue({ error: NextResponse.json({ error: "Sin permiso" }, { status: 403 }) } as never);
    expect((await post({ tipo: "NORMAL", planIds: [1] })).status).toBe(403);
    expect(requireTenantViajesCerrar).toHaveBeenCalledWith("acme", "editar");
    expect(cerrarViajesMasivo).not.toHaveBeenCalled();
  });

  it("la empresa y el usuario salen de la sesión; un empresa_id en el cuerpo se RECHAZA (esquema estricto)", async () => {
    expect((await post({ tipo: "NORMAL", planIds: [1], empresa_id: 99 })).status).toBe(400);
    expect((await post({ tipo: "NORMAL", planIds: [1], empresaId: 99 })).status).toBe(400);
    expect(cerrarViajesMasivo).not.toHaveBeenCalled();
    await post({ tipo: "NORMAL", planIds: [1, 2], grupo: "2026-09-23" });
    expect(cerrarViajesMasivo).toHaveBeenCalledWith({ empresaId: 7, usuario: "jefe", tipo: "NORMAL", planIds: [1, 2], motivo: undefined, comentario: null, grupo: "2026-09-23" });
  });

  it("devuelve el resumen { cerrados, omitidos, errores } sin caché", async () => {
    const r = await post({ tipo: "NORMAL", planIds: [1] });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ cerrados: [{ id: 1, codigo: "P-1" }], omitidos: [], errores: [] });
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
  });
});

describe("POST /tms/planes/cerrar-masivo — validación estricta del cuerpo", () => {
  it("NORMAL no acepta motivo ni comentario", async () => {
    expect((await post({ tipo: "NORMAL", planIds: [1], motivo: "no debería" })).status).toBe(400);
    expect((await post({ tipo: "NORMAL", planIds: [1], comentario: "x" })).status).toBe(400);
    expect(cerrarViajesMasivo).not.toHaveBeenCalled();
  });

  it("MANUAL exige motivo común de 5 a 500 caracteres", async () => {
    expect((await post({ tipo: "MANUAL", planIds: [1] })).status).toBe(400);
    expect((await post({ tipo: "MANUAL", planIds: [1], motivo: "abcd" })).status).toBe(400);
    expect((await post({ tipo: "MANUAL", planIds: [1], motivo: "    ab   " })).status).toBe(400); // se recorta antes de medir
    expect((await post({ tipo: "MANUAL", planIds: [1], motivo: "x".repeat(501) })).status).toBe(400);
    expect(cerrarViajesMasivo).not.toHaveBeenCalled();
    expect((await post({ tipo: "MANUAL", planIds: [1], motivo: "abcde" })).status).toBe(200);
    expect((await post({ tipo: "MANUAL", planIds: [1], motivo: "x".repeat(500) })).status).toBe(200);
  });

  it("comentario opcional, máximo 1000; vacío se envía como null", async () => {
    expect((await post({ tipo: "MANUAL", planIds: [1], motivo: "Motivo común", comentario: "y".repeat(1001) })).status).toBe(400);
    expect(cerrarViajesMasivo).not.toHaveBeenCalled();
    await post({ tipo: "MANUAL", planIds: [1], motivo: "  Motivo común  ", comentario: "   " });
    expect(cerrarViajesMasivo).toHaveBeenLastCalledWith(expect.objectContaining({ tipo: "MANUAL", motivo: "Motivo común", comentario: null }));
    await post({ tipo: "MANUAL", planIds: [1], motivo: "Motivo común", comentario: "Detalle" });
    expect(cerrarViajesMasivo).toHaveBeenLastCalledWith(expect.objectContaining({ comentario: "Detalle" }));
    expect((await post({ tipo: "MANUAL", planIds: [1], motivo: "Motivo común", comentario: "y".repeat(1000) })).status).toBe(200);
  });

  it("planIds: obligatorio, no vacío, enteros positivos y máximo razonable (200)", async () => {
    for (const planIds of [undefined, [], [0], [-1], [1.5], ["1"], Array.from({ length: 201 }, (_, i) => i + 1)]) {
      expect((await post({ tipo: "NORMAL", planIds })).status).toBe(400);
    }
    expect(cerrarViajesMasivo).not.toHaveBeenCalled();
    expect((await post({ tipo: "NORMAL", planIds: Array.from({ length: 200 }, (_, i) => i + 1) })).status).toBe(200);
  });

  it("tipo desconocido, cuerpo vacío o no JSON -> 400; grupo con formato inválido -> 400", async () => {
    expect((await post({ tipo: "OTRO", planIds: [1] })).status).toBe(400);
    expect((await post({ planIds: [1] })).status).toBe(400);
    expect((await POST(new Request("http://x/api", { method: "POST", body: "no json" }), ctx)).status).toBe(400);
    expect((await post({ tipo: "NORMAL", planIds: [1], grupo: "23/09/2026" })).status).toBe(400);
    expect(cerrarViajesMasivo).not.toHaveBeenCalled();
  });
});
