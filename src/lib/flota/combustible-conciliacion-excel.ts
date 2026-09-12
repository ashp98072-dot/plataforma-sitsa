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

/**
 * BUGFIX PRODUCCIÓN (CONTROL DE VALES MONACO S.A.) — columnas como GLS
 * pueden contener fórmulas de Excel (ej. `C6 = B6 / E6`). ExcelJS no
 * entrega esas celdas como number/string: entrega un objeto
 * `{ formula, result }` (o `{ sharedFormula, result }` para fórmulas
 * compartidas), donde `result` es el valor que Excel calculó la última
 * vez que se guardó el archivo.
 *
 * NUNCA evaluamos la fórmula nosotros — solo leemos ese `result` ya
 * cacheado por ExcelJS. Si la celda es una fórmula sin `result`
 * disponible, se devuelve `null` de forma segura (nunca se inventa un
 * valor); el resto del pipeline (normalizarVale/normalizarFechaExcel/
 * textoCelda/normalizarProducto/numeroSeguro) ya sabe tratar `null` como
 * vacío/inválido.
 *
 * Cualquier otro valor (número, string, Date, o el objeto `{ text, ... }`
 * de rich text/hyperlink que textoCelda() ya sabe interpretar) se
 * devuelve tal cual, sin tocarlo.
 */
function valorEfectivoCelda(valor: unknown): unknown {
  if (valor != null && typeof valor === "object") {
    const obj = valor as Record<string, unknown>;

    if ("formula" in obj || "sharedFormula" in obj) {
      return "result" in obj ? obj.result : null;
    }
  }

  return valor;
}

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

  // valorEfectivoCelda() desenvuelve celdas de fórmula ANTES de que el
  // valor llegue a normalizarVale/normalizarFechaExcel/textoCelda/
  // normalizarProducto/numeroSeguro — este es el único punto por el que
  // pasan las 5 columnas de datos en parsearFila().
  return valorEfectivoCelda(row.getCell(columna).value);
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

/** Fecha (ISO "YYYY-MM-DD") más reciente entre las filas válidas, o `null` si el arreglo viene vacío. Comparación por string funciona porque el formato ISO ordena lexicográficamente igual que cronológicamente. */
function fechaMaximaDeFilas(
  filas: CargaGasolineraConciliacion[],
): string | null {
  let maxima: string | null = null;

  for (const fila of filas) {
    if (fila.fechaConsumo && (maxima == null || fila.fechaConsumo > maxima)) {
      maxima = fila.fechaConsumo;
    }
  }

  return maxima;
}

type HojaCandidata = {
  hoja: ExcelJS.Worksheet;
  filas: CargaGasolineraConciliacion[];
  descartadas: ResultadoLecturaExcelCombustible["descartadas"];
  fechaMaxima: string | null;
};

/** Candidata que sí puede competir por "fecha más reciente" (regla 6: ya tiene al menos una fila válida con fecha). */
type HojaCandidataConFecha = HojaCandidata & { fechaMaxima: string };

/**
 * BUGFIX PRODUCCIÓN (CONTROL DE VALES MONACO S.A.) — el archivo real
 * trae varias hojas históricas con encabezados válidos (una por mes/año:
 * "01 - 2025", ..., "2026"). Elegir la PRIMERA hoja compatible (como
 * hacía este archivo antes) podía seleccionar un mes viejo en vez del
 * período vigente. No podemos depender de un nombre fijo como "2026"
 * porque el año cambia cada vez.
 *
 * Estrategia: se escanean y parsean TODAS las hojas con encabezados
 * válidos, y se elige la que tenga la FECHA DE CONSUMO máxima entre sus
 * filas válidas — desempate por más filas válidas, y si aún empata, por
 * orden del workbook (determinista: solo se reemplaza `mejor` cuando la
 * candidata es estrictamente mejor). Una hoja con encabezados válidos
 * pero CERO filas válidas nunca puede ganar.
 */
export async function leerReporteCombustibleGasolinera(
  contenido: Buffer,
): Promise<ResultadoLecturaExcelCombustible> {
  const workbook = new ExcelJS.Workbook();

  const arrayBuffer = contenido.buffer.slice(
    contenido.byteOffset,
    contenido.byteOffset + contenido.byteLength,
  ) as ArrayBuffer;

  await workbook.xlsx.load(arrayBuffer);

  // Regla 6: una hoja sin ninguna fila válida nunca puede GANAR la
  // selección frente a otra que sí tenga filas válidas — pero si al
  // final NINGUNA hoja tiene filas válidas (regla 7), se sigue
  // devolviendo la primera hoja con encabezados válidos (con filas: []),
  // exactamente como antes de este fix, para que el error visible al
  // usuario ("El Excel no contiene filas válidas para conciliar.", ya
  // manejado aguas arriba en la ruta) no cambie.
  let mejor: HojaCandidataConFecha | null = null;
  let primeraConEncabezados: HojaCandidata | null = null;

  for (const hoja of workbook.worksheets) {
    const maxFilasARevisar = Math.min(
      hoja.rowCount,
      25,
    );

    let filaEncabezado = 0;
    let columnas: MapaColumnas | null = null;

    for (let fila = 1; fila <= maxFilasARevisar; fila += 1) {
      const row = hoja.getRow(fila);
      const posibleMapa = construirMapaColumnas(row);

      if (posibleMapa) {
        filaEncabezado = fila;
        columnas = posibleMapa;
        break;
      }
    }

    // Esta hoja no tiene los encabezados requeridos — no es candidata.
    if (!columnas) {
      continue;
    }

    const filas: CargaGasolineraConciliacion[] = [];
    const descartadas: ResultadoLecturaExcelCombustible["descartadas"] = [];

    for (
      let fila = filaEncabezado + 1;
      fila <= hoja.rowCount;
      fila += 1
    ) {
      const row = hoja.getRow(fila);

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

    const fechaMaxima = fechaMaximaDeFilas(filas);

    const candidata: HojaCandidata = {
      hoja,
      filas,
      descartadas,
      fechaMaxima,
    };

    if (!primeraConEncabezados) {
      primeraConEncabezados = candidata;
    }

    // Sin filas válidas (o sin ninguna fecha válida entre ellas): no
    // puede competir por fecha más reciente — regla 6.
    if (filas.length === 0 || !fechaMaxima) {
      continue;
    }

    const candidataConFecha: HojaCandidataConFecha = {
      ...candidata,
      fechaMaxima,
    };

    if (
      !mejor ||
      candidataConFecha.fechaMaxima > mejor.fechaMaxima ||
      (candidataConFecha.fechaMaxima === mejor.fechaMaxima &&
        candidataConFecha.filas.length > mejor.filas.length)
    ) {
      mejor = candidataConFecha;
    }
  }

  // Si ninguna hoja tuvo filas válidas, se cae a la primera con
  // encabezados válidos (regla 7 — mismo comportamiento que antes de
  // este fix). Si NINGUNA hoja tuvo siquiera encabezados válidos, se
  // mantiene el error ya existente.
  const elegida = mejor ?? primeraConEncabezados;

  if (!elegida) {
    throw new Error(
      `No se encontró una hoja con las columnas requeridas: ${ENCABEZADOS_REQUERIDOS.join(
        ", ",
      )}.`,
    );
  }

  return {
    hoja: elegida.hoja.name,
    // Los descartados corresponden SOLO a la hoja finalmente
    // seleccionada, nunca a las demás hojas históricas escaneadas.
    filas: elegida.filas,
    descartadas: elegida.descartadas,
  };
}