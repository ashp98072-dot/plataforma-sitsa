import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validarEdicionRapidaSchema } from "@/lib/tms/edicion-rapida-schema";
import {
  cambiosDelBorrador,
  cuerpoEdicionRapida,
  editarRecursos,
  editarViatico,
  errorAntesDeEnviar,
  motivoNoEditable,
  opcionesTarifa,
  puedeEditarTarifa,
  puedeEditarViaticos,
  tieneRutaConTarifas,
  recursosInternosBloqueados,
  snapshotEsperado,
  tarifaEfectiva,
  tarifaVisible,
  TARIFA_MANUAL_PENDIENTE,
  viaticosVisibles,
  type Borrador,
  type EntradaBorrador,
  type PlanEdicionRapida,
  type TarifaRutaEdicion,
} from "./edicion-rapida-helpers";

/** PR-355 — UI pura de Edición rápida: tarifa y viáticos (borrador, payload, opciones, filas no editables). */
const HOY = "2026-09-24";
const plan = (over: Partial<PlanEdicionRapida> = {}): PlanEdicionRapida => ({
  id: 1, codigo: "P-1", estado: "Programado", fecha_plan: "2026-09-25", hora_carga: "08:00:00", regreso_estimado: "2026-09-25T18:00",
  tipo_viaje: "Propio", pilotoId: 10, piloto: "Carlos", auxiliaresDetalle: [{ personalId: 20, nombre: "Pedro" }],
  placa: "C-1", tc: null, tc_vehiculo_id: null, flotaVehiculoId: 500, auxiliarPersonalIds: [20],
  ruta_id: 5, tarifa_id: null, tarifa_comercial: null,
  viaticos: [{ personalId: 10, montoAsignado: "200.00", estado: "PROGRAMADO" }, { personalId: 20, montoAsignado: "150.00", estado: "PROGRAMADO" }],
  ...over,
});
const vacio = (): Borrador => new Map<number, EntradaBorrador>();
const TARIFAS: TarifaRutaEdicion[] = [{ id: 61, nombre: "Corta", monto: "1500.00", moneda: "GTQ" }, { id: 62, nombre: "Larga", monto: 2500, moneda: "GTQ" }];

describe("Edición rápida (UI) — TARIFA", () => {
  it("T1) el snapshot esperado incluye tarifa y monto comercial (números, aunque el GET los mande como texto)", () => {
    const s = snapshotEsperado(plan({ tarifa_id: 61, tarifa_comercial: "1500.00" }));
    expect(s.tarifaId).toBe(61);
    expect(s.tarifaComercial).toBe(1500);
  });

  it("T2) elegir tarifa edita el borrador; volver a la original saca la fila del borrador", () => {
    const b = editarRecursos(vacio(), plan(), { tarifaId: 61 });
    expect(b.size).toBe(1);
    expect(tarifaVisible(b, plan())).toBe(61);
    expect(editarRecursos(b, plan(), { tarifaId: null }).size).toBe(0);
  });

  it("T3) el cuerpo manda tarifaId SOLO si se tocó, y siempre la tarifa esperada (concurrencia)", () => {
    const soloPiloto = cuerpoEdicionRapida(editarRecursos(vacio(), plan(), { pilotoPersonalId: 11 }), "m");
    expect("tarifaId" in soloPiloto.cambios[0].nuevo).toBe(false);
    expect(soloPiloto.cambios[0].esperado.tarifaId).toBeNull();
    const conTarifa = cuerpoEdicionRapida(editarRecursos(vacio(), plan(), { tarifaId: 61 }), "m");
    expect(conTarifa.cambios[0].nuevo.tarifaId).toBe(61);
    expect(conTarifa.cambios[0].esperado).toMatchObject({ tarifaId: null, tarifaComercial: null });
  });

  it("T4) el cuerpo cumple EXACTAMENTE el contrato estricto del servidor (sin campos extra)", () => {
    const b = editarRecursos(editarRecursos(vacio(), plan(), { tarifaId: 61 }), plan(), { pilotoPersonalId: 11 });
    expect(validarEdicionRapidaSchema.safeParse(cuerpoEdicionRapida(b, "Motivo")).success).toBe(true);
  });

  it("T5) 'Sin tarifa' (null) en un viaje que ya tiene tarifa es un cambio y se envía como null", () => {
    const p = plan({ tarifa_id: 61, tarifa_comercial: 1500 });
    const b = editarRecursos(vacio(), p, { tarifaId: null });
    expect(cuerpoEdicionRapida(b, "m").cambios[0].nuevo.tarifaId).toBeNull();
  });

  it("T6) opciones: solo las tarifas activas de la RUTA del viaje, con moneda y monto; la actual no vigente se conserva marcada", () => {
    const o = opcionesTarifa(TARIFAS, { id: null });
    expect(o.map((x) => x.id)).toEqual([61, 62]);
    expect(o[0].etiqueta).toContain("Corta");
    expect(o[0].etiqueta).toContain("GTQ");
    const conVieja = opcionesTarifa(TARIFAS, { id: 99, nombre: "Vieja", monto: 800 });
    expect(conVieja[0]).toMatchObject({ id: 99 });
    expect(conVieja[0].etiqueta).toContain("no vigente");
    expect(opcionesTarifa(undefined, { id: null })).toEqual([]); // ruta sin tarifas: solo "— Sin tarifa —" en el select
  });

  it("T7) con GET anterior (sin tarifa_id) la fila no edita tarifa; sin ruta solo hay tarifa manual", () => {
    expect(puedeEditarTarifa(plan())).toBe(true);
    expect(puedeEditarTarifa(plan({ ruta_id: null }))).toBe(true); // sin ruta: la tarifa manual sigue disponible
    expect(tieneRutaConTarifas(plan({ ruta_id: null }))).toBe(false); // pero no el catálogo
    expect(puedeEditarTarifa(plan({ tarifa_id: undefined }))).toBe(false);
  });

  it("T8) Tercerizado: la fila SÍ es editable (tarifa) pero los recursos internos y viáticos quedan bloqueados", () => {
    const t = plan({ tipo_viaje: "Tercerizado" });
    expect(motivoNoEditable(t, HOY)).toBeNull();
    expect(recursosInternosBloqueados(t)).toBe(true);
    expect(puedeEditarViaticos(t)).toBe(false);
    expect(puedeEditarTarifa(t)).toBe(true);
  });

  it("T9) Cerrado/Cancelado/Histórico siguen sin ser editables", () => {
    expect(motivoNoEditable(plan({ estado: "Cerrado" }), HOY)).toBe("Cerrado");
    expect(motivoNoEditable(plan({ estado: "Cancelado" }), HOY)).toBe("Cancelado");
    expect(motivoNoEditable(plan({ fecha_plan: "2026-09-01" }), HOY)).toBe("Histórico");
  });

  it("T10) flujo 'copiar sin tarifa → asignar en Edición rápida': viaje copiado (tarifa NULL) + tarifa de la ruta → cuerpo válido", () => {
    const copiado = plan({ tarifa_id: null, tarifa_comercial: null });
    const b = editarRecursos(vacio(), copiado, { tarifaId: TARIFAS[0].id });
    const cuerpo = cuerpoEdicionRapida(b, "Se asigna la tarifa");
    expect(errorAntesDeEnviar(b, "Se asigna la tarifa")).toBeNull();
    expect(cuerpo.cambios[0]).toMatchObject({ planId: 1, esperado: { tarifaId: null, tarifaComercial: null }, nuevo: { tarifaId: 61 } });
    expect(validarEdicionRapidaSchema.safeParse(cuerpo).success).toBe(true);
  });
});

describe("Edición rápida (UI) — VIÁTICOS", () => {
  it("V1) el snapshot incluye los viáticos reales (ids de tms_personal, monto numérico y estado)", () => {
    expect(snapshotEsperado(plan()).viaticos).toEqual([
      { personalId: 10, montoAsignado: 200, estado: "PROGRAMADO" }, { personalId: 20, montoAsignado: 150, estado: "PROGRAMADO" },
    ]);
  });

  it("V2) editar un monto marca la fila y solo lo editado viaja en `nuevo.viaticos`", () => {
    const b = editarViatico(vacio(), plan(), 10, 250);
    const c = cuerpoEdicionRapida(b, "m").cambios[0];
    expect(c.nuevo.viaticos).toEqual([{ personalId: 10, montoAsignado: 250 }]);
    expect(c.esperado.viaticos).toHaveLength(2);
    expect(validarEdicionRapidaSchema.safeParse(cuerpoEdicionRapida(b, "m")).success).toBe(true);
  });

  it("V3) devolver el monto al original deshace la edición (sale del borrador)", () => {
    const b = editarViatico(vacio(), plan(), 10, 250);
    expect(editarViatico(b, plan(), 10, 200).size).toBe(0);
  });

  it("V4) cambiar de piloto descarta el monto editado de quien ya no está en el viaje", () => {
    const p = plan();
    const b = editarRecursos(editarViatico(vacio(), p, 10, 250), p, { pilotoPersonalId: 11 });
    const c = cuerpoEdicionRapida(b, "m").cambios[0];
    expect(c.nuevo.pilotoPersonalId).toBe(11);
    expect("viaticos" in c.nuevo).toBe(false); // el viático de Carlos ya no aplica
  });

  it("V5) el viático del NUEVO piloto se puede editar en el mismo borrador (aún sin fila real: monto null)", () => {
    const p = plan();
    let b = editarRecursos(vacio(), p, { pilotoPersonalId: 11 });
    expect(viaticosVisibles(b, p).find((v) => v.personalId === 11)).toMatchObject({ monto: null, estado: null, editado: false });
    b = editarViatico(b, p, 11, 300);
    expect(cuerpoEdicionRapida(b, "m").cambios[0].nuevo.viaticos).toEqual([{ personalId: 11, montoAsignado: 300 }]);
  });

  it("V6) las filas de viático mostradas siguen al estado FINAL (piloto + auxiliares) con su estado real", () => {
    const p = plan({ viaticos: [{ personalId: 10, montoAsignado: 200, estado: "AUTORIZADO" }, { personalId: 20, montoAsignado: 150, estado: "PROGRAMADO" }] });
    const v = viaticosVisibles(vacio(), p);
    expect(v.map((x) => x.personalId)).toEqual([10, 20]);
    expect(v[0]).toMatchObject({ monto: 200, estado: "AUTORIZADO" });
    const sinAux = editarRecursos(vacio(), p, { auxiliarPersonalIds: [] });
    expect(viaticosVisibles(sinAux, p).map((x) => x.personalId)).toEqual([10]);
  });

  it("V7) validación previa: un monto inválido (negativo o con más de 2 decimales) no se envía", () => {
    expect(errorAntesDeEnviar(editarViatico(vacio(), plan(), 10, -5), "m")).toMatch(/viático inválido/i);
    expect(errorAntesDeEnviar(editarViatico(vacio(), plan(), 10, 10.555), "m")).toMatch(/viático inválido/i);
    expect(errorAntesDeEnviar(editarViatico(vacio(), plan(), 10, 0), "m")).toBeNull(); // 0 es válido
  });

  it("V8) el motivo sigue siendo obligatorio para viáticos (mismo campo del lote)", () => {
    expect(errorAntesDeEnviar(editarViatico(vacio(), plan(), 10, 250), "  ")).toBe("Indica el motivo del cambio.");
  });

  it("V9) GET anterior sin viáticos: la fila no edita viáticos y el snapshot no los envía", () => {
    const p = plan({ viaticos: undefined });
    expect(puedeEditarViaticos(p)).toBe(false);
    expect("viaticos" in snapshotEsperado(p)).toBe(false);
  });
});

describe("Edición rápida (UI) — guardas de código (PR-355)", () => {
  const fuente = (f: string) => readFileSync(join(__dirname, f), "utf-8").replace(/\r\n/g, "\n");
  const tabla = fuente("edicion-rapida.tsx");
  const cliente = fuente("programacion-client.tsx");

  it("U1) la tabla tiene las columnas Tarifa y Viáticos con selects/inputs accesibles y colSpan actualizado", () => {
    expect(tabla).toContain('"Tarifa", "Viáticos"');
    expect(tabla).toContain("aria-label={`Tarifa de ${p.codigo}`}");
    expect(tabla).toContain("aria-label={`Viático de ${nombre} en ${p.codigo}`}");
    expect(tabla).toContain("colSpan={11}");
    expect(tabla).toContain("— Sin tarifa —");
  });

  it("U2) el viático procesado (no PROGRAMADO) queda deshabilitado en la UI", () => {
    expect(tabla).toContain('estadoViatico !== "PROGRAMADO"');
    expect(tabla).toContain("disabled={viaticosDeshabilitados || procesado}");
  });

  it("U3) programacion-client trae las tarifas por ruta del GET aditivo y las pasa a la tabla", () => {
    expect(cliente).toContain("tarifasPorRuta: (dataPlanes.tarifasPorRuta ?? {})");
    expect(cliente).toContain("tarifasPorRuta={tarifasPorRuta}");
  });
});

describe("Edición rápida (UI) — TARIFA MANUAL", () => {
  const sin = () => plan({ tarifa_id: null, tarifa_comercial: null });
  const manual = (m: number | string) => plan({ tarifa_id: null, tarifa_comercial: m });
  const conCatalogo = () => plan({ tarifa_id: 61, tarifa_comercial: 1500 });
  const man = (m: number | null) => ({ tarifaId: null, tarifaComercial: m });

  it("M1) distingue los tres estados: catálogo / manual / sin tarifa (nunca 0 = sin tarifa)", () => {
    expect(tarifaEfectiva(vacio(), conCatalogo()).tipo).toBe("catalogo");
    expect(tarifaEfectiva(vacio(), manual("850.00"))).toMatchObject({ tipo: "manual", monto: 850 });
    expect(tarifaEfectiva(vacio(), sin()).tipo).toBe("sin");
    expect(tarifaEfectiva(vacio(), manual(0)).tipo).toBe("manual"); // manual 0 ≠ sin tarifa
  });

  it("M2) sin tarifa → manual 850: la fila queda Modificada (Cambios +1) y el cuerpo manda tarifaId null + monto", () => {
    const b = editarRecursos(vacio(), sin(), man(850));
    expect(cambiosDelBorrador(b)).toHaveLength(1);
    const c = cuerpoEdicionRapida(b, "m").cambios[0];
    expect(c.nuevo).toMatchObject({ tarifaId: null, tarifaComercial: 850 });
    expect(c.esperado).toMatchObject({ tarifaId: null, tarifaComercial: null });
    expect(validarEdicionRapidaSchema.safeParse(cuerpoEdicionRapida(b, "m")).success).toBe(true);
  });

  it("M3) cambiar solo el monto manual (850 → 900) cuenta como fila modificada", () => {
    const b = editarRecursos(vacio(), manual(850), man(900));
    expect(cambiosDelBorrador(b)).toHaveLength(1);
    expect(cuerpoEdicionRapida(b, "m").cambios[0].esperado.tarifaComercial).toBe(850);
  });

  it("M4) volver exactamente al monto original elimina el borrador (también al volver de un cambio de tipo)", () => {
    const p = manual(850);
    let b = editarRecursos(vacio(), p, man(900));
    expect(editarRecursos(b, p, man(850)).size).toBe(0);
    b = editarRecursos(vacio(), p, { tarifaId: 61 }); // manual → catálogo
    expect(b.size).toBe(1);
    expect(editarRecursos(b, p, man(850)).size).toBe(0); // vuelve a manual 850
    expect(editarRecursos(editarRecursos(vacio(), sin(), man(null)), sin(), man(null)).size).toBe(0);
  });

  it("M5) manual → sin tarifa y catálogo → sin tarifa se envían con tarifaComercial null (estado explícito)", () => {
    for (const p of [manual(850), conCatalogo()]) {
      const c = cuerpoEdicionRapida(editarRecursos(vacio(), p, man(null)), "m").cambios[0];
      expect(c.nuevo).toMatchObject({ tarifaId: null, tarifaComercial: null });
      expect(validarEdicionRapidaSchema.safeParse({ motivoCambio: "m", cambios: [c] }).success).toBe(true);
    }
  });

  it("M6) catálogo NO manda tarifaComercial (el servidor resuelve el monto); manual → catálogo descarta el monto", () => {
    const b = editarRecursos(editarRecursos(vacio(), manual(850), man(900)), manual(850), { tarifaId: 62, tarifaComercial: 123 });
    const c = cuerpoEdicionRapida(b, "m").cambios[0];
    expect(c.nuevo.tarifaId).toBe(62);
    expect("tarifaComercial" in c.nuevo).toBe(false);
    expect(validarEdicionRapidaSchema.safeParse({ motivoCambio: "m", cambios: [c] }).success).toBe(true);
  });

  it("M7) 'Tarifa manual' elegida sin monto aún: la fila queda modificada pero NO se puede enviar", () => {
    const b = editarRecursos(vacio(), sin(), man(TARIFA_MANUAL_PENDIENTE));
    expect(b.size).toBe(1);
    expect(tarifaEfectiva(b, sin()).tipo).toBe("manual");
    expect(errorAntesDeEnviar(b, "m")).toBe("Falta el monto de la tarifa manual.");
  });

  it("M8) monto manual 0 es válido; negativo o con más de 2 decimales no se envían", () => {
    expect(errorAntesDeEnviar(editarRecursos(vacio(), sin(), man(0)), "m")).toBeNull();
    expect(errorAntesDeEnviar(editarRecursos(vacio(), sin(), man(-1)), "m")).toMatch(/tarifa manual inválido/i);
    expect(errorAntesDeEnviar(editarRecursos(vacio(), sin(), man(10.555)), "m")).toMatch(/tarifa manual inválido/i);
  });

  it("M9) tarifa manual + viáticos en el mismo borrador viajan juntos", () => {
    const p = sin();
    const b = editarViatico(editarRecursos(vacio(), p, man(850)), p, 10, 250);
    const c = cuerpoEdicionRapida(b, "m").cambios[0];
    expect(c.nuevo).toMatchObject({ tarifaId: null, tarifaComercial: 850, viaticos: [{ personalId: 10, montoAsignado: 250 }] });
    expect(validarEdicionRapidaSchema.safeParse(cuerpoEdicionRapida(b, "m")).success).toBe(true);
  });

  it("M10) tarifa manual + cambio de piloto en el mismo borrador", () => {
    const b = editarRecursos(editarRecursos(vacio(), sin(), man(850)), sin(), { pilotoPersonalId: 11 });
    const c = cuerpoEdicionRapida(b, "m").cambios[0];
    expect(c.nuevo).toMatchObject({ pilotoPersonalId: 11, tarifaComercial: 850 });
  });

  it("M11) la tabla ofrece 'Tarifa manual' con su input de monto (Q) accesible", () => {
    const tabla = readFileSync(join(__dirname, "edicion-rapida.tsx"), "utf-8").replace(/\r\n/g, "\n");
    expect(tabla).toContain('<option value="manual">— Tarifa manual —</option>');
    expect(tabla).toContain("aria-label={`Monto de tarifa manual de ${p.codigo}`}");
    expect(tabla).toContain('tarifa.tipo === "manual" ?');
  });

  it("M12) viaje sin ruta: se puede poner tarifa manual (no requiere ruta) pero no de catálogo", () => {
    const p = plan({ ruta_id: null });
    expect(puedeEditarTarifa(p)).toBe(true);
    expect(tieneRutaConTarifas(p)).toBe(false);
    expect(cuerpoEdicionRapida(editarRecursos(vacio(), p, man(850)), "m").cambios[0].nuevo.tarifaComercial).toBe(850);
  });

  it("M13) contrato sin cambios en el estado de catálogo: tarifaVisible sigue devolviendo el id", () => {
    expect(tarifaVisible(editarRecursos(vacio(), sin(), { tarifaId: 61 }), sin())).toBe(61);
  });
});
