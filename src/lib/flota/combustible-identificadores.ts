/** Normalización compartida C-2B/C-2C, sin dependencias de servidor ni parser Excel. */
export const normalizarIdentificador = (s: string) => s.normalize("NFC").trim().replace(/\s+/g, " ").toUpperCase();

/** Conserva ceros/prefijos; unifica únicamente guiones Unicode y espacios alrededor. */
export const normalizarPlacaImportada = (s: string) => normalizarIdentificador(s).replace(/[‐‑–—]/g, "-").replace(/\s*-\s*/g, "-");
