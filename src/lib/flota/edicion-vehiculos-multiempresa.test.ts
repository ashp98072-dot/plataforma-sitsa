import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ execute: vi.fn(), query: vi.fn(), getPool: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenantFlota: vi.fn(), requireTenantFlotaAny: vi.fn(), sesionPuedeEditarVehiculosOtrasEmpresas: vi.fn() }));
vi.mock("@/lib/flota/schema", () => ({ asegurarSchemaFlota: vi.fn(async () => undefined), asegurarSchemaFlotaLectura: vi.fn(async () => undefined) }));
vi.mock("@/lib/flota/acceso", () => ({
  obtenerVehiculoAccesible: vi.fn(), listarVehiculosAccesibles: vi.fn(), empresasAccesoPorVehiculos: vi.fn(async () => new Map()),
  listarEmpresasActivasSimple: vi.fn(async () => []), guardarAccesoVehiculo: vi.fn(),
}));
vi.mock("@/lib/flota/filtros", () => ({ guardarFiltrosVehiculo: vi.fn(), listarFiltrosPorVehiculos: vi.fn(async () => new Map()) }));
vi.mock("@/lib/empresas", () => ({ obtenerEmpresaPorId: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoria: vi.fn() }));

import { execute, query } from "@/lib/db";
import { requireTenantFlota, requireTenantFlotaAny, sesionPuedeEditarVehiculosOtrasEmpresas } from "@/lib/tenant";
import { listarVehiculosAccesibles, obtenerVehiculoAccesible, guardarAccesoVehiculo } from "@/lib/flota/acceso";
import { guardarFiltrosVehiculo } from "@/lib/flota/filtros";
import { obtenerEmpresaPorId } from "@/lib/empresas";
import { registrarAuditoria } from "@/lib/auditoria";
import { GET, PATCH } from "../../app/api/empresas/[slug]/flota/vehiculos/route";
import {
  MENSAJE_SOLO_EMPRESA_DUENA, avisoEdicionOtraEmpresa, decidirEdicionVehiculo,
  detalleAuditoriaEdicionTransversal, esSolicitudSoloTaller,
} from "./edicion-vehiculo";
import {
  PERMISO_FLOTA_VEHICULOS_OTRAS_EMPRESAS, PLATAFORMA_PERMISIBLES, catalogoGlobalPermisos, catalogoPermisosRol, descripcionPermiso,
  GRUPOS_PERMISOS, labelPermiso, moduloEmpresaDelPermiso, permisosDefaultPorRol, tienePermiso,
} from "@/lib/permisos-shared";
import { ROLES } from "@/lib/roles";

/**
 * FLOTA — EDICIÓN DE VEHÍCULOS COMPARTIDOS / DE OTRAS EMPRESAS.
 * Escenario real: empresa activa = Logiservicios Mónaco (id 2); vehículo C-091BXF propiedad de Frescofresh (id 9), compartido con Mónaco.
 * Regla: propietaria OR (permiso transversal AND vehículo ACCESIBLE desde la empresa activa — la regla real de obtenerVehiculoAccesible: propio o
 * compartido con la empresa activa). El usuario NO necesita acceso directo a la propietaria.
 */
const MONACO = 2, FRESCOFRESH = 9;
const sesion = (rol = "CoordinadorPredios", extra: Record<string, unknown> = {}) => ({ id: 41, username: "taller", rol, accesoTodas: false, ...extra });
const guardOk = (rol = "CoordinadorPredios") => ({ session: sesion(rol), empresa: { id: MONACO, nombre: "Logiservicios Mónaco", slug: "monaco", modulos: ["flota"] } }) as never;
const vehiculo = (over: Record<string, unknown> = {}) => ({
  id: 5, empresa_id: FRESCOFRESH, placa: "C-091BXF", marca: "Hino", modelo: "2019", descripcion: "Cabezal", color: "Blanco", tipo_combustible: "Diesel", km_actual: 1000,
  km_intervalo_servicio: 5000, odometro_funcional: 1, mantenimiento_intervalo_meses: 3, en_taller: 0, fecha_entrada_taller: null, motivo_taller: null, estado: "Activo", activo: 1,
  notas: null, rin_llanta: null, medida_llanta: null, tipo_aceite: null, empresa_activo: null, filtro_servicio_mayor: null, filtro_servicio_menor: null, compartido: 1, ...over,
});
const patch = (body: Record<string, unknown>) => PATCH(new Request("http://x/api", { method: "PATCH", body: JSON.stringify(body) }), { params: Promise.resolve({ slug: "monaco" }) });
const get = () => GET(new Request("http://x/api"), { params: Promise.resolve({ slug: "monaco" }) });

/** Configura sesión/permiso y el vehículo accesible desde la empresa activa (`vehiculo: null` = NO accesible: no es propio ni está compartido con ella). */
function escenario(o: { rol?: string; permiso?: boolean; vehiculo?: Record<string, unknown> | null } = {}) {
  vi.mocked(requireTenantFlota).mockResolvedValue(guardOk(o.rol));
  vi.mocked(requireTenantFlotaAny).mockResolvedValue(guardOk(o.rol));
  vi.mocked(sesionPuedeEditarVehiculosOtrasEmpresas).mockResolvedValue(o.permiso ?? false);
  vi.mocked(obtenerVehiculoAccesible).mockResolvedValue((o.vehiculo === undefined ? vehiculo() : o.vehiculo) as never);
  vi.mocked(obtenerEmpresaPorId).mockResolvedValue({ id: FRESCOFRESH, nombre: "Frescofresh" } as never);
  vi.mocked(execute).mockResolvedValue([{ affectedRows: 1 }] as never);
  vi.mocked(query).mockResolvedValue([] as never);
}
const updates = () => vi.mocked(execute).mock.calls.map((c) => ({ sql: String(c[0]), params: c[1] as unknown[] })).filter((c) => /^\s*UPDATE flota_vehiculos/i.test(c.sql));

beforeEach(() => vi.resetAllMocks());

describe("decidirEdicionVehiculo: puedeEditar = propietaria OR (permiso transversal AND vehículo accesible desde la empresa activa)", () => {
  const base = { empresaActivaId: MONACO, empresaDuenaId: FRESCOFRESH, permisoTransversal: false, vehiculoAccesibleDesdeEmpresaActiva: true };
  it("1. empresa propietaria: edita (sin necesitar el permiso transversal)", () => {
    expect(decidirEdicionVehiculo({ ...base, empresaActivaId: FRESCOFRESH })).toEqual({ puede: true, esDueno: true, porPermisoTransversal: false, motivoDenegado: null });
  });
  it("3. vehículo compartido SIN permiso transversal: no edita", () => {
    expect(decidirEdicionVehiculo(base)).toEqual({ puede: false, esDueno: false, porPermisoTransversal: false, motivoDenegado: "no_dueno" });
  });
  it("2. vehículo compartido CON permiso transversal: edita y se marca como edición transversal (no se pide acceso a la propietaria)", () => {
    expect(decidirEdicionVehiculo({ ...base, permisoTransversal: true })).toEqual({ puede: true, esDueno: false, porPermisoTransversal: true, motivoDenegado: null });
  });
  it("4. con permiso, pero el vehículo NO es accesible desde la empresa activa: no edita (el permiso no es acceso global)", () => {
    expect(decidirEdicionVehiculo({ ...base, permisoTransversal: true, vehiculoAccesibleDesdeEmpresaActiva: false })).toEqual({ puede: false, esDueno: false, porPermisoTransversal: false, motivoDenegado: "no_accesible" });
  });
  it("la regla ya no depende de las empresas del usuario: la decisión no recibe ni consulta empresasParaUsuario", () => {
    const fuente = readFileSync("src/lib/flota/edicion-vehiculo.ts", "utf8");
    expect(fuente).not.toContain("empresasAutorizadas"); expect(fuente).not.toContain("empresasParaUsuario");
    const ruta = readFileSync("src/app/api/empresas/[slug]/flota/vehiculos/route.ts", "utf8");
    expect(ruta).not.toContain("empresasParaUsuario"); expect(ruta).not.toContain("empresasAutorizadas");
  });
  it("solo operación de taller (enviar/sacar de taller) se reconoce como tal; cualquier otro campo es edición", () => {
    expect(esSolicitudSoloTaller(["id", "enTaller", "motivoTaller"])).toBe(true);
    expect(esSolicitudSoloTaller(["id", "enTaller"])).toBe(true);
    expect(esSolicitudSoloTaller(["id", "activo"])).toBe(false);
    expect(esSolicitudSoloTaller(["id", "enTaller", "placa"])).toBe(false);
    expect(esSolicitudSoloTaller(["id", "motivoTaller"])).toBe(false);
  });
  it("mensajes: el de siempre para quien no puede; informativo (no error) para quien sí", () => {
    expect(MENSAJE_SOLO_EMPRESA_DUENA).toBe("Este vehículo es compartido; solo la empresa dueña puede editarlo.");
    expect(avisoEdicionOtraEmpresa("Frescofresh")).toBe("Vehículo propiedad de Frescofresh. Tienes permiso para editar vehículos compartidos de otras empresas.");
  });
});

describe("PATCH /flota/vehiculos — backend", () => {
  it("A. propietaria normal: edita; el UPDATE va acotado por la empresa propietaria", async () => {
    escenario({ vehiculo: vehiculo({ empresa_id: MONACO, compartido: 0 }) });
    const r = await patch({ id: 5, marca: "Isuzu" });
    expect(r.status).toBe(200);
    const [u] = updates();
    expect(u.sql).toContain("WHERE id = ? AND empresa_id = ?");
    expect(u.params.slice(-2)).toEqual([5, MONACO]);
    expect(u.params).toContain("Isuzu");
    expect(sesionPuedeEditarVehiculosOtrasEmpresas).not.toHaveBeenCalled(); // la propietaria no necesita el permiso
    expect(registrarAuditoria).not.toHaveBeenCalled();
  });

  it("B. otra empresa SIN permiso transversal: 403 y NO se escribe nada (cierra el hueco del backend: antes solo bloqueaba la UI)", async () => {
    escenario({ permiso: false });
    for (const body of [{ id: 5, marca: "Isuzu" }, { id: 5, placa: "P-999AAA" }, { id: 5, activo: false }, { id: 5, kmActual: 5 }, { id: 5, estado: "Inactivo" }, { id: 5, notas: "x" }]) {
      const r = await patch(body);
      expect(r.status, JSON.stringify(body)).toBe(403);
      expect((await r.json()).error).toBe(MENSAJE_SOLO_EMPRESA_DUENA);
    }
    expect(execute).not.toHaveBeenCalled(); expect(registrarAuditoria).not.toHaveBeenCalled(); expect(guardarFiltrosVehiculo).not.toHaveBeenCalled();
  });

  it("B2. la operación de taller de un vehículo compartido sigue disponible sin el permiso transversal (cada acción conserva su permiso)", async () => {
    escenario({ permiso: false });
    const enviar = await patch({ id: 5, enTaller: true, motivoTaller: "Cambio de aceite" });
    expect(enviar.status).toBe(200);
    expect(updates()).toHaveLength(1);
    expect(updates()[0].params.slice(-2)).toEqual([5, FRESCOFRESH]); // acotado por la propietaria real, no por la activa
    expect(registrarAuditoria).not.toHaveBeenCalled(); // no es una «edición del vehículo»
    const sacar = await patch({ id: 5, enTaller: false });
    expect(sacar.status).toBe(200);
  });

  it("C. otra empresa CON permiso transversal: edita todos los campos normales, filtros incluidos, y la propiedad NO cambia", async () => {
    escenario({ permiso: true });
    const r = await patch({ id: 5, placa: "c-091bxf", marca: "Hino 500", modelo: "2020", descripcion: "Cabezal 6x4", kmActual: 1500, notas: "revisado", rinLlanta: "22.5", activo: true, filtros: [{ tipo: "Aceite", codigo: "F-1" }] });
    expect(r.status).toBe(200);
    const [u] = updates();
    // La propiedad no cambia: el UPDATE nunca asigna empresa_id y se acota por la empresa PROPIETARIA (no por la activa).
    const set = u.sql.split("WHERE")[0];
    expect(set).not.toMatch(/empresa_id\s*=/);
    expect(u.sql).toContain("WHERE id = ? AND empresa_id = ?");
    expect(u.params.slice(-2)).toEqual([5, FRESCOFRESH]);
    expect(u.params).not.toContain(MONACO);
    expect(u.params).toEqual(expect.arrayContaining(["C-091BXF", "Hino 500", 1500]));
    expect(guardarFiltrosVehiculo).toHaveBeenCalledWith(FRESCOFRESH, 5, [{ tipo: "Aceite", codigo: "F-1" }]);
  });

  it("C2. un empresa_id enviado por el cliente se ignora: manda la propietaria leída de la BD", async () => {
    escenario({ permiso: true });
    const r = await patch({ id: 5, marca: "X", empresa_id: 123, empresaId: 123 });
    expect(r.status).toBe(200);
    expect(updates()[0].params.slice(-2)).toEqual([5, FRESCOFRESH]);
    expect(updates()[0].params).not.toContain(123);
  });

  it("D. Encargado de Taller (rol no administrador, permiso asignado): edita los vehículos compartidos en Mónaco de cualquier empresa propietaria", async () => {
    for (const duena of [FRESCOFRESH, 11, 12]) {
      escenario({ rol: "CoordinadorPredios", permiso: true, vehiculo: vehiculo({ empresa_id: duena }) });
      const r = await patch({ id: 5, marca: "Isuzu" });
      expect(r.status).toBe(200);
      expect(updates()[0].params.slice(-2)).toEqual([5, duena]);
      vi.mocked(execute).mockClear();
    }
  });

  it("E. Admin General: el bypass administrativo existente sigue funcionando (la capacidad es verdadera) y accesoTodas cubre las empresas", async () => {
    escenario({ rol: "Admin", permiso: true });
    const r = await patch({ id: 5, marca: "Isuzu" });
    expect(r.status).toBe(200);
  });

  it("2. usuario de Taller SIN acceso directo a la propietaria: edita el vehículo de Frescofresh compartido y visible en Mónaco (basta con que Mónaco lo vea)", async () => {
    escenario({ rol: "CoordinadorPredios", permiso: true });
    // El usuario solo opera Mónaco: entrar a Frescofresh le da 403 en el guard de la empresa (requireTenant), pero eso no interviene al editar desde Mónaco.
    const sinAccesoAFrescofresh = { error: new Response(JSON.stringify({ error: "Sin acceso a esta empresa." }), { status: 403 }) } as never;
    vi.mocked(requireTenantFlota).mockResolvedValueOnce(guardOk("CoordinadorPredios"));
    const r = await patch({ id: 5, marca: "Isuzu", descripcion: "Cabezal revisado" });
    expect(r.status).toBe(200);
    expect(updates()[0].params.slice(-2)).toEqual([5, FRESCOFRESH]); // se actualiza la fila de Frescofresh…
    expect(vi.mocked(obtenerVehiculoAccesible).mock.calls.at(-1)!.slice(0, 2)).toEqual([MONACO, 5]); // …encontrada desde la empresa ACTIVA (Mónaco)
    vi.mocked(requireTenantFlota).mockResolvedValueOnce(sinAccesoAFrescofresh);
    const directo = await PATCH(new Request("http://x/api", { method: "PATCH", body: JSON.stringify({ id: 5, marca: "X" }) }), { params: Promise.resolve({ slug: "frescofresh" }) });
    expect(directo.status).toBe(403); // por la URL de Frescofresh no puede operar: la capacidad es solo vía el vehículo compartido en su empresa
  });

  it("4. con permiso, vehículo de otra empresa NO compartido con la empresa activa (no accesible): no se encuentra (404) y no se escribe nada, aunque se manipule el id", async () => {
    escenario({ permiso: true, vehiculo: null });
    for (const id of [5, 6, 99999]) {
      const r = await patch({ id, marca: "Isuzu" });
      expect(r.status).toBe(404);
    }
    expect(execute).not.toHaveBeenCalled(); expect(registrarAuditoria).not.toHaveBeenCalled(); expect(guardarFiltrosVehiculo).not.toHaveBeenCalled();
    // La búsqueda se hace SIEMPRE con la empresa activa de la sesión (nunca con una enviada por el cliente).
    expect(vi.mocked(obtenerVehiculoAccesible).mock.calls.every((c) => c[0] === MONACO)).toBe(true);
  });

  it("5. otro tenant: sin acceso a la empresa (guard 401/403/404) nunca se llega a editar, con o sin permiso transversal", async () => {
    escenario({ permiso: true });
    for (const status of [401, 403, 404]) {
      vi.mocked(requireTenantFlota).mockResolvedValueOnce({ error: new Response(JSON.stringify({ error: "x" }), { status }) } as never);
      const r = await patch({ id: 5, marca: "Isuzu" });
      expect(r.status).toBe(status);
    }
    expect(obtenerVehiculoAccesible).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
    // Un vehículo de otro tenant no es accesible desde la empresa activa: 404.
    escenario({ permiso: true, vehiculo: null });
    expect((await patch({ id: 12345, marca: "Isuzu" })).status).toBe(404);
    expect(execute).not.toHaveBeenCalled();
  });

  it("6. la edición transversal no transfiere la propiedad: el vehículo sigue siendo de Frescofresh (empresa_id intacto, sin tocar los accesos compartidos)", async () => {
    escenario({ permiso: true });
    const r = await patch({ id: 5, marca: "Isuzu", placa: "C-091BXF" });
    expect(r.status).toBe(200);
    const [u] = updates();
    expect(u.sql.split("WHERE")[0]).not.toMatch(/empresa_id\s*=/);
    expect(u.params.slice(-2)).toEqual([5, FRESCOFRESH]);
    expect(guardarAccesoVehiculo).not.toHaveBeenCalled();
    expect(vi.mocked(execute).mock.calls.every((c) => !/flota_vehiculo_acceso/.test(String(c[0])))).toBe(true);
  });

  it("7. (G) lo que solo define la empresa dueña NO se abre con el permiso: compartición, tipo de unidad y limpiar kilometraje siguen siendo 403", async () => {
    escenario({ permiso: true });
    expect((await patch({ id: 5, accesoEmpresaIds: [1, 2] })).status).toBe(403);
    expect((await patch({ id: 5, tipoUnidad: "TC" })).status).toBe(403);
    expect((await patch({ id: 5, reiniciarKilometraje: true })).status).toBe(403);
    expect(guardarAccesoVehiculo).not.toHaveBeenCalled();
    expect(updates()).toHaveLength(0);
  });

  it("auditoría: solo la edición transversal se registra (vehículo, empresa propietaria, usuario, empresa activa), una sola vez", async () => {
    escenario({ permiso: true });
    await patch({ id: 5, marca: "Isuzu" });
    expect(registrarAuditoria).toHaveBeenCalledOnce();
    const a = vi.mocked(registrarAuditoria).mock.calls[0][0];
    expect(a).toMatchObject({ empresaId: MONACO, usuario: "taller", accion: "editar_vehiculo_otra_empresa", modulo: "flota_vehiculos" });
    expect(a.detalle).toContain("C-091BXF"); expect(a.detalle).toContain("Frescofresh"); expect(a.detalle).toContain("Logiservicios Mónaco"); expect(a.detalle).toContain("taller");
    expect(detalleAuditoriaEdicionTransversal({ placa: "P", vehiculoId: 1, empresaDuenaNombre: "A", empresaDuenaId: 1, empresaActivaNombre: "B", empresaActivaId: 2, usuario: "u" })).toContain("«editar vehículos de otras empresas»");
  });

  it("un fallo del UPDATE no deja auditoría de una edición que no ocurrió", async () => {
    escenario({ permiso: true });
    vi.mocked(execute).mockRejectedValue(new Error("boom"));
    const r = await patch({ id: 5, marca: "Isuzu" });
    expect(r.status).toBe(500);
    expect(registrarAuditoria).not.toHaveBeenCalled();
  });
});

describe("GET /flota/vehiculos — la UI recibe la decisión del backend por vehículo", () => {
  // listarVehiculosAccesibles SOLO devuelve lo accesible desde la empresa activa (propio o compartido con ella): los de otras empresas no compartidas no aparecen.
  const filas = [vehiculo({ id: 1, empresa_id: MONACO, compartido: 0 }), vehiculo({ id: 2, empresa_id: FRESCOFRESH })];
  const lista = async () => (await (await get()).json()) as { vehiculos: { id: number; puedeEditar: boolean; esDueno: boolean }[]; puedeEditarOtrasEmpresas: boolean };
  it("sin permiso transversal: solo los propios son editables; los compartidos conservan esDueno=false y puedeEditar=false", async () => {
    escenario({ permiso: false });
    vi.mocked(listarVehiculosAccesibles).mockResolvedValue(filas as never);
    const r = await lista();
    expect(r.puedeEditarOtrasEmpresas).toBe(false);
    expect(r.vehiculos.map((v) => [v.id, v.esDueno, v.puedeEditar])).toEqual([[1, true, true], [2, false, false]]);
  });
  it("con permiso: también los compartidos con la empresa activa (aunque el usuario no opere la propietaria)", async () => {
    escenario({ permiso: true });
    vi.mocked(listarVehiculosAccesibles).mockResolvedValue(filas as never);
    const r = await lista();
    expect(r.puedeEditarOtrasEmpresas).toBe(true);
    expect(r.vehiculos.map((v) => [v.id, v.esDueno, v.puedeEditar])).toEqual([[1, true, true], [2, false, true]]);
    expect(vi.mocked(listarVehiculosAccesibles).mock.calls[0][0]).toBe(MONACO); // la lista sale de la empresa activa de la sesión
  });
  it("los vehículos siguen visibles como compartidos: la propiedad y el indicador no cambian", async () => {
    escenario({ permiso: true });
    vi.mocked(listarVehiculosAccesibles).mockResolvedValue(filas as never);
    const r = await (await get()).json();
    expect(r.vehiculos[1]).toMatchObject({ empresa_id: FRESCOFRESH, compartido: true, esDueno: false });
  });
});

describe("Catálogo de permisos: «Editar vehículos de otras empresas»", () => {
  it("existe como permiso explícito y persistible (cabe en usuario_modulo.modulo VARCHAR(40); no requiere SQL)", () => {
    expect(PLATAFORMA_PERMISIBLES).toContain(PERMISO_FLOTA_VEHICULOS_OTRAS_EMPRESAS);
    expect(PERMISO_FLOTA_VEHICULOS_OTRAS_EMPRESAS.length).toBeLessThanOrEqual(40);
    expect(catalogoGlobalPermisos()).toContain(PERMISO_FLOTA_VEHICULOS_OTRAS_EMPRESAS);
    const schema = readFileSync("sql/schema.sql", "utf8");
    expect(schema).toMatch(/usuario_modulo \(\n?[\s\S]*?modulo VARCHAR\(40\) NOT NULL/);
  });
  it("etiqueta y descripción pedidas; se agrupa en Flota / Predios; depende del módulo de empresa «flota»", () => {
    expect(labelPermiso(PERMISO_FLOTA_VEHICULOS_OTRAS_EMPRESAS)).toBe("Editar vehículos de otras empresas");
    expect(descripcionPermiso(PERMISO_FLOTA_VEHICULOS_OTRAS_EMPRESAS)).toContain("Permite modificar datos de vehículos pertenecientes a otras empresas del mismo entorno corporativo");
    expect(descripcionPermiso("flota_vehiculos")).toBeNull();
    expect(GRUPOS_PERMISOS.find((g) => g.id === "flota")!.modulos).toContain(PERMISO_FLOTA_VEHICULOS_OTRAS_EMPRESAS);
    expect(GRUPOS_PERMISOS.filter((g) => g.id !== "flota").every((g) => !g.modulos.includes(PERMISO_FLOTA_VEHICULOS_OTRAS_EMPRESAS))).toBe(true);
    expect(moduloEmpresaDelPermiso(PERMISO_FLOTA_VEHICULOS_OTRAS_EMPRESAS)).toBe("flota");
  });
  it("Admin lo recibe por catálogo; NINGÚN otro rol lo trae por defecto (no se abre la edición cruzada a todos)", () => {
    const tiene = (rol: string) => tienePermiso(permisosDefaultPorRol(rol as never), PERMISO_FLOTA_VEHICULOS_OTRAS_EMPRESAS, "editar");
    expect(tiene("Admin")).toBe(true);
    for (const rol of ROLES.filter((r) => r !== "Admin")) expect(tiene(rol), rol).toBe(false);
  });
  it("es asignable desde Administración de usuarios a roles de Flota/Predios (Encargado de Taller) y operativos, sin hardcodear usuarios", () => {
    for (const rol of ["CoordinadorPredios", "CoordinadorCompras", "Operaciones", "GerenteOperaciones", "JefeOperaciones", "Visualizador"]) {
      expect(catalogoPermisosRol(rol as never), rol).toContain(PERMISO_FLOTA_VEHICULOS_OTRAS_EMPRESAS);
    }
    const rol = readFileSync("src/lib/permisos-shared.ts", "utf8");
    expect(rol).not.toMatch(/username\s*===|usuario\s*===/);
  });
  it("un usuario con el permiso asignado (matriz de Usuarios) lo tiene; sin él, no", () => {
    const base = permisosDefaultPorRol("CoordinadorPredios" as never);
    expect(tienePermiso(base, PERMISO_FLOTA_VEHICULOS_OTRAS_EMPRESAS, "editar")).toBe(false);
    const conPermiso = base.map((p) => (p.modulo === PERMISO_FLOTA_VEHICULOS_OTRAS_EMPRESAS ? { ...p, puedeVer: true, puedeEditar: true } : p));
    expect(tienePermiso(conPermiso, PERMISO_FLOTA_VEHICULOS_OTRAS_EMPRESAS, "editar")).toBe(true);
  });
});

describe("H. UI de Flota y matriz de Usuarios", () => {
  const cliente = readFileSync("src/app/e/[slug]/flota/flota-client.tsx", "utf8").replace(/\r\n/g, "\n");
  const usuarios = readFileSync("src/app/e/[slug]/usuarios/page.tsx", "utf8").replace(/\r\n/g, "\n");
  it("sin permiso: «Editar» no se ofrece (se muestra «Solo empresa dueña» con la explicación) y empezarEdicion conserva el mensaje de siempre", () => {
    expect(cliente).toContain("function puedeEditarVehiculo(v: Vehiculo)");
    expect(cliente).toContain("return v.puedeEditar ?? v.esDueno !== false;");
    expect(cliente).toContain("if (!puedeEditarVehiculo(v)) {\n      setErr(MENSAJE_SOLO_EMPRESA_DUENA);");
    expect(cliente).toContain("{puedeEditarVehiculo(v) ? (");
    expect(cliente).toContain("Solo empresa dueña");
    expect(cliente).not.toContain('if (v.esDueno === false) {\n      setErr("Este vehículo es compartido');
  });
  it("con permiso: el formulario se abre editable con un aviso informativo (no un error) y sin lo que solo define la empresa dueña", () => {
    expect(cliente).toContain("const editandoAjeno = vehiculoEnEdicion?.esDueno === false;");
    expect(cliente).toContain("avisoEdicionOtraEmpresa(empresaDe(vehiculoEnEdicion))");
    expect(cliente).toContain('role="status"'); // aviso, no role="alert"
    expect(cliente).toContain("{!editandoAjeno ? <label");   // tipo de unidad
    expect(cliente).toContain("{editId && !editandoAjeno ? (\n                <div className=\"rounded border border-[var(--border)] p-3\">"); // compartición
    expect(cliente).toContain("tipoUnidad: ajeno ? undefined : form.tipoUnidad");
    expect(cliente).toContain("accesoEmpresaIds: editId && !ajeno ? accesoEmpresaIds : undefined");
  });
  it("Dar de baja / Eliminar / papelería siguen siendo solo de la empresa dueña (no se amplían acciones sensibles)", () => {
    expect(cliente).toMatch(/\{editId && !editandoAjeno \? \(\n\s+<>\n\s+<button\n\s+type="button"\n\s+className="rounded bg-violet-800/);
    expect(cliente).toMatch(/\{editId && !editandoAjeno \? \(\n\s+<>\n\s+<p className="text-xs text-\[var\(--muted\)\]">\n\s+Ya puedes agregar la papelería/);
    expect(cliente).toContain("{v.esDueno !== false ? (");
  });
  it("la matriz de Usuarios muestra la descripción del permiso bajo su nombre", () => {
    expect(usuarios).toContain("descripcionPermiso(m)");
  });
});
