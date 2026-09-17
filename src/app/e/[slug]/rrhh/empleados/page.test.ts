import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * RRHH-EMPLEADOS-LISTADO-STALE — `page.tsx` es un client component con
 * hooks ("use client"); este repo no tiene harness de render de React (ver
 * vitest.config.mts: environment "node", solo incluye *.test.ts). Se sigue
 * el mismo patrón "source-guard" ya usado en
 * rrhh/prestaciones/page.test.ts y programacion/importar/page.test.ts:
 * readFileSync + aserciones por regex contra el código fuente crudo.
 *
 * Bug confirmado en producción: tras editar la ficha de un empleado
 * (ej. codigo/dpi 3287850831608, Wilson Leonardo Bá Caal) a
 * fecha_inicio_laboral/fecha_alta = 2025-05-01, la BD quedaba correcta pero
 * el listado seguía mostrando el valor viejo hasta hacer F5. La causa era
 * que ni el GET del listado ni el fetch de cargar() pedían explícitamente
 * "sin caché" — ver también route.test.ts del mismo endpoint.
 */

const src = readFileSync(join(__dirname, "page.tsx"), "utf-8");

function cuerpoDeFuncion(nombre: string): string {
  const regex = new RegExp(`function ${nombre}\\([^)]*\\)[^{]*\\{([\\s\\S]*?)\\n  \\}`);
  return src.match(regex)?.[1] ?? "";
}

/** `cargar`/`cargarSupervisores` son `const x = useCallback(async () => {...}, [deps]);`, no declaraciones `function`. */
function cuerpoDeCallback(nombre: string): string {
  const regex = new RegExp(`const ${nombre} = useCallback\\(async \\(\\) => \\{([\\s\\S]*?)\\n  \\}, \\[`);
  return src.match(regex)?.[1] ?? "";
}

describe("cargar() pide datos sin caché", () => {
  it("el fetch de cargar() al listado usa cache: 'no-store'", () => {
    const cuerpo = cuerpoDeCallback("cargar");
    expect(cuerpo).toMatch(/`\/api\/empresas\/\$\{slug\}\/empleados\?\$\{params\.toString\(\)\}`/);
    expect(cuerpo).toMatch(/\{\s*cache:\s*"no-store",?\s*\}/);
  });

  it("conserva el comportamiento de filtros: q/tipoContrato/formaPago/estado siguen construyendo la query", () => {
    const cuerpo = cuerpoDeCallback("cargar");
    expect(cuerpo).toMatch(/params\.set\("q", qDebounced\.trim\(\)\)/);
    expect(cuerpo).toMatch(/params\.set\("tipoContrato", filtroTipo\)/);
    expect(cuerpo).toMatch(/params\.set\("formaPago", filtroPago\)/);
    expect(cuerpo).toMatch(/params\.set\("estado", filtroEstado\)/);
  });
});

describe("después de guardar (onSubmit) se recarga desde el servidor", () => {
  it("onSubmit llama a cargar() tras un guardado exitoso (fuente de verdad = servidor, no optimistic update)", () => {
    const cuerpo = cuerpoDeFuncion("onSubmit");
    expect(cuerpo).toMatch(/await cargar\(\);/);
    // No debe reescribir `empleados` a mano con datos locales del form
    // antes/después de cargar() -- la única fuente para la tabla es la
    // respuesta del GET.
    expect(cuerpo).not.toMatch(/setEmpleados\(/);
  });
});

describe("listado: columnas Entrada lab. / Contratación", () => {
  it("'Entrada lab.' renderiza fechaInicioLaboral vía formatearFechaVisible", () => {
    expect(src).toMatch(/formatearFechaVisible\(e\.fechaInicioLaboral\)/);
  });

  it("'Contratación' renderiza fechaAlta vía formatearFechaVisible", () => {
    expect(src).toMatch(/formatearFechaVisible\(e\.fechaAlta\)/);
  });

  it("ambas columnas existen en el <thead> con esos encabezados", () => {
    expect(src).toMatch(/<th className="px-3 py-2">Entrada lab\.<\/th>/);
    expect(src).toMatch(/<th className="px-3 py-2">Contratación<\/th>/);
  });
});

describe("no afecta edición de licencia, supervisor, horarios, estado ni expediente", () => {
  it("licencia: los campos licenciaNumero/licenciaTipo/licenciaVence siguen en FormState y patchForm", () => {
    expect(src).toMatch(/licenciaNumero: string;/);
    expect(src).toMatch(/licenciaTipo: LicenciaTipo;/);
    expect(src).toMatch(/licenciaVence: string;/);
    expect(src).toMatch(/patchForm\(\{ licenciaNumero: e\.target\.value \}\)/);
  });

  it("supervisor: cargarSupervisores() y supervisorIds siguen presentes sin cambios", () => {
    expect(src).toMatch(/const cargarSupervisores = useCallback/);
    expect(src).toMatch(/supervisorIds: number\[\];/);
  });

  it("horarios: horaEntradaTeorica/horaSalidaTeorica siguen en el formulario", () => {
    expect(src).toMatch(/patchForm\(\{ horaEntradaTeorica: e\.target\.value \}\)/);
    expect(src).toMatch(/patchForm\(\{ horaSalidaTeorica: e\.target\.value \}\)/);
  });

  it("estado: el selector Activo/Baja sigue presente sin cambios", () => {
    expect(src).toMatch(/<option value="Activo">Activo<\/option>/);
    expect(src).toMatch(/<option value="Baja">Baja \/ Inactivo<\/option>/);
  });

  it("expediente: DocumentosModal sigue montado con docsEmp, sin cambios de props", () => {
    expect(src).toMatch(/<DocumentosModal\s*\n\s*slug=\{slug\}\s*\n\s*empleadoId=\{docsEmp\.id\}/);
  });
});
