import { beforeEach, expect, it, vi, describe } from "vitest";
const m = vi.hoisted(() => ({ tenant: vi.fn(), permisos: vi.fn(), autorizar: vi.fn(), rechazar: vi.fn(), firma: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenant: m.tenant }));
vi.mock("@/lib/permisos", async original => ({ ...await original<typeof import("@/lib/permisos")>(), permisosEfectivos: m.permisos }));
vi.mock("./requerimientos", async original => ({
  ...(await original<typeof import("./requerimientos")>()),
  autorizarRequerimientoCompra: m.autorizar,
  rechazarRequerimientoCompra: m.rechazar,
}));
vi.mock("@/lib/firmas/usuario-firmas", () => ({ leerBytesFirmaGuardada: m.firma }));
import { requerimientoEstadoCambiar } from "./requerimiento-estado-api";
import { ErrorCompra, MENSAJE_FIRMA_REQUERIDA_AUTORIZAR } from "./requerimientos";
import type { PermisoModulo } from "@/lib/permisos-shared";

/**
 * COMPRAS-FASE-4-AUTORIZACION — capa HTTP. Mismo patrón de mocking que
 * requerimiento-api.test.ts (mockea @/lib/tenant + @/lib/permisos, así
 * también ejerce la lógica REAL de requireComprasAutorizar en acceso.ts,
 * no solo el wrapper).
 */
const requerimientoDetalle = { id: 12, codigo: "RC-2026-000012", estado: "Autorizada", version: 3, lineas: [] };
const req = (body: unknown) => new Request("https://example.test/api", { method: "POST", body: JSON.stringify(body) });

let permisos: PermisoModulo[];
beforeEach(() => {
  vi.resetAllMocks();
  permisos = [{ modulo: "compras_autorizar", puedeVer: true, puedeCrear: true, puedeEditar: true, puedeEliminar: true }];
  m.permisos.mockImplementation(async () => permisos);
  m.tenant.mockResolvedValue({ empresa: { id: 1, modulos: ["tms"] }, session: { id: 8, username: "admin1", nombre: "Autorizante Real", rol: "Admin" } });
  m.firma.mockResolvedValue({ bytes: new ArrayBuffer(3), original: "firma.png" });
  m.autorizar.mockResolvedValue(requerimientoDetalle);
  m.rechazar.mockResolvedValue({ ...requerimientoDetalle, estado: "Rechazada" });
});

it("autorizar: 200, pasa identidad de SESIÓN (nunca del body) a la lib", async () => {
  const res = await requerimientoEstadoCambiar(req({ accion: "autorizar", version: 3 }), "a", "12");
  expect(res.status).toBe(200);
  expect(m.autorizar).toHaveBeenCalledWith(1, 12, 3, expect.objectContaining({
    usuario: "admin1", autorizanteUsuarioId: 8, autorizanteNombre: "Autorizante Real", autorizanteRol: "Admin",
  }));
});

it("el body NO puede falsificar autorizante_usuario_id/autorizante_nombre — el schema los rechaza (unrecognized_keys)", async () => {
  const res = await requerimientoEstadoCambiar(
    req({ accion: "autorizar", version: 3, autorizante_usuario_id: 999, autorizante_nombre: "Suplantado" }),
    "a", "12",
  );
  expect(res.status).toBe(400);
  expect(m.autorizar).not.toHaveBeenCalled();
});

// COMPRAS-NOTIFICACIONES Parte D: solo este endpoint, ya DESPUÉS del
// guard requireComprasAutorizar(slug, "editar"), puede otorgar
// permitirAutoautorizacion — y siempre como literal fijo, nunca leído
// del body (el schema .strict() ni siquiera lo admite como campo).
it("autorizar: SIEMPRE pasa permitirAutoautorizacion: true a la lib, ya que este endpoint corre después del guard de permiso", async () => {
  const res = await requerimientoEstadoCambiar(req({ accion: "autorizar", version: 3 }), "a", "12");
  expect(res.status).toBe(200);
  expect(m.autorizar).toHaveBeenCalledWith(1, 12, 3, expect.objectContaining({ permitirAutoautorizacion: true }));
});

it("el body NO puede desactivar ni tocar permitirAutoautorizacion — campo no reconocido por el schema (.strict())", async () => {
  const res = await requerimientoEstadoCambiar(
    req({ accion: "autorizar", version: 3, permitirAutoautorizacion: false }),
    "a", "12",
  );
  expect(res.status).toBe(400);
  expect(m.autorizar).not.toHaveBeenCalled();
});

it("sin firma registrada -> 400 con el mensaje fijo propagado (la validación real vive en autorizarRequerimientoCompra, ver requerimiento-estado.test.ts)", async () => {
  m.firma.mockResolvedValue(null);
  // autorizarRequerimientoCompra está mockeada en este archivo (capa HTTP
  // pura) — se simula aquí el mismo rechazo que la función REAL lanza
  // cuando opts.firmaImagen es null, para verificar que esta capa
  // propaga ErrorCompra(400) correctamente como respuesta HTTP.
  m.autorizar.mockRejectedValue(new ErrorCompra(MENSAJE_FIRMA_REQUERIDA_AUTORIZAR, 400));
  const res = await requerimientoEstadoCambiar(req({ accion: "autorizar", version: 3 }), "a", "12");
  expect(res.status).toBe(400);
  const data = await res.json();
  expect(data.error).toBe(MENSAJE_FIRMA_REQUERIDA_AUTORIZAR);
  // Confirma que SÍ se llegó a invocar la lib pasando firmaImagen: null
  // (leído de leerBytesFirmaGuardada), no que se cortó antes por error.
  expect(m.autorizar).toHaveBeenCalledWith(1, 12, 3, expect.objectContaining({ firmaImagen: null }));
});

it("rechazar: 200, exige motivo (schema), pasa usuarioId de sesión para auditoría", async () => {
  const res = await requerimientoEstadoCambiar(req({ accion: "rechazar", version: 3, motivo: "Sin presupuesto" }), "a", "12");
  expect(res.status).toBe(200);
  expect(m.rechazar).toHaveBeenCalledWith(1, 12, 3, { usuario: "admin1", usuarioId: 8, motivo: "Sin presupuesto" });
  expect(m.firma).not.toHaveBeenCalled();
});

it("rechazar sin motivo -> 400, nunca llega a la lib", async () => {
  const res = await requerimientoEstadoCambiar(req({ accion: "rechazar", version: 3, motivo: "" }), "a", "12");
  expect(res.status).toBe(400);
  expect(m.rechazar).not.toHaveBeenCalled();
});

it("rechaza campos extra en cualquiera de las dos ramas (.strict())", async () => {
  const res1 = await requerimientoEstadoCambiar(req({ accion: "autorizar", version: 3, extra: 1 }), "a", "12");
  expect(res1.status).toBe(400);
  const res2 = await requerimientoEstadoCambiar(req({ accion: "rechazar", version: 3, motivo: "x", extra: 1 }), "a", "12");
  expect(res2.status).toBe(400);
});

it("accion desconocida -> 400", async () => {
  const res = await requerimientoEstadoCambiar(req({ accion: "reabrir", version: 3 }), "a", "12");
  expect(res.status).toBe(400);
});

// Admin siempre pasa el guard (bypass explícito de requireComprasAutorizar,
// ver acceso.ts) — estos tests de denegación usan un rol NO-Admin para
// ejercer la verificación real de tienePermiso(permisos, "compras_autorizar", ...).
function comoNoAdmin() {
  m.tenant.mockResolvedValue({ empresa: { id: 1, modulos: ["tms"] }, session: { id: 8, username: "operador", nombre: "Operador", rol: "Operaciones" } });
}

it("sin permiso compras_autorizar:editar -> 403, nunca consulta firma ni llama a la lib", async () => {
  comoNoAdmin();
  permisos = [{ modulo: "compras_requerimientos", puedeVer: true, puedeCrear: true, puedeEditar: true, puedeEliminar: true }];
  const res = await requerimientoEstadoCambiar(req({ accion: "autorizar", version: 3 }), "a", "12");
  expect(res.status).toBe(403);
  expect(m.firma).not.toHaveBeenCalled();
  expect(m.autorizar).not.toHaveBeenCalled();
});

it("compras_requerimientos:editar NO basta para autorizar (permiso independiente exigido explícitamente)", async () => {
  comoNoAdmin();
  permisos = [{ modulo: "compras_requerimientos", puedeVer: true, puedeCrear: true, puedeEditar: true, puedeEliminar: true }];
  const res = await requerimientoEstadoCambiar(req({ accion: "rechazar", version: 3, motivo: "x" }), "a", "12");
  expect(res.status).toBe(403);
});

it("tms:editar NO basta para autorizar", async () => {
  comoNoAdmin();
  permisos = [{ modulo: "tms", puedeVer: true, puedeCrear: true, puedeEditar: true, puedeEliminar: true }];
  const res = await requerimientoEstadoCambiar(req({ accion: "autorizar", version: 3 }), "a", "12");
  expect(res.status).toBe(403);
});

it("Admin pasa siempre, sin depender de que su fila de permisos ya tenga compras_autorizar sincronizado", async () => {
  permisos = [];
  m.tenant.mockResolvedValue({ empresa: { id: 1, modulos: ["tms"] }, session: { id: 1, username: "root", nombre: "Root", rol: "Admin" } });
  const res = await requerimientoEstadoCambiar(req({ accion: "autorizar", version: 3 }), "a", "12");
  expect(res.status).toBe(200);
});

it("id inválido -> 404 sin consultar permisos adicionales ni la lib", async () => {
  const res = await requerimientoEstadoCambiar(req({ accion: "autorizar", version: 3 }), "a", "0");
  expect(res.status).toBe(404);
  expect(m.autorizar).not.toHaveBeenCalled();
});

it("requerimiento no encontrado (lib devuelve null) -> 404", async () => {
  m.autorizar.mockResolvedValue(null);
  const res = await requerimientoEstadoCambiar(req({ accion: "autorizar", version: 3 }), "a", "12");
  expect(res.status).toBe(404);
});

it("versión vieja -> 409 con el mensaje de ErrorCompra propagado tal cual", async () => {
  m.autorizar.mockRejectedValue(new ErrorCompra("El requerimiento fue modificado por otro usuario. Actualiza la información.", 409));
  const res = await requerimientoEstadoCambiar(req({ accion: "autorizar", version: 3 }), "a", "12");
  expect(res.status).toBe(409);
  expect((await res.json()).error).toBe("El requerimiento fue modificado por otro usuario. Actualiza la información.");
});

it("error interno inesperado -> 500 genérico, sin exponer detalle", async () => {
  m.autorizar.mockRejectedValue(new Error("detalle interno de MySQL"));
  const res = await requerimientoEstadoCambiar(req({ accion: "autorizar", version: 3 }), "a", "12");
  expect(res.status).toBe(500);
  expect(JSON.stringify(await res.json())).not.toContain("MySQL");
});

it("toda respuesta declara Cache-Control: private, no-store, incluida la del guard 403", async () => {
  permisos = [];
  const res = await requerimientoEstadoCambiar(req({ accion: "autorizar", version: 3 }), "a", "12");
  expect(res.headers.get("Cache-Control")).toBe("private, no-store");
});

describe("tenant isolation", () => {
  it("usa el empresa.id resuelto por el tenant, no uno enviado por el cliente", async () => {
    m.tenant.mockResolvedValue({ empresa: { id: 77, modulos: ["tms"] }, session: { id: 8, username: "admin1", nombre: "Autorizante", rol: "Admin" } });
    await requerimientoEstadoCambiar(req({ accion: "autorizar", version: 3 }), "a", "12");
    expect(m.autorizar).toHaveBeenCalledWith(77, 12, 3, expect.anything());
  });
});
