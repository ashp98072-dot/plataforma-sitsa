import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolverDescargaReporte } from "./plan-lugares";
import {
  cambioHoraCarga,
  cambioParadas,
  cambioTextoSnapshot,
  crearSecuenciaCargas,
  debeAplicarRuta,
  enterEligeRuta,
  normalizarHora,
  paradasFormularioDesdePlan,
  plantillaDesdeRuta,
  descripcionReporteInicial,
  type ParadaFormulario,
  type ParadaPersistida,
  type RutaPlantilla,
} from "./plan-form-cambios";

/**
 * PROGRAMACION-PERSISTENCIA — ciclo completo del formulario de Programación sin React (mismas funciones que usa
 * plan-form.tsx): elegir ruta -> editar -> PATCH (solo cambios) -> lo que vuelve el GET -> reabrir.
 * La ruta maestra es SOLO plantilla: lo editado para el viaje persiste y no se vuelve a pisar.
 */
const RUTA: RutaPlantilla = {
  id: 8, codigo: "1001", horaHabitual: "04:00:00", destinoDescripcion: "Mixco", lugarCargaTexto: "Bodega Central", ubicacionCargaId: 31,
  paradas: [{ lugarNombre: "Mixco", tipo: "Descarga", clienteUbicacionId: 32 }],
};
const OTRA_RUTA: RutaPlantilla = { ...RUTA, id: 9, codigo: "2002", horaHabitual: "05:15", destinoDescripcion: "Escuintla", paradas: [] };

/** Simula lo que el servidor guarda y devuelve el GET a partir de un PATCH (mismo contrato que planes/route.ts). */
type PlanGuardado = { hora_carga: string; lugar_descarga_historico: string | null; ruta_codigo_historico: string | null; paradas: ParadaPersistida[] };
function aplicarPatch(plan: PlanGuardado, patch: { horaCarga?: string; lugarDescargaHistorico?: string | null; paradas?: ParadaFormulario[] }): PlanGuardado {
  let sig = 100;
  return {
    ...plan,
    hora_carga: patch.horaCarga ?? plan.hora_carga, // hora_carga = COALESCE(?, hora_carga)
    lugar_descarga_historico: patch.lugarDescargaHistorico === undefined ? plan.lugar_descarga_historico : patch.lugarDescargaHistorico,
    paradas: patch.paradas === undefined
      ? plan.paradas
      : patch.paradas.map((p) => ({ id: p.id ?? ++sig, lugar_nombre: p.lugarNombre, tipo: p.tipo, requiere_evidencia: p.requiereEvidencia })),
  };
}
const payload = (ps: ParadaFormulario[]) => ps.filter((p) => p.lugarNombre.trim()).map((p) => ({
  id: p.id, lugarNombre: p.lugarNombre.trim(), tipo: p.tipo, requiereEvidencia: p.requiereEvidencia, clienteUbicacionId: p.clienteUbicacionId ?? undefined,
}));

/** Viaje creado desde la ruta (04:00, Mixco, carga Bodega Central -> descarga Mixco) y guardado. */
function viajeCreado(): PlanGuardado {
  const p = plantillaDesdeRuta(RUTA, { horaCarga: "08:00", lugarDescargaHistorico: "" });
  return {
    hora_carga: `${p.horaCarga}:00`,
    // El servidor deriva el «Lugar de Descarga» de la 1.ª Descarga/Entrega (resolverDescargaReporte); la ruta solo aporta
    // una descripción distinta cuando difiere de la parada.
    lugar_descarga_historico: resolverDescargaReporte({
      override: p.lugarDescargaHistorico,
      paradasNuevas: p.paradas!.map((x) => ({ lugarNombre: x.lugarNombre, tipo: x.tipo })),
    }).valor,
    ruta_codigo_historico: p.rutaCodigo,
    paradas: p.paradas!.map((x, i) => ({ id: i + 1, lugar_nombre: x.lugarNombre, tipo: x.tipo, requiere_evidencia: true })),
  };
}

describe("hora: 04:00 de la ruta -> 06:30 del viaje", () => {
  it("1) seleccionar ruta precarga la hora habitual", () => {
    expect(plantillaDesdeRuta(RUTA, { horaCarga: "08:00", lugarDescargaHistorico: "" }).horaCarga).toBe("04:00");
  });
  it("2-5) cambiar la hora, guardar, el GET la devuelve y al REABRIR se ve 06:30 (no 04:00)", () => {
    const guardado = viajeCreado();
    expect(normalizarHora(guardado.hora_carga)).toBe("04:00");
    const formHora = "06:30"; // 2) el usuario cambia la hora
    const envio = cambioHoraCarga(guardado.hora_carga, formHora); // 3) guardar
    expect(envio).toBe("06:30");
    const tras = aplicarPatch(guardado, { horaCarga: envio }); // 4) GET
    expect(normalizarHora(tras.hora_carga)).toBe("06:30");
    expect(normalizarHora(tras.hora_carga)).not.toBe("04:00"); // 5) el formulario se inicializa con plan.hora_carga
  });
  it("hora sin cambios no se reenvía (y vaciarla no borra la hora del viaje)", () => {
    expect(cambioHoraCarga("06:30:00", "06:30")).toBeUndefined();
    expect(cambioHoraCarga("06:30:00", "")).toBeUndefined();
  });
});

describe("destino: Mixco de la ruta -> Villa Nueva del viaje", () => {
  it("6) seleccionar ruta precarga el destino EN LAS PARADAS (sin duplicarlo en un campo aparte)", () => {
    const p = plantillaDesdeRuta(RUTA, { horaCarga: "", lugarDescargaHistorico: "" });
    expect(p.paradas!.find((x) => x.tipo === "Descarga")?.lugarNombre).toBe("Mixco");
    expect(p.lugarDescargaHistorico).toBe(""); // igual a la parada: el servidor lo deriva
  });
  it("6b) si la ruta trae una descripción operativa DISTINTA a la parada, se conserva como descripción distinta (VIAT-4b)", () => {
    const p = plantillaDesdeRuta({ ...RUTA, destinoDescripcion: "RUTA-A - Mixco-Villa Nueva" }, { horaCarga: "", lugarDescargaHistorico: "" });
    expect(p.lugarDescargaHistorico).toBe("RUTA-A - Mixco-Villa Nueva");
    expect(p.paradas!.find((x) => x.tipo === "Descarga")?.lugarNombre).toBe("Mixco");
  });
  it("6c) al reabrir: la descripción solo aparece aparte si difiere de la 1.ª descarga (o el viaje histórico no tiene paradas)", () => {
    const paradas: ParadaPersistida[] = [{ id: 1, lugar_nombre: "Bodega", tipo: "Carga", requiere_evidencia: true }, { id: 2, lugar_nombre: "CD Walmart", tipo: "Descarga", requiere_evidencia: true }];
    expect(descripcionReporteInicial("CD Walmart", paradas)).toBe("");
    expect(descripcionReporteInicial("  cd   walmart ", paradas)).toBe("");
    expect(descripcionReporteInicial("RUTA-A - p1-p2", paradas)).toBe("RUTA-A - p1-p2");
    expect(descripcionReporteInicial("Destino histórico", [])).toBe("Destino histórico");
    expect(descripcionReporteInicial(null, paradas)).toBe("");
  });
  it("7-9) cambiar destino, guardar y al reabrir sigue Villa Nueva", () => {
    const guardado = viajeCreado();
    const envio = cambioTextoSnapshot(guardado.lugar_descarga_historico, "Villa Nueva");
    expect(envio).toBe("Villa Nueva");
    expect(aplicarPatch(guardado, { lugarDescargaHistorico: envio }).lugar_descarga_historico).toBe("Villa Nueva");
  });
  it("borrar el destino viaja como null (limpiar); sin cambio, undefined (no tocar)", () => {
    expect(cambioTextoSnapshot("Mixco", "  ")).toBeNull();
    expect(cambioTextoSnapshot("Mixco", "Mixco ")).toBeUndefined();
    expect(cambioTextoSnapshot(null, "")).toBeUndefined();
  });
});

describe("paradas de carga y descarga editadas", () => {
  it("10-12) parada de CARGA editada: se envía con su id y al reabrir se ve la nueva", () => {
    const guardado = viajeCreado();
    const form = paradasFormularioDesdePlan(guardado.paradas).map((p) => (p.tipo === "Carga" ? { ...p, lugarNombre: "Bodega Norte" } : p));
    const envio = cambioParadas(guardado.paradas, payload(form));
    expect(envio?.find((p) => p.tipo === "Carga")).toMatchObject({ id: 1, lugarNombre: "Bodega Norte" });
    const reabierto = paradasFormularioDesdePlan(aplicarPatch(guardado, { paradas: envio as ParadaFormulario[] }).paradas);
    expect(reabierto.find((p) => p.tipo === "Carga")).toMatchObject({ id: 1, lugarNombre: "Bodega Norte" });
  });
  it("13-15) parada de DESCARGA editada: idem", () => {
    const guardado = viajeCreado();
    const form = paradasFormularioDesdePlan(guardado.paradas).map((p) => (p.tipo === "Descarga" ? { ...p, lugarNombre: "Villa Nueva" } : p));
    const envio = cambioParadas(guardado.paradas, payload(form));
    const reabierto = paradasFormularioDesdePlan(aplicarPatch(guardado, { paradas: envio as ParadaFormulario[] }).paradas);
    expect(reabierto.find((p) => p.tipo === "Descarga")).toMatchObject({ id: 2, lugarNombre: "Villa Nueva" });
  });
  it("paradas sin cambios NO se reenvían; una lista vaciada sí (eliminación real)", () => {
    const guardado = viajeCreado();
    expect(cambioParadas(guardado.paradas, payload(paradasFormularioDesdePlan(guardado.paradas)))).toBeUndefined();
    expect(cambioParadas(guardado.paradas, [])).toEqual([]);
    expect(cambioParadas([], payload(paradasFormularioDesdePlan([])))).toBeUndefined(); // filas vacías por defecto
  });
  it("elegir una ubicación guardada en una fila cuenta como cambio", () => {
    const guardado = viajeCreado();
    const form = payload(paradasFormularioDesdePlan(guardado.paradas)).map((p, i) => (i === 0 ? { ...p, clienteUbicacionId: 55 } : p));
    expect(cambioParadas(guardado.paradas, form)).toBeDefined();
  });
  it("al reabrir se muestran las paradas del VIAJE con su id, nunca las de la ruta", () => {
    const reabierto = paradasFormularioDesdePlan([{ id: 7, lugar_nombre: "Villa Nueva", tipo: "Descarga", requiere_evidencia: false }]);
    expect(reabierto).toEqual([{ id: 7, lugarNombre: "Villa Nueva", tipo: "Descarga", requiereEvidencia: false }]);
  });
});

describe("la ruta NO se re-aplica salvo cambio explícito de ruta", () => {
  it("16-19) re-elegir la MISMA ruta (o cualquier otra acción) no re-aplica la plantilla", () => {
    expect(debeAplicarRuta(8, 8)).toBe(false);
  });
  it("20) elegir explícitamente OTRA ruta sí aplica sus defaults (acción consciente)", () => {
    expect(debeAplicarRuta(8, 9)).toBe(true);
    expect(debeAplicarRuta(0, 8)).toBe(true);
    const p = plantillaDesdeRuta(OTRA_RUTA, { horaCarga: "06:30", lugarDescargaHistorico: "Villa Nueva" });
    expect(p).toMatchObject({ rutaId: 9, horaCarga: "05:15", lugarDescargaHistorico: "" });
    expect(p.paradas!.find((x) => x.tipo === "Descarga")?.lugarNombre).toBe("Escuintla"); // el destino vive en las paradas
    expect(p.paradas!.every((x) => x.id === undefined)).toBe(true); // copia, nunca enlace en vivo
  });
  it("una ruta sin hora/destino no borra lo que ya tenía el formulario", () => {
    const p = plantillaDesdeRuta({ ...RUTA, horaHabitual: null, destinoDescripcion: null, lugarCargaTexto: null, paradas: [] }, { horaCarga: "06:30", lugarDescargaHistorico: "Villa Nueva" });
    expect(p).toMatchObject({ horaCarga: "06:30", lugarDescargaHistorico: "Villa Nueva", paradas: null });
  });
  it("REPRODUCCIÓN: Enter con el campo de ruta precargado (sin buscar) re-aplicaba la ruta; ahora no", () => {
    const valor = "1001 — ACME";
    const antes = (o: { abierto: boolean; hayOpciones: boolean }) => o.abierto && o.hayOpciones; // condición previa
    expect(antes({ abierto: true, hayOpciones: true })).toBe(true);
    expect(enterEligeRuta({ texto: valor, valor, abierto: true, hayOpciones: true })).toBe(false);
    expect(enterEligeRuta({ texto: "", valor, abierto: true, hayOpciones: true })).toBe(false);
    expect(enterEligeRuta({ texto: "200", valor, abierto: true, hayOpciones: true })).toBe(true); // buscando: sí
    expect(enterEligeRuta({ texto: "200", valor, abierto: false, hayOpciones: true })).toBe(false);
  });
});

describe("recarga tras guardar vs. sondeo pasivo (valores viejos al reabrir)", () => {
  it("REPRODUCCIÓN: un sondeo que leyó ANTES de guardar y responde DESPUÉS de la recarga ya no pisa los datos nuevos", () => {
    const seq = crearSecuenciaCargas();
    let lista = "04:00";
    const sondeo = seq.iniciar(); // 1) el sondeo de 30 s sale (lee 04:00)
    const recarga = seq.iniciar(); // 2) el usuario guarda 06:30 y se recarga la lista
    if (seq.esVigente(recarga)) lista = "06:30"; // 3) llega la recarga
    if (seq.esVigente(sondeo)) lista = "04:00"; // 4) llega tarde el sondeo viejo -> descartado
    expect(lista).toBe("06:30");
    // Antes no había turno: aplicar en orden de llegada dejaba "04:00".
    const sinTurno = ["06:30", "04:00"].reduce((_, v) => v);
    expect(sinTurno).toBe("04:00");
  });
});

describe("cableado (código fuente)", () => {
  const form = readFileSync("src/app/e/[slug]/programacion/plan-form.tsx", "utf8");
  const select = readFileSync("src/components/tms/ruta-select.tsx", "utf8");
  const cliente = readFileSync("src/app/e/[slug]/programacion/programacion-client.tsx", "utf8");
  it("aplicarRuta solo se invoca desde la selección explícita de ruta, gateada por debeAplicarRuta (ningún efecto la llama)", () => {
    expect(form.match(/aplicarRuta\(/g)).toHaveLength(2); // definición + única llamada
    expect(form).toContain("if (debeAplicarRuta(form.rutaId, ruta.id)) aplicarRuta(ruta);");
  });
  it("RutaSelect solo selecciona por clic o Enter mientras se busca", () => {
    expect(select).toContain("enterEligeRuta({ texto, valor: value, abierto: open, hayOpciones: opciones.length > 0 })");
    expect(select).not.toContain('e.key === "Enter" && open && opciones[0]');
  });
  it("el PATCH envía hora/destino/contacto/código/paradas solo si cambiaron contra el viaje persistido", () => {
    expect(form).toContain("horaCarga: soloNotas ? undefined : cambioHoraCarga(plan?.hora_carga, form.horaCarga)");
    expect(form).toContain("cambioTextoSnapshot(descripcionInicialReporte, form.lugarDescargaHistorico)");
    expect(form).toContain("cambioTextoSnapshot(plan?.ruta_codigo_historico, form.rutaCodigo)");
    expect(form).toContain("cambioTextoSnapshot(plan?.contacto_nombre_historico, form.contactoNombreHistorico)");
    expect(form).toContain("paradas: bloqueadoParaPreCierre ? undefined : cambioParadas(plan?.paradas ?? [], paradas)");
  });
  it("las cargas de la lista (sondeo, carga inicial y recarga tras guardar) respetan el turno", () => {
    expect((cliente.match(/secuenciaCargas\.current\.iniciar\(\)/g) ?? []).length).toBe(3);
    expect((cliente.match(/secuenciaCargas\.current\.esVigente\(turno\)/g) ?? []).length).toBe(3);
  });
});
