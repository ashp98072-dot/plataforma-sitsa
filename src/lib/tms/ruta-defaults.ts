export type PersonalDefaultRuta = {
  empleadoId: number;
  empleadoNombre: string;
  rol: "Piloto" | "Auxiliar";
  viaticoMonto: number | null;
};

export type EstadoDefaultsViaje = {
  tarifaComercial: string;
  pilotoEmpleadoId: number;
  pilotoNombre: string;
  auxiliarEmpleadoIds: number[];
  auxiliarNombres: string[];
  viaticosMontos: Record<string, string>;
};

/**
 * TMS-SIN-COSTO-OPERATIVO-1 — negocio confirmó que "costo operativo" ya
 * no se utiliza: este helper ya NO sugiere/copia costo_operativo_referencia
 * (antes lo hacía, igual que tarifaComercial — ver TMS-GASTOS-REPORTES-1
 * en el historial de este archivo). Programación sigue aceptando
 * `costoOperativoReferencia` en su POST/PATCH por compatibilidad
 * histórica (planes/route.ts, sin cambios ahí), pero ya no hay ningún
 * flujo activo que lo capture ni lo copie desde la ruta.
 */

/** Aplica sugerencias de ruta únicamente donde el usuario aún no capturó un valor. */
export function aplicarDefaultsRutaSinSobrescribir(
  actual: EstadoDefaultsViaje,
  tarifaReferencia: number | null,
  personal: PersonalDefaultRuta[],
): EstadoDefaultsViaje {
  const piloto = personal.find((p) => p.rol === "Piloto");
  const auxiliares = personal.filter((p) => p.rol === "Auxiliar");
  const sinPiloto = !actual.pilotoEmpleadoId && !actual.pilotoNombre.trim();
  const sinAuxiliares = actual.auxiliarEmpleadoIds.length === 0 && actual.auxiliarNombres.length === 0;
  const pilotoFinal = sinPiloto && piloto ? piloto : null;
  const auxiliaresFinales = sinAuxiliares ? auxiliares : [];
  const viaticosMontos = { ...actual.viaticosMontos };

  for (const persona of [pilotoFinal, ...auxiliaresFinales]) {
    if (!persona || persona.viaticoMonto == null) continue;
    const key = persona.rol === "Piloto" ? "piloto" : `aux-emp-${persona.empleadoId}`;
    if (viaticosMontos[key] == null || viaticosMontos[key] === "") {
      viaticosMontos[key] = String(persona.viaticoMonto);
    }
  }

  return {
    tarifaComercial:
      actual.tarifaComercial === "" && tarifaReferencia != null
        ? String(tarifaReferencia)
        : actual.tarifaComercial,
    pilotoEmpleadoId: pilotoFinal?.empleadoId ?? actual.pilotoEmpleadoId,
    pilotoNombre: pilotoFinal?.empleadoNombre ?? actual.pilotoNombre,
    auxiliarEmpleadoIds: auxiliaresFinales.length
      ? auxiliaresFinales.map((p) => p.empleadoId)
      : actual.auxiliarEmpleadoIds,
    auxiliarNombres: auxiliaresFinales.length ? [] : actual.auxiliarNombres,
    viaticosMontos,
  };
}
