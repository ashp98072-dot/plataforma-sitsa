import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ guard: vi.fn(), registrar: vi.fn(), anular: vi.fn(), listar: vi.fn(), clientes: vi.fn(), facturas: vi.fn(), entidad: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenantCxc: m.guard }));
vi.mock("@/lib/facturacion/cobros", async (orig) => ({
  ...(await orig<typeof import("@/lib/facturacion/cobros")>()),
  registrarCobro: m.registrar, anularCobro: m.anular, listarCobros: m.listar, clientesConSaldo: m.clientes, facturasPendientesCliente: m.facturas,
}));
vi.mock("./cxc", () => ({ exigirEntidadActiva: m.entidad }));
vi.mock("@/lib/contabilidad/cxc/cxc", () => ({ exigirEntidadActiva: m.entidad }));
import { ErrorCobro, validarCobro } from "./cobros";
import { anularCobroAplicadoHttp, clientesCobroHttp, facturasPendientesHttp, listarCobrosAplicadosHttp, registrarCobroAplicadoHttp } from "@/lib/contabilidad/cxc/cobros-http";
import { PERMISOS_CXC, PLATAFORMA_PERMISIBLES, moduloEmpresaDelPermiso, modulosPropiosDelRol } from "@/lib/permisos-shared";
import { CATALOGO_PERMISOS } from "@/lib/permisos-catalogo";

const CLAVE = "clave-de-prueba-0123456789";
const valida = (over: Record<string, unknown> = {}) => ({ clienteId: 20, fechaCobro: "2026-10-10", medioPago: "Transferencia", referencia: "BOL-1", observaciones: null, claveIdempotencia: CLAVE, aplicaciones: [{ facturaId: 5, monto: "100.00" }], ...over });

describe("validación del cobro (pura)", () => {
  it("normaliza, suma en centavos exactos y ordena las aplicaciones", () => {
    const v = validarCobro(valida({ aplicaciones: [{ facturaId: 9, monto: "0.10" }, { facturaId: 3, monto: "0.20" }, { facturaId: 7, monto: "1234567.89" }] }), 1, 2);
    expect(v.total).toBe("1234568.19"); // con flotante 0.1 + 0.2 + … acumularía error
    expect(v.aplicaciones.map((a) => a.facturaId)).toEqual([3, 7, 9]);
  });
  it("la huella cambia con el contenido y con empresa/entidad, no con el orden de las aplicaciones", () => {
    const a = validarCobro(valida({ aplicaciones: [{ facturaId: 1, monto: "5" }, { facturaId: 2, monto: "6" }] }), 1, 2).huella;
    expect(validarCobro(valida({ aplicaciones: [{ facturaId: 2, monto: "6" }, { facturaId: 1, monto: "5" }] }), 1, 2).huella).toBe(a);
    expect(validarCobro(valida({ aplicaciones: [{ facturaId: 1, monto: "5" }, { facturaId: 2, monto: "6.01" }] }), 1, 2).huella).not.toBe(a);
    expect(validarCobro(valida({ aplicaciones: [{ facturaId: 1, monto: "5" }, { facturaId: 2, monto: "6" }] }), 1, 3).huella).not.toBe(a);
  });
  it.each([
    ["sin aplicaciones", { aplicaciones: [] }], ["factura repetida", { aplicaciones: [{ facturaId: 1, monto: "1" }, { facturaId: 1, monto: "2" }] }],
    ["monto cero", { aplicaciones: [{ facturaId: 1, monto: "0.00" }] }], ["monto negativo", { aplicaciones: [{ facturaId: 1, monto: "-1" }] }],
    ["tres decimales", { aplicaciones: [{ facturaId: 1, monto: "1.001" }] }], ["coma de miles", { aplicaciones: [{ facturaId: 1, monto: "1,000.00" }] }],
    ["monto numérico (no texto)", { aplicaciones: [{ facturaId: 1, monto: 10 }] }], ["fecha imposible", { fechaCobro: "2026-02-31" }],
    ["clave corta", { claveIdempotencia: "x" }], ["cliente inválido", { clienteId: -1 }], ["más de 50 facturas", { aplicaciones: Array.from({ length: 51 }, (_, i) => ({ facturaId: i + 1, monto: "1" })) }],
    ["referencia enorme", { referencia: "x".repeat(121) }],
  ])("rechaza %s", (_n, over) => {
    expect(() => validarCobro(valida(over) as never, 1, 2)).toThrowError(ErrorCobro);
  });
});

describe("HTTP del cobro multi-factura: permisos propios, ámbito y cuerpo estricto", () => {
  const OK = { empresa: { id: 7 }, session: { id: 31, username: "ana", rol: "Contabilidad" } };
  const get = (qs = "entidad=5") => new Request(`http://l/x?${qs}`);
  const post = (body: unknown, qs = "entidad=5") => new Request(`http://l/x?${qs}`, { method: "POST", body: JSON.stringify(body) });
  beforeEach(() => {
    vi.resetAllMocks();
    m.guard.mockResolvedValue(OK); m.entidad.mockResolvedValue(undefined);
    m.registrar.mockResolvedValue({ cobro: { id: 1 }, repetido: false }); m.anular.mockResolvedValue({ id: 1, estado: "ANULADO" });
    m.listar.mockResolvedValue({ cobros: [] }); m.clientes.mockResolvedValue([]); m.facturas.mockResolvedValue([]);
  });
  const prohibido = () => ({ error: new Response("{}", { status: 403 }) });
  it.each([
    ["listar", () => listarCobrosAplicadosHttp(get(), "e"), ["cxc_cuentas", "ver"]],
    ["registrar", () => registrarCobroAplicadoHttp(post(valida()), "e"), ["cxc_cobros", "editar"]],
    ["anular", () => anularCobroAplicadoHttp(post({ motivo: "error" }), "e", "3"), ["cxc_anular_cobro", "editar"]],
    ["clientes", () => clientesCobroHttp(get(), "e"), ["cxc_cobros", "editar"]],
    ["facturas pendientes", () => facturasPendientesHttp(get("entidad=5&clienteId=2"), "e"), ["cxc_cobros", "editar"]],
  ] as const)("%s exige %j y no ejecuta nada sin permiso", async (_n, llamar, [fila, accion]) => {
    m.guard.mockResolvedValue(prohibido());
    expect((await llamar()).status).toBe(403);
    expect(m.guard.mock.calls[0].slice(1, 3)).toEqual([fila, accion]);
    for (const f of [m.registrar, m.anular, m.listar, m.clientes, m.facturas]) expect(f).not.toHaveBeenCalled();
  });
  it("registrar: empresa/usuario de la sesión, entidad del ámbito; el cuerpo no puede traer empresa, entidad, usuario ni totales", async () => {
    expect((await registrarCobroAplicadoHttp(post(valida()), "e")).status).toBe(201);
    expect(m.registrar).toHaveBeenCalledWith({ empresaId: 7, usuarioId: 31, usuario: "ana" }, 5, expect.objectContaining({ clienteId: 20 }));
    for (const extra of [{ empresaId: 99 }, { entidadId: 9 }, { usuarioId: 1 }, { montoTotal: "1.00" }, { estado: "ANULADO" }]) {
      m.registrar.mockClear();
      expect((await registrarCobroAplicadoHttp(post({ ...valida(), ...extra }), "e")).status, JSON.stringify(extra)).toBe(400);
      expect(m.registrar).not.toHaveBeenCalled();
    }
    expect((await registrarCobroAplicadoHttp(post(valida({ aplicaciones: [{ facturaId: 5, monto: 100 }] })), "e")).status).toBe(400); // el monto viaja como texto
    expect((await registrarCobroAplicadoHttp(post(valida(), ""), "e")).status).toBeGreaterThanOrEqual(400); // sin entidad
    expect((await registrarCobroAplicadoHttp(post(valida(), "entidad=5&entidad=6"), "e")).status).toBeGreaterThanOrEqual(400);
  });
  it("un envío repetido responde 200 (no 201) y el error de negocio conserva su estado y código", async () => {
    m.registrar.mockResolvedValueOnce({ cobro: { id: 1 }, repetido: true });
    expect((await registrarCobroAplicadoHttp(post(valida()), "e")).status).toBe(200);
    m.registrar.mockRejectedValueOnce(new ErrorCobro("supera su saldo", 409, "SOBREAPLICACION"));
    const r = await registrarCobroAplicadoHttp(post(valida()), "e");
    expect(r.status).toBe(409);
    expect((await r.json()).codigo).toBe("SOBREAPLICACION");
  });
  it("anular: motivo y cobro de la ruta; id inválido y cuerpo inválido → 400; el estado/motivo no vienen del cliente salvo el motivo", async () => {
    expect((await anularCobroAplicadoHttp(post({ motivo: "Boleta duplicada" }), "e", "3")).status).toBe(200);
    expect(m.anular).toHaveBeenCalledWith({ empresaId: 7, usuarioId: 31, usuario: "ana" }, 5, 3, "Boleta duplicada");
    expect((await anularCobroAplicadoHttp(post({ motivo: "x" }), "e", "abc")).status).toBe(400);
    expect((await anularCobroAplicadoHttp(post([]), "e", "3")).status).toBe(400);
    m.anular.mockRejectedValueOnce(new ErrorCobro("confirmación activa", 409, "CONFIRMACION_ACTIVA"));
    expect((await anularCobroAplicadoHttp(post({ motivo: "x y z" }), "e", "3")).status).toBe(409);
  });
  it("listar: filtros saneados", async () => {
    await listarCobrosAplicadosHttp(get("entidad=5&clienteId=2&estado=ANULADO&desde=2026-10-01&hasta=basura&page=3&empresaId=99"), "e");
    expect(m.listar).toHaveBeenCalledWith(7, 5, { clienteId: 2, estado: "ANULADO", desde: "2026-10-01", hasta: undefined, page: 3, pageSize: undefined });
    await listarCobrosAplicadosHttp(get("entidad=5&estado=XX"), "e");
    expect(m.listar).toHaveBeenLastCalledWith(7, 5, expect.objectContaining({ estado: undefined }));
  });
  it("facturas pendientes exige cliente", async () => {
    expect((await facturasPendientesHttp(get("entidad=5"), "e")).status).toBe(400);
    expect(m.facturas).not.toHaveBeenCalled();
  });
});

describe("permisos", () => {
  it("cxc_anular_cobro es una fila propia, ningún rol la trae, requiere ver CxC y no la concede cobrar", () => {
    expect(PERMISOS_CXC).toContain("cxc_anular_cobro");
    expect(PLATAFORMA_PERMISIBLES).toContain("cxc_anular_cobro");
    expect(moduloEmpresaDelPermiso("cxc_anular_cobro")).toBe("contabilidad");
    for (const rol of ["Contabilidad", "Visualizador", "Facturacion"]) expect(modulosPropiosDelRol(rol as never)).not.toContain("cxc_anular_cobro");
    const acc = CATALOGO_PERMISOS.find((x) => x.id === "contabilidad")!.acciones.find((a) => a.id === "cxc_anular_cobro");
    expect(acc).toMatchObject({ requiere: "cxc_ver" });
  });
});

describe("arquitectura", () => {
  const leer = (p: string) => readFileSync(p, "utf8");
  it("cobros.ts: sin DELETE ni UPDATE de aplicaciones/cabecera salvo marcar ANULADO; sin pólizas, retención, notas de crédito ni anticipos", () => {
    const src = leer("src/lib/facturacion/cobros.ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(src).not.toMatch(/DELETE\s+FROM|TRUNCATE|DROP\s/i);
    expect(src.match(/UPDATE\s+\w+/gi)).toEqual(["UPDATE fact_cobros"]);
    expect(src).toContain("SET estado = 'ANULADO'");
    expect(src).not.toMatch(/cont_asientos|cont_eventos|poliza|asiento|registrarAsiento|nota_credito|anticipo/i);
    expect(src).not.toMatch(/fact_pagos/); // el modelo nuevo no extiende ni escribe fact_pagos (solo lo lee vía SQL_COBRADO)
  });
  it("toda lectura de «cobrado» usa SQL_COBRADO (una sola definición); ningún saldo suma solo fact_pagos", () => {
    for (const f of ["src/lib/facturacion/facturas.ts", "src/lib/facturacion/cuentas-por-cobrar.ts", "src/lib/tms/reportes-viajes.ts"]) {
      const src = leer(f);
      expect(src, f).toContain("SQL_COBRADO");
      expect(src, f).not.toMatch(/SUM\(monto\) AS total_pagado FROM fact_pagos/);
    }
    expect(leer("src/lib/facturacion/cobrado.ts")).toContain("c.estado = 'VIGENTE'");
  });
  it("el saldo que valida el cobro se lee con las facturas bloqueadas (FOR UPDATE, orden de id) y la anulación bloquea facturas ANTES que el cobro", () => {
    const src = leer("src/lib/facturacion/cobros.ts");
    expect(src).toMatch(/ORDER BY id FOR UPDATE/);
    const anular = src.slice(src.indexOf("export async function anularCobro"));
    expect(anular.indexOf("FROM fact_facturas")).toBeGreaterThan(0);
    expect(anular.indexOf("FROM fact_facturas")).toBeLessThan(anular.indexOf("FROM fact_cobros WHERE"));
    expect(anular.indexOf("fact_pago_confirmaciones")).toBeGreaterThan(anular.indexOf("FROM fact_cobros WHERE"));
  });
  it("el SQL de migración es aditivo y no destructivo; preflight y postcheck son de solo lectura", () => {
    const quitar = (s: string) => s.replace(/--[^\n]*/g, "").replace(/ON (DELETE|UPDATE) RESTRICT/g, "").replace(/SHOW CREATE TABLE/g, "SHOW TABLA");
    const mig = quitar(leer("sql/migrate-2026-10-cxc-cobros-multifactura.sql"));
    expect(mig).not.toMatch(/DROP|TRUNCATE|DELETE|UPDATE |INSERT|REPLACE/i);
    expect(mig.match(/ALTER TABLE \w+/g)).toEqual(["ALTER TABLE fact_pago_confirmaciones", "ALTER TABLE fact_pago_confirmaciones"]); // ADD COLUMN/KEY y la FK condicional (PREPARE)
    expect(mig).not.toMatch(/FOREIGN KEY IF NOT EXISTS/i);
    for (const f of ["sql/preflight-2026-10-cxc-cobros-multifactura.sql", "sql/postcheck-2026-10-cxc-cobros-multifactura.sql"]) {
      expect(quitar(leer(f)), f).not.toMatch(/\b(DROP|TRUNCATE|DELETE|UPDATE|INSERT|ALTER|CREATE)\b/i);
    }
  });
});
