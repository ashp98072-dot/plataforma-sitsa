import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { estiloAlertaKm, kmPendienteServicio } from "./alertas-km";
import {
  estiloAlertaKm as estiloCompatible,
  kmPendienteServicio as kmCompatible,
  generarPlantillaFlota,
  parsearExcelFlota,
} from "./import-excel";
import { KM_INTERVALO_SERVICIO_DEFAULT } from "./constants";

describe("alertas de kilometraje: contrato conservado", () => {
  it.each([
    [124000, 120000, 5000, 1000],
    [125000, 120000, 5000, 0],
    [126000, 120000, 5000, -1000],
    [1000, null, 5000, 4000],
    [null, 120000, 5000, null],
    [null, null, 5000, null],
    [0, null, 5000, 5000],
    [124000, 120000, 10000, 6000],
    [130000, 120000, 10000, 0],
    [131000, 120000, 10000, -1000],
    [120000, 120000, 0, 0],
    [119000, 120000, 5000, 6000],
    [124000.5, 120000, 5000, 999.5],
  ])("actual=%s, último=%s, intervalo=%s => %s", (actual, ultimo, intervalo, esperado) => {
    expect(kmPendienteServicio(actual, ultimo, intervalo!)).toBe(esperado);
  });

  it("conserva el default del caller sin introducir un nuevo default en el helper", () => {
    expect(KM_INTERVALO_SERVICIO_DEFAULT).toBe(5000);
    expect(kmPendienteServicio(124000, 120000, KM_INTERVALO_SERVICIO_DEFAULT)).toBe(1000);
  });

  it.each([
    [null, "bg-slate-700 text-slate-200", "Sin datos", "Sin datos"],
    [-1000, "bg-red-900/50 text-red-200 border border-red-700", `Vencido (${(1000).toLocaleString("es-GT")} km)`, "Servicio vencido"],
    [0, "bg-red-900/50 text-red-200 border border-red-700", "Vencido (0 km)", "Servicio vencido"],
    [1, "bg-red-900/40 text-red-200 border border-red-700", "Faltan 1 km", "Crítico"],
    [500, "bg-red-900/40 text-red-200 border border-red-700", "Faltan 500 km", "Crítico"],
    [500.5, "bg-amber-900/40 text-amber-200 border border-amber-700", `Faltan ${(500.5).toLocaleString("es-GT")} km`, "Próximo servicio"],
    [1500, "bg-amber-900/40 text-amber-200 border border-amber-700", `Faltan ${(1500).toLocaleString("es-GT")} km`, "Próximo servicio"],
    [1501, "bg-emerald-900/40 text-emerald-200 border border-emerald-700", `Faltan ${(1501).toLocaleString("es-GT")} km`, "Al día"],
  ] as const)("pendiente=%s conserva texto, footer y clases exactas", (pendiente, badge, texto, footer) => {
    expect(estiloAlertaKm(pendiente)).toEqual({ badge, texto, footer });
  });

  it("mantiene los exports existentes como las mismas funciones", () => {
    expect(kmCompatible).toBe(kmPendienteServicio);
    expect(estiloCompatible).toBe(estiloAlertaKm);
  });

  it("el módulo ligero no importa dependencias y Flota deja de importar import-excel", () => {
    const ligero = readFileSync(new URL("./alertas-km.ts", import.meta.url), "utf8");
    const cliente = readFileSync(new URL("../../app/e/[slug]/flota/flota-client.tsx", import.meta.url), "utf8");
    expect(ligero).not.toMatch(/\bimport\s|\brequire\s*\(/);
    expect(cliente).toContain('from "@/lib/flota/alertas-km"');
    expect(cliente).not.toContain('from "@/lib/flota/import-excel"');
  });

  it("ExcelJS sigue generando y leyendo la plantilla real de Flota", async () => {
    const buffer = await generarPlantillaFlota();
    expect(buffer.subarray(0, 2).toString()).toBe("PK");
    const filas = await parsearExcelFlota(buffer);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      placa: "C-034BXR",
      kmActual: 125000,
      kmIntervalo: 5000,
      kmUltimoServicio: 120000,
      marca: "Fuso",
      modelo: "2024",
    });
  });
});
