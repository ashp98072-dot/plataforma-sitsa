import { describe, expect, it } from "vitest";
import type { NextResponse } from "next/server";
import { respuestaErrorValidacion } from "@/lib/validacion-http";
import { actualizarRutaSchema, crearRutaSchema, etiquetaCampoRuta, etiquetaCampoRutaFactory } from "./rutas-validacion";

/**
 * RUTAS-TARIFARIO-HISTORIAL-1 (§10/§11 del ticket) — problema real:
 * "dato inválido" sin decir qué campo. Estos tests prueban el mensaje
 * EXACTO que ahora recibe el usuario: nunca el genérico "Dato inválido",
 * siempre "Campo: motivo." por cada error, con la etiqueta correcta
 * incluso para filas de personalPredeterminado (Piloto/Auxiliar habitual).
 */

async function respuestaJson(res: NextResponse) {
  return JSON.parse(await res.text());
}

describe("crearRutaSchema — mensajes por campo (ejemplo literal del ticket)", () => {
  it("tarifaReferencia negativa -> 'Tarifa de referencia: debe ser mayor o igual a Q0.00.'", async () => {
    const parsed = crearRutaSchema.safeParse({ clienteId: 1, codigo: "R-1", tarifaReferencia: -5 });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const res = respuestaErrorValidacion(parsed.error, (path) => etiquetaCampoRuta(path, {}), "No se pudo guardar la ruta");
    const data = await respuestaJson(res);
    expect(data.error).toContain("• Tarifa de referencia: debe ser mayor o igual a Q0.00.");
    expect(data.campos.tarifaReferencia).toBe("Tarifa de referencia: debe ser mayor o igual a Q0.00.");
  });

  it("horaHabitual con formato inválido -> 'Hora habitual: formato inválido (usa HH:MM, 24 horas).'", () => {
    const parsed = crearRutaSchema.safeParse({ clienteId: 1, codigo: "R-1", horaHabitual: "25:99" });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const mensaje = etiquetaCampoRuta(parsed.error.issues[0].path, {});
    expect(`${mensaje}: ${parsed.error.issues[0].message}`).toBe("Hora habitual: formato inválido (usa HH:MM, 24 horas).");
  });

  it("empleado inválido en personalPredeterminado -> 'Piloto habitual: empleado no válido.'", () => {
    const body = { clienteId: 1, codigo: "R-1", personalPredeterminado: [{ empleadoId: -1, rol: "Piloto" }] };
    const parsed = crearRutaSchema.safeParse(body);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const issue = parsed.error.issues.find((i) => i.path.includes("empleadoId"))!;
    expect(etiquetaCampoRutaFactory(body)(issue.path)).toBe("Piloto habitual");
    expect(`${etiquetaCampoRutaFactory(body)(issue.path)}: ${issue.message}`).toBe("Piloto habitual: empleado no válido.");
  });

  it("auxiliar (no piloto) en personalPredeterminado -> 'Auxiliar habitual: empleado no válido.'", () => {
    const body = { clienteId: 1, codigo: "R-1", personalPredeterminado: [{ empleadoId: -1, rol: "Auxiliar" }] };
    const parsed = crearRutaSchema.safeParse(body);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const issue = parsed.error.issues.find((i) => i.path.includes("empleadoId"))!;
    expect(etiquetaCampoRutaFactory(body)(issue.path)).toBe("Auxiliar habitual");
  });

  it("destinoDescripcion demasiado largo -> 'Destino: máximo 300 caracteres.'", () => {
    const parsed = crearRutaSchema.safeParse({ clienteId: 1, codigo: "R-1", destinoDescripcion: "x".repeat(301) });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const issue = parsed.error.issues[0];
    expect(`${etiquetaCampoRuta(issue.path, {})}: ${issue.message}`).toBe("Destino: máximo 300 caracteres.");
  });

  it("varios campos inválidos a la vez -> una línea '•' por cada uno, NUNCA solo 'Dato inválido'", async () => {
    const parsed = crearRutaSchema.safeParse({ clienteId: 1, codigo: "", tarifaReferencia: -1, horaHabitual: "no-es-hora" });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const res = respuestaErrorValidacion(parsed.error, (path) => etiquetaCampoRuta(path, {}), "No se pudo guardar la ruta");
    const data = await respuestaJson(res);
    expect(data.error).not.toBe("Datos inválidos.");
    expect(data.error).not.toBe("Dato inválido");
    expect(data.error.startsWith("No se pudo guardar la ruta:\n")).toBe(true);
    expect((data.error.match(/•/g) ?? []).length).toBe(3);
    expect(Object.keys(data.campos)).toHaveLength(3);
  });

  it("clienteId ausente -> 'Cliente: selecciona un cliente.'", () => {
    const parsed = crearRutaSchema.safeParse({ codigo: "R-1" });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const issue = parsed.error.issues.find((i) => i.path[0] === "clienteId")!;
    expect(`${etiquetaCampoRuta(issue.path, {})}: ${issue.message}`).toBe("Cliente: selecciona un cliente.");
  });
});

describe("actualizarRutaSchema — mismos mensajes por campo en edición", () => {
  it("tarifaReferencia negativa en PATCH -> mismo mensaje que en POST", () => {
    const parsed = actualizarRutaSchema.safeParse({ tarifaReferencia: -1 });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const issue = parsed.error.issues[0];
    expect(`${etiquetaCampoRuta(issue.path, {})}: ${issue.message}`).toBe("Tarifa de referencia: debe ser mayor o igual a Q0.00.");
  });

  it("horaHabitual válida (HH:MM) pasa sin error", () => {
    expect(actualizarRutaSchema.safeParse({ horaHabitual: "08:30" }).success).toBe(true);
  });
});

describe("etiquetaCampoRuta — resto del mapa de etiquetas", () => {
  it.each([
    ["codigo", "Código"], ["nombre", "Nombre/descripción"], ["destinoDescripcion", "Destino"],
    ["tarifaVigenteDesde", "Vigente desde"], ["tarifaMotivo", "Motivo del cambio de tarifa"],
    ["contactoClienteId", "Contacto del cliente"], ["observaciones", "Observaciones"], ["activo", "Estado"],
  ])("%s -> %s", (campo, esperado) => {
    expect(etiquetaCampoRuta([campo], {})).toBe(esperado);
  });

  it("paradas por índice -> 'Parada N'", () => {
    expect(etiquetaCampoRuta(["paradas", 0, "lugarNombre"], {})).toBe("Parada 1");
    expect(etiquetaCampoRuta(["paradas", 2, "lugarNombre"], {})).toBe("Parada 3");
  });

  it("viaticoMonto de una fila de personal -> '<rol> habitual (viático)'", () => {
    const body = { personalPredeterminado: [{ rol: "Auxiliar" }] };
    expect(etiquetaCampoRuta(["personalPredeterminado", 0, "viaticoMonto"], body)).toBe("Auxiliar habitual (viático)");
  });

  it("campo desconocido no revienta: usa el nombre crudo del path", () => {
    expect(etiquetaCampoRuta(["campoQueNoExiste"], {})).toBe("campoQueNoExiste");
  });
});
