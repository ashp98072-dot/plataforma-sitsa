import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * PROGRAMACION-TC-CAJA-REMOLQUE-1 — guarda de regresión sobre el CÓDIGO
 * FUENTE (el proyecto no tiene @testing-library/react; mismo criterio que
 * plan-form-tercerizados.test.ts / plan-form-disponibilidad.test.ts): el
 * selector de TC del formulario de Programación.
 */
const leer = (...ruta: string[]) => readFileSync(join(__dirname, ...ruta), "utf-8").replace(/\r\n/g, "\n");
const planForm = leer("plan-form.tsx");
const placaSelect = leer("..", "..", "..", "..", "components", "tms", "placa-select.tsx");
const programacionClient = leer("programacion-client.tsx");

const pos = (fuente: string, texto: string, from = 0) => {
  const i = fuente.indexOf(texto, from);
  expect(i, `no se encontró (desde ${from}): ${texto}`).toBeGreaterThan(-1);
  return i;
};

describe("plan-form.tsx — Unidad y TC son selectores distintos (nunca mezclados)", () => {
  it("las opciones se separan por tipoUnidad: Unidad = todo lo que no es TC; TC = solo los clasificados como TC", () => {
    expect(planForm).toContain('const unidadesOpciones = todosVehiculos.filter((v) => v.tipoUnidad !== "TC");');
    expect(planForm).toContain('const tcOpciones = todosVehiculos.filter((v) => v.tipoUnidad === "TC");');
  });

  it("el selector de Unidad NUNCA recibe los TC y el de TC NUNCA recibe las unidades", () => {
    const iRama = pos(planForm, '{form.tipoViaje === "Propio" ? (');
    const rama = planForm.slice(iRama, pos(planForm, "Nunca crea empleados en RRHH", iRama));
    const primero = rama.indexOf("<PlacaSelect");
    const segundo = rama.indexOf("<PlacaSelect", primero + 1);
    expect(primero).toBeGreaterThan(-1);
    expect(segundo).toBeGreaterThan(primero);
    const unidad = rama.slice(primero, segundo);
    const tc = rama.slice(segundo, rama.indexOf("</div>", segundo));
    expect(unidad).toContain("options={unidadesOpciones}");
    expect(unidad).not.toContain("tcOpciones");
    expect(tc).toContain("options={tcOpciones}");
    expect(tc).not.toContain("unidadesOpciones");
    expect(tc).not.toContain("todosVehiculos");
  });

  it("el TC va DESPUÉS de Unidad, con su propia ocupación diaria, etiqueta y ayuda 'Opcional'", () => {
    const iRama = pos(planForm, '{form.tipoViaje === "Propio" ? (');
    const tc = planForm.slice(pos(planForm, "<PlacaSelect", pos(planForm, "<PlacaSelect", iRama) + 1));
    const bloque = tc.slice(0, tc.indexOf("/>"));
    expect(bloque).toContain("value={form.tcPlaca}");
    expect(bloque).toContain("ocupadas={ocupacionTcs}");
    expect(bloque).toContain('label="TC (buscar placa/marca/modelo)"');
    expect(bloque).toContain("Opcional");
  });

  it("la ocupación del TC sale de la MISMA consulta por intervalos (disponibilidad-recursos) y se asocia a su ventana", () => {
    expect(planForm).toContain("tcs: (data.tcs ?? {}) as Record<string, OcupacionRecurso>");
    expect(planForm).toContain("const ocupacionTcs = ocupacionDia.fecha === ventanaDisponibilidad ? ocupacionDia.tcs : {};");
  });

  it("el catálogo conserva id y tipoUnidad de cada vehículo (necesarios para separar y para mandar tcVehiculoId)", () => {
    const carga = planForm.slice(pos(planForm, "setTodosVehiculos("), pos(planForm, "setTodosVehiculos(") + 400);
    expect(carga).toContain("id: v.id");
    expect(carga).toContain("tipoUnidad: v.tipoUnidad");
  });
});

describe("plan-form.tsx — TC opcional y validado contra el catálogo interno", () => {
  const fn = () => planForm.slice(pos(planForm, "function resolverTcId()"), pos(planForm, "function camposTipoViaje()"));

  it("vacío = viaje sin TC (nunca bloquea la creación de un viaje normal)", () => {
    expect(fn()).toContain('if (!texto) return { ok: true, id: null };');
  });

  it("solo se acepta un texto que coincida con un TC clasificado; nunca se manda un texto libre como TC interno", () => {
    const f = fn();
    expect(f).toContain("tcOpciones.find((v) => v.placa.toUpperCase() === texto)");
    expect(f).toContain("Selecciona un TC de la lista");
  });

  it("solo aplica a viajes Propios (Tercerizado no consulta el catálogo interno)", () => {
    expect(fn()).toContain('if (form.tipoViaje !== "Propio") return { ok: true, id: null };');
  });

  it("un TC ya guardado y sin cambios se conserva aunque el catálogo aún no haya cargado", () => {
    expect(fn()).toContain("return { ok: true, id: plan.tc_vehiculo_id };");
  });

  it("POST manda tcVehiculoId (o nada); PATCH solo lo manda en Propio y solo si cambió (null lo quita)", () => {
    expect(planForm).toContain("tcVehiculoId: tcResuelto.id ?? undefined,");
    expect(planForm).toMatch(/form\.tipoViaje === "Propio" && tcResuelto\.id !== \(plan\?\.tc_vehiculo_id \?\? null\) \? tcResuelto\.id : undefined/);
  });

  it("el TC no se guarda en unidad_id/placa: la placa del formulario y el TC son campos distintos", () => {
    expect(planForm).toContain("placa: form.placa || undefined,");
    expect(planForm).toContain("tcPlaca");
    expect(planForm).not.toMatch(/placa:\s*form\.tcPlaca/);
  });
});

describe("plan-form.tsx — Tercerizado: TC externo solo como texto", () => {
  it("la rama Tercerizado tiene su campo 'TC externo (texto libre — no consulta Flota)' y no usa el catálogo interno", () => {
    const i = pos(planForm, "TC externo (texto libre — no consulta Flota)");
    const rama = planForm.slice(pos(planForm, ") : (", pos(planForm, '{form.tipoViaje === "Propio" ? (')), pos(planForm, "Nunca crea empleados en RRHH"));
    expect(rama).toContain("TC externo (texto libre — no consulta Flota)");
    expect(rama).toContain("value={form.tcExternoPlaca}");
    expect(rama).not.toContain("tcOpciones");
    expect(rama).not.toContain("<PlacaSelect");
    expect(i).toBeGreaterThan(-1);
  });

  it("camposTipoViaje manda tcExternoPlaca (mayúsculas) SOLO cuando el viaje es Tercerizado", () => {
    const f = planForm.slice(pos(planForm, "function camposTipoViaje()"), pos(planForm, "async function onSubmit"));
    expect(f).toContain('tcExternoPlaca: form.tipoViaje === "Tercerizado" ? form.tcExternoPlaca.trim().toUpperCase() || undefined : undefined');
  });

  it("el estado inicial separa el TC interno (tcPlaca) del externo (tcExternoPlaca) según el tipo del viaje", () => {
    expect(planForm).toContain('tcPlaca: plan?.tipo_viaje === "Tercerizado" ? "" : (plan?.tc ?? "")');
    expect(planForm).toContain('tcExternoPlaca: plan?.tipo_viaje === "Tercerizado" ? (plan?.tc_externo_placa ?? "") : ""');
  });
});

describe("PlacaSelect — reutilizado para TC sin cambiar el de Unidad", () => {
  it("los textos por defecto son EXACTAMENTE los de siempre (Unidad)", () => {
    expect(placaSelect).toContain('label = "Unidad (buscar placa/marca/modelo)"');
    expect(placaSelect).toContain('placeholderVacio = "Sin unidades disponibles…"');
    expect(placaSelect).toContain('"No se envían unidades en taller o en ruta"');
  });

  it("un TC asignado ese día se muestra pero deshabilitado ('Asignada · PLAN-…'), igual que Unidad — mismo componente, misma regla", () => {
    expect(placaSelect).toContain('etiqueta: "Asignada"');
    expect(placaSelect).toContain("disabled={Boolean(bloqueada)}");
    expect(placaSelect).toContain("if (bloqueo(o)) return;");
  });
});

describe("programacion-client.tsx — TC visible en el tablero y en la exportación a imagen", () => {
  it("la tarjeta del viaje muestra el TC junto a la Unidad solo cuando existe", () => {
    expect(programacionClient).toContain("{p.tc ? (");
    expect(programacionClient).toContain('<span className="text-xs text-[var(--muted)]">TC:</span>');
  });

  it("Exportar imagen arma la celda TC desde p.tc (Propio interno o Tercerizado snapshot: el GET ya lo resuelve)", () => {
    const fn = programacionClient.slice(pos(programacionClient, "async function exportarImagen"), pos(programacionClient, "const rango ="));
    expect(fn).toContain('tc: p.tc || "",');
  });

  it("el tipo Plan mantiene separados el id interno y el texto externo del TC", () => {
    expect(programacionClient).toContain("tc_vehiculo_id?: number | null;");
    expect(programacionClient).toContain("tc_externo_placa?: string | null;");
  });
});
