import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  aplicarErroresConfirmacion,
  aplicarValidacion,
  claveAvisoTarifas,
  comparacionesDeTarifa,
  cuerpoLote,
  diagnosticoDeFilas,
  puedeConfirmarConTarifas,
  editarFila,
  puedeConfirmar,
  resumenFilas,
  sumarDias,
  tarifasEsperadas,
  type FilaEditable,
} from "./copiar-helpers";

const fila = (n: number, over: Partial<FilaEditable> = {}): FilaEditable => ({
  incluida: true, sucia: false, advertencias: [],
  origen: { planId: 900 + n, codigo: `P${n}`, estado: "Cerrado", clienteNombre: "Acme", rutaCodigo: "1001", pilotoNombre: null, auxiliaresNombres: [], unidadPlaca: "P-1", tcPlaca: null },
  borrador: { fila: n, origenPlanId: 900 + n, rutaId: 10, clienteId: 3, horaCarga: "03:00", tipoTraslado: null, tipoViaje: "Propio", unidadPlaca: "P-1", tcVehiculoId: null, pilotoEmpleadoId: 1, auxiliarEmpleadoIds: [], tarifaId: null, externo: null, paradas: [{ lugarNombre: "Bodega", tipo: "Carga" }] },
  validacion: { fila: n, estado: "ok", errores: [], tarifa: null },
  ...over,
});

describe("vista previa editable: qué se puede confirmar", () => {
  it("se confirma solo con ≥1 fila incluida y TODAS las incluidas validadas OK y sin cambios pendientes", () => {
    expect(puedeConfirmar([fila(1), fila(2)], false)).toBe(true);
    expect(puedeConfirmar([], false)).toBe(false);
    expect(puedeConfirmar([fila(1, { incluida: false })], false)).toBe(false);
    expect(puedeConfirmar([fila(1), fila(2, { validacion: { fila: 2, estado: "error", errores: ["Piloto ocupado"], tarifa: null } })], false)).toBe(false);
    expect(puedeConfirmar([fila(1, { sucia: true })], false)).toBe(false);
    expect(puedeConfirmar([fila(1, { validacion: null })], false)).toBe(false);
    expect(puedeConfirmar([fila(1)], true)).toBe(false); // validando/confirmando
  });
  it("una fila EXCLUIDA con error no bloquea la confirmación", () => {
    expect(puedeConfirmar([fila(1), fila(2, { incluida: false, validacion: { fila: 2, estado: "error", errores: ["x"], tarifa: null } })], false)).toBe(true);
  });
  it("editar unidad/TC/piloto/auxiliares/hora/tarifa marca la fila pendiente y borra su validación; máx. 8 auxiliares sin repetidos", () => {
    const f = editarFila(fila(1), { unidadPlaca: "P-2", tcVehiculoId: 31, pilotoEmpleadoId: 3, horaCarga: "04:30", tarifaId: 101, auxiliarEmpleadoIds: [20, 20, 21, 22, 23, 24, 25, 26, 27, 28] });
    expect(f.sucia).toBe(true);
    expect(f.validacion).toBeNull();
    expect(f.borrador).toMatchObject({ unidadPlaca: "P-2", tcVehiculoId: 31, pilotoEmpleadoId: 3, horaCarga: "04:30", tarifaId: 101 });
    expect(f.borrador.auxiliarEmpleadoIds).toEqual([20, 21, 22, 23, 24, 25, 26, 27]);
    expect(puedeConfirmar([f], false)).toBe(false); // hasta revalidar
  });
  it("aplicar la validación del servidor (por número de fila) habilita confirmar; los errores por fila del confirmar la bloquean", () => {
    const sucia = editarFila(fila(1), { horaCarga: "05:00" });
    const validada = aplicarValidacion([sucia], [{ fila: 1, estado: "ok", errores: [], tarifa: null }]);
    expect(validada[0].sucia).toBe(false);
    expect(puedeConfirmar(validada, false)).toBe(true);
    const conError = aplicarErroresConfirmacion(validada, [{ fila: 1, errores: ["El piloto X ya está asignado"] }]);
    expect(conError[0].validacion?.errores).toEqual(["El piloto X ya está asignado"]);
    expect(puedeConfirmar(conError, false)).toBe(false);
  });
  it("tras un rechazo por cambio de tarifa, «Revalidar» trae la tarifa vigente y se confirma con ella (la expectativa enviada se recalcula)", () => {
    const antes = aplicarValidacion([fila(1)], [{ fila: 1, estado: "ok", errores: [], tarifa: { id: 100, nombre: "Base", monto: 1499, moneda: "GTQ" } as never }]);
    expect(tarifasEsperadas(antes)).toEqual([{ fila: 1, tarifa: { id: 100, monto: 1499, moneda: "GTQ" } }]);
    const rechazada = aplicarErroresConfirmacion(antes, [{ fila: 1, errores: ["La tarifa vigente cambió desde la vista previa. Vuelve a validar antes de confirmar."] }]);
    expect(puedeConfirmar(rechazada, false)).toBe(false); // bloqueada hasta revalidar
    const revalidada = aplicarValidacion(rechazada, [{ fila: 1, estado: "ok", errores: [], tarifa: { id: 100, nombre: "Base", monto: 1500, moneda: "GTQ" } as never }]);
    expect(puedeConfirmar(revalidada, false)).toBe(true);
    expect(tarifasEsperadas(revalidada)).toEqual([{ fila: 1, tarifa: { id: 100, monto: 1500, moneda: "GTQ" } }]);
    expect(tarifasEsperadas([fila(1, { validacion: null }), fila(2, { incluida: false })])).toEqual([{ fila: 1, tarifa: null }]); // solo las filas incluidas; sin validación = sin tarifa
  });
  it("resumen: incluidas, excluidas, OK, con error y pendientes", () => {
    const r = resumenFilas([fila(1), fila(2, { validacion: { fila: 2, estado: "error", errores: ["x"], tarifa: null } }), fila(3, { sucia: true }), fila(4, { incluida: false })]);
    expect(r).toEqual({ total: 4, incluidas: 3, excluidas: 1, conError: 1, pendientes: 1, ok: 1 });
  });
});

describe("lo que se envía al servidor", () => {
  it("solo las filas INCLUIDAS y solo campos editables: sin paradas, sin empresa, sin montos", () => {
    const c = cuerpoLote("2026-09-24", "2026-09-25", [fila(1), fila(2, { incluida: false })]);
    expect(c.filas).toHaveLength(1);
    expect(c.filas[0]).not.toHaveProperty("paradas");
    expect(Object.keys(c.filas[0]).sort()).toEqual(["auxiliarEmpleadoIds", "clienteId", "externo", "fila", "horaCarga", "origenPlanId", "pilotoEmpleadoId", "rutaId", "tarifaId", "tcVehiculoId", "tipoTraslado", "tipoViaje", "unidadPlaca"]);
    expect(JSON.stringify(c)).not.toMatch(/empresa/i);
  });
  it("sumarDias para la fecha destino por defecto", () => {
    expect(sumarDias("2026-09-30", 1)).toBe("2026-10-01");
    expect(sumarDias("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("pantalla y acceso (código fuente)", () => {
  const page = readFileSync("src/app/e/[slug]/programacion/copiar/page.tsx", "utf8");
  const cliente = readFileSync("src/app/e/[slug]/programacion/programacion-client.tsx", "utf8");
  it("Programación muestra 'Copiar programación' solo con programacion:crear y enlaza a /programacion/copiar", () => {
    expect(cliente).toContain('tienePermiso(permisos, "programacion", "crear")');
    expect(cliente).toContain("/programacion/copiar");
    expect(cliente).toContain("Copiar programación");
  });
  it("la página exige programacion:crear y no guarda nada al abrir ni al cargar (solo GET); crear solo en confirmar()", () => {
    expect(page).toContain('tienePermiso(permisos, "programacion", "crear")');
    expect(page.match(/method: "POST"/g)).toHaveLength(2); // validar (solo lectura) y confirmar
    const cargar = page.slice(page.indexOf("const cargar = useCallback"), page.indexOf("const validar = useCallback"));
    expect(cargar).not.toContain('method: "POST"');
    const confirmar = page.slice(page.indexOf("async function confirmar"));
    expect(confirmar).toContain("/copiar/confirmar");
    expect(confirmar.indexOf("puedeConfirmar")).toBeLessThan(confirmar.indexOf("fetch("));
  });
  it("la tabla trae las columnas pedidas, controles por fila (sin PlanForm) y estados de disponibilidad", () => {
    for (const c of ["✓", "Origen", "Cliente", "Ruta", "Unidad", "TC", "Piloto", "Auxiliares", "Hora", "Tarifa", "Estado / disponibilidad"]) expect(page).toContain(`"${c}"`);
    expect(page).not.toContain("PlanForm");
    expect(page).toContain("Disponible");
    expect(page).toContain("Fila {b.fila}: {e}");
    expect(page).toContain("Confirmar copia (");
    expect(page).toContain("MAX_AUXILIARES_UI");
  });
  it("la tarifa solo se elige entre las vigentes del catálogo de la ruta (select, sin campo de monto libre)", () => {
    expect(page).toContain("catalogos?.tarifasPorRuta[b.rutaId]");
    expect(page).not.toMatch(/type="number"/);
  });
});

describe("diagnóstico de bloqueos y edición del regreso (cliente)", () => {
  const dia = (fila: number, over: Partial<NonNullable<FilaEditable["validacion"]>> = {}) => ({ fila, estado: "error" as const, errores: [`x de este mismo lote.`], tarifa: null, ...over });
  const lote = (n: number, origen = 33): FilaEditable[] =>
    Array.from({ length: n }, (_, i) => {
      const fila = i + 1;
      return fila === origen
        ? fila_(fila, { validacion: dia(fila, { diagnostico: { horaInvalida: false, regresoInvalido: true, filasAfectadas: Array.from({ length: n }, (_, k) => k + 1).filter((x) => x !== origen), recursosCompartidos: ["personal"] }, conflictos: [{ recurso: "persona", filas: [1], causa: "dia_completo" }] }) })
        : fila_(fila, { validacion: dia(fila, { derivada: { origenes: [origen] }, conflictos: [{ recurso: "persona", filas: [origen], causa: "dia_completo" }] }) });
    });
  const fila_ = (n: number, over: Partial<FilaEditable> = {}) => fila(n, over);

  it("66 filas bloqueadas por UNA: el diagnóstico agrupa en un origen y 65 derivadas (no 66 problemas distintos)", () => {
    const d = diagnosticoDeFilas(lote(66));
    expect(d).toMatchObject({ total: 66, bloqueadas: 66, derivadas: 65 });
    expect(d.origenes).toEqual([{ fila: 33, falta: "regreso", afecta: 65 }]);
  });

  it("las filas pendientes de revalidar no cuentan en el diagnóstico (su resultado es viejo) y las excluidas tampoco", () => {
    const filas = lote(4, 2);
    filas[0] = { ...filas[0], sucia: true }; filas[2] = { ...filas[2], incluida: false };
    expect(diagnosticoDeFilas(filas).total).toBe(2);
  });

  it("EDITAR el regreso de la fila origen: solo ella queda pendiente; al llegar la nueva validación TODAS las derivadas se liberan y se puede confirmar", () => {
    const antes = lote(66);
    const editada = antes.map((f, i) => (i === 32 ? editarFila(f, { regresoEditado: "2026-11-20T12:00" }) : f));
    expect(editada.filter((f) => f.sucia).map((f) => f.borrador.fila)).toEqual([33]);   // solo la editada
    expect(editada[32].borrador.regresoEditado).toBe("2026-11-20T12:00");
    expect(puedeConfirmar(editada, false)).toBe(false);                               // aún hay pendientes y errores
    const respuesta = Array.from({ length: 66 }, (_, i) => ({ fila: i + 1, estado: "ok" as const, errores: [], tarifa: null }));
    const despues = aplicarValidacion(editada, respuesta);                            // el servidor revalida TODO el lote
    expect(despues.every((f) => f.validacion?.estado === "ok" && !f.sucia)).toBe(true);
    expect(puedeConfirmar(despues, false)).toBe(true);
    expect(diagnosticoDeFilas(despues)).toMatchObject({ bloqueadas: 0, derivadas: 0, origenes: [] });
  });

  it("si el nuevo regreso SIGUE solapándose, el servidor mantiene el bloqueo y el cliente lo refleja (no se relaja nada)", () => {
    const editada = lote(4, 2).map((f, i) => (i === 1 ? editarFila(f, { regresoEditado: "2026-11-20T09:00" }) : f));
    const respuesta = [
      { fila: 1, estado: "ok" as const, errores: [], tarifa: null },
      { fila: 2, estado: "error" as const, errores: ["La unidad X está asignada también en la fila 3 de este mismo lote. Los horarios se solapan."], tarifa: null, conflictos: [{ recurso: "unidad" as const, filas: [3], causa: "solape" as const }] },
      { fila: 3, estado: "error" as const, errores: ["La unidad X está asignada también en la fila 2 de este mismo lote. Los horarios se solapan."], tarifa: null, conflictos: [{ recurso: "unidad" as const, filas: [2], causa: "solape" as const }] },
      { fila: 4, estado: "ok" as const, errores: [], tarifa: null },
    ];
    const despues = aplicarValidacion(editada, respuesta);
    expect(puedeConfirmar(despues, false)).toBe(false);
    expect(diagnosticoDeFilas(despues).porMotivo.solape_real).toBe(2);
    expect(diagnosticoDeFilas(despues).origenes).toEqual([]);
  });

  it("el cuerpo enviado al servidor lleva el regreso editado y nunca los campos calculados ni la tarifa del origen", () => {
    const f = editarFila(fila(1), { regresoEditado: "2026-11-20T12:00" });
    const c = cuerpoLote("2026-11-19", "2026-11-20", [{ ...f, origen: { ...f.origen, tarifaOriginal: { monto: 5, moneda: "GTQ" } } }]);
    expect(c.filas[0].regresoEditado).toBe("2026-11-20T12:00");
    expect(JSON.stringify(c)).not.toMatch(/tarifaOriginal|regresoOffsetDias|regresoHora/);
  });
});

describe("comparación de tarifas y aceptación antes de confirmar", () => {
  const dest = (monto: number) => ({ id: 100, nombre: "Base", monto, moneda: "GTQ" });
  const conTarifa = (n: number, origenMonto: number | null, destinoMonto: number | null): FilaEditable => {
    const f = fila(n);
    return { ...f, origen: { ...f.origen, tarifaOriginal: origenMonto == null ? { monto: null, moneda: null } : { monto: origenMonto, moneda: "GTQ" } }, validacion: { fila: n, estado: "ok", errores: [], tarifa: destinoMonto == null ? null : dest(destinoMonto) } };
  };

  it("sin diferencias no se exige aceptar nada", () => {
    const filas = [conTarifa(1, 1500, 1500), conTarifa(2, null, null)];
    expect(claveAvisoTarifas(comparacionesDeTarifa(filas))).toBe("");
    expect(puedeConfirmarConTarifas(filas, false, "")).toBe(true);
  });
  it("con una tarifa distinta NO se puede confirmar hasta aceptarla expresamente; la aceptación es de ESE conjunto de diferencias", () => {
    const filas = [conTarifa(1, 1500, 1500), conTarifa(2, 1200, 1500)];
    const clave = claveAvisoTarifas(comparacionesDeTarifa(filas));
    expect(clave).toBe('[2,"distinta",[1200,"GTQ"],[100,1500,"GTQ"]]');
    expect(puedeConfirmarConTarifas(filas, false, "")).toBe(false);
    expect(puedeConfirmarConTarifas(filas, false, clave)).toBe(true);
    // si cambia el destino (otra tarifa vigente) o la fila, la aceptación anterior ya no vale
    const otra = [conTarifa(1, 1500, 1500), conTarifa(2, 1200, 1800)];
    expect(puedeConfirmarConTarifas(otra, false, clave)).toBe(false);
  });
  it("origen sin tarifa pero destino con tarifa (asignada) y origen con tarifa pero destino sin (perdida) también exigen aceptación", () => {
    expect(puedeConfirmarConTarifas([conTarifa(1, null, 1500)], false, "")).toBe(false);
    expect(puedeConfirmarConTarifas([conTarifa(1, 1200, null)], false, "")).toBe(false);
  });
  it("las reglas previas de confirmación siguen mandando (errores, pendientes, ocupado) aunque la tarifa esté aceptada", () => {
    const filas = [conTarifa(1, 1200, 1500)];
    const clave = claveAvisoTarifas(comparacionesDeTarifa(filas));
    expect(puedeConfirmarConTarifas(filas, true, clave)).toBe(false);
    expect(puedeConfirmarConTarifas([{ ...filas[0], sucia: true }], false, clave)).toBe(false);
    expect(puedeConfirmarConTarifas([{ ...filas[0], validacion: { fila: 1, estado: "error", errores: ["x"], tarifa: null } }], false, clave)).toBe(false);
  });
  it("solo se comparan las filas incluidas y validadas OK", () => {
    const filas = [{ ...conTarifa(1, 1200, 1500), incluida: false }, conTarifa(2, 1500, 1500), { ...conTarifa(3, 1200, 1500), sucia: true }];
    expect(comparacionesDeTarifa(filas).map((c) => c.fila)).toEqual([2]);
  });

  describe("la aceptación se invalida cuando cambia CUALQUIER dato relevante de la diferencia", () => {
    const fila2 = (o: { monto: number | null; moneda: string | null }, d: { id?: number; monto?: number; moneda?: string } | null): FilaEditable => {
      const f = fila(2);
      return { ...f, origen: { ...f.origen, tarifaOriginal: o }, validacion: { fila: 2, estado: "ok", errores: [], tarifa: d ? { id: d.id ?? 100, nombre: "Base", monto: d.monto ?? 1500, moneda: d.moneda ?? "GTQ" } : null } };
    };
    const clave = (...filas: FilaEditable[]) => claveAvisoTarifas(comparacionesDeTarifa(filas));
    const base = () => fila2({ monto: 1200, moneda: "GTQ" }, {});

    it("la MONEDA del destino distinta invalida la aceptación aunque el id y el monto sean los mismos", () => {
      const aceptada = clave(base());
      const otraMoneda = fila2({ monto: 1200, moneda: "GTQ" }, { moneda: "USD" });
      expect(clave(otraMoneda)).not.toBe(aceptada);
      expect(puedeConfirmarConTarifas([otraMoneda], false, aceptada)).toBe(false);
      expect(puedeConfirmarConTarifas([base()], false, aceptada)).toBe(true);          // lo mismo que se aceptó sí sigue aceptado
    });
    it("la MONEDA del origen distinta también invalida (misma diferencia aparente de monto, otra moneda de origen)", () => {
      const aceptada = clave(base());
      const origenUsd = fila2({ monto: 1200, moneda: "USD" }, {});
      expect(clave(origenUsd)).not.toBe(aceptada);
      expect(puedeConfirmarConTarifas([origenUsd], false, aceptada)).toBe(false);
    });
    it.each([
      ["el monto del origen", fila2({ monto: 1100, moneda: "GTQ" }, {})],
      ["el monto del destino", fila2({ monto: 1200, moneda: "GTQ" }, { monto: 1600 })],
      ["el id de la tarifa de destino (mismo monto y moneda)", fila2({ monto: 1200, moneda: "GTQ" }, { id: 101 })],
      ["el tipo de diferencia (origen con tarifa → sin tarifa en destino)", fila2({ monto: 1200, moneda: "GTQ" }, null)],
      ["el tipo de diferencia (origen sin tarifa → con tarifa en destino)", fila2({ monto: null, moneda: null }, {})],
    ])("cambiar %s invalida la aceptación anterior", (_n, otra) => {
      const aceptada = clave(base());
      expect(clave(otra)).not.toBe(aceptada);
      expect(puedeConfirmarConTarifas([otra], false, aceptada)).toBe(false);
    });
    it("distinguir mayúsculas/minúsculas de la moneda no cambia la clave (gtq == GTQ); un dato no relevante tampoco", () => {
      const aceptada = clave(base());
      const minuscula = fila2({ monto: 1200, moneda: "gtq" }, { moneda: "gtq" });
      expect(clave(minuscula)).toBe(aceptada);
      const otroNombre = { ...base(), validacion: { ...base().validacion!, tarifa: { id: 100, nombre: "Otro nombre", monto: 1500, moneda: "GTQ" } } };
      expect(clave(otroNombre)).toBe(aceptada);
    });
    it("un conjunto con otra fila con diferencia, o con una diferencia menos, también cambia la clave", () => {
      const f2 = base();
      const f3 = { ...fila2({ monto: 900, moneda: "GTQ" }, {}), borrador: { ...fila(3).borrador }, validacion: { fila: 3, estado: "ok" as const, errores: [], tarifa: { id: 100, nombre: "Base", monto: 1500, moneda: "GTQ" } } };
      const dos = clave(f2, f3);
      expect(dos).not.toBe(clave(f2));
      expect(puedeConfirmarConTarifas([f2, f3], false, clave(f2))).toBe(false);
    });
  });
});
