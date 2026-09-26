/**
 * PROGRAMACIÓN — filas del bloque "Viáticos del viaje" del formulario (funciones PURAS, sin BD ni React).
 *
 * Creación: SIEMPRE derivadas del estado ACTUAL del formulario (piloto principal, piloto extra, auxiliares): cambiar/quitar a alguien hace
 * desaparecer su fila al instante, sin depender de nada persistido.
 * Edición: los viáticos REALES vienen de la BD (ViaticosPanel); aquí solo se calculan las filas de PREVISUALIZACIÓN de quien el formulario
 * ya tiene asignado pero el viaje todavía NO (p. ej. un piloto extra recién agregado). Quien ya está persistido nunca se duplica.
 */
export type RolViatico = "Piloto" | "Auxiliar";

export type FilaViaticoForm = {
  /** Clave del monto tecleado. El principal conserva "piloto" (la usa ruta-defaults); el extra y los auxiliares llevan a la persona en la clave (cambiar de persona no arrastra el monto de la anterior). */
  key: string;
  nombre: string;
  rol: RolViatico;
  /** empleadoId (RRHH) — null si es un nombre libre (sin vínculo RRHH, no se puede enviar override todavía). */
  empleadoId: number | null;
  sugerido: number;
};

export type EstadoFormularioPersonal = {
  tipoViaje: "Propio" | "Tercerizado";
  pilotoEmpleadoId: number;
  pilotoNombre: string;
  mostrarPilotoExtra: boolean;
  pilotoExtraEmpleadoId: number;
  pilotoExtraNombre: string;
  auxiliarEmpleadoIds: number[];
  auxiliarNombres: string[];
};

type Opciones = {
  sugeridoPorRol: (rol: RolViatico) => number;
  /** Nombre real del auxiliar por empleadoId (catálogo RRHH); si no se conoce se usa "Empleado #id". */
  nombreAuxiliar?: (empleadoId: number) => string | undefined;
};

/** Filas del formulario en orden: piloto principal, piloto extra (fila PROPIA, rol Piloto) y auxiliares. */
export function derivarFilasViaticos(f: EstadoFormularioPersonal, o: Opciones): FilaViaticoForm[] {
  const filas: FilaViaticoForm[] = [];
  if (f.pilotoEmpleadoId) {
    filas.push({ key: "piloto", nombre: f.pilotoNombre || `Empleado #${f.pilotoEmpleadoId}`, rol: "Piloto", empleadoId: f.pilotoEmpleadoId, sugerido: o.sugeridoPorRol("Piloto") });
  } else if (f.pilotoNombre.trim()) {
    filas.push({ key: "piloto-libre", nombre: f.pilotoNombre.trim(), rol: "Piloto", empleadoId: null, sugerido: o.sugeridoPorRol("Piloto") });
  }
  // El piloto extra solo existe en viajes Propios y solo con identidad real de RRHH.
  if (f.tipoViaje === "Propio" && f.mostrarPilotoExtra && f.pilotoExtraEmpleadoId) {
    filas.push({
      key: `piloto-extra-${f.pilotoExtraEmpleadoId}`,
      nombre: f.pilotoExtraNombre || `Empleado #${f.pilotoExtraEmpleadoId}`,
      rol: "Piloto",
      empleadoId: f.pilotoExtraEmpleadoId,
      sugerido: o.sugeridoPorRol("Piloto"),
    });
  }
  for (const id of f.auxiliarEmpleadoIds) {
    filas.push({ key: `aux-emp-${id}`, nombre: o.nombreAuxiliar?.(id) ?? `Empleado #${id}`, rol: "Auxiliar", empleadoId: id, sugerido: o.sugeridoPorRol("Auxiliar") });
  }
  for (const nombreLibre of f.auxiliarNombres) {
    filas.push({ key: `aux-nombre-${nombreLibre}`, nombre: nombreLibre, rol: "Auxiliar", empleadoId: null, sugerido: o.sugeridoPorRol("Auxiliar") });
  }
  return filas;
}

/** Personas (empleadoId RRHH) que el viaje YA TIENE guardadas y que, por tanto, ya cuentan con su viático persistido. */
export type PersonalPersistido = { pilotoEmpleadoId: number | null; pilotoExtraEmpleadoId: number | null; auxiliarEmpleadoIds: number[] };

export function empleadosPersistidos(plan: {
  pilotoEmpleadoId?: number | null;
  pilotoExtraEmpleadoId?: number | null;
  auxiliaresDetalle?: { empleadoId: number | null }[];
}): Set<number> {
  const ids = [plan.pilotoEmpleadoId, plan.pilotoExtraEmpleadoId, ...(plan.auxiliaresDetalle ?? []).map((a) => a.empleadoId)];
  return new Set(ids.filter((x): x is number => x != null));
}

/**
 * EDICIÓN — filas de PREVISUALIZACIÓN: quien el formulario tiene asignado (con identidad RRHH) y el viaje guardado todavía no. Al guardar,
 * el servidor crea su viático y el plan refrescado ya los trae como persistidos → dejan de ser previsualización (nunca se duplican).
 * Quien ya estaba guardado NO aparece aquí (su viático real, con su estado y monto, lo muestra el panel).
 */
export function derivarPreviewViaticosEdicion(f: EstadoFormularioPersonal, persistidos: ReadonlySet<number>, o: Opciones): FilaViaticoForm[] {
  return derivarFilasViaticos(f, o).filter((fila) => fila.empleadoId != null && !persistidos.has(fila.empleadoId));
}

/** Agrupa por rol para mostrar "Pilotos" (uno o dos) y "Auxiliares". */
export function agruparViaticosPorRol(filas: readonly FilaViaticoForm[]): { pilotos: FilaViaticoForm[]; auxiliares: FilaViaticoForm[] } {
  return { pilotos: filas.filter((f) => f.rol === "Piloto"), auxiliares: filas.filter((f) => f.rol === "Auxiliar") };
}

export const tituloGrupoPilotos = (cantidad: number) => (cantidad > 1 ? "Pilotos" : "Piloto");
