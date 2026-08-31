import { describe, expect, it } from "vitest";
import {
  auxiliaresCambio,
  calcularCambioSensible,
  camposSensiblesPatch,
  identidadPersonalCambio,
  type IdentidadPersonal,
  type SnapshotPersonalUnidad,
} from "./plan-form";

/**
 * PROGRAMACION-CAMBIO-SENSIBLE-FALSO-POSITIVO-1 — cambioSensible ya NO se
 * calcula comparando texto reconstruido desde el catálogo RRHH (causa del
 * falso positivo real en producción: el nombre guardado en el plan podía
 * diferir en mayúsculas/acentos/espacios del nombre actual en RRHH, o el
 * catálogo async todavía no había cargado). Se prueba directo la función
 * pura, sin renderizar el formulario completo (mismo criterio ya usado en
 * tms/reportes/page.test.ts: probar la lógica extraíble, no el
 * renderizado).
 */

function snap(overrides: Partial<SnapshotPersonalUnidad> = {}): SnapshotPersonalUnidad {
  return {
    piloto: { empleadoId: 10, nombre: "Juan Pérez" },
    placa: "C-147CCT",
    auxiliares: [{ empleadoId: 20, nombre: "Ana López" }],
    ...overrides,
  };
}

describe("calcularCambioSensible", () => {
  it("1) plan existente + solo cambia tarifa (piloto/placa/auxiliares intactos) -> NO exige motivo", () => {
    // La tarifa ni siquiera es un parámetro de esta función: un snapshot
    // idéntico (mismo piloto/placa/auxiliares) siempre da false, sea cual
    // sea el cambio en otros campos no sensibles.
    expect(calcularCambioSensible(snap(), snap())).toBe(false);
  });

  it("2) plan recién cargado sin cambios (mismo snapshot original/actual) -> cambioSensible false", () => {
    const original = snap();
    const actual = snap();
    expect(calcularCambioSensible(original, actual)).toBe(false);
  });

  it("3) mismos auxiliares en distinto orden -> false", () => {
    const original = snap({
      auxiliares: [
        { empleadoId: 20, nombre: "Ana López" },
        { empleadoId: 21, nombre: "Beto Ruiz" },
      ],
    });
    const actual = snap({
      auxiliares: [
        { empleadoId: 21, nombre: "Beto Ruiz" },
        { empleadoId: 20, nombre: "Ana López" },
      ],
    });
    expect(calcularCambioSensible(original, actual)).toBe(false);
  });

  it("4) auxiliar cargado por ID equivalente al original, aunque el nombre reconstruido desde el catálogo difiera en formato -> false", () => {
    // Causa raíz del bug real: plan.auxiliares guardó "Ana López" pero el
    // catálogo RRHH actual tiene "ANA LOPEZ " (mayúsculas + espacio extra)
    // — mismo empleadoId, texto distinto. Antes esto producía un falso
    // positivo; ahora se compara por empleadoId, nunca por el texto
    // reconstruido.
    const original = snap({ auxiliares: [{ empleadoId: 20, nombre: "Ana López" }] });
    const actual = snap({ auxiliares: [{ empleadoId: 20, nombre: "ANA LOPEZ " }] });
    expect(calcularCambioSensible(original, actual)).toBe(false);
  });

  it("5) cambio real de auxiliar (empleadoId distinto) -> true", () => {
    const original = snap({ auxiliares: [{ empleadoId: 20, nombre: "Ana López" }] });
    const actual = snap({ auxiliares: [{ empleadoId: 99, nombre: "Carla Ruiz" }] });
    expect(calcularCambioSensible(original, actual)).toBe(true);
  });

  it("6) cambio real de piloto (empleadoId distinto) -> true", () => {
    const original = snap({ piloto: { empleadoId: 10, nombre: "Juan Pérez" } });
    const actual = snap({ piloto: { empleadoId: 99, nombre: "Otro Piloto" } });
    expect(calcularCambioSensible(original, actual)).toBe(true);
  });

  it("7) cambio real de unidad (placa distinta) -> true", () => {
    const original = snap({ placa: "C-147CCT" });
    const actual = snap({ placa: "C-999ZZZ" });
    expect(calcularCambioSensible(original, actual)).toBe(true);
  });

  it("placa idéntica con diferencias de mayúsculas/guiones/espacios NO genera falso positivo (reutiliza normalizarPlaca)", () => {
    const original = snap({ placa: "C-147CCT" });
    const actual = snap({ placa: "c 147 cct" });
    expect(calcularCambioSensible(original, actual)).toBe(false);
  });

  it("piloto idéntico al original (mismo empleadoId) -> false", () => {
    const original = snap({ piloto: { empleadoId: 10, nombre: "Juan Pérez" } });
    const actual = snap({ piloto: { empleadoId: 10, nombre: "Juan Pérez" } });
    expect(calcularCambioSensible(original, actual)).toBe(false);
  });

  it("auxiliar libre/legado (sin empleadoId) sin cambios reales -> false", () => {
    const original = snap({ auxiliares: [{ empleadoId: null, nombre: "Pedro Legado" }] });
    const actual = snap({ auxiliares: [{ empleadoId: null, nombre: "Pedro Legado" }] });
    expect(calcularCambioSensible(original, actual)).toBe(false);
  });

  it("agregar un auxiliar más (tamaño de conjunto distinto) -> true", () => {
    const original = snap({ auxiliares: [{ empleadoId: 20, nombre: "Ana López" }] });
    const actual = snap({
      auxiliares: [
        { empleadoId: 20, nombre: "Ana López" },
        { empleadoId: 21, nombre: "Beto Ruiz" },
      ],
    });
    expect(calcularCambioSensible(original, actual)).toBe(true);
  });
});

describe("identidadPersonalCambio (piloto) — unitario", () => {
  it("ambos vacíos (sin piloto asignado) -> false", () => {
    expect(identidadPersonalCambio({ empleadoId: null, nombre: "" }, { empleadoId: null, nombre: "" })).toBe(false);
  });

  it("de vacío a con piloto -> true (asignación real)", () => {
    expect(identidadPersonalCambio({ empleadoId: null, nombre: "" }, { empleadoId: 10, nombre: "Juan Pérez" })).toBe(true);
  });

  it("nombre libre sin empleadoId, mismo texto normalizado -> false", () => {
    const a: IdentidadPersonal = { empleadoId: null, nombre: "  Juan   Pérez " };
    const b: IdentidadPersonal = { empleadoId: null, nombre: "juan pérez" };
    expect(identidadPersonalCambio(a, b)).toBe(false);
  });

  it("nombre libre realmente distinto -> true", () => {
    expect(identidadPersonalCambio({ empleadoId: null, nombre: "Juan Pérez" }, { empleadoId: null, nombre: "Pedro Gómez" })).toBe(true);
  });
});

describe("gate de envío — cambioSensible && !motivoCambioFinal (línea de bloqueo en plan-form.tsx)", () => {
  // El gate en sí es una expresión de una línea (`cambioSensible &&
  // !motivoCambioFinal`, ver handleSubmit) — no se toca en este ticket,
  // solo se confirma que sigue exigiendo motivo cuando SÍ hay un cambio
  // real, y que un motivo no vacío lo desbloquea. La corrección de este
  // ticket es exclusivamente que `cambioSensible` ya no da falsos
  // positivos (bloques de arriba).
  function bloquea(original: SnapshotPersonalUnidad, actual: SnapshotPersonalUnidad, motivo: string): boolean {
    return calcularCambioSensible(original, actual) && !motivo.trim();
  }

  it("8) cambio real (piloto distinto) sin motivo -> bloquea", () => {
    const original = snap({ piloto: { empleadoId: 10, nombre: "Juan Pérez" } });
    const actual = snap({ piloto: { empleadoId: 99, nombre: "Otro Piloto" } });
    expect(bloquea(original, actual, "")).toBe(true);
    expect(bloquea(original, actual, "   ")).toBe(true);
  });

  it("9) cambio real (piloto distinto) CON motivo -> permite guardar (no bloquea)", () => {
    const original = snap({ piloto: { empleadoId: 10, nombre: "Juan Pérez" } });
    const actual = snap({ piloto: { empleadoId: 99, nombre: "Otro Piloto" } });
    expect(bloquea(original, actual, "Reasignación operativa")).toBe(false);
  });

  it("solo tarifa (sin cambio real de personal/unidad) NUNCA bloquea, tenga o no motivo escrito", () => {
    expect(bloquea(snap(), snap(), "")).toBe(false);
    expect(bloquea(snap(), snap(), "cualquier texto")).toBe(false);
  });
});

describe("auxiliaresCambio — unitario", () => {
  it("dos conjuntos vacíos -> false", () => {
    expect(auxiliaresCambio([], [])).toBe(false);
  });

  it("mezcla de auxiliares por ID y libres, mismo conjunto en distinto orden -> false", () => {
    const original: IdentidadPersonal[] = [
      { empleadoId: 20, nombre: "Ana López" },
      { empleadoId: null, nombre: "Pedro Legado" },
    ];
    const actual: IdentidadPersonal[] = [
      { empleadoId: null, nombre: "pedro legado" },
      { empleadoId: 20, nombre: "ANA LOPEZ" },
    ];
    expect(auxiliaresCambio(original, actual)).toBe(false);
  });
});

describe("camposSensiblesPatch — AJUSTE PRE-MERGE PR #156: el PATCH ya no reenvía piloto/placa/auxiliares sin un cambio sensible real", () => {
  // Hallazgo confirmado: el backend (planes/route.ts, sin tocar en este
  // ticket) exige motivoCambio por PRESENCIA de estos 4 campos en el
  // request, no por comparación de valor — es una protección deliberada.
  // El defecto de punta a punta era que el cliente los reenviaba SIEMPRE
  // (con su valor actual, sin cambiar) en cualquier PATCH. Esta función
  // es la única responsable de decidir qué se envía.
  const base = {
    bloqueadoParaPreCierre: false,
    pilotoNombre: "Juan Pérez",
    placa: "C-147CCT",
    auxiliarEmpleadoIds: [20, 21],
    auxiliarNombres: ["Pedro Legado"],
    motivoCambioFinal: "Reasignación operativa",
  };

  it("1) solo tarifa (cambioSensible=false) -> los 4 campos sensibles y motivoCambio se OMITEN (undefined)", () => {
    const r = camposSensiblesPatch({ ...base, cambioSensible: false });
    expect(r).toEqual({
      pilotoNombre: undefined,
      placa: undefined,
      auxiliarEmpleadoIds: undefined,
      auxiliarNombres: undefined,
      motivoCambio: undefined,
    });
  });

  it("2) solo notas (mismo caso: cambioSensible=false) -> mismo comportamiento, los 4 campos se omiten", () => {
    // "Notas" no es un input de esta función (no toca piloto/unidad/
    // auxiliares) — el caso relevante es, otra vez, cambioSensible=false.
    const r = camposSensiblesPatch({ ...base, cambioSensible: false });
    expect(r.pilotoNombre).toBeUndefined();
    expect(r.placa).toBeUndefined();
    expect(r.auxiliarEmpleadoIds).toBeUndefined();
    expect(r.auxiliarNombres).toBeUndefined();
    expect(r.motivoCambio).toBeUndefined();
  });

  it("3) cambio real de piloto (cambioSensible=true) -> los 4 campos sensibles y motivoCambio se ENVÍAN", () => {
    const r = camposSensiblesPatch({ ...base, cambioSensible: true });
    expect(r).toEqual({
      pilotoNombre: "Juan Pérez",
      placa: "C-147CCT",
      auxiliarEmpleadoIds: [20, 21],
      auxiliarNombres: ["Pedro Legado"],
      motivoCambio: "Reasignación operativa",
    });
  });

  it("4) cambio real de unidad (mismo contrato: cambioSensible=true) -> campos sensibles + motivoCambio presentes", () => {
    const r = camposSensiblesPatch({ ...base, placa: "C-999ZZZ", cambioSensible: true });
    expect(r.placa).toBe("C-999ZZZ");
    expect(r.motivoCambio).toBe("Reasignación operativa");
  });

  it("5) cambio real de auxiliar (mismo contrato: cambioSensible=true) -> campos sensibles + motivoCambio presentes", () => {
    const r = camposSensiblesPatch({ ...base, auxiliarEmpleadoIds: [99], cambioSensible: true });
    expect(r.auxiliarEmpleadoIds).toEqual([99]);
    expect(r.motivoCambio).toBe("Reasignación operativa");
  });

  it("6) cambio real sin motivo -> el gate de envío (cambioSensible && !motivoCambioFinal) sigue bloqueando ANTES del fetch, camposSensiblesPatch nunca llega a llamarse", () => {
    // Mismo gate ya probado en el describe "gate de envío" de arriba —
    // aquí se confirma que, aunque motivoCambioFinal venga vacío,
    // camposSensiblesPatch en sí NO inventa un motivo: lo devuelve tal
    // cual (string vacío), la validación de bloqueo vive ANTES, en
    // handleSubmit (línea `if (cambioSensible && !motivoCambioFinal)`).
    const r = camposSensiblesPatch({ ...base, cambioSensible: true, motivoCambioFinal: "" });
    expect(r.motivoCambio).toBe("");
  });

  it("7) bloqueadoParaPreCierre=true -> los 4 campos sensibles se OMITEN aunque cambioSensible sea true (regla preexistente sin cambios)", () => {
    const r = camposSensiblesPatch({ ...base, bloqueadoParaPreCierre: true, cambioSensible: true });
    expect(r.pilotoNombre).toBeUndefined();
    expect(r.placa).toBeUndefined();
    expect(r.auxiliarEmpleadoIds).toBeUndefined();
    expect(r.auxiliarNombres).toBeUndefined();
    // motivoCambio nunca dependió de bloqueadoParaPreCierre (tampoco antes de este ajuste).
    expect(r.motivoCambio).toBe("Reasignación operativa");
  });

  it("nombres con espacios extra se recortan (trim) igual que antes de este ajuste", () => {
    const r = camposSensiblesPatch({ ...base, pilotoNombre: "  Juan Pérez  ", cambioSensible: true });
    expect(r.pilotoNombre).toBe("Juan Pérez");
  });

  it("pilotoNombre/placa vacíos tras trim -> undefined (igual que el comportamiento previo, nunca un string vacío)", () => {
    const r = camposSensiblesPatch({ ...base, pilotoNombre: "   ", placa: "  ", cambioSensible: true });
    expect(r.pilotoNombre).toBeUndefined();
    expect(r.placa).toBeUndefined();
  });
});

// 8) creación (POST /tms/planes): NO se modificó — el bloque de creación
// nunca dependió de cambioSensible/camposSensiblesPatch (piloto/placa/
// auxiliares siempre se enviaron ahí igual, es la primera asignación del
// viaje, no una "reasignación"). Verificado por diff (sin cambios en esa
// rama del handleSubmit), no hay lógica pura nueva que probar ahí.
