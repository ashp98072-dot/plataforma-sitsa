import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const conn = vi.hoisted(() => ({ beginTransaction: vi.fn(), query: vi.fn(), execute: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() }));
vi.mock("@/lib/db", () => ({ getPool: () => ({ getConnection: async () => conn }), query: vi.fn(), execute: vi.fn() }));
vi.mock("@/lib/session", () => ({ getSession: vi.fn(), createSessionToken: vi.fn(), setSessionCookie: vi.fn() }));
vi.mock("@/lib/empresas", () => ({ obtenerEmpresaPorSlug: vi.fn(), empresasParaUsuario: vi.fn() }));
vi.mock("@/lib/permisos", async (original) => ({ ...(await original<typeof import("@/lib/permisos")>()), permisosEfectivos: vi.fn() }));
import { guardarPermisosUsuario, permisosEfectivos } from "@/lib/permisos";
import { sesionPuedeEditarVehiculosOtrasEmpresas } from "@/lib/tenant";
import {
  AREAS_PERMISOS, CATALOGO_PERMISOS, VERSION_PERMISOS, adaptarPermisosLegacy, cambiarAccion, materializarAcciones, normalizarMatriz, tieneAccionCatalogo, tienePermisoBase,
} from "@/lib/permisos-catalogo";
import { PERMISO_FLOTA_VEHICULOS_OTRAS_EMPRESAS, PLATAFORMA_PERMISIBLES, moduloEmpresaDelPermiso, modulosPlataformaDesdePermisos, permisosDefaultPorRol, type PermisoModulo } from "@/lib/permisos-shared";
import { ROLES } from "@/lib/roles";
import { MENSAJE_SOLO_EMPRESA_DUENA } from "./edicion-vehiculo";

/**
 * FLOTA — «Editar vehículos de otras empresas» integrado al catálogo central de permisos del PR #411 (Flota / Predios → Vehículos):
 * mismas dependencias Ver ↔ acción, misma persistencia V2, mismo modelo de sidebar. Sin lógica paralela en permisos-shared.
 */
const FILA = PERMISO_FLOTA_VEHICULOS_OTRAS_EMPRESAS; // flota_vehiculos_otras_empresas (se conserva el identificador funcional)
const p = (modulo: string, flags: Partial<PermisoModulo> = {}): PermisoModulo => ({ modulo, puedeVer: false, puedeCrear: false, puedeEditar: false, puedeEliminar: false, ...flags });
const fila = (permisos: PermisoModulo[], modulo: string) => permisos.find((x) => x.modulo === modulo);
const vehiculos = () => CATALOGO_PERMISOS.find((m) => m.id === "flota_vehiculos")!;
const ACCION = "editar_otras_empresas";

beforeEach(() => vi.resetAllMocks());

describe("A. el permiso vive en Flota / Predios → Vehículos del catálogo central", () => {
  it("es una acción de «Vehículos» (área Flota / Predios) con la etiqueta, la descripción y la fila persistida pedidas", () => {
    expect(vehiculos().label).toBe("Vehículos");
    expect(vehiculos().area).toBe("flota");
    expect(AREAS_PERMISOS.find((a) => a.id === "flota")!.titulo).toBe("Flota / Predios");
    const a = vehiculos().acciones.find((x) => x.id === ACCION)!;
    expect(a).toMatchObject({ label: "Editar vehículos de otras empresas", modulo: FILA, flag: "puedeEditar" });
    expect(a.descripcion).toBe("Permite editar vehículos compartidos de otras empresas cuando son accesibles desde la empresa activa.");
  });
  it("no se duplica: solo existe en Vehículos y las demás acciones de Vehículos no cambian", () => {
    const ids = CATALOGO_PERMISOS.flatMap((m) => m.acciones.filter((a) => a.modulo === FILA).map(() => m.id));
    expect(ids).toEqual(["flota_vehiculos"]);
    expect(vehiculos().acciones.map((a) => a.id)).toEqual(["ver", "registrar", "editar", "desactivar", ACCION]);
  });
  it("se conserva el identificador funcional (no se renombra) y sigue registrado como permiso de plataforma, dependiente del módulo de empresa «flota»", () => {
    expect(FILA).toBe("flota_vehiculos_otras_empresas");
    expect(PLATAFORMA_PERMISIBLES).toContain(FILA);
    expect(moduloEmpresaDelPermiso(FILA)).toBe("flota");
  });
  it("la lógica vieja de la matriz no se duplica en permisos-shared (sin etiqueta/descripcion/grupo propios del permiso)", () => {
    const shared = readFileSync("src/lib/permisos-shared.ts", "utf8");
    expect(shared).not.toContain("descripcionPermiso");
    expect(shared).not.toContain("Editar vehículos de otras empresas");
    expect(shared).not.toContain("permiso transversal");
  });
});

describe("B. dependencias: activar la acción implica «Ver vehículos»", () => {
  it("activar «Editar vehículos de otras empresas» activa Ver en Vehículos (y la fila propia)", () => {
    const r = cambiarAccion([], "flota_vehiculos", ACCION, true);
    expect(tieneAccionCatalogo(r, "flota_vehiculos", ACCION)).toBe(true);
    expect(fila(r, "flota_vehiculos")).toMatchObject({ puedeVer: true });
    expect(fila(r, FILA)).toMatchObject({ puedeVer: true, puedeEditar: true, puedeCrear: false, puedeEliminar: false });
    expect(tienePermisoBase(r, "flota_vehiculos")).toBe(true);
  });
  it("no activa otras acciones de Vehículos (ni «Editar vehículo»): el permiso es aditivo", () => {
    const r = cambiarAccion([], "flota_vehiculos", ACCION, true);
    for (const id of ["registrar", "editar", "desactivar"]) expect(tieneAccionCatalogo(r, "flota_vehiculos", id), id).toBe(false);
  });
});

describe("C. quitar «Ver vehículos» limpia la acción transversal", () => {
  it("al desmarcar Ver se limpian la acción y su fila, sin tocar otros módulos de Flota", () => {
    let r = cambiarAccion([], "flota_servicios", "ver", true);
    r = cambiarAccion(r, "flota_vehiculos", ACCION, true);
    expect(tieneAccionCatalogo(r, "flota_vehiculos", ACCION)).toBe(true);
    r = cambiarAccion(r, "flota_vehiculos", "ver", false);
    expect(tieneAccionCatalogo(r, "flota_vehiculos", ACCION)).toBe(false);
    expect(fila(r, FILA)).toMatchObject({ puedeVer: false, puedeEditar: false });
    expect(fila(r, "flota_vehiculos")).toMatchObject({ puedeVer: false });
    expect(fila(r, "flota_servicios")).toMatchObject({ puedeVer: true }); // otro módulo intacto
  });
  it("desmarcar solo la acción no quita Ver vehículos", () => {
    let r = cambiarAccion([], "flota_vehiculos", ACCION, true);
    r = cambiarAccion(r, "flota_vehiculos", ACCION, false);
    expect(tieneAccionCatalogo(r, "flota_vehiculos", ACCION)).toBe(false);
    expect(tienePermisoBase(r, "flota_vehiculos")).toBe(true);
  });
});

describe("D. persistencia V2 conserva la acción", () => {
  it("guardar la matriz escribe la fila con puede_editar = 1 y la base Ver, junto con el marcador V2, en una sola transacción", async () => {
    const matriz = cambiarAccion([], "flota_vehiculos", ACCION, true);
    await guardarPermisosUsuario(10, matriz);
    expect(conn.commit).toHaveBeenCalledOnce();
    const inserts = conn.execute.mock.calls.filter((c) => String(c[0]).includes("INSERT")).map((c) => c[1] as unknown[]);
    expect(inserts).toContainEqual([10, FILA, 1, 0, 1, 0]);
    expect(inserts).toContainEqual([10, "flota_vehiculos", 1, 0, 0, 0]);
    expect(inserts).toContainEqual([10, VERSION_PERMISOS, 1, 0, 0, 0]);
  });
  it("una fila de acción sin Ver (matriz inconsistente) se normaliza al guardar: se agrega la base", async () => {
    await guardarPermisosUsuario(10, [p(FILA, { puedeEditar: true })]);
    const inserts = conn.execute.mock.calls.filter((c) => String(c[0]).includes("INSERT")).map((c) => c[1] as unknown[]);
    expect(inserts).toContainEqual([10, "flota_vehiculos", 1, 0, 0, 0]);
    expect(inserts).toContainEqual([10, FILA, 1, 0, 1, 0]);
  });
  it("la clave persistida cabe en usuario_modulo.modulo (VARCHAR(40)) y no requiere SQL", () => {
    expect(FILA.length).toBeLessThanOrEqual(40);
    expect(readFileSync("sql/schema.sql", "utf8")).toMatch(/usuario_modulo \(\n?[\s\S]*?modulo VARCHAR\(40\) NOT NULL/);
  });
  it("leer una matriz guardada conserva la acción (adaptar/materializar no la pierden)", () => {
    const guardada = [p(VERSION_PERMISOS, { puedeVer: true }), p("flota_vehiculos", { puedeVer: true }), p(FILA, { puedeVer: true, puedeEditar: true })];
    expect(tieneAccionCatalogo(adaptarPermisosLegacy(guardada), "flota_vehiculos", ACCION)).toBe(true);
    expect(tieneAccionCatalogo(materializarAcciones(guardada), "flota_vehiculos", ACCION)).toBe(true);
    expect(tieneAccionCatalogo(normalizarMatriz(guardada), "flota_vehiculos", ACCION)).toBe(true);
  });
  it("ningún rol la trae por defecto (la matriz por defecto no concede edición cruzada)", () => {
    for (const rol of ROLES.filter((r) => r !== "Admin")) {
      expect(tieneAccionCatalogo(adaptarPermisosLegacy(permisosDefaultPorRol(rol), rol), "flota_vehiculos", ACCION), rol).toBe(false);
    }
  });
});

describe("E. sidebar y guard: la acción sin «Ver vehículos» no genera acceso", () => {
  const soloAccion = [p(VERSION_PERMISOS, { puedeVer: true }), p(FILA, { puedeVer: true, puedeEditar: true })];
  it("tener solo la fila de la acción NO da base en Vehículos ni hace aparecer Flota (el sidebar usa la base por módulo)", () => {
    expect(tienePermisoBase(soloAccion, "flota_vehiculos")).toBe(false);
    expect(tienePermisoBase(soloAccion, "flota")).toBe(false);
    expect(modulosPlataformaDesdePermisos(soloAccion)).not.toContain("flota");
    expect(modulosPlataformaDesdePermisos(soloAccion)).not.toContain(FILA);
  });
  it("sesionPuedeEditarVehiculosOtrasEmpresas: Admin sí (bypass existente); con Ver+acción sí; solo acción no; solo Ver no; sin nada no", async () => {
    const sesion = (rol: string) => ({ id: 3, rol });
    expect(await sesionPuedeEditarVehiculosOtrasEmpresas(sesion("Admin"))).toBe(true);
    expect(permisosEfectivos).not.toHaveBeenCalled(); // no se duplica el bypass: Admin no consulta la matriz
    const caso = async (permisos: PermisoModulo[]) => {
      vi.mocked(permisosEfectivos).mockResolvedValue(permisos);
      return sesionPuedeEditarVehiculosOtrasEmpresas(sesion("CoordinadorPredios"));
    };
    expect(await caso([p(VERSION_PERMISOS, { puedeVer: true }), p("flota_vehiculos", { puedeVer: true }), p(FILA, { puedeVer: true, puedeEditar: true })])).toBe(true);
    expect(await caso(soloAccion)).toBe(false);
    expect(await caso([p(VERSION_PERMISOS, { puedeVer: true }), p("flota_vehiculos", { puedeVer: true })])).toBe(false);
    expect(await caso([p(VERSION_PERMISOS, { puedeVer: true })])).toBe(false);
  });
  it("denegar la acción explícitamente prevalece (fila en cero con Ver vehículos activo)", async () => {
    vi.mocked(permisosEfectivos).mockResolvedValue([p(VERSION_PERMISOS, { puedeVer: true }), p("flota_vehiculos", { puedeVer: true, puedeEditar: true }), p(FILA)]);
    expect(await sesionPuedeEditarVehiculosOtrasEmpresas({ id: 3, rol: "CoordinadorPredios" })).toBe(false);
  });
});

describe("UI: lista, formulario y matriz de Usuarios", () => {
  const cliente = readFileSync("src/app/e/[slug]/flota/flota-client.tsx", "utf8").replace(/\r\n/g, "\n");
  const usuarios = readFileSync("src/app/e/[slug]/usuarios/page.tsx", "utf8").replace(/\r\n/g, "\n");
  it("sin permiso: «Editar» no se ofrece (se muestra «Solo empresa dueña» con la explicación) y empezarEdicion conserva el mensaje de siempre", () => {
    expect(MENSAJE_SOLO_EMPRESA_DUENA).toBe("Este vehículo es compartido; solo la empresa dueña puede editarlo.");
    expect(cliente).toContain("return v.puedeEditar ?? v.esDueno !== false;");
    expect(cliente).toContain("if (!puedeEditarVehiculo(v)) {\n      setErr(MENSAJE_SOLO_EMPRESA_DUENA);");
    expect(cliente).toContain("{puedeEditarVehiculo(v) ? (");
    expect(cliente).toContain("Solo empresa dueña");
  });
  it("con permiso: «Editar» y aviso informativo (no error) y sin lo que solo define la dueña", () => {
    expect(cliente).toContain("avisoEdicionOtraEmpresa(empresaDe(vehiculoEnEdicion))");
    expect(cliente).toContain('role="status"');
    expect(cliente).toContain("{!editandoAjeno ? <label");
    expect(cliente).toContain("tipoUnidad: ajeno ? undefined : form.tipoUnidad");
    expect(cliente).toContain("accesoEmpresaIds: editId && !ajeno ? accesoEmpresaIds : undefined");
    expect(cliente).toMatch(/\{editId && !editandoAjeno \? \(\n\s+<>\n\s+<button\n\s+type="button"\n\s+className="rounded bg-violet-800/);
    expect(cliente).toContain("{v.esDueno !== false ? (");
  });
  it("la matriz de Usuarios (catálogo central) muestra la descripción de la acción y no usa la matriz vieja", () => {
    expect(usuarios).toContain("a.descripcion");
    expect(usuarios).toContain("CATALOGO_PERMISOS");
    expect(usuarios).not.toContain("descripcionPermiso");
    expect(usuarios).not.toContain("labelPermiso");
  });
});
