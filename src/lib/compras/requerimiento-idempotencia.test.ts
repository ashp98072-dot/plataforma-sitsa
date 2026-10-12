import { describe, expect, it, vi } from "vitest";
import { buscarRequerimientoPorClave, claveValidaCompra, huellaRequerimiento, INDICE_CLAVE_COMPRAS, TABLA_COMPRAS } from "./requerimiento-idempotencia";
import { crearRequerimientoSchema } from "./requerimiento-schema";

const CLAVE = "3f2a9c1e-7b64-4d0a-9e51-2c8f6a1b0d33";

const linea = { fecha: "2026-10-01", proveedor_id: 3, vehiculo_id: null, repuesto_descripcion: "Filtro de aire", metodo_pago: "Transferencia", condicion_pago: "Contado", total: "10.25" };
const base = (extra: Record<string, unknown> = {}) => ({
  fecha_requerimiento: "2026-10-01", entidad_requirente_id: 4, requirente_usuario_id: 9, observaciones: "Urgente",
  lineas: [linea, { ...linea, repuesto_descripcion: "Aceite 15W40", total: "80", observaciones: "Marca indicada" }], ...extra,
});
const huella = (extra: Record<string, unknown> = {}) => huellaRequerimiento(crearRequerimientoSchema.parse(base(extra)));

describe("huellaRequerimiento — contenido funcional estable", () => {
  it("es determinista: mismo contenido → misma huella (formato numérico, espacios y propiedades en otro orden no cuentan)", () => {
    const a = huella();
    const b = huellaRequerimiento(crearRequerimientoSchema.parse({
      lineas: [
        { total: 10.25, condicion_pago: "Contado", metodo_pago: "Transferencia", repuesto_descripcion: "  Filtro de aire ", proveedor_id: 3, fecha: "2026-10-01" },
        { observaciones: " Marca indicada ", total: "80.00", repuesto_descripcion: "Aceite 15W40", condicion_pago: "Contado", metodo_pago: "Transferencia", proveedor_id: 3, fecha: "2026-10-01" },
      ],
      observaciones: "  Urgente ", requirente_usuario_id: 9, entidad_requirente_id: 4, fecha_requerimiento: "2026-10-01",
    }));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("cambia con cada dato funcional: cabecera, observaciones, total, líneas y su orden", () => {
    const original = huella();
    const variantes: Record<string, unknown>[] = [
      { fecha_requerimiento: "2026-10-02" },
      { entidad_requirente_id: 5 },
      { requirente_usuario_id: 10 },
      { encargado_compras_usuario_id: 20 },
      { observaciones: "Otra" },
      { lineas: [linea] },
      { lineas: [{ ...linea, total: "10.26" }, base().lineas[1]] },
      { lineas: [{ ...linea, proveedor_id: 4 }, base().lineas[1]] },
      { lineas: [{ ...linea, serie_factura: "A", numero_factura: "1" }, base().lineas[1]] },
      { lineas: [{ ...linea, condicion_pago: "Crédito" }, base().lineas[1]] },
      { lineas: [{ ...linea, observaciones: "Nueva nota" }, base().lineas[1]] },
      { lineas: [...base().lineas].reverse() },
    ];
    for (const v of variantes) expect(huella(v), JSON.stringify(v).slice(0, 80)).not.toBe(original);
  });

  it("observaciones vacías / null / solo espacios / ausentes son lo mismo; encargado null = ausente", () => {
    const a = huella({ observaciones: null });
    expect(huella({ observaciones: "   " })).toBe(a);
    expect(huella({ observaciones: undefined })).toBe(a);
    expect(huella({ observaciones: null, encargado_compras_usuario_id: null })).toBe(a);
  });

  it("no depende de la propia clave ni de datos no funcionales", () => {
    expect(huella({ clave_idempotencia: CLAVE })).toBe(huella());
    expect(huella({ clave_idempotencia: "otra-clave-distinta-0000000001" })).toBe(huella());
  });
});

describe("claveValidaCompra", () => {
  it("acepta UUID y tokens de 16–64 caracteres; rechaza el resto", () => {
    expect(claveValidaCompra(CLAVE)).toBe(true);
    for (const mala of ["", "corta", "con espacios en la clave", null, undefined, "x".repeat(65)]) expect(claveValidaCompra(mala as never)).toBe(false);
  });
});

describe("buscarRequerimientoPorClave", () => {
  const leer = (filas: unknown[]) => vi.fn(async () => filas as never);

  it("sin fila → nueva; consulta aislada por empresa y clave sobre compras_requerimientos", async () => {
    const l = leer([]);
    expect(await buscarRequerimientoPorClave(l, 7, CLAVE, "h")).toEqual({ tipo: "nueva" });
    expect(l).toHaveBeenCalledWith(expect.stringContaining(`FROM ${TABLA_COMPRAS} WHERE empresa_id = ? AND clave_idempotencia = ?`), [7, CLAVE]);
  });

  it("misma huella → existente con id, código y versión vigentes", async () => {
    const r = await buscarRequerimientoPorClave(leer([{ id: 55, codigo: "RC-2026-000055", version: 3, huella_idempotencia: "h" }]), 7, CLAVE, "h");
    expect(r).toEqual({ tipo: "existente", resultado: { id: 55, codigo: "RC-2026-000055", version: 3 } });
  });

  it("otra huella → conflicto", async () => {
    expect(await buscarRequerimientoPorClave(leer([{ id: 55, codigo: "x", version: 1, huella_idempotencia: "otra" }]), 7, CLAVE, "h")).toEqual({ tipo: "conflicto" });
  });

  it("columna inexistente (migración pendiente) → sin_soporte; otros errores se propagan", async () => {
    const sin = vi.fn(async () => { throw Object.assign(new Error("Unknown column"), { code: "ER_BAD_FIELD_ERROR", errno: 1054 }); });
    expect(await buscarRequerimientoPorClave(sin, 7, CLAVE, "h")).toEqual({ tipo: "sin_soporte" });
    const caido = vi.fn(async () => { throw new Error("conexión perdida"); });
    await expect(buscarRequerimientoPorClave(caido, 7, CLAVE, "h")).rejects.toThrow("conexión perdida");
  });

  it("el nombre del índice coincide con el de la migración", () => {
    expect(INDICE_CLAVE_COMPRAS).toBe("uq_compras_req_empresa_clave");
  });
});
