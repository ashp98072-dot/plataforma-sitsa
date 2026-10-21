import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ERRORES DE VALIDACIÓN CLAROS Y POR LÍNEA — POST /tms/fondos (Solicitudes de fondo). Se ejercita el handler REAL y el schema
 * REAL; solo se sustituye la E/S. Antes todo respondía `{ error: "Datos inválidos." }` sin decir qué campo ni qué línea.
 */
vi.mock("@/lib/tenant", () => ({ requireTenantGastos: vi.fn() }));
vi.mock("@/lib/tms/gastos", () => ({
  CATEGORIAS_GASTO: ["Combustible", "Peajes", "Otros"],
  METODOS_PAGO_GASTO: ["Efectivo", "Transferencia", "Transferencia móvil", "Tarjeta"],
}));
vi.mock("@/lib/tms/fondos", () => ({
  ESTADOS_FONDO: ["Pendiente", "Autorizada", "Rechazada", "Liquidada"],
  crearSolicitudFondo: vi.fn(),
  listarSolicitudesFondo: vi.fn(),
}));

import { requireTenantGastos } from "@/lib/tenant";
import { crearSolicitudFondo } from "@/lib/tms/fondos";
import { ErrorDominioFormulario, ErrorValidacionFormulario, MENSAJE_ERROR_SERVIDOR, MENSAJE_VALIDACION, textoError, type ErrorFormulario } from "@/lib/validacion-formulario";
import { POST } from "./route";

const ctx = { params: Promise.resolve({ slug: "prueba" }) };
const post = (body: unknown) => POST(new Request("http://x/api", { method: "POST", body: JSON.stringify(body) }), ctx);
const LINEA = { categoria: "Combustible", monto: 100, cantidad: 1 };
const BASE = { entidadRequirenteId: 1, requirenteUsuarioId: 4, solicitanteUsuarioId: 5, fechaRequerimiento: "2026-10-02", lineas: [LINEA] };
const textos = async (body: unknown) => {
  const res = await post(body);
  const json = await res.json();
  return { status: res.status, json, textos: ((json.errores ?? []) as ErrorFormulario[]).map(textoError) };
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(requireTenantGastos).mockResolvedValue({ empresa: { id: 7, nombre: "KT" }, session: { id: 8, username: "ops" } } as Awaited<ReturnType<typeof requireTenantGastos>>);
  vi.mocked(crearSolicitudFondo).mockResolvedValue({ id: 1 } as never);
});

describe("POST /tms/fondos — validación de cabecera y líneas", () => {
  it("11) cabecera inválida: dice qué falta, sin 'Datos inválidos.'", async () => {
    const r = await textos({ ...BASE, entidadRequirenteId: undefined, solicitanteUsuarioId: null, fechaRequerimiento: "" });
    expect(r.status).toBe(400);
    expect(r.textos).toEqual([
      "Empresa requirente: selecciona la empresa requirente.",
      "Solicitante: selecciona el solicitante.",
      "Fecha de requerimiento: la fecha es obligatoria.",
    ]);
    expect(JSON.stringify(r.json)).not.toContain("Datos inválidos");
    expect(crearSolicitudFondo).not.toHaveBeenCalled();
  });
  it("12) línea 1 inválida", async () => {
    const r = await textos({ ...BASE, lineas: [{ ...LINEA, monto: 0 }] });
    expect(r.textos).toEqual(["Línea 1 — Monto: debe ser mayor que Q0."]);
  });
  it("13) línea 3 inválida (las líneas 1 y 2 válidas no se marcan)", async () => {
    const r = await textos({ ...BASE, lineas: [LINEA, LINEA, { ...LINEA, fechaViaje: "31/12/2026" }] });
    expect(r.textos).toEqual(["Línea 3 — Fecha de viaje: usa una fecha válida."]);
    expect(r.json.errores[0]).toMatchObject({ linea: 3, campo: "lineas.2.fechaViaje", etiqueta: "Fecha de viaje" });
  });
  it("14/16) ejemplo del ticket: línea 2 con categoría vacía, monto 0 y método inválido, todo de una vez", async () => {
    const r = await textos({ ...BASE, lineas: [LINEA, { categoria: "", monto: 0, metodoPago: "Cheque" }, { ...LINEA, categoria: "Zzz" }] });
    expect(r.textos).toEqual([
      "Línea 2 — Categoría: selecciona una categoría.",
      "Línea 2 — Monto: debe ser mayor que Q0.",
      "Línea 2 — Método de pago: selecciona un método de pago válido.",
      "Línea 3 — Categoría: selecciona una categoría.",
    ]);
  });
  it("15) `error` sigue existiendo (compatibilidad) y `errores` es estructurado", async () => {
    const { json } = await textos({ ...BASE, lineas: [{ ...LINEA, monto: -1 }] });
    expect(json.error).toBe(MENSAJE_VALIDACION);
    expect(json.errores).toEqual([{ campo: "lineas.0.monto", etiqueta: "Monto", mensaje: "debe ser mayor que Q0.", linea: 1, coleccion: "Línea" }]);
  });
  it("sin líneas / demasiadas líneas / texto demasiado largo", async () => {
    expect((await textos({ ...BASE, lineas: [] })).textos).toEqual(["Líneas de gasto: agrega al menos un elemento."]);
    expect((await textos({ ...BASE, observaciones: "x".repeat(301) })).textos).toEqual(["Observaciones: no puede superar 300 caracteres."]);
  });
  it("cuerpo no JSON: validación clara, no 500", async () => {
    const res = await POST(new Request("http://x/api", { method: "POST", body: "{no es json" }), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).errores.length).toBeGreaterThan(0);
  });
  it("nunca expone mensajes técnicos de Zod ni nombres de propiedades", async () => {
    const r = await textos({ entidadRequirenteId: "uno", lineas: [{ categoria: 5, monto: "diez", fechaViaje: 7, metodoPago: {} }] });
    expect(JSON.stringify(r.json)).not.toMatch(/Invalid|Too small|Too big|expected|received|undefined/);
    expect(r.textos.join(" ")).not.toMatch(/entidadRequirenteId|metodoPago|fechaViaje|categoria\b/);
  });
});

describe("POST /tms/fondos — errores de negocio y del servidor", () => {
  it("negocio con fila: 'Línea 3 — …' dentro de errores", async () => {
    vi.mocked(crearSolicitudFondo).mockRejectedValue(new ErrorValidacionFormulario([
      { campo: "lineas.2.empleadoId", etiqueta: "Empleado", mensaje: "El empleado indicado no pertenece a esta empresa.", linea: 3, coleccion: "Línea" },
    ]));
    const r = await textos(BASE);
    expect(r.status).toBe(400);
    expect(r.json.error).toBe(MENSAJE_VALIDACION);
    expect(r.textos).toEqual(["Línea 3 — El empleado indicado no pertenece a esta empresa."]);
  });
  it("negocio general con mensaje propio: se conserva tal cual (400)", async () => {
    vi.mocked(crearSolicitudFondo).mockRejectedValue(new ErrorDominioFormulario("El usuario solicitante indicado no pertenece a esta empresa."));
    const r = await textos(BASE);
    expect(r).toMatchObject({ status: 400, json: { error: "El usuario solicitante indicado no pertenece a esta empresa." } });
  });
  it("error INESPERADO de programación (Error normal): 500 genérico, no se expone su mensaje", async () => {
    vi.mocked(crearSolicitudFondo).mockRejectedValue(new Error("Cannot read properties of undefined (reading 'lineas')"));
    const res = await post(BASE);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toEqual({ error: MENSAJE_ERROR_SERVIDOR });
    expect(JSON.stringify(json)).not.toMatch(/undefined|reading|Cannot/);
  });
  it("un error de dominio con estado propio conserva su estado (409 no se degrada a 400)", async () => {
    vi.mocked(crearSolicitudFondo).mockRejectedValue(new ErrorDominioFormulario("La solicitud cambió mientras la editabas.", 409));
    const res = await post(BASE);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "La solicitud cambió mientras la editabas." });
  });
  it("12) error real del servidor (MySQL): 500 genérico seguro, sin SQL ni nombres de tablas", async () => {
    vi.mocked(crearSolicitudFondo).mockRejectedValue(Object.assign(new Error("Table 'sitsa.tms_solicitud_fondo_lineas' doesn't exist"), { code: "ER_NO_SUCH_TABLE", errno: 1146, sqlState: "42S02", sql: "INSERT INTO tms_solicitud_fondo_lineas ..." }));
    const res = await post(BASE);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toEqual({ error: MENSAJE_ERROR_SERVIDOR });
    expect(JSON.stringify(json)).not.toMatch(/tms_|sitsa|INSERT|ER_/);
    expect(console.error).toHaveBeenCalled(); // el detalle queda en el log del servidor
  });
});
