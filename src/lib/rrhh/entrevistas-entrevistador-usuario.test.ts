import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ execute: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/db", () => ({ execute: m.execute, query: m.query }));
import { actualizarEntrevista, crearEntrevista } from "./entrevistas";

type UsuarioRow = { id: number; username: string; nombre: string | null; rol_global: string };

/**
 * ATRACCION-TALENTO-2 (secciones 6-7, 26) — mockea las DOS consultas que hace
 * listarUsuariosEntrevistadores()/esUsuarioElegibleEntrevista() por SQL:
 * "FROM usuarios" (candidatos activos+acceso a la empresa — ya filtrados
 * como lo haría el SQL real) y "FROM usuario_modulo" (permisos guardados,
 * usados por permisosEfectivos()/tienePermiso() reales, sin mockear). Todo
 * lo demás (FROM empleados, FROM entrevistas) resuelve vacío por defecto.
 */
function mockCatalogoUsuarios(candidatos: UsuarioRow[], permisos: Record<number, { puedeVer: boolean }> = {}) {
  m.query.mockImplementation(async (sql: unknown, params: unknown) => {
    const s = String(sql);
    if (s.includes("FROM usuarios")) return candidatos;
    if (s.includes("FROM usuario_modulo")) {
      const usuarioId = (params as unknown[])[0];
      const p = permisos[usuarioId as number];
      if (!p) return [];
      return [{ modulo: "entrevistas", puede_ver: p.puedeVer ? 1 : 0, puede_crear: 0, puede_editar: 0, puede_eliminar: 0 }];
    }
    return [];
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  m.execute.mockResolvedValue({ insertId: 60, affectedRows: 1 });
  m.query.mockResolvedValue([]);
});

const base = {
  empresaId: 1,
  candidatoPrimerNombre: "Juan",
  candidatoPrimerApellido: "Pérez",
  puesto: "Piloto",
  fechaHora: "2026-09-28T09:00",
  creadoPor: "RRHH",
};

describe("ATRACCION-TALENTO-2 — crearEntrevista con entrevistador/auxiliar usuario", () => {
  it("8) crea con entrevistador principal (usuario RRHH elegible)", async () => {
    mockCatalogoUsuarios([{ id: 10, username: "mlopez", nombre: "María López", rol_global: "RRHH" }], { 10: { puedeVer: true } });
    const r = await crearEntrevista({ ...base, entrevistadorUsuarioId: 10 });
    expect(r.ok).toBe(true);
    const [sql, params] = m.execute.mock.calls[0];
    expect(sql).toContain("entrevistador_usuario_id");
    expect(params).toContain(10);
  });

  it("9) crea con entrevistador + auxiliar (ambos usuarios distintos y elegibles)", async () => {
    mockCatalogoUsuarios(
      [
        { id: 10, username: "mlopez", nombre: "María López", rol_global: "RRHH" },
        { id: 11, username: "cperez", nombre: "Carlos Pérez", rol_global: "RRHH" },
      ],
      { 10: { puedeVer: true }, 11: { puedeVer: true } },
    );
    const r = await crearEntrevista({ ...base, entrevistadorUsuarioId: 10, auxiliarUsuarioId: 11 });
    expect(r.ok).toBe(true);
    const [, params] = m.execute.mock.calls[0];
    expect(params).toContain(10);
    expect(params).toContain(11);
  });

  it("10) auxiliar null es permitido (opcional)", async () => {
    mockCatalogoUsuarios([{ id: 10, username: "mlopez", nombre: "María López", rol_global: "RRHH" }], { 10: { puedeVer: true } });
    const r = await crearEntrevista({ ...base, entrevistadorUsuarioId: 10, auxiliarUsuarioId: null });
    expect(r.ok).toBe(true);
  });

  it("Admin es siempre elegible sin necesitar fila en usuario_modulo", async () => {
    mockCatalogoUsuarios([{ id: 20, username: "admin", nombre: null, rol_global: "Admin" }]);
    const r = await crearEntrevista({ ...base, entrevistadorUsuarioId: 20 });
    expect(r.ok).toBe(true);
  });

  it("11) entrevistador == auxiliar -> rechazado con mensaje claro, sin llegar a insertar", async () => {
    const r = await crearEntrevista({ ...base, entrevistadorUsuarioId: 10, auxiliarUsuarioId: 10 });
    expect(r.ok).toBe(false);
    expect(r.mensaje).toContain("no puede ser el mismo usuario que el entrevistador principal");
    expect(m.execute).not.toHaveBeenCalled();
  });

  it("12) usuario inactivo (no aparece en el catálogo de candidatos) -> rechazado", async () => {
    mockCatalogoUsuarios([]); // el SQL real ya lo habría excluido por activo=0
    const r = await crearEntrevista({ ...base, entrevistadorUsuarioId: 99 });
    expect(r.ok).toBe(false);
    expect(r.mensaje).toContain("no es un usuario elegible");
    expect(m.execute).not.toHaveBeenCalled();
  });

  it("13) usuario de otra empresa (sin acceso — no aparece en el catálogo) -> rechazado", async () => {
    mockCatalogoUsuarios([]); // el SQL real ya lo habría excluido por falta de usuario_empresa/acceso_todas_empresas
    const r = await crearEntrevista({ ...base, entrevistadorUsuarioId: 77 });
    expect(r.ok).toBe(false);
    expect(m.execute).not.toHaveBeenCalled();
  });

  it("14) usuario no elegible (rol RRHH pero entrevistas:ver revocado explícitamente) -> rechazado, NO asume que RRHH siempre tiene el permiso", async () => {
    mockCatalogoUsuarios([{ id: 30, username: "otro", nombre: "Otro Usuario", rol_global: "RRHH" }], { 30: { puedeVer: false } });
    const r = await crearEntrevista({ ...base, entrevistadorUsuarioId: 30 });
    expect(r.ok).toBe(false);
    expect(m.execute).not.toHaveBeenCalled();
  });

  it("auxiliar también se valida de forma independiente (no elegible -> rechazado aunque el entrevistador sí lo sea)", async () => {
    mockCatalogoUsuarios(
      [{ id: 10, username: "mlopez", nombre: "María López", rol_global: "RRHH" }],
      { 10: { puedeVer: true } },
    );
    const r = await crearEntrevista({ ...base, entrevistadorUsuarioId: 10, auxiliarUsuarioId: 99 });
    expect(r.ok).toBe(false);
    expect(r.mensaje).toContain("auxiliar no es un usuario elegible");
  });

  it("4) el INSERT de una entrevista NUEVA siempre deja entrevistador_empleado_id en NULL — crearEntrevista ni siquiera acepta ese campo como input", async () => {
    mockCatalogoUsuarios([{ id: 10, username: "mlopez", nombre: "María López", rol_global: "RRHH" }], { 10: { puedeVer: true } });
    await crearEntrevista({ ...base, entrevistadorUsuarioId: 10 });
    const [sql, params] = m.execute.mock.calls[0];
    const columnas = String(sql).slice(String(sql).indexOf("("), String(sql).indexOf(")")).split(",").map((c) => c.trim());
    const idx = columnas.indexOf("entrevistador_empleado_id");
    expect(idx).toBeGreaterThan(-1);
    expect(params[idx]).toBeNull();
  });

  it("crearEntrevista no acepta entrevistadorEmpleadoId ni siquiera si se le pasa (el tipo de su input ya no lo declara; el INSERT siempre manda NULL literal)", () => {
    const src = readFileSync("src/lib/rrhh/entrevistas.ts", "utf8");
    const fn = src.slice(src.indexOf("export async function crearEntrevista"), src.indexOf("export async function actualizarEntrevista"));
    expect(fn).not.toMatch(/entrevistadorEmpleadoId\??:\s*number/);
    expect(fn).toContain("null, // entrevistador_empleado_id");
  });
});

describe("ATRACCION-TALENTO-2 — actualizarEntrevista: editar/quitar entrevistador y auxiliar", () => {
  function mockFilaActual(extra: Record<string, unknown> = {}) {
    m.query.mockImplementation(async (sql: unknown, params: unknown) => {
      const s = String(sql);
      if (s.includes("FROM entrevistas")) {
        return [{
          candidato_primer_nombre: "Juan", candidato_segundo_nombre: null, candidato_tercer_nombre: null, candidato_cuarto_nombre: null,
          candidato_primer_apellido: "Pérez", candidato_segundo_apellido: null, candidato_apellido_casada: null,
          candidato_nombre: "Juan Pérez", entrevistador_usuario_id: null, auxiliar_usuario_id: null, ...extra,
        }];
      }
      if (s.includes("FROM usuarios")) return [{ id: 10, username: "mlopez", nombre: "María López", rol_global: "RRHH" }, { id: 11, username: "cperez", nombre: "Carlos Pérez", rol_global: "RRHH" }];
      if (s.includes("FROM usuario_modulo")) {
        const usuarioId = (params as unknown[])[0];
        return [10, 11].includes(usuarioId as number) ? [{ modulo: "entrevistas", puede_ver: 1, puede_crear: 0, puede_editar: 0, puede_eliminar: 0 }] : [];
      }
      return [];
    });
  }

  it("15) editar entrevistador principal funciona (usuario elegible)", async () => {
    mockFilaActual();
    const r = await actualizarEntrevista(1, 55, { entrevistadorUsuarioId: 10 });
    expect(r.ok).toBe(true);
    const [sql, params] = m.execute.mock.calls[0];
    expect(sql).toContain("entrevistador_usuario_id = ?");
    expect(params).toContain(10);
  });

  it("16) editar auxiliar funciona (usuario elegible, distinto del entrevistador ya guardado)", async () => {
    mockFilaActual({ entrevistador_usuario_id: 10 });
    const r = await actualizarEntrevista(1, 55, { auxiliarUsuarioId: 11 });
    expect(r.ok).toBe(true);
    const [sql, params] = m.execute.mock.calls[0];
    expect(sql).toContain("auxiliar_usuario_id = ?");
    expect(params).toContain(11);
  });

  it("17) quitar auxiliar funciona (auxiliarUsuarioId: null)", async () => {
    mockFilaActual({ entrevistador_usuario_id: 10, auxiliar_usuario_id: 11 });
    const r = await actualizarEntrevista(1, 55, { auxiliarUsuarioId: null });
    expect(r.ok).toBe(true);
    const [sql, params] = m.execute.mock.calls[0];
    expect(sql).toContain("auxiliar_usuario_id = ?");
    expect(params).toContain(null);
  });

  it("18) editar SOLO otro campo (notas) no manda entrevistador_usuario_id ni entrevistador_empleado_id — el histórico queda intacto", async () => {
    mockFilaActual({ entrevistador_empleado_id: 77 });
    const r = await actualizarEntrevista(1, 55, { notas: "Buen candidato" });
    expect(r.ok).toBe(true);
    const [sql] = m.execute.mock.calls[0];
    expect(sql).not.toContain("entrevistador_usuario_id = ?");
    expect(sql).not.toContain("entrevistador_empleado_id = ?");
  });

  it("23) cambio EXPLÍCITO de un histórico a un usuario limpia entrevistador_empleado_id (precedencia usuario > histórico)", async () => {
    mockFilaActual({ entrevistador_empleado_id: 77, entrevistador_usuario_id: null });
    const r = await actualizarEntrevista(1, 55, { entrevistadorUsuarioId: 10 });
    expect(r.ok).toBe(true);
    const [sql, params] = m.execute.mock.calls[0];
    expect(sql).toContain("entrevistador_usuario_id = ?");
    expect(sql).toContain("entrevistador_empleado_id = ?");
    // entrevistador_usuario_id se fija a 10 Y entrevistador_empleado_id se limpia a null en la MISMA sentencia.
    expect(params.filter((p: unknown) => p === 10)).toHaveLength(1);
    expect(params).toContain(null);
  });

  it("quitar el entrevistador explícitamente (entrevistadorUsuarioId: null) también limpia el empleado histórico", async () => {
    mockFilaActual({ entrevistador_empleado_id: 77 });
    const r = await actualizarEntrevista(1, 55, { entrevistadorUsuarioId: null });
    expect(r.ok).toBe(true);
    const [sql] = m.execute.mock.calls[0];
    expect(sql).toContain("entrevistador_usuario_id = ?");
    expect(sql).toContain("entrevistador_empleado_id = ?");
  });

  it("entrevistador nuevo == auxiliar ya guardado -> rechazado (valores EFECTIVOS, no solo lo que llega en el patch)", async () => {
    mockFilaActual({ auxiliar_usuario_id: 11 });
    const r = await actualizarEntrevista(1, 55, { entrevistadorUsuarioId: 11 });
    expect(r.ok).toBe(false);
    expect(r.mensaje).toContain("no puede ser el mismo usuario que el entrevistador principal");
    expect(m.execute).not.toHaveBeenCalled();
  });

  it("auxiliar nuevo no elegible -> rechazado", async () => {
    mockFilaActual();
    const r = await actualizarEntrevista(1, 55, { auxiliarUsuarioId: 999 });
    expect(r.ok).toBe(false);
    expect(m.execute).not.toHaveBeenCalled();
  });
});
