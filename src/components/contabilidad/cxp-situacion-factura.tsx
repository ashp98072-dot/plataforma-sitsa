import { ETIQUETA_ESTADO_FINANCIERO } from "@/lib/contabilidad/cxp/estado-cuenta-shared";
import type { DesgloseFacturaLectura } from "@/lib/contabilidad/cxp/saldo-lectura";

export function CxpSituacionFactura({ factura }: { factura: Pick<DesgloseFacturaLectura, "estadoFinanciero" | "advertenciasIntegridad"> }) {
  return <>
    {ETIQUETA_ESTADO_FINANCIERO[factura.estadoFinanciero]}
    {factura.advertenciasIntegridad.map(a => <small key={a.codigo} role="alert" className="block text-amber-600 dark:text-amber-400">
      Advertencia de integridad · {a.codigo}: {a.mensaje}
    </small>)}
  </>;
}
