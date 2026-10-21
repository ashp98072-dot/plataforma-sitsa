import { describe, expect, it, vi } from "vitest";
import {
  ConflictoIdempotencia,
  MENSAJE_CONFLICTO_IDEMPOTENCIA,
  buscarCreacionPorClave,
  canonico,
  esColumnaInexistente,
  esDuplicadoDeClave,
  huellaGasto,
  huellaSolicitudFondo,
  normalizarClaveIdempotencia,
} from "./idempotencia-envio";

const CLAVE = "3f2a9c1e-7b64-4d0a-9e51-2c8f6a1b0d33";

const fondoBase = () => ({
  entidadRequirenteId: 4, requirenteUsuarioId: 9, solicitanteUsuarioId: 5,
  fechaRequerimiento: "2026-10-01", observaciones: "Viaje a Puerto Barrios",
  lineas: [
    { categoria: "Combustible", descripcion: "Diesel", cantidad: 2, monto: 100, empleadoId: 3, metodoPago: "Transferencia" },
    { categoria: "Hospedaje", descripcion: null, cantidad: 1, monto: 150 },
  ],
});

const gastoBase = () => ({
  fechaSolicitud: "2026-10-01", categoria: "Combustible", descripcion: "Diesel", cantidad: 1, monto: 450,
  observaciones: "Con factura", requirenteUsuarioId: 9, solicitanteUsuarioId: 5,
});

describe("canonico — JSON determinista", () => {
  it("ignora el orden de las claves y los undefined", () => {
    expect(canonico({ b: 1, a: [2, { d: 1, c: undefined }] })).toBe(canonico({ a: [2, { c: undefined, d: 1 }], b: 1 }));
  });
});

describe("huellaSolicitudFondo — contenido funcional", () => {
  it("es determinista: mismo contenido → misma huella (aunque cambie el orden de las propiedades o el formato numérico)", () => {
    const a = huellaSolicitudFondo(fondoBase());
    const b = huellaSolicitudFondo({
      lineas: [
        { monto: 100.0, cantidad: 2, categoria: "Combustible", metodoPago: "Transferencia", empleadoId: 3, descripcion: "  Diesel " },
        { monto: 150, categoria: "Hospedaje" },
      ],
      observaciones: "  Viaje a Puerto Barrios ", fechaRequerimiento: "2026-10-01", solicitanteUsuarioId: 5, requirenteUsuarioId: 9, entidadRequirenteId: 4,
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("cambia con observaciones, monto, fecha, líneas y orden de líneas", () => {
    const base = huellaSolicitudFondo(fondoBase());
    const variantes = [
      { ...fondoBase(), observaciones: "Otra" },
      { ...fondoBase(), fechaRequerimiento: "2026-10-02" },
      { ...fondoBase(), solicitanteUsuarioId: 6 },
      { ...fondoBase(), lineas: [{ ...fondoBase().lineas[0], monto: 101 }, fondoBase().lineas[1]] },
      { ...fondoBase(), lineas: [fondoBase().lineas[0]] },
      { ...fondoBase(), lineas: [...fondoBase().lineas].reverse() },
    ];
    for (const v of variantes) expect(huellaSolicitudFondo(v)).not.toBe(base);
  });

  it("observaciones vacías/null/solo espacios son lo mismo", () => {
    const a = huellaSolicitudFondo({ ...fondoBase(), observaciones: null });
    expect(huellaSolicitudFondo({ ...fondoBase(), observaciones: "   " })).toBe(a);
    expect(huellaSolicitudFondo({ ...fondoBase(), observaciones: undefined })).toBe(a);
  });

  it("el texto libre del requirente NO cuenta cuando hay usuario (el servidor lo ignora)", () => {
    const conUsuario = huellaSolicitudFondo({ ...fondoBase(), requirenteNombre: "Nombre A" });
    expect(huellaSolicitudFondo({ ...fondoBase(), requirenteNombre: "Nombre B" })).toBe(conUsuario);
    const sinUsuario = { ...fondoBase(), requirenteUsuarioId: null };
    expect(huellaSolicitudFondo({ ...sinUsuario, requirenteNombre: "A" })).not.toBe(huellaSolicitudFondo({ ...sinUsuario, requirenteNombre: "B" }));
  });

  it("no depende de la clave ni de campos no funcionales que se cuelen en el objeto", () => {
    const base = huellaSolicitudFondo(fondoBase());
    const conRuido = { ...fondoBase(), claveIdempotencia: CLAVE, id: 99, codigo: "FONDO-000099", creadoEn: "2026-10-01 10:00:00" };
    expect(huellaSolicitudFondo(conRuido)).toBe(base);
  });
});

describe("huellaGasto — contenido funcional", () => {
  it("es determinista y distingue observaciones, monto y líneas", () => {
    const base = huellaGasto(gastoBase());
    expect(huellaGasto({ ...gastoBase(), monto: 450.0, descripcion: " Diesel " })).toBe(base);
    expect(huellaGasto({ ...gastoBase(), observaciones: "Sin factura" })).not.toBe(base);
    expect(huellaGasto({ ...gastoBase(), monto: 451 })).not.toBe(base);
    expect(huellaGasto({ ...gastoBase(), lineas: [{ categoria: "Combustible", monto: 450 }] })).not.toBe(base);
  });

  it("con líneas, monto/cantidad de cabecera no cuentan (el servidor los deriva) pero sí el total derivado y el orden", () => {
    const lineas = [{ categoria: "Combustible", monto: 100 }, { categoria: "Hospedaje", monto: 50 }];
    const a = huellaGasto({ ...gastoBase(), monto: 1, cantidad: 7, lineas });
    expect(huellaGasto({ ...gastoBase(), monto: 999, cantidad: 1, lineas })).toBe(a);
    expect(huellaGasto({ ...gastoBase(), lineas: [...lineas].reverse() })).not.toBe(a);
  });

  it("gasto y fondo con contenido parecido nunca comparten huella (tipo incluido)", () => {
    expect(huellaGasto({ ...gastoBase() })).not.toBe(huellaSolicitudFondo({ ...fondoBase() }));
  });
});

describe("normalizarClaveIdempotencia", () => {
  it("vacía/null = sin idempotencia (legado); válida se conserva recortada; inválida = 400", () => {
    expect(normalizarClaveIdempotencia(undefined)).toBeNull();
    expect(normalizarClaveIdempotencia(null)).toBeNull();
    expect(normalizarClaveIdempotencia("   ")).toBeNull();
    expect(normalizarClaveIdempotencia(` ${CLAVE} `)).toBe(CLAVE);
    expect(() => normalizarClaveIdempotencia("x'; --")).toThrow("clave de envío no es válida");
  });
});

describe("detección de errores MySQL", () => {
  it("esDuplicadoDeClave solo acepta ER_DUP_ENTRY del índice de la clave (no el de código)", () => {
    const dupClave = Object.assign(new Error("Duplicate entry '7-abc' for key 'uq_gastos_empresa_clave'"), { code: "ER_DUP_ENTRY", errno: 1062 });
    const dupClaveMaria = Object.assign(new Error("Duplicate entry '7-abc' for key 'tms_gastos_operativos.uq_gastos_empresa_clave'"), { errno: 1062 });
    const dupCodigo = Object.assign(new Error("Duplicate entry '7-GASTO-000001' for key 'uq_gastos_empresa_codigo'"), { code: "ER_DUP_ENTRY", errno: 1062 });
    expect(esDuplicadoDeClave(dupClave, "uq_gastos_empresa_clave")).toBe(true);
    expect(esDuplicadoDeClave(dupClaveMaria, "uq_gastos_empresa_clave")).toBe(true);
    expect(esDuplicadoDeClave(dupCodigo, "uq_gastos_empresa_clave")).toBe(false);
    expect(esDuplicadoDeClave(new Error("otra cosa"), "uq_gastos_empresa_clave")).toBe(false);
    expect(esDuplicadoDeClave(null, "uq_gastos_empresa_clave")).toBe(false);
  });

  it("esColumnaInexistente reconoce 1054 por code o errno", () => {
    expect(esColumnaInexistente({ code: "ER_BAD_FIELD_ERROR" })).toBe(true);
    expect(esColumnaInexistente({ errno: 1054 })).toBe(true);
    expect(esColumnaInexistente({ code: "ER_DUP_ENTRY" })).toBe(false);
  });
});

describe("buscarCreacionPorClave", () => {
  const leer = (filas: unknown[]) => vi.fn(async () => filas as never);

  it("sin fila → nueva; consulta aislada por empresa y clave", async () => {
    const l = leer([]);
    expect(await buscarCreacionPorClave(l, "tms_gastos_operativos", 7, CLAVE, "h")).toEqual({ tipo: "nueva" });
    expect(l).toHaveBeenCalledWith(expect.stringContaining("empresa_id = ? AND clave_idempotencia = ?"), [7, CLAVE]);
  });

  it("fila con la misma huella → existente", async () => {
    const l = leer([{ id: 55, huella_idempotencia: "h" }]);
    expect(await buscarCreacionPorClave(l, "tms_solicitudes_fondo", 7, CLAVE, "h")).toEqual({ tipo: "existente", id: 55 });
  });

  it("fila con huella distinta → ConflictoIdempotencia (409, mensaje fijo)", async () => {
    const l = leer([{ id: 55, huella_idempotencia: "otra" }]);
    const error = await buscarCreacionPorClave(l, "tms_solicitudes_fondo", 7, CLAVE, "h").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictoIdempotencia);
    expect((error as ConflictoIdempotencia).status).toBe(409);
    expect((error as ConflictoIdempotencia).message).toBe(MENSAJE_CONFLICTO_IDEMPOTENCIA);
  });

  it("columna inexistente (migración pendiente) → sin_soporte; cualquier otro error se propaga", async () => {
    const sinColumna = vi.fn(async () => { throw Object.assign(new Error("Unknown column"), { code: "ER_BAD_FIELD_ERROR", errno: 1054 }); });
    expect(await buscarCreacionPorClave(sinColumna, "tms_gastos_operativos", 7, CLAVE, "h")).toEqual({ tipo: "sin_soporte" });
    const caido = vi.fn(async () => { throw new Error("conexión perdida"); });
    await expect(buscarCreacionPorClave(caido, "tms_gastos_operativos", 7, CLAVE, "h")).rejects.toThrow("conexión perdida");
  });
});
