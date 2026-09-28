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

export { componerNombreCompleto };
