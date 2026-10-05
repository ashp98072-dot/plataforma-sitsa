import type { Cotizacion } from "./cotizaciones";

/**
 * COTIZACIONES FASE 6 — modelo del DOCUMENTO COMERCIAL que se entrega al
 * cliente. Módulo puro (sin base de datos, sin pdfkit): lo usan el formulario
 * (constantes/etiquetas), la capa de datos (validación) y las plantillas PDF.
 *
 * Solo maneja información comercial. El documento se arma EXCLUSIVAMENTE a
 * partir de la fila guardada de la cotización (tipo `Cotizacion`), que no
 * contiene ningún dato interno de la operación: lo que no está en ese tipo no
 * puede llegar al PDF. El precio que se imprime es siempre `tarifaCotizada`.
 */

/** Marca bajo la que se emite el documento. Se guarda en la cotización; NO se deduce de cliente, ruta, usuario ni empresa. */
export const DOCUMENTOS_EMISOR = ["KUIQTRANS", "MONACO"] as const;
export type DocumentoEmisor = (typeof DOCUMENTOS_EMISOR)[number];

/** Valor de las cotizaciones históricas (columna con DEFAULT) y preselección visible del formulario. */
export const DOCUMENTO_EMISOR_DEFAULT: DocumentoEmisor = "KUIQTRANS";

export const LIMITE_TEXTO_DOCUMENTO = 160;

/** Mensaje/cierre comercial — mismo límite que condicionesAdicionales/observaciones en la cotización. */
export const LIMITE_TEXTO_MENSAJE_COMERCIAL = 2000;

/**
 * COTIZACIONES-CREDITO-COMBUSTIBLE — datos COMERCIALES por cotización (guardados con la cotización, nunca recalculados ni
 * leídos de Ajustes al generar el PDF). Separados de `tarifaReferencia` (referencia tarifaria de la ruta) y de los
 * datos operativos internos (que nunca llegan al documento).
 */
/** Condiciones de crédito: texto libre controlado (ej. "Crédito 30 días"); mismo límite que origen/destino (VARCHAR(300)). */
export const LIMITE_CONDICIONES_CREDITO = 300;
/** Tipos de combustible de referencia — mismos códigos que ya usa Flota (`diesel`/`gasolina`) más `otro`. Catálogo cerrado pequeño, sin tabla. */
export const TIPOS_COMBUSTIBLE_REFERENCIA = ["diesel", "gasolina", "otro"] as const;
export type TipoCombustibleReferencia = (typeof TIPOS_COMBUSTIBLE_REFERENCIA)[number];
export const ETIQUETA_COMBUSTIBLE: Record<TipoCombustibleReferencia, string> = { diesel: "Diésel", gasolina: "Gasolina", otro: "Otro" };
/** Tope de la columna DECIMAL(12,2), mismo que el resto de montos de la cotización. */
export const MAX_PRECIO_COMBUSTIBLE = 9999999999.99;

export function esTipoCombustibleReferencia(valor: unknown): valor is TipoCombustibleReferencia {
  return typeof valor === "string" && (TIPOS_COMBUSTIBLE_REFERENCIA as readonly string[]).includes(valor);
}

/** Precio de referencia válido: número finito > 0, a lo sumo 2 decimales y dentro de la columna DECIMAL(12,2). */
export function esPrecioCombustibleValido(valor: number): boolean {
  if (!Number.isFinite(valor) || !(valor > 0) || valor > MAX_PRECIO_COMBUSTIBLE) return false;
  const centavos = valor * 100;
  return Math.abs(centavos - Math.round(centavos)) < 1e-6;
}

/**
 * "Diésel — Q29.75/galón" | "Diésel" | "Q29.75/galón" | null (sin datos). El precio es por galón y en quetzales (lo
 * que pide negocio), independiente de la moneda de la tarifa cotizada.
 */
export function textoCombustibleReferencia(tipo: string | null | undefined, precio: number | null | undefined): string | null {
  const etiqueta = esTipoCombustibleReferencia(tipo) ? ETIQUETA_COMBUSTIBLE[tipo] : null;
  const monto = precio != null ? `${formatoMoneda(precio, "GTQ")}/galón` : null;
  if (etiqueta && monto) return `${etiqueta} — ${monto}`;
  return etiqueta ?? monto;
}

export type MarcaDocumento = {
  clave: DocumentoEmisor;
  /** Nombre comercial completo, tal como se lee en el documento. */
  nombre: string;
  /** Texto de la opción en el formulario. */
  etiqueta: string;
  /** Fragmento del nombre de archivo (ASCII). */
  archivo: string;
  saludo: string;
  cierre: string;
};

export const MARCAS_DOCUMENTO: Record<DocumentoEmisor, MarcaDocumento> = {
  KUIQTRANS: {
    clave: "KUIQTRANS",
    nombre: "KuiqTrans",
    etiqueta: "KuiqTrans",
    archivo: "KuiqTrans",
    saludo: "Reciban un cordial saludo de KuiqTrans. Con gusto presentamos nuestra propuesta económica para el servicio de transporte solicitado.",
    cierre: "Quedamos atentos a sus comentarios y a su confirmación.",
  },
  MONACO: {
    clave: "MONACO",
    nombre: "Logiservicios Mónaco",
    etiqueta: "Logiservicios Mónaco",
    archivo: "Monaco",
    saludo: "Es un gusto saludarles. Adjuntamos nuestra propuesta para el servicio solicitado.",
    cierre: "Quedamos a sus órdenes para cualquier consulta.",
  },
};

export function esDocumentoEmisor(valor: unknown): valor is DocumentoEmisor {
  return typeof valor === "string" && (DOCUMENTOS_EMISOR as readonly string[]).includes(valor);
}

/** Lectura tolerante (filas de BD): un valor ausente o desconocido cae al default, nunca rompe el listado. */
export function normalizarDocumentoEmisor(valor: unknown): DocumentoEmisor {
  return esDocumentoEmisor(valor) ? valor : DOCUMENTO_EMISOR_DEFAULT;
}

/** Texto opcional del documento: recorta espacios; vacío => null. */
export function textoOpcional(valor: string | null | undefined): string | null {
  const limpio = (valor ?? "").trim();
  return limpio ? limpio : null;
}

export function formatoMoneda(valor: number, codigoMoneda = "GTQ"): string {
  const numero = valor.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return codigoMoneda === "GTQ" ? `Q${numero}` : `${codigoMoneda} ${numero}`;
}

export function fechaLarga(fechaIso: string | null): string {
  if (!fechaIso) return "";
  const [anio, mes, dia] = fechaIso.split("-").map(Number);
  if (!anio || !mes || !dia) return fechaIso;
  return new Intl.DateTimeFormat("es-GT", { day: "numeric", month: "long", year: "numeric" }).format(new Date(anio, mes - 1, dia));
}

/**
 * Semántica ÚNICA del IVA en el documento: la tabla imprime `tarifaCotizada`
 * tal cual se cotizó y el encabezado de la columna dice sobre qué base está.
 * No se imprime subtotal, IVA ni "total + IVA" (evita mensajes contradictorios).
 */
export function encabezadoPrecio(incluyeIva: boolean): string {
  return incluyeIva ? "Precio IVA incluido" : "Precio sin IVA";
}

export type LineaComercial = { origen: string; destino: string; unidad: string; precio: number };

export type DatosDocumento = Pick<
  Cotizacion,
  | "codigo" | "clienteNombre" | "origenTexto" | "destinoTexto" | "tarifaCotizada" | "incluyeIva" | "moneda"
  | "fechaEmision" | "fechaVencimiento" | "pilotoIncluido" | "gpsIncluido" | "seguroMercaderiaIncluido"
  | "seguroTercerosIncluido" | "servicioRefrigerado" | "kmIncluidos" | "tarifaKmAdicional"
  | "condicionesAdicionales" | "observaciones" | "documentoEmisor" | "atencionNombre" | "atencionCargo" | "unidadDescripcion"
  | "mensajeComercial" | "cierreComercial" | "lineasAdicionales"
  | "condicionesCredito" | "combustibleReferenciaTipo" | "combustibleReferenciaPrecio"
>;

/**
 * La cotización guarda su LÍNEA PRINCIPAL en sus propias columnas
 * (origenTexto/destinoTexto/unidadDescripcion/tarifaCotizada) y, cuando la
 * propuesta cubre varias rutas/destinos, las líneas adicionales en
 * `lineasAdicionales` (tabla tms_cotizacion_lineas). El documento siempre
 * se arma a partir del arreglo completo [principal, ...adicionales] — cada
 * línea con su propio precio, nunca colapsadas en un total.
 */
export function lineasComerciales(c: DatosDocumento): LineaComercial[] {
  const principal: LineaComercial = {
    origen: textoOpcional(c.origenTexto) ?? "—",
    destino: textoOpcional(c.destinoTexto) ?? "—",
    unidad: textoOpcional(c.unidadDescripcion) ?? "—",
    precio: c.tarifaCotizada,
  };
  const adicionales = (c.lineasAdicionales ?? []).map((l) => ({
    origen: textoOpcional(l.origenTexto) ?? "—",
    destino: textoOpcional(l.destinoTexto) ?? "—",
    unidad: textoOpcional(l.unidadDescripcion) ?? "—",
    precio: l.tarifaCotizada,
  }));
  return [principal, ...adicionales];
}

function lineasDeTexto(texto: string | null | undefined): string[] {
  return (texto ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

function numeroCorto(n: number): string {
  return n.toLocaleString("es-GT", { maximumFractionDigits: 2 });
}

/** Solo las condiciones que APLICAN: nunca se imprime un "No" por cada casilla apagada. */
export function condicionesComerciales(c: DatosDocumento): string[] {
  const items: string[] = [];
  if (c.pilotoIncluido) items.push("Piloto incluido");
  if (c.gpsIncluido) items.push("GPS");
  if (c.seguroMercaderiaIncluido) items.push("Seguro de mercadería");
  if (c.seguroTercerosIncluido) items.push("Seguro contra terceros");
  if (c.servicioRefrigerado) items.push("Servicio refrigerado");
  if (c.kmIncluidos != null) items.push(`${numeroCorto(c.kmIncluidos)} km incluidos`);
  if (c.tarifaKmAdicional != null) items.push(`${formatoMoneda(c.tarifaKmAdicional, c.moneda)} por km adicional`);
  // COTIZACIONES-CREDITO-COMBUSTIBLE — debajo de las condiciones del servicio, antes de las adicionales; sin dato
  // (cotizaciones históricas) la línea se omite en vez de imprimir "—".
  const credito = textoOpcional(c.condicionesCredito);
  if (credito) items.push(`Condiciones de crédito: ${credito}`);
  // El combustible de referencia (tipo y precio) es SOLO de control interno: se guarda con la cotización y se ve en la pantalla interna,
  // pero NUNCA se agrega a las condiciones ni a ningún otro bloque del documento comercial (PDF KuiqTrans / Mónaco).
  items.push(...lineasDeTexto(c.condicionesAdicionales));
  return items;
}

export type DocumentoComercial = {
  emisor: DocumentoEmisor;
  marca: MarcaDocumento;
  codigo: string;
  fechaEmision: string;
  fechaVencimiento: string | null;
  cliente: string;
  atencionNombre: string | null;
  atencionCargo: string | null;
  saludo: string;
  lineas: LineaComercial[];
  incluyeIva: boolean;
  encabezadoPrecio: string;
  moneda: string;
  condiciones: string[];
  /** COTIZACIONES-CREDITO-COMBUSTIBLE — valor guardado (también incluido como línea en `condiciones`). El combustible de referencia NO forma parte del documento comercial. */
  condicionesCredito: string | null;
  observaciones: string[];
  cierre: string;
};

/**
 * Arma el documento a partir de la fila guardada (marca, atención, cargo,
 * unidad, mensaje y cierre comercial incluidos): un cambio posterior de
 * defaults no altera un PDF ya emitido.
 *
 * `saludo`/`cierre` son el texto YA GUARDADO en la propia cotización
 * (`mensajeComercial`/`cierreComercial`) cuando existe. Cotizaciones
 * anteriores a esta funcionalidad (columna NULL — nunca se reescriben en
 * masa) caen a un fallback DETERMINISTA fijo por marca: el texto histórico
 * de `MARCAS_DOCUMENTO`, nunca el valor que hoy tenga configurado Ajustes
 * (que puede haber cambiado desde entonces).
 */
export function construirDocumentoComercial(c: DatosDocumento): DocumentoComercial {
  const emisor = normalizarDocumentoEmisor(c.documentoEmisor);
  const marca = MARCAS_DOCUMENTO[emisor];
  return {
    emisor,
    marca,
    codigo: c.codigo,
    fechaEmision: c.fechaEmision,
    fechaVencimiento: c.fechaVencimiento,
    cliente: c.clienteNombre,
    atencionNombre: textoOpcional(c.atencionNombre),
    atencionCargo: textoOpcional(c.atencionCargo),
    saludo: textoOpcional(c.mensajeComercial) ?? marca.saludo,
    lineas: lineasComerciales(c),
    incluyeIva: c.incluyeIva,
    encabezadoPrecio: encabezadoPrecio(c.incluyeIva),
    moneda: c.moneda,
    condiciones: condicionesComerciales(c),
    condicionesCredito: textoOpcional(c.condicionesCredito),
    observaciones: lineasDeTexto(c.observaciones),
    cierre: textoOpcional(c.cierreComercial) ?? marca.cierre,
  };
}

/** COT-000123-KuiqTrans.pdf / COT-000123-Monaco.pdf — solo ASCII seguro; sin cliente ni datos internos. */
export function nombreArchivoCotizacionPdf(codigo: string, emisor: unknown): string {
  const base = String(codigo).replace(/[^A-Za-z0-9_-]/g, "") || "COTIZACION";
  return `${base}-${MARCAS_DOCUMENTO[normalizarDocumentoEmisor(emisor)].archivo}.pdf`;
}
