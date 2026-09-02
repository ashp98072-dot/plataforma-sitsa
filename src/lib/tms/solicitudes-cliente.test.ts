import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ getPool: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: vi.fn() }));

import { getPool, query } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { hoyLocal } from "@/lib/rrhh/dates";
import {
  contarEntregas,
  crearSolicitudCliente,
  esTipoSolicitudParadaValido,
  listarSolicitudesCliente,
  obtenerSolicitudCliente,
  resumenSolicitudesCliente,
  validarParadasSolicitud,
  type CrearSolicitudClienteInput,
  type SolicitudParadaInput,
} from "./solicitudes-cliente";

function parada(overrides: Partial<SolicitudParadaInput> = {}): SolicitudParadaInput {
  return { orden: 1, tipo: "Carga", lugarNombre: "Bodega central", ...overrides };
}

describe("esTipoSolicitudParadaValido", () => {
  it("acepta solo Carga/Entrega/Descarga", () => {
    expect(esTipoSolicitudParadaValido("Carga")).toBe(true);
    expect(esTipoSolicitudParadaValido("Entrega")).toBe(true);
    expect(esTipoSolicitudParadaValido("Descarga")).toBe(true);
    expect(esTipoSolicitudParadaValido("Salida")).toBe(false);
    expect(esTipoSolicitudParadaValido("")).toBe(false);
  });
});

describe("validarParadasSolicitud", () => {
  it("1 Carga + N Entregas + 1 Descarga = válido", () => {
    const r = validarParadasSolicitud([
      parada({ orden: 1, tipo: "Carga" }),
      parada({ orden: 2, tipo: "Entrega", lugarNombre: "Cliente A" }),
      parada({ orden: 3, tipo: "Entrega", lugarNombre: "Cliente B" }),
      parada({ orden: 4, tipo: "Descarga", lugarNombre: "Bodega final" }),
    ]);
    expect(r.ok).toBe(true);
  });

  it("CLIENTE-PORTAL-2: 1 Carga + 0 Entregas + 1 Descarga = INVÁLIDO (antes se permitía 0..N; el requerimiento real exige mínimo 1 entrega)", () => {
    const r = validarParadasSolicitud([
      parada({ orden: 1, tipo: "Carga" }),
      parada({ orden: 2, tipo: "Descarga", lugarNombre: "Bodega final" }),
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/al menos una entrega/i);
  });

  it("sin Carga = inválido", () => {
    const r = validarParadasSolicitud([
      parada({ orden: 1, tipo: "Entrega" }),
      parada({ orden: 2, tipo: "Descarga" }),
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/origen/i);
  });

  it("sin Descarga = inválido", () => {
    const r = validarParadasSolicitud([
      parada({ orden: 1, tipo: "Carga" }),
      parada({ orden: 2, tipo: "Entrega" }),
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/destino|entrega/i);
  });

  it("2 Cargas = inválido", () => {
    const r = validarParadasSolicitud([
      parada({ orden: 1, tipo: "Carga" }),
      parada({ orden: 2, tipo: "Carga" }),
      parada({ orden: 3, tipo: "Entrega" }),
      parada({ orden: 4, tipo: "Descarga" }),
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/más de un origen/i);
  });

  it("2 Descargas = inválido", () => {
    const r = validarParadasSolicitud([
      parada({ orden: 1, tipo: "Carga" }),
      parada({ orden: 2, tipo: "Entrega" }),
      parada({ orden: 3, tipo: "Descarga" }),
      parada({ orden: 4, tipo: "Descarga" }),
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/más de un destino/i);
  });

  it("tipo arbitrario = inválido", () => {
    const r = validarParadasSolicitud([
      parada({ orden: 1, tipo: "Carga" }),
      // "Salida" es intencionalmente un tipo fuera de la lista cerrada —
      // SolicitudParadaInput.tipo es `string` a propósito (el valor llega
      // como texto desde fuera, ej. un body HTTP, antes de validarse).
      parada({ orden: 2, tipo: "Salida" }),
      parada({ orden: 3, tipo: "Descarga" }),
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/no permitido/i);
  });

  it("orden repetido = inválido", () => {
    const r = validarParadasSolicitud([
      parada({ orden: 1, tipo: "Carga" }),
      parada({ orden: 1, tipo: "Entrega" }),
      parada({ orden: 2, tipo: "Descarga" }),
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/mismo orden/i);
  });

  it("Carga no es la primera parada = inválido", () => {
    const r = validarParadasSolicitud([
      parada({ orden: 1, tipo: "Entrega" }),
      parada({ orden: 2, tipo: "Carga" }),
      parada({ orden: 3, tipo: "Descarga" }),
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/origen/i);
  });

  it("Descarga no es la última parada = inválido", () => {
    const r = validarParadasSolicitud([
      parada({ orden: 1, tipo: "Carga" }),
      parada({ orden: 2, tipo: "Descarga" }),
      parada({ orden: 3, tipo: "Entrega" }),
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/última/i);
  });

  it("lista vacía = inválido", () => {
    expect(validarParadasSolicitud([]).ok).toBe(false);
  });
});

describe("contarEntregas", () => {
  it("cuenta solo las paradas de tipo Entrega (cantidad_entregas siempre derivado, nunca almacenado)", () => {
    expect(
      contarEntregas([
        { tipo: "Carga" },
        { tipo: "Entrega" },
        { tipo: "Entrega" },
        { tipo: "Descarga" },
      ]),
    ).toBe(2);
  });
});

// ============================================================
// crearSolicitudCliente — validaciones + transacción
// ============================================================

function inputValido(overrides: Partial<CrearSolicitudClienteInput> = {}): CrearSolicitudClienteInput {
  return {
    fechaSolicitada: "2099-01-15",
    horaSolicitada: null,
    referenciaCliente: null,
    observaciones: null,
    origen: { lugarNombre: "Bodega PriceSmart Zona 4" },
    entregas: [{ lugarNombre: "Sucursal 1" }, { lugarNombre: "Sucursal 2" }],
    destino: { lugarNombre: "Bodega central de retorno" },
    ...overrides,
  };
}

const SCOPE = { empresaId: 7, clienteId: 30, usuarioClienteId: 10 };

const conn = {
  beginTransaction: vi.fn(),
  execute: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getPool).mockReturnValue({
    getConnection: async () => conn,
  } as unknown as ReturnType<typeof getPool>);
  let siguienteIdParada = 1;
  conn.execute.mockImplementation(async (sql: string) => {
    if (String(sql).includes("INSERT INTO tms_solicitudes_cliente")) {
      return [{ insertId: 500, affectedRows: 1 }];
    }
    if (String(sql).includes("INSERT INTO tms_solicitud_paradas")) {
      return [{ insertId: siguienteIdParada++, affectedRows: 1 }];
    }
    return [{ affectedRows: 1 }];
  });
  // Por defecto: sin cliente_ubicacion_id en el input, así que la
  // consulta a tms_cliente_ubicaciones no debería ni llamarse en la
  // mayoría de los tests (cuando un test SÍ manda uno, sobreescribe este
  // mock). La re-lectura post-commit (obtenerSolicitudCliente) tiene una
  // fila mínima válida por defecto para que cualquier test de
  // "validaciones" que llegue hasta el commit no falle solo por eso —
  // los tests que sí examinan el detalle devuelto sobreescriben esto.
  vi.mocked(query).mockImplementation((async (sql: string) => {
    const s = String(sql);
    if (s.includes("FROM tms_cliente_ubicaciones")) return [];
    if (s.includes("FROM tms_solicitudes_cliente s") && s.includes("WHERE s.id")) {
      return [
        {
          id: 500,
          empresa_id: SCOPE.empresaId,
          cliente_id: SCOPE.clienteId,
          creado_por_usuario_cliente_id: SCOPE.usuarioClienteId,
          estado: "SOLICITADA",
          fecha_solicitada: "2099-01-15",
          hora_solicitada: null,
          referencia_cliente: null,
          observaciones: null,
          motivo_rechazo: null,
          plan_id: null,
          version: 1,
          creado_en: "2026-09-02 08:00:00",
          actualizado_en: "2026-09-02 08:00:00",
          creado_por_nombre: null,
        },
      ];
    }
    if (s.includes("FROM tms_solicitud_paradas")) return [];
    return [];
  }) as never);
});

describe("crearSolicitudCliente — validaciones (fallan ANTES de abrir conexión)", () => {
  it("fecha en el pasado → rechazada", async () => {
    const r = await crearSolicitudCliente(SCOPE, inputValido({ fechaSolicitada: "2000-01-01" }));
    expect(r).toEqual({ ok: false, mensaje: "La fecha solicitada no puede ser anterior a hoy." });
    expect(getPool).not.toHaveBeenCalled();
  });

  it("hoy es válido (el límite es 'no anterior a hoy', no 'estrictamente futuro')", async () => {
    const r = await crearSolicitudCliente(SCOPE, inputValido({ fechaSolicitada: hoyLocal() }));
    expect(r.ok).toBe(true);
  });

  it("fecha con formato inválido → rechazada", async () => {
    const r = await crearSolicitudCliente(SCOPE, inputValido({ fechaSolicitada: "15/01/2099" }));
    expect(r.ok).toBe(false);
    expect(getPool).not.toHaveBeenCalled();
  });

  // AJUSTE PRE-MERGE PR #172 (punto 2) — el regex de formato solo no
  // detecta fechas de calendario imposibles; esFechaCalendarioValida()
  // (interna) sí. Puramente en JS, sin depender de SQL_MODE de MariaDB.
  it.each(["2026-02-30", "2026-02-31", "2026-13-01", "2026-00-10", "2026-01-32", "2026-04-31"])(
    "fecha calendario imposible '%s' → rechazada",
    async (fechaImposible) => {
      const r = await crearSolicitudCliente(SCOPE, inputValido({ fechaSolicitada: fechaImposible }));
      expect(r.ok).toBe(false);
      expect(getPool).not.toHaveBeenCalled();
    },
  );

  it("29 de febrero de un año bisiesto (2028) → aceptada", async () => {
    const r = await crearSolicitudCliente(SCOPE, inputValido({ fechaSolicitada: "2028-02-29" }));
    expect(r.ok).toBe(true);
  });

  it("29 de febrero de un año NO bisiesto (2026) → rechazada", async () => {
    const r = await crearSolicitudCliente(SCOPE, inputValido({ fechaSolicitada: "2026-02-29" }));
    expect(r.ok).toBe(false);
  });

  it("hora inválida → rechazada", async () => {
    const r = await crearSolicitudCliente(SCOPE, inputValido({ horaSolicitada: "25:99" }));
    expect(r).toEqual({ ok: false, mensaje: "La hora solicitada no es válida." });
  });

  it("referencia_cliente supera el máximo → rechazada", async () => {
    const r = await crearSolicitudCliente(
      SCOPE,
      inputValido({ referenciaCliente: "x".repeat(121) }),
    );
    expect(r.ok).toBe(false);
    expect(getPool).not.toHaveBeenCalled();
  });

  it("observaciones supera el máximo → rechazada", async () => {
    const r = await crearSolicitudCliente(
      SCOPE,
      inputValido({ observaciones: "x".repeat(501) }),
    );
    expect(r.ok).toBe(false);
    expect(getPool).not.toHaveBeenCalled();
  });

  it("sin entregas → rechazada", async () => {
    const r = await crearSolicitudCliente(SCOPE, inputValido({ entregas: [] }));
    expect(r.ok).toBe(false);
    expect(getPool).not.toHaveBeenCalled();
  });

  it("origen sin lugar → rechazada", async () => {
    const r = await crearSolicitudCliente(SCOPE, inputValido({ origen: { lugarNombre: "  " } }));
    expect(r.ok).toBe(false);
  });

  it("una entrega sin lugar → rechazada", async () => {
    const r = await crearSolicitudCliente(
      SCOPE,
      inputValido({ entregas: [{ lugarNombre: "Sucursal 1" }, { lugarNombre: "" }] }),
    );
    expect(r.ok).toBe(false);
  });
});

describe("crearSolicitudCliente — reconstrucción de orden server-side (CLIENTE-PORTAL-2, sección 4)", () => {
  it("Carga=1, Entregas=2..N+1 en el orden recibido, Descarga=último — el input NO tiene ningún campo 'orden'", async () => {
    const r = await crearSolicitudCliente(SCOPE, inputValido());
    expect(r.ok).toBe(true);

    const insertsParadas = conn.execute.mock.calls.filter(([sql]) =>
      String(sql).includes("INSERT INTO tms_solicitud_paradas"),
    );
    expect(insertsParadas).toHaveLength(4); // Carga + 2 Entregas + Descarga
    const [, , orden0, tipo0, lugar0] = insertsParadas[0][1];
    const [, , orden1, tipo1, lugar1] = insertsParadas[1][1];
    const [, , orden2, tipo2, lugar2] = insertsParadas[2][1];
    const [, , orden3, tipo3, lugar3] = insertsParadas[3][1];
    expect([orden0, tipo0, lugar0]).toEqual([1, "Carga", "Bodega PriceSmart Zona 4"]);
    expect([orden1, tipo1, lugar1]).toEqual([2, "Entrega", "Sucursal 1"]);
    expect([orden2, tipo2, lugar2]).toEqual([3, "Entrega", "Sucursal 2"]);
    expect([orden3, tipo3, lugar3]).toEqual([4, "Descarga", "Bodega central de retorno"]);
  });
});

describe("crearSolicitudCliente — transacción", () => {
  it("éxito: INSERT cabecera + N paradas + auditoría, TODO en la misma conexión, luego commit (nunca rollback)", async () => {
    const r = await crearSolicitudCliente(SCOPE, inputValido());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.solicitud.id).toBe(500);
      expect(r.solicitud.estado).toBe("SOLICITADA");
      expect(r.solicitud.cantidadEntregas).toBe(2);
      expect(r.solicitud.paradas).toHaveLength(4);
      expect(r.solicitud.paradas.map((p) => p.tipo)).toEqual([
        "Carga",
        "Entrega",
        "Entrega",
        "Descarga",
      ]);
    }
    expect(conn.beginTransaction).toHaveBeenCalledOnce();
    expect(registrarAuditoriaTx).toHaveBeenCalledWith(
      conn,
      expect.objectContaining({
        empresaId: 7,
        usuario: "cliente-portal:10",
        accion: "crear_solicitud_cliente",
      }),
    );
    expect(conn.commit).toHaveBeenCalledOnce();
    expect(conn.rollback).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledOnce();
  });

  // AJUSTE PRE-MERGE PR #172 (punto 1) — CASO A: falla un INSERT ANTES
  // del commit → rollback, error, ningún éxito. (Cubierto en detalle por
  // el test "rollback total si falla la inserción de una parada" más
  // abajo — este es el mismo caso, referenciado aquí explícitamente por
  // el nombre que pide el ticket.)
  it("CASO A — falla el INSERT de la cabecera (antes de cualquier parada) → rollback, error, sin éxito", async () => {
    conn.execute.mockImplementation(async (sql: string) => {
      if (String(sql).includes("INSERT INTO tms_solicitudes_cliente")) {
        throw new Error("fallo simulado en la cabecera");
      }
      return [{ affectedRows: 1 }];
    });
    await expect(crearSolicitudCliente(SCOPE, inputValido())).rejects.toThrow("fallo simulado");
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
  });

  // AJUSTE PRE-MERGE PR #172 (punto 1) — CASO B: la vieja implementación
  // releía la solicitud de la base de datos DESPUÉS del commit; si esa
  // relectura fallaba, el catch disparaba un rollback ya sin efecto real
  // (el commit ya había ocurrido) y el caller recibía una excepción como
  // si la creación hubiera fallado — riesgo real de que el cliente
  // reintentara y creara un duplicado. La implementación actual ELIMINA
  // esa relectura: la respuesta se arma con datos ya conocidos de la
  // propia transacción. Se prueba la ausencia total de esa relectura —
  // ni siquiera se llama a `query()` una vez que la transacción
  // determina que no hay ubicaciones que validar.
  it("CASO B — NO hay relectura post-commit: query() nunca se invoca durante una creación exitosa sin ubicaciones", async () => {
    const r = await crearSolicitudCliente(SCOPE, inputValido());
    expect(r.ok).toBe(true);
    expect(query).not.toHaveBeenCalled();
  });

  it("CASO B (variante) — aunque query() estuviera configurado para fallar, el resultado de una creación exitosa no se ve afectado (no hay ninguna llamada a query() que dependa de él)", async () => {
    vi.mocked(query).mockRejectedValue(new Error("la base de datos estaría caída para cualquier lectura posterior"));
    const r = await crearSolicitudCliente(SCOPE, inputValido());
    expect(r.ok).toBe(true);
    expect(conn.commit).toHaveBeenCalledOnce();
    expect(conn.rollback).not.toHaveBeenCalled();
  });

  it("empresaId/clienteId/usuarioClienteId del INSERT vienen del scope, nunca de un campo del input (que ni siquiera los tiene)", async () => {
    await crearSolicitudCliente(SCOPE, inputValido());
    const insertCabecera = conn.execute.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO tms_solicitudes_cliente"),
    );
    expect(insertCabecera![1]).toEqual([7, 30, 10, "2099-01-15", null, null, null]);
  });

  it("rollback total si falla la inserción de una parada — cero filas quedan, no hay commit parcial", async () => {
    conn.execute.mockImplementation(async (sql: string) => {
      const s = String(sql);
      if (s.includes("INSERT INTO tms_solicitudes_cliente")) return [{ insertId: 500 }];
      if (s.includes("INSERT INTO tms_solicitud_paradas")) {
        // Falla justo en la 2ª parada (la primera entrega).
        if (conn.execute.mock.calls.filter(([q]) => String(q).includes("tms_solicitud_paradas")).length === 1) {
          return [{ affectedRows: 1 }];
        }
        throw new Error("fallo simulado de escritura");
      }
      return [{ affectedRows: 1 }];
    });
    await expect(crearSolicitudCliente(SCOPE, inputValido())).rejects.toThrow("fallo simulado");
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledOnce();
  });

  it("ubicación de otro cliente (o inexistente) → rechazada, NUNCA abre conexión/transacción", async () => {
    vi.mocked(query).mockImplementation(async (sql: string) => {
      if (String(sql).includes("FROM tms_cliente_ubicaciones")) return []; // no encontrada para este empresa+cliente
      return [];
    });
    const r = await crearSolicitudCliente(
      SCOPE,
      inputValido({ origen: { lugarNombre: "Bodega", clienteUbicacionId: 999 } }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.mensaje).toMatch(/no pertenece a este cliente/i);
    expect(getPool).not.toHaveBeenCalled();
  });

  it("ubicación que SÍ pertenece al cliente → aceptada, se valida contra empresaId+clienteId de la sesión", async () => {
    vi.mocked(query).mockImplementation((async (sql: string) => {
      const s = String(sql);
      if (s.includes("FROM tms_cliente_ubicaciones")) return [{ id: 55 }];
      if (s.includes("FROM tms_solicitudes_cliente s") && s.includes("WHERE s.id")) {
        return [
          {
            id: 500, empresa_id: 7, cliente_id: 30, creado_por_usuario_cliente_id: 10,
            estado: "SOLICITADA", fecha_solicitada: "2099-01-15", hora_solicitada: null,
            referencia_cliente: null, observaciones: null, motivo_rechazo: null, plan_id: null,
            version: 1, creado_en: "2026-09-02 08:00:00", actualizado_en: "2026-09-02 08:00:00",
            creado_por_nombre: null,
          },
        ];
      }
      return [];
    }) as never);
    const r = await crearSolicitudCliente(
      SCOPE,
      inputValido({ origen: { lugarNombre: "Bodega", clienteUbicacionId: 55 } }),
    );
    expect(r.ok).toBe(true);
    const llamadaUbicacion = vi.mocked(query).mock.calls.find(([sql]) =>
      String(sql).includes("FROM tms_cliente_ubicaciones"),
    );
    expect(llamadaUbicacion![1]).toEqual([7, 30, 55]);
  });
});

// ============================================================
// Lectura (listar / detalle / resumen)
// ============================================================

describe("listarSolicitudesCliente", () => {
  it("siempre filtra por empresa_id + cliente_id, y aplica filtros opcionales", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await listarSolicitudesCliente(7, 30, { estado: "SOLICITADA", fechaDesde: "2026-01-01", fechaHasta: "2026-12-31", limite: 5 });
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(String(sql)).toContain("WHERE s.empresa_id = ? AND s.cliente_id = ?");
    expect(String(sql)).toContain("ORDER BY s.creado_en DESC");
    expect(params).toEqual([7, 30, "SOLICITADA", "2026-01-01", "2026-12-31", 5]);
  });

  it("ignora un valor de estado que no es uno de los 5 permitidos (no arma un WHERE con basura)", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await listarSolicitudesCliente(7, 30, { estado: "cualquier-cosa" });
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(String(sql)).not.toContain("s.estado = ?");
    expect(params).toEqual([7, 30]);
  });
});

describe("obtenerSolicitudCliente", () => {
  it("filtra por id + empresa_id + cliente_id a la vez", async () => {
    vi.mocked(query).mockResolvedValueOnce([] as never);
    const r = await obtenerSolicitudCliente(7, 30, 999);
    expect(r).toBeNull();
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(String(sql)).toContain("WHERE s.id = ? AND s.empresa_id = ? AND s.cliente_id = ?");
    expect(params).toEqual([999, 7, 30]);
  });

  it("solicitud de OTRO cliente/empresa → null (mismo resultado que 'no existe', sin distinguir el motivo)", async () => {
    // Simula lo que MySQL devolvería si la solicitud #500 es real pero
    // pertenece a otra empresa/cliente: el WHERE no encuentra fila.
    vi.mocked(query).mockResolvedValueOnce([] as never);
    expect(await obtenerSolicitudCliente(999, 999, 500)).toBeNull();
  });
});

describe("resumenSolicitudesCliente", () => {
  it("agrega pendientes/programadas/rechazadasCanceladas/total a partir del GROUP BY estado", async () => {
    vi.mocked(query).mockImplementation((async (sql: string) => {
      const s = String(sql);
      if (s.includes("GROUP BY estado")) {
        return [
          { estado: "SOLICITADA", n: 3 },
          { estado: "EN_REVISION", n: 2 },
          { estado: "PROGRAMADA", n: 5 },
          { estado: "RECHAZADA", n: 1 },
          { estado: "CANCELADA", n: 1 },
        ];
      }
      return []; // recientes (listarSolicitudesCliente)
    }) as never);
    const r = await resumenSolicitudesCliente(7, 30);
    expect(r.pendientes).toBe(5); // 3 SOLICITADA + 2 EN_REVISION
    expect(r.programadas).toBe(5);
    expect(r.rechazadasCanceladas).toBe(2); // 1 RECHAZADA + 1 CANCELADA
    expect(r.total).toBe(12);
  });

  it("cliente sin solicitudes → todo en 0, sin recientes", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    const r = await resumenSolicitudesCliente(7, 30);
    expect(r).toEqual({ pendientes: 0, programadas: 0, rechazadasCanceladas: 0, total: 0, recientes: [] });
  });
});
