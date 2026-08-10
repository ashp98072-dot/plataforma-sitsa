"use client";

import { createContext, useContext, useRef } from "react";
import type { PermisoModulo } from "@/lib/permisos-shared";

export type EmpresaSessionValue = {
  rol: string;
  permisos: PermisoModulo[];
  empresaNombre: string;
  username: string;
};

const EmpresaSessionContext = createContext<EmpresaSessionValue>({
  rol: "",
  permisos: [],
  empresaNombre: "",
  username: "",
});

function samePermisos(a: PermisoModulo[], b: PermisoModulo[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (
      x.modulo !== y.modulo ||
      x.puedeVer !== y.puedeVer ||
      x.puedeCrear !== y.puedeCrear ||
      x.puedeEditar !== y.puedeEditar ||
      x.puedeEliminar !== y.puedeEliminar
    ) {
      return false;
    }
  }
  return true;
}

export function EmpresaSessionProvider({
  rol,
  permisos,
  empresaNombre,
  username,
  children,
}: EmpresaSessionValue & { children: React.ReactNode }) {
  // Evitar churn de context al navegar: el layout RSC manda arrays nuevos
  // con el mismo contenido y re-renderiza Flota/RRHH sin necesidad.
  const valueRef = useRef<EmpresaSessionValue>({
    rol,
    permisos,
    empresaNombre,
    username,
  });
  if (
    valueRef.current.rol !== rol ||
    valueRef.current.empresaNombre !== empresaNombre ||
    valueRef.current.username !== username ||
    !samePermisos(valueRef.current.permisos, permisos)
  ) {
    valueRef.current = { rol, permisos, empresaNombre, username };
  }

  return (
    <EmpresaSessionContext.Provider value={valueRef.current}>
      {children}
    </EmpresaSessionContext.Provider>
  );
}

/** Sesión ya resuelta en el layout (evita /api/auth/me en Flota/RRHH). */
export function useEmpresaSession(): EmpresaSessionValue {
  return useContext(EmpresaSessionContext);
}
