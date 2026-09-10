import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn(), execute: vi.fn() }));
import { execute, query } from "@/lib/db";
import {
  CATEGORIAS_GASTO,
  METODOS_PAGO_GASTO,
  actualizarGasto,
  crearGasto,
  desactivarGasto,
  listarGastos,
  obtenerGasto,
  type GastoOperativo,
} from "./gastos";

function filaGasto(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1, empresa_id: 7, fecha_solicitud: "2026-09-01", fecha_viaje: "2026-09-02",
    empleado_id: 3, empleado_codigo: "EMP-003", empleado_nombre: "Juan Perez", empleado_cargo: "Piloto",
    vehiculo_id: 5, vehiculo_placa: "P-123ABC",
    cliente_id: 9, cliente_nombre: "Cliente Acme",
    plan_id: 11, plan_codigo: "PLAN-20260901-001",
    categoria: "Combustible", descripcion: "Diesel", cantidad: "1.00", monto: "450.00",
    metodo_pago: "Efectivo", numero_cuenta_pago: null, tiene_factura: 1,
    observaciones: null, activo: 1, creado_por: "admin", creado_en: "2026-09-01 10:00:00",
    actualizado_en: "2026-09-01 10:00:00",
    ...overrides,
  };
}

beforeEach(() => vi.resetAllMocks());

describe("catálogo de categorías", () => {
  it("incluye las categorías originales más las del Excel operativo real (GASTOS-OPERATIVOS-DETALLE-FORMATO-1); 'Otros' siempre al final", () => {
    expect(CATEGORIAS_GASTO).toEqual([
      "Combustible", "Hospedaje", "Parqueo", "Cuadrilla", "Auxiliar extra",
      "Mantenimiento", "Arbitrios", "Transporte",
      "Comida", "Aceite", "Medicamento", "Bonificación",
      "Otros",
    ]);
  });
});

describe("métodos de pago", () => {
  it("incluye Transferencia móvil sin retirar los métodos existentes", () => {
    expect(METODOS_PAGO_GASTO).toContain("Transferencia móvil");
    expect(METODOS_PAGO_GASTO).toEqual(expect.arrayContaining(["Efectivo", "Transferencia", "Tarjeta", "Cheque", "Otro"]));
  });
});

describe("listarGastos", () => {
  it("mapea filas y aplica filtro de activos por defecto", async () => {
    vi.mocked(query).mockResolvedValue([filaGasto()] as never);
    const [g] = await listarGastos(7);
    expect(vi.mocked(query).mock.calls[0][0]).toContain("g.activo = 1");
    expect(g).toMatchObject<Partial<GastoOperativo>>({
      id: 1, empresaId: 7, categoria: "Combustible", monto: 450, cantidad: 1,
      tieneFactura: true, empleadoNombre: "Juan Perez", vehiculoPlaca: "P-123ABC",
      clienteNombre: "Cliente Acme", planCodigo: "PLAN-20260901-001",
    });
  });

  it("AISLAMIENTO MULTIEMPRESA: los JOIN de empleado/vehiculo/cliente/plan exigen empresa_id igual, no solo el id (bloqueo 1, revisión PR #204)", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await listarGastos(7);
    const sql = vi.mocked(query).mock.calls[0][0] as string;
    expect(sql).toContain("emp.id = g.empleado_id AND emp.empresa_id = g.empresa_id");
    expect(sql).toContain("veh.id = g.vehiculo_id AND veh.empresa_id = g.empresa_id");
    expect(sql).toContain("cli.id = g.cliente_id AND cli.empresa_id = g.empresa_id");
    expect(sql).toContain("plan.id = g.plan_id AND plan.empresa_id = g.empresa_id");
  });

  it("incluirInactivos evita el filtro de activo", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await listarGastos(7, { incluirInactivos: true });
    expect(vi.mocked(query).mock.calls[0][0]).not.toContain("g.activo = 1");
  });

  it("aplica filtros de fecha/categoria/cliente/vehiculo/plan/empleado", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await listarGastos(7, {
      fechaDesde: "2026-01-01", fechaHasta: "2026-01-31", categoria: "Hospedaje",
      clienteId: 2, vehiculoId: 3, planId: 4, empleadoId: 5,
    });
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("g.categoria = ?");
    expect(params).toEqual([7, "2026-01-01", "2026-01-31", "Hospedaje", 2, 3, 4, 5]);
  });
});

describe("obtenerGasto", () => {
  it("devuelve null si no existe", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    expect(await obtenerGasto(7, 999)).toBeNull();
  });
});

describe("crearGasto", () => {
  it("rechaza monto <= 0", async () => {
    await expect(crearGasto(7, {
      fechaSolicitud: "2026-09-01", categoria: "Combustible", monto: 0,
    })).rejects.toThrow("mayor a cero");
    expect(execute).not.toHaveBeenCalled();
  });

  it("rechaza sin categoría", async () => {
    await expect(crearGasto(7, {
      fechaSolicitud: "2026-09-01", categoria: "", monto: 10,
    })).rejects.toThrow("Categoría");
  });

  it("inserta y devuelve el gasto creado", async () => {
    vi.mocked(execute).mockResolvedValue({ insertId: 55 } as never);
    vi.mocked(query).mockResolvedValue([filaGasto({ id: 55 })] as never);
    const g = await crearGasto(7, {
      fechaSolicitud: "2026-09-01", categoria: "Combustible", monto: 450,
    }, "admin");
    expect(g.id).toBe(55);
    expect(vi.mocked(execute).mock.calls[0][0]).toContain("INSERT INTO tms_gastos_operativos");
  });

  describe("AISLAMIENTO MULTIEMPRESA: rechaza referencias que no pertenecen a la empresa actual (bloqueo 1, revisión PR #204)", () => {
    it("empleado de otra empresa (id existe, pero no en esta empresa) se rechaza sin insertar", async () => {
      vi.mocked(query).mockResolvedValue([] as never); // ninguna referencia encuentra fila -> no pertenece a esta empresa
      await expect(crearGasto(7, {
        fechaSolicitud: "2026-09-01", categoria: "Combustible", monto: 100, empleadoId: 999,
      })).rejects.toThrow("El empleado indicado no pertenece a esta empresa.");
      expect(execute).not.toHaveBeenCalled();
    });

    it("vehiculo de otra empresa se rechaza", async () => {
      vi.mocked(query).mockResolvedValue([] as never);
      await expect(crearGasto(7, {
        fechaSolicitud: "2026-09-01", categoria: "Combustible", monto: 100, vehiculoId: 999,
      })).rejects.toThrow("El vehículo indicado no pertenece a esta empresa.");
      expect(execute).not.toHaveBeenCalled();
    });

    it("cliente de otra empresa se rechaza", async () => {
      vi.mocked(query).mockResolvedValue([] as never);
      await expect(crearGasto(7, {
        fechaSolicitud: "2026-09-01", categoria: "Combustible", monto: 100, clienteId: 999,
      })).rejects.toThrow("El cliente indicado no pertenece a esta empresa.");
      expect(execute).not.toHaveBeenCalled();
    });

    it("plan/viaje de otra empresa se rechaza", async () => {
      vi.mocked(query).mockResolvedValue([] as never);
      await expect(crearGasto(7, {
        fechaSolicitud: "2026-09-01", categoria: "Combustible", monto: 100, planId: 999,
      })).rejects.toThrow("El viaje/plan indicado no pertenece a esta empresa.");
      expect(execute).not.toHaveBeenCalled();
    });

    it("con id válido de la MISMA empresa, sí inserta (no bloquea referencias legítimas)", async () => {
      vi.mocked(query)
        .mockResolvedValueOnce([{ id: 3 }] as never) // valida empleado
        .mockResolvedValueOnce([filaGasto({ id: 55 })] as never); // obtenerGasto tras crear
      vi.mocked(execute).mockResolvedValue({ insertId: 55 } as never);
      const g = await crearGasto(7, {
        fechaSolicitud: "2026-09-01", categoria: "Combustible", monto: 100, empleadoId: 3,
      });
      expect(g.id).toBe(55);
      expect(execute).toHaveBeenCalledOnce();
    });
  });
});

describe("actualizarGasto / desactivarGasto", () => {
  it("devuelve null si el gasto no existe", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    expect(await actualizarGasto(7, 999, { monto: 100 })).toBeNull();
  });

  it("preserva campos no enviados y aplica los enviados", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce([filaGasto()] as never) // obtenerGasto (actual)
      .mockResolvedValueOnce([filaGasto({ monto: "999.00" })] as never); // obtenerGasto (tras UPDATE)
    const g = await actualizarGasto(7, 1, { monto: 999 });
    expect(g?.monto).toBe(999);
    const params = vi.mocked(execute).mock.calls[0][1] as unknown[];
    expect(params).toContain("Combustible"); // categoría preservada del actual
  });

  it("no permite guardar tiene_factura=0 mientras existe comprobante almacenado", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce([filaGasto({ factura_nombre_original: "factura.pdf", factura_tamano: 100 })] as never)
      .mockResolvedValueOnce([filaGasto({ factura_nombre_original: "factura.pdf", factura_tamano: 100, tiene_factura: 1 })] as never);
    await actualizarGasto(7, 1, { tieneFactura: false });
    const params = vi.mocked(execute).mock.calls[0][1] as unknown[];
    expect(params[12]).toBe(1);
  });

  it("desactivarGasto pone activo=false sin tocar el resto", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce([filaGasto()] as never)
      .mockResolvedValueOnce([filaGasto({ activo: 0 })] as never);
    const g = await desactivarGasto(7, 1);
    expect(g?.activo).toBe(false);
  });

  it("AISLAMIENTO MULTIEMPRESA: rechaza reasignar el gasto a un vehiculo de otra empresa", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce([filaGasto()] as never) // obtenerGasto (actual)
      .mockResolvedValueOnce([] as never); // valida vehiculo -> no existe en esta empresa
    await expect(actualizarGasto(7, 1, { vehiculoId: 999 })).rejects.toThrow("El vehículo indicado no pertenece a esta empresa.");
    expect(execute).not.toHaveBeenCalled();
  });

  it("no re-valida referencias que no cambiaron (solo valida lo que viene en `cambios`)", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce([filaGasto()] as never) // obtenerGasto (actual): trae empleado/vehiculo/cliente/plan ya asignados
      .mockResolvedValueOnce([filaGasto({ monto: "999.00" })] as never); // obtenerGasto (tras UPDATE)
    // Solo se envía `monto` — ninguna referencia debería re-validarse, así
    // que `query` solo debe llamarse 2 veces (antes y después del UPDATE).
    const g = await actualizarGasto(7, 1, { monto: 999 });
    expect(g?.monto).toBe(999);
    expect(query).toHaveBeenCalledTimes(2);
  });
});
