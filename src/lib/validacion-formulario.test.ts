import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ErrorDominioFormulario, ErrorValidacionFormulario, MAX_ERRORES_VISIBLES, MENSAJE_ERROR_SERVIDOR, MENSAJE_VALIDACION, conLinea, cuerpoErrores, erroresDeZod, errorDeCampo,
  leerErroresRespuesta, remapearLineas, respuestaDeExcepcion, resumirErrores, textoError, type ConfigErrores, type CuerpoErrores,
} from "./validacion-formulario";

const CFG: ConfigErrores = {
  etiquetas: { fechaRequerimiento: "Fecha de requerimiento", lineas: "Líneas de gasto", categoria: "Categoría", monto: "Monto", metodoPago: "Método de pago", fechaViaje: "Fecha de viaje", descripcion: "Descripción", auxiliarEmpleadoIds: "Auxiliar", "paradas.lugarNombre": "Lugar", "paradas.tipo": "Tipo de parada" },
  colecciones: { lineas: "Línea", paradas: "Parada", auxiliarEmpleadoIds: "Auxiliar" },
  moneda: ["monto"],
  mensajes: { categoria: { requerido: "selecciona una categoría.", opcion: "selecciona una categoría." }, metodoPago: { opcion: "selecciona un método de pago." }, tipo: { opcion: "selecciona Carga, Descarga o Entrega." } },
};
const linea = z.object({
  categoria: z.enum(["Combustible", "Peajes"]),
  monto: z.number().positive().max(1000),
  descripcion: z.string().max(5).nullable().optional(),
  fechaViaje: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  metodoPago: z.enum(["Efectivo", "Transferencia"]).nullable().optional(),
});
const schema = z.object({
  fechaRequerimiento: z.string().min(1),
  lineas: z.array(linea).min(1).max(3),
  paradas: z.array(z.object({ lugarNombre: z.string().min(1), tipo: z.enum(["Carga", "Descarga", "Entrega"]) })).optional(),
  auxiliarEmpleadoIds: z.array(z.number().int().positive()).optional(),
});
const validar = (payload: unknown) => {
  const r = schema.safeParse(payload);
  if (r.success) throw new Error("se esperaba un error");
  return erroresDeZod(r.error, CFG, payload);
};
const OK = { categoria: "Peajes", monto: 10 };
const textos = (payload: unknown) => validar(payload).map(textoError);

describe("erroresDeZod — campo simple y colecciones", () => {
  it("1) campo simple (cabecera): etiqueta humana, sin número de línea", () => {
    const e = validar({ lineas: [OK] });
    expect(e).toEqual([expect.objectContaining({ campo: "fechaRequerimiento", etiqueta: "Fecha de requerimiento", mensaje: "es obligatorio." })]);
    expect(e[0].linea).toBeUndefined();
    expect(textoError(e[0])).toBe("Fecha de requerimiento: es obligatorio.");
  });
  it("2) línea 0 -> «Línea 1»", () => {
    expect(textos({ fechaRequerimiento: "2026-01-01", lineas: [{ ...OK, monto: 0 }] })).toEqual(["Línea 1 — Monto: debe ser mayor que Q0."]);
  });
  it("3) línea 1 -> «Línea 2» (y las demás no se marcan)", () => {
    const e = validar({ fechaRequerimiento: "2026-01-01", lineas: [OK, { ...OK, monto: -3 }, OK] });
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ linea: 2, campo: "lineas.1.monto", etiqueta: "Monto", coleccion: "Línea" });
  });
  it("4) ruta anidada: parada 2 -> «Parada 2 — Lugar» (usa la palabra de la pantalla)", () => {
    const t = textos({ fechaRequerimiento: "x", lineas: [OK], paradas: [{ lugarNombre: "A", tipo: "Carga" }, { lugarNombre: "", tipo: "Descarga" }] });
    expect(t).toEqual(["Parada 2 — Lugar: es obligatorio."]);
  });
  it("elemento simple de una colección: «Auxiliar 3: …»", () => {
    const t = textos({ fechaRequerimiento: "x", lineas: [OK], auxiliarEmpleadoIds: [1, 2, "x"] });
    expect(t).toEqual(["Auxiliar 3: debe ser un número."]);
  });
});

describe("erroresDeZod — traducción de reglas", () => {
  it("5) enum inválido -> mensaje del campo / genérico, nunca «Invalid option»", () => {
    const t = textos({ fechaRequerimiento: "x", lineas: [{ ...OK, categoria: "Otra", metodoPago: "Cheque" }] });
    expect(t).toContain("Línea 1 — Categoría: selecciona una categoría.");
    expect(t).toContain("Línea 1 — Método de pago: selecciona un método de pago.");
  });
  it("enum con valor vacío -> requerido propio del campo", () => {
    expect(textos({ fechaRequerimiento: "x", lineas: [{ ...OK, categoria: "" }] })).toEqual(["Línea 1 — Categoría: selecciona una categoría."]);
  });
  it("6) número <= 0 y número demasiado grande", () => {
    expect(textos({ fechaRequerimiento: "x", lineas: [{ ...OK, monto: 0 }] })).toEqual(["Línea 1 — Monto: debe ser mayor que Q0."]);
    expect(textos({ fechaRequerimiento: "x", lineas: [{ ...OK, monto: 5000 }] })).toEqual(["Línea 1 — Monto: no puede ser mayor que Q1,000."]);
  });
  it("tipo equivocado y dato faltante en una línea", () => {
    const t = textos({ fechaRequerimiento: "x", lineas: [{ categoria: "Peajes", monto: "10" }, { categoria: "Peajes" }] });
    expect(t).toContain("Línea 1 — Monto: debe ser un número.");
    expect(t).toContain("Línea 2 — Monto: es obligatorio.");
  });
  it("7) texto demasiado largo", () => {
    expect(textos({ fechaRequerimiento: "x", lineas: [{ ...OK, descripcion: "demasiado largo" }] })).toEqual(["Línea 1 — Descripción: no puede superar 5 caracteres."]);
  });
  it("8) fecha inválida", () => {
    expect(textos({ fechaRequerimiento: "x", lineas: [{ ...OK, fechaViaje: "31/12/2026" }] })).toEqual(["Línea 1 — Fecha de viaje: usa una fecha válida."]);
  });
  it("lista vacía -> pide al menos un elemento; más de la cuenta -> límite", () => {
    expect(textos({ fechaRequerimiento: "x", lineas: [] })).toEqual(["Líneas de gasto: agrega al menos un elemento."]);
    expect(textos({ fechaRequerimiento: "x", lineas: [OK, OK, OK, OK] })).toEqual(["Líneas de gasto: no puede tener más de 3 elementos."]);
  });
  it("9) varios errores a la vez, en varias líneas, sin duplicados equivalentes", () => {
    const t = textos({ lineas: [{ categoria: "Zzz", monto: 0 }, OK, { categoria: "Peajes", monto: 0 }] });
    expect(t).toEqual([
      "Fecha de requerimiento: es obligatorio.",
      "Línea 1 — Categoría: selecciona una categoría.",
      "Línea 1 — Monto: debe ser mayor que Q0.",
      "Línea 3 — Monto: debe ser mayor que Q0.",
    ]);
  });
  it("10) nunca expone mensajes técnicos de Zod ni nombres de propiedades", () => {
    const payloads = [{}, { lineas: "x" }, { fechaRequerimiento: 5, lineas: [{ categoria: 1, monto: "a", fechaViaje: 3, metodoPago: {} }] }, { lineas: [null] }];
    for (const p of payloads) {
      for (const e of validar(p)) {
        const todo = `${textoError(e)} ${e.etiqueta} ${e.mensaje}`;
        expect(todo).not.toMatch(/Invalid|Too small|Too big|expected|received|undefined|\bnull\b|Unrecognized/);
        expect(todo).not.toMatch(/lineas\.|fechaRequerimiento|metodoPago|categoria|fechaViaje/);
      }
    }
  });
  it("claves desconocidas (strict): mensaje genérico sin nombres de campo", () => {
    const strict = z.object({ a: z.string() }).strict();
    const r = strict.safeParse({ a: "x", secreto: 1 });
    if (r.success) throw new Error("x");
    const e = erroresDeZod(r.error, { etiquetas: {} });
    expect(textoError(e[0])).not.toContain("secreto");
    expect(e[0].mensaje).toMatch(/no se pueden procesar/);
  });
  it("respeta los mensajes en español escritos en el propio schema y no repite la etiqueta", () => {
    const s = z.object({ lineas: z.array(z.object({ repuesto: z.string().min(1, "El repuesto es obligatorio.") })) });
    const r = s.safeParse({ lineas: [{ repuesto: "" }] });
    if (r.success) throw new Error("x");
    const e = erroresDeZod(r.error, { etiquetas: { repuesto: "Repuesto" }, colecciones: { lineas: "Línea" } });
    expect(textoError(e[0])).toBe("Línea 1 — El repuesto es obligatorio.");
  });
  it("sin etiqueta configurada: humaniza en vez de mostrar camelCase", () => {
    const s = z.object({ numeroFactura: z.string().min(1) });
    const r = s.safeParse({});
    if (r.success) throw new Error("x");
    expect(erroresDeZod(r.error, { etiquetas: {} })[0].etiqueta).toBe("Numero factura");
  });
});

describe("presentación y límites", () => {
  it("resumirErrores limita y cuenta el resto", () => {
    const muchos = Array.from({ length: 20 }, (_, i) => ({ campo: `lineas.${i}.monto`, etiqueta: "Monto", mensaje: "es obligatorio.", linea: i + 1, coleccion: "Línea" }));
    const r = resumirErrores(muchos);
    expect(r).toHaveLength(MAX_ERRORES_VISIBLES + 1);
    expect(r[r.length - 1]).toBe(`+ ${20 - MAX_ERRORES_VISIBLES} errores adicionales.`);
    expect(resumirErrores(muchos.slice(0, 4))).toHaveLength(4);
    expect(resumirErrores(muchos.slice(0, MAX_ERRORES_VISIBLES + 1))[MAX_ERRORES_VISIBLES]).toBe("+ 1 error adicional.");
  });
  it("errorDeCampo devuelve solo el mensaje del campo exacto", () => {
    const e = validar({ fechaRequerimiento: "x", lineas: [OK, { ...OK, monto: 0 }] });
    expect(errorDeCampo(e, "lineas.1.monto")).toBe("debe ser mayor que Q0.");
    expect(errorDeCampo(e, "lineas.0.monto")).toBeUndefined();
  });
  it("remapearLineas: el número del servidor pasa al de la pantalla", () => {
    const e = validar({ fechaRequerimiento: "x", lineas: [OK, { ...OK, monto: 0 }] }); // servidor: línea 2
    const r = remapearLineas(e, "lineas", [1, 4]); // en pantalla era la línea 4
    expect(r[0]).toMatchObject({ linea: 4, campo: "lineas.3.monto" });
    expect(textoError(r[0])).toBe("Línea 4 — Monto: debe ser mayor que Q0.");
  });
});

describe("respuesta HTTP", () => {
  it("cuerpoErrores mantiene `error` (compatibilidad) y agrega `errores`", () => {
    const e = validar({ lineas: [OK] });
    const c = cuerpoErrores(e);
    expect(c.error).toBe(MENSAJE_VALIDACION);
    expect(Array.isArray(c.errores)).toBe(true);
  });
  it("leerErroresRespuesta prefiere `errores` y cae a `error`", () => {
    expect(leerErroresRespuesta({ error: "x", errores: [{ campo: "a", etiqueta: "A", mensaje: "m" }] }, "f")).toEqual({ mensaje: "x", errores: [{ campo: "a", etiqueta: "A", mensaje: "m" }] });
    expect(leerErroresRespuesta({ error: "solo texto" }, "f")).toEqual({ mensaje: "solo texto", errores: [] });
    expect(leerErroresRespuesta({}, "respaldo")).toEqual({ mensaje: "respaldo", errores: [] });
    expect(leerErroresRespuesta(null, "respaldo").mensaje).toBe("respaldo");
    expect(leerErroresRespuesta({ errores: [{ nada: 1 }, "x"] }, "f").errores).toEqual([]);
  });
});

describe("clasificación EXPLÍCITA de excepciones (dominio vs inesperado)", () => {
  const GENERICO = { error: MENSAJE_ERROR_SERVIDOR };
  const mysql = Object.assign(new Error("Unknown column 'x' in 'field list'"), { code: "ER_BAD_FIELD_ERROR", errno: 1054, sqlState: "42S22", sql: "SELECT secreto FROM tabla" });

  it("A) un Error de programación NO se expone: 500 genérico, sin «undefined» ni «reading»", () => {
    const r = respuestaDeExcepcion(new Error("Cannot read properties of undefined (reading 'x')"));
    expect(r.status).toBe(500);
    expect(r.cuerpo).toEqual(GENERICO);
    expect(JSON.stringify(r.cuerpo)).not.toMatch(/undefined|reading|Cannot/);
  });
  it("B) cualquier Error normal inesperado -> 500 genérico (no importa qué diga su mensaje)", () => {
    for (const msg of ["Unexpected application state", "Maximum call stack size exceeded", "Cannot convert undefined or null to object", "assert failed", "El empleado indicado no pertenece a esta empresa."]) {
      expect(respuestaDeExcepcion(new Error(msg))).toEqual({ status: 500, cuerpo: GENERICO });
    }
    expect(respuestaDeExcepcion(new TypeError("x is not a function")).status).toBe(500);
    expect(respuestaDeExcepcion(new RangeError("Invalid array length")).status).toBe(500);
  });
  it("C) error de dominio EXPLÍCITO: su mensaje exacto con 400 por defecto", () => {
    const msg = "El regreso estimado debe ser posterior a la salida programada.";
    expect(respuestaDeExcepcion(new ErrorDominioFormulario(msg))).toEqual({ status: 400, cuerpo: { error: msg } });
  });
  it("C2) el estado declarado por el error de dominio se conserva (403/404/409 no se degradan a 400)", () => {
    for (const status of [400, 403, 404, 409] as const) {
      expect(respuestaDeExcepcion(new ErrorDominioFormulario("mensaje claro", status))).toEqual({ status, cuerpo: { error: "mensaje claro" } });
    }
  });
  it("D) ErrorValidacionFormulario -> 400 + errores[]", () => {
    const r = respuestaDeExcepcion(new ErrorValidacionFormulario([{ campo: "lineas.1.monto", etiqueta: "Monto", mensaje: "debe ser mayor que Q0.", linea: 2, coleccion: "Línea" }]));
    expect(r.status).toBe(400);
    expect(r.cuerpo).toMatchObject({ error: MENSAJE_VALIDACION, errores: [{ campo: "lineas.1.monto", linea: 2 }] });
  });
  it("E) error de MySQL (code/errno/sql) -> 500 genérico, sin SQL ni tablas", () => {
    const r = respuestaDeExcepcion(mysql);
    expect(r).toEqual({ status: 500, cuerpo: GENERICO });
    expect(JSON.stringify(r.cuerpo)).not.toMatch(/SELECT|tabla|ER_|column/i);
  });
  it("F) valores que no son Error (string, objeto, null, undefined, número) -> 500 genérico", () => {
    for (const valor of ["boom", { message: "El empleado indicado no pertenece a esta empresa.", status: 400 }, null, undefined, 42]) {
      expect(respuestaDeExcepcion(valor)).toEqual({ status: 500, cuerpo: GENERICO });
    }
  });
  it("un objeto que solo IMITA un error de dominio (status/message) no se acepta: hay que ser ErrorDominioFormulario", () => {
    const falso = Object.assign(new Error("Detalle interno"), { status: 409 });
    expect(respuestaDeExcepcion(falso)).toEqual({ status: 500, cuerpo: GENERICO });
  });
  it("G) subclases de dominio con estado propio (p. ej. ErrorGasto) conservan su estado y mensaje", () => {
    class ErrorPropio extends ErrorDominioFormulario {}
    expect(respuestaDeExcepcion(new ErrorPropio("Conflicto de versión.", 409))).toEqual({ status: 409, cuerpo: { error: "Conflicto de versión." } });
  });

  it("conLinea: un error de dominio 400 de una fila indica línea y campo", () => {
    const campos = [{ patron: /empleado/i, campo: "empleadoId", etiqueta: "Empleado" }];
    const e = conLinea(new ErrorDominioFormulario("El empleado indicado no pertenece a esta empresa."), 3, "lineas", "Línea", campos);
    expect(e).toBeInstanceOf(ErrorValidacionFormulario);
    const r = respuestaDeExcepcion(e);
    expect(r.status).toBe(400);
    expect(r.cuerpo).toMatchObject({ error: MENSAJE_VALIDACION, errores: [{ campo: "lineas.2.empleadoId", etiqueta: "Empleado", linea: 3, coleccion: "Línea" }] });
    expect(textoError((r.cuerpo as CuerpoErrores).errores[0])).toBe("Línea 3 — El empleado indicado no pertenece a esta empresa.");
  });
  it("conLinea NO convierte lo que no es dominio 400: lo inesperado sigue siendo 500 y el estado 403/409 se conserva", () => {
    const campos = [{ patron: /empleado/i, campo: "empleadoId", etiqueta: "Empleado" }];
    const inesperado = new Error("El empleado indicado no pertenece a esta empresa."); // plain Error: NO es dominio
    expect(conLinea(inesperado, 3, "lineas", "Línea", campos)).toBe(inesperado);
    expect(respuestaDeExcepcion(conLinea(inesperado, 3, "lineas", "Línea", campos)).status).toBe(500);
    expect(conLinea(mysql, 3, "lineas", "Línea", campos)).toBe(mysql);
    const conflicto = new ErrorDominioFormulario("Otro usuario modificó el registro.", 409);
    expect(conLinea(conflicto, 3, "lineas", "Línea", campos)).toBe(conflicto);
    expect(respuestaDeExcepcion(conLinea(conflicto, 3, "lineas", "Línea", campos)).status).toBe(409);
  });
  it("el módulo ya no contiene heurísticas por texto del mensaje (esErrorTecnico eliminada)", () => {
    const src = readFileSync("src/lib/validacion-formulario.ts", "utf8");
    expect(src).not.toContain("esErrorTecnico");
    expect(src).not.toMatch(/ECONN|ETIMEDOUT|sql syntax/i);
  });
});
