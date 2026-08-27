/**
 * Campos obligatorios según cuestionario RRHH Monaco (alta).
 * Foto / expediente se cargan aparte en documentos.
 */
export const CAMPOS_OBLIGATORIOS_ALTA: {
  key: string;
  label: string;
  seccion: "identidad" | "laboral" | "salarios" | "contacto" | "otros";
}[] = [
  { key: "dpi", label: "DPI", seccion: "identidad" },
  { key: "primerNombre", label: "Primer nombre", seccion: "identidad" },
  { key: "primerApellido", label: "Primer apellido", seccion: "identidad" },
  { key: "sexo", label: "Sexo", seccion: "identidad" },
  { key: "fechaNacimiento", label: "Fecha de nacimiento", seccion: "identidad" },
  { key: "codigo", label: "Código (usar DPI)", seccion: "laboral" },
  { key: "puesto", label: "Puesto", seccion: "laboral" },
  { key: "categoriaOps", label: "Área", seccion: "laboral" },
  { key: "tipoContrato", label: "Tipo de contrato", seccion: "laboral" },
  { key: "formaPago", label: "Forma de pago", seccion: "laboral" },
  { key: "profesion", label: "Profesión", seccion: "laboral" },
  { key: "fechaAlta", label: "Fecha de ingreso / contratación", seccion: "laboral" },
  { key: "horaEntradaTeorica", label: "Hora de entrada", seccion: "laboral" },
  { key: "horaSalidaTeorica", label: "Hora de salida", seccion: "laboral" },
  { key: "estado", label: "Estado", seccion: "laboral" },
  { key: "sueldoBase", label: "Sueldo base", seccion: "salarios" },
  { key: "bonoIncentivo", label: "Bonificación incentivo", seccion: "salarios" },
  { key: "bonoHerramientas", label: "Bono de herramientas", seccion: "salarios" },
  { key: "telefono", label: "Teléfono", seccion: "contacto" },
  { key: "direccion", label: "Dirección actual", seccion: "contacto" },
  { key: "paisOrigen", label: "País de origen", seccion: "otros" },
  { key: "municipio", label: "Municipio", seccion: "otros" },
  { key: "etnia", label: "Etnia", seccion: "otros" },
  { key: "religion", label: "Religión", seccion: "otros" },
  { key: "idioma", label: "Idioma", seccion: "otros" },
];

export function valorCampoVacio(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === "number") return !Number.isFinite(v);
  return String(v).trim() === "";
}

/** Devuelve etiquetas de campos faltantes. */
export function faltantesAlta(
  data: Record<string, unknown>,
): { labels: string[]; secciones: Set<string> } {
  const labels: string[] = [];
  const secciones = new Set<string>();
  const outsourcing =
    String(data.tipoContrato ?? "")
      .trim()
      .toLowerCase() === "outsourcing";
  const skipOutsourcing = new Set([
    "igss",
    "irtra",
    "nit",
    "bonoIncentivo",
    "bonoHerramientas",
  ]);
  for (const c of CAMPOS_OBLIGATORIOS_ALTA) {
    if (outsourcing && skipOutsourcing.has(c.key)) continue;
    if (valorCampoVacio(data[c.key])) {
      labels.push(c.label);
      secciones.add(c.seccion);
    }
  }
  const nombre = String(data.nombre ?? "").trim();
  const partes =
    !valorCampoVacio(data.primerNombre) &&
    !valorCampoVacio(data.primerApellido);
  if (!nombre && !partes) {
    labels.push("Nombre completo");
    secciones.add("identidad");
  }
  return { labels, secciones };
}
