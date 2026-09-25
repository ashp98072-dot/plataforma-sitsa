/**
 * COMPRAS / REQUERIMIENTOS — identidad y normalización de facturas (lógica PURA, compartida por formulario, endpoint, servidor y
 * preflight). Una factura es la misma por: empresa + PROVEEDOR + serie normalizada + número normalizado. Nunca solo el número:
 * dos proveedores pueden emitir el mismo número.
 *
 * NORMALIZACIÓN (solo para COMPARAR; jamás se altera el valor almacenado/mostrado):
 *  - recorta extremos y colapsa cualquier secuencia de espacios internos a UN espacio;
 *  - mayúsculas y SIN acentos (coincide con la comparación de la BD, colación utf8mb4_unicode_ci);
 *  - guiones, puntos y ceros iniciales SON significativos: "A-123" ≠ "A123" y "000458" ≠ "458" (evita falsos duplicados);
 *  - serie vacía/null = serie vacía válida ("");
 *  - sin número (vacío/null) NO hay control de duplicidad.
 */
export type FacturaNormalizada = { serie: string; numero: string; clave: string };

const SEP = "\u0001";
const base = (v: string | null | undefined) =>
  String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().replace(/\s+/g, " ").toUpperCase();

/** Clave comparable, o null si no hay número (factura incompleta: no aplica el control). */
export function normalizarFacturaCompra(serie: string | null | undefined, numero: string | null | undefined): FacturaNormalizada | null {
  const n = base(numero);
  if (!n) return null;
  const s = base(serie);
  return { serie: s, numero: n, clave: `${s}${SEP}${n}` };
}

export type FacturaLinea = { proveedor_id: number; serie_factura?: string | null; numero_factura?: string | null };

/** Clave completa incluyendo proveedor (o null si la línea no tiene proveedor o número). */
export function claveFacturaProveedor(l: FacturaLinea): string | null {
  if (!l.proveedor_id) return null;
  const f = normalizarFacturaCompra(l.serie_factura, l.numero_factura);
  return f ? `${l.proveedor_id}${SEP}${f.clave}` : null;
}

/** Índices de las líneas cuya factura (proveedor + serie + número normalizados) se repite en la lista. Marca TODAS las repetidas. */
export function indicesFacturasRepetidas(lineas: FacturaLinea[]): Set<number> {
  const porClave = new Map<string, number[]>();
  lineas.forEach((l, i) => {
    const c = claveFacturaProveedor(l);
    if (c) porClave.set(c, [...(porClave.get(c) ?? []), i]);
  });
  const repetidas = new Set<number>();
  for (const idx of porClave.values()) if (idx.length > 1) idx.forEach((i) => repetidas.add(i));
  return repetidas;
}

export const MSG_FACTURA_DUPLICADA_INTERNA = "Factura duplicada dentro de este requerimiento.";
export const MSG_FACTURAS_REPETIDAS = "Hay facturas repetidas dentro del requerimiento. Corrige las líneas marcadas.";

export type FacturaExistente = {
  requerimientoId: number;
  requerimientoCodigo: string;
  lineaId: number;
  proveedorNombre: string;
  serie: string | null;
  numero: string;
  fecha: string;
  estado: string;
};

const dma = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

/** Mensaje de UX: "Esta factura ya existe en RC-… · Proveedor … · Fecha dd/mm/aaaa." */
export const mensajeFacturaExistente = (f: FacturaExistente) =>
  `Esta factura ya existe en ${f.requerimientoCodigo} · Proveedor ${f.proveedorNombre} · Fecha ${dma(f.fecha)}.`;

/** Mensaje del servidor (409) al intentar guardar una factura ya registrada. */
export const mensajeFacturaDuplicadaServidor = (serie: string | null | undefined, numero: string, codigo: string, proveedor: string) =>
  `La factura ${serie?.trim() ? `${serie.trim()} / ` : ""}${numero.trim()} ya existe en el requerimiento ${codigo} para el proveedor ${proveedor}.`;

/** Duplicados por (empresa, proveedor, clave) para el PREFLIGHT: misma regla que el código (paridad verificada por pruebas). */
export function agruparDuplicadosFactura<T extends FacturaLinea & { empresa_id: number }>(lineas: T[]): { clave: string; lineas: T[] }[] {
  const grupos = new Map<string, T[]>();
  for (const l of lineas) {
    const c = claveFacturaProveedor(l);
    if (c) grupos.set(`${l.empresa_id}${SEP}${c}`, [...(grupos.get(`${l.empresa_id}${SEP}${c}`) ?? []), l]);
  }
  return [...grupos.entries()].filter(([, v]) => v.length > 1).map(([clave, v]) => ({ clave, lineas: v }));
}
