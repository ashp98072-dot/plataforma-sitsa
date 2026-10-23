import { describe, expect, it } from "vitest";
import { avisos, avisosDetallados, coincidencias, diferencia, estadoVisual, resumenPreview, seleccionSegura, asignacionesExactas, sugerenciaPiloto } from "./preview-model";
import type { CatalogosCB2, FilaCB2 } from "./client";
export const fila: FilaCB2 = { hoja: "Lote 1", fila: 2, candidato: "a".repeat(64), bloqueada: false, documento: null, errores: [], estado: "VALIDA", motivos: [], vale: "0001", placa: " C–570BZT ", placaNormalizada: "C-570BZT", fecha: "2026-10-01", galones: "10", precio: "20", monto: "200", moneda: "GTQ", lote: "0007", origen: { producto: "", km: "NO MARCA KM", galones: "10", precio: "20", monto: "200" } };
const cat: CatalogosCB2 = { proveedores: [], vehiculos: [{ id: 1, placa: "C-570BZT" }] };
describe("preview explicable sin cambiar elegibilidad del servidor", () => {
    it("20 seleccionados con advertencias son LISTO; revisión y deselección son independientes", () => {
        const rows = Array.from({ length: 20 }, (_, i) => ({ ...fila, candidato: `c${i}`, fila: i + 2, monto: "199", motivos: ["Producto no informado", "Galones × precio difiere del monto; revisar redondeo o precio"] }));
        const asignadas = asignacionesExactas(rows, cat), original = resumenPreview([...rows, { ...rows[0], hoja: "Otra" }], cat, asignadas);
        expect(original).toMatchObject({ detectados: 20, listos: 20, elegibles: 20, seleccionados: 20, advertencias: 20, advertenciasPendientes: 20, bloqueados: 0, pendientes: 0, totalesSeleccionados: { GTQ: "3980" } });
        const revisada = resumenPreview(rows, cat, asignadas, { c0: true }, { c1: true });
        expect(revisada).toMatchObject({ listos: 20, elegibles: 20, seleccionados: 19, advertencias: 20, advertenciasPendientes: 19, totalesSeleccionados: { GTQ: "3781" } });
        expect(revisada.revision.filter(g => g.estado === "LISTO")).toHaveLength(revisada.listos);
        expect(revisada.revision.filter(g => g.seleccionado)).toHaveLength(revisada.seleccionados);
        expect(revisada.revision.filter(g => g.advertenciasPendientes)).toHaveLength(revisada.advertenciasPendientes);
    });
    it("grupo con una aparición bloqueada no se rescata con unidad ni revisión de avisos", () => {
        const f = { ...fila, motivos: ["Piloto sin determinar", "Fecha de consumo inválida"], errores: ["fecha"], bloqueada: true };
        const r = resumenPreview([fila, { ...f, hoja: "Otro lote" }], cat, { [fila.candidato!]: "1" }, {}, { [fila.candidato!]: true });
        expect(r).toMatchObject({ listos: 0, elegibles: 0, seleccionados: 0, bloqueados: 1, advertencias: 1, advertenciasPendientes: 0 });
        expect(avisosDetallados(f).map(a => a.nivel)).toEqual(["INFORMATIVA", "BLOQUEO", "BLOQUEO"]);
    });
    it("mismo sufijo con distintos prefijos no permite inferir una unidad abreviada", () => {
        const f = { ...fila, placaNormalizada: "570 BZT" }, ambiguous = { ...cat, vehiculos: [...cat.vehiculos, { id: 2, placa: "P-570BZT" }] };
        expect(asignacionesExactas([f], ambiguous)).toEqual({});
        expect(seleccionSegura([f], ambiguous, { [f.candidato!]: "1" })).toEqual({});
        expect(seleccionSegura([fila], ambiguous, { [fila.candidato!]: "2" })).toEqual({});
        expect(seleccionSegura([fila], { ...cat, vehiculos: [...cat.vehiculos, { id: 2, placa: "C 570 BZT" }] }, { [fila.candidato!]: "2" })).toEqual({ [fila.candidato!]: "2" });
    });
    it("propone decenas de asignaciones exactas sin aceptar ni elegir aproximadas o ambiguas", () => {
        const filas = Array.from({ length: 65 }, (_, i) => ({ ...fila, fila: i + 2, candidato: String(i), placaNormalizada: "C 570 BZT" }));
        expect(Object.keys(asignacionesExactas(filas, cat))).toHaveLength(65);
        expect(asignacionesExactas([{ ...fila, placaNormalizada: "570 BZT" }], cat)).toEqual({ [fila.candidato!]: "1" });
        expect(asignacionesExactas([{ ...fila, placaNormalizada: "C-570BZ7" }], cat)).toEqual({});
        expect(asignacionesExactas(filas, { ...cat, vehiculos: [...cat.vehiculos, { id: 2, placa: "C 570 BZT" }] })).toEqual({});
        expect(asignacionesExactas([fila, { ...fila, fila: 3, bloqueada: true }], cat)).toEqual({});
        expect(asignacionesExactas(filas, { ...cat, vehiculos: [] })).toEqual({});
    });
    it("pilotos exactos normalizados, homónimos y ausencia de catálogo sin asociación inventada", () => {
        const f = { ...fila, origen: { ...fila.origen!, piloto: " JOSE  CHAY " } };
        expect(sugerenciaPiloto(f, { ...cat, pilotos: [{ id: 1, nombre: "José Chay" }] }).estado).toBe("EXACTA");
        expect(sugerenciaPiloto(f, { ...cat, pilotos: [{ id: 1, nombre: "José Chay" }, { id: 2, nombre: "JOSE CHAY" }] }).estado).toBe("AMBIGUA");
        expect(sugerenciaPiloto(f, cat).estado).toBe("INEXISTENTE");
    });
    it("normaliza placas con las reglas existentes y exige coincidencia única", () => {
        expect(coincidencias(fila, cat).map(v => v.id)).toEqual([1]);
        expect(coincidencias(fila, { ...cat, vehiculos: [...cat.vehiculos, { id: 2, placa: "C‐570BZT" }] })).toHaveLength(2);
        expect(coincidencias({ ...fila, placa: "", placaNormalizada: "" }, cat)).toEqual([]);
        expect(coincidencias({ ...fila, placaNormalizada: "C-474BVD" }, cat)).toEqual([]);
    });
    it("no acepta vehículos ajenos al catálogo tenant ni candidatos bloqueados/ignorados/resueltos", () => {
        for (const f of [{ ...fila, bloqueada: true }, { ...fila, estado: "IGNORADA" }, { ...fila, estado: "RESUELTA" }]) expect(seleccionSegura([f], cat, { [fila.candidato!]: "1" })).toEqual({});
        expect(seleccionSegura([fila], cat, { [fila.candidato!]: "99" })).toEqual({});
        expect(seleccionSegura([fila], { ...cat, vehiculos: [] }, { [fila.candidato!]: "1" })).toEqual({});
        expect(seleccionSegura([fila, { ...fila, fila: 3, bloqueada: true }], cat, { [fila.candidato!]: "1" })).toEqual({});
        expect(seleccionSegura([fila], cat, { [fila.candidato!]: "" })).toEqual({});
    });
    it("clasifica según bloqueo real, advertencias y asignación explícita", () => {
        expect(estadoVisual(fila, {})).toBe("PENDIENTE");
        expect(estadoVisual(fila, { [fila.candidato!]: "1" })).toBe("LISTO");
        expect(estadoVisual({ ...fila, motivos: ["Producto no informado"] }, { [fila.candidato!]: "1" })).toBe("LISTO");
        expect(estadoVisual({ ...fila, bloqueada: true }, { [fila.candidato!]: "1" })).toBe("BLOQUEADO");
        expect(estadoVisual({ ...fila, estado: "IGNORADA", bloqueada: true }, {})).toBe("IGNORADO");
        expect(estadoVisual({ ...fila, estado: "RESUELTA", bloqueada: true }, {})).toBe("RESUELTO");
        expect(estadoVisual({ ...fila, estado: "INVALIDA", errores: ["factura"] }, { [fila.candidato!]: "1" })).toBe("LISTO");
    });
    it("diferencias decimales exactas y tolerancia estricta > 0.01", () => {
        expect(diferencia({ ...fila, galones: "0.1", precio: "0.2", monto: "0.02" })).toEqual({ calculado: "0.02", diferencia: "0", advertencia: false });
        expect(diferencia({ ...fila, monto: "199.99" })?.advertencia).toBe(false);
        expect(diferencia({ ...fila, monto: "199.989999" })).toMatchObject({ diferencia: "0.010001", advertencia: true });
        expect(diferencia({ ...fila, monto: "201" })?.diferencia).toBe("-1");
        for (const value of [null, "", "NaN", "0", "-1"]) expect(diferencia({ ...fila, precio: value })).toBeNull();
    });
    it("explica los valores y la acción sin inventar producto, precio o kilometraje", () => {
        const messages = avisos({ ...fila, motivos: ["Producto no informado", "Kilometraje conservado como texto", "Galones × precio difiere del monto; revisar redondeo o precio"], monto: "199" }).join(" ");
        expect(messages).toContain("no se asume diésel, regular ni superior");
        expect(messages).toContain("NO MARCA KM"); expect(messages).toContain("no interpretable");
        expect(messages).toContain("GTQ 200"); expect(messages).toContain("Excel GTQ 199"); expect(messages).toContain("GTQ 1");
        expect(messages).toContain("no bloquea por sí sola");
        expect(avisos({ ...fila, precio: null, origen: undefined, motivos: ["Galones × precio difiere del monto"] })[0]).toContain("No se puede calcular");
        expect(avisos({ ...fila, bloqueada: true, motivos: ["Fecha inválida"] })[0]).toContain("no se puede confirmar");
    });
    it("resume candidatos únicos y monedas separadas sin duplicar apariciones", () => {
        const rows = [fila, { ...fila, hoja: "Otra", fila: 9 }, { ...fila, candidato: "b", moneda: "USD", monto: "20", motivos: ["Aviso"] }, { ...fila, candidato: "c", bloqueada: true }, { ...fila, candidato: null, bloqueada: true }, { ...fila, candidato: null, estado: "IGNORADA", bloqueada: true }];
        expect(resumenPreview(rows, cat, { [fila.candidato!]: "1" })).toMatchObject({ detectados: 3, listos: 1, elegibles: 1, seleccionados: 1, pendientes: 1, advertencias: 1, bloqueados: 1, ignoradas: 1, sinIdentidad: 1, totales: { GTQ: "200" }, totalesSeleccionados: { GTQ: "200" } });
        expect(resumenPreview([fila, { ...fila, monto: "201" }], cat, {}).totales).toEqual({});
        expect(resumenPreview([{ ...fila, monto: null }], cat, {}).totales).toEqual({});
    });
});
