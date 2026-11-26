import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  leerReporteCombustibleGasolinera,
} from "./combustible-conciliacion-excel";

async function crearLibroConFilas(
  filas: unknown[][],
  nombreHoja = "2026",
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const hoja = workbook.addWorksheet(nombreHoja);

  for (const fila of filas) {
    hoja.addRow(fila);
  }

  const contenido = await workbook.xlsx.writeBuffer();

  return Buffer.from(contenido);
}

describe("leerReporteCombustibleGasolinera", () => {
  it("detecta la hoja aunque no se llame 2026", async () => {
    const buffer = await crearLibroConFilas(
      [
        ["REPORTE DE COMBUSTIBLE"],
        [],
        [
          "VALE No.",
          "FECHA DE CONSUMO",
          "No. de Placas",
          "NOMBRE DEL PILOTO",
          "PRODUCTO",
          "GLS",
          "PRECIO",
          "MONTO",
        ],
        [
          4334,
          "04/09/2026",
          "035 BXR",
          "Marvin Xol",
          "Diesel",
          7.15,
          43.69,
          312.38,
        ],
      ],
      "Septiembre",
    );

    const resultado = await leerReporteCombustibleGasolinera(buffer);

    expect(resultado.hoja).toBe("Septiembre");
    expect(resultado.filas).toHaveLength(1);
  });

  it("mapea una fila válida del reporte", async () => {
    const buffer = await crearLibroConFilas([
      [
        "VALE No.",
        "FECHA DE CONSUMO",
        "No. de Placas",
        "NOMBRE DEL PILOTO",
        "PRODUCTO",
        "GLS",
        "PRECIO",
        "MONTO",
      ],
      [
        4334,
        "04/09/2026",
        "035 BXR",
        "Marvin Xol",
        "Diesel",
        7.15,
        43.69,
        312.38,
      ],
    ]);

    const resultado = await leerReporteCombustibleGasolinera(buffer);

    expect(resultado.filas).toEqual([
      {
        fila: 2,
        numeroVale: "4334",
        fechaConsumo: "2026-09-04",
        placa: "035 BXR",
        pilotoNombre: "Marvin Xol",
        producto: "diesel",
        galones: 7.15,
        precioGalon: 43.69,
        monto: 312.38,
      },
    ]);
  });

  it("conserva galones con 3 decimales", async () => {
    const buffer = await crearLibroConFilas([
      [
        "VALE No.",
        "FECHA DE CONSUMO",
        "No. de Placas",
        "NOMBRE DEL PILOTO",
        "PRODUCTO",
        "GLS",
        "PRECIO",
        "MONTO",
      ],
      [2291, "04/09/2026", "034 BXR", "Kevin Gudiel", "Diesel", 5.098, 43.69, 222.73],
      [4334, "04/09/2026", "035 BXR", "Marvin Xol", "Diesel", 7.15, 43.69, 312.38],
      [4001, "04/09/2026", "475 BVD", "Alvaro Pinto", "Diesel", 13.248, 43.69, 578.81],
    ]);

    const resultado = await leerReporteCombustibleGasolinera(buffer);

    expect(resultado.filas.map((f) => f.galones)).toEqual([
      5.098,
      7.15,
      13.248,
    ]);
  });

  it("acepta fecha Excel como Date", async () => {
    const buffer = await crearLibroConFilas([
      [
        "VALE No.",
        "FECHA DE CONSUMO",
        "No. de Placas",
        "PRODUCTO",
        "GLS",
        "PRECIO",
        "MONTO",
      ],
      [
        4334,
        new Date(Date.UTC(2026, 8, 4)),
        "035 BXR",
        "Diesel",
        7.15,
        43.69,
        312.38,
      ],
    ]);

    const resultado = await leerReporteCombustibleGasolinera(buffer);

    expect(resultado.filas[0].fechaConsumo).toBe("2026-09-04");
  });

  it("NOMBRE DEL PILOTO es opcional para procesar la fila", async () => {
    const buffer = await crearLibroConFilas([
      [
        "VALE No.",
        "FECHA DE CONSUMO",
        "No. de Placas",
        "PRODUCTO",
        "GLS",
        "PRECIO",
        "MONTO",
      ],
      [
        4334,
        "04/09/2026",
        "035 BXR",
        "Diesel",
        7.15,
        43.69,
        312.38,
      ],
    ]);

    const resultado = await leerReporteCombustibleGasolinera(buffer);

    expect(resultado.filas).toHaveLength(1);
    expect(resultado.filas[0].pilotoNombre).toBeNull();
  });

  it("descarta una fila con vale vacío", async () => {
    const buffer = await crearLibroConFilas([
      [
        "VALE No.",
        "FECHA DE CONSUMO",
        "No. de Placas",
        "PRODUCTO",
        "GLS",
        "PRECIO",
        "MONTO",
      ],
      [
        "",
        "04/09/2026",
        "035 BXR",
        "Diesel",
        7.15,
        43.69,
        312.38,
      ],
    ]);

    const resultado = await leerReporteCombustibleGasolinera(buffer);

    expect(resultado.filas).toHaveLength(0);
    expect(resultado.descartadas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fila: 2,
          motivo: "Vale vacío.",
        }),
      ]),
    );
  });

  it("descarta una fila con fecha imposible", async () => {
    const buffer = await crearLibroConFilas([
      [
        "VALE No.",
        "FECHA DE CONSUMO",
        "No. de Placas",
        "PRODUCTO",
        "GLS",
        "PRECIO",
        "MONTO",
      ],
      [
        4334,
        "31/02/2026",
        "035 BXR",
        "Diesel",
        7.15,
        43.69,
        312.38,
      ],
    ]);

    const resultado = await leerReporteCombustibleGasolinera(buffer);

    expect(resultado.filas).toHaveLength(0);
    expect(resultado.descartadas[0]).toEqual({
      fila: 2,
      motivo: "Fecha de consumo inválida o vacía.",
    });
  });

  it("descarta una fila con placa vacía", async () => {
    const buffer = await crearLibroConFilas([
      [
        "VALE No.",
        "FECHA DE CONSUMO",
        "No. de Placas",
        "PRODUCTO",
        "GLS",
        "PRECIO",
        "MONTO",
      ],
      [
        4334,
        "04/09/2026",
        "",
        "Diesel",
        7.15,
        43.69,
        312.38,
      ],
    ]);

    const resultado = await leerReporteCombustibleGasolinera(buffer);

    expect(resultado.filas).toHaveLength(0);
    expect(resultado.descartadas[0].motivo).toBe("Placa vacía.");
  });

  it("descarta producto desconocido", async () => {
    const buffer = await crearLibroConFilas([
      [
        "VALE No.",
        "FECHA DE CONSUMO",
        "No. de Placas",
        "PRODUCTO",
        "GLS",
        "PRECIO",
        "MONTO",
      ],
      [
        4334,
        "04/09/2026",
        "035 BXR",
        "GLP",
        7.15,
        43.69,
        312.38,
      ],
    ]);

    const resultado = await leerReporteCombustibleGasolinera(buffer);

    expect(resultado.filas).toHaveLength(0);
    expect(resultado.descartadas[0].motivo).toBe(
      "Producto no reconocido.",
    );
  });

  it("descarta galones inválidos", async () => {
    const buffer = await crearLibroConFilas([
      [
        "VALE No.",
        "FECHA DE CONSUMO",
        "No. de Placas",
        "PRODUCTO",
        "GLS",
        "PRECIO",
        "MONTO",
      ],
      [
        4334,
        "04/09/2026",
        "035 BXR",
        "Diesel",
        "abc",
        43.69,
        312.38,
      ],
    ]);

    const resultado = await leerReporteCombustibleGasolinera(buffer);

    expect(resultado.filas).toHaveLength(0);
    expect(resultado.descartadas[0].motivo).toBe(
      "Galones inválidos.",
    );
  });

  it("descarta precio inválido", async () => {
    const buffer = await crearLibroConFilas([
      [
        "VALE No.",
        "FECHA DE CONSUMO",
        "No. de Placas",
        "PRODUCTO",
        "GLS",
        "PRECIO",
        "MONTO",
      ],
      [
        4334,
        "04/09/2026",
        "035 BXR",
        "Diesel",
        7.15,
        0,
        312.38,
      ],
    ]);

    const resultado = await leerReporteCombustibleGasolinera(buffer);

    expect(resultado.filas).toHaveLength(0);
    expect(resultado.descartadas[0].motivo).toBe(
      "Precio inválido.",
    );
  });

  it("descarta monto inválido", async () => {
    const buffer = await crearLibroConFilas([
      [
        "VALE No.",
        "FECHA DE CONSUMO",
        "No. de Placas",
        "PRODUCTO",
        "GLS",
        "PRECIO",
        "MONTO",
      ],
      [
        4334,
        "04/09/2026",
        "035 BXR",
        "Diesel",
        7.15,
        43.69,
        "abc",
      ],
    ]);

    const resultado = await leerReporteCombustibleGasolinera(buffer);

    expect(resultado.filas).toHaveLength(0);
    expect(resultado.descartadas[0].motivo).toBe(
      "Monto inválido.",
    );
  });

  it("ignora filas de TOTAL/SALDO/PAGOS", async () => {
    const buffer = await crearLibroConFilas([
      [
        "VALE No.",
        "FECHA DE CONSUMO",
        "No. de Placas",
        "PRODUCTO",
        "GLS",
        "PRECIO",
        "MONTO",
      ],
      [4334, "04/09/2026", "035 BXR", "Diesel", 7.15, 43.69, 312.38],
      ["TOTAL", "", "", "", "", "", 312.38],
    ]);

    const resultado = await leerReporteCombustibleGasolinera(buffer);

    expect(resultado.filas).toHaveLength(1);

    expect(resultado.descartadas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fila: 3,
          motivo: "Fila de total/saldo/pagos.",
        }),
      ]),
    );
  });

  it("encuentra encabezados aunque existan filas antes", async () => {
    const buffer = await crearLibroConFilas([
      ["CONTROL DE VALES MONACO S.A."],
      ["REPORTE DE COMBUSTIBLE"],
      [],
      [
        "VALE No.",
        "FECHA DE CONSUMO",
        "No. de Placas",
        "NOMBRE DEL PILOTO",
        "PRODUCTO",
        "GLS",
        "PRECIO",
        "MONTO",
      ],
      [
        4334,
        "04/09/2026",
        "035 BXR",
        "Marvin Xol",
        "Diesel",
        7.15,
        43.69,
        312.38,
      ],
    ]);

    const resultado = await leerReporteCombustibleGasolinera(buffer);

    expect(resultado.filas).toHaveLength(1);
    expect(resultado.filas[0].fila).toBe(5);
  });

  it("rechaza archivo sin las columnas requeridas", async () => {
    const buffer = await crearLibroConFilas([
      ["NOMBRE", "EDAD", "DIRECCION"],
      ["Juan", 20, "Guatemala"],
    ]);

    await expect(
      leerReporteCombustibleGasolinera(buffer),
    ).rejects.toThrow(
      "No se encontró una hoja con las columnas requeridas",
    );
  });

  it("si hay varias hojas, selecciona la que contiene el reporte válido", async () => {
    const workbook = new ExcelJS.Workbook();

    const portada = workbook.addWorksheet("Portada");
    portada.addRow(["CONTROL DE VALES"]);

    const reporte = workbook.addWorksheet("Reporte");
    reporte.addRow([
      "VALE No.",
      "FECHA DE CONSUMO",
      "No. de Placas",
      "PRODUCTO",
      "GLS",
      "PRECIO",
      "MONTO",
    ]);

    reporte.addRow([
      4001,
      "04/09/2026",
      "475 BVD",
      "Diesel",
      13.248,
      43.69,
      578.81,
    ]);

    const contenido = Buffer.from(
      await workbook.xlsx.writeBuffer(),
    );

    const resultado = await leerReporteCombustibleGasolinera(
      contenido,
    );

    expect(resultado.hoja).toBe("Reporte");
    expect(resultado.filas).toHaveLength(1);
    expect(resultado.filas[0].numeroVale).toBe("4001");
  });

  // BUGFIX PRODUCCIÓN (CONTROL DE VALES MONACO S.A.) — PROBLEMA 1:
  // celdas con fórmulas (ej. GLS = B/E). ExcelJS entrega esas celdas
  // como { formula, result }, nunca como number/string directamente.
  describe("celdas con fórmulas de Excel (result cacheado por ExcelJS)", () => {
    it("GLS como fórmula con result numérico produce una fila válida", async () => {
      const workbook = new ExcelJS.Workbook();
      const hoja = workbook.addWorksheet("2026");

      hoja.addRow([
        "VALE No.",
        "FECHA DE CONSUMO",
        "No. de Placas",
        "PRODUCTO",
        "GLS",
        "PRECIO",
        "MONTO",
      ]);
      hoja.addRow([
        4334,
        "04/09/2026",
        "035 BXR",
        "Diesel",
        // GLS real: C6 = B6 / E6 — ExcelJS nunca entrega esto como number.
        { formula: "B6/E6", result: 18.701 },
        43.69,
        312.38,
      ]);

      const contenido = Buffer.from(await workbook.xlsx.writeBuffer());
      const resultado = await leerReporteCombustibleGasolinera(contenido);

      expect(resultado.filas).toHaveLength(1);
      expect(resultado.filas[0].galones).toBe(18.701);
      expect(resultado.descartadas).toHaveLength(0);
    });

    it("monto/precio/vale como formula result numérico también se parsean", async () => {
      const workbook = new ExcelJS.Workbook();
      const hoja = workbook.addWorksheet("2026");

      hoja.addRow([
        "VALE No.",
        "FECHA DE CONSUMO",
        "No. de Placas",
        "PRODUCTO",
        "GLS",
        "PRECIO",
        "MONTO",
      ]);
      hoja.addRow([
        { formula: "=A1", result: 4334 },
        "04/09/2026",
        "035 BXR",
        "Diesel",
        7.15,
        { formula: "=E6/D6", result: 43.69 },
        { formula: "=E6*F6", result: 312.38 },
      ]);

      const contenido = Buffer.from(await workbook.xlsx.writeBuffer());
      const resultado = await leerReporteCombustibleGasolinera(contenido);

      expect(resultado.filas).toEqual([
        expect.objectContaining({
          numeroVale: "4334",
          precioGalon: 43.69,
          monto: 312.38,
        }),
      ]);
    });

    it("fórmula sin result cacheado se descarta de forma segura (nunca inventa un valor)", async () => {
      const workbook = new ExcelJS.Workbook();
      const hoja = workbook.addWorksheet("2026");

      hoja.addRow([
        "VALE No.",
        "FECHA DE CONSUMO",
        "No. de Placas",
        "PRODUCTO",
        "GLS",
        "PRECIO",
        "MONTO",
      ]);
      hoja.addRow([
        4334,
        "04/09/2026",
        "035 BXR",
        "Diesel",
        // Fórmula sin `result` (caso límite / archivo corrupto): no debe
        // inventarse un valor de galones.
        { formula: "B6/E6" },
        43.69,
        312.38,
      ]);

      const contenido = Buffer.from(await workbook.xlsx.writeBuffer());
      const resultado = await leerReporteCombustibleGasolinera(contenido);

      expect(resultado.filas).toHaveLength(0);
      expect(resultado.descartadas[0].motivo).toBe("Galones inválidos.");
    });
  });

  // BUGFIX PRODUCCIÓN (CONTROL DE VALES MONACO S.A.) — PROBLEMA 2:
  // selección de hoja por FECHA DE CONSUMO más reciente, no por la
  // primera hoja compatible ni por un nombre fijo como "2026".
  describe("selección de hoja: la de fecha de consumo más reciente gana", () => {
    it("con hojas '2025' y '2026' válidas, se elige '2026' (fecha más reciente) e incluye la fila con GLS por fórmula", async () => {
      const workbook = new ExcelJS.Workbook();

      const hoja2025 = workbook.addWorksheet("2025");
      hoja2025.addRow([
        "VALE No.",
        "FECHA DE CONSUMO",
        "No. de Placas",
        "PRODUCTO",
        "GLS",
        "PRECIO",
        "MONTO",
      ]);
      hoja2025.addRow([
        1001,
        "30/12/2025",
        "035 BXR",
        "Diesel",
        7.15,
        43.69,
        312.38,
      ]);

      const hoja2026 = workbook.addWorksheet("2026");
      hoja2026.addRow([
        "VALE No.",
        "FECHA DE CONSUMO",
        "No. de Placas",
        "PRODUCTO",
        "GLS",
        "PRECIO",
        "MONTO",
      ]);
      hoja2026.addRow([
        2002,
        "05/01/2026",
        "475 BVD",
        "Diesel",
        { formula: "B2/E2", result: 13.248 },
        43.69,
        578.81,
      ]);

      const contenido = Buffer.from(await workbook.xlsx.writeBuffer());
      const resultado = await leerReporteCombustibleGasolinera(contenido);

      expect(resultado.hoja).toBe("2026");
      expect(resultado.filas).toHaveLength(1);
      expect(resultado.filas[0].numeroVale).toBe("2002");
      expect(resultado.filas[0].galones).toBe(13.248);
    });

    it("no depende del nombre de hoja: entre 'Enero2027' (vieja) y 'Reporte' (más reciente) gana la de fecha más reciente", async () => {
      const workbook = new ExcelJS.Workbook();

      const vieja = workbook.addWorksheet("Enero2027");
      vieja.addRow([
        "VALE No.",
        "FECHA DE CONSUMO",
        "No. de Placas",
        "PRODUCTO",
        "GLS",
        "PRECIO",
        "MONTO",
      ]);
      vieja.addRow([1, "10/01/2027", "035 BXR", "Diesel", 7.15, 43.69, 312.38]);

      const nueva = workbook.addWorksheet("Reporte");
      nueva.addRow([
        "VALE No.",
        "FECHA DE CONSUMO",
        "No. de Placas",
        "PRODUCTO",
        "GLS",
        "PRECIO",
        "MONTO",
      ]);
      nueva.addRow([2, "20/02/2027", "475 BVD", "Diesel", 13.248, 43.69, 578.81]);

      const contenido = Buffer.from(await workbook.xlsx.writeBuffer());
      const resultado = await leerReporteCombustibleGasolinera(contenido);

      expect(resultado.hoja).toBe("Reporte");
      expect(resultado.filas[0].numeroVale).toBe("2");
    });

    it("hoja vieja con MÁS filas válidas pierde contra hoja nueva con MENOS filas pero fecha más reciente", async () => {
      const workbook = new ExcelJS.Workbook();

      const vieja = workbook.addWorksheet("01 - 2025");
      vieja.addRow([
        "VALE No.",
        "FECHA DE CONSUMO",
        "No. de Placas",
        "PRODUCTO",
        "GLS",
        "PRECIO",
        "MONTO",
      ]);
      for (let i = 0; i < 5; i += 1) {
        vieja.addRow([
          `V${i}`,
          "15/01/2025",
          "035 BXR",
          "Diesel",
          7.15,
          43.69,
          312.38,
        ]);
      }

      const nueva = workbook.addWorksheet("2026");
      nueva.addRow([
        "VALE No.",
        "FECHA DE CONSUMO",
        "No. de Placas",
        "PRODUCTO",
        "GLS",
        "PRECIO",
        "MONTO",
      ]);
      nueva.addRow([
        9001,
        "05/01/2026",
        "475 BVD",
        "Diesel",
        13.248,
        43.69,
        578.81,
      ]);

      const contenido = Buffer.from(await workbook.xlsx.writeBuffer());
      const resultado = await leerReporteCombustibleGasolinera(contenido);

      expect(resultado.hoja).toBe("2026");
      expect(resultado.filas).toHaveLength(1);
      expect(resultado.filas[0].numeroVale).toBe("9001");
    });

    it("una hoja con encabezados válidos pero SIN filas válidas nunca gana frente a otra que sí tiene filas válidas", async () => {
      const workbook = new ExcelJS.Workbook();

      const vacia = workbook.addWorksheet("2026-borrador");
      vacia.addRow([
        "VALE No.",
        "FECHA DE CONSUMO",
        "No. de Placas",
        "PRODUCTO",
        "GLS",
        "PRECIO",
        "MONTO",
      ]);
      // Fila inválida (vale vacío) — 0 filas válidas en esta hoja.
      vacia.addRow(["", "05/01/2026", "475 BVD", "Diesel", 13.248, 43.69, 578.81]);

      const conDatos = workbook.addWorksheet("01 - 2025");
      conDatos.addRow([
        "VALE No.",
        "FECHA DE CONSUMO",
        "No. de Placas",
        "PRODUCTO",
        "GLS",
        "PRECIO",
        "MONTO",
      ]);
      conDatos.addRow([1001, "15/01/2025", "035 BXR", "Diesel", 7.15, 43.69, 312.38]);

      const contenido = Buffer.from(await workbook.xlsx.writeBuffer());
      const resultado = await leerReporteCombustibleGasolinera(contenido);

      // Aunque "2026-borrador" tiene fecha más reciente en su fila
      // descartada, no puede ganar porque no tiene NINGUNA fila válida.
      expect(resultado.hoja).toBe("01 - 2025");
      expect(resultado.filas).toHaveLength(1);
    });

    it("los descartados devueltos corresponden SOLO a la hoja finalmente elegida, no a las demás hojas históricas", async () => {
      const workbook = new ExcelJS.Workbook();

      const vieja = workbook.addWorksheet("2025");
      vieja.addRow([
        "VALE No.",
        "FECHA DE CONSUMO",
        "No. de Placas",
        "PRODUCTO",
        "GLS",
        "PRECIO",
        "MONTO",
      ]);
      // Fila descartada en la hoja vieja — NO debe aparecer en el
      // resultado final.
      vieja.addRow(["", "15/01/2025", "035 BXR", "Diesel", 7.15, 43.69, 312.38]);
      vieja.addRow([1, "16/01/2025", "035 BXR", "Diesel", 7.15, 43.69, 312.38]);

      const nueva = workbook.addWorksheet("2026");
      nueva.addRow([
        "VALE No.",
        "FECHA DE CONSUMO",
        "No. de Placas",
        "PRODUCTO",
        "GLS",
        "PRECIO",
        "MONTO",
      ]);
      nueva.addRow([2, "05/01/2026", "475 BVD", "Diesel", 13.248, 43.69, 578.81]);
      // Fila descartada en la hoja ganadora — SÍ debe aparecer.
      nueva.addRow(["", "06/01/2026", "475 BVD", "Diesel", 13.248, 43.69, 578.81]);

      const contenido = Buffer.from(await workbook.xlsx.writeBuffer());
      const resultado = await leerReporteCombustibleGasolinera(contenido);

      expect(resultado.hoja).toBe("2026");
      expect(resultado.descartadas).toHaveLength(1);
      expect(resultado.descartadas[0].motivo).toBe("Vale vacío.");
    });
  });
});