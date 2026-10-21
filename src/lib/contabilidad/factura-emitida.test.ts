import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { calcularLineasFactura } from "@/lib/facturacion/lineas-factura";
import type { RolContable } from "./cuentas-rol";
import { crearSnapshotContable, huellaContable } from "./evento-snapshot";
import {
  CODIGOS_BLOQUEO_FACTURA,
  MENSAJES_BLOQUEO_FACTURA,
  construirSnapshotFacturaEmitida,
  evaluarContabilizacionFactura,
  type EvaluacionFactura,
  type FacturaContabilizable,
} from "./factura-emitida";

const lineasDe = (...defs: { total: number; clasificacion?: "SERVICIO" | "BIEN"; incluyeIva?: boolean }[]) => {
  const r = calcularLineasFactura({
    lineas: defs.map((d, i) => ({
      planIds: [i + 1], cantidad: 1, descripcion: `l${i}`, precioUnitario: d.total,
      clasificacion: d.clasificacion ?? "SERVICIO", precioIncluyeIva: d.incluyeIva ?? true,
    })),
    planIdsFactura: defs.map((_, i) => i + 1),
  });
  if (!r.ok) throw new Error(r.error);
  return r.lineas;
};

const ROLES_PRODUCTIVOS = new Set<RolContable>(["CLIENTES", "IVA_POR_PAGAR", "VENTAS_SERVICIOS", "RETENCION_IVA", "TRANSITO_BANCARIO", "ANTICIPOS", "DEVOLUCIONES_VENTAS"]);

function factura(extra: Partial<FacturaContabilizable> = {}, lineas = lineasDe({ total: 3000 })): FacturaContabilizable {
  return {
    facturaId: 40, empresaId: 7, entidadId: 3, estadoAdmin: "Emitida",
    certificacion: { certificadaEn: "2026-10-14T10:00:00Z", referencia: "UUID-DE-PRUEBA" },
    moneda: "GTQ", condicionPago: "CREDITO", retencionIvaPct: 0, fechaEmision: "2026-10-14",
    montoTotal: lineas.reduce((s, l) => Math.round((s + l.total) * 100) / 100, 0),
    lineas: lineas.map((l) => ({ clasificacion: l.clasificacion, base: l.base, iva: l.iva, total: l.total })),
    ...extra,
  };
}
const lista = (e: EvaluacionFactura) => { if (e.estado !== "LISTA") throw new Error(`bloqueada: ${e.codigo}`); return e; };
const bloqueo = (e: EvaluacionFactura) => { if (e.estado !== "BLOQUEADA") throw new Error("debía bloquearse"); return e; };

describe("partida: Dr CLIENTES · Cr VENTAS_SERVICIOS · Cr IVA_POR_PAGAR", () => {
  it("servicio GTQ sin retención: importes exactos y cuadrada", () => {
    const e = lista(evaluarContabilizacionFactura(factura(), ROLES_PRODUCTIVOS));
    expect(e.renglones).toEqual([
      { rol: "CLIENTES", lado: "DEBE", monto: "3000.00" },
      { rol: "VENTAS_SERVICIOS", lado: "HABER", monto: "2678.57" },
      { rol: "IVA_POR_PAGAR", lado: "HABER", monto: "321.43" },
    ]);
    expect(e.totales).toEqual({ total: "3000.00", base: "2678.57", iva: "321.43" });
    expect(e.fechaContable).toBe("2026-10-14");
    const debe = e.renglones.filter((r) => r.lado === "DEBE").reduce((s, r) => s + Number(r.monto) * 100, 0);
    const haber = e.renglones.filter((r) => r.lado === "HABER").reduce((s, r) => s + Number(r.monto) * 100, 0);
    expect(Math.round(debe)).toBe(Math.round(haber));
  });

  it("CONTADO y CRÉDITO producen la MISMA partida: ambos van a CLIENTES y NUNCA se carga banco", () => {
    const credito = lista(evaluarContabilizacionFactura(factura({ condicionPago: "CREDITO" }), ROLES_PRODUCTIVOS));
    const contado = lista(evaluarContabilizacionFactura(factura({ condicionPago: "CONTADO" }), ROLES_PRODUCTIVOS));
    expect(contado).toEqual(credito);
    for (const e of [credito, contado]) {
      expect(e.renglones.map((r) => r.rol)).not.toContain("TRANSITO_BANCARIO");
      expect(JSON.stringify(e)).not.toMatch(/BANCO/);
      expect(e.renglones.find((r) => r.lado === "DEBE")?.rol).toBe("CLIENTES");
    }
  });

  it("sin condición de pago declarada sigue yendo a CLIENTES (no depende de ella)", () => {
    expect(lista(evaluarContabilizacionFactura(factura({ condicionPago: null }), ROLES_PRODUCTIVOS)).renglones[0].rol).toBe("CLIENTES");
  });

  it("varias líneas con IVA incluido y agregado: suma exacta con Decimal (sin errores de punto flotante)", () => {
    const ls = lineasDe({ total: 100 }, { total: 33.33 }, { total: 50, incluyeIva: false });
    const e = lista(evaluarContabilizacionFactura(factura({}, ls), ROLES_PRODUCTIVOS));
    expect(e.totales).toEqual({ total: "189.33", base: "169.05", iva: "20.28" });
    expect(e.renglones).toEqual([
      { rol: "CLIENTES", lado: "DEBE", monto: "189.33" },
      { rol: "VENTAS_SERVICIOS", lado: "HABER", monto: "169.05" },
      { rol: "IVA_POR_PAGAR", lado: "HABER", monto: "20.28" },
    ]);
  });
});

describe("bloqueos (nunca un fallback)", () => {
  const ev = (extra: Partial<FacturaContabilizable>, roles: ReadonlySet<RolContable> = ROLES_PRODUCTIVOS, lineas?: ReturnType<typeof lineasDe>) =>
    evaluarContabilizacionFactura(factura(extra, lineas), roles);

  it("factura NO certificada: «Emitida» administrativa no basta", () => {
    const b = bloqueo(ev({ certificacion: null }));
    expect(b).toMatchObject({ codigo: "FACTURA_NO_CERTIFICADA", mensaje: "Factura aún no certificada." });
  });
  it("«Emitida» (estado operativo) NUNCA sustituye a la certificación: ninguna otra pista de la factura la reemplaza", () => {
    // Número y fecha digitados, factura Emitida, importes y entidad correctos: sin registro FEL certificado, sigue bloqueada.
    const f = factura({ estadoAdmin: "Emitida", certificacion: null, fechaEmision: "2026-10-14" });
    expect(bloqueo(evaluarContabilizacionFactura(f, ROLES_PRODUCTIVOS)).codigo).toBe("FACTURA_NO_CERTIFICADA");
    // Con certificación, el estado operativo sigue siendo un requisito adicional, no la fuente de la verdad fiscal.
    expect(lista(evaluarContabilizacionFactura(factura(), ROLES_PRODUCTIVOS)).estado).toBe("LISTA");
  });
  it("Borrador y Anulada no generan un asiento normal", () => {
    expect(bloqueo(ev({ estadoAdmin: "Borrador" })).codigo).toBe("FACTURA_NO_EMITIDA");
    expect(bloqueo(ev({ estadoAdmin: "Anulada" })).codigo).toBe("FACTURA_ANULADA");
    // Aunque (hipotéticamente) hubiera certificación, una anulada nunca produce el asiento normal.
    expect(bloqueo(ev({ estadoAdmin: "Anulada", certificacion: { certificadaEn: "x", referencia: "y" } })).codigo).toBe("FACTURA_ANULADA");
  });
  it("sin entidad contable", () => {
    expect(bloqueo(ev({ entidadId: null })).codigo).toBe("ENTIDAD_NO_ASIGNADA");
  });
  it("moneda distinta de GTQ", () => {
    const b = bloqueo(ev({ moneda: "USD" }));
    expect(b).toMatchObject({ codigo: "MONEDA_NO_SOPORTADA", mensaje: "Moneda no soportada: solo se contabiliza en GTQ." });
  });
  it("factura con retención (15 % o 30 %)", () => {
    for (const pct of [15, 30]) {
      expect(bloqueo(ev({ retencionIvaPct: pct }))).toMatchObject({ codigo: "RETENCION_NO_SOPORTADA", mensaje: "Factura con retención aún no soportada." });
    }
  });
  it("línea sin clasificación SERVICIO/BIEN (no se infiere por texto)", () => {
    const f = factura();
    f.lineas[0].clasificacion = null;
    expect(bloqueo(evaluarContabilizacionFactura(f, ROLES_PRODUCTIVOS)).codigo).toBe("CLASIFICACION_NO_INEQUIVOCA");
  });
  it("VENTAS_BIENES sin cuenta: bloqueo claro y SIN fallback a VENTAS_SERVICIOS", () => {
    const bienes = lineasDe({ total: 1120, clasificacion: "BIEN" });
    const b = bloqueo(ev({}, ROLES_PRODUCTIVOS, bienes));
    expect(b).toMatchObject({ codigo: "CUENTA_NO_CONFIGURADA", detalle: "VENTAS_BIENES", mensaje: "Cuenta VENTAS_BIENES no configurada." });
    // Una factura MIXTA tampoco pasa a medias.
    const mixta = lineasDe({ total: 1120 }, { total: 560, clasificacion: "BIEN" });
    expect(bloqueo(ev({}, ROLES_PRODUCTIVOS, mixta)).detalle).toBe("VENTAS_BIENES");
  });
  it("con VENTAS_BIENES configurada, una venta de bienes sí se reconoce con su propio rol", () => {
    const roles = new Set<RolContable>([...ROLES_PRODUCTIVOS, "VENTAS_BIENES"]);
    const e = lista(evaluarContabilizacionFactura(factura({}, lineasDe({ total: 1120, clasificacion: "BIEN" })), roles));
    expect(e.renglones.map((r) => r.rol)).toEqual(["CLIENTES", "VENTAS_BIENES", "IVA_POR_PAGAR"]);
  });
  it.each(["CLIENTES", "IVA_POR_PAGAR", "VENTAS_SERVICIOS"] as const)("falta la cuenta %s => bloqueo con su nombre", (rol) => {
    const roles = new Set<RolContable>([...ROLES_PRODUCTIVOS].filter((r) => r !== rol));
    expect(bloqueo(ev({}, roles))).toMatchObject({ codigo: "CUENTA_NO_CONFIGURADA", detalle: rol });
  });
  it("importes que no cuadran con el monto de la factura", () => {
    expect(bloqueo(ev({ montoTotal: 2999.99 })).codigo).toBe("IMPORTES_INCONSISTENTES");
    const f = factura();
    f.lineas[0].iva = null;
    expect(bloqueo(evaluarContabilizacionFactura(f, ROLES_PRODUCTIVOS)).codigo).toBe("IMPORTES_INCONSISTENTES");
  });
  it("sin fecha de emisión o sin líneas", () => {
    expect(bloqueo(ev({ fechaEmision: null })).codigo).toBe("FECHA_FALTANTE");
    expect(bloqueo(ev({ lineas: [] })).codigo).toBe("SIN_LINEAS");
  });
  it("todo código tiene un mensaje visible sin detalles internos", () => {
    for (const c of CODIGOS_BLOQUEO_FACTURA) {
      expect(MENSAJES_BLOQUEO_FACTURA[c]).toBeTruthy();
      expect(MENSAJES_BLOQUEO_FACTURA[c]).not.toMatch(/stack|sql|at \w+\.|Error:/i);
    }
  });
});

describe("snapshot y huella", () => {
  const cuentas = [{ rol: "IVA_POR_PAGAR" as const, cuentaId: 12 }, { rol: "CLIENTES" as const, cuentaId: 10 }, { rol: "VENTAS_SERVICIOS" as const, cuentaId: 11 }];
  const evaluacion = () => lista(evaluarContabilizacionFactura(factura(), ROLES_PRODUCTIVOS));

  it("cumple el contrato cerrado de snapshotContableSchema", () => {
    const s = construirSnapshotFacturaEmitida(40, evaluacion(), cuentas);
    expect(() => crearSnapshotContable(s)).not.toThrow();
    expect(s).toMatchObject({ origen: { tipo: "FACTURA", id: 40 }, versionCalculo: "FACTURA_EMITIDA_V1", impuestos: [{ concepto: "IVA_POR_PAGAR", monto: "321.43" }] });
  });
  it("estable: mismo contenido => misma huella aunque cambie el orden de las cuentas; distinto importe => otra huella", () => {
    const a = huellaContable(construirSnapshotFacturaEmitida(40, evaluacion(), cuentas));
    const b = huellaContable(construirSnapshotFacturaEmitida(40, evaluacion(), [...cuentas].reverse()));
    expect(a).toBe(b);
    const otra = lista(evaluarContabilizacionFactura(factura({}, lineasDe({ total: 3000.01 })), ROLES_PRODUCTIVOS));
    expect(huellaContable(construirSnapshotFacturaEmitida(40, otra, cuentas))).not.toBe(a);
  });
});

describe("INERTE: el evaluador no está conectado a ningún flujo productivo", () => {
  const RAIZ = process.cwd();
  const fuentes = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "node_modules" || n === ".next" ? [] : fuentes(p);
    return /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });

  it("ningún módulo de producción lo importa", () => {
    const usuarios = fuentes(join(RAIZ, "src"))
      .filter((p) => !p.endsWith(join("contabilidad", "factura-emitida.ts")))
      .filter((p) => /factura-emitida["']/.test(readFileSync(p, "utf8")))
      .map((p) => relative(RAIZ, p));
    expect(usuarios).toEqual([]);
  });

  it("emitirFactura (estado administrativo) no registra eventos ni asientos contables", () => {
    const src = readFileSync(join(RAIZ, "src/lib/facturacion/facturas.ts"), "utf8");
    expect(src).not.toMatch(/registrarEventoContableTx|registrarAsientoTx|cont_eventos|cont_asientos/);
  });

  it("registrarEventoContableTx sigue sin llamadores productivos", () => {
    const llamadores = fuentes(join(RAIZ, "src"))
      .filter((p) => !/src[\\/]lib[\\/]contabilidad[\\/]eventos\.ts$/.test(p))
      .filter((p) => /registrarEventoContableTx\s*\(/.test(readFileSync(p, "utf8")))
      .map((p) => relative(RAIZ, p).replace(/\\/g, "/"));
    expect(llamadores).toEqual([]);
  });
});
