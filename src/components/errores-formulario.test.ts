import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ErrorCampo, ErroresFormulario, claseCampo } from "./errores-formulario";
import { indicesLlenos, leerErroresRespuesta, remapearLineas, type ErrorFormulario } from "@/lib/validacion-formulario";

/**
 * ERRORES DE VALIDACIÓN — lado del formulario: resumen visible cerca del botón, número de línea correcto, respaldo a json.error y
 * limpieza al guardar con éxito. Render estático del componente + inspección de fuente de las 4 pantallas (mismo criterio del repo).
 */
const E = (campo: string, etiqueta: string, mensaje: string, linea?: number, coleccion = "Línea"): ErrorFormulario => (linea ? { campo, etiqueta, mensaje, linea, coleccion } : { campo, etiqueta, mensaje });
const leer = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

describe("24) <ErroresFormulario> renderiza el resumen", () => {
  it("título + una viñeta por error, con role=alert, sin alert()", () => {
    const html = renderToStaticMarkup(createElement(ErroresFormulario, { errores: [E("lineas.1.monto", "Monto", "debe ser mayor que Q0.", 2), E("lineas.2.metodoPago", "Método de pago", "es obligatorio.", 3)] }));
    expect(html).toContain('role="alert"');
    expect(html).toContain("Hay datos que debes corregir:");
    expect(html).toContain("<li>Línea 2 — Monto: debe ser mayor que Q0.</li>");
    expect(html).toContain("<li>Línea 3 — Método de pago: es obligatorio.</li>");
  });
  it("25) muestra el número de línea correcto y la palabra de la pantalla (Parada, Auxiliar…)", () => {
    const html = renderToStaticMarkup(createElement(ErroresFormulario, { errores: [E("paradas.1.lugarNombre", "Lugar", "es obligatorio.", 2, "Parada"), E("auxiliarEmpleadoIds.2", "Auxiliares", "empleado inválido.", 3, "Auxiliar")] }));
    expect(html).toContain("Parada 2 — Lugar: es obligatorio.");
    expect(html).toContain("Auxiliar 3: empleado inválido.");
  });
  it("sin errores no pinta nada", () => {
    expect(renderToStaticMarkup(createElement(ErroresFormulario, { errores: [] }))).toBe("");
  });
  it("con muchos errores muestra un máximo razonable y resume el resto", () => {
    const muchos = Array.from({ length: 30 }, (_, i) => E(`lineas.${i}.monto`, "Monto", "es obligatorio.", i + 1));
    const html = renderToStaticMarkup(createElement(ErroresFormulario, { errores: muchos }));
    expect((html.match(/<li>/g) ?? []).length).toBe(13); // 12 + «+ 18 errores adicionales.»
    expect(html).toContain("+ 18 errores adicionales.");
  });
  it("no pinta HTML inyectado desde el mensaje del servidor", () => {
    const html = renderToStaticMarkup(createElement(ErroresFormulario, { errores: [E("a", "A", "<img src=x onerror=alert(1)>")] }));
    expect(html).not.toContain("<img");
  });
});

describe("resaltado de campos", () => {
  const errores = [E("lineas.1.monto", "Monto", "debe ser mayor que Q0.", 2)];
  it("marca el borde y muestra el texto bajo el campo afectado, no los demás", () => {
    expect(claseCampo(errores, "lineas.1.monto", "base")).toBe("base !border-red-500");
    expect(claseCampo(errores, "lineas.0.monto", "base")).toBe("base");
    expect(renderToStaticMarkup(createElement(ErrorCampo, { errores, campo: "lineas.1.monto" }))).toContain("Debe ser mayor que Q0.");
    expect(renderToStaticMarkup(createElement(ErrorCampo, { errores, campo: "lineas.0.monto" }))).toBe("");
  });
});

describe("26) respaldo a json.error y reasignación de líneas", () => {
  it("sin `errores` usa json.error; sin nada usa el texto de respaldo", () => {
    expect(leerErroresRespuesta({ error: "No se pudo completar la operación. Intenta nuevamente." }, "x")).toEqual({ mensaje: "No se pudo completar la operación. Intenta nuevamente.", errores: [] });
    expect(leerErroresRespuesta(undefined, "No se pudo crear la solicitud.")).toEqual({ mensaje: "No se pudo crear la solicitud.", errores: [] });
  });
  it("Fondos: las filas en blanco no se envían y el número de línea vuelve al de pantalla", () => {
    const blanca = { categoria: "", monto: "", descripcion: "" };
    const filas = [{ categoria: "Peajes", monto: "10", descripcion: "" }, { ...blanca }, { categoria: "Peajes", monto: "0", descripcion: "" }];
    const llenas = indicesLlenos(filas, blanca);
    expect(llenas).toEqual([0, 2]);
    const delServidor = [E("lineas.1.monto", "Monto", "debe ser mayor que Q0.", 2)]; // la 2.ª enviada
    expect(remapearLineas(delServidor, "lineas", llenas.map((i) => i + 1))[0]).toMatchObject({ linea: 3, campo: "lineas.2.monto" });
  });
});

describe("27) las 4 pantallas: resumen visible, errores estructurados y limpieza al guardar", () => {
  const fondos = leer("src/app/e/[slug]/fondos/page.tsx");
  const gastos = leer("src/app/e/[slug]/gastos/page.tsx");
  const compras = leer("src/components/compras/requerimiento-form-client.tsx");
  const plan = leer("src/app/e/[slug]/programacion/plan-form.tsx");
  for (const [nombre, src] of [["Solicitudes de fondo", fondos], ["Gastos", gastos], ["Requerimientos de compra", compras], ["Programación", plan]] as const) {
    it(`${nombre}: usa leerErroresRespuesta, pinta <ErroresFormulario> y deja json.error como respaldo`, () => {
      expect(src).toContain("leerErroresRespuesta(data");
      expect(src).toContain("<ErroresFormulario errores={errores} />");
      expect(src).toMatch(/setError\((leidos|delServidor)\.errores?\.?length \? "" : leidos\.mensaje\)|setError\(delServidor\.length \? "" : leidos\.mensaje\)/);
    });
    it(`${nombre}: limpia los errores al volver a guardar`, () => {
      expect(src).toContain("setErrores([])");
    });
  }
  it("Fondos y Gastos: el éxito limpia los errores y la pantalla ya no descarta líneas en silencio", () => {
    expect(fondos).toMatch(/setErrores\(\[\]\);\n\s+setMsg\(data\.mensaje/);
    expect(fondos).not.toContain("lineasValidas");
    expect(fondos).toContain("indicesLlenos(lineas, LINEA_VACIA)");
    expect(fondos).toContain('remapearLineas(leidos.errores, "lineas", lineasPantalla)');
    expect(gastos).toMatch(/setErrores\(\[\]\);\n\s+const gastoId/);
    expect(gastos).not.toContain("Cada línea adicional necesita categoría");
  });
  it("Programación: 'Parada N' del servidor se traduce al número de pantalla (las filas en blanco no se envían)", () => {
    expect(plan).toContain('remapearLineas(leidos.errores, "paradas", paradasPantalla)');
    expect((plan.match(/remapearLineas\(/g) ?? []).length).toBe(2);
  });
  it("ninguna pantalla usa alert() para errores de validación y los mensajes no son «Datos inválidos»", () => {
    for (const src of [fondos, gastos, plan]) expect(src).not.toMatch(/window\.alert\(.*(errores|Datos inv)/);
    for (const src of [fondos, gastos, compras, plan]) expect(src).not.toContain("Datos inválidos");
  });
});

describe("el componente", () => {
  const src = leer("src/components/errores-formulario.tsx");
  it("hace scroll y foco una sola vez por conjunto nuevo de errores (efecto dependiente de `errores`)", () => {
    expect(src).toContain("scrollIntoView");
    expect(src).toContain("preventScroll: true");
    expect(src).toMatch(/\}, \[errores\]\);/);
    expect(src).not.toMatch(/\balert\(/);
  });
});
