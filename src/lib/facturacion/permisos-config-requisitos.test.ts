import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ getSession: vi.fn(), createSessionToken: vi.fn(), setSessionCookie: vi.fn() }));
vi.mock("@/lib/empresas", () => ({ obtenerEmpresaPorSlug: vi.fn(), empresasParaUsuario: vi.fn() }));
vi.mock("@/lib/permisos", async (original) => ({ ...await original<typeof import("@/lib/permisos")>(), permisosEfectivos: vi.fn() }));
vi.mock("@/lib/clientes/schema", () => ({
  asegurarSchemaClientes: vi.fn(async () => undefined),
  asegurarModulosClientesFacturacion: vi.fn(async () => undefined),
}));
vi.mock("@/lib/facturacion/schema", () => ({ asegurarSchemaFacturacion: vi.fn(async () => undefined) }));
vi.mock("@/lib/clientes/repository", () => ({ obtenerCliente: vi.fn(async () => ({ id: 5, nombre: "Cliente" })) }));
vi.mock("@/lib/facturacion/contexto-factura", () => ({
  leerRetencionIvaCliente: vi.fn(async () => 15),
  guardarRetencionIvaCliente: vi.fn(async () => undefined),
  esEsquemaPendiente: vi.fn(() => false),
  MENSAJE_FALTA_MIGRACION_FACT4: "Falta aplicar la migración FACT-4.",
}));
vi.mock("@/lib/facturacion/repository", () => ({
  obtenerPerfilEmpresa: vi.fn(async () => ({ respuestas: {}, completadoPct: 0 })),
  guardarPerfilEmpresa: vi.fn(async () => ({ completadoPct: 10 })),
  resumenPerfilesClientes: vi.fn(async () => []),
  obtenerPerfilCliente: vi.fn(async () => ({ respuestas: {}, completadoPct: 0 })),
  guardarPerfilCliente: vi.fn(async () => ({ completadoPct: 10 })),
}));

import { getSession } from "@/lib/session";
import { obtenerEmpresaPorSlug, empresasParaUsuario } from "@/lib/empresas";
import { permisosEfectivos } from "@/lib/permisos";
import { guardarPerfilCliente, guardarPerfilEmpresa } from "@/lib/facturacion/repository";
import { guardarRetencionIvaCliente } from "@/lib/facturacion/contexto-factura";
import {
  CATALOGO_PERMISOS, VERSION_PERMISOS, adaptarPermisosLegacy, cambiarAccion, normalizarMatriz, tieneAccionCatalogo,
} from "@/lib/permisos-catalogo";
import type { PermisoModulo } from "@/lib/permisos-shared";
import { capacidadesFacturacion } from "@/lib/facturacion/capacidades";
import { requireTenantFacturacion } from "@/lib/tenant";
import { GET as getEmpresa, PUT as putEmpresa } from "@/app/api/empresas/[slug]/facturacion/empresa/route";
import { GET as getClientes } from "@/app/api/empresas/[slug]/facturacion/clientes/route";
import { GET as getCliente, PUT as putCliente } from "@/app/api/empresas/[slug]/facturacion/clientes/[clienteId]/route";

const p = (modulo: string, flags: Partial<PermisoModulo> = {}): PermisoModulo =>
  ({ modulo, puedeVer: false, puedeCrear: false, puedeEditar: false, puedeEliminar: false, ...flags });
const V2 = p(VERSION_PERMISOS, { puedeVer: true });
const verFact = p("facturacion", { puedeVer: true });
const empresa = { id: 7, slug: "kt", nombre: "KT", activa: true, modulos: ["tms", "facturacion"] };
const ctx = { params: Promise.resolve({ slug: "kt" }) };
const ctxCliente = { params: Promise.resolve({ slug: "kt", clienteId: "5" }) };
const put = (body: unknown = { respuestas: { a: "b" } }) =>
  new Request("http://local", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** Usuario «tipo mcaal»: rol AuxiliarOperaciones, SIN username especial. */
function sesion(rol: string, permisos: PermisoModulo[], adaptar = true) {
  vi.mocked(getSession).mockResolvedValue({ id: 3, rol, username: "fixture", empresaId: 7 } as never);
  // permisosEfectivos ya devuelve la matriz adaptada con el rol: se reproduce igual.
  vi.mocked(permisosEfectivos).mockResolvedValue(adaptar ? adaptarPermisosLegacy(permisos, rol) : permisos);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(obtenerEmpresaPorSlug).mockResolvedValue(empresa as never);
  vi.mocked(empresasParaUsuario).mockResolvedValue([empresa] as never);
});

describe("catálogo: acciones de Configuración empresa / Requisitos clientes", () => {
  const fact = CATALOGO_PERMISOS.find((m) => m.id === "facturacion")!;
  it("conserva las acciones existentes y agrega las cuatro nuevas dentro de Facturación clientes (Contabilidad / Facturación)", () => {
    expect(fact.area).toBe("contabilidad");
    expect(fact.label).toBe("Facturación clientes");
    expect(fact.acciones.map((a) => a.id)).toEqual([
      "ver", "crear", "editar", "emitir", "anular", "pagos",
      "ver_empresa", "editar_empresa", "ver_requisitos", "editar_requisitos",
    ]);
    expect(fact.acciones.filter((a) => a.id.endsWith("_empresa") || a.id.endsWith("_requisitos")).map((a) => a.label)).toEqual([
      "Ver configuración de facturación de la empresa",
      "Editar configuración de facturación de la empresa",
      "Ver requisitos de facturación de clientes",
      "Editar requisitos de facturación de clientes",
    ]);
  });
  it("las filas persistidas caben en usuario_modulo.modulo (VARCHAR(40)) y no reutilizan «emitir»", () => {
    const nuevas = fact.acciones.filter((a) => /_(empresa|requisitos)$/.test(a.id));
    for (const a of nuevas) {
      expect(a.modulo.length).toBeLessThanOrEqual(40);
      expect(a.modulo).not.toBe("facturacion_emitir");
      expect(a.legacy).toBeUndefined(); // sin fallback a facturacion:editar
    }
    expect(new Set(nuevas.map((a) => a.modulo))).toEqual(new Set(["facturacion_empresa", "facturacion_clientes_requisitos"]));
  });
  it("se agrupan visualmente en dos subbloques sin salir del módulo", () => {
    const grupos = fact.acciones.filter((a) => a.grupo).map((a) => a.grupo);
    expect(grupos).toEqual(["Configuración de la empresa", "Configuración de la empresa", "Requisitos de clientes", "Requisitos de clientes"]);
  });
});

describe("dependencias (mismo mecanismo central, #411)", () => {
  const tiene = (m: PermisoModulo[], id: string) => tieneAccionCatalogo(m, "facturacion", id);
  it.each(["ver_empresa", "editar_empresa", "ver_requisitos", "editar_requisitos"])("activar %s activa «Ver» de Facturación", (id) => {
    const m = cambiarAccion([V2], "facturacion", id, true);
    expect(tiene(m, "ver")).toBe(true);
    expect(tiene(m, id)).toBe(true);
  });
  it("activar «Editar» implica «Ver» de su sección y no de la otra", () => {
    const m = cambiarAccion([V2], "facturacion", "editar_empresa", true);
    expect(tiene(m, "ver_empresa")).toBe(true);
    expect(tiene(m, "ver_requisitos")).toBe(false);
    expect(tiene(m, "editar_requisitos")).toBe(false);
  });
  it("quitar «Ver» de una sección limpia su «Editar» sin tocar la otra sección", () => {
    let m = cambiarAccion([V2], "facturacion", "editar_empresa", true);
    m = cambiarAccion(m, "facturacion", "editar_requisitos", true);
    m = cambiarAccion(m, "facturacion", "ver_empresa", false);
    expect(tiene(m, "ver_empresa")).toBe(false);
    expect(tiene(m, "editar_empresa")).toBe(false);
    expect(tiene(m, "ver_requisitos")).toBe(true);
    expect(tiene(m, "editar_requisitos")).toBe(true);
  });
  it("quitar «Ver Facturación» limpia TODAS las acciones dependientes", () => {
    let m: PermisoModulo[] = [V2];
    for (const id of ["crear", "editar", "emitir", "anular", "pagos", "editar_empresa", "editar_requisitos"]) m = cambiarAccion(m, "facturacion", id, true);
    m = cambiarAccion(m, "facturacion", "ver", false);
    for (const a of CATALOGO_PERMISOS.find((x) => x.id === "facturacion")!.acciones) expect(tiene(m, a.id)).toBe(false);
  });
  it("son independientes de emitir/anular/pagos: ninguna activa a la otra", () => {
    const emitir = cambiarAccion([V2], "facturacion", "emitir", true);
    expect(tiene(emitir, "ver_empresa") || tiene(emitir, "editar_empresa") || tiene(emitir, "ver_requisitos") || tiene(emitir, "editar_requisitos")).toBe(false);
    const config = cambiarAccion([V2], "facturacion", "editar_empresa", true);
    expect(tiene(config, "emitir") || tiene(config, "anular") || tiene(config, "pagos") || tiene(config, "editar")).toBe(false);
  });
  it("normalizarMatriz (guardado) repara «Editar» sin «Ver» y «Editar» sin Ver Facturación", () => {
    const m = normalizarMatriz([V2, p("facturacion_empresa", { puedeEditar: true })]);
    expect(tiene(m, "ver")).toBe(true);
    expect(tiene(m, "ver_empresa")).toBe(true);
    expect(tiene(m, "editar_empresa")).toBe(true);
  });
});

describe("capacidadesFacturacion — fuente de verdad: permisos, no rol", () => {
  const sinNada = { verEmpresa: false, editarEmpresa: false, verClientes: false, editarClientes: false };
  it("Admin: todo", () => {
    expect(capacidadesFacturacion([], "Admin")).toEqual({ verEmpresa: true, editarEmpresa: true, verClientes: true, editarClientes: true });
  });
  it("sin permiso base de Facturación no hay ninguna capacidad (aunque existan las filas)", () => {
    const m = [V2, p("facturacion_empresa", { puedeVer: true, puedeEditar: true }), p("facturacion_clientes_requisitos", { puedeVer: true, puedeEditar: true })];
    expect(capacidadesFacturacion(m, "AuxiliarOperaciones")).toEqual(sinNada);
  });
  it("AuxiliarOperaciones + ver + ver/editar configuración empresa => abre y guarda Configuración empresa", () => {
    const m = adaptarPermisosLegacy([V2, verFact, p("facturacion_empresa", { puedeVer: true, puedeEditar: true })], "AuxiliarOperaciones");
    expect(capacidadesFacturacion(m, "AuxiliarOperaciones")).toEqual({ verEmpresa: true, editarEmpresa: true, verClientes: false, editarClientes: false });
  });
  it("mismo rol + solo ver configuración => solo lectura (no guarda)", () => {
    const m = adaptarPermisosLegacy([V2, verFact, p("facturacion_empresa", { puedeVer: true })], "AuxiliarOperaciones");
    expect(capacidadesFacturacion(m, "AuxiliarOperaciones")).toEqual({ verEmpresa: true, editarEmpresa: false, verClientes: false, editarClientes: false });
  });
  it("«Editar» sin «Ver» de la sección no concede nada", () => {
    const m = [V2, verFact, p("facturacion_empresa", { puedeEditar: true })];
    expect(capacidadesFacturacion(m, "AuxiliarOperaciones").verEmpresa).toBe(false);
    expect(capacidadesFacturacion(m, "AuxiliarOperaciones").editarEmpresa).toBe(false);
  });
  it("emitir factura SIN ver configuración => puede emitir pero no ver Configuración empresa ni Requisitos", () => {
    const m = adaptarPermisosLegacy([V2, verFact, p("facturacion_emitir", { puedeVer: true })], "AuxiliarOperaciones");
    expect(tieneAccionCatalogo(m, "facturacion", "emitir")).toBe(true);
    expect(capacidadesFacturacion(m, "AuxiliarOperaciones")).toEqual(sinNada);
  });
  it("«Editar factura borrador» (facturacion:editar) tampoco concede la configuración", () => {
    const m = adaptarPermisosLegacy([V2, p("facturacion", { puedeVer: true, puedeCrear: true, puedeEditar: true })], "AuxiliarOperaciones");
    expect(capacidadesFacturacion(m, "AuxiliarOperaciones")).toEqual(sinNada);
  });
  it("las dos secciones son independientes entre sí", () => {
    const m = adaptarPermisosLegacy([V2, verFact, p("facturacion_clientes_requisitos", { puedeVer: true, puedeEditar: true })], "AuxiliarOperaciones");
    expect(capacidadesFacturacion(m, "AuxiliarOperaciones")).toEqual({ verEmpresa: false, editarEmpresa: false, verClientes: true, editarClientes: true });
  });
});

describe("compatibilidad legacy (equivalencias por rol que se preservan)", () => {
  const caps = (rol: string, permisos: PermisoModulo[]) => capacidadesFacturacion(adaptarPermisosLegacy(permisos, rol), rol);
  const legacy = [verFact]; // matriz anterior a la V2: sin marcador
  it("Contabilidad: ver/editar configuración de la empresa", () => {
    expect(caps("Contabilidad", legacy)).toEqual({ verEmpresa: true, editarEmpresa: true, verClientes: false, editarClientes: false });
  });
  it("Operaciones: ver/editar requisitos de clientes", () => {
    expect(caps("Operaciones", legacy)).toEqual({ verEmpresa: false, editarEmpresa: false, verClientes: true, editarClientes: true });
  });
  it("Visualizador: lectura de ambas", () => {
    expect(caps("Visualizador", legacy)).toEqual({ verEmpresa: true, editarEmpresa: false, verClientes: true, editarClientes: false });
  });
  it("Facturador: conserva la lectura de requisitos de clientes", () => {
    expect(caps("Facturador", legacy)).toEqual({ verEmpresa: false, editarEmpresa: false, verClientes: true, editarClientes: false });
  });
  it.each(["AuxiliarOperaciones", "JefeOperaciones", "GerenteOperaciones"])("%s: sin equivalencia legacy (nada que preservar)", (rol) => {
    expect(caps(rol, legacy)).toEqual({ verEmpresa: false, editarEmpresa: false, verClientes: false, editarClientes: false });
  });
  it("la equivalencia legacy exige «Ver Facturación» (como antes: menú, página y API)", () => {
    expect(caps("Contabilidad", [p("facturacion")])).toEqual({ verEmpresa: false, editarEmpresa: false, verClientes: false, editarClientes: false });
  });
  it("una V2 ya guardada SIN estas filas no pierde el acceso que tenía por rol (se materializan)", () => {
    expect(caps("Contabilidad", [V2, verFact])).toEqual({ verEmpresa: true, editarEmpresa: true, verClientes: false, editarClientes: false });
  });
  it("con filas V2 EXPLÍCITAS la matriz es la fuente de verdad: negar quita lo que el rol daba", () => {
    const negada = [V2, verFact, p("facturacion_empresa"), p("facturacion_clientes_requisitos")];
    expect(caps("Contabilidad", negada)).toEqual({ verEmpresa: false, editarEmpresa: false, verClientes: false, editarClientes: false });
    const soloLectura = [V2, verFact, p("facturacion_empresa", { puedeVer: true })];
    expect(caps("Contabilidad", soloLectura).editarEmpresa).toBe(false);
    expect(caps("Contabilidad", soloLectura).verEmpresa).toBe(true);
  });
  it("y conceder desde la matriz funciona aunque el rol no lo diera (Operaciones + configuración empresa)", () => {
    expect(caps("Operaciones", [V2, verFact, p("facturacion_empresa", { puedeVer: true, puedeEditar: true })]).editarEmpresa).toBe(true);
  });
  it("la edición de la matriz conserva lo heredado por rol (guardar no lo borra en silencio)", () => {
    // Usuarios muestra lo derivado del rol y, al guardar, queda como filas explícitas.
    const mostrada = adaptarPermisosLegacy(legacy, "Contabilidad");
    expect(tieneAccionCatalogo(mostrada, "facturacion", "editar_empresa")).toBe(true);
    const guardada = normalizarMatriz(mostrada);
    expect(capacidadesFacturacion(adaptarPermisosLegacy(guardada, "Contabilidad"), "Contabilidad").editarEmpresa).toBe(true);
  });
});

describe("backend: guard de los endpoints (403 sin permiso, aunque la pestaña esté oculta)", () => {
  const ROL = "AuxiliarOperaciones";
  it("requireTenantFacturacion con las 4 acciones nuevas: solo con su permiso (y Ver Facturación)", async () => {
    sesion(ROL, [V2, verFact]);
    for (const a of ["ver_empresa", "editar_empresa", "ver_requisitos", "editar_requisitos"] as const) {
      expect((await requireTenantFacturacion("kt", a)).error?.status).toBe(403);
    }
    sesion(ROL, [V2, verFact, p("facturacion_empresa", { puedeVer: true, puedeEditar: true }), p("facturacion_clientes_requisitos", { puedeVer: true })]);
    for (const a of ["ver_empresa", "editar_empresa", "ver_requisitos"] as const) expect((await requireTenantFacturacion("kt", a)).error).toBeUndefined();
    expect((await requireTenantFacturacion("kt", "editar_requisitos")).error?.status).toBe(403);
  });

  it("sin permiso: GET y PUT de configuración de la empresa y de requisitos devuelven 403 y NO guardan", async () => {
    sesion(ROL, [V2, verFact, p("facturacion_emitir", { puedeVer: true })]);
    expect((await getEmpresa(new Request("http://local"), ctx)).status).toBe(403);
    expect((await putEmpresa(put(), ctx)).status).toBe(403);
    expect((await getClientes(new Request("http://local"), ctx)).status).toBe(403);
    expect((await getCliente(new Request("http://local"), ctxCliente)).status).toBe(403);
    expect((await putCliente(put(), ctxCliente)).status).toBe(403);
    expect(guardarPerfilEmpresa).not.toHaveBeenCalled();
    expect(guardarPerfilCliente).not.toHaveBeenCalled();
  });

  it("caso mcaal: AuxiliarOperaciones + ver + ver/editar configuración empresa => GET 200 y PUT guarda", async () => {
    sesion(ROL, [V2, verFact, p("facturacion_empresa", { puedeVer: true, puedeEditar: true })]);
    expect((await getEmpresa(new Request("http://local"), ctx)).status).toBe(200);
    const r = await putEmpresa(put(), ctx);
    expect(r.status).toBe(200);
    expect(guardarPerfilEmpresa).toHaveBeenCalledOnce();
    // …pero no los requisitos de clientes (sección independiente)
    expect((await getClientes(new Request("http://local"), ctx)).status).toBe(403);
    expect((await putCliente(put(), ctxCliente)).status).toBe(403);
  });

  it("mismo rol + solo ver configuración => lee (200) pero PUT es 403", async () => {
    sesion(ROL, [V2, verFact, p("facturacion_empresa", { puedeVer: true })]);
    expect((await getEmpresa(new Request("http://local"), ctx)).status).toBe(200);
    expect((await putEmpresa(put(), ctx)).status).toBe(403);
    expect(guardarPerfilEmpresa).not.toHaveBeenCalled();
  });

  it("requisitos de clientes: ver permite GET, editar permite PUT", async () => {
    sesion(ROL, [V2, verFact, p("facturacion_clientes_requisitos", { puedeVer: true })]);
    expect((await getClientes(new Request("http://local"), ctx)).status).toBe(200);
    expect((await getCliente(new Request("http://local"), ctxCliente)).status).toBe(200);
    expect((await putCliente(put(), ctxCliente)).status).toBe(403);
    sesion(ROL, [V2, verFact, p("facturacion_clientes_requisitos", { puedeVer: true, puedeEditar: true })]);
    expect((await putCliente(put(), ctxCliente)).status).toBe(200);
    expect(guardarPerfilCliente).toHaveBeenCalledOnce();
  });

  it("FACT-4: la retención de IVA del cliente (0/15/30) se guarda con el MISMO permiso «Editar requisitos de clientes»", async () => {
    sesion(ROL, [V2, verFact, p("facturacion_clientes_requisitos", { puedeVer: true })]);
    expect((await putCliente(put({ respuestas: {}, retencionIvaPct: 30 }), ctxCliente)).status).toBe(403);
    expect(guardarRetencionIvaCliente).not.toHaveBeenCalled();
    sesion(ROL, [V2, verFact, p("facturacion_clientes_requisitos", { puedeVer: true, puedeEditar: true })]);
    expect((await putCliente(put({ respuestas: {}, retencionIvaPct: 30 }), ctxCliente)).status).toBe(200);
    expect(guardarRetencionIvaCliente).toHaveBeenCalledWith(7, 5, 30, 3);
  });

  it("FACT-4: solo 0, 15 o 30; cualquier otro valor es 400 y no guarda nada", async () => {
    sesion("Admin", [], false);
    for (const v of [10, 12, 25, -15, "15", null]) {
      expect((await putCliente(put({ respuestas: {}, retencionIvaPct: v }), ctxCliente)).status, String(v)).toBe(400);
    }
    expect(guardarPerfilCliente).not.toHaveBeenCalled();
    expect(guardarRetencionIvaCliente).not.toHaveBeenCalled();
  });

  it("FACT-4: omitir retencionIvaPct NO la modifica (el cuestionario se guarda igual que antes)", async () => {
    sesion("Admin", [], false);
    expect((await putCliente(put({ respuestas: { a: "b" } }), ctxCliente)).status).toBe(200);
    expect(guardarPerfilCliente).toHaveBeenCalledOnce();
    expect(guardarRetencionIvaCliente).not.toHaveBeenCalled();
  });

  it("emitir factura sin ver configuración: el guard de emitir pasa y el de configuración no", async () => {
    sesion(ROL, [V2, verFact, p("facturacion_emitir", { puedeVer: true })]);
    expect((await requireTenantFacturacion("kt", "emitir")).error).toBeUndefined();
    expect((await getEmpresa(new Request("http://local"), ctx)).status).toBe(403);
  });

  it("sin «Ver Facturación» no hay acceso aunque existan las filas de configuración", async () => {
    sesion(ROL, [V2, p("facturacion_empresa", { puedeVer: true, puedeEditar: true })]);
    expect((await getEmpresa(new Request("http://local"), ctx)).status).toBe(403);
    expect((await putEmpresa(put(), ctx)).status).toBe(403);
  });

  it("Admin: ve y edita ambas secciones", async () => {
    sesion("Admin", [], false);
    expect((await getEmpresa(new Request("http://local"), ctx)).status).toBe(200);
    expect((await putEmpresa(put(), ctx)).status).toBe(200);
    expect((await putCliente(put(), ctxCliente)).status).toBe(200);
  });

  it("compatibilidad: Contabilidad legacy sigue editando la empresa y no los requisitos; Operaciones al revés", async () => {
    sesion("Contabilidad", [verFact]);
    expect((await putEmpresa(put(), ctx)).status).toBe(200);
    expect((await getClientes(new Request("http://local"), ctx)).status).toBe(403);
    sesion("Operaciones", [verFact]);
    expect((await putCliente(put(), ctxCliente)).status).toBe(200);
    expect((await getEmpresa(new Request("http://local"), ctx)).status).toBe(403);
  });

  it("el tenant ajeno sigue bloqueado y la empresa sin módulo Facturación también", async () => {
    sesion(ROL, [V2, verFact, p("facturacion_empresa", { puedeVer: true, puedeEditar: true })]);
    vi.mocked(obtenerEmpresaPorSlug).mockResolvedValue({ ...empresa, modulos: ["rrhh"] } as never);
    expect((await putEmpresa(put(), ctx)).status).toBe(403);
    vi.mocked(obtenerEmpresaPorSlug).mockResolvedValue(empresa as never);
    vi.mocked(empresasParaUsuario).mockResolvedValue([]);
    expect((await getEmpresa(new Request("http://local"), ctx)).status).toBe(403);
  });
});

describe("cableado: ningún guard de estas secciones depende ya del rol", () => {
  const leer = (ruta: string) => readFileSync(ruta, "utf8");
  it("página, sidebar y los 3 endpoints usan permisos (capacidadesFacturacion / requireFacturacionConfig), no alcanceFacturacion(rol)", () => {
    for (const ruta of [
      "src/app/e/[slug]/facturacion/page.tsx",
      "src/components/app-shell.tsx",
      "src/app/api/empresas/[slug]/facturacion/empresa/route.ts",
      "src/app/api/empresas/[slug]/facturacion/clientes/route.ts",
      "src/app/api/empresas/[slug]/facturacion/clientes/[clienteId]/route.ts",
    ]) {
      expect(leer(ruta), ruta).not.toMatch(/alcanceFacturacion\s*\(/);
    }
    expect(leer("src/app/e/[slug]/facturacion/page.tsx")).toContain("capacidadesFacturacion(permisos, session.rol)");
    expect(leer("src/components/app-shell.tsx")).toContain("capacidadesFacturacion(permisos, rol)");
  });
  it("cada método exige su permiso específico (GET ver, PUT editar)", () => {
    const emp = leer("src/app/api/empresas/[slug]/facturacion/empresa/route.ts");
    expect(emp).toContain('requireFacturacionConfig(slug, "ver_empresa")');
    expect(emp).toContain('requireFacturacionConfig(slug, "editar_empresa")');
    const cli = leer("src/app/api/empresas/[slug]/facturacion/clientes/route.ts");
    expect(cli).toContain('requireFacturacionConfig(slug, "ver_requisitos")');
    const cliId = leer("src/app/api/empresas/[slug]/facturacion/clientes/[clienteId]/route.ts");
    expect(cliId).toContain('requireFacturacionConfig(slug, "ver_requisitos")');
    expect(cliId).toContain('requireFacturacionConfig(slug, "editar_requisitos")');
  });
  it("el cliente muestra solo las pestañas permitidas y guarda solo con editar (solo lectura con ver)", () => {
    const c = leer("src/components/facturacion/facturacion-client.tsx");
    expect(c).toContain("if (verEmpresa) {");
    expect(c).toContain("if (verClientes) {");
    expect(c).toContain('(tab === "empresa" && editarEmpresa)');
    expect(c).toContain("readOnly={!puedeGuardar}");
  });
});
