import Decimal from "decimal.js";
import type { ClasificacionLinea, CondicionPago } from "@/lib/facturacion/lineas-factura";
import { proponerPartidaVenta, type RolCuentaVenta } from "@/lib/facturacion/poliza-venta";
import type { RolContable } from "./cuentas-rol";
import type { SnapshotContable } from "./evento-snapshot";

/**
 * CONTABILIZACIÓN DE FACTURA EMITIDA (CONT PR C) — EVALUADOR PURO, **INERTE**.
 *
 * Decide, SIN base de datos ni efectos, si una factura puede contabilizarse y con qué partida. NO está conectado a ningún flujo
 * productivo: hoy el sistema no tiene un hito de certificación FEL (ver docs/CONTABILIDAD-PR-C-FACTURAS-DISCOVERY.md), de modo
 * que «Emitida» (estado administrativo) NO basta. Cuando exista ese hito, su transacción de reconocimiento llamará a esta
 * función y luego a `registrarEventoContableTx`; mientras tanto la función devuelve BLOQUEADA para cualquier factura real.
 *
 * Regla de la partida (única fuente: `proponerPartidaVenta`): Dr CLIENTES total · Cr VENTAS_x base · Cr IVA_POR_PAGAR iva.
 * También al CONTADO. El banco NO se toca (PR D, solo con una confirmación bancaria CONFIRMADA).
 *
 * Bloqueos (nunca un «fallback»): no emitida / anulada / no certificada · sin entidad contable · moneda ≠ GTQ · con retención de
 * IVA · línea sin clasificación SERVICIO/BIEN · rol de venta sin cuenta configurada (p. ej. VENTAS_BIENES) · importes que no
 * cuadran · fecha faltante. Todo con Decimal; nada de float.
 */

export const CODIGOS_BLOQUEO_FACTURA = [
  "FACTURA_ANULADA",
  "FACTURA_NO_EMITIDA",
  "FACTURA_NO_CERTIFICADA",
  "ENTIDAD_NO_ASIGNADA",
  "MONEDA_NO_SOPORTADA",
  "RETENCION_NO_SOPORTADA",
  "CLASIFICACION_NO_INEQUIVOCA",
  "CUENTA_NO_CONFIGURADA",
  "IMPORTES_INCONSISTENTES",
  "FECHA_FALTANTE",
  "SIN_LINEAS",
] as const;
export type CodigoBloqueoFactura = (typeof CODIGOS_BLOQUEO_FACTURA)[number];

/** Mensajes visibles (sin detalles internos), listos para el detalle de la factura. */
export const MENSAJES_BLOQUEO_FACTURA: Record<CodigoBloqueoFactura, string> = {
  FACTURA_ANULADA: "La factura está anulada: no genera un asiento normal.",
  FACTURA_NO_EMITIDA: "La factura aún no está emitida.",
  FACTURA_NO_CERTIFICADA: "Factura aún no certificada.",
  ENTIDAD_NO_ASIGNADA: "La factura no tiene entidad contable asignada.",
  MONEDA_NO_SOPORTADA: "Moneda no soportada: solo se contabiliza en GTQ.",
  RETENCION_NO_SOPORTADA: "Factura con retención aún no soportada.",
  CLASIFICACION_NO_INEQUIVOCA: "Hay líneas sin clasificar como servicio o bien.",
  CUENTA_NO_CONFIGURADA: "Cuenta contable no configurada.",
  IMPORTES_INCONSISTENTES: "Los importes de la factura no cuadran.",
  FECHA_FALTANTE: "La factura no tiene fecha de emisión.",
  SIN_LINEAS: "La factura no tiene líneas.",
};

/**
 * Resultado del hito REAL de certificación. Hoy no existe: `null` en toda factura.
 *
 * CONTRATO: debe derivarse SIEMPRE de un registro FEL real (futuro `fel_documentos.estado = 'CERTIFICADO'`, leído dentro de la
 * transacción de reconocimiento y bajo la misma empresa/factura), con su UUID/autorización/serie/número y fecha de
 * certificación. NUNCA se construye a partir de `fact_facturas.estado_admin`, del número digitado ni de otro dato de la factura:
 * `estado_admin = 'Emitida'` es un estado operativo y no es prueba de certificación.
 */
export type CertificacionFactura = { certificadaEn: string; referencia: string };

export type FacturaContabilizable = {
  facturaId: number;
  empresaId: number;
  /** `fact_facturas.entidad_id` (NULL en facturas anteriores a FACT-4). */
  entidadId: number | null;
  /** Estado OPERATIVO de la factura. Nunca prueba de certificación: la certificación viene de `certificacion` (registro FEL). */
  estadoAdmin: "Borrador" | "Emitida" | "Anulada";
  certificacion: CertificacionFactura | null;
  moneda: string;
  condicionPago: CondicionPago | null;
  retencionIvaPct: number;
  /** Fecha de emisión (YYYY-MM-DD): fecha contable del asiento. */
  fechaEmision: string | null;
  montoTotal: number;
  lineas: { clasificacion: ClasificacionLinea | null; base: number | null; iva: number | null; total: number | null }[];
};

export type RenglonAsiento = { rol: RolContable; lado: "DEBE" | "HABER"; monto: string };

export type EvaluacionFactura =
  | {
      estado: "LISTA";
      fechaContable: string;
      renglones: RenglonAsiento[];
      /** Importes con 2 decimales exactos, para el snapshot/huella del evento. */
      totales: { total: string; base: string; iva: string };
      rolesRequeridos: RolContable[];
    }
  | { estado: "BLOQUEADA"; codigo: CodigoBloqueoFactura; mensaje: string; detalle?: string };

const bloquea = (codigo: CodigoBloqueoFactura, detalle?: string): EvaluacionFactura => ({
  estado: "BLOQUEADA",
  codigo,
  mensaje: detalle && codigo === "CUENTA_NO_CONFIGURADA" ? `Cuenta ${detalle} no configurada.` : MENSAJES_BLOQUEO_FACTURA[codigo],
  ...(detalle ? { detalle } : {}),
});
const dos = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);

/**
 * @param rolesConfigurados roles con cuenta configurada en la entidad (el llamador los resuelve con `resolverCuentaPorRol`). Es
 *   OBLIGATORIO: si un rol requerido no está, se bloquea (jamás se sustituye por otra cuenta).
 */
export function evaluarContabilizacionFactura(f: FacturaContabilizable, rolesConfigurados: ReadonlySet<RolContable>): EvaluacionFactura {
  if (f.estadoAdmin === "Anulada") return bloquea("FACTURA_ANULADA");
  if (f.estadoAdmin !== "Emitida") return bloquea("FACTURA_NO_EMITIDA");
  // «Emitida» es un estado ADMINISTRATIVO (un botón + número digitado): no es certificación.
  if (!f.certificacion) return bloquea("FACTURA_NO_CERTIFICADA");
  if (f.entidadId == null) return bloquea("ENTIDAD_NO_ASIGNADA");
  if (f.moneda !== "GTQ") return bloquea("MONEDA_NO_SOPORTADA");
  if (f.retencionIvaPct !== 0) return bloquea("RETENCION_NO_SOPORTADA");
  if (!f.fechaEmision || !/^\d{4}-\d{2}-\d{2}$/.test(f.fechaEmision)) return bloquea("FECHA_FALTANTE");
  if (!f.lineas.length) return bloquea("SIN_LINEAS");
  if (f.lineas.some((l) => l.clasificacion !== "SERVICIO" && l.clasificacion !== "BIEN")) return bloquea("CLASIFICACION_NO_INEQUIVOCA");
  if (f.lineas.some((l) => l.base == null || l.iva == null || l.total == null)) return bloquea("IMPORTES_INCONSISTENTES");

  const lineas = f.lineas.map((l) => ({ clasificacion: l.clasificacion, base: l.base!, iva: l.iva!, total: l.total! }));
  const total = lineas.reduce((s, l) => s.plus(l.total), new Decimal(0));
  if (!total.equals(new Decimal(f.montoTotal))) return bloquea("IMPORTES_INCONSISTENTES");

  const partida = proponerPartidaVenta({ lineas, condicionPago: f.condicionPago ?? "CREDITO", retencionIvaPct: 0 });
  if (!partida.ok) return bloquea("IMPORTES_INCONSISTENTES");

  const rolesRequeridos = [...new Set(partida.partida.renglones.map((r) => r.rol as RolCuentaVenta))] as RolContable[];
  // Cada rol debe tener su cuenta: sin cuenta => bloqueo (sin fallback a VENTAS_SERVICIOS ni a ninguna otra).
  const faltante = rolesRequeridos.find((rol) => !rolesConfigurados.has(rol));
  if (faltante) return bloquea("CUENTA_NO_CONFIGURADA", faltante);

  const suma = (rol: RolCuentaVenta) => partida.partida.renglones.filter((r) => r.rol === rol).reduce((s, r) => s.plus(r.monto), new Decimal(0));
  const base = suma("VENTAS_SERVICIOS").plus(suma("VENTAS_BIENES"));
  return {
    estado: "LISTA",
    fechaContable: f.fechaEmision,
    renglones: partida.partida.renglones.map((r) => ({ rol: r.rol, lado: r.lado, monto: dos(new Decimal(r.monto)) })),
    totales: { total: dos(total), base: dos(base), iva: dos(suma("IVA_POR_PAGAR")) },
    rolesRequeridos,
  };
}

export const VERSION_CALCULO_FACTURA_EMITIDA = "FACTURA_EMITIDA_V1";

/**
 * Snapshot canónico del evento FACTURA_EMITIDA (contrato cerrado de `snapshotContableSchema`): cuentas por rol, importes por
 * concepto e impuestos. Estable: el mismo contenido produce la misma huella (el orden de las cuentas no importa).
 */
export function construirSnapshotFacturaEmitida(
  facturaId: number,
  evaluacion: Extract<EvaluacionFactura, { estado: "LISTA" }>,
  cuentas: { rol: RolContable; cuentaId: number }[],
): SnapshotContable {
  const ordenadas = [...cuentas].sort((a, b) => a.rol.localeCompare(b.rol));
  return {
    version: 1,
    versionCalculo: VERSION_CALCULO_FACTURA_EMITIDA,
    origen: { tipo: "FACTURA", id: facturaId },
    cuentas: ordenadas,
    importes: [
      { concepto: "TOTAL_FACTURA", monto: evaluacion.totales.total },
      { concepto: "BASE_VENTA", monto: evaluacion.totales.base },
    ],
    impuestos: [{ concepto: "IVA_POR_PAGAR", monto: evaluacion.totales.iva }],
  };
}
