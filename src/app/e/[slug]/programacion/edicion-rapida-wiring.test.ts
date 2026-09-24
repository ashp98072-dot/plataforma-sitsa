import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * PROGRAMACIÓN — EDICIÓN RÁPIDA PR-3 — guardas de regresión sobre el CÓDIGO FUENTE (este proyecto no tiene
 * @testing-library/react; mismo criterio que programacion-exportar-imagen-wiring.test.ts). La lógica decidible sin
 * React (borrador, payload, estados, envío) se prueba en edicion-rapida-helpers.test.ts.
 */
// Normaliza saltos de línea: en Windows (core.autocrlf) el árbol de trabajo trae CRLF y los trozos buscan "\n".
const cliente = readFileSync(join(__dirname, "programacion-client.tsx"), "utf-8").replace(/\r\n/g, "\n");
const tabla = readFileSync(join(__dirname, "edicion-rapida.tsx"), "utf-8").replace(/\r\n/g, "\n");
const trozo = (src: string, desde: string, hasta: string) => {
  const i = src.indexOf(desde);
  expect(i, `no se encontró: ${desde}`).toBeGreaterThan(-1);
  const j = src.indexOf(hasta, i + desde.length);
  expect(j, `no se encontró: ${hasta}`).toBeGreaterThan(-1);
  return src.slice(i, j);
};

describe("programacion-client.tsx — entrada al modo", () => {
  it("1/2) el botón solo se pinta con programacion:editar", () => {
    expect(cliente).toContain("const puedeEdicionRapida = puedeUsarEdicionRapida(permisos);");
    const boton = trozo(cliente, "{puedeEdicionRapida ? (", ") : null}");
    expect(boton).toContain("onClick={alternarModoRapido}");
    expect(boton).toContain('"Edición rápida"');
  });

  it("3) entrar/salir: el mismo botón alterna a 'Salir de edición rápida'; salir pasa por la confirmación", () => {
    expect(cliente).toContain('{modoRapido ? "Salir de edición rápida" : "Edición rápida"}');
    const fn = trozo(cliente, "function alternarModoRapido()", "\n  }\n");
    expect(fn).toContain("siSePuedenPerderCambios(() => setModoRapido(false))");
    expect(fn).toContain("setModoRapido(true)");
    // al entrar se cierran los formularios de Ajustar / Nuevo (no se abre modal por fila)
    expect(fn).toContain("setEditandoId(null)");
    expect(fn).toContain("setMostrarCrear(false)");
  });

  it("la tabla reemplaza las tarjetas y trabaja SOLO sobre `visibles` (rango + filtros activos)", () => {
    expect(cliente).toContain('<div className="space-y-2" hidden={modoRapido}>');
    const filas = trozo(cliente, "const filasEdicionRapida = useMemo", "[visibles],");
    expect(filas).toContain("visibles.map((p) =>");
    expect(filas).not.toMatch(/fetch\(/);
    expect(cliente).toContain("filas={filasEdicionRapida}");
  });

  it("Ajustar sigue existiendo (no se reemplaza el flujo actual)", () => {
    expect(cliente).toContain("<PlanForm");
    expect(cliente).toContain("setEditandoId((cur) => (cur === p.id ? null : p.id))");
  });
});

describe("programacion-client.tsx — no perder el borrador", () => {
  it("30) cambiar filtros/fecha/rango/Actualizar con cambios pide confirmación", () => {
    expect(cliente).toContain("onClick={() => siSePuedenPerderCambios(() => setFiltroRapido(key))}");
    expect(cliente).toContain("siSePuedenPerderCambios(() => setFiltroRapido(valor))");
    expect(cliente).toContain("siSePuedenPerderCambios(() => setFechaSeleccionada(valor))");
    expect(cliente).toContain("siSePuedenPerderCambios(() => setFPiloto(valor))");
    expect(cliente).toContain("siSePuedenPerderCambios(() => setFUnidad(valor))");
    expect(cliente).toContain("siSePuedenPerderCambios(() => setFCliente(valor))");
    expect(cliente).toContain("onClick={() => siSePuedenPerderCambios(() => void cargar())}");
    expect(trozo(cliente, '["fecha", "Fecha"]', "</button>")).toContain("siSePuedenPerderCambios(() => {");
    // ningún setter de filtro queda sin envolver
    expect(cliente).not.toMatch(/onChange=\{\(e\) => set(FPiloto|FUnidad|FCliente)\(/);
  });

  it("31) la confirmación usa confirmarPerdida y al aceptar se descarta el borrador (remonta la tabla)", () => {
    const fn = trozo(cliente, "function siSePuedenPerderCambios(", "\n  }\n");
    expect(fn).toContain("confirmarPerdida(hayPendientesRapida, (m) => window.confirm(m))");
    expect(fn).toContain("setVersionRapida((v) => v + 1)");
    expect(cliente).toContain("key={versionRapida}");
  });

  it("recargar la pestaña con cambios pide confirmación (beforeunload) y el sondeo pasivo se pausa", () => {
    expect(cliente).toContain('window.addEventListener("beforeunload", alSalir)');
    expect(trozo(cliente, "if (silencioso) {", "obtenerProgramacion")).toContain("if (pausarSondeoRef.current) return;");
  });

  it("21) tras guardar OK la tabla refresca Programación desde el servidor (misma carga del botón Actualizar)", () => {
    expect(cliente).toContain("onGuardado={cargar}");
  });
});

describe("edicion-rapida.tsx", () => {
  it("usa los endpoints existentes a través de los helpers (sin contrato nuevo)", () => {
    expect(tabla).toContain("enviarValidar((u, i) => fetch(u, i), slug, cuerpoEdicionRapida(borrador, motivo))");
    expect(tabla).toContain("enviarGuardar((u, i) => fetch(u, i), slug, cuerpoEdicionRapida(borrador, motivo))");
  });

  it("11) un único campo de motivo arriba con el placeholder pedido", () => {
    expect(tabla.match(/placeholder="Ej\. Piloto no se presentó"/g)).toHaveLength(1);
    expect(tabla).toContain("Motivo del cambio");
  });

  it("contador superior y botones Descartar / Validar / Guardar", () => {
    expect(tabla).toContain("Cambios: <strong>{resumen.cambios}</strong>");
    expect(tabla).toContain("Descartar cambios");
    expect(tabla).toContain('{validando ? "Validando…" : "Validar"}');
    expect(tabla).toContain('{guardando ? "Guardando…" : "Guardar cambios"}');
  });

  it("12) Descartar pide confirmación y limpia borrador, validación, errores y mensajes", () => {
    const fn = trozo(tabla, "function descartar()", "\n  }\n");
    expect(fn).toContain("confirmarPerdida(borrador.size > 0, (m) => window.confirm(m))");
    for (const x of ["setBorrador(new Map())", "setResultados(new Map())", 'setError("")', 'setMensaje("")']) expect(fn).toContain(x);
  });

  it("4) cambiar un select NO guarda: solo edita el borrador e invalida la validación previa", () => {
    const fn = trozo(tabla, "function cambiar(", "\n  }\n");
    expect(fn).toContain("setBorrador((b) => editarRecursos(b, plan, cambios))");
    expect(fn).toContain("setResultados(new Map())");
    expect(fn).not.toMatch(/fetch|enviar/);
  });

  it("20/22) guardar: OK refresca, limpia borrador y validaciones; 409/error conserva el borrador y pinta errores por fila", () => {
    const fn = trozo(tabla, "async function guardar()", "\n  }\n");
    const ok = trozo(fn, 'if (r.tipo === "ok") {', "return;");
    expect(ok.indexOf("await onGuardado()")).toBeLessThan(ok.indexOf("setBorrador(new Map())"));
    expect(ok).toContain("setResultados(new Map())");
    expect(ok).toContain("setMensaje(mensajeGuardado(r.guardados))");
    const noOk = fn.slice(fn.indexOf("return;", fn.indexOf('if (r.tipo === "ok") {')));
    expect(noOk).not.toContain("setBorrador");
    expect(noOk).toContain("setResultados(mapaResultados(r.filas))");
  });

  it("32) candado contra doble submit en Validar y Guardar; mientras guarda los selects se deshabilitan", () => {
    expect(trozo(tabla, "async function validar()", "\n  }\n")).toContain("if (ocupadoRef.current) return;");
    expect(trozo(tabla, "async function guardar()", "\n  }\n")).toContain("if (ocupadoRef.current) return;");
    expect(tabla).toContain("const deshabilitado = bloqueo != null || guardando || internosBloqueados;");
    expect(tabla).toContain("disabled={!puedeValidar(borrador, motivo, ocupado)}");
    expect(tabla).toContain("disabled={!puedeGuardar(borrador, motivo, resultados, ocupado)}");
  });

  it("16/17/18) estado de edición por fila, errores y advertencias visibles (sin alert())", () => {
    expect(tabla).toContain("data-estado-edicion={estado}");
    expect(tabla).toContain("res.errores.map((e, k) => <li key={k}>{e.mensaje}</li>)");
    expect(tabla).toContain("res.advertencias.map((a, k) =>");
    expect(tabla).not.toMatch(/\balert\(/);
  });

  it("24-27) filas no editables: selects deshabilitados y motivo visible (Tercerizado/Cerrado/Cancelado/Histórico)", () => {
    expect(tabla).toContain("const bloqueo = motivoNoEditable(p, hoy);");
    expect(tabla).toContain("{bloqueo}");
  });

  it("34) edita piloto/auxiliares/unidad/TC + (PR-355) tarifa y viáticos: no hay inputs de fecha, hora, regreso, ruta, cliente ni estado", () => {
    expect(tabla).not.toMatch(/type="(date|time|datetime-local)"/);
    expect(tabla.match(/type="number"/g)).toHaveLength(1); // solo el monto del viático
    expect(tabla.match(/<select/g)).toHaveLength(5); // piloto, + auxiliar, unidad, TC y tarifa
    for (const x of ["pilotoPersonalId:", "auxiliarPersonalIds:", "flotaVehiculoId:", "tcVehiculoId:", "tarifaId:"]) expect(tabla).toContain(x);
  });

  it("tabla compacta con scroll horizontal y selects con aria-label", () => {
    expect(tabla).toContain('className="overflow-x-auto');
    for (const x of ["Piloto de ${p.codigo}", "Agregar auxiliar a ${p.codigo}", "Unidad de ${p.codigo}", "TC de ${p.codigo}"]) expect(tabla).toContain(x);
  });
});
