import { describe, expect, it } from "vitest";
import {
  CATALOGO_TIPOS_MULTA,
  debeMostrarDescripcionMulta,
  debeMostrarDetalleAdicional,
  labelDeTipoMulta,
  OPCIONES_TIPO_MULTA,
  requiereDetalleAdicional,
  TIPO_MULTA_OTRA,
  validarDetalleAdicional,
} from "./catalogo-tipos";

/**
 * SIMPLIFICAR FORMULARIO DE MULTAS — este proyecto no tiene un harness de
 * pruebas de componentes React (ver TMS-REPORTES-1/FACT-1-UI): se prueba
 * la lógica pura extraída (catálogo + reglas de validación), no el
 * render del formulario.
 */

describe("1) catálogo contiene todas las categorías", () => {
  it("las 7 categorías pedidas, en orden, ninguna vacía", () => {
    expect(CATALOGO_TIPOS_MULTA.map((c) => c.categoria)).toEqual([
      "Conducción", "Señalización y circulación", "Documentación",
      "Carga / transporte pesado", "Vehículo", "Incidentes", "Otros",
    ]);
    for (const c of CATALOGO_TIPOS_MULTA) expect(c.opciones.length).toBeGreaterThan(0);
  });
});

describe("2/3) categorías/valores específicos pedidos por el ticket", () => {
  it("2) VIRAR_LUGAR_NO_PERMITIDO existe (categoría Conducción)", () => {
    expect(OPCIONES_TIPO_MULTA.some((o) => o.value === "VIRAR_LUGAR_NO_PERMITIDO")).toBe(true);
  });
  it("3) VUELTA_U_NO_PERMITIDA existe (categoría Conducción)", () => {
    expect(OPCIONES_TIPO_MULTA.some((o) => o.value === "VUELTA_U_NO_PERMITIDA")).toBe(true);
  });
  it("OTRA existe (categoría Otros) — es el único valor con regla especial", () => {
    expect(OPCIONES_TIPO_MULTA.some((o) => o.value === TIPO_MULTA_OTRA)).toBe(true);
  });
  it("ningún value se repite entre categorías (cada código es único en todo el catálogo)", () => {
    const values = OPCIONES_TIPO_MULTA.map((o) => o.value);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("8) tipo normal conserva label/value correctos", () => {
  it("value y label exactos para un par conocido del catálogo", () => {
    expect(OPCIONES_TIPO_MULTA).toContainEqual({ value: "EXCESO_VELOCIDAD", label: "Exceso de velocidad" });
    expect(OPCIONES_TIPO_MULTA).toContainEqual({ value: "SOBREPESO", label: "Sobrepeso" });
  });
  it("labelDeTipoMulta devuelve el label del catálogo para un value conocido", () => {
    expect(labelDeTipoMulta("EXCESO_VELOCIDAD")).toBe("Exceso de velocidad");
    expect(labelDeTipoMulta("VIRAR_LUGAR_NO_PERMITIDO")).toBe("Virar en lugar no permitido");
  });
});

describe("9) registros históricos siguen siendo legibles — nunca se convierten ni se pierden", () => {
  it("un tipo_multa histórico que NO está en el catálogo actual se muestra tal cual (fallback, no se sobrescribe)", () => {
    expect(labelDeTipoMulta("choque menor sin boleta")).toBe("choque menor sin boleta");
    expect(labelDeTipoMulta("Exceso de velocidad (texto libre viejo)")).toBe("Exceso de velocidad (texto libre viejo)");
  });
});

describe("4/5/6/7) requiereDetalleAdicional / validarDetalleAdicional — regla OTRA + regla NO_APLICA", () => {
  it("4) tipo normal + resolución normal permite detalle vacío", () => {
    expect(requiereDetalleAdicional("EXCESO_VELOCIDAD", "EMPRESA")).toBe(false);
    expect(validarDetalleAdicional("EXCESO_VELOCIDAD", "EMPRESA", "")).toBeNull();
  });

  it("5) OTRA exige detalle — mensaje 'Describe el tipo de multa.'", () => {
    expect(requiereDetalleAdicional("OTRA", "EMPRESA")).toBe(true);
    expect(validarDetalleAdicional("OTRA", "EMPRESA", "")).toBe("Describe el tipo de multa.");
    expect(validarDetalleAdicional("OTRA", "EMPRESA", "   ")).toBe("Describe el tipo de multa."); // solo espacios cuenta como vacío
  });

  it("6) NO_APLICA exige detalle — mensaje 'Indica por qué no aplica resolución económica.'", () => {
    expect(requiereDetalleAdicional("EXCESO_VELOCIDAD", "NO_APLICA")).toBe(true);
    expect(validarDetalleAdicional("EXCESO_VELOCIDAD", "NO_APLICA", "")).toBe("Indica por qué no aplica resolución económica.");
  });

  it("7) OTRA + detalle permite guardar (sin error)", () => {
    expect(validarDetalleAdicional("OTRA", "EMPRESA", "Cruzó doble línea continua en curva")).toBeNull();
  });

  it("NO_APLICA + detalle permite guardar (sin error)", () => {
    expect(validarDetalleAdicional("EXCESO_VELOCIDAD", "NO_APLICA", "Boleta anulada por la PMT")).toBeNull();
  });

  it("OTRA + NO_APLICA simultáneos sin detalle: prioriza el mensaje de OTRA (más específico)", () => {
    expect(validarDetalleAdicional("OTRA", "NO_APLICA", "")).toBe("Describe el tipo de multa.");
  });
});

describe("11) el select agrupado no puede exponer un 'value' de categoría como si fuera una opción", () => {
  it("ningún nombre de categoría coincide con un value de opción (evita que un <optgroup> se confunda con un <option>)", () => {
    const categorias = new Set(CATALOGO_TIPOS_MULTA.map((c) => c.categoria));
    const values = new Set(OPCIONES_TIPO_MULTA.map((o) => o.value));
    for (const cat of categorias) expect(values.has(cat)).toBe(false);
  });
});

// 10) monto/responsabilidad/resolución no cambian — reglas.ts (backend) NO
// se modificó en este ticket (0 cambios), y RESPONSABILIDADES/RESOLUCIONES
// en page.tsx tampoco se tocaron — verificado por inspección, no por
// prueba automatizada (ver informe de entrega).
// 12) no requiere SQL — confirmado: ningún archivo de esquema/migración
// fue tocado por este ticket.

describe("HOTFIX PRE-MERGE PR #122 — Hallazgo 1: labelDeTipoMulta también se usa en la bandeja RRHH", () => {
  it("1) el mismo helper que usa src/app/e/[slug]/rrhh/descuentos/multas-pendientes/page.tsx convierte un código en su label humano (nunca expone el código crudo en pantalla)", () => {
    expect(labelDeTipoMulta("EXCESO_VELOCIDAD")).toBe("Exceso de velocidad");
    expect(labelDeTipoMulta("EXCESO_VELOCIDAD")).not.toBe("EXCESO_VELOCIDAD");
  });
});

describe("HOTFIX PRE-MERGE PR #122 — Hallazgo 2: debeMostrarDescripcionMulta evita el duplicado Tipo/Descripción", () => {
  it("2) multa NUEVA: tipo_multa (código) y descripcion (label) coinciden → NO mostrar Descripción (redundante)", () => {
    expect(debeMostrarDescripcionMulta("EXCESO_VELOCIDAD", "Exceso de velocidad")).toBe(false);
  });

  it("3) multa HISTÓRICA: descripcion es texto libre real y distinto del label → SÍ mostrar Descripción (ejemplo del ticket)", () => {
    expect(debeMostrarDescripcionMulta("VELOCIDAD", "Conducía a 95 km/h en zona de 60")).toBe(true);
  });

  it("4) fallback histórico sigue funcionando: si tipo_multa YA es texto libre y descripcion es una copia exacta, también se oculta (labelDeTipoMulta cae al mismo texto)", () => {
    expect(debeMostrarDescripcionMulta("choque menor sin boleta", "choque menor sin boleta")).toBe(false);
    // pero si difieren aunque sea en espacios/mayúsculas reales de contenido, se sigue mostrando
    expect(debeMostrarDescripcionMulta("choque menor sin boleta", "Colisión leve, sin boleta de la PMT")).toBe(true);
  });

  it("una descripción vacía nunca debe considerarse 'igual' al label por accidente (edge case defensivo)", () => {
    expect(debeMostrarDescripcionMulta("EXCESO_VELOCIDAD", "")).toBe(true);
  });
});

describe("HOTFIX PRE-MERGE PR #122 — 5) Detalle adicional sigue visible cuando existe", () => {
  it("con observaciones reales, se muestra", () => {
    expect(debeMostrarDetalleAdicional("Boleta anulada por la PMT")).toBe(true);
  });
  it("sin observaciones (null o solo espacios), no se muestra", () => {
    expect(debeMostrarDetalleAdicional(null)).toBe(false);
    expect(debeMostrarDetalleAdicional("   ")).toBe(false);
  });
});
