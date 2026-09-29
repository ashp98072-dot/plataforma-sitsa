import { componerNombreCompleto, tieneIdentidadEstructurada, type PartesNombreCompleto } from "./nombre-completo";

/**
 * AJUSTE PR #375 — lógica PURA (sin React) de qué hacer con la identidad del candidato al guardar una entrevista
 * desde src/app/e/[slug]/rrhh/entrevistas/page.tsx. Extraída para poder probarla sin renderizar el componente.
 *
 * Reglas:
 *  - Entrevista NUEVA: identidad SIEMPRE obligatoria y SIEMPRE se envía (primer nombre + primer apellido).
 *  - Entrevista YA ESTRUCTURADA (entrevistaCargadaSinEstructura = false): igual, siempre obligatoria y se envía.
 *  - Entrevista HISTÓRICA sin estructura (entrevistaCargadaSinEstructura = true) Y el formulario todavía no tiene
 *    NINGUNA parte de identidad escrita: NO se exige nada y NO se envía — así el PATCH nunca manda los 7 campos
 *    vacíos, `actualizarEntrevista()` nunca entra en `tocaIdentidad` y `candidato_nombre` histórico queda intacto.
 *  - Entrevista HISTÓRICA sin estructura, pero RRHH YA empezó a escribir alguna parte: pasa a exigir el mínimo
 *    (primer nombre + primer apellido) y a partir de ahí SÍ se envía la identidad completa.
 */
export function debeIncluirIdentidad(opts: {
  editando: boolean;
  entrevistaCargadaSinEstructura: boolean;
  form: PartesNombreCompleto;
}): boolean {
  if (!opts.editando) return true;
  if (!opts.entrevistaCargadaSinEstructura) return true;
  return tieneIdentidadEstructurada(opts.form);
}

export type ResultadoPatchIdentidad =
  | { ok: true; identidad: Record<string, string | null> | Record<string, never> }
  | { ok: false; mensaje: string };

/** Valida (si corresponde) y arma el fragmento de identidad a incluir en el body — {} si no debe incluirse. */
export function construirIdentidadPatch(opts: {
  editando: boolean;
  entrevistaCargadaSinEstructura: boolean;
  form: PartesNombreCompleto;
}): ResultadoPatchIdentidad {
  const incluir = debeIncluirIdentidad(opts);
  if (!incluir) return { ok: true, identidad: {} };
  const { form } = opts;
  if (!form.primerNombre.trim() || !form.primerApellido.trim()) {
    return { ok: false, mensaje: "Primer nombre y primer apellido son obligatorios." };
  }
  return {
    ok: true,
    identidad: {
      candidatoPrimerNombre: form.primerNombre,
      candidatoSegundoNombre: form.segundoNombre || null,
      candidatoTercerNombre: form.tercerNombre || null,
      candidatoCuartoNombre: form.cuartoNombre || null,
      candidatoPrimerApellido: form.primerApellido,
      candidatoSegundoApellido: form.segundoApellido || null,
      candidatoApellidoCasada: form.apellidoCasada || null,
    },
  };
}

/**
 * ATRACCION-TALENTO-1 (corrección post-revisión) — lógica PURA para saber a
 * qué día/mes/año debe moverse la UI de Entrevistas después de guardar
 * (crear o reprogramar). `fecha` es la fecha ya guardada del formulario
 * (YYYY-MM-DD). `cambioPeriodo` indica si el mes o el año visible en el
 * calendario deben cambiar (y por lo tanto recargarse) o si basta con
 * mover el día seleccionado dentro del mismo mes ya cargado.
 */
export function calcularPeriodoTrasGuardar(
  fecha: string,
  anioActual: number,
  mesActual: number,
): { anio: number; mes: number; cambioPeriodo: boolean } {
  const anio = Number(fecha.slice(0, 4));
  const mes = Number(fecha.slice(5, 7));
  return { anio, mes, cambioPeriodo: anio !== anioActual || mes !== mesActual };
}

export type EntrevistadorMostrado =
  | { tipo: "usuario"; nombre: string }
  | { tipo: "empleado_historico"; nombre: string }
  | { tipo: "ninguno" };

/**
 * ATRACCION-TALENTO-2 (secciones 3 y 9 del ticket) — precedencia de
 * visualización del entrevistador: usuario > empleado histórico > ninguno.
 * Pura (sin DB) a propósito: la usan tanto el calendario/listado de
 * Entrevistas (client component) como Reportes — src/lib/rrhh/entrevistas.ts
 * no puede importarse desde un client component (trae @/lib/db).
 */
export function resolverEntrevistadorMostrado(ent: {
  entrevistadorUsuarioId: number | null;
  entrevistadorUsuarioNombre?: string;
  entrevistadorEmpleadoId: number | null;
  entrevistadorNombre?: string;
}): EntrevistadorMostrado {
  if (ent.entrevistadorUsuarioId != null && ent.entrevistadorUsuarioNombre) {
    return { tipo: "usuario", nombre: ent.entrevistadorUsuarioNombre };
  }
  if (ent.entrevistadorEmpleadoId != null && ent.entrevistadorNombre) {
    return { tipo: "empleado_historico", nombre: ent.entrevistadorNombre };
  }
  return { tipo: "ninguno" };
}

export { componerNombreCompleto };
