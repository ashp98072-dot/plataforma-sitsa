/**
 * COMPRAS / PROVEEDORES — identidad y normalización de nombre comercial y NIT para evitar duplicados (lógica PURA,
 * compartida por formulario, endpoint, servidor y preflight). Mismo criterio que
 * src/lib/compras/factura-compra.ts: la normalización es SOLO para comparar — nunca se altera el nombre_comercial/nit
 * que el usuario escribió ni lo que se muestra. Regla:
 *  - recorta extremos y colapsa cualquier secuencia de espacios internos a UN espacio;
 *  - mayúsculas y SIN acentos (NFD + remover diacríticos — misma técnica que factura-compra.ts, ya usada y aceptada
 *    en este repo para el mismo tipo de problema: "López"/"Lopez"/"LÓPEZ" identifican lo mismo);
 *  - el valor NORMALIZADO es lo que se guarda en `nombre_normalizado`/`nit_normalizado` — la columna NO depende de la
 *    colación de MariaDB para la insensibilidad a acentos/mayúsculas (a diferencia de factura_clave, que es una
 *    columna GENERADA a partir del valor crudo): aquí el backend calcula el valor una vez y lo persiste tal cual.
 */
const base = (v: string | null | undefined) =>
  String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().replace(/\s+/g, " ").toUpperCase();

/** Identidad de nombre comercial (nunca vacía: nombre_comercial es obligatorio y no puede quedar en blanco). */
export function normalizarNombreProveedor(nombreComercial: string): string {
  return base(nombreComercial);
}

/**
 * Identidad de NIT: además de la normalización base, quita separadores visuales (espacios, guiones, puntos) —
 * "1234-56789-0101" / " 1234 56789 0101 " / "1234567890101" son el mismo NIT.
 * NIT vacío/null -> null: NUNCA participa en la unicidad (sección 9-B del ticket).
 */
export function normalizarNitProveedor(nit: string | null | undefined): string | null {
  const limpio = base(nit).replace(/[\s.-]/g, "");
  return limpio || null;
}
