"use client";

import { createContext, useContext } from "react";
import type { PermisoModulo } from "@/lib/permisos-shared";

export type EmpresaSessionValue = {
  rol: string;
  permisos: PermisoModulo[];
};

const EmpresaSessionContext = createContext<EmpresaSessionValue>({
  rol: "",
  permisos: [],
});

export function EmpresaSessionProvider({
  rol,
  permisos,
  children,
}: EmpresaSessionValue & { children: React.ReactNode }) {
  return (
    <EmpresaSessionContext.Provider value={{ rol, permisos }}>
      {children}
    </EmpresaSessionContext.Provider>
  );
}

/** Sesión ya resuelta en el layout (evita /api/auth/me en Flota). */
export function useEmpresaSession(): EmpresaSessionValue {
  return useContext(EmpresaSessionContext);
}
