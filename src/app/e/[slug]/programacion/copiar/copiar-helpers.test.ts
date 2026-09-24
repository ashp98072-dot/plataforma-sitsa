import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  aplicarErroresConfirmacion,
  aplicarValidacion,
  cuerpoLote,
  editarFila,
  puedeConfirmar,
  resumenFilas,
  sumarDias,
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
