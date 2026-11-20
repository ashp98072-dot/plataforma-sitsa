import { describe, expect, it } from "vitest";
import { errorEliminacionVehiculo } from "./vehiculo-eliminacion";

const fk = (tabla: string, extra: object = {}) => ({
  errno: 1451,
  code: "ER_ROW_IS_REFERENCED_2",
  message: `Cannot delete or update a parent row: a foreign key constraint fails (\`sitsa_prod\`.\`${tabla}\`, CONSTRAINT \`fk_x\` FOREIGN KEY (\`vehiculo_id\`) REFERENCES \`flota_vehiculos\` (\`id\`))`,
  ...extra,
});

describe("errorEliminacionVehiculo", () => {
  it("convierte el rechazo por solicitudes de fondos en un 409 claro y accionable", () => {
    const r = errorEliminacionVehiculo(fk("tms_solicitud_fondo_lineas"))!;
    expect(r.status).toBe(409);
    expect(r.error).toContain("líneas de solicitudes de fondos");
    expect(r.error).toContain("Dar de baja");
    expect(r.error).toContain("Identidades físicas");
  });
  it("no filtra esquema, base de datos ni nombres de restricciones", () => {
    const r = errorEliminacionVehiculo(fk("tms_solicitud_fondo_lineas"))!;
    for (const secreto of ["sitsa_prod", "fk_x", "tms_solicitud_fondo_lineas", "CONSTRAINT"]) expect(r.error).not.toContain(secreto);
  });
  it("usa un texto genérico (también 409) para tablas no catalogadas", () => {
    expect(errorEliminacionVehiculo(fk("tabla_desconocida"))!.error).toContain("otros registros");
  });
  it("detecta también por code cuando falta errno", () => {
    expect(errorEliminacionVehiculo({ code: "ER_ROW_IS_REFERENCED_2", message: "" })?.status).toBe(409);
  });
  it("no oculta otros errores (deben seguir siendo 500): bloqueo, red, FK de otro tipo, null", () => {
    expect(errorEliminacionVehiculo({ errno: 1213, code: "ER_LOCK_DEADLOCK", message: "deadlock" })).toBeNull();
    expect(errorEliminacionVehiculo({ errno: 1452, code: "ER_NO_REFERENCED_ROW_2", message: "" })).toBeNull();
    expect(errorEliminacionVehiculo(new Error("ECONNRESET"))).toBeNull();
    expect(errorEliminacionVehiculo(null)).toBeNull();
    expect(errorEliminacionVehiculo(undefined)).toBeNull();
  });
});
