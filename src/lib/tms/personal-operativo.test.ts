import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ getPool: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: vi.fn() }));

import { getPool, query } from "@/lib/db";
import {
  crearPersonalExterno,
  etiquetaOrigen,
  habilitarCompartido,
  seleccionablesParaPlan,
  snapshotsPersonal,
  type ActorPersonal,
} from "./personal-operativo";

/**
 * PERSONAL-OPERATIVO-COMPARTIDO-EXTERNO-1 — tests dirigidos:
 *  - un compartido/externo NUNCA se materializa como empleado de esta empresa
 *    (id_empleado NULL para externo; para compartido apunta a la empresa de origen);
 *  - la autorización operativa es explícita por empresa (§multiempresa);
 *  - los selectores mezclan propios + compartidos + externos con su etiqueta.
 */

const ACTOR: ActorPersonal = { usuarioId: 9, nombre: "Ana" };

type Row = Record<string, unknown>;
function conexion(handler: (sql: string, params: unknown[]) => Row[]) {
  const ejecutadas: { sql: string; params: unknown[] }[] = [];
  const conn = {
    beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
    query: vi.fn(async (sql: string, params: unknown[] = []) => [handler(sql, params)]),
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      ejecutadas.push({ sql, params });
      return [{ insertId: 77, affectedRows: 1 }];
    }),
  };
  vi.mocked(getPool).mockReturnValue({ getConnection: vi.fn().mockResolvedValue(conn) } as never);
  vi.mocked(query).mockResolvedValue([] as never);
  return { conn, ejecutadas };
}

beforeEach(() => vi.resetAllMocks());

describe("etiquetaOrigen", () => {
  it("propio -> vacío; compartido -> empresa; externo -> texto libre", () => {
    expect(etiquetaOrigen({ tipo_vinculo: "propio" })).toBe("");
    expect(etiquetaOrigen({ tipo_vinculo: "compartido", empresa_origen_nombre: "Transportes B" })).toBe("Transportes B");
    expect(etiquetaOrigen({ tipo_vinculo: "externo", empresa_origen_texto: "Freelance" })).toBe("Freelance");
  });
});

describe("crearPersonalExterno", () => {
  it("inserta tipo_vinculo='externo' con id_empleado NULL — nunca crea un empleado RRHH", async () => {
    const { ejecutadas } = conexion(() => []);
    vi.mocked(query).mockResolvedValue([
      { id: 77, nombre: "Pedro", tipo: "Piloto", tipo_vinculo: "externo", estado: "Activo",
         telefono: null, licencia: "B-123", codigo: null, id_empleado: null,
         empresa_origen_id: null, empresa_origen_texto: "Freelance", empresa_origen_nombre: null },
    ] as never);
    const p = await crearPersonalExterno(7, { nombre: "Pedro", tipo: "Piloto", licencia: "B-123", empresaOrigenTexto: "Freelance" }, ACTOR);
    const ins = ejecutadas.find((e) => e.sql.includes("INSERT INTO tms_personal"));
    expect(ins).toBeDefined();
    expect(ins!.sql).toContain("id_empleado, nombre, tipo, tipo_vinculo");
    expect(ins!.sql).toContain("'externo'");
    // params: empresa_id, nombre, tipo, empresa_origen_id, empresa_origen_texto, licencia, telefono
    expect(ins!.params).toEqual([7, "Pedro", "Piloto", null, "Freelance", "B-123", null]);
    expect(p.tipoVinculo).toBe("externo");
    expect(p.idEmpleado).toBeNull();
  });
});

describe("habilitarCompartido — §multiempresa: autorización explícita por empresa", () => {
  it("crea una fila tms_personal COMPARTIDA con empresa_origen_id = empresa real del empleado", async () => {
    const { ejecutadas } = conexion((sql) => {
      if (sql.includes("FROM empleados WHERE id")) return [{ id: 55, nombre: "Juan", codigo: "P-9", empresa_id: 3 }];
      if (sql.includes("FROM tms_personal WHERE empresa_id = ? AND id_empleado")) return []; // no existe aún
      return [];
    });
    vi.mocked(query).mockResolvedValue([
      { id: 77, nombre: "Juan", tipo: "Piloto", tipo_vinculo: "compartido", estado: "Activo",
         telefono: null, licencia: null, codigo: "P-9", id_empleado: 55,
         empresa_origen_id: 3, empresa_origen_texto: null, empresa_origen_nombre: "Transportes B" },
    ] as never);
    // empresa actual 7; el usuario administra 3, 7, 9 -> puede prestar de la 3.
    const p = await habilitarCompartido(7, 55, "Piloto", ACTOR, [3, 7, 9]);
    const ins = ejecutadas.find((e) => e.sql.includes("INSERT INTO tms_personal"));
    expect(ins!.sql).toContain("'compartido'");
    expect(ins!.params).toEqual([7, 55, "P-9", "Juan", "Piloto", 3]);
    expect(p.tipoVinculo).toBe("compartido");
    expect(p.empresaOrigenId).toBe(3);
  });

  it("rechaza si el empleado ya es de esta empresa (es propio, no compartido)", async () => {
    conexion((sql) =>
      sql.includes("FROM empleados WHERE id") ? [{ id: 55, nombre: "Juan", codigo: "P-9", empresa_id: 7 }] : [],
    );
    await expect(habilitarCompartido(7, 55, "Piloto", ACTOR, [7])).rejects.toThrow(/propio/i);
  });

  it("§multiempresa — rechaza prestar un empleado de una empresa que el usuario NO administra", async () => {
    const { conn } = conexion((sql) =>
      sql.includes("FROM empleados WHERE id") ? [{ id: 55, nombre: "Juan", codigo: "P-9", empresa_id: 4 }] : [],
    );
    await expect(habilitarCompartido(7, 55, "Piloto", ACTOR, [3, 7, 9])).rejects.toThrow(/acceso a la empresa de origen/i);
    expect(conn.rollback).toHaveBeenCalled();
  });
});

describe("seleccionablesParaPlan", () => {
  it("une propios (empleadoId) + compartidos/externos (personalId), cada uno con su fuente/origen", async () => {
    vi.mocked(query).mockImplementation((async (sql: string) => {
      if (sql.includes("FROM empleados e")) {
        return [{ id: 10, nombre: "Hilario", personal_id: null }];
      }
      // SELECT_PERSONAL de compartidos/externos
      return [
        { id: 21, nombre: "Juan", tipo: "Piloto", tipo_vinculo: "compartido", estado: "Activo",
          telefono: null, licencia: null, codigo: null, id_empleado: 55, empresa_origen_id: 3,
          empresa_origen_texto: null, empresa_origen_nombre: "Transportes B" },
        { id: 22, nombre: "Pedro", tipo: "Piloto", tipo_vinculo: "externo", estado: "Activo",
          telefono: null, licencia: null, codigo: null, id_empleado: null, empresa_origen_id: null,
          empresa_origen_texto: "Freelance", empresa_origen_nombre: null },
      ];
    }) as never);
    const out = await seleccionablesParaPlan(7, "Piloto");
    expect(out).toEqual([
      { fuente: "propio", empleadoId: 10, personalId: null, nombre: "Hilario", origen: "", tipo: "Piloto" },
      { fuente: "compartido", empleadoId: null, personalId: 21, nombre: "Juan", origen: "Transportes B", tipo: "Piloto" },
      { fuente: "externo", empleadoId: null, personalId: 22, nombre: "Pedro", origen: "Freelance", tipo: "Piloto" },
    ]);
  });
});

describe("snapshotsPersonal — batch para congelar el histórico del viaje", () => {
  it("mapea id -> { nombre, tipo, origen }", async () => {
    vi.mocked(query).mockResolvedValue([
      { id: 21, nombre: "Juan", tipo: "Piloto", tipo_vinculo: "compartido", estado: "Activo",
         telefono: null, licencia: null, codigo: null, id_empleado: 55, empresa_origen_id: 3,
         empresa_origen_texto: null, empresa_origen_nombre: "Transportes B" },
    ] as never);
    const m = await snapshotsPersonal(7, [21]);
    expect(m.get(21)).toEqual({ nombre: "Juan", tipo: "compartido", origen: "Transportes B" });
  });

  it("ids vacíos -> mapa vacío, sin consultar", async () => {
    const m = await snapshotsPersonal(7, []);
    expect(m.size).toBe(0);
    expect(vi.mocked(query)).not.toHaveBeenCalled();
  });
});

describe("integración con el viaje — snapshot histórico del personal (código fuente)", () => {
  const raiz = join(__dirname, "..", "..", "..");
  const planesRoute = readFileSync(
    join(raiz, "src", "app", "api", "empresas", "[slug]", "tms", "planes", "route.ts"),
    "utf-8",
  );

  it("el INSERT del plan congela piloto_nombre/tipo/origen_historico", () => {
    expect(planesRoute).toMatch(/piloto_nombre_historico, piloto_tipo_historico, piloto_origen_historico/);
    expect(planesRoute).toMatch(/snapPiloto\?\.nombre/);
  });

  it("guardarAuxiliaresPlan escribe nombre_historico / tipo_historico / origen_historico por auxiliar", () => {
    expect(planesRoute).toMatch(/INSERT INTO tms_plan_auxiliares \(plan_id, personal_id, orden, nombre_historico, tipo_historico, origen_historico\)/);
  });

  it("acepta piloto/auxiliares compartidos/externos por tms_personal.id (pilotoPersonalId / auxiliarPersonalIds) validados sin auto-crear", () => {
    expect(planesRoute).toMatch(/pilotoPersonalId: z\.number\(\)/);
    expect(planesRoute).toMatch(/validarPersonalId\(empresaId, d\.pilotoPersonalId, "Piloto"\)/);
  });

  it("NUNCA escribe en empleados / planilla desde este flujo de personal operativo", () => {
    const libPersonal = readFileSync(join(raiz, "src", "lib", "tms", "personal-operativo.ts"), "utf-8");
    expect(libPersonal).not.toMatch(/INSERT INTO empleados/i);
    expect(libPersonal).not.toMatch(/UPDATE empleados/i);
    expect(libPersonal).not.toMatch(/rrhh_planilla|planilla_lineas|prestaciones|vacaciones_saldo/i);
  });
});
