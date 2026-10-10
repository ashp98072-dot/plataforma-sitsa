import Decimal from "decimal.js";
import type { CondicionPago, ClasificacionLinea } from "@/lib/facturacion/lineas-factura";
import { esRetencionIvaValida } from "@/lib/facturacion/lineas-factura";

/**
 * FACT-4 — PARTIDA de una venta (DEBE/HABER) calculada con la regla CONFIRMADA por Contabilidad. Función PURA: no escribe
 * asientos, no conoce números de cuenta ni entidades. Devuelve renglones por ROL; la cuenta contable de cada rol sale
 * después de la parametrización de la entidad emisora (válido por igual para Mónaco y KT; nada hardcodeado).
 *
 * Regla confirmada (ejemplo: factura de Q3,000.00 con IVA incluido y retención del 15 %):
 *   base           = total / 1.12                      → 2,678.57   (suma de las bases de las líneas)
 *   iva            = total − base                      →   321.43
 *   retención IVA  = iva × porcentaje de retención     →    48.21   (0 %, 15 % o 30 %; half-up a 2 decimales)
 *   cliente|banco  = total − retención                 → 2,951.79
 *   DEBE:  Retención IVA 48.21 · Clientes (crédito) o Banco (contado) 2,951.79      = 3,000.00
 *   HABER: Ventas 2,678.57 · IVA por pagar 321.43                                     = 3,000.00
 * - La retención NO reduce Ventas ni el IVA por pagar de la factura: va en el DEBE, en su propia cuenta.
 * - Crédito: la contrapartida neta es CLIENTES. Contado: es el BANCO de la cuenta bancaria elegida en la factura.
 * - Ventas se separa por clasificación de línea: SERVICIOS y BIENES.
 *
 * El momento de generar la póliza (DESPUÉS de que FEL certifique), su idempotencia y su reversión por anulación NO se
 * implementan aquí (ver docs/FACTURACION-VIAJES-FASE1.md §19).
 */

export type RolCuentaVenta =
  | "CLIENTES"
  | "BANCOS"
  | "RETENCION_IVA"
  | "VENTAS_SERVICIOS"
  | "VENTAS_BIENES"
  | "IVA_POR_PAGAR";

export type RenglonPartidaVenta = {
  rol: RolCuentaVenta;
  lado: "DEBE" | "HABER";
  monto: number;
  /** Solo BANCOS: cuenta bancaria elegida en la factura (cont_cuentas_bancarias.id). */
  cuentaBancariaId?: number;
};

export type PartidaVentaPropuesta = {
  renglones: RenglonPartidaVenta[];
  totalDebe: number;
  totalHaber: number;
  /** Retención de IVA calculada (0 si no aplica). */
  retencionIva: number;
  /** Lo que realmente se cobra al cliente/banco: total − retención. */
  netoCobrar: number;
};

const dos = (d: Decimal): Decimal => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

/** retención = IVA × porcentaje / 100, half-up a 2 decimales. */
export function calcularRetencionIva(iva: number, porcentaje: number): number {
  if (!esRetencionIvaValida(porcentaje)) throw new RangeError("La retención de IVA debe ser 0, 15 o 30 %.");
  if (!Number.isFinite(iva) || iva < 0) throw new RangeError("El IVA debe ser un número no negativo.");
  return dos(new Decimal(iva).times(porcentaje).div(100)).toNumber();
}

export type EntradaPartidaVenta = {
  lineas: { clasificacion: ClasificacionLinea | null; base: number; iva: number; total: number }[];
  condicionPago: CondicionPago | null;
  cuentaBancariaId?: number | null;
  retencionIvaPct: number;
};

export function proponerPartidaVenta(
  e: EntradaPartidaVenta,
): { ok: true; partida: PartidaVentaPropuesta } | { ok: false; error: string } {
  if (!e.lineas.length) return { ok: false, error: "La venta no tiene líneas." };
  if (e.condicionPago !== "CREDITO" && e.condicionPago !== "CONTADO") {
    return { ok: false, error: "La condición de pago (CRÉDITO o CONTADO) es obligatoria." };
  }
  if (e.condicionPago === "CONTADO" && e.cuentaBancariaId == null) {
    return { ok: false, error: "Una venta al contado requiere la cuenta bancaria donde se recibe el pago." };
  }
  if (!esRetencionIvaValida(e.retencionIvaPct)) return { ok: false, error: "La retención de IVA debe ser 0, 15 o 30 %." };

  let ventasServicios = new Decimal(0);
  let ventasBienes = new Decimal(0);
  let iva = new Decimal(0);
  let total = new Decimal(0);
  for (const l of e.lineas) {
    if (l.clasificacion !== "SERVICIO" && l.clasificacion !== "BIEN") {
      return { ok: false, error: "Cada línea debe estar clasificada como SERVICIO o BIEN." };
    }
    if (dos(new Decimal(l.base).plus(l.iva)).toNumber() !== dos(new Decimal(l.total)).toNumber()) {
      return { ok: false, error: "Una línea no cuadra (base + IVA ≠ total)." };
    }
    if (l.clasificacion === "SERVICIO") ventasServicios = ventasServicios.plus(l.base);
    else ventasBienes = ventasBienes.plus(l.base);
    iva = iva.plus(l.iva);
    total = total.plus(l.total);
  }

  const retencion = new Decimal(calcularRetencionIva(iva.toNumber(), e.retencionIvaPct));
  const neto = total.minus(retencion);
  if (neto.isNegative()) return { ok: false, error: "La retención no puede exceder el total de la factura." };

  const renglones: RenglonPartidaVenta[] = [];
  if (retencion.gt(0)) renglones.push({ rol: "RETENCION_IVA", lado: "DEBE", monto: retencion.toNumber() });
  renglones.push(
    e.condicionPago === "CONTADO"
      ? { rol: "BANCOS", lado: "DEBE", monto: neto.toNumber(), cuentaBancariaId: e.cuentaBancariaId ?? undefined }
      : { rol: "CLIENTES", lado: "DEBE", monto: neto.toNumber() },
  );
  if (ventasServicios.gt(0)) renglones.push({ rol: "VENTAS_SERVICIOS", lado: "HABER", monto: ventasServicios.toNumber() });
  if (ventasBienes.gt(0)) renglones.push({ rol: "VENTAS_BIENES", lado: "HABER", monto: ventasBienes.toNumber() });
  if (iva.gt(0)) renglones.push({ rol: "IVA_POR_PAGAR", lado: "HABER", monto: iva.toNumber() });

  const suma = (lado: "DEBE" | "HABER") =>
    renglones.filter((r) => r.lado === lado).reduce((s, r) => s.plus(r.monto), new Decimal(0));
  const totalDebe = suma("DEBE");
  const totalHaber = suma("HABER");
  // Invariante contable: la partida SIEMPRE cuadra al centavo; si no, es un defecto y no se propone.
  if (!totalDebe.equals(totalHaber) || !totalDebe.equals(total)) {
    return { ok: false, error: "La partida no cuadra (DEBE ≠ HABER)." };
  }
  return {
    ok: true,
    partida: {
      renglones,
      totalDebe: totalDebe.toNumber(),
      totalHaber: totalHaber.toNumber(),
      retencionIva: retencion.toNumber(),
      netoCobrar: neto.toNumber(),
    },
  };
}
