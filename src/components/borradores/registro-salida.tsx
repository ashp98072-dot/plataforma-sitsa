"use client";

import { useEffect } from "react";
import { prepararSalidaDelNavegador } from "@/lib/borradores/salida-navegador";
import { registrarAntesDeSalidaExplicita } from "@/lib/session-navigation";

/**
 * BORR-1b — registra, mientras está montado, la política de limpieza local para la salida EXPLÍCITA (menú de cuenta / selector
 * de empresa). No renderiza nada. `ownerKey` llega del servidor (layout / página); `null` = borradores no disponibles → no
 * registra nada. La expiración de sesión no pasa por este gancho.
 */
export function RegistroSalidaBorradores({ ownerKey }: { ownerKey: string | null }) {
  useEffect(() => {
    if (ownerKey === null) return;
    return registrarAntesDeSalidaExplicita(async () => (await prepararSalidaDelNavegador(ownerKey)).continuar);
  }, [ownerKey]);
  return null;
}
