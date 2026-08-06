/**
 * Alias de la columna "Empresa" del Excel del coordinador → nombre visible + slug/código en plataforma.
 * KT = Kuiqtrans, Mónaco = Logiservicios Mónaco (mismo grupo / camiones compartidos),
 * FSS = Fresco Fresh.
 */
export type EmpresaFlotaResuelta = {
  /** Nombre legible en inventario (empresa_activo) */
  etiqueta: string;
  /** Código corto para badges */
  codigoCorto: string;
  /** Slugs posibles en tabla empresas */
  slugs: string[];
  /** Códigos posibles en tabla empresas */
  codigos: string[];
  /** Si es del grupo que comparte flota KT↔Mónaco↔Fresco */
  grupoCompartido: boolean;
};

const ALIAS: { match: RegExp; info: EmpresaFlotaResuelta }[] = [
  {
    match: /^(kt|kuiq|kuiqtrans|kuiq\s*trans)$/i,
    info: {
      etiqueta: "Kuiqtrans",
      codigoCorto: "KT",
      slugs: ["kt-monaco", "kuiqtrans", "kt"],
      codigos: ["KT", "KUIQTRANS"],
      grupoCompartido: true,
    },
  },
  {
    match: /^(m[oó]naco|logiservicios\s*m[oó]naco|monaco\s*expres)$/i,
    info: {
      etiqueta: "Mónaco",
      codigoCorto: "MÓNACO",
      slugs: ["kt-monaco", "monaco", "logiservicios-monaco"],
      codigos: ["KT", "MONACO", "MÓNACO"],
      grupoCompartido: true,
    },
  },
  {
    match: /^(fss|fresco\s*fresh|frescofresh)$/i,
    info: {
      etiqueta: "Fresco Fresh",
      codigoCorto: "FSS",
      slugs: ["frescofresh", "fresco-fresh", "fss"],
      codigos: ["FRESCOFRESH", "FSS", "FRESCO"],
      grupoCompartido: true,
    },
  },
  {
    match: /^eco(planet)?$/i,
    info: {
      etiqueta: "Ecoplanet",
      codigoCorto: "ECO",
      slugs: ["ecoplanet", "eco"],
      codigos: ["ECOPLANET", "ECO"],
      grupoCompartido: false,
    },
  },
];

/** Normaliza texto del Excel a etiqueta + metadatos. */
export function resolverEmpresaFlotaExcel(
  raw: string | null | undefined,
): EmpresaFlotaResuelta {
  const s = (raw ?? "").trim().replace(/\s+/g, " ");
  if (!s) {
    return {
      etiqueta: "",
      codigoCorto: "",
      slugs: [],
      codigos: [],
      grupoCompartido: false,
    };
  }
  const compact = s.replace(/\s+/g, " ");
  for (const a of ALIAS) {
    if (a.match.test(compact) || a.match.test(compact.replace(/\s/g, ""))) {
      return a.info;
    }
  }
  // Conservar nombre del Excel (ELISA, HEBER SITAN, etc.)
  return {
    etiqueta: compact,
    codigoCorto: compact.slice(0, 12).toUpperCase(),
    slugs: [],
    codigos: [],
    grupoCompartido: false,
  };
}

/** Etiqueta corta para UI. */
export function etiquetaEmpresaVehiculo(opts: {
  empresaActivo?: string | null;
  empresaDuenaNombre?: string | null;
  empresaDuenaCodigo?: string | null;
  compartido?: boolean;
}): string {
  const activo = (opts.empresaActivo ?? "").trim();
  if (activo) {
    const r = resolverEmpresaFlotaExcel(activo);
    return r.etiqueta || activo;
  }
  const duena = (opts.empresaDuenaNombre ?? "").trim();
  if (duena) return duena;
  const cod = (opts.empresaDuenaCodigo ?? "").trim();
  if (cod) {
    const r = resolverEmpresaFlotaExcel(cod);
    return r.etiqueta || cod;
  }
  return opts.compartido ? "Compartida" : "—";
}
