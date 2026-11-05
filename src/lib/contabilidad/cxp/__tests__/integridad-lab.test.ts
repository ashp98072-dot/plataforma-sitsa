import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { Connection } from "mysql2/promise";
import { barrera, eliminarPropia, identificador, laboratorio, nuevaIdentidad, sentencias, sha256, validarServidor } from "./integridad-lab";

describe("MIL-CXP-05 guardas offline (sin conexiones)", () => {
  const env = { LIQ_TEST_DB_PORT: "3399", MIL_CXP05_LAB_ID: "qa-desechable-cxp", MIL_CXP05_DATADIR_SHA256: sha256("sintetico") };
  it("exige puerto, autorización identificada y huella antes de conectar", () => {
    for (const e of [{}, { ...env, LIQ_TEST_DB_PORT: "3306" }, { ...env, MIL_CXP05_LAB_ID: "produccion" }, { ...env, MIL_CXP05_DATADIR_SHA256: "" }]) expect(() => laboratorio(e)).toThrow();
    expect(laboratorio({ ...env, DB_HOST: "productivo" }).host).toBe("127.0.0.1");
  });
  it("rechaza otras versiones, otro puerto o directorio", () => {
    const cfg = laboratorio(env);
    expect(() => validarServidor("11.8.9-MariaDB", 3399, "sintetico", cfg)).not.toThrow();
    for (const v of ["11.8.90-MariaDB", "11.8.10-MariaDB", "8.0.0-MySQL"]) expect(() => validarServidor(v, 3399, "sintetico", cfg)).toThrow();
    expect(() => validarServidor("11.8.9-MariaDB", 3407, "sintetico", cfg)).toThrow();
    expect(() => validarServidor("11.8.9-MariaDB", 3399, "ajeno", cfg)).toThrow();
  });
  it("no elimina bases ajenas, no creadas o con marcador incorrecto", async () => {
    const id = nuevaIdentidad();
    expect(identificador(id.db)).toMatch(/^`cxp_qa05_[a-f0-9]{32}`$/);
    expect(() => identificador("sitsa; DROP DATABASE x")).toThrow();
    const query = vi.fn().mockResolvedValue([[{ token: "ajeno" }]]);
    const c = { query } as unknown as Connection;
    expect(await eliminarPropia(c, id, false)).toBe(false);
    expect(query).not.toHaveBeenCalled();
    await expect(eliminarPropia(c, id, true)).rejects.toThrow("eliminación bloqueada");
    expect(query).toHaveBeenCalledTimes(1);
    query.mockResolvedValueOnce([[{ token: id.token }]]);
    expect(await eliminarPropia(c, id, true)).toBe(true);
    expect(query).toHaveBeenLastCalledWith(`DROP DATABASE ${identificador(id.db)}`);
  });
  it("preserva procedimientos y rechaza SQL incompleto", () => {
    expect(sentencias("DELIMITER $$\nCREATE PROCEDURE x() BEGIN\nSELECT 1;\nEND$$\nDELIMITER ;\nCALL x();")).toEqual(["CREATE PROCEDURE x() BEGIN\nSELECT 1;\nEND", "CALL x()"]);
    expect(() => sentencias("SELECT 1")).toThrow("incompleta");
    for (const f of ["migrate-2026-11-cxp-m3a-base.sql", "migrate-2026-11-cxp-m3b1-pagos.sql"]) {
      const statements = sentencias(readFileSync(`sql/${f}`, "utf8"));
      expect(statements.some(s => /BEGIN NOT ATOMIC/.test(s))).toBe(true);
      expect(statements.some(s => /SIGNAL SQLSTATE/.test(s))).toBe(true);
      expect(statements.some(s => /\b(?:DROP DATABASE|USE\s+|SET GLOBAL)/i.test(s.replace(/--[^\n]*/g, "")))).toBe(false);
    }
  });
  it("coordina por señal explícita sin temporizadores", async () => {
    const b = barrera(), events: number[] = [];
    const reader = b.esperar.then(() => events.push(2));
    events.push(1); expect(events).toEqual([1]); b.abrir(); await reader;
    expect(events).toEqual([1, 2]);
  });
});
