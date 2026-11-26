// Shell: unidad (interna / externa / no identificada / ambigua) + piloto + combustible → PENDIENTE / LISTO con la misma regla que el servidor.
import { describe, expect, it } from "vitest";
import { asignacionesExactas, revisionCandidatos } from "./preview-model";
import { causasAsignacion } from "./problemas-asignacion";
import { claseUnidadShell } from "./unidad-shell";
import type { CatalogosCB2, FilaCB2 } from "./client";
import type { DecisionAsignacion } from "./asignacion";

const fila = (extra: Record<string, unknown> = {}, placa = "C-570BZT", piloto = "Andres Taracena", producto = "Diesel") => ({ perfil: "SHELL", hoja: "Octubre", fila: 2, candidato: "k1", bloqueada: false, documento: null, errores: [], estado: "VALIDA", motivos: [], vale: "0001", placa, placaNormalizada: placa, fecha: "2026-10-01", galones: "10", precio: "20", monto: "200", moneda: "GTQ", lote: "1", origen: { piloto, producto }, ...extra }) as unknown as FilaCB2;
const empleados = [{ id: 110, nombre: "Andrés Norberto Taracena Mayén", estado: "Baja" }, { id: 33, nombre: "Edgar Palala", estado: "Activo" }];
const interna = { proveedores: [], pilotosReportados: true, empleados, vehiculos: [{ id: 1, placa: "C-570BZT", estado: "Activo" }] } as unknown as CatalogosCB2;
// Política de identidades independientes (unidades externas con piloto interno/reportado)
const externa = { id: 7, placa: "C-999EXT", referencia: "shell:C999EXT", tipo: "VEHICULO", descripcion: "Externa" };
const indep = { ...interna, tercerosDirectos: true, identidadesIndependientes: true, tercerosHabilitados: true, pilotoReportadoExterno: true, unidadesExternas: [externa], pilotosExternos: [{ id: 5, nombre: "Piloto Externo", referencia: "R5" }],
  vehiculos: [{ id: 1, placa: "C-570BZT", estado: "Activo" }, { id: -7, placa: "C-999EXT" }] } as unknown as CatalogosCB2;
const reportado: DecisionAsignacion = { exigirProducto: true, exigirPiloto: true, pilotoTipo: "REPORTADO", decisionNombre: { tipo: "REPORTADO", confirmado: true } };
const interna_ = interna;
const estado = (f: FilaCB2, cat: CatalogosCB2, seleccion: Record<string, string>, d: DecisionAsignacion) => revisionCandidatos([f], cat, seleccion, {}, {}, { k1: d })[0];

describe("clasificación de la unidad del vale Shell", () => {
  it("interna, externa registrada, ambigua y no identificada (sin crear vehículos)", () => {
    expect(claseUnidadShell(fila(), interna, "1").clase).toBe("INTERNA");
    expect(claseUnidadShell(fila({}, "C-999EXT"), indep, "-7")).toMatchObject({ clase: "EXTERNA" });
    expect(claseUnidadShell(fila({}, "C-999EXT"), indep, "-7").mensaje).toContain("no es un vehículo de Flota");
    const dos = { ...interna, vehiculos: [{ id: 1, placa: "C-570BZT", estado: "Activo" }, { id: 2, placa: "P-570BZT", estado: "Activo" }] } as unknown as CatalogosCB2;
    expect(claseUnidadShell(fila({}, "570BZT"), dos, "")).toMatchObject({ clase: "AMBIGUA", candidatos: ["1", "2"] });
    const nueva = claseUnidadShell(fila({}, "C-123XYZ"), interna, "");
    expect(nueva).toMatchObject({ clase: "NO_IDENTIFICADA", registrable: true }); expect(nueva.mensaje).toContain("«C-123XYZ»");
    expect(claseUnidadShell(fila({}, "C-123XYZ"), interna, "-99").clase).toBe("NO_IDENTIFICADA");   // externa inexistente en la empresa
    expect(claseUnidadShell(fila({}, "texto raro"), interna, "")).toMatchObject({ clase: "NO_IDENTIFICADA", registrable: false });
  });
});

describe("estado LISTO exige piloto + unidad (interna o externa confirmada) + combustible", () => {
  it("vale 18554: el piloto confirmado no elimina la justificación de la placa distinta", () => {
    const f = fila({ vale: "18554", hoja: "OCTUBRE", fila: 140, fecha: "2026-10-14" }, "125 CCN", "Rafael Caal", "Diesel");
    const cat = { ...interna, empleados: [{ id: 96, nombre: "Rafael Manuel Cucul Yaxcal", estado: "Activo" }], vehiculos: [{ id: 1190, placa: "C-125CCM", estado: "Activo" }] } as unknown as CatalogosCB2;
    const d: DecisionAsignacion = { exigirProducto: true, exigirPiloto: true, pilotoTipo: "INTERNO", empleadoId: 96, decisionNombre: { tipo: "EMPLEADO", empleadoId: 96, confirmado: true } };
    const pendiente = estado(f, cat, { k1: "1190" }, d);
    expect(pendiente.estado).toBe("PENDIENTE");
    expect(causasAsignacion(pendiente, cat, d).join(" ")).toMatch(/justific/i);
    const justificada = estado(f, cat, { k1: "1190" }, { ...d, motivoUnidad: "Placa confirmada con evidencia del vale" });
    expect(justificada.estado).toBe("LISTO");
    expect(justificada.fila.placa).toBe("125 CCN");
  });
  const emp110: DecisionAsignacion = { exigirProducto: true, exigirPiloto: true, pilotoTipo: "INTERNO", empleadoId: 110, decisionNombre: { tipo: "EMPLEADO", empleadoId: 110, confirmado: false } };
  it("los tres resueltos → LISTO (unidad interna); piloto resuelto + unidad pendiente → PENDIENTE; unidad resuelta + combustible pendiente → PENDIENTE", () => {
    expect(estado(fila(), interna, { k1: "1" }, emp110).estado).toBe("LISTO");
    expect(estado(fila({}, "C-123XYZ"), interna, {}, emp110).estado).toBe("PENDIENTE");                           // piloto OK, unidad no identificada
    const sinCombustible = estado(fila({}, "C-570BZT", "Andres Taracena", "20W50"), interna, { k1: "1" }, emp110);
    expect(sinCombustible.estado).toBe("PENDIENTE");
    expect(estado(fila({}, "C-570BZT", "Andres Taracena", "20W50"), interna, { k1: "1" }, { ...emp110, productoClasificado: "NO_DETERMINADO" }).estado).toBe("LISTO");
    expect(estado(fila(), interna, { k1: "1" }, { ...emp110, pilotoTipo: undefined, decisionNombre: undefined }).estado).toBe("PENDIENTE");   // unidad OK, piloto sin resolver
  });
  it("unidad externa confirmada → LISTO con piloto reportado, empleado de baja o piloto externo; sin identidad externa vigente → PENDIENTE", () => {
    const f = fila({}, "C-999EXT");
    expect(estado(f, indep, { k1: "-7" }, reportado).estado).toBe("LISTO");
    expect(estado(f, indep, { k1: "-7" }, emp110).estado).toBe("LISTO");
    expect(estado(f, indep, { k1: "-7" }, { exigirProducto: true, exigirPiloto: true, pilotoTipo: "EXTERNO", pilotoExternoId: 5 }).estado).toBe("LISTO");
    expect(estado(f, indep, { k1: "-8" }, reportado).estado).toBe("PENDIENTE");                                  // identidad externa inexistente
    expect(estado(f, { ...interna, unidadesExternas: [] } as unknown as CatalogosCB2, { k1: "-7" }, reportado).estado).toBe("PENDIENTE");
    expect(causasAsignacion(estado(f, interna, { k1: "-7" }, reportado), interna, reportado).join(" ")).toContain("identidades independientes");   // sin la política habilitada se explica
  });
  it("una unidad externa se REUTILIZA en otra importación sin volver a registrarla", () => {
    const f = fila({ candidato: "k2" }, "C-999EXT");
    expect(asignacionesExactas([f], indep)).toEqual({ k2: "-7" });
  });
  it("placa corregida manualmente: la unidad se elige con justificación y la placa original del Excel se conserva", () => {
    const f = fila({}, "C-57OBZT");                                                                              // error de captura en el Excel
    expect(estado(f, interna, { k1: "1" }, emp110).estado).toBe("PENDIENTE");                                    // sin justificación
    const r = estado(f, interna, { k1: "1" }, { ...emp110, motivoUnidad: "La placa se escribió con letra O en lugar de cero" });
    expect(r.estado).toBe("LISTO"); expect(r.fila.placa).toBe("C-57OBZT");                                       // original intacto para auditoría
  });
  it("unidad ambigua con dos vehículos internos exige selección explícita y nunca se autoasigna", () => {
    const dos = { ...interna, vehiculos: [{ id: 1, placa: "C-570BZT", estado: "Activo" }, { id: 2, placa: "P-570BZT", estado: "Activo" }] } as unknown as CatalogosCB2, f = fila({}, "570BZT");
    expect(asignacionesExactas([f], dos)).toEqual({});
    expect(estado(f, dos, {}, emp110).estado).toBe("PENDIENTE");
    expect(estado(f, dos, { k1: "2" }, { ...emp110, motivoUnidad: "Confirmado con el piloto que usó la unidad P-570BZT" }).estado).toBe("LISTO");
  });
  it("decisión de piloto inconsistente sigue PENDIENTE aunque unidad y combustible estén bien", () => {
    for (const d of [
      { ...emp110, empleadoId: 33 },                                                                              // ID del vale ≠ ID de la decisión
      { ...emp110, pilotoTipo: "REPORTADO" as const },                                                            // tipo ≠ decisión
      { ...emp110, pilotoExternoId: 5 },                                                                          // empleado + externo mezclados
      { ...reportado, empleadoId: 110 },                                                                          // reportado con empleado
      { exigirProducto: true, exigirPiloto: true, pilotoTipo: "EXTERNO" as const },                              // externo sin identidad
    ]) expect(estado(fila(), interna, { k1: "1" }, d).estado, JSON.stringify(d)).toBe("PENDIENTE");
  });
  it("empleado activo y de baja seleccionados manualmente (confirmados) → LISTO; reconocimiento automático que el motor ya no respalda → PENDIENTE", () => {
    const manual = (id: number): DecisionAsignacion => ({ exigirProducto: true, exigirPiloto: true, pilotoTipo: "INTERNO", empleadoId: id, decisionNombre: { tipo: "EMPLEADO", empleadoId: id, confirmado: true } });
    const f = fila({}, "C-570BZT", "Nombre Distinto");
    expect(estado(f, interna, { k1: "1" }, manual(33)).estado).toBe("LISTO");
    expect(estado(f, interna, { k1: "1" }, manual(110)).estado).toBe("LISTO");
    expect(estado(f, interna, { k1: "1" }, { ...manual(110), decisionNombre: { tipo: "EMPLEADO", empleadoId: 110, confirmado: false } }).estado).toBe("PENDIENTE");
  });
  it("identidad externa VÁLIDA (ID negativo) con el vale PENDIENTE por combustible o piloto: el diagnóstico NO afirma que la unidad esté ausente ni inexistente", () => {
    // El catálogo solo trae la identidad en unidadesExternas (no entre los vehículos internos): no debe confundirse con una unidad interna ausente.
    const soloExterna = { ...indep, vehiculos: [{ id: 1, placa: "C-570BZT", estado: "Activo" }] } as unknown as CatalogosCB2;
    const f = fila({}, "C-999EXT", "Andres Taracena", "20W50");   // combustible sin clasificar
    const sinCombustible = estado(f, soloExterna, { k1: "-7" }, { ...reportado });
    expect(sinCombustible.estado).toBe("PENDIENTE");
    const texto1 = causasAsignacion(sinCombustible, soloExterna, reportado).join(" | ");
    expect(texto1).toContain("combustible"); expect(texto1).not.toMatch(/ausente|no existe|no identificada|Falta seleccionar una unidad/i);
    const sinPiloto = estado(fila({}, "C-999EXT"), soloExterna, { k1: "-7" }, { exigirProducto: true, exigirPiloto: true, pilotoTipo: "REPORTADO" });
    expect(sinPiloto.estado).toBe("PENDIENTE");
    const texto2 = causasAsignacion(sinPiloto, soloExterna, { exigirProducto: true, exigirPiloto: true, pilotoTipo: "REPORTADO" }).join(" | ");
    expect(texto2).toContain("piloto"); expect(texto2).not.toMatch(/ausente|no existe|no identificada|Falta seleccionar una unidad/i);
    expect(estado(fila({}, "C-999EXT"), soloExterna, { k1: "-7" }, reportado).estado).toBe("LISTO");   // y con todo resuelto queda LISTO
  });
  it("las identidades interna y externa se validan por separado: una externa inexistente y una interna ausente se explican con su propio mensaje, sin repetir instrucciones", () => {
    const f = fila({}, "C-123XYZ");
    const ext = causasAsignacion(estado(f, indep, { k1: "-99" }, reportado), indep, reportado);
    expect(ext.filter(c => /unidad externa elegida|existe en esta empresa/i.test(c))).toHaveLength(1);
    const interna = causasAsignacion(estado(f, interna_, { k1: "55" }, reportado), interna_, reportado);
    expect(interna.filter(c => /ya no está en el catálogo interno/i.test(c))).toHaveLength(1);
    const sinUnidad = causasAsignacion(estado(f, interna_, {}, reportado), interna_, reportado);
    expect(sinUnidad.filter(c => /unidad/i.test(c))).toHaveLength(1);   // una sola instrucción de unidad, no dos contradictorias
  });
});

