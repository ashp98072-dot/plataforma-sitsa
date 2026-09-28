/**
 * RRHH-ENTREVISTAS-IDENTIDAD-1 — composición del nombre completo a partir de nombres/apellidos separados. Función PURA,
 * compartida entre Empleados (src/app/e/[slug]/rrhh/empleados/page.tsx, antes tenía su propia copia local
 * `componerNombre`) y Entrevistas (src/lib/rrhh/entrevistas.ts) — misma regla exacta en ambos lados: trim, espacios
 * repetidos colapsados, campos vacíos ignorados, primero los nombres y luego los apellidos, en orden.
 */
export type PartesNombreCompleto = {
  primerNombre: string;
  segundoNombre: string;
  tercerNombre: string;
  cuartoNombre: string;
  primerApellido: string;
  segundoApellido: string;
  apellidoCasada: string;
};

/** "" si todas las partes están vacías — el caller decide el fallback (nombre libre / nombre histórico). */
export function componerNombreCompleto(partes: PartesNombreCompleto): string {
  const nombres = [partes.primerNombre, partes.segundoNombre, partes.tercerNombre, partes.cuartoNombre]
    .map((x) => x.trim())
    .filter(Boolean);
  const apellidos = [partes.primerApellido, partes.segundoApellido, partes.apellidoCasada]
    .map((x) => x.trim())
    .filter(Boolean);
  return [...nombres, ...apellidos].join(" ").replace(/\s+/g, " ").trim();
}

/** ¿Al menos una parte de la identidad estructurada tiene contenido? */
export function tieneIdentidadEstructurada(partes: Partial<PartesNombreCompleto> | null | undefined): boolean {
  if (!partes) return false;
  return Object.values(partes).some((v) => (v ?? "").toString().trim() !== "");
}
