import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";

// Only infrastructure boundaries are replaced. HTTP routes, tenant/CxP guards,
// permission resolution, validation and provider mapping remain production code.
const lab = vi.hoisted(() => ({
  session: null as null | { id: number; username: string; rol: "Contabilidad" | "Admin"; empresaId: number },
  allowed: [101], modules: ["contabilidad"], active: true,
  rows: [] as Record<string, unknown>[], query: vi.fn(),
  forbiddenPool: vi.fn(() => { throw new Error("MIL-CXP-07: real pool forbidden"); }),
  cookie: vi.fn(),
}));
vi.mock("@/lib/session", () => ({
  getSession: async () => lab.session,
  createSessionToken: async () => "synthetic-session-no-secret",
  setSessionCookie: lab.cookie,
}));
vi.mock("@/lib/empresas", () => ({
  obtenerEmpresaPorSlug: async (slug: string) => {
    const id = slug === "qa-a" ? 101 : slug === "qa-b" ? 202 : null;
    return id ? { id, slug, nombre: slug, codigo: slug, logoUrl: null, activa: lab.active, modulos: lab.modules } : null;
  },
  empresasParaUsuario: async () => lab.allowed.map(id => ({ id })),
}));
vi.mock("@/lib/db", () => ({ query: lab.query, getPool: lab.forbiddenPool }));

import { GET as listRoute } from "@/app/api/empresas/[slug]/contabilidad/cxp/proveedores/route";
import { GET as fiscalRoute } from "@/app/api/empresas/[slug]/contabilidad/cxp/proveedores/[id]/fiscal/route";
import { GET as accountsRoute } from "@/app/api/empresas/[slug]/contabilidad/cxp/cuentas/route";
import { PERMISOS_CXP } from "@/lib/permisos-shared";
import { listarProveedoresCxp } from "./proveedor-fiscal";

const profiles = [
  { name: "both", invoices: true, fiscal: true, admin: false },
  { name: "invoices-only", invoices: true, fiscal: false, admin: false },
  { name: "fiscal-only", invoices: false, fiscal: true, admin: false },
  { name: "neither", invoices: false, fiscal: false, admin: false },
  { name: "admin", invoices: false, fiscal: false, admin: true },
] as const;
const providers = [
  { id: 1001, empresa: 101, nombre: "SYNTHETIC-A", nit: "QA-A", activo: 1 },
  { id: 1002, empresa: 101, nombre: "SYNTHETIC-NO-CONFIG", nit: null, activo: 1 },
  { id: 2001, empresa: 202, nombre: "SYNTHETIC-B", nit: "QA-B", activo: 1 },
];
const configs = [
  { empresa: 101, entidad: 11, proveedor: 1001, regimen: "GENERAL", isr: 1, account: 11001 },
  { empresa: 101, entidad: 12, proveedor: 1001, regimen: "PEQUENO_CONTRIBUYENTE", isr: 0, account: 12001 },
  { empresa: 202, entidad: 21, proveedor: 2001, regimen: "GENERAL", isr: 1, account: 21001 },
];
type ConfigFixture = (typeof configs)[number];
function configRow(c: ConfigFixture | undefined) {
  return c ? { proveedor_id: c.proveedor, entidad_id: c.entidad, regimen_fiscal: c.regimen,
    sujeto_isr: c.isr, cuenta_proveedor_id: c.account, cuenta_anticipo_id: c.account + 1,
    cuenta_gasto_id: c.account + 2, activo: 1 } : { proveedor_id: null };
}

function useProfile(p: (typeof profiles)[number]) {
  lab.session = { id: 700 + profiles.indexOf(p), username: `synthetic-${p.name}`, rol: p.admin ? "Admin" : "Contabilidad", empresaId: 101 };
  lab.rows = PERMISOS_CXP.map(modulo => ({ modulo,
    puede_ver: modulo === "cxp_facturas" ? +p.invoices : modulo === "cxp_proveedor_fiscal" ? +p.fiscal : 0,
    puede_crear: 0, puede_editar: 0, puede_eliminar: 0 }));
  // Explicit V2 matrix; a denied row is not granted by any unrelated action.
  lab.rows.push({ modulo: "permisos_acciones_v2", puede_ver: 1, puede_crear: 0, puede_editar: 0, puede_eliminar: 0 });
}

beforeEach(() => {
  vi.clearAllMocks();
  lab.allowed = [101]; lab.modules = ["contabilidad"]; lab.active = true;
  useProfile(profiles[0]);
  lab.query.mockImplementation(async (sql: string, params: unknown[]) => {
    // These are deterministic fixtures, not an SQL engine. Assert the actual
    // production SQL contract before supplying scoped synthetic rows.
    if (/FROM usuario_modulo/.test(sql)) {
      expect(params).toEqual([lab.session!.id]);
      expect(sql).toContain("empresa_id IS NULL");
      return lab.rows;
    }
    if (/FROM compras_proveedores p/.test(sql)) {
      const verFiscal = sql.includes("JOIN cxp_proveedor_fiscal");
      if (verFiscal) {
        expect(sql).toContain("f.empresa_id = p.empresa_id");
        expect(sql).toContain("f.proveedor_id = p.id AND f.entidad_id = ?");
      } else {
        expect(sql).not.toMatch(/cxp_proveedor_fiscal|regimen_fiscal|sujeto_isr|cuenta_proveedor_id|cuenta_anticipo_id|cuenta_gasto_id|f\.activo/);
      }
      expect(sql).toContain("WHERE p.empresa_id = ?");
      const [entidad, empresa, search, searchName, searchNit, active] = verFiscal ? params : [undefined, ...params];
      expect(searchName).toBe(search); expect(searchNit).toBe(search);
      return providers.filter(p => p.empresa === empresa && (!active || p.activo === 1)
        && (!search || p.nombre.includes(String(search)) || p.nit?.includes(String(search))))
        .map(p => ({ id: p.id, nombre_comercial: p.nombre, nit: p.nit, dias_credito: 30, proveedor_activo: p.activo,
          ...(verFiscal ? configRow(configs.find(c => c.empresa === empresa && c.entidad === entidad && c.proveedor === p.id)) : {}) }));
    }
    if (/FROM cxp_proveedor_fiscal WHERE/.test(sql)) {
      expect(sql).toContain("empresa_id = ? AND entidad_id = ? AND proveedor_id = ?");
      const [empresa, entidad, proveedor] = params;
      const c = configs.find(c => c.empresa === empresa && c.entidad === entidad && c.proveedor === proveedor);
      return c ? [configRow(c)] : [];
    }
    if (/FROM cont_cuentas WHERE/.test(sql)) {
      expect(sql).toContain("empresa_id = ? AND entidad_id = ? AND activa = 1");
      const [empresa, entidad] = params;
      return configs.filter(c => c.empresa === empresa && c.entidad === entidad)
        .map(c => ({ id: c.account, codigo: "QA-ACCOUNT", nombre: "SYNTHETIC-ACCOUNT", tipo: "Pasivo" }));
    }
    throw new Error(`MIL-CXP-07: unexpected SQL boundary: ${sql.slice(0, 90)}`);
  });
});

const routes = ["list", "fiscal", "accounts"] as const;
async function call(route: (typeof routes)[number], options: { slug?: string; entity?: string; provider?: string; extra?: string } = {}) {
  const slug = options.slug ?? "qa-a";
  const suffix = route === "list" ? "proveedores" : route === "fiscal" ? `proveedores/${options.provider ?? "1001"}/fiscal` : "cuentas";
  const req = new Request(`http://isolated.invalid/api/empresas/${slug}/contabilidad/cxp/${suffix}?entidad=${options.entity ?? "11"}${options.extra ?? ""}`);
  if (route === "list") return listRoute(req, { params: Promise.resolve({ slug }) });
  if (route === "fiscal") return fiscalRoute(req, { params: Promise.resolve({ slug, id: options.provider ?? "1001" }) });
  return accountsRoute(req, { params: Promise.resolve({ slug }) });
}
const dataCalls = () => lab.query.mock.calls.filter(([sql]) => !/FROM usuario_modulo/.test(String(sql)));

describe("MIL-CXP-07 H-01: real route + guard + permission resolver + provider mapper, isolated infrastructure", () => {
  for (const p of profiles) for (const route of routes) {
    it(`${p.name}: GET ${route} enforces the fiscal visibility contract`, async () => {
      useProfile(p);
      const allowed = p.admin || (route === "list" ? p.invoices || p.fiscal : p.fiscal);
      const response = await call(route);
      expect(response.status).toBe(allowed ? 200 : 403);
      const body = await response.json();
      if (!allowed) {
        expect(dataCalls()).toHaveLength(0);
        expect(JSON.stringify(body)).not.toContain("11001");
      } else {
        expect(response.headers.get("cache-control")).toBe("private, no-store");
        if (route === "list") {
          expect(body.proveedores.map((x: { id: number }) => x.id)).toEqual([1001, 1002]);
          if (p.fiscal || p.admin) expect(body.proveedores[0].fiscal).toEqual({ proveedorId: 1001, entidadId: 11, regimenFiscal: "GENERAL",
            sujetoIsr: true, cuentaProveedorId: 11001, cuentaAnticipoId: 11002, cuentaGastoId: 11003, activo: true });
          else expect(body.proveedores[0].fiscal).toBeNull();
          expect(body.proveedores[1].fiscal).toBeNull();
        } else if (route === "fiscal") expect(body.config.cuentaProveedorId).toBe(11001);
        else expect(body.cuentas[0].id).toBe(11001);
      }
      expect(lab.forbiddenPool).not.toHaveBeenCalled();
    });
  }

  it("captures the corrected invoices-only projection and the denied direct fiscal route", async () => {
    useProfile(profiles[1]);
    const list = await call("list"), body = await list.json();
    const direct = await call("fiscal");
    expect(list.status).toBe(200); expect(direct.status).toBe(403);
    expect(body.proveedores[0].fiscal).toBeNull();
    mkdirSync("docs/MIL-CXP-07/FASE-2", { recursive: true });
    writeFileSync("docs/MIL-CXP-07/FASE-2/regresion-h01.json", JSON.stringify({
      synthetic: true, scope: "real route/tenant guard/permission resolver/mapper; synthetic session, memberships and DB query boundary",
      profile: "invoices-only", permissions: { cxp_facturas_ver: true, cxp_proveedor_fiscal_ver: false },
      listStatus: list.status, directFiscalStatus: direct.status, response: body,
      realDatabaseAccess: false, realNetworkHttp: false, securityAcceptance: "PASS: no fiscal configuration queried or disclosed without effective fiscal permission",
      syntheticQueryBoundaryCalls: dataCalls().map(([sql, params]) => ({ sql, params })),
    }, null, 2) + "\n");
  });

  it("REGRESSION H-01: security contract forbids fiscal configuration for invoices-only", async () => {
    useProfile(profiles[1]);
    const response = await call("list");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.proveedores[0]).not.toHaveProperty("fiscal.regimenFiscal");
    expect(body.proveedores[0]).toEqual({ id: 1001, nombre: "SYNTHETIC-A", nit: "QA-A", diasCredito: 30, activo: true, fiscal: null });
  });

  for (const route of routes) {
    it(`${route}: unauthenticated user is denied before data reads`, async () => {
      lab.session = null; expect((await call(route)).status).toBe(401); expect(dataCalls()).toHaveLength(0);
    });
    it(`${route}: another tenant is denied even with both CxP permissions`, async () => {
      expect((await call(route, { slug: "qa-b", entity: "21", provider: "2001" })).status).toBe(403);
      expect(dataCalls()).toHaveLength(0);
    });
    it(`${route}: admin does not bypass the tenant membership boundary`, async () => {
      useProfile(profiles[4]);
      expect((await call(route, { slug: "qa-b", entity: "21", provider: "2001" })).status).toBe(403);
      expect(dataCalls()).toHaveLength(0);
    });
    it(`${route}: nonexistent company returns 404 before data reads`, async () => {
      expect((await call(route, { slug: "missing" })).status).toBe(404); expect(dataCalls()).toHaveLength(0);
    });
    it(`${route}: inactive company is denied`, async () => {
      lab.active = false; expect((await call(route)).status).toBe(404); expect(dataCalls()).toHaveLength(0);
    });
    it(`${route}: company without Contabilidad denies non-admin`, async () => {
      lab.modules = ["tms"]; expect((await call(route)).status).toBe(403); expect(dataCalls()).toHaveLength(0);
    });
    it(`${route}: admin bypasses module permission according to the existing policy`, async () => {
      useProfile(profiles[4]); lab.modules = ["tms"]; expect((await call(route)).status).toBe(200);
    });
    for (const entity of ["0", "-1", "abc", "11&entidad=12", "2147483648"]) {
      it(`${route}: invalid/repeated entity ${entity} is rejected before data reads`, async () => {
        expect((await call(route, { entity })).status).toBe(400); expect(dataCalls()).toHaveLength(0);
      });
    }
  }

  it("entities within the authorized company return distinct fiscal configurations", async () => {
    const a = await (await call("list", { entity: "11" })).json();
    const b = await (await call("list", { entity: "12" })).json();
    expect(a.proveedores[0].fiscal.cuentaProveedorId).toBe(11001);
    expect(b.proveedores[0].fiscal.cuentaProveedorId).toBe(12001);
    expect(b.proveedores[0].fiscal.regimenFiscal).toBe("PEQUENO_CONTRIBUYENTE");
    expect(JSON.stringify(b)).not.toContain("21001");
  });
  it("foreign/nonexistent entity returns no foreign fiscal fields but is not rejected as 404", async () => {
    for (const entity of ["21", "999"]) {
      const response = await call("list", { entity });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.proveedores).toHaveLength(2);
      expect(body.proveedores.every((p: { fiscal: unknown }) => p.fiscal === null)).toBe(true);
      expect(JSON.stringify(body)).not.toContain("SYNTHETIC-B");
      expect((await (await call("fiscal", { entity, provider: "2001" })).json()).config).toBeNull();
      expect((await (await call("accounts", { entity })).json()).cuentas).toEqual([]);
    }
  });
  it("a permitted switch to another company scopes reads to that company", async () => {
    lab.allowed = [101, 202];
    const r = await call("list", { slug: "qa-b", entity: "21" });
    const body = await r.json();
    expect(body.proveedores.map((p: { id: number }) => p.id)).toEqual([2001]);
    expect(body.proveedores[0].fiscal.cuentaProveedorId).toBe(21001);
    expect(lab.cookie).toHaveBeenCalled();
  });
  it("client company/permission parameters do not replace server tenant or grants", async () => {
    useProfile(profiles[1]);
    const response = await call("list", { extra: "&empresa_id=202&verFiscal=1&usuarioId=999" });
    const body = await response.json();
    expect(body.proveedores.map((p: { id: number }) => p.id)).toEqual([1001, 1002]);
    expect(body.proveedores[0].fiscal).toBeNull();
    expect((await call("fiscal", { extra: "&verFiscal=1" })).status).toBe(403);
  });
  it("permission revocation takes effect on the next request in the isolated resolver", async () => {
    expect((await call("fiscal")).status).toBe(200);
    useProfile(profiles[1]); expect((await call("fiscal")).status).toBe(403);
    const body = await (await call("list")).json();
    expect(body.proveedores[0].fiscal).toBeNull();
  });

  it("default service projection is restrictive even if the query boundary supplies fiscal columns", async () => {
    lab.query.mockReset();
    lab.query.mockResolvedValueOnce([{ id: 1001, nombre_comercial: "SYNTHETIC-A", nit: "QA-A", dias_credito: 30,
      proveedor_activo: 1, ...configRow(configs[0]) }]);
    const rows = await listarProveedoresCxp(101, 11);
    expect(rows[0].fiscal).toBeNull();
    expect(String(lab.query.mock.calls[0][0])).not.toContain("cxp_proveedor_fiscal");
  });
  it("without fiscal permission the catalogue does not disclose configuration differences between entities", async () => {
    useProfile(profiles[1]);
    const a = await (await call("list", { entity: "11" })).json();
    const b = await (await call("list", { entity: "12" })).json();
    const c = await (await call("list", { entity: "999" })).json();
    expect(a).toEqual(b); expect(b).toEqual(c);
    for (const row of a.proveedores) expect(Object.keys(row).sort()).toEqual(["activo", "diasCredito", "fiscal", "id", "nit", "nombre"]);
  });
  it("V2 denial is not widened by a fiscal edit bit", async () => {
    useProfile(profiles[1]);
    lab.rows.find(r => r.modulo === "cxp_proveedor_fiscal")!.puede_editar = 1;
    const body = await (await call("list")).json();
    expect(body.proveedores[0].fiscal).toBeNull();
    expect((await call("fiscal")).status).toBe(403);
  });
  it("legacy effective read permission inferred from fiscal edit retains central policy", async () => {
    useProfile(profiles[1]);
    lab.rows = lab.rows.filter(r => r.modulo !== "permisos_acciones_v2");
    lab.rows.find(r => r.modulo === "cxp_proveedor_fiscal")!.puede_editar = 1;
    const body = await (await call("list")).json();
    expect(body.proveedores[0].fiscal.regimenFiscal).toBe("GENERAL");
    expect((await call("fiscal")).status).toBe(200);
  });
});
