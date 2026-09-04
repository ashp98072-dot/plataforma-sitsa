import ExcelJS from "exceljs";
import {
  normalizarFechaExcel,
  normalizarProducto,
  normalizarVale,
  numeroSeguro,
  type CargaGasolineraConciliacion,
} from "./combustible-conciliacion";

export type ResultadoLecturaExcelCombustible = {
  hoja: string;
  filas: CargaGasolineraConciliacion[];
  descartadas: Array<{
    fila: number;
    motivo: string;
  }>;
};

const ENCABEZADOS_REQUERIDOS = [
  "VALE",
  "FECHA",
  "PLACAS",
  "PRODUCTO",
  "GLS",
  "PRECIO",
  "MONTO",
] as const;

function textoCelda(valor: unknown): string {
  if (valor == null) return "";

  if (typeof valor === "string") return valor.trim();

  if (typeof valor === "number") return String(valor);

  if (valor instanceof Date) {
    return valor.toISOString();
  }

  if (
    typeof valor === "object" &&
    valor !== null &&
    "text" in valor &&
    typeof (valor as { text?: unknown }).text === "string"
  ) {
    return String((valor as { text: string }).text).trim();
  }

  return String(valor).trim();
}

function normalizarEncabezado(valor: unknown): string {
  return textoCelda(valor)
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

type MapaColumnas = {
  vale: number;
  fecha: number;
  placa: number;
  piloto: number | null;
  producto: number;
  galones: number;
  precio: number;
  monto: number;
};

function buscarColumna(
  encabezados: Map<number, string>,
  candidatos: string[],
): number | null {
  for (const [columna, encabezado] of encabezados.entries()) {
    if (candidatos.some((candidato) => encabezado.includes(candidato))) {
      return columna;
    }
  }

  return null;
}

function construirMapaColumnas(
  row: ExcelJS.Row,
): MapaColumnas | null {
  const encabezados = new Map<number, string>();

  row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    encabezados.set(colNumber, normalizarEncabezado(cell.value));
  });

  const vale = buscarColumna(encabezados, [
    "VALE NO",
    "VALE N",
    "VALE",
  ]);

  const fecha = buscarColumna(encabezados, [
    "FECHA DE CONSUMO",
    "FECHA CONSUMO",
    "FECHA",
  ]);

  const placa = buscarColumna(encabezados, [
    "NO. DE PLACAS",
    "NO DE PLACAS",
    "PLACAS",
    "PLACA",
  ]);

  const piloto = buscarColumna(encabezados, [
    "NOMBRE DEL PILOTO",
    "PILOTO",
  ]);

  const producto = buscarColumna(encabezados, [
    "PRODUCTO",
  ]);

  const galones = buscarColumna(encabezados, [
    "GLS",
    "GALONES",
  ]);

  const precio = buscarColumna(encabezados, [
    "PRECIO",
  ]);

  const monto = buscarColumna(encabezados, [
    "MONTO",
    "TOTAL",
  ]);

  if (
    vale == null ||
    fecha == null ||
    placa == null ||
    producto == null ||
    galones == null ||
    precio == null ||
    monto == null
  ) {
    return null;
  }

  return {
    vale,
    fecha,
    placa,
    piloto,
    producto,
    galones,
    precio,
    monto,
  };
}

function filaPareceTotal(row: ExcelJS.Row): boolean {
  const textos: string[] = [];

  row.eachCell({ includeEmpty: false }, (cell) => {
    textos.push(normalizarEncabezado(cell.value));
  });

  return textos.some(
    (t) =>
      t === "TOTAL" ||
      t.startsWith("TOTAL ") ||
      t.includes("SALDO") ||
      t.includes("PAGOS"),
  );
}

function obtenerValorCelda(
  row: ExcelJS.Row,
  columna: number | null,
): unknown {
  if (columna == null) return null;

  return row.getCell(columna).value;
}

function parsearFila(
  row: ExcelJS.Row,
  columnas: MapaColumnas,
): {
  carga: CargaGasolineraConciliacion | null;
  motivo?: string;
} {
  if (filaPareceTotal(row)) {
    return {
      carga: null,
      motivo: "Fila de total/saldo/pagos.",
    };
  }

  const numeroVale = normalizarVale(
    obtenerValorCelda(row, columnas.vale),
  );

  const fechaConsumo = normalizarFechaExcel(
    obtenerValorCelda(row, columnas.fecha),
  );

  const placa = textoCelda(
    obtenerValorCelda(row, columnas.placa),
  );

  const pilotoNombreRaw = textoCelda(
    obtenerValorCelda(row, columnas.piloto),
  );

  const producto = normalizarProducto(
    obtenerValorCelda(row, columnas.producto),
  );

  const galones = numeroSeguro(
    obtenerValorCelda(row, columnas.galones),
  );

  const precioGalon = numeroSeguro(
    obtenerValorCelda(row, columnas.precio),
  );

  const monto = numeroSeguro(
    obtenerValorCelda(row, columnas.monto),
  );

  const filaCompletamenteVacia =
    !numeroVale &&
    !fechaConsumo &&
    !placa &&
    !pilotoNombreRaw &&
    !producto &&
    galones == null &&
    precioGalon == null &&
    monto == null;

  if (filaCompletamenteVacia) {
    return {
      carga: null,
      motivo: "Fila vacía.",
    };
  }

  if (!numeroVale) {
    return {
      carga: null,
      motivo: "Vale vacío.",
    };
  }

  if (!fechaConsumo) {
    return {
      carga: null,
      motivo: "Fecha de consumo inválida o vacía.",
    };
  }

  if (!placa) {
    return {
      carga: null,
      motivo: "Placa vacía.",
    };
  }

  if (!producto) {
    return {
      carga: null,
      motivo: "Producto no reconocido.",
    };
  }

  if (galones == null || galones <= 0) {
    return {
      carga: null,
      motivo: "Galones inválidos.",
    };
  }

  if (precioGalon == null || precioGalon <= 0) {
    return {
      carga: null,
      motivo: "Precio inválido.",
    };
  }

  if (monto == null || monto <= 0) {
    return {
      carga: null,
      motivo: "Monto inválido.",
    };
  }

  return {
    carga: {
      fila: row.number,
      numeroVale,
      fechaConsumo,
      placa,
      pilotoNombre: pilotoNombreRaw || null,
      producto,
      galones,
      precioGalon,
      monto,
    },
  };
}

export async function leerReporteCombustibleGasolinera(
  contenido: Buffer,
): Promise<ResultadoLecturaExcelCombustible> {
  const workbook = new ExcelJS.Workbook();

  const arrayBuffer = contenido.buffer.slice(
  contenido.byteOffset,
  contenido.byteOffset + contenido.byteLength,
) as ArrayBuffer;

await workbook.xlsx.load(arrayBuffer);

  let hojaSeleccionada: ExcelJS.Worksheet | null = null;
  let filaEncabezado = 0;
  let columnas: MapaColumnas | null = null;

  for (const hoja of workbook.worksheets) {
    const maxFilasARevisar = Math.min(
      hoja.rowCount,
      25,
    );

    for (let fila = 1; fila <= maxFilasARevisar; fila += 1) {
      const row = hoja.getRow(fila);
      const posibleMapa = construirMapaColumnas(row);

      if (posibleMapa) {
        hojaSeleccionada = hoja;
        filaEncabezado = fila;
        columnas = posibleMapa;
        break;
      }
    }

    if (hojaSeleccionada && columnas) {
      break;
    }
  }

  if (!hojaSeleccionada || !columnas) {
    throw new Error(
      `No se encontró una hoja con las columnas requeridas: ${ENCABEZADOS_REQUERIDOS.join(
        ", ",
      )}.`,
    );
  }

  const filas: CargaGasolineraConciliacion[] = [];
  const descartadas: ResultadoLecturaExcelCombustible["descartadas"] = [];

  for (
    let fila = filaEncabezado + 1;
    fila <= hojaSeleccionada.rowCount;
    fila += 1
  ) {
    const row = hojaSeleccionada.getRow(fila);

    const resultado = parsearFila(
      row,
      columnas,
    );

    if (resultado.carga) {
      filas.push(resultado.carga);
      continue;
    }

    if (resultado.motivo) {
      descartadas.push({
        fila,
        motivo: resultado.motivo,
      });
    }
  }

  return {
    hoja: hojaSeleccionada.name,
    filas,
    descartadas,
  };
}