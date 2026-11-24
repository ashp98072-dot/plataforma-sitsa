import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantViaticosAutorizar: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/tms/viaticos", () => ({ rechazarViatico: vi.fn() }));
vi.mock("@/lib/tms/fondos-diarios", () => ({ fondosDiariosInstalado: vi.fn(), sincronizarFondosDePlanes: vi.fn() }));

import { requireTenantViaticosAutorizar } from "@/lib/tenant";
import { query } from "@/lib/db";
import { rechazarViatico } from "@/lib/tms/viaticos";
import { fondosDiariosInstalado, sincronizarFondosDePlanes } from "@/lib/tms/fondos-diarios";
import { POST } from "./route";

const ctx = { params: Promise.resolve({ slug: "monaco", id: "7" }) };
const peticion = () => new Request("http://x", { method: "POST", body: JSON.stringify({ motivoRechazo: "Monto no corresponde al viaje" }) });

describe("POST /tms/viaticos/[id]/rechazar: el rechazo retira la línea automática de la solicitud", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(requireTenantViaticosAutorizar).mockResolvedValue({ session: { id: 41, username: "jefe", nombre: "Jefe" }, empresa: { id: 1, slug: "monaco" } } as never);
    vi.mocked(rechazarViatico).mockResolvedValue({ ok: true });
    vi.mocked(query).mockResolvedValue([{ plan_id: 99 }] as never);
    vi.mocked(fondosDiariosInstalado).mockResolvedValue(true);
    vi.mocked(sincronizarFondosDePlanes).mockResolvedValue({ cambios: 1, solicitudes: [5] });
  });

  it("rechazo correcto: sincroniza el viaje de ese viático con la empresa de la sesión y responde sin advertencia", async () => {
    const r = await POST(peticion(), ctx);
    expect(r.status).toBe(200); expect(await r.json()).toEqual({ mensaje: "Viático rechazado." });
    expect(sincronizarFondosDePlanes).toHaveBeenCalledTimes(1);
    expect(sincronizarFondosDePlanes).toHaveBeenCalledWith(1, [99], { usuarioId: 41, nombre: "Jefe", username: "jefe" });
    expect(vi.mocked(query).mock.calls[0][1]).toEqual([7, 1]);
  });
  it("rechazo NO realizado (estado distinto de PROGRAMADO, motivo corto…): no sincroniza y conserva el error", async () => {
    vi.mocked(rechazarViatico).mockResolvedValue({ ok: false, error: "Este viático está AUTORIZADO", status: 409 });
    const r = await POST(peticion(), ctx);
    expect(r.status).toBe(409); expect(sincronizarFondosDePlanes).not.toHaveBeenCalled();
  });
  it("rechazo correcto pero la sincronización falla (advertencia, excepción, viaje no ubicable, detección): 200 CON advertenciaFondos, nunca éxito silencioso", async () => {
    vi.mocked(sincronizarFondosDePlanes).mockResolvedValue({ cambios: 0, solicitudes: [], advertencia: "x" });
    expect(await (await POST(peticion(), ctx)).json()).toMatchObject({ mensaje: "Viático rechazado.", advertenciaFondos: expect.stringContaining("necesita resincronización") });
    vi.mocked(sincronizarFondosDePlanes).mockRejectedValue(new Error("boom"));
    const r = await POST(peticion(), ctx); expect(r.status).toBe(200); expect(await r.json()).toHaveProperty("advertenciaFondos");
    vi.mocked(query).mockResolvedValue([] as never);
    expect(await (await POST(peticion(), ctx)).json()).toHaveProperty("advertenciaFondos");
    vi.mocked(fondosDiariosInstalado).mockRejectedValue(new Error("sonda"));
    expect(await (await POST(peticion(), ctx)).json()).toHaveProperty("advertenciaFondos");
  });
  it("sin la migración de fondos diarios no hay solicitudes que actualizar: sin sincronizar y sin advertencia", async () => {
    vi.mocked(fondosDiariosInstalado).mockResolvedValue(false);
    expect(await (await POST(peticion(), ctx)).json()).toEqual({ mensaje: "Viático rechazado." });
    expect(sincronizarFondosDePlanes).not.toHaveBeenCalled();
  });
  it("sin el permiso exacto viaticos_autorizar:editar no hace nada", async () => {
    vi.mocked(requireTenantViaticosAutorizar).mockResolvedValue({ error: new Response("no", { status: 403 }) } as never);
    expect((await POST(peticion(), ctx)).status).toBe(403);
    expect(rechazarViatico).not.toHaveBeenCalled(); expect(sincronizarFondosDePlanes).not.toHaveBeenCalled();
  });
});
