import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  alternarSeleccion,
  aplicarValidacion,
  cuerpoLote,
  editarFila,
  filaDesdeCarga,
  limpiarSeleccion,
  puedeConfirmar,
  resumenFilas,
  seleccionarTodos,
  type FilaEditable,
} from "./copiar-helpers";

/**
 * Copiar programación — selección MANUAL: el usuario va MARCANDO lo que quiere copiar (la carga no selecciona nada).
 * Solo las filas seleccionadas se validan, se confirman, participan en colisiones dentro del lote y bloquean el botón.
 */
const ok = (n: number) => ({ fila: n, estado: "ok" as const, errores: [], tarifa: null });
const conError = (n: number, errores = ["La ruta no tiene una tarifa vigente."]) => ({ fila: n, estado: "error" as const, errores, tarifa: null });
const desmarcada = (n: number, over: Partial<FilaEditable> = {}): FilaEditable => ({
  incluida: false, sucia: false, advertencias: [],
  origen: { planId: 900 + n, codigo: `P${n}`, estado: "Cerrado", clienteNombre: "Acme", rutaCodigo: "1001", pilotoNombre: null, auxiliaresNombres: [], unidadPlaca: "P-1", tcPlaca: null },
  borrador: { fila: n, origenPlanId: 900 + n, rutaId: 10, clienteId: 3, horaCarga: "03:00", tipoTraslado: null, tipoViaje: "Propio", unidadPlaca: "P-1", tcVehiculoId: null, pilotoEmpleadoId: 1, auxiliarEmpleadoIds: [], tarifaId: null, externo: null, paradas: [{ lugarNombre: "Bodega", tipo: "Carga" }] },
  validacion: ok(n),
  ...over,
});
const lote = () => [1, 2, 3, 4].map((n) => desmarcada(n));
const seleccionadas = (fs: FilaEditable[]) => fs.filter((f) => f.incluida).map((f) => f.borrador.fila);

describe("la carga inicial no selecciona nada", () => {
  it("1) carga inicial -> 0 seleccionadas (aunque el servidor devuelva validación)", () => {
    const base = desmarcada(1);
    const cargadas = [1, 2, 3].map((n) => filaDesdeCarga({ origen: base.origen, advertencias: [], borrador: { ...base.borrador, fila: n }, validacion: ok(n) }));
    expect(cargadas.every((f) => f.incluida === false && f.sucia === false)).toBe(true);
    expect(resumenFilas(cargadas)).toMatchObject({ total: 3, incluidas: 0 });
    expect(puedeConfirmar(cargadas, false)).toBe(false);
  });
});

describe("marcar, desmarcar, seleccionar todos, limpiar", () => {
  it("2) marcar una fila -> 1 seleccionada, y entra a la siguiente validación", () => {
    const r = alternarSeleccion(lote(), 1);
    expect(seleccionadas(r)).toEqual([2]);
    expect(r[1].sucia).toBe(true);
    expect(resumenFilas(r)).toMatchObject({ incluidas: 1, total: 4 });
  });

  it("3) marcar varias", () => {
    let r = lote();
    for (const i of [0, 2, 3]) r = alternarSeleccion(r, i);
    expect(seleccionadas(r)).toEqual([1, 3, 4]);
  });

  it("4) desmarcar: la fila deja de contar de inmediato y conserva su información visual", () => {
    let r = alternarSeleccion(alternarSeleccion(lote(), 0), 1);
    r = aplicarValidacion(r, [ok(1), conError(2)]);
    expect(puedeConfirmar(r, false)).toBe(false); // la fila 2 seleccionada tiene error
    r = alternarSeleccion(r, 1);
    expect(seleccionadas(r)).toEqual([1]);
    expect(r[1].validacion?.errores).toEqual(["La ruta no tiene una tarifa vigente."]); // lo mostrado no se borra
    expect(puedeConfirmar(r, false)).toBe(true); // ya no bloquea, sin esperar otra validación
  });

  it("5) seleccionar todos marca TODAS (no solo las válidas) y las manda a validar", () => {
    const r = seleccionarTodos([desmarcada(1), desmarcada(2, { validacion: conError(2) }), desmarcada(3)]);
    expect(seleccionadas(r)).toEqual([1, 2, 3]);
    expect(r.every((f) => f.sucia)).toBe(true);
    expect(puedeConfirmar(r, false)).toBe(false); // hasta que la validación diga cuáles están OK
  });

  it("6) limpiar selección -> 0 seleccionadas sin borrar ni recargar la programación", () => {
    const antes = seleccionarTodos(lote());
    const r = limpiarSeleccion(antes);
    expect(seleccionadas(r)).toEqual([]);
    expect(r).toHaveLength(4);
    expect(r.map((f) => f.borrador)).toEqual(antes.map((f) => f.borrador));
    expect(r.map((f) => f.origen)).toEqual(antes.map((f) => f.origen));
    expect(r.every((f) => !f.sucia)).toBe(true);
    expect(puedeConfirmar(r, false)).toBe(false);
  });
});

describe("solo las SELECCIONADAS cuentan", () => {
  it("7) una fila NO seleccionada con error NO bloquea confirmar (35 filas, 33 con error, 2 marcadas y OK)", () => {
    const muchas = Array.from({ length: 35 }, (_, i) => desmarcada(i + 1, { validacion: conError(i + 1) }));
    let r = alternarSeleccion(alternarSeleccion(muchas, 0), 1);
    r = aplicarValidacion(r, [ok(1), ok(2)]);
    expect(resumenFilas(r)).toMatchObject({ total: 35, incluidas: 2, ok: 2, conError: 0, pendientes: 0 });
    expect(r.filter((f) => !f.incluida && f.validacion?.estado === "error")).toHaveLength(33); // siguen visibles con su error
    expect(puedeConfirmar(r, false)).toBe(true);
  });

  it("8) una fila SELECCIONADA con error SÍ bloquea", () => {
    let r = alternarSeleccion(alternarSeleccion(lote(), 0), 1);
    r = aplicarValidacion(r, [ok(1), conError(2)]);
    expect(puedeConfirmar(r, false)).toBe(false);
  });

  it("una fila seleccionada pendiente de revalidar bloquea; editarla la vuelve a marcar pendiente", () => {
    let r = alternarSeleccion(lote(), 0);
    expect(puedeConfirmar(r, false)).toBe(false); // recién marcada
    r = aplicarValidacion(r, [ok(1)]);
    expect(puedeConfirmar(r, false)).toBe(true);
    r = r.map((f, i) => (i === 0 ? editarFila(f, { horaCarga: "05:00" }) : f));
    expect(puedeConfirmar(r, false)).toBe(false);
  });

  it("marcar otra fila obliga a revalidar las ya seleccionadas (podrían chocar con la nueva)", () => {
    let r = aplicarValidacion(alternarSeleccion(lote(), 0), [ok(1)]);
    expect(puedeConfirmar(r, false)).toBe(true);
    r = alternarSeleccion(r, 1);
    expect(r[0].sucia).toBe(true);
    expect(puedeConfirmar(r, false)).toBe(false);
  });

  it("desmarcar una fila con la que otra chocaba dentro del lote fuerza revalidar a esa otra; sin choque no la toca", () => {
    let r = alternarSeleccion(alternarSeleccion(lote(), 0), 1);
    r = aplicarValidacion(r, [
      conError(1, ["Juan está asignado también en la fila 2 de este mismo lote."]),
      conError(2, ["Juan está asignado también en la fila 1 de este mismo lote."]),
    ]);
    const tras = alternarSeleccion(r, 1);
    expect(tras[0].sucia).toBe(true);
    expect(tras[0].validacion).toBeNull();
    const limpio = aplicarValidacion(alternarSeleccion(alternarSeleccion(lote(), 0), 1), [ok(1), ok(2)]);
    expect(alternarSeleccion(limpio, 1)[0].sucia).toBe(false);
  });
});

describe("lo que se envía y el botón Confirmar", () => {
  it("9/10) validar y confirmar reciben ÚNICAMENTE las filas seleccionadas (mismo cuerpo)", () => {
    const r = alternarSeleccion(alternarSeleccion(lote(), 0), 2);
    const cuerpo = cuerpoLote("2026-09-24", "2026-09-25", r);
    expect(cuerpo.filas.map((f) => f.fila)).toEqual([1, 3]);
    expect(cuerpo.filas.map((f) => f.origenPlanId)).toEqual([901, 903]);
    expect(cuerpoLote("2026-09-24", "2026-09-25", lote()).filas).toEqual([]);
  });

  it("11) 0 seleccionadas -> Confirmar deshabilitado (aunque haya filas OK sin marcar)", () => {
    expect(puedeConfirmar(lote(), false)).toBe(false);
    expect(puedeConfirmar([], false)).toBe(false);
  });
});

describe("pantalla: controles y contador (código fuente)", () => {
  const page = readFileSync("src/app/e/[slug]/programacion/copiar/page.tsx", "utf8");
  it("carga con filaDesdeCarga (todas desmarcadas), nunca con incluida: true", () => {
    expect(page).toContain("data.filas.map(filaDesdeCarga)");
    expect(page).not.toContain("incluida: true");
  });
  it("trae Seleccionar todos, Limpiar selección y el contador Seleccionados: X de N", () => {
    expect(page).toContain("Seleccionar todos");
    expect(page).toContain("Limpiar selección");
    expect(page).toMatch(/Seleccionados: <strong>\{r\.incluidas\}<\/strong> de <strong>\{r\.total\}<\/strong>/);
    expect(page).toContain("seleccionarTodos(f)");
    expect(page).toContain("limpiarSeleccion(f)");
  });
  it("las filas no seleccionadas siguen visibles con lo ya calculado (sin bloquear) y el checkbox es Seleccionar fila", () => {
    expect(page).toContain("No seleccionada");
    expect(page).toContain("Seleccionar fila ${b.fila}");
    expect(page).toContain("NO bloquea la confirmación");
  });
  it("el botón Confirmar y las peticiones dependen solo de las seleccionadas", () => {
    expect(page).toContain("disabled={!puedeConfirmar(filas, validando || confirmando)}");
    expect(page.match(/cuerpoLote\(fechaOrigen, fechaDestino, (actuales|filas)\)/g)).toHaveLength(2);
  });
  it("no toca motor ni SQL: la pantalla usa las mismas rutas", () => {
    expect(page).toContain("/tms/programacion/copiar/confirmar");
    expect(page).toContain("/tms/programacion/copiar/validar");
  });
});
