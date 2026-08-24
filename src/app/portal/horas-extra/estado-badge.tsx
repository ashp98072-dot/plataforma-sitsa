/**
 * Fase H1: badge de estado — null = registro histórico (previo a H1, ya
 * procesado, no se reinterpreta).
 *
 * Fase H3: `pagada` es puramente informativo, derivado en el servidor (ver
 * marcarPagadas() en horas-extra.ts) cruzando contra
 * rrhh_planilla_lineas.estado_pago — NO es un estado guardado en
 * horas_extra_registros. Cuando una hora extra APLICADA_EN_PLANILLA ya fue
 * realmente pagada, se muestra "Pagada" en vez de "Aplicada a planilla".
 *
 * Componente sin estado propio (server o client indistintamente) — vive en
 * su propio archivo porque tanto la página del Portal (server component)
 * como EquipoRegistros (client component, botones de aprobar/rechazar) lo
 * necesitan.
 */
export default function EstadoBadge({
  estado,
  pagada,
}: {
  estado: string | null;
  pagada?: boolean;
}) {
  const map: Record<string, { label: string; className: string }> = {
    PENDIENTE: { label: "Pendiente", className: "bg-amber-500/20 text-amber-300" },
    APROBADA: { label: "Aprobada", className: "bg-emerald-500/20 text-emerald-300" },
    RECHAZADA: { label: "Rechazada", className: "bg-red-500/20 text-red-300" },
    APLICADA_EN_PLANILLA: {
      label: "Aplicada a planilla",
      className: "bg-sky-500/20 text-sky-300",
    },
    PAGADA: { label: "Pagada", className: "bg-green-500/20 text-green-300" },
  };
  const clave = estado === "APLICADA_EN_PLANILLA" && pagada ? "PAGADA" : estado;
  const info = clave != null ? map[clave] : null;
  const { label, className } = info ?? {
    label: "Histórico",
    className: "bg-white/10 text-[var(--muted)]",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>
      {label}
    </span>
  );
}
