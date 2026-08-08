/**
 * Definición del cuestionario de facturación.
 * Cada empresa y cada cliente pueden responder distinto.
 * Las respuestas se guardan como { [preguntaId]: valor }.
 */

export type TipoCampo =
  | "texto"
  | "textarea"
  | "si_no"
  | "opcion"
  | "multi"
  | "numero";

export type PreguntaFacturacion = {
  id: string;
  etiqueta: string;
  ayuda?: string;
  tipo: TipoCampo;
  opciones?: { value: string; label: string }[];
  requerido?: boolean;
};

export type SeccionFacturacion = {
  id: string;
  titulo: string;
  descripcion?: string;
  preguntas: PreguntaFacturacion[];
};

/** Cómo factura ESTA empresa (KT, Mónaco, Francisco, Tarimas…). */
export const CUESTIONARIO_EMPRESA: SeccionFacturacion[] = [
  {
    id: "emisor",
    titulo: "1. Datos del emisor",
    descripcion: "Cómo está constituida y registrada la empresa que factura.",
    preguntas: [
      {
        id: "razon_social_factura",
        etiqueta: "Razón social / nombre que sale en la factura",
        tipo: "texto",
        requerido: true,
      },
      {
        id: "nit_emisor",
        etiqueta: "NIT del emisor",
        tipo: "texto",
        requerido: true,
      },
      {
        id: "nombre_comercial",
        etiqueta: "Nombre comercial (si difiere)",
        tipo: "texto",
      },
      {
        id: "direccion_fiscal",
        etiqueta: "Dirección fiscal",
        tipo: "textarea",
      },
      {
        id: "regimen",
        etiqueta: "Régimen / tipo de contribuyente",
        tipo: "opcion",
        opciones: [
          { value: "general", label: "Régimen general" },
          { value: "pequeño", label: "Pequeño contribuyente" },
          { value: "otro", label: "Otro / especial" },
        ],
      },
      {
        id: "usa_fel",
        etiqueta: "¿Emite facturas electrónicas (FEL)?",
        tipo: "si_no",
        requerido: true,
      },
      {
        id: "certificador_fel",
        etiqueta: "Certificador FEL / proveedor actual",
        tipo: "texto",
        ayuda: "Ej. Infile, Digifact, Megaprint…",
      },
    ],
  },
  {
    id: "proceso",
    titulo: "2. Proceso interno de facturación",
    preguntas: [
      {
        id: "quien_factura",
        etiqueta: "¿Quién emite / autoriza las facturas?",
        tipo: "texto",
        ayuda: "Cargo o nombre del área (Contabilidad, Operaciones…)",
        requerido: true,
      },
      {
        id: "cuando_factura",
        etiqueta: "¿Cuándo se factura?",
        tipo: "opcion",
        opciones: [
          { value: "por_viaje", label: "Por viaje / servicio" },
          { value: "semanal", label: "Corte semanal" },
          { value: "quincenal", label: "Corte quincenal" },
          { value: "mensual", label: "Corte mensual" },
          { value: "pedido", label: "Por pedido / OC" },
          { value: "mixto", label: "Depende del cliente" },
        ],
        requerido: true,
      },
      {
        id: "documento_base",
        etiqueta: "¿Con qué documento se respalda la factura?",
        tipo: "multi",
        opciones: [
          { value: "plan_viaje", label: "Plan / orden de viaje (TMS)" },
          { value: "remision", label: "Remisión / guía" },
          { value: "evidencia", label: "Evidencia de entrega" },
          { value: "oc", label: "Orden de compra del cliente" },
          { value: "contrato", label: "Contrato / tarifa pactada" },
          { value: "otro", label: "Otro" },
        ],
      },
      {
        id: "sistema_actual",
        etiqueta: "¿En qué sistema facturan hoy?",
        tipo: "opcion",
        opciones: [
          { value: "excel", label: "Excel / manual" },
          { value: "fel_web", label: "Portal FEL del certificador" },
          { value: "conta_externa", label: "Sistema contable externo" },
          { value: "otro", label: "Otro" },
        ],
      },
      {
        id: "moneda",
        etiqueta: "Moneda habitual",
        tipo: "opcion",
        opciones: [
          { value: "GTQ", label: "Quetzales (GTQ)" },
          { value: "USD", label: "Dólares (USD)" },
          { value: "ambas", label: "Ambas" },
        ],
      },
      {
        id: "incluye_iva",
        etiqueta: "¿Los precios de tarifa ya incluyen IVA?",
        tipo: "si_no",
      },
    ],
  },
  {
    id: "cobro",
    titulo: "3. Cobro y crédito",
    preguntas: [
      {
        id: "formas_pago_aceptadas",
        etiqueta: "Formas de pago que aceptan",
        tipo: "multi",
        opciones: [
          { value: "transferencia", label: "Transferencia" },
          { value: "cheque", label: "Cheque" },
          { value: "efectivo", label: "Efectivo" },
          { value: "tarjeta", label: "Tarjeta" },
          { value: "otro", label: "Otro" },
        ],
      },
      {
        id: "credito_default_dias",
        etiqueta: "Días de crédito por defecto (si aplica)",
        tipo: "numero",
      },
      {
        id: "cuenta_bancaria_cobro",
        etiqueta: "Cuenta(s) bancaria(s) donde reciben pagos",
        tipo: "textarea",
      },
      {
        id: "retenciones",
        etiqueta: "¿Les retienen ISR / IVA algunos clientes?",
        tipo: "si_no",
      },
      {
        id: "notas_empresa",
        etiqueta: "Notas / excepciones de esta empresa",
        tipo: "textarea",
        ayuda: "Cualquier regla especial que debamos modelar después.",
      },
    ],
  },
];

/** Cómo se factura a UN cliente concreto (puede diferir del default de la empresa). */
export const CUESTIONARIO_CLIENTE: SeccionFacturacion[] = [
  {
    id: "receptor",
    titulo: "1. Datos de facturación del cliente",
    preguntas: [
      {
        id: "razon_social_cliente",
        etiqueta: "Razón social a facturar",
        tipo: "texto",
        requerido: true,
      },
      {
        id: "nit_cliente",
        etiqueta: "NIT a facturar",
        tipo: "texto",
        requerido: true,
      },
      {
        id: "direccion_factura",
        etiqueta: "Dirección que debe aparecer en la factura",
        tipo: "textarea",
      },
      {
        id: "correo_factura",
        etiqueta: "Correo(s) para envío de factura FEL",
        tipo: "texto",
      },
      {
        id: "contacto_cxc",
        etiqueta: "Contacto de cuentas por pagar / CxC",
        tipo: "texto",
      },
      {
        id: "telefono_cxc",
        etiqueta: "Teléfono del contacto CxC",
        tipo: "texto",
      },
    ],
  },
  {
    id: "reglas",
    titulo: "2. Reglas de facturación con este cliente",
    preguntas: [
      {
        id: "frecuencia",
        etiqueta: "Frecuencia de facturación",
        tipo: "opcion",
        opciones: [
          { value: "por_viaje", label: "Por viaje / servicio" },
          { value: "semanal", label: "Semanal" },
          { value: "quincenal", label: "Quincenal" },
          { value: "mensual", label: "Mensual" },
          { value: "oc", label: "Solo con OC" },
          { value: "otra", label: "Otra" },
        ],
        requerido: true,
      },
      {
        id: "requiere_oc",
        etiqueta: "¿Exige orden de compra antes de facturar?",
        tipo: "si_no",
      },
      {
        id: "requiere_evidencia",
        etiqueta: "¿Exige evidencia / POD firmado?",
        tipo: "si_no",
      },
      {
        id: "descripcion_factura",
        etiqueta: "Texto / descripción que piden en la factura",
        tipo: "textarea",
        ayuda: "Ej. ruta, contenedor, # viaje, referencia interna…",
      },
      {
        id: "tarifa_tipo",
        etiqueta: "Tipo de tarifa",
        tipo: "opcion",
        opciones: [
          { value: "fija_ruta", label: "Fija por ruta" },
          { value: "por_km", label: "Por kilómetro" },
          { value: "por_viaje", label: "Por viaje / viaje redondo" },
          { value: "por_peso", label: "Por peso / tonelada" },
          { value: "por_unidad", label: "Por unidad / tarima / bulto" },
          { value: "contrato", label: "Contrato / tabla especial" },
          { value: "otro", label: "Otro" },
        ],
      },
      {
        id: "moneda_cliente",
        etiqueta: "Moneda de facturación",
        tipo: "opcion",
        opciones: [
          { value: "GTQ", label: "GTQ" },
          { value: "USD", label: "USD" },
          { value: "segun_servicio", label: "Según servicio" },
        ],
      },
      {
        id: "dias_credito",
        etiqueta: "Días de crédito",
        tipo: "numero",
      },
      {
        id: "retiene",
        etiqueta: "¿Este cliente retiene impuestos?",
        tipo: "si_no",
      },
      {
        id: "centro_costo",
        etiqueta: "Centro de costo / cuenta interna (si usan)",
        tipo: "texto",
      },
      {
        id: "notas_cliente",
        etiqueta: "Notas especiales de este cliente",
        tipo: "textarea",
      },
    ],
  },
];

export type RespuestasFacturacion = Record<string, string | string[] | number | boolean | null>;

export function aplanarPreguntas(
  secciones: SeccionFacturacion[],
): PreguntaFacturacion[] {
  return secciones.flatMap((s) => s.preguntas);
}

export function pctCompletado(
  secciones: SeccionFacturacion[],
  respuestas: RespuestasFacturacion,
): number {
  const req = aplanarPreguntas(secciones).filter((p) => p.requerido);
  if (!req.length) {
    const all = aplanarPreguntas(secciones);
    if (!all.length) return 0;
    const llenas = all.filter((p) => valorLleno(respuestas[p.id])).length;
    return Math.round((llenas / all.length) * 100);
  }
  const ok = req.filter((p) => valorLleno(respuestas[p.id])).length;
  return Math.round((ok / req.length) * 100);
}

function valorLleno(v: RespuestasFacturacion[string] | undefined): boolean {
  if (v == null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (typeof v === "number") return !Number.isNaN(v);
  if (typeof v === "boolean") return true;
  if (Array.isArray(v)) return v.length > 0;
  return false;
}
