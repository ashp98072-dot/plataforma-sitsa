import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn(), execute: vi.fn() }));
vi.mock("@/lib/rrhh/documentos", () => ({ contarDocumentosPorEmpleado: vi.fn(() => Promise.resolve(new Map())) }));

import { query, execute } from "@/lib/db";
import { listarEmpleados } from "@/lib/rrhh/empleados";
import { construirParamsEmpleados } from "@/lib/rrhh/empleados-filtros";

/**
 * RRHH-EMPLEADOS-ACTIVOS-BAJAS-1 — RRHH > Empleados abre SOLO con Activos;
 * el selector existente pasa a Activos / Bajas / Todos y reutiliza el
 * filtro `estado` que ya aceptaba GET /empleados. Sin endpoint nuevo, sin
 * columnas/tablas, sin migración.
 *
 * Dos capas (el repo no tiene harness de render de React, mismo criterio
 * que page.test.ts): (1) guardas sobre el código fuente de page.tsx;
 * (2) comportamiento REAL de listarEmpleados (el SQL que arma) sobre una
 * tabla `empleados` en memoria, para probar que un cambio de estado hace
 * que el empleado salga/entre del listado tras recargar.
 */
const src = readFileSync(join(__dirname, "page.tsx"), "utf-8").replace(/\r\n/g, "\n");

function cuerpoDeCallback(nombre: string): string {
  const regex = new RegExp(`const ${nombre} = useCallback\\(async \\(\\) => \\{([\\s\\S]*?)\\n  \\}, \\[`);
  return src.match(regex)?.[1] ?? "";
}

describe("page.tsx — filtro de estado: Activos / Bajas / Todos", () => {
  it("la vista inicial usa estado Activo (no 'Activos y bajas')", () => {
    expect(src).toContain('const [filtroEstado, setFiltroEstado] = useState("Activo");');
    expect(src).not.toContain('const [filtroEstado, setFiltroEstado] = useState("");');
  });

  it("el selector tiene exactamente Activos (Activo), Bajas (Baja) y Todos (sin valor); ya no existe 'Activos y bajas'", () => {
    const i = src.indexOf("value={filtroEstado}");
    const bloque = src.slice(i, src.indexOf("</select>", i));
    expect(bloque).toContain('<option value="Activo">Activos</option>');
    expect(bloque).toContain('<option value="Baja">Bajas</option>');
    expect(bloque).toContain('<option value="">Todos</option>');
    expect((bloque.match(/<option /g) ?? []).length).toBe(3);
    expect(src).not.toContain("Activos y bajas");
  });

  it("Activos es la primera opción y Todos la última (orden del ticket)", () => {
    const i = src.indexOf("value={filtroEstado}");
    const bloque = src.slice(i, src.indexOf("</select>", i));
    expect(bloque.indexOf("Activos<")).toBeLessThan(bloque.indexOf("Bajas<"));
    expect(bloque.indexOf("Bajas<")).toBeLessThan(bloque.indexOf("Todos<"));
  });

  it("cargar() envía `estado` solo si hay valor: Activo -> estado=Activo, Baja -> estado=Baja, Todos ('') -> NO envía estado", () => {
    const c = cuerpoDeCallback("cargar");
    expect(c).toContain("construirParamsEmpleados(filtrosActuales)"); // helper compartido con la exportación
    // Comportamiento REAL del helper (mismo que usa cargar()).
    const construir = (estado: string) => construirParamsEmpleados({ estado }).toString();
    expect(construir("Activo")).toBe("estado=Activo");
    expect(construir("Baja")).toBe("estado=Baja");
    expect(construir("")).toBe("");
  });

  it("el estado se combina con búsqueda, tipo de contrato y forma de pago en la MISMA consulta", () => {
    const c = cuerpoDeCallback("cargar");
    expect(c).toContain("construirParamsEmpleados(filtrosActuales)");
    expect(src).toContain("q: qDebounced, tipoContrato: filtroTipo, formaPago: filtroPago, estado: filtroEstado");
    expect(construirParamsEmpleados({ q: " Ana ", tipoContrato: "fijo", formaPago: "cheque", estado: "Baja" }).toString()).toBe("q=Ana&tipoContrato=fijo&formaPago=cheque&estado=Baja");
  });

  it("cambiar el selector recarga (filtroEstado es dependencia de cargar y de su efecto) — y el fetch va sin caché", () => {
    expect(src).toMatch(/\}, \[slug, filtrosActuales\]\);/); // filtrosActuales agrupa qDebounced/filtroTipo/filtroPago/filtroEstado
    expect(cuerpoDeCallback("cargar")).toMatch(/\{\s*cache:\s*"no-store",?\s*\}/);
  });

  it("usa el endpoint existente (GET /empleados): no hay ninguna llamada nueva de listado", () => {
    expect(cuerpoDeCallback("cargar")).toContain("`/api/empresas/${slug}/empleados?${params.toString()}`");
  });
});

describe("page.tsx — supervisores independientes del filtro de la tabla", () => {
  it("cargarSupervisores sigue pidiendo SIEMPRE estado=Activo y nunca usa filtroEstado/filtroTipo/filtroPago/búsqueda", () => {
    const c = cuerpoDeCallback("cargarSupervisores");
    expect(c).toContain("`/api/empresas/${slug}/empleados?estado=Activo`");
    expect(c).not.toContain("filtroEstado");
    expect(c).not.toContain("filtroTipo");
    expect(c).not.toContain("filtroPago");
    expect(c).not.toContain("qDebounced");
    expect(src).toMatch(/const cargarSupervisores = useCallback\(async \(\) => \{[\s\S]*?\}, \[slug\]\);/);
  });

  it("el estado por defecto del filtro principal NO afecta a supervisores: siguen siendo los Activos aunque la tabla esté en Bajas o Todos", () => {
    expect(src).not.toMatch(/cargarSupervisores[\s\S]{0,400}filtroEstado/);
  });
});

describe("page.tsx — editar/crear y recarga desde el servidor", () => {
  const cuerpoOnSubmit = () => {
    const m = src.match(/async function onSubmit\([^)]*\)[^{]*\{([\s\S]*?)\n  \}\n/);
    return m?.[1] ?? "";
  };

  it("tras guardar (crear o editar) se recarga con cargar(); NO hay actualización optimista de la lista", () => {
    const c = cuerpoOnSubmit();
    expect(c).toMatch(/await cargar\(\);/);
    expect(c).not.toMatch(/setEmpleados\(/);
  });

  it("el selector de estado del FORMULARIO (Activo / Baja / Inactivo) sigue igual — editar el estado de un empleado no cambió", () => {
    expect(src).toMatch(/<option value="Activo">Activo<\/option>/);
    expect(src).toMatch(/<option value="Baja">Baja \/ Inactivo<\/option>/);
  });

  it("el alta/edición siguen usando los mismos POST/PUT del recurso empleados", () => {
    expect(src).toMatch(/method,?/);
    expect(src).toContain("/api/empresas/${slug}/empleados");
  });
});

describe("page.tsx — exportaciones (hallazgo, sin ampliar alcance)", () => {
  it("los enlaces Excel/PDF ahora llevan los MISMOS filtros que la tabla (RRHH-EMPLEADOS-EXPORT-FILTROS-1; detalle en empleados-export-filtros.test.ts)", () => {
    expect(src).toContain('href={hrefExportEmpleados(slug, "xlsx", filtrosActuales)}');
    expect(src).toContain('href={hrefExportEmpleados(slug, "pdf", filtrosActuales)}');
    expect(src).toContain("/empleados/export?format=plantilla"); // la plantilla no depende de filtros
  });
});

/** Tabla `empleados` en memoria: aplica lo que el SQL real de listarEmpleados pide (empresa, q, contrato, pago, estado). */
type Fila = { id: number; empresa_id: number; nombre: string; codigo: string; dpi: string; estado: string; tipo_contrato: string; forma_pago: string };
let tabla: Fila[] = [];

function emular(sqlCompleto: string, params: unknown[]) {
  // Solo la cláusula WHERE decide qué parámetros existen (las columnas del SELECT también nombran tipo_contrato/forma_pago).
  const sql = sqlCompleto.slice(sqlCompleto.indexOf("WHERE"));
  if (!sqlCompleto.includes("FROM empleados")) return [];
  const p = [...params];
  const empresa = p.shift();
  const q = sql.includes("nombre LIKE ?") ? String(p.splice(0, 4)[0]).replaceAll("%", "").toLowerCase() : null;
  const tipo = sql.includes("LOWER(COALESCE(tipo_contrato") ? String(p.shift()) : null;
  const pago = sql.includes("LOWER(COALESCE(forma_pago") ? String(p.shift()) : null;
  const estado = sql.includes("estado = ?") ? String(p.shift()) : null;
  return tabla
    .filter((r) => r.empresa_id === empresa)
    .filter((r) => q == null || [r.nombre, r.codigo, r.dpi].some((v) => v.toLowerCase().includes(q)))
    .filter((r) => tipo == null || r.tipo_contrato.toLowerCase() === tipo)
    .filter((r) => pago == null || r.forma_pago.toLowerCase() === pago)
    .filter((r) => estado == null || r.estado === estado)
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

const ids = async (opts?: Parameters<typeof listarEmpleados>[2], q = "") => (await listarEmpleados(7, q, opts)).map((e) => e.id);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(execute).mockResolvedValue({ affectedRows: 0 } as never);
  tabla = [
    { id: 1, empresa_id: 7, nombre: "Ana Activa", codigo: "E1", dpi: "1", estado: "Activo", tipo_contrato: "Planilla", forma_pago: "Cheque" },
    { id: 2, empresa_id: 7, nombre: "Carlos Baja", codigo: "E2", dpi: "2", estado: "Baja", tipo_contrato: "Outsourcing", forma_pago: "Cheque" },
    { id: 3, empresa_id: 7, nombre: "Carlos Activo", codigo: "E3", dpi: "3", estado: "Activo", tipo_contrato: "Outsourcing", forma_pago: "Transferencia" },
    { id: 4, empresa_id: 7, nombre: "Beto Baja", codigo: "E4", dpi: "4", estado: "Baja", tipo_contrato: "Planilla", forma_pago: "Transferencia" },
    { id: 9, empresa_id: 8, nombre: "Otra Empresa", codigo: "X", dpi: "9", estado: "Activo", tipo_contrato: "Planilla", forma_pago: "Cheque" },
  ];
  vi.mocked(query).mockImplementation((async (sql: string, params: unknown[]) => emular(String(sql), params)) as never);
});

describe("listarEmpleados (servidor) — estado Activo / Baja / Todos", () => {
  it("Activos -> solo Activo", async () => {
    expect(await ids({ estado: "Activo" })).toEqual([1, 3]);
  });

  it("Bajas -> solo Baja (no se modifican ni mueven registros: solo se filtran)", async () => {
    expect(await ids({ estado: "Baja" })).toEqual([4, 2]);
    expect(vi.mocked(query).mock.calls.every(([sql]) => /^\s*SELECT/i.test(String(sql)))).toBe(true);
  });

  it("Todos -> no envía filtro de estado: Activos + Bajas", async () => {
    expect(await ids({ estado: undefined })).toEqual([1, 4, 3, 2]);
    expect(String(vi.mocked(query).mock.calls[0][0])).not.toContain("estado = ?");
  });

  it("estado + búsqueda: Baja + 'Carlos' -> solo Carlos Baja; Activo + 'Carlos' -> solo Carlos Activo", async () => {
    expect(await ids({ estado: "Baja" }, "Carlos")).toEqual([2]);
    expect(await ids({ estado: "Activo" }, "Carlos")).toEqual([3]);
  });

  it("estado + contrato: Activo + Outsourcing -> solo el activo outsourcing", async () => {
    expect(await ids({ estado: "Activo", tipoContrato: "Outsourcing" })).toEqual([3]);
    expect(await ids({ estado: "Baja", tipoContrato: "Outsourcing" })).toEqual([2]);
  });

  it("estado + forma de pago: Activo + Cheque -> solo Ana", async () => {
    expect(await ids({ estado: "Activo", formaPago: "Cheque" })).toEqual([1]);
    expect(await ids({ estado: "Baja", formaPago: "Transferencia" })).toEqual([4]);
  });

  it("estado + contrato + pago + búsqueda combinados", async () => {
    expect(await ids({ estado: "Activo", tipoContrato: "Outsourcing", formaPago: "Transferencia" }, "carlos")).toEqual([3]);
    expect(await ids({ estado: "Baja", tipoContrato: "Outsourcing", formaPago: "Transferencia" }, "carlos")).toEqual([]);
  });

  it("siempre acotado por la empresa de la sesión: el empleado de otra empresa nunca aparece en ningún filtro", async () => {
    for (const estado of ["Activo", "Baja", undefined]) expect(await ids({ estado })).not.toContain(9);
  });

  it("Activo -> Baja: tras recargar, el empleado desaparece de Activos y aparece en Bajas (sigue existiendo)", async () => {
    expect(await ids({ estado: "Activo" })).toContain(1);
    tabla.find((r) => r.id === 1)!.estado = "Baja"; // el PUT del servidor
    expect(await ids({ estado: "Activo" })).not.toContain(1);
    expect(await ids({ estado: "Baja" })).toContain(1);
    expect(tabla.some((r) => r.id === 1)).toBe(true);
  });

  it("Baja -> Activo: tras recargar, desaparece de Bajas y aparece en Activos", async () => {
    expect(await ids({ estado: "Baja" })).toContain(2);
    tabla.find((r) => r.id === 2)!.estado = "Activo";
    expect(await ids({ estado: "Baja" })).not.toContain(2);
    expect(await ids({ estado: "Activo" })).toContain(2);
  });

  it("los supervisores (estado=Activo) no dependen del filtro de la tabla: siempre solo Activos", async () => {
    const supervisores = await ids({ estado: "Activo" });
    expect(supervisores).toEqual([1, 3]);
    // El filtro de la tabla en 'Bajas' no cambia esa consulta independiente.
    await ids({ estado: "Baja" });
    expect(await ids({ estado: "Activo" })).toEqual([1, 3]);
  });
});
