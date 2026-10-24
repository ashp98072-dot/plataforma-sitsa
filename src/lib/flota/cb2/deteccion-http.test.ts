import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ guard: vi.fn(), preview: vi.fn(), confirmar: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenantFlotaCombustible: m.guard }));
vi.mock("./service", () => ({ preview: m.preview, confirmarArchivo: m.confirmar }));
import { cb2Http } from "./http";
import { archivoDeteccion } from "./detectar-formato.fixture";
import type { PerfilProveedor } from "../combustible-importacion-v2-types";
beforeEach(() => {
    m.guard.mockResolvedValue({ empresa: { id: 7 }, session: { id: 9, username: "demo", rol: "Admin" } });
    m.preview.mockResolvedValue({ sha256: "a".repeat(64), filas: [], token: "recibo", nota: "fixture" });
    m.confirmar.mockResolvedValue({ eventos: [] });
});
async function enviar(buffer: Buffer, accion: "preview" | "confirmar", declarado?: string, nombre = "formato-contrario.xlsx") {
    const f = new FormData(); f.set("file", new File([new Uint8Array(buffer)], nombre)); f.set("proveedorId", "83"); f.set("moneda", "USD"); f.set("seleccion", "[]");
    if (declarado !== undefined) f.set("perfil", declarado);
    if (accion === "confirmar") { f.set("clave", "clave-sintetica-001"); f.set("token", "recibo"); }
    return cb2Http(new Request(`http://localhost/${accion}`, { method: "POST", headers: { Origin: "http://localhost" }, body: f }), "demo", accion);
}

it.each(["HALEL", "SHELL"] as const)("preview detecta %s sin perfil, sin usar el nombre ni asignar proveedor", async perfil => {
    const buffer = await archivoDeteccion([perfil]);
    for (const declarado of [undefined, perfil]) {
        const r = await enviar(buffer, "preview", declarado, perfil === "HALEL" ? "CONSUMOS SHELL.xlsx" : "REPORTE HALEL.xlsx");
        expect(r.status).toBe(200); expect((await r.json()).perfilDetectado).toBe(perfil);
        expect(m.preview).toHaveBeenLastCalledWith(expect.objectContaining({ empresaId: 7, proveedorId: 83 }), buffer, { perfil, moneda: "USD", seleccion: [] });
        expect(r.headers.get("cache-control")).toContain("no-store");
    }
});
it.each(["preview", "confirmar"] as const)("%s no permite forzar otro perfil ni aceptar una mezcla", async accion => {
    for (const perfil of ["SHELL", "AUTO", "HALEL FALSO"]) {
        expect((await enviar(await archivoDeteccion(["HALEL"]), accion, perfil)).status).toBe(400);
    }
    expect((await enviar(await archivoDeteccion(["HALEL", "SHELL"]), accion)).status).toBe(400);
    expect(m.preview).not.toHaveBeenCalled(); expect(m.confirmar).not.toHaveBeenCalled();
});
it.each(["HALEL", "SHELL"] as const)("confirmar vuelve a detectar %s y entrega al servicio el perfil validado", async (perfil: PerfilProveedor) => {
    const buffer = await archivoDeteccion([perfil]);
    expect((await enviar(buffer, "confirmar")).status).toBe(200);
    expect(m.confirmar).toHaveBeenCalledWith(expect.objectContaining({ empresaId: 7, proveedorId: 83 }), buffer, "formato-contrario.xlsx", { perfil, moneda: "USD", seleccion: [] }, "clave-sintetica-001", "recibo");
});
it("permiso y origen se validan antes de detectar o llamar servicios", async () => {
    m.guard.mockResolvedValue({ error: new Response(null, { status: 403 }) });
    expect((await enviar(Buffer.from("archivo dañado"), "preview")).status).toBe(403);
    expect(m.preview).not.toHaveBeenCalled(); expect(m.confirmar).not.toHaveBeenCalled();
});
