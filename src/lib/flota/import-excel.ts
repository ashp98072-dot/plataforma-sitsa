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
};

function cellStr(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
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
 * Parsea el Excel "FLOTA 2026 GRUPO SITSA…"
 * Columnas esperadas: CREDITO, Unidades (placa), Descripcion, Marca, Modelo, Color,
 * Status SAT, Estatus de propiedad, Empresa, NIT, Seguros, Situacion…
 */
export async function parsearExcelFlota(
  buffer: Buffer,
): Promise<FilaFlotaExcel[]> {
  const wb = new ExcelJS.Workbook();
  // exceljs types accept Buffer
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);

  const preferidas = ["GENERAL", "ACTIVOS", "Hoja1"];
  let ws =
    preferidas.map((n) => wb.getWorksheet(n)).find(Boolean) ??
    wb.worksheets[0];
  if (!ws) return [];

  // Buscar fila de encabezados
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
      vals.some((v) => v.includes("marca"))
    ) {
      headerRow = r;
      break;
    }
    headerMap.clear();
  }

  if (headerMap.size === 0) {
    // fallback columnas fijas del archivo SITSA (fila 2)
    headerRow = 2;
    const row = ws.getRow(headerRow);
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      const h = normalizeHeader(cellStr(cell.value));
      if (h) headerMap.set(h, col);
    });
  }

  const col = (...names: string[]) => {
    for (const n of names) {
      const c = headerMap.get(normalizeHeader(n));
      if (c) return c;
    }
    // partial match
    for (const [k, c] of headerMap) {
      if (names.some((n) => k.includes(normalizeHeader(n)))) return c;
    }
    return 0;
  };

  const cPlaca = col("unidades", "placa", "unidad");
  const cDesc = col("descripcion", "descripción");
  const cMarca = col("marca");
  const cModelo = col("modelo");
  const cColor = col("color");
  const cStatus = col("status sat", "status", "estatus sat");
  const cProp = col("estatus de propiedad", "condicion", "propiedad");
  const cEmp = col("empresa");
  const cNit = col("nit");
  const cCred = col("credito", "crédito");
  const cSeg = col("seguros");
  const cSit = col("situacion", "situación", "notas", "observaciones");

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
    const activo = !/inactivo/i.test(status);

    out.push({
      placa,
      descripcion: cDesc ? cellStr(row.getCell(cDesc).value) || null : null,
      marca: cMarca ? cellStr(row.getCell(cMarca).value) || null : null,
      modelo: cModelo ? cellStr(row.getCell(cModelo).value) || null : null,
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
    });
  }

  return out;
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
