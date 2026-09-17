import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { etiquetaConceptoFiscal } from "./page";

/**
 * RRHH-PRESTACIONES-CODIGO-CONCEPTO (UI) — `page.tsx` es un client component
 * con hooks (`"use client"`); este repo no tiene harness de render de React
 * (ver vitest.config.mts: environment "node", solo incluye *.test.ts). Se
 * sigue el mismo patrón que programacion/importar/page.test.ts: función pura
 * exportada se prueba directo, el resto se verifica contra el código fuente
 * crudo (source-guard).
 */

const src = readFileSync(join(__dirname, "page.tsx"), "utf-8");

function cuerpoDeFuncion(nombre: string): string {
  const regex = new RegExp(`function ${nombre}\\([^)]*\\)[^{]*\\{([\\s\\S]*?)\\n  \\}`);
  return src.match(regex)?.[1] ?? "";
}

describe("etiquetaConceptoFiscal (función pura)", () => {
  it("4. histórico NULL muestra 'Sin clasificar'", () => {
    expect(etiquetaConceptoFiscal(null)).toBe("Sin clasificar");
  });

  it("usa la etiqueta humana del catálogo compartido para un código asignado", () => {
    expect(etiquetaConceptoFiscal("BONO_14")).toBe("Bono 14");
  });
});

describe("creación requiere concepto fiscal", () => {
  it("1. onSubmit bloquea el guardado si no hay codigoConcepto y no se está editando", () => {
    const cuerpo = cuerpoDeFuncion("onSubmit");
    expect(cuerpo).toMatch(/if\s*\(!editandoId\s*&&\s*!codigoConcepto\)/);
    expect(cuerpo).toMatch(/setMsg\(["'].*concepto fiscal.*["']\)/i);
  });
});

describe("POST/PATCH incluyen codigoConcepto solo cuando hay selección", () => {
  it("2. el body inicial NO incluye codigoConcepto directamente", () => {
    const cuerpo = cuerpoDeFuncion("onSubmit");
    const bodyLiteral = cuerpo.match(/const body: Record<string, unknown> = (\{[^}]*\});/)?.[1] ?? "";
    expect(bodyLiteral).not.toMatch(/codigoConcepto/);
  });

  it("5 y 6. codigoConcepto se agrega al body condicionalmente (if truthy), nunca incondicional", () => {
    const cuerpo = cuerpoDeFuncion("onSubmit");
    expect(cuerpo).toMatch(/if\s*\(codigoConcepto\)\s*body\.codigoConcepto\s*=\s*codigoConcepto;/);
  });

  it("7. nunca se envía codigoConcepto: null en el body (solo aparece en comentarios explicativos)", () => {
    // Regex exige que "null" cierre un literal de objeto (coma o llave), para
    // no confundir el comentario "// ... codigoConcepto: null — si no hay..."
    // con una asignación real de código.
    expect(src).not.toMatch(/codigoConcepto:\s*null\s*[,}]/);
  });
});

describe("edición carga codigoConcepto existente", () => {
  it("3. editar() setea codigoConcepto desde row.codigoConcepto, con fallback a ''", () => {
    const cuerpo = cuerpoDeFuncion("editar");
    expect(cuerpo).toMatch(/setCodigoConcepto\(row\.codigoConcepto\s*\?\?\s*""\)/);
  });

  it("12. editar() nunca deriva codigoConcepto de row.tipo (sin inferencia)", () => {
    const cuerpo = cuerpoDeFuncion("editar");
    const lineaCodigo = cuerpo.match(/setCodigoConcepto\([^)]*\)/)?.[0] ?? "";
    expect(lineaCodigo).not.toMatch(/row\.tipo/);
    expect(lineaCodigo).not.toMatch(/esCatalogo/);
  });
});

describe("placeholder dinámico 'Sin clasificar (histórico)'", () => {
  it("4. el placeholder distingue edición de histórico NULL vs. creación nueva", () => {
    expect(src).toMatch(
      /editandoId\s*&&\s*codigoConcepto\s*===\s*""\s*\?\s*"Sin clasificar \(histórico\)"\s*:\s*"Seleccionar concepto fiscal"/,
    );
  });
});

describe("cancelar edición limpia estado", () => {
  it("8. cancelarEdicion() resetea codigoConcepto a ''", () => {
    const cuerpo = cuerpoDeFuncion("cancelarEdicion");
    expect(cuerpo).toMatch(/setCodigoConcepto\(""\)/);
  });

  it("8b. onSubmit también resetea codigoConcepto tras guardar con éxito", () => {
    const cuerpo = cuerpoDeFuncion("onSubmit");
    const bloqueExito = cuerpo.match(/if\s*\(res\.ok\)\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    expect(bloqueExito).toMatch(/setCodigoConcepto\(""\)/);
  });
});

describe("listado muestra concepto fiscal", () => {
  it("9. cada fila del listado renderiza 'Concepto fiscal: ' con etiquetaConceptoFiscal(r.codigoConcepto)", () => {
    expect(src).toMatch(/Concepto fiscal:\s*\{etiquetaConceptoFiscal\(r\.codigoConcepto\)\}/);
  });
});

describe("catálogo UI proviene del helper compartido", () => {
  it("10. importa CODIGOS_CONCEPTO_PRESTACION y ETIQUETAS_CODIGO_CONCEPTO_PRESTACION desde @/lib/rrhh/prestaciones", () => {
    expect(src).toMatch(
      /import\s*\{\s*CODIGOS_CONCEPTO_PRESTACION,\s*ETIQUETAS_CODIGO_CONCEPTO_PRESTACION,\s*type CodigoConceptoPrestacion,?\s*\}\s*from\s*"@\/lib\/rrhh\/prestaciones";/,
    );
  });

  it("10b. no redefine localmente el arreglo de códigos (sin duplicar el catálogo)", () => {
    expect(src).not.toMatch(/const\s+CODIGOS_CONCEPTO_PRESTACION\s*=/);
  });

  it("10c. el <select> de concepto fiscal mapea directamente sobre el catálogo importado", () => {
    expect(src).toMatch(/CODIGOS_CONCEPTO_PRESTACION\.map\(\(codigo\)\s*=>/);
  });
});

describe("no toca catalogos-nomina.ts", () => {
  it("11. sigue importando TIPOS_DEVENGADO desde catalogos-nomina.ts sin reemplazarlo", () => {
    expect(src).toMatch(/import\s*\{\s*TIPOS_DEVENGADO\s*\}\s*from\s*"@\/lib\/rrhh\/catalogos-nomina";/);
  });
});

describe("no acopla tipo <-> codigoConcepto", () => {
  it("12b. no hay lógica de inferencia tipo -> codigoConcepto en todo el archivo (sin heurísticas de texto)", () => {
    expect(src).not.toMatch(/tipo\.includes\(/);
    expect(src).not.toMatch(/codigoConcepto\s*=\s*tipo/);
  });
});
