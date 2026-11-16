import { expect, it } from "vitest";
import { seleccionShell } from "./seleccion-shell";
import type { CatalogosCB2, FilaCB2 } from "./client";

const fila = { perfil: "SHELL", origen: { piloto: "Nombre original" } } as FilaCB2;
const cat: CatalogosCB2 = { proveedores: [], vehiculos: [], tercerosDirectos: true, identidadesIndependientes: true,
    pilotosExternos: [{ id: 42, referencia: "P-42", nombre: "Piloto del catálogo" }] };

it("importar y reanudar conservan el piloto externo elegido sin convertirlo en reportado", () => {
    for (const unidad of [1, -2]) expect(seleccionShell(fila, cat, {
        pilotoTipo: "EXTERNO", pilotoExternoId: 42, decisionNombre: { tipo: "REPORTADO", confirmado: true },
    }, unidad)).toEqual({ pilotoTipo: "EXTERNO", metodoPiloto: "MANUAL", empleadoId: null,
        pilotoExternoId: 42, metodoEmpleado: "SIN_ASIGNACION" });
});

it("un ID externo ausente del catálogo no se convierte silenciosamente en reportado", () => {
    expect(() => seleccionShell(fila, cat, { pilotoTipo: "EXTERNO", pilotoExternoId: 99 }, -2)).toThrow();
});

it("mantiene decisiones de nombre reportado y empleado en unidades externas", () => {
    expect(seleccionShell(fila, cat, { decisionNombre: { tipo: "EMPLEADO", empleadoId: 7, confirmado: true } }, -2))
        .toMatchObject({ pilotoTipo: "INTERNO", empleadoId: 7, decisionNombre: { tipo: "EMPLEADO" } });
    expect(seleccionShell(fila, cat, { decisionNombre: { tipo: "REPORTADO", confirmado: true } }, -2))
        .toMatchObject({ pilotoTipo: "REPORTADO", empleadoId: null, decisionNombre: { tipo: "REPORTADO" } });
});
