import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantModulo: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/tms/viaticos", () => ({ actualizarMontoViatico: vi.fn() }));
vi.mock("@/lib/tms/fondos-diarios", () => ({ fondosDiariosInstalado: vi.fn(), sincronizarFondosDePlanes: vi.fn() }));

import { requireTenantModulo } from "@/lib/tenant";
import { query } from "@/lib/db";
import { actualizarMontoViatico } from "@/lib/tms/viaticos";
import { fondosDiariosInstalado, sincronizarFondosDePlanes } from "@/lib/tms/fondos-diarios";
import { PATCH } from "./route";

const ctx = { params: Promise.resolve({ slug: "monaco", id: "7" }) };
const peticion = (b: unknown) => new Request("http://x", { method: "PATCH", body: JSON.stringify(b) });

describe("PATCH /tms/viaticos/[id]: el monto editado se refleja en Solicitudes de fondo", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requireTenantModulo).mockResolvedValue({ session: { id: 41, username: "ops", nombre: "Ops" }, empresa: { id: 1, slug: "monaco" } } as never);
    vi.mocked(actualizarMontoViatico).mockResolvedValue({ ok: true });
    vi.mocked(query).mockResolvedValue([{ plan_id: 99 }] as never);
    vi.mocked(fondosDiariosInstalado).mockResolvedValue(true);
    vi.mocked(sincronizarFondosDePlanes).mockResolvedValue({ cambios: 1, solicitudes: [5] });
  });

  it("tras actualizar el monto sincroniza SOLO el viaje de ese viático, con la empresa de la sesión", async () => {
    const r = await PATCH(peticion({ montoAsignado: 80, motivoCambio: "ajuste" }), ctx);
    expect(r.status).toBe(200);
    expect(sincronizarFondosDePlanes).toHaveBeenCalledTimes(1);
    expect(sincronizarFondosDePlanes).toHaveBeenCalledWith(1, [99], { usuarioId: 41, nombre: "Ops", username: "ops" });
    expect(vi.mocked(query).mock.calls[0][1]).toEqual([7, 1]);   // el viático se busca dentro de la empresa
  });
  it("si el monto se rechaza (viático ya autorizado, sin motivo…) NO sincroniza", async () => {
    vi.mocked(actualizarMontoViatico).mockResolvedValue({ ok: false, error: "Este viático ya está AUTORIZADO" } as never);
    const r = await PATCH(peticion({ montoAsignado: 80 }), ctx);
    expect(r.status).toBe(400);
    expect(sincronizarFondosDePlanes).not.toHaveBeenCalled();
  });
  it("sin la migración de fondos diarios no sincroniza y el monto se guarda igual", async () => {
    vi.mocked(fondosDiariosInstalado).mockResolvedValue(false);
    expect((await PATCH(peticion({ montoAsignado: 80 }), ctx)).status).toBe(200);
    expect(sincronizarFondosDePlanes).not.toHaveBeenCalled();
  });
  it("un fallo de la sincronización no revierte el monto: responde 200 con la advertencia (o sin ella si hubo excepción)", async () => {
    vi.mocked(sincronizarFondosDePlanes).mockResolvedValue({ cambios: 0, solicitudes: [], advertencia: "aviso" });
    expect(await (await PATCH(peticion({ montoAsignado: 80 }), ctx)).json()).toMatchObject({ mensaje: "Viático actualizado.", advertenciaFondos: "aviso" });
    vi.mocked(sincronizarFondosDePlanes).mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await PATCH(peticion({ montoAsignado: 80 }), ctx)).status).toBe(200);
  });
  it("sin permiso (guarda) no hace nada", async () => {
    vi.mocked(requireTenantModulo).mockResolvedValue({ error: new Response("no", { status: 403 }) } as never);
    expect((await PATCH(peticion({ montoAsignado: 80 }), ctx)).status).toBe(403);
    expect(actualizarMontoViatico).not.toHaveBeenCalled(); expect(sincronizarFondosDePlanes).not.toHaveBeenCalled();
  });
});
