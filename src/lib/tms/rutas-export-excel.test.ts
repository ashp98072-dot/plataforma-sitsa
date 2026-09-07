import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { exportarRutasExcel } from "@/lib/tms/rutas-export-excel";
import type { ClienteRuta } from "@/lib/tms/cliente-rutas";

describe("exportación Excel de rutas", () => {
  it("incluye costos, tarifario, personal y viáticos", async () => {
    const ruta = {
      id: 1, clienteId: 2, clienteNombre: "Cliente", codigo: "R-1", nombre: "Ruta",
      ubicacionCargaId: null, lugarCargaTexto: "Bodega", destinoDescripcion: "Destino",
      horaHabitual: "08:00", tarifaReferencia: 1250, costoOperativo: 900,
      contactoClienteId: null, contactoNombre: null, contactoCargo: null, contactoTelefono: null,
      observaciones: null, activo: true, creadoEn: "", actualizadoEn: "", paradas: [],
      personalPredeterminado: [
        { empleadoId: 1, empleadoCodigo: "P-1", empleadoNombre: "Piloto", rol: "Piloto", orden: 1, viaticoMonto: 150 },
        { empleadoId: 2, empleadoCodigo: "A-1", empleadoNombre: "Auxiliar", rol: "Auxiliar", orden: 1, viaticoMonto: 75 },
      ],
    } satisfies ClienteRuta;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await exportarRutasExcel([ruta], "KT") as unknown as ExcelJS.Buffer);
    const ws = wb.getWorksheet("RUTAS")!;
    expect(ws.getRow(3).values).toEqual(expect.arrayContaining(["Costo operativo (Q)", "Tarifario (Q)", "Piloto código"]));
    expect(ws.getCell(4, 8).value).toBe(900);
    expect(ws.getCell(4, 9).value).toBe(1250);
    expect(ws.getCell(4, 10).value).toBe("P-1");
    expect(ws.getCell(4, 12).value).toBe(150);
    expect(ws.getCell(4, 13).value).toBe("A-1");
    expect(ws.getCell(4, 15).value).toBe("75");
  });
});
