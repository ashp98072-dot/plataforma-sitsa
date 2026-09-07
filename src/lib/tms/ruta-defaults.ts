export type PersonalDefaultRuta = {
  empleadoId: number;
  empleadoNombre: string;
  rol: "Piloto" | "Auxiliar";
  viaticoMonto: number | null;
};

export type EstadoDefaultsViaje = {
  tarifaComercial: string;
  /**
   * TMS-GASTOS-REPORTES-1 (bloqueo 2) — fotografía histórica del costo
   * operativo de referencia, mismo tratamiento que tarifaComercial: se
   * sugiere/copia de la ruta SOLO si el usuario todavía no capturó nada,
   * y queda editable para este viaje sin tocar la ruta maestra. Una vez
   * guardado el plan, cambios futuros de tms_cliente_rutas.costo_operativo
   * NUNCA alteran este valor ya persistido.
   */
  costoOperativoReferencia: string;
  pilotoEmpleadoId: number;
  pilotoNombre: string;
  auxiliarEmpleadoIds: number[];
  auxiliarNombres: string[];
  viaticosMontos: Record<string, string>;
};

/** Aplica sugerencias de ruta únicamente donde el usuario aún no capturó un valor. */
export function aplicarDefaultsRutaSinSobrescribir(
  actual: EstadoDefaultsViaje,
  tarifaReferencia: number | null,
  personal: PersonalDefaultRuta[],
  costoOperativoRuta?: number | null,
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
    costoOperativoReferencia:
      actual.costoOperativoReferencia === "" && costoOperativoRuta != null
        ? String(costoOperativoRuta)
        : actual.costoOperativoReferencia,
    pilotoEmpleadoId: pilotoFinal?.empleadoId ?? actual.pilotoEmpleadoId,
    pilotoNombre: pilotoFinal?.empleadoNombre ?? actual.pilotoNombre,
    auxiliarEmpleadoIds: auxiliaresFinales.length
      ? auxiliaresFinales.map((p) => p.empleadoId)
      : actual.auxiliarEmpleadoIds,
    auxiliarNombres: auxiliaresFinales.length ? [] : actual.auxiliarNombres,
    viaticosMontos,
  };
}
