import ExcelJS from "exceljs";

export type FilaFlotaExcel = {
  placa: string;
  descripcion: string | null;
  marca: string | null;
  modelo: string | null;
  color: string | null;
  statusSat: string | null;
  condicionPropiedad: string | null;
  empresaActivo: string | null;
  nit: string | null;
  credito: string | null;
  seguros: string | null;
  notas: string | null;
  activo: boolean;
  kmActual: number | null;
  kmIntervalo: number | null;
  kmUltimoServicio: number | null;
  rinLlanta: string | null;
  medidaLlanta: string | null;
  tipoAceite: string | null;
  tipoCombustible: string | null;
  chasis: string | null;
  capacidad: string | null;
  /** Texto libre: "Aceite:123 | Aire:456" */
  filtros: string | null;
};

export const HEADERS_FLOTA_PLANTILLA = [
  "placa",
  "descripcion",
  "marca",
  "modelo",
  "color",
  "km_actual",
  "km_intervalo",
  "km_ultimo_servicio",
  "rin_llanta",
  "medida_llanta",
  "tipo_aceite",
  "tipo_combustible",
  "chasis",
  "capacidad",
  "filtros",
  "empresa",
  "nit",
  "credito",
  "seguros",
  "condicion_propiedad",
  "status_sat",
  "notas",
  "activo",
] as const;

export async function generarPlantillaFlota(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Vehiculos");
  ws.addRow([...HEADERS_FLOTA_PLANTILLA]);
  ws.getRow(1).font = { bold: true };
  ws.addRow([
    "C-034BXR",
    "Cabezal",
    "Fuso",
    "2024",
    "Blanco",
    "125000",
    "10000",
    "120000",
    "22.5",
    "295/80R22.5",
    "15W40",
    "diesel",
    "",
    "",
    "Aceite:OF-123 | Aire:AF-45",
    "KT Monaco",
    "",
    "",
    "",
    "Propio",
    "Activo",
    "",
    "1",
  ]);
  const help = wb.addWorksheet("Ayuda");
  help.addRow(["Campo", "Notas"]);
  help.getRow(1).font = { bold: true };
  help.addRow(["placa", "Obligatoria. Única por empresa."]);
  help.addRow(["km_intervalo", "Km entre servicios (default 10000)."]);
  help.addRow(["filtros", "Separar con |  →  Tipo:código | Tipo:código"]);
  help.addRow(["activo", "1 / Activo  o  0 / Inactivo"]);
  help.addRow(["tipo_combustible", "diesel / gasolina / gas / eléctrico"]);
  ws.columns = HEADERS_FLOTA_PLANTILLA.map(() => ({ width: 16 }));
  help.columns = [{ width: 20 }, { width: 50 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function cellStr(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "number" && Number.isFinite(v)) {
    return Number.isInteger(v) ? String(v) : String(v).trim();
  }
  if (typeof v === "object") {
    const o = v as {
      result?: unknown;
      text?: string;
      richText?: { text: string }[];
    };
    if (o.result != null) return cellStr(o.result);
    if (typeof o.text === "string") return o.text.trim();
    if (Array.isArray(o.richText)) {
      return o.richText.map((t) => t.text).join("").trim();
    }
  }
  return String(v).trim();
}

function cellNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
  const s = cellStr(v).replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** Si marca trae año al final y modelo vacío: "Fuso 2024" → marca=Fuso, modelo=2024 */
function separarMarcaModelo(
  marcaRaw: string | null,
  modeloRaw: string | null,
): { marca: string | null; modelo: string | null } {
  let marca = marcaRaw?.trim() || null;
  let modelo = modeloRaw?.trim() || null;

  if (modelo && /^\d{4}$/.test(modelo)) {
    // año como modelo: ok
  } else if (
    modelo &&
    marca &&
    /^\d{4}$/.test(marca) &&
    !/^\d{4}$/.test(modelo)
  ) {
    const tmp = marca;
    marca = modelo;
    modelo = tmp;
  }

  if (marca && !modelo) {
    const m = marca.match(/^(.*?)[\s,/-]+(\d{4})$/);
    if (m) {
      marca = m[1].trim() || null;
      modelo = m[2];
    }
  }

  return { marca, modelo };
}

function normalizeHeader(h: string): string {
  return h
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parsea Excel de flota (plantilla nueva o formato legacy SITSA).
 */
export async function parsearExcelFlota(
  buffer: Buffer,
): Promise<FilaFlotaExcel[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);

  const preferidas = ["Vehiculos", "VEHICULOS", "GENERAL", "ACTIVOS", "Hoja1"];
  let ws =
    preferidas.map((n) => wb.getWorksheet(n)).find(Boolean) ??
    wb.worksheets[0];
  if (!ws) return [];

  let headerRow = 1;
  const headerMap = new Map<string, number>();
  for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
    const row = ws.getRow(r);
    const vals: string[] = [];
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      vals.push(normalizeHeader(cellStr(cell.value)));
      headerMap.set(normalizeHeader(cellStr(cell.value)), col);
    });
    if (
      vals.some((v) => v.includes("unidad") || v === "placa") &&
      (vals.some((v) => v.includes("marca")) ||
        vals.some((v) => v.includes("km")))
    ) {
      headerRow = r;
      break;
    }
    headerMap.clear();
  }

  if (headerMap.size === 0) {
    headerRow = 2;
    const row = ws.getRow(headerRow);
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      const h = normalizeHeader(cellStr(cell.value));
      if (h) headerMap.set(h, col);
    });
  }

  const colExact = (...names: string[]) => {
    for (const n of names) {
      const c = headerMap.get(normalizeHeader(n));
      if (c) return c;
    }
    return 0;
  };

  const col = (...names: string[]) => {
    const exact = colExact(...names);
    if (exact) return exact;
    for (const [k, c] of headerMap) {
      if (
        names.some(
          (n) =>
            k === normalizeHeader(n) ||
            k.startsWith(normalizeHeader(n) + " "),
        )
      ) {
        return c;
      }
    }
    for (const [k, c] of headerMap) {
      if (names.some((n) => k.includes(normalizeHeader(n)))) return c;
    }
    return 0;
  };

  const cPlaca =
    colExact("unidades", "placa", "unidad") ||
    col("unidades", "placa", "unidad");
  const cDesc = colExact("descripcion") || col("descripcion", "descripción");
  const cMarca = colExact("marca") || col("marca");
  const cModelo = colExact("modelo") || col("modelo", "año", "anio", "ano");
  const cColor = colExact("color") || col("color");
  const cStatus =
    colExact("status sat", "activo") ||
    col("status sat", "status", "estatus sat", "activo");
  const cProp =
    colExact("estatus de propiedad", "condicion_propiedad") ||
    col("estatus de propiedad", "condicion", "propiedad");
  const cEmp = colExact("empresa") || col("empresa");
  const cNit = colExact("nit") || col("nit");
  const cCred = colExact("credito") || col("credito", "crédito");
  const cSeg = colExact("seguros") || col("seguros");
  const cSit =
    colExact("situacion", "notas") ||
    col("situacion", "situación", "notas", "observaciones");
  const cKm = colExact("km_actual", "km") || col("km_actual", "km actual");
  const cInt =
    colExact("km_intervalo", "intervalo") ||
    col("km_intervalo", "intervalo");
  const cUlt =
    colExact("km_ultimo_servicio", "km_ultimo") ||
    col("km_ultimo_servicio", "ultimo servicio");
  const cRin = colExact("rin_llanta", "rin") || col("rin_llanta", "rin");
  const cMed =
    colExact("medida_llanta", "medida") || col("medida_llanta", "llanta");
  const cAceite =
    colExact("tipo_aceite", "aceite") || col("tipo_aceite", "aceite");
  const cComb =
    colExact("tipo_combustible", "combustible") ||
    col("tipo_combustible", "combustible");
  const cChasis = colExact("chasis") || col("chasis");
  const cCap = colExact("capacidad") || col("capacidad");
  const cFiltros = colExact("filtros") || col("filtros");

  if (!cPlaca) return [];

  const out: FilaFlotaExcel[] = [];
  const seen = new Set<string>();

  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const placa = cellStr(row.getCell(cPlaca).value).toUpperCase();
    if (!placa || placa.length < 3) continue;
    if (seen.has(placa)) continue;
    seen.add(placa);

    const status = cStatus ? cellStr(row.getCell(cStatus).value) : "Activo";
    const activo = !/inactivo|^0$|^no$|false/i.test(status || "Activo");

    const { marca, modelo } = separarMarcaModelo(
      cMarca ? cellStr(row.getCell(cMarca).value) || null : null,
      cModelo ? cellStr(row.getCell(cModelo).value) || null : null,
    );

    out.push({
      placa,
      descripcion: cDesc ? cellStr(row.getCell(cDesc).value) || null : null,
      marca,
      modelo,
      color: cColor ? cellStr(row.getCell(cColor).value) || null : null,
      statusSat: status || null,
      condicionPropiedad: cProp
        ? cellStr(row.getCell(cProp).value) || null
        : null,
      empresaActivo: cEmp ? cellStr(row.getCell(cEmp).value) || null : null,
      nit: cNit ? cellStr(row.getCell(cNit).value) || null : null,
      credito: cCred ? cellStr(row.getCell(cCred).value) || null : null,
      seguros: cSeg ? cellStr(row.getCell(cSeg).value) || null : null,
      notas: cSit ? cellStr(row.getCell(cSit).value) || null : null,
      activo,
      kmActual: cKm ? cellNum(row.getCell(cKm).value) : null,
      kmIntervalo: cInt ? cellNum(row.getCell(cInt).value) : null,
      kmUltimoServicio: cUlt ? cellNum(row.getCell(cUlt).value) : null,
      rinLlanta: cRin ? cellStr(row.getCell(cRin).value) || null : null,
      medidaLlanta: cMed ? cellStr(row.getCell(cMed).value) || null : null,
      tipoAceite: cAceite ? cellStr(row.getCell(cAceite).value) || null : null,
      tipoCombustible: cComb
        ? cellStr(row.getCell(cComb).value) || null
        : null,
      chasis: cChasis ? cellStr(row.getCell(cChasis).value) || null : null,
      capacidad: cCap ? cellStr(row.getCell(cCap).value) || null : null,
      filtros: cFiltros ? cellStr(row.getCell(cFiltros).value) || null : null,
    });
  }

  return out;
}

/** Parsea "Aceite:123 | Aire:456" → filas de filtro. */
export function parsearFiltrosTexto(
  raw: string | null | undefined,
): { tipo: string; codigo: string }[] {
  if (!raw?.trim()) return [];
  return raw
    .split(/[|;]/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const m = p.match(/^([^:]+):\s*(.+)$/);
      if (m) return { tipo: m[1].trim(), codigo: m[2].trim() };
      return { tipo: "Filtro", codigo: p };
    })
    .filter((f) => f.tipo && f.codigo);
}

export function kmPendienteServicio(
  kmActual: number | null,
  kmUltimo: number | null,
  intervalo: number,
): number | null {
  if (kmActual == null) return null;
  const ultimo = kmUltimo ?? 0;
  return intervalo - (kmActual - ultimo);
}

export function estiloAlertaKm(pendiente: number | null): {
  badge: string;
  texto: string;
  footer: string;
} {
  if (pendiente == null) {
    return {
      badge: "bg-slate-700 text-slate-200",
      texto: "Sin datos",
      footer: "Sin datos",
    };
  }
  if (pendiente <= 0) {
    return {
      badge: "bg-red-900/50 text-red-200 border border-red-700",
      texto: `Vencido (${Math.abs(pendiente).toLocaleString("es-GT")} km)`,
      footer: "Servicio vencido",
    };
  }
  const faltan = pendiente.toLocaleString("es-GT");
  if (pendiente <= 500) {
    return {
      badge: "bg-red-900/40 text-red-200 border border-red-700",
      texto: `Faltan ${faltan} km`,
      footer: "Crítico",
    };
  }
  if (pendiente <= 1500) {
    return {
      badge: "bg-amber-900/40 text-amber-200 border border-amber-700",
      texto: `Faltan ${faltan} km`,
      footer: "Próximo servicio",
    };
  }
  return {
    badge: "bg-emerald-900/40 text-emerald-200 border border-emerald-700",
    texto: `Faltan ${faltan} km`,
    footer: "Al día",
  };
}
