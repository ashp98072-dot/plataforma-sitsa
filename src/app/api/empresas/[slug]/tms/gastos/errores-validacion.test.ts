import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ERRORES DE VALIDACIÓN CLAROS Y POR LÍNEA — POST /tms/gastos (Gastos operativos). Handler y schema REALES; solo se sustituye la
 * E/S. Soporta modo cabecera (sin `lineas`) y modo líneas ("Línea 1" = campos de arriba).
 */
vi.mock("@/lib/tenant", () => ({ requireTenantGastos: vi.fn() }));
vi.mock("@/lib/tms/gastos", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tms/gastos")>();
  return { ...actual, crearGasto: vi.fn(), listarGastos: vi.fn(() => Promise.resolve([])) };
});

import { requireTenantGastos } from "@/lib/tenant";
import { ErrorGasto, crearGasto, normalizarDestinoPago } from "@/lib/tms/gastos";
import { CAMPOS_DOMINIO_GASTOS } from "@/lib/tms/validacion-fondos-gastos";
import { ErrorDominioFormulario, MENSAJE_ERROR_SERVIDOR, MENSAJE_VALIDACION, conLinea, respuestaDeExcepcion, textoError, type CuerpoErrores, type ErrorFormulario } from "@/lib/validacion-formulario";
import { POST } from "./route";

const ctx = { params: Promise.resolve({ slug: "prueba" }) };
const post = (body: unknown) => POST(new Request("http://x/api", { method: "POST", body: JSON.stringify(body) }), ctx);
const CABECERA = { fechaSolicitud: "2026-10-02", categoria: "Combustible", monto: 100 };
const LINEA = { categoria: "Combustible", monto: 50 };
const textos = async (body: unknown) => {
  const res = await post(body);
  const json = await res.json();
  return { status: res.status, json, textos: ((json.errores ?? []) as ErrorFormulario[]).map(textoError) };
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(requireTenantGastos).mockResolvedValue({ empresa: { id: 7 }, session: { id: 8, username: "ops" } } as Awaited<ReturnType<typeof requireTenantGastos>>);
  vi.mocked(crearGasto).mockResolvedValue({ id: 55 } as never);
});

describe("POST /tms/gastos — validación", () => {
  it("modo cabecera (sin líneas): errores por campo normal, sin número de línea", async () => {
    const r = await textos({ fechaSolicitud: "", categoria: "", monto: 0 });
    expect(r.status).toBe(400);
    expect(r.textos).toEqual([
      "Fecha de solicitud: la fecha es obligatoria.",
      "Categoría: selecciona una categoría.",
      "Monto: debe ser mayor que Q0.",
    ]);
    expect(r.json.errores.every((e: ErrorFormulario) => e.linea === undefined)).toBe(true);
    expect(r.json.error).toBe(MENSAJE_VALIDACION);
  });
  it("17) línea con monto inválido: 'Línea 2 — Monto' (Línea 1 = campos de arriba)", async () => {
    const r = await textos({ ...CABECERA, lineas: [LINEA, { ...LINEA, monto: 0 }] });
    expect(r.textos).toEqual(["Línea 2 — Monto: debe ser mayor que Q0."]);
    expect(r.json.errores[0]).toMatchObject({ campo: "lineas.1.monto", linea: 2 });
  });
  it("18) método de pago inválido y falta de monto en otra línea, todo junto", async () => {
    const r = await textos({ ...CABECERA, lineas: [LINEA, { categoria: "Combustible", metodoPago: "Bitcoin" }, { ...LINEA, metodoPago: "Efectivo", numeroCuentaPago: "x".repeat(81) }] });
    expect(r.textos).toEqual([
      "Línea 2 — Monto: es obligatorio.",
      "Línea 2 — Método de pago: selecciona un método de pago válido.",
      "Línea 3 — Cuenta: no puede superar 80 caracteres.",
    ]);
  });
  it("transferencia móvil sin cuenta: modo cabecera -> «Cuenta», modo líneas -> «Línea N — Cuenta» (junto con los demás errores)", async () => {
    const cab = await textos({ ...CABECERA, metodoPago: "Transferencia móvil", numeroCuentaPago: null });
    expect(cab.textos).toEqual(["Cuenta: es obligatoria para transferencia móvil."]);
    const lin = await textos({ ...CABECERA, lineas: [LINEA, { categoria: "", monto: 0, metodoPago: "Transferencia móvil", numeroCuentaPago: "123" }] });
    expect(lin.textos).toEqual([
      "Línea 2 — Categoría: selecciona una categoría.",
      "Línea 2 — Monto: debe ser mayor que Q0.",
      'Línea 2 — Cuenta: para transferencia móvil debe tener entre 8 y 15 dígitos (puede iniciar con "+").',
    ]);
  });
  it("con empleado y sin cuenta en el payload no se rechaza (el servidor usa el teléfono de RRHH); con cuenta válida tampoco", async () => {
    expect((await post({ ...CABECERA, metodoPago: "Transferencia móvil", empleadoId: 3 })).status).toBe(200);
    expect((await post({ ...CABECERA, metodoPago: "Transferencia móvil", numeroCuentaPago: "+502 1234-5678" })).status).toBe(200);
  });
  it("lista de líneas vacía: se pide al menos una", async () => {
    expect((await textos({ ...CABECERA, lineas: [] })).textos).toEqual(["Líneas de gasto: agrega al menos un elemento."]);
  });
  it("sin monto en modo cabecera conserva su regla («Monto requerido») traducida", async () => {
    const r = await textos({ fechaSolicitud: "2026-10-02", categoria: "Combustible" });
    expect(r.textos).toEqual(["Monto requerido."]);
  });
  it("nunca expone mensajes técnicos ni nombres de propiedades", async () => {
    const r = await textos({ fechaSolicitud: 3, categoria: 9, monto: "mucho", lineas: [{ metodoPago: 5, numeroCuentaPago: 7 }] });
    expect(JSON.stringify(r.json)).not.toMatch(/Invalid|Too small|Too big|expected|received|undefined/);
    expect(r.textos.join(" ")).not.toMatch(/fechaSolicitud|numeroCuentaPago|metodoPago|categoria\b/);
  });
});

describe("POST /tms/gastos — errores de negocio por línea y del servidor", () => {
  it("cuenta de transferencia móvil inválida en la línea 4: indica línea y campo Cuenta", () => {
    let error: unknown;
    try { normalizarDestinoPago("Transferencia móvil", "123"); } catch (e) { error = conLinea(e, 4, "lineas", "Línea", CAMPOS_DOMINIO_GASTOS); }
    const r = respuestaDeExcepcion(error);
    expect(r.status).toBe(400);
    const cuerpo = r.cuerpo as CuerpoErrores;
    expect(cuerpo.errores[0]).toMatchObject({ linea: 4, campo: "lineas.3.numeroCuentaPago", etiqueta: "Cuenta" });
    expect(textoError(cuerpo.errores[0])).toBe("Línea 4 — Cuenta: El número de transferencia móvil debe tener entre 8 y 15 dígitos (puede iniciar con \"+\").");
  });
  it("relación inexistente (empleado) de una línea: 'Línea 3 — …'", () => {
    const e = conLinea(new ErrorDominioFormulario("El empleado indicado no pertenece a esta empresa."), 3, "lineas", "Línea", CAMPOS_DOMINIO_GASTOS);
    const cuerpo = respuestaDeExcepcion(e).cuerpo as CuerpoErrores;
    expect(cuerpo.errores[0]).toMatchObject({ linea: 3, campo: "lineas.2.empleadoId", etiqueta: "Empleado" });
  });
  it("el handler traduce un ErrorValidacionFormulario lanzado por crearGasto a 400 + errores", async () => {
    vi.mocked(crearGasto).mockRejectedValue(conLinea(new ErrorDominioFormulario("El viaje/plan indicado no pertenece a esta empresa."), 2, "lineas", "Línea", CAMPOS_DOMINIO_GASTOS));
    const r = await textos({ ...CABECERA, lineas: [LINEA, LINEA] });
    expect(r.status).toBe(400);
    expect(r.textos).toEqual(["Línea 2 — El viaje/plan indicado no pertenece a esta empresa."]);
  });
  it("error técnico (MySQL) -> 500 genérico, sin SQL ni tablas; el detalle va al log", async () => {
    vi.mocked(crearGasto).mockRejectedValue(Object.assign(new Error("Unknown column 'x' in 'field list'"), { code: "ER_BAD_FIELD_ERROR", errno: 1054, sql: "SELECT x FROM tms_gasto_operativo_lineas" }));
    const res = await post(CABECERA);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: MENSAJE_ERROR_SERVIDOR });
    expect(console.error).toHaveBeenCalled();
  });
  it("ErrorGasto conserva su estado real (403/404/409), no se degrada a 400", async () => {
    for (const [status, msg] of [[403, "No puede autorizar su propio gasto."], [404, "Gasto no encontrado."], [409, "No se puede pasar de \"Autorizado\" a \"Pendiente\"."]] as const) {
      vi.mocked(crearGasto).mockRejectedValueOnce(new ErrorGasto(msg, status));
      const res = await post(CABECERA);
      expect(res.status).toBe(status);
      expect(await res.json()).toEqual({ error: msg });
    }
  });
  it("error INESPERADO de programación (Error normal): 500 genérico, sin su mensaje", async () => {
    vi.mocked(crearGasto).mockRejectedValue(new Error("Cannot convert undefined or null to object"));
    const res = await post(CABECERA);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toEqual({ error: MENSAJE_ERROR_SERVIDOR });
    expect(JSON.stringify(json)).not.toMatch(/undefined|convert/);
  });
  it("mensaje de dominio sin fila (p. ej. estado) se conserva tal cual con 400", async () => {
    vi.mocked(crearGasto).mockRejectedValue(new ErrorDominioFormulario("El monto debe ser mayor a cero."));
    const res = await post(CABECERA);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "El monto debe ser mayor a cero." });
  });
});
