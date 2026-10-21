import { beforeEach, describe, expect, it, vi } from "vitest";
import { type ErrorFormulario, textoError } from "@/lib/validacion-formulario";

/**
 * ERRORES DE VALIDACIÓN CLAROS Y POR LÍNEA — Requerimientos de compra (POST/PATCH). Handler y schema REALES; solo se sustituye
 * la E/S. La pantalla llama «Línea» a cada fila, así que los errores dicen «Línea N — …».
 */
const m = vi.hoisted(() => ({ tenant: vi.fn(), permisos: vi.fn(), guardar: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenant: m.tenant }));
vi.mock("@/lib/permisos", async (original) => ({ ...(await original<typeof import("@/lib/permisos")>()), permisosEfectivos: m.permisos }));
vi.mock("./requerimientos", async (original) => ({ ...(await original<typeof import("./requerimientos")>()), guardarRequerimiento: m.guardar }));
import { requerimientoGuardar } from "./requerimiento-api";
import { ErrorCompra } from "./requerimientos";

const LINEA = { fecha: "2026-10-02", proveedor_id: 3, repuesto_descripcion: "Filtro", metodo_pago: "Efectivo", condicion_pago: "Contado", total: "10.25" };
const BASE = { fecha_requerimiento: "2026-10-02", entidad_requirente_id: 4, requirente_usuario_id: 9, lineas: [LINEA] };
const post = (body: unknown) => requerimientoGuardar(new Request("https://example.test/api", { method: "POST", body: JSON.stringify(body) }), "a");
const leer = async (body: unknown) => {
  const res = await post(body);
  const json = await res.json();
  return { status: res.status, json, textos: ((json.errores ?? []) as ErrorFormulario[]).map(textoError) };
};

beforeEach(() => {
  vi.resetAllMocks();
  m.permisos.mockResolvedValue([{ modulo: "compras_requerimientos", puedeVer: true, puedeCrear: true, puedeEditar: true, puedeEliminar: false }]);
  m.tenant.mockResolvedValue({ empresa: { id: 1, modulos: ["tms"] }, session: { id: 8, username: "operador", rol: "Operaciones" } });
  m.guardar.mockResolvedValue({ id: 12, codigo: "RC-1", version: 1 });
});

describe("requerimientos de compra — errores por línea", () => {
  it("19) línea inválida: número de línea + campo con el nombre de la pantalla", async () => {
    const r = await leer({ ...BASE, lineas: [LINEA, { ...LINEA, repuesto_descripcion: "", proveedor_id: 0, condicion_pago: "Quizá" }] });
    expect(r.status).toBe(400);
    expect(r.textos).toEqual([
      "Línea 2 — Proveedor: selecciona un proveedor.",
      "Línea 2 — El repuesto es obligatorio.",
      "Línea 2 — Condición de pago: selecciona Contado o Crédito.",
    ]);
    expect(m.guardar).not.toHaveBeenCalled();
  });
  it("20) monto inválido en otra línea (se listan todas las líneas con problema)", async () => {
    const r = await leer({ ...BASE, lineas: [{ ...LINEA, total: "0" }, LINEA, { ...LINEA, total: "abc" }, { ...LINEA, fecha: "02/10/2026" }] });
    expect(r.textos).toEqual([
      "Línea 1 — Total: debe ser mayor que Q0, con máximo dos decimales.",
      "Línea 3 — Total: debe ser mayor que Q0, con máximo dos decimales.",
      "Línea 4 — Fecha: usa una fecha válida.",
    ]);
    expect(r.textos.join(" ")).not.toMatch(/DECIMAL/);
  });
  it("cabecera: nombres de la pantalla, sin nombres técnicos", async () => {
    const r = await leer({ ...BASE, fecha_requerimiento: "", entidad_requirente_id: undefined, requirente_usuario_id: null });
    expect(r.textos).toEqual([
      "Fecha de requerimiento: la fecha es obligatoria.",
      "Empresa requirente: selecciona la empresa requirente.",
      "Requirente: selecciona un requirente.",
    ]);
    expect(r.textos.join(" ")).not.toMatch(/fecha_requerimiento|entidad_requirente_id|requirente_usuario_id/);
  });
  it("sin líneas: pide al menos una (mensaje del propio schema)", async () => {
    expect((await leer({ ...BASE, lineas: [] })).textos).toEqual(["Agrega al menos una línea."]);
  });
  it("`error` sigue existiendo, `errores` es aditivo y `erroresCampos` se conserva", async () => {
    const { json } = await leer({ ...BASE, lineas: [{ ...LINEA, repuesto_descripcion: "" }] });
    expect(json.error).toBe("Hay datos que debes corregir.");
    expect(json.errores).toHaveLength(1);
    expect(json.erroresCampos).toEqual({ "lineas.0.repuesto_descripcion": "El repuesto es obligatorio." });
  });
  it("nunca expone mensajes técnicos de Zod", async () => {
    const r = await leer({ fecha_requerimiento: 5, lineas: [{ proveedor_id: "x", total: {}, condicion_pago: 3 }, null] });
    expect(JSON.stringify(r.json.errores)).not.toMatch(/Invalid|Too small|Too big|expected|received|undefined/);
  });
  it("campos manipulados (strict): mensaje genérico sin revelar nombres", async () => {
    const r = await leer({ ...BASE, total: 1, secreto: "x" });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.json.errores)).not.toContain("secreto");
  });
});

describe("requerimientos de compra — errores de negocio y del servidor", () => {
  it("error de negocio conocido conserva su mensaje y estado", async () => {
    m.guardar.mockRejectedValueOnce(new ErrorCompra("El proveedor indicado no pertenece a esta empresa.", 400));
    const res = await post(BASE);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("El proveedor indicado no pertenece a esta empresa.");
  });
  it("ErrorCompra conserva su estado real (403/404/409)", async () => {
    for (const [status, msg] of [[403, "No tienes permiso."], [404, "Requerimiento no encontrado."], [409, "El requerimiento fue modificado por otro usuario. Actualiza la información."]] as const) {
      m.guardar.mockRejectedValueOnce(new ErrorCompra(msg, status));
      const res = await post(BASE);
      expect(res.status).toBe(status);
      expect((await res.json()).error).toBe(msg);
    }
  });
  it("error INESPERADO de programación (Error normal): 500 genérico, sin su mensaje", async () => {
    m.guardar.mockRejectedValueOnce(new Error("Cannot read properties of undefined (reading 'lineas')"));
    const res = await post(BASE);
    expect(res.status).toBe(500);
    const texto = JSON.stringify(await res.json());
    expect(texto).not.toMatch(/undefined|reading|Cannot/);
  });
  it("error inesperado: 500 genérico sin detalles internos", async () => {
    m.guardar.mockRejectedValueOnce(Object.assign(new Error("ER_DUP_ENTRY: Duplicate entry 'x' for key 'uq_tabla'"), { code: "ER_DUP_ENTRY", sql: "INSERT ..." }));
    const res = await post(BASE);
    expect(res.status).toBe(500);
    const texto = JSON.stringify(await res.json());
    expect(texto).not.toMatch(/ER_|uq_tabla|INSERT|Duplicate/);
  });
});
