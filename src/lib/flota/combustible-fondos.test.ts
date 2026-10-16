import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ContextoFondo, FondoCombustibleSelector } from "@/components/flota/combustible-fondo";
import type { PoolConnection } from "mysql2/promise";
const m = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: m.query }));
import { buscarLineasFondoCombustible, contextosFondosCombustible, validarLineaFondoCombustible, validarLineaFondoCombustibleTx } from "./combustible-fondos";
const linea = { categoria: "Combustible", estado: "Autorizada", vehiculo_id: 7 };
beforeEach(() => vi.resetAllMocks());
describe("elegibilidad C2A", () => {
  it.each(["Autorizada", "Liquidada"])("admite %s", estado => expect(() => validarLineaFondoCombustible({ ...linea, estado }, 7)).not.toThrow());
  it.each(["Pendiente", "Rechazada", "AUTORIZADA"])("rechaza %s", estado => expect(() => validarLineaFondoCombustible({ ...linea, estado }, 7)).toThrow("Autorizada o Liquidada"));
  it("rechaza categoría distinta", () => expect(() => validarLineaFondoCombustible({ ...linea, categoria: "Comida" }, 7)).toThrow("categoría Combustible"));
  it("rechaza unidad distinta sin modificarla", () => expect(() => validarLineaFondoCombustible(linea, 8)).toThrow("unidad"));
  it("sin unidad admite asociación, no inventa unidad", () => expect(() => validarLineaFondoCombustible({ ...linea, vehiculo_id: null }, 7)).not.toThrow());
  it("ajena/inexistente rechazada", () => expect(() => validarLineaFondoCombustible(undefined, 7)).toThrow("esta empresa"));
  it("revalida tenant y estado bloqueando cabecera antes de línea", async () => {
    m.query.mockResolvedValueOnce([[{ solicitud_id: 19 }]]).mockResolvedValueOnce([[{ estado: "Liquidada" }]]).mockResolvedValueOnce([[linea]]);
    await validarLineaFondoCombustibleTx(m as unknown as PoolConnection, 1, 42, 7);
    expect(m.query.mock.calls.map(c => c[1])).toEqual([[1, 42], [1, 19], [1, 19, 42]]);
    expect(m.query.mock.calls[1][0]).toContain("FOR UPDATE"); expect(m.query.mock.calls[2][0]).toContain("FOR UPDATE");
  });
  it("desaparición después de descubrir padre no pasa", async () => {
    m.query.mockResolvedValueOnce([[{ solicitud_id: 19 }]]).mockResolvedValueOnce([[{ estado: "Autorizada" }]]).mockResolvedValueOnce([[]]);
    await expect(validarLineaFondoCombustibleTx(m as unknown as PoolConnection, 1, 42, 7)).rejects.toThrow("esta empresa");
  });
  it("otra empresa no llega a bloquear padre", async () => {
    m.query.mockResolvedValueOnce([[]]);
    await expect(validarLineaFondoCombustibleTx(m as unknown as PoolConnection, 2, 42, 7)).rejects.toThrow();
    expect(m.query).toHaveBeenCalledOnce();
  });
});
describe("proyección y resumen por línea", () => {
  it("filtra tenant/categoría/estados; agrupa por línea antes del JOIN, sin mezclar rechazados", async () => {
    m.query.mockResolvedValue([{ id: 42, solicitud_id: 19, codigo: "SF-19", estado: "Autorizada", categoria: "Combustible", vehiculo_id: null, monto_solicitado: "2000.0000", vales: 3, pendiente: "50.00", aprobado: "1950.00", rechazado: "100.00" }]);
    const [r] = await buscarLineasFondoCombustible(1, "SF-19");
    expect(r).toMatchObject({ id: 42, montoSolicitado: "2000.0000", vales: 3, pendiente: "50.00", aprobado: "1950.00", rechazado: "100.00", vehiculoId: null });
    const [sql, params] = m.query.mock.calls[0];
    expect(params).toEqual([1, 1, "%SF-19%", "%SF-19%", "%SF-19%"]);
    expect(sql).toContain("l.cantidad*l.monto"); expect(sql).toContain("GROUP BY empresa_id, solicitud_fondo_linea_id");
    expect(sql).toContain("l.categoria='Combustible'"); expect(sql).toContain("s.estado IN ('Autorizada','Liquidada')");
    expect(sql).toContain("CASE WHEN estado='APROBADO' THEN monto ELSE 0 END");
    expect(sql).not.toMatch(/banco|cuenta|SELECT \*/i); expect(sql).toContain("LIMIT 50");
  });
  it("resumen histórico conserva estado rechazado sin hacerlo elegible", async () => {
    m.query.mockResolvedValue([]); await buscarLineasFondoCombustible(1, "", 42);
    expect(m.query.mock.calls[0][1]).toEqual([1, 1, 42]);
    expect(m.query.mock.calls[0][0]).not.toContain("s.estado IN");
  });
  it("sin vínculo no añade queries; contexto de varias líneas sin N+1", async () => {
    expect((await contextosFondosCombustible(1, [])).size).toBe(0); expect(m.query).not.toHaveBeenCalled();
    m.query.mockResolvedValue([]); await contextosFondosCombustible(1, [42, 43]);
    expect(m.query).toHaveBeenCalledOnce(); expect(m.query.mock.calls[0][1]).toEqual([1, 42, 43]);
  });
});
describe("contrato SQL y UI (no ejecuta SQL)", () => {
  const read = (p: string) => readFileSync(p, "utf8");
  it("scripts de diagnóstico solo SELECT/SHOW", () => {
    for (const p of ["preflight", "postcheck"]) {
      const sql = read(`sql/${p}-2026-10-combustibles-c2a-fondos.sql`).replace(/--[^\n]*/g, "");
      expect(sql.split(";").map(s => s.trim()).filter(Boolean).every(s => /^(SELECT|SHOW)\b/i.test(s))).toBe(true);
      expect(sql).not.toMatch(/(?:^|;)\s*(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE|CALL)\b/i);
    }
  });
  it("migración nullable compuesta RESTRICT, sin DML/backfill y compuerta divergencia/NOOP", () => {
    const sql = read("sql/migrate-2026-10-combustibles-c2a-fondos.sql").replace(/--[^\n]*/g, "");
    expect(sql).toContain("ADD COLUMN solicitud_fondo_linea_id INT NULL");
    expect(sql).toContain("FOREIGN KEY (empresa_id,solicitud_fondo_linea_id)");
    expect(sql).toContain("ON UPDATE RESTRICT ON DELETE RESTRICT");
    expect(sql).toContain("ADD UNIQUE KEY uq_fondolin_c2a_empresa_id (empresa_id,id)");
    expect(sql).toContain("col_total=0 AND objetos=0"); expect(sql).toContain("'NOOP'");
    expect(sql).toContain("SIGNAL SQLSTATE"); expect(sql).not.toMatch(/\b(INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM|TRUNCATE)\b/i);
    expect(sql).not.toMatch(/UNIQUE[^;]*\(solicitud_fondo_linea_id\)/i);
  });
  it("buscador opcional sin IDs visibles, empleado no piloto y resumen diferido", () => {
    const ui = read("src/components/flota/combustible-fondo.tsx");
    expect(ui).toContain("CatalogoSearchSelect"); expect(ui).toContain("Empleado relacionado");
    expect(ui).toContain("Sin unidad: no validada"); expect(ui).toContain("Sin solicitud de fondo");
    expect(ui).toContain("encodeURIComponent(q)"); expect(ui).toContain("ac.abort()");
    expect(read("src/components/flota/combustible-revision.tsx")).toContain("abierto && <ResumenLineaFondo");
  });
  it("render real de contexto sin unidad y selector con vínculo histórico", () => {
    const fondo = { id: 42, solicitudId: 19, codigo: "SF-19", categoria: "Combustible", estado: "Rechazada", vehiculoId: null, placa: "Texto anterior", empleadoRelacionado: "Empleado de ejemplo", montoSolicitado: "2000.0000", vales: 0, pendiente: "0", aprobado: "0", rechazado: "0" };
    const html = renderToStaticMarkup(createElement(ContextoFondo, { fondo }));
    expect(html).toContain("Sin unidad: no validada por Solicitud de Fondos");
    expect(html).toContain("Empleado relacionado: Empleado de ejemplo"); expect(html).not.toContain("Piloto");
    const selector = renderToStaticMarkup(createElement(FondoCombustibleSelector, { slug: "kt", value: "42", onChange: vi.fn(), historico: fondo }));
    expect(selector).toContain('name="solicitudFondoLineaId"'); expect(selector).toContain('value="42" selected=""');
    expect(selector).toContain("Sin solicitud de fondo");
  });
});
