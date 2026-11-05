"use client";

import { createContext, useContext, useMemo, useRef } from "react";
import type { PermisoModulo } from "@/lib/permisos-shared";
import type { ContextoBorradores } from "@/lib/borradores/contexto";

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

/**
 * BORR-1b — contexto SEPARADO para borradores locales (ownerKey opaco + empresa, calculado por el SERVIDOR en el layout). Va en su
 * propio contexto, y no dentro de `EmpresaSessionValue`, para no tocar la memoización por ref del valor de sesión ni agregar
 * lecturas de ref durante el render. `null` = función no disponible. No altera permisos ni autenticación.
 */
const BorradoresContext = createContext<ContextoBorradores | null>(null);

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
  borradores = null,
  children,
}: EmpresaSessionValue & { borradores?: ContextoBorradores | null; children: React.ReactNode }) {
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

  // Identidad estable entre renders RSC: el layout manda un objeto nuevo con el mismo contenido en cada navegación.
  const ownerKey = borradores?.ownerKey ?? null;
  const empresaId = borradores?.empresaId ?? null;
  const empresaSlug = borradores?.empresaSlug ?? null;
  const contextoBorradores = useMemo<ContextoBorradores | null>(
    () => (ownerKey !== null && empresaId !== null && empresaSlug !== null ? { ownerKey, empresaId, empresaSlug } : null),
    [ownerKey, empresaId, empresaSlug],
  );

  return (
    <EmpresaSessionContext.Provider value={valueRef.current}>
      <BorradoresContext.Provider value={contextoBorradores}>{children}</BorradoresContext.Provider>
    </EmpresaSessionContext.Provider>
  );
}

/** Sesión ya resuelta en el layout (evita /api/auth/me en Flota/RRHH). */
export function useEmpresaSession(): EmpresaSessionValue {
  return useContext(EmpresaSessionContext);
}

/** Contexto autenticado para borradores locales (null = no disponible; no activar autoguardado). */
export function useContextoBorradores(): ContextoBorradores | null {
  return useContext(BorradoresContext);
}
