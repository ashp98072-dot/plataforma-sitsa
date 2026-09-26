import { pilotosDeVista } from "@/lib/tms/programacion-personal-vista";

/**
 * Celda "Piloto" de las tablas web: el principal y, si existe, el piloto EXTRA cada uno en su propia línea (con salto de palabra, sin truncar
 * ni cortar con "…"). Sin extra se ve exactamente como antes (una sola línea).
 */
export function PilotosCelda({ principal, extra }: { principal: string | null | undefined; extra?: string | null }) {
  const v = pilotosDeVista({ piloto: principal ?? null, pilotoExtraNombre: extra ?? null, auxiliares: [] });
  if (!v.principal && !v.extra) return <>—</>;
  return (
    <>
      {v.principal ? <span className="block break-words">{v.principal}</span> : null}
      {v.extra ? <span className="block break-words" data-piloto-extra>{v.extra}</span> : null}
    </>
  );
}
