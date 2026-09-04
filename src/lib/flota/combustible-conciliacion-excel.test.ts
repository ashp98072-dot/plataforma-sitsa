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
});