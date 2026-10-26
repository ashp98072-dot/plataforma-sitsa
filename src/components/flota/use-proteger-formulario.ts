"use client";
import { useEffect } from "react";

export function useProtegerFormulario(pendiente: boolean, bloqueado: boolean) {
  useEffect(() => {
    if (!pendiente && !bloqueado) return;
    const salir = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    const navegar = (e: MouseEvent) => {
      const link = (e.target as Element)?.closest?.("a[href]");
      if (link && !link.getAttribute("href")?.startsWith("#") &&
        (bloqueado || !window.confirm("Hay cambios pendientes del vehículo. ¿Deseas salir sin guardarlos?"))) {
        e.preventDefault(); e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", salir);
    document.addEventListener("click", navegar, true);
    return () => { window.removeEventListener("beforeunload", salir); document.removeEventListener("click", navegar, true); };
  }, [pendiente, bloqueado]);
  return () => !bloqueado && (!pendiente || window.confirm("Hay cambios pendientes del vehículo. Si continúas, se descartarán. ¿Deseas continuar?"));
}
