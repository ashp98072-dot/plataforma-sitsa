import { describe, expect, it } from "vitest";
import { clasificarErrorCalendario, ErrorCalendario } from "./calendario-errores";
describe("Clasificación estricta del calendario sin BD", () => {
  it.each([
    ["ER_DUP_ENTRY", 1062, "unique"], ["ER_LOCK_DEADLOCK", 1213, "deadlock"],
    ["ER_LOCK_WAIT_TIMEOUT", 1205, "timeout"], ["ER_CHECKREAD", 1020, "registro_cambiado"],
    ["HA_ERR_RECORD_CHANGED", 123, "motor_interno"], ["ER_INTERNAL_ERROR", 1815, "motor_interno"],
    ["ER_GET_ERRNO", 1030, "motor_interno"],
    ["ER_NO_REFERENCED_ROW_2", 1452, "inesperado"], ["ER_DUP_ENTRY", 1213, "inesperado"],
  ])("%s/%s se distingue como %s", (code, errno, tipo) => {
    expect(clasificarErrorCalendario({ code, errno, sqlState: "HY000", sql: "privado", message: "privado" }))
      .toEqual({ tipo, code, errno, sqlState: "HY000", statusServicio: undefined });
  });
  it("funcional requiere clase de servicio; textos/estados SQL genéricos no bastan", () => {
    expect(clasificarErrorCalendario(new ErrorCalendario("solape")).tipo).toBe("funcional");
    expect(clasificarErrorCalendario(new ErrorCalendario("ajeno", 404)).tipo).toBe("servicio");
    for (const e of [null, { status: 409 }, new Error("ER_DUP_ENTRY"), { sqlState: "40001" }])
      expect(clasificarErrorCalendario(e).tipo).toBe("inesperado");
  });
});
