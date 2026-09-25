import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: m.query, getPool: vi.fn() }));
vi.mock("./empleados-schema", () => ({ asegurarSchemaEmpleados: vi.fn(async () => undefined) }));
vi.mock("./documentos", () => ({ contarDocumentosPorEmpleado: vi.fn(async () => new Map()) }));
import { filtrarPersonas } from "@/lib/busqueda-personas";
import { listarEmpleados } from "./empleados";
import { filtrarSaldos, type SaldoAlerta } from "./vacaciones-alertas-ui";

/** RRHH: la búsqueda de personas usa la semántica compartida de src/lib/busqueda-personas.ts (PR #365), sin tocar el universo de datos. */
const src = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const fila = (id: number, nombre: string, extra: Record<string, unknown> = {}) => ({
  id, numero_empleado: `N${id}`, codigo: `EMP-${String(id).padStart(4, "0")}`, nombre, puesto: "Piloto", estado: "Activo", dpi: `2000${id}0101`, ...extra,
});
const filas = [
  fila(1, "José Antonio Pérez López"), fila(2, "José Antonio García López"), fila(3, "Luis Muñoz"), fila(4, "Rosa Álvarez"), fila(5, "Jose Pérez"),
];
const nombres = async (q: string, opts?: Parameters<typeof listarEmpleados>[2]) => (await listarEmpleados(9, q, opts)).map((e) => e.nombre);

beforeEach(() => { m.query.mockReset(); m.query.mockResolvedValue(filas); });

describe("listarEmpleados (servidor): filtro de texto en memoria con la semántica compartida", () => {
  it("jose / josé / JOSE encuentran a José y a Jose; munoz→Muñoz; perez→Pérez; alvarez→Álvarez", async () => {
    for (const q of ["jose", "josé", "JOSE", "  Jose  "]) expect((await nombres(q)).sort()).toEqual(["Jose Pérez", "José Antonio García López", "José Antonio Pérez López"]);
    expect(await nombres("munoz")).toEqual(["Luis Muñoz"]);
    expect((await nombres("perez")).sort()).toEqual(["Jose Pérez", "José Antonio Pérez López"]);
    expect(await nombres("alvarez")).toEqual(["Rosa Álvarez"]);
  });
  it("multi-token: 'jose perez' encuentra a José Antonio Pérez López y NO a José Antonio García López", async () => {
    const r = await nombres("jose perez");
    expect(r).toContain("José Antonio Pérez López");
    expect(r).not.toContain("José Antonio García López");
  });
  it("ranking con búsqueda: nombre más cercano primero; sin búsqueda se conserva el orden SQL", async () => {
    expect((await nombres("jose perez"))[0]).toBe("Jose Pérez"); // nombre completo exacto normalizado
    expect(await nombres("")).toEqual(filas.map((f) => f.nombre));
  });
  it("sigue buscando por código, número de empleado y DPI (como antes con LIKE)", async () => {
    expect(await nombres("EMP-0003")).toEqual(["Luis Muñoz"]);
    expect(await nombres("emp-0003")).toEqual(["Luis Muñoz"]);
    expect(await nombres("N4")).toEqual(["Rosa Álvarez"]);
    expect(await nombres("200030101")).toEqual(["Luis Muñoz"]);
  });
  it("el texto de búsqueda ya no viaja a SQL como LIKE; empresa/estado/tipo/forma de pago siguen acotando en SQL", async () => {
    await listarEmpleados(9, "jose", { estado: "Activo", tipoContrato: "Fijo", formaPago: "Efectivo" });
    const [sql, params] = m.query.mock.calls[0];
    expect(sql).not.toMatch(/nombre LIKE/);
    expect(sql).toContain("empresa_id = ?");
    expect(sql).toContain("estado = ?");
    expect(params[0]).toBe(9); // tenant
    expect(params).toContain("Activo");
    expect(params).toContain("fijo");
    expect(params).toContain("efectivo");
    expect(params).not.toContain("%jose%");
  });
  it("Activos/Bajas se preservan: el estado se filtra en SQL, la búsqueda nunca agrega filas", async () => {
    m.query.mockResolvedValue([fila(1, "José Activo"), fila(2, "José Baja", { estado: "Baja" })]);
    const r = await listarEmpleados(9, "jose", { estado: "Activo" });
    expect(m.query.mock.calls[0][0]).toContain("estado = ?");
    expect(r.length).toBeLessThanOrEqual(2); // subconjunto de lo que devolvió SQL (SQL ya excluye Bajas con el filtro real)
    m.query.mockClear(); m.query.mockResolvedValue([]);
    expect(await listarEmpleados(9, "jose", { estado: "Activo" })).toEqual([]);
    expect(m.query.mock.calls[0][0]).toContain("estado = ?");
    expect(m.query.mock.calls[0][1]).toEqual([9, "Activo"]);
  });
  it("sin coincidencias devuelve vacío (no todos)", async () => expect(await nombres("zzzz")).toEqual([]));
  it("el nombre devuelto es el real guardado", async () => expect((await listarEmpleados(9, "jose perez")).map((e) => e.nombre)).toContain("José Antonio Pérez López"));
});

describe("Saldos de vacaciones (filtro cliente)", () => {
  const saldos: SaldoAlerta[] = [
    { empleadoId: 1, codigo: "EMP-1", nombre: "José Antonio Pérez López", dpi: "111", fechaContratacion: "2020-01-01", diasDisponibles: 10 },
    { empleadoId: 2, codigo: "EMP-2", nombre: "José Antonio García López", dpi: null, fechaContratacion: "2021-01-01", diasDisponibles: 5 },
  ];
  const f = (nombre: string) => filtrarSaldos(saldos, { nombre, desde: "", hasta: "", orden: "saldo" }).map((s) => s.empleadoId);
  it("jose perez multi-token; código y DPI siguen funcionando; sin coincidencia vacío", () => {
    expect(f("jose perez")).toEqual([1]);
    expect(f("JOSÉ").sort()).toEqual([1, 2]);
    expect(f("emp-2")).toEqual([2]);
    expect(f("111")).toEqual([1]);
    expect(f("zzz")).toEqual([]);
    expect(f("")).toEqual([1, 2]);
  });
  it("ya no tiene un normalizador propio (usa el compartido)", () => {
    const s = src("src/lib/rrhh/vacaciones-alertas-ui.ts");
    expect(s).toContain('from "@/lib/busqueda-personas"');
    expect(s).not.toContain("const normalizar");
  });
});

describe("selectores RRHH (mismas extracciones que el código; nada se amplía)", () => {
  const emps = [
    { id: 1, codigo: "EMP-0042", nombre: "José Pérez López", dpi: "2000000010101" },
    { id: 2, codigo: "EMP-0077", nombre: "José Antonio García", dpi: null },
    { id: 3, codigo: "EMP-0100", nombre: "Luis Muñoz", dpi: "2000000030101" },
  ];
  it("EmpleadoPicker: jose/josé/munoz/multi-token; código y DPI siguen buscando; sin coincidencia → vacío", () => {
    const f = (q: string) => filtrarPersonas(emps, q, { nombre: (e) => e.nombre, buscable: (e) => `${e.codigo} ${e.dpi ?? ""}` }, 120).map((e) => e.id);
    expect(f("jose").sort()).toEqual([1, 2]);
    expect(f("josé")).toEqual(f("JOSE"));
    expect(f("munoz")).toEqual([3]);
    expect(f("jose perez")).toEqual([1]);
    expect(f("EMP-0077")).toEqual([2]);
    expect(f("2000000030101")).toEqual([3]);
    expect(f("zzz")).toEqual([]);
  });
  const picker = src("src/components/rrhh/empleado-picker.tsx");
  it("EmpleadoPicker: usa el helper compartido, conserva el DPI tal como ya se mostraba, sin autoselección y con mensaje", () => {
    expect(picker).toContain('import { filtrarPersonas } from "@/lib/busqueda-personas";');
    expect(picker).toContain("filtrarPersonas(empleados, q, { nombre: (e) => e.nombre, buscable: (e) => `${e.codigo} ${e.dpi ?? \"\"}` }, 120)");
    expect(picker).toContain('"No se encontraron empleados."');
    expect(picker).not.toContain(".toLowerCase()");
    expect(picker.match(/DPI \$\{/g)).toHaveLength(2); // los mismos dos sitios de antes (opción seleccionada y lista)
    expect(picker).toContain("selected && !filtrados.some((e) => e.id === selected.id)"); // la selección no se pierde al filtrar
    expect(picker).toContain('onChange(Number(e.target.value))'); // solo selecciona el usuario en el <select>
  });
  it("Supervisor (Empleados): mismo universo (sin el propio empleado ni los ya elegidos) y mensaje unificado", () => {
    const p = src("src/app/e/[slug]/rrhh/empleados/page.tsx");
    expect(p).toContain("supervisoresDisponibles.filter((s) => s.id !== editId && !form.supervisorIds.includes(s.id))");
    expect(p).toContain("{ nombre: (s) => s.nombre, buscable: (s) => `${s.numeroEmpleado ?? \"\"} ${s.codigo}` }");
    expect(p).toContain("No se encontraron empleados.");
    expect(p).not.toContain("haystack");
    expect(p).toContain("mergeSupervisorLabels([s]);"); // la selección sigue siendo un clic explícito
  });
  it("Marcaje manual: nombre + número + código, tope 80, sin cambiar cálculo ni fechas", () => {
    const p = src("src/app/e/[slug]/rrhh/marcajes/manual/page.tsx");
    expect(p).toContain("{ nombre: (e) => e.nombre, buscable: (e) => `${e.numeroEmpleado || \"\"} ${e.codigo || \"\"}` },\n      80,");
    expect(p).toContain("return empleados.slice(0, 80);");
    expect(p).not.toContain("e.nombre.toLowerCase()");
  });
  it("Planillas: filtro por código/nombre/DPI con la semántica compartida y el filtro de forma de pago intacto", () => {
    const p = src("src/app/e/[slug]/rrhh/planillas/page.tsx");
    expect(p).toContain("if (filtroForma !== \"todas\" && l.formaPago !== filtroForma) return false;");
    expect(p).toContain("coincideBusquedaPersona(filtro, `${l.codigoEmpleado} ${l.nombreEmpleado} ${l.dpi}`)");
    expect(p).toContain("[lineas, filtro, filtroForma]");
  });
  it("Inventario (entrega): la búsqueda de empleado reutiliza el endpoint de empleados con estado=Activo (ahora con la semántica compartida)", () => {
    const p = src("src/app/e/[slug]/rrhh/inventario/page.tsx");
    expect(p).toContain("/empleados?q=${encodeURIComponent(term)}&estado=Activo");
  });
  it("no hay más normalizadores/filtros de texto por persona paralelos en RRHH", () => {
    for (const f of ["src/components/rrhh/empleado-picker.tsx", "src/app/e/[slug]/rrhh/marcajes/manual/page.tsx", "src/app/e/[slug]/rrhh/planillas/page.tsx", "src/lib/rrhh/vacaciones-alertas-ui.ts"]) {
      expect(src(f)).not.toMatch(/\.toLowerCase\(\)\s*\.includes\(|nombre\.toLowerCase\(\)\.includes|normalize\("NFD"\)/);
    }
  });
});
