export type BloqueoAutorizacion = { current: number | null };

export async function procesarConfirmacionAutorizacion(opts: {
  confirmada: boolean;
  id: number;
  bloqueo: BloqueoAutorizacion;
  autorizar: () => void | Promise<void>;
  alCambiar?: (id: number | null) => void;
}): Promise<boolean> {
  if (!opts.confirmada || opts.bloqueo.current !== null) return false;
  opts.bloqueo.current = opts.id;
  opts.alCambiar?.(opts.id);
  try {
    await opts.autorizar();
    return true;
  } finally {
    opts.bloqueo.current = null;
    opts.alCambiar?.(null);
  }
}
