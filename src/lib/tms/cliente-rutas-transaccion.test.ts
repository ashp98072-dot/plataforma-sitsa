import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ getPool: vi.fn(), query: vi.fn(), execute: vi.fn() }));
import { getPool } from "@/lib/db";
import { actualizarRuta, crearRuta } from "./cliente-rutas";

function conexion(fallaEn: "cabecera" | "parada" | "personal") {
  const conn = {
    beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
    query: vi.fn(async (sql: string) => {
      if (sql.includes("FROM empleados")) return [[{ id: 10 }, { id: 20 }]];
      if (sql.includes("FROM tms_clientes")) return [[{ id: 5 }]];
      return [[]];
    }),
    execute: vi.fn(async (sql: string) => {
      if (fallaEn === "cabecera" && sql.includes("INSERT INTO tms_cliente_rutas")) throw new Error("cabecera");
      if (fallaEn === "parada" && sql.includes("INSERT INTO tms_cliente_ruta_paradas")) throw new Error("parada");
      if (fallaEn === "personal" && sql.includes("INSERT INTO tms_cliente_ruta_personal")) throw new Error("personal");
      return [{ insertId: 44, affectedRows: 1 }];
    }),
  };
  vi.mocked(getPool).mockReturnValue({ getConnection: vi.fn().mockResolvedValue(conn) } as never);
  return conn;
}

const entrada = {
  clienteId: 5,
  codigo: "1001",
  lugarCargaTexto: "Bodega",
  paradas: [{ lugarNombre: "Destino", tipo: "Entrega" }],
  personalPredeterminado: [
    { empleadoId: 10, rol: "Piloto" as const, viaticoMonto: 50 },
    { empleadoId: 20, rol: "Auxiliar" as const, viaticoMonto: 25 },
  ],
};

describe("guardado manual atómico de rutas", () => {
  beforeEach(() => vi.resetAllMocks());

  it.each(["cabecera", "parada", "personal"] as const)(
    "hace rollback y no commit si falla %s",
    async (punto) => {
      const conn = conexion(punto);
      await expect(crearRuta(7, entrada)).rejects.toThrow(punto);
      expect(conn.beginTransaction).toHaveBeenCalledOnce();
      expect(conn.rollback).toHaveBeenCalledOnce();
      expect(conn.commit).not.toHaveBeenCalled();
      expect(conn.release).toHaveBeenCalledOnce();
    },
  );

  it("edición revierte cabecera y colecciones si falla una parada", async () => {
    const conn = conexion("parada");
    conn.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM empleados")) return [[{ id: 10 }, { id: 20 }]];
      if (sql.includes("FROM tms_cliente_rutas r")) return [[{
        id: 44, cliente_id: 5, cliente_nombre: "Acme", codigo: "1001", nombre: null,
        ubicacion_carga_id: null, lugar_carga_texto: "Bodega", destino_descripcion: "Destino",
        hora_habitual: "08:00", tarifa_referencia: 100, contacto_cliente_id: null,
        contacto_nombre: null, contacto_cargo: null, contacto_telefono: null, observaciones: null,
        activo: 1, creado_en: "", actualizado_en: "",
      }]];
      return [[]];
    });
    await expect(actualizarRuta(7, 44, { paradas: entrada.paradas })).rejects.toThrow("parada");
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
  });
});
