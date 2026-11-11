import { expect, it } from "vitest";
import { causasAsignacion } from "./problemas-asignacion";
import { revisionCandidatos } from "./preview-model";
import type { CatalogosCB2, FilaCB2 } from "./client";
const f: FilaCB2 = { hoja: "Ficticia", fila: 2, candidato: "a", bloqueada: false, documento: null, errores: [], estado: "VALIDA", motivos: [], vale: "FICT-1", placa: "060 KHK", placaNormalizada: "060 KHK", fecha: "2026-11-01", galones: "1", precio: "20", monto: "20", moneda: "GTQ", origen: { piloto: "Piloto Ficticio", producto: "", km: "", galones: "1", precio: "20", monto: "20" } };
const cat: CatalogosCB2 = { proveedores: [], vehiculos: [{ id: 1, placa: "060 KHK" }] };
it("clasificacion, empleado ausente y justificacion insuficiente se explican por separado", () => {
  const d = { exigirProducto: true, empleadoId: 99, motivoUnidad: "corto" }, g = revisionCandidatos([f], cat, { a: "1" }, {}, {}, { a: d })[0];
  const c = causasAsignacion(g, cat, d).join(" "); expect(c).toContain("clasificar"); expect(c).toContain("empleado"); expect(c).toContain("justificación");
});
it("externo con D2 apagada o asociacion revocada conserva bloqueo explicito", () => {
  const g = revisionCandidatos([f], cat, { a: "-2" })[0], c = causasAsignacion(g, cat).join(" "); expect(c).toContain("D2"); expect(c).toContain("verificada");
});
it("asignacion compatible y candidato resuelto no reciben causas ficticias", () => {
  expect(causasAsignacion(revisionCandidatos([f], cat, { a: "1" })[0], cat)).toEqual([]);
  expect(causasAsignacion(revisionCandidatos([{ ...f, estado: "RESUELTA", bloqueada: true }], cat, { a: "99" })[0], cat)).toEqual([]);
});
