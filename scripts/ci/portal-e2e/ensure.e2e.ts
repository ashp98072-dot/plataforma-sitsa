import { describe, it } from "vitest";
import { asegurarSchemaFlota } from "../../../src/lib/flota/schema";
import { asegurarSchemaEmpleados } from "../../../src/lib/rrhh/empleados-schema";

// Crea, con el código REAL de la aplicación y en la base desechable, las tablas/columnas que el proyecto crea en tiempo de ejecución (RRHH, flota/TMS).
describe("esquema de tiempo de ejecución", () => {
  it("asegurarSchemaEmpleados() y asegurarSchemaFlota()", async () => { await asegurarSchemaEmpleados(); await asegurarSchemaFlota(); });
});
