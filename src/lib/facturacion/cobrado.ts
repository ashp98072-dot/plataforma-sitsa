/**
 * CxC-1 — «cobrado» de una factura = pagos legados (`fact_pagos`, un pago = una factura) + aplicaciones de cobros VIGENTES
 * (`fact_cobro_aplicaciones` de `fact_cobros`). Es la ÚNICA definición que usan los saldos de Facturación, de la CxC informativa y de
 * los reportes de viajes: así un cobro multi-factura reduce el saldo en todas partes y un cobro ANULADO deja de contar, sin copiar ni migrar nada
 * de `fact_pagos` (cada dinero entra por un solo camino; nada se duplica).
 *
 * Columnas: factura_id, monto, empresa_id, fecha_pago (en cobros: la fecha del cobro). Requiere las tablas de
 * `sql/migrate-2026-10-cxc-cobros-multifactura.sql` (migración ANTES del despliegue).
 */
export const SQL_COBRADO = `(
    SELECT p.factura_id, p.monto, p.empresa_id, p.fecha_pago FROM fact_pagos p
    UNION ALL
    SELECT a.factura_id, a.monto, a.empresa_id, c.fecha_cobro AS fecha_pago
      FROM fact_cobro_aplicaciones a JOIN fact_cobros c ON c.id = a.cobro_id AND c.estado = 'VIGENTE'
  ) cobrado_x`;
