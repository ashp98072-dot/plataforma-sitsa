"use client";

export type BarraDato = { etiqueta: string; valor: number; colorVar?: string };

type Props = {
  datos: BarraDato[];
  /** Variable de tema por defecto para el relleno de las barras (ej. "--accent"). */
  colorVar?: string;
  vacio?: string;
};

/**
 * ATRACCION-TALENTO-2 (secciones 19-23) — gráfica de barras horizontales sin
 * dependencias nuevas (CSS/divs, no SVG ni Chart.js/Recharts). Cada barra
 * SIEMPRE muestra la etiqueta y el valor numérico junto al color (sección
 * 23: accesible, no depende solo del color) y usa tokens de tema
 * (var(--accent) por defecto) para funcionar en dark/light.
 */
export function GraficaBarras({ datos, colorVar = "--accent", vacio = "Sin datos en el rango filtrado." }: Props) {
  const max = Math.max(1, ...datos.map((d) => d.valor));
  if (datos.length === 0) {
    return <p className="text-sm text-[var(--muted)]">{vacio}</p>;
  }
  return (
    <div className="space-y-2">
      {datos.map((d) => (
        <div key={d.etiqueta}>
          <div className="mb-0.5 flex items-center justify-between text-xs">
            <span className="text-[var(--text)]">{d.etiqueta}</span>
            <span className="font-medium text-[var(--text)]">{d.valor}</span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-[var(--border)]">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.max(2, (d.valor / max) * 100)}%`,
                backgroundColor: `var(${d.colorVar ?? colorVar})`,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
