import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { calcularPeriodoRequerimiento, etiquetaPeriodoRequerimiento, fechaDMA } from "./viaticos-requerimientos-periodo";
import { guardarRequerimientoViaticoSchema, transicionRequerimientoViaticoSchema } from "./viaticos-requerimientos-schema";

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

describe("periodo del requerimiento (snapshot Día / Semana / Mes)", () => {
  it("Día: desde = hasta", () => {
    expect(calcularPeriodoRequerimiento("DIA", "2026-09-24")).toEqual({ periodoTipo: "DIA", periodoDesde: "2026-09-24", periodoHasta: "2026-09-24" });
  });
  it("Semana lunes–domingo (jueves 24 → 21 al 27), con cruce de mes y de año", () => {
    expect(calcularPeriodoRequerimiento("SEMANA", "2026-09-24")).toMatchObject({ periodoDesde: "2026-09-21", periodoHasta: "2026-09-27" });
    expect(calcularPeriodoRequerimiento("SEMANA", "2026-09-30")).toMatchObject({ periodoDesde: "2026-09-28", periodoHasta: "2026-10-04" });
    expect(calcularPeriodoRequerimiento("SEMANA", "2027-01-01")).toMatchObject({ periodoDesde: "2026-12-28", periodoHasta: "2027-01-03" });
  });
  it("Mes calendario (incluye bisiesto)", () => {
    expect(calcularPeriodoRequerimiento("MES", "2026-09-24")).toMatchObject({ periodoDesde: "2026-09-01", periodoHasta: "2026-09-30" });
    expect(calcularPeriodoRequerimiento("MES", "2028-02-10")).toMatchObject({ periodoDesde: "2028-02-01", periodoHasta: "2028-02-29" });
  });
  it("fecha de referencia inválida se rechaza", () => {
    expect(() => calcularPeriodoRequerimiento("DIA", "2026-13-40")).toThrow();
  });
  it("etiquetas del formato pedido; sin snapshot → guion", () => {
    expect(etiquetaPeriodoRequerimiento("DIA", "2026-09-21", "2026-09-21")).toBe("Día 21/09/2026");
    expect(etiquetaPeriodoRequerimiento("SEMANA", "2026-09-21", "2026-09-27")).toBe("Semana 21/09/2026 – 27/09/2026");
    expect(etiquetaPeriodoRequerimiento("MES", "2026-09-01", "2026-09-30")).toBe("Mes septiembre 2026");
    expect(etiquetaPeriodoRequerimiento(null, null, null)).toBe("—");
    expect(fechaDMA("2026-09-05")).toBe("05/09/2026");
  });
});

describe("esquemas: periodo y firma del requirente", () => {
  const linea = { fechaSolicitud: "2026-09-22", fechaViaje: "2026-09-24", personalId: 1, cantidad: "1", destino: "X", montoUnitario: "10" };
  const base = { fechaRequerimiento: "2026-09-24", empresaRequirente: "KUIQTRANS", requirenteUsuarioId: 5, lineas: [linea] };
  it("periodo es opcional y solo acepta DIA/SEMANA/MES", () => {
    const ok = (extra: object) => guardarRequerimientoViaticoSchema.safeParse({ ...base, ...extra }).success;
    expect(ok({})).toBe(true);
    expect(ok({ periodoTipo: "SEMANA", periodoReferencia: "2026-09-24" })).toBe(true);
    expect(ok({ periodoTipo: "AÑO" })).toBe(false);
  });
  it("enviar acepta firma GUARDADA o DIBUJADA (base64) y rechaza datos arbitrarios", () => {
    const p = (firmaRequirente: unknown) => transicionRequerimientoViaticoSchema.safeParse({ accion: "enviar", version: 1, firmaRequirente }).success;
    expect(p({ modo: "GUARDADA" })).toBe(true);
    expect(p({ modo: "DIBUJADA", imagenBase64: "iVBORw0KGgo=" })).toBe(true);
    expect(p({ modo: "DIBUJADA", imagenBase64: "<script>" })).toBe(false);
    expect(p({ modo: "GUARDADA", usuarioId: 9 })).toBe(false);
    expect(transicionRequerimientoViaticoSchema.safeParse({ accion: "enviar", version: 1 }).success).toBe(true);
  });
});

describe("emisión: snapshots y firma del requirente (guardas de código)", () => {
  const model = read("src/lib/tms/viaticos-requerimientos.ts");

  it("guarda cuenta y banco en cada línea al emitir (snapshot), leídos del empleado de la empresa", () => {
    expect(model).toContain("e.cuenta_bancaria,e.banco");
    expect(model).toContain("cuenta_snapshot,banco_snapshot");
    expect(model).toContain("textoONull(x.p.cuenta_bancaria),textoONull(x.p.banco)");
  });

  it("guarda periodo_tipo / periodo_desde / periodo_hasta calculados en el servidor (INSERT y UPDATE)", () => {
    expect(model.match(/periodo_tipo/g)!.length).toBeGreaterThanOrEqual(2);
    expect(model).toContain("periodo_tipo=?,periodo_desde=?,periodo_hasta=?");
    expect(model).toContain("calcularPeriodoRequerimiento(datos.periodoTipo, referencia)");
  });

  it("solo se firma por el requirente si ES el usuario de sesión (verificado antes de subir y dentro de la transacción)", () => {
    expect(model).toContain("Number(r.requirente_usuario_id)===usuarioId");
    expect(model).toContain("Number(actual.requirente_usuario_id)===usuarioId");
    expect(model).toContain("ACCION_FIRMA_REQUIRENTE");
    expect(model).toContain("origenFirma:firmaRequirente.origen");
    // nunca se lee la firma guardada de OTRO usuario: siempre la del usuario de sesión
    expect(model).toContain("leerBytesFirmaGuardada(usuarioId)");
    expect(model).not.toMatch(/leerBytesFirmaGuardada\((datos|actual|r)\b/);
  });

  it("la firma dibujada se valida como PNG y por tamaño antes de guardarse (inmutable en firmas_electronicas)", () => {
    expect(model).toContain("MAX_FIRMA_IMAGEN_BYTES");
    expect(model).toContain("esPngValido(new Uint8Array(bytes))");
    expect(model).toContain("entidadTipo:\"REQUERIMIENTO_VIATICO\"");
  });
});

describe("exportación y API (guardas de código)", () => {
  it("la ruta exportar entrega ambas firmas históricas y nada se recalcula con filtros de pantalla", () => {
    const route = read("src/app/api/empresas/[slug]/tms/viaticos/requerimientos/[id]/exportar/route.ts");
    expect(route).toContain("firmaHistoricaRequerimientoViatico(g.empresa.id,d.id)");
    expect(route).toContain("firmaRequirenteRequerimientoViatico(g.empresa.id,d.id)");
    expect(route).toContain("obtenerRequerimientoViatico(g.empresa.id,Number(p.id))");
    expect(route).not.toMatch(/searchParams\.get\("(fecha|periodo|filtro)/);
  });

  it("el detalle indica si el requirente es el usuario de sesión (para ofrecer o no la firma), sin exponer ids ajenos", () => {
    expect(read("src/lib/tms/viaticos-requerimientos-api.ts")).toContain("esRequirente:");
  });

  it("la UI ofrece el periodo y solo pide firma cuando el requirente es el usuario de sesión", () => {
    const ui = read("src/components/tms/viaticos-requerimientos-client.tsx");
    expect(ui).toContain("Periodo del requerimiento");
    expect(ui).toContain("esRequirente?abrirFirma():accion(\"enviar\")");
    expect(ui).toContain("SelectorFirma");
  });
});

describe("SQL propuesto (no se ejecuta)", () => {
  const sql = read("sql/migrate-2026-09-viaticos-requerimientos-formal.sql");
  it("solo agrega columnas NULLables y un CHECK; sin DROP/TRUNCATE/DELETE/UPDATE", () => {
    for (const c of ["periodo_tipo", "periodo_desde", "periodo_hasta", "cuenta_snapshot", "banco_snapshot"]) expect(sql).toContain(c);
    expect(sql.match(/ADD COLUMN IF NOT EXISTS/g)).toHaveLength(5);
    expect(sql).not.toMatch(/\b(DROP|TRUNCATE|DELETE|UPDATE|INSERT)\b/i);
    expect(sql).not.toMatch(/ADD COLUMN[^\n]*NOT NULL/);
  });
});
