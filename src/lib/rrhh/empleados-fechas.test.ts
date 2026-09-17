import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * RRHH-FECHAS-DATE-TIMEZONE — confirma que las columnas DATE de empleados
 * (el caso original reportado: fecha_alta/fecha_inicio_laboral, más
 * fecha_nacimiento/licencia_vence/fecha_egreso) siguen enrutadas por
 * toIsoDate() (ahora corregido en dates.ts) y no por algún otro camino que
 * podría reintroducir el desfase de -1 día. empleados.ts es un archivo
 * grande y `mapEmpleado()` no está exportado — se usa el mismo patrón
 * source-guard ya establecido en el repo en vez de agregar infraestructura
 * de mocking solo para esto.
 */
const src = readFileSync(join(__dirname, "empleados.ts"), "utf-8");

describe("mapEmpleado(): columnas DATE de empleados usan toIsoDate()", () => {
  it("fechaAlta conserva fecha calendario (fecha_alta -> toIsoDate)", () => {
    expect(src).toMatch(/fechaAlta:\s*toIsoDate\(row\.fecha_alta as string \| Date \| null\) \?\? ""/);
  });

  it("fechaInicioLaboral conserva fecha calendario (fecha_inicio_laboral -> toIsoDate)", () => {
    expect(src).toMatch(/fechaInicioLaboral:\s*toIsoDate\(\s*\n\s*row\.fecha_inicio_laboral as string \| Date \| null,\s*\n\s*\)/);
  });

  it("fechaNacimiento no retrocede (fecha_nacimiento -> toIsoDate)", () => {
    expect(src).toMatch(/fechaNacimiento:\s*toIsoDate\(row\.fecha_nacimiento as string \| Date \| null\)/);
  });

  it("licenciaVence no retrocede (licencia_vence -> toIsoDate)", () => {
    expect(src).toMatch(/licenciaVence:\s*toIsoDate\(row\.licencia_vence as string \| Date \| null\)/);
  });

  it("fechaEgreso no retrocede (fecha_egreso -> toIsoDate)", () => {
    expect(src).toMatch(/fechaEgreso:\s*toIsoDate\(row\.fecha_egreso as string \| Date \| null\)/);
  });

  it("ninguna de las 5 columnas usa una conversión de zona horaria distinta (nunca partesEnZona/Intl/toIsoDateDesdeInstante)", () => {
    expect(src).not.toMatch(/fechaAlta:.*partesEnZona/);
    expect(src).not.toMatch(/fechaInicioLaboral:[\s\S]{0,80}toIsoDateDesdeInstante/);
    expect(src).not.toMatch(/toIsoDateDesdeInstante/); // empleados.ts no importa ni usa esta función
  });

  it("empleados.ts importa toIsoDate desde ./dates (fuente única, sin duplicar la conversión)", () => {
    expect(src).toMatch(/import\s*\{\s*toIsoDate,\s*hoyLocal\s*\}\s*from\s*"\.\/dates";/);
  });
});
