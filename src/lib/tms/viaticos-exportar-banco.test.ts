import { describe, expect, it } from "vitest";
import {
  codificarCp1252,
  conceptoViatico,
  generarArchivoBiBanking,
  TIPO_OPERACION_DEFAULT,
  validarParaBiBanking,
  type ProblemaExportBiBanking,
} from "./viaticos-exportar-banco";
import type { ViaticoPorPagar } from "./viaticos";

/**
 * VIATICOS-BANDEJAS-1 (ticket item 14) — cobertura de regresión sobre
 * viaticos-exportar-banco.ts, código PREEXISTENTE que este ticket NO
 * modifica (sección 8 del ticket: "NO cambiar comportamiento de ...
 * Generar archivo bancario"). No tenía pruebas propias todavía.
 *
 * "Sigue sin cambiar estado" se verifica estructuralmente: estas
 * funciones son puras (sin importar @/lib/db, sin `execute`/`query`,
 * sin efectos secundarios) — generar el archivo no puede tocar
 * tms_viaticos.estado porque ni siquiera tiene acceso a la base de
 * datos. validarParaBiBanking() exige AUTORIZADO + cuenta + monto > 0
 * ANTES de poder generar el archivo (mismas 3 reglas ya documentadas).
 */

function fila(overrides: Partial<ViaticoPorPagar> = {}): ViaticoPorPagar {
  return {
    id: 1,
    planId: 10,
    planCodigo: "PLAN-20260824-001",
    fechaPlan: "2026-08-24",
    personalCodigo: "EMP-1",
    personalNombre: "Juan Pérez",
    rol: "Piloto",
    montoAsignado: 250,
    estado: "AUTORIZADO",
    metodoPago: null,
    referenciaPago: null,
    banco: "Banco Industrial",
    tipoCuenta: "Monetaria",
    cuentaBancaria: "1234567890",
    // VIATICOS-PAGO-SNAPSHOT-1 — sin snapshot (fila AUTORIZADA, mostrable = cuenta viva); irrelevante para este archivo, que no toca banco/generarArchivoBiBanking.
    pagoBanco: null,
    pagoCuentaBancaria: null,
    pagoTipoCuenta: null,
    bancoMostrar: "Banco Industrial",
    cuentaBancariaMostrar: "1234567890",
    tipoCuentaMostrar: "Monetaria",
    cuentaHistoricaNoDisponible: false,
    ...overrides,
  };
}

describe("validarParaBiBanking", () => {
  it("14) ok cuando todos están AUTORIZADO, con cuenta y monto > 0 — no depende de ningún cambio de estado", () => {
    const r = validarParaBiBanking([fila()]);
    expect(r.ok).toBe(true);
  });

  it("rechaza un viático que no está AUTORIZADO", () => {
    const r = validarParaBiBanking([fila({ estado: "ENTREGADO" })]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.problemas).toHaveLength(1);
      expect(r.problemas[0].motivo).toContain("AUTORIZADO");
    }
  });

  it("VIATICOS-RECHAZADO-1 (25) — un viático RECHAZADO nunca es exportable al archivo bancario (misma regla que cualquier estado != AUTORIZADO, sin caso especial)", () => {
    const r = validarParaBiBanking([fila({ estado: "RECHAZADO" })]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problemas[0].motivo).toContain("AUTORIZADO");
  });

  it("rechaza un viático AUTORIZADO sin cuenta bancaria", () => {
    const r = validarParaBiBanking([fila({ cuentaBancaria: "" })]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problemas[0].motivo).toContain("cuenta bancaria");
  });

  it("rechaza monto <= 0", () => {
    const r = validarParaBiBanking([fila({ montoAsignado: 0 })]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problemas[0].motivo).toContain("Monto inválido");
  });

  it("reporta TODOS los problemas de la selección, no solo el primero", () => {
    const r = validarParaBiBanking([
      fila({ id: 1, estado: "LIQUIDADO" }),
      fila({ id: 2, cuentaBancaria: "" }),
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const ids = (r.problemas as ProblemaExportBiBanking[]).map((p) => p.id);
      expect(ids).toEqual([1, 2]);
    }
  });
});

describe("generarArchivoBiBanking", () => {
  it("genera exactamente 5 columnas por fila, separador coma, \\r\\n, sin encabezado", () => {
    const contenido = generarArchivoBiBanking([fila()]);
    expect(contenido).toBe(
      `${TIPO_OPERACION_DEFAULT},1234567890,Juan Pérez,250,${conceptoViatico("PLAN-20260824-001")}\r\n`,
    );
  });

  it("no genera nada (string vacío) para una lista vacía", () => {
    expect(generarArchivoBiBanking([])).toBe("");
  });
});

describe("codificarCp1252", () => {
  it("preserva acentos/Ñ (rango Latin-1)", () => {
    const buf = codificarCp1252("PÉREZ ÑÚÑEZ");
    expect(buf.toString("latin1")).toBe("PÉREZ ÑÚÑEZ");
  });
});
