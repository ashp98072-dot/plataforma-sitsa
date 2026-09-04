import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoria: vi.fn() }));
vi.mock("@/lib/rrhh/colaborador-session", () => ({ getColaboradorSession: vi.fn() }));
vi.mock("@/lib/rrhh/empleados", () => ({ obtenerEmpleado: vi.fn() }));
vi.mock("@/lib/flota/viajes-piloto", () => ({ colaboradorParticipaEnViaje: vi.fn() }));
vi.mock("@/lib/flota/schema", () => ({
  asegurarSchemaFlota: vi.fn(() => Promise.resolve()),
  asegurarSchemaFlotaLectura: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/lib/flota/combustible", () => ({
  registrarCargaCombustible: vi.fn(() => Promise.resolve(1)),
  listarCargasCombustibleViaje: vi.fn(() => Promise.resolve([])),
  obtenerArchivoCargaCombustible: vi.fn(),
}));
vi.mock("@/lib/uploads", async () => {
  const actual = await vi.importActual<typeof import("@/lib/uploads")>("@/lib/uploads");
  return {
    ...actual,
    absPathFromRelative: vi.fn((p: string) => p),
    contentTypeFor: vi.fn(() => "image/jpeg"),
  };
});

import { query } from "@/lib/db";
import { registrarAuditoria } from "@/lib/auditoria";
import { colaboradorParticipaEnViaje } from "@/lib/flota/viajes-piloto";
import { registrarCargaCombustible } from "@/lib/flota/combustible";
import { getColaboradorSession } from "@/lib/rrhh/colaborador-session";
import { obtenerEmpleado } from "@/lib/rrhh/empleados";
import { UploadValidationError } from "@/lib/uploads";
import { GET, POST } from "./route";

const ctx = { params: Promise.resolve({ id: "5" }) };

// FLOTA-COMBUSTIBLE-2 — numeroVale/fechaConsumo/precioGalon ahora son
// obligatorios; se aplican como default razonable para que los tests que
// no los prueban explícitamente no tengan que repetirlos en cada
// llamada. Un test que quiera probar "campo ausente/inválido" lo
// sobreescribe con "" (o un valor inválido) en `fields`.
const CAMPOS_NUEVOS_DEFAULT = { numeroVale: "A-12345", fechaConsumo: "2026-09-02", precioGalon: "21.26" };

function formData(fields: Record<string, string>, conFoto = true) {
  const form = new FormData();
  for (const [k, v] of Object.entries({ ...CAMPOS_NUEVOS_DEFAULT, ...fields })) form.set(k, v);
  if (conFoto) form.set("file", new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }), "vale.jpg");
  return form;
}

function req(form: FormData) {
  return new Request("http://localhost/api/portal/viajes/5/combustible", { method: "POST", body: form });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getColaboradorSession).mockResolvedValue(
    { empresaId: 7, empleadoId: 42 } as Awaited<ReturnType<typeof getColaboradorSession>>,
  );
  vi.mocked(obtenerEmpleado).mockResolvedValue(
    { nombre: "Juan Pérez", codigo: "E001" } as unknown as Awaited<ReturnType<typeof obtenerEmpleado>>,
  );
  vi.mocked(colaboradorParticipaEnViaje).mockResolvedValue({ viajeId: 5, planId: 30, estado: "abierto" });
  // empleado_id: 42 === session.empleadoId -> la sesión de estos tests
  // por defecto ES el piloto responsable (dueño real de flota_viajes).
  vi.mocked(query).mockResolvedValue([{ vehiculo_id: 3, piloto_nombre: "Juan Pérez", empleado_id: 42 }] as never);
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/portal/viajes/[id]/combustible", () => {
  it("exige participación en el viaje ANTES de tocar la lib", async () => {
    vi.mocked(colaboradorParticipaEnViaje).mockResolvedValue(null);
    const res = await POST(req(formData({ tipoCombustible: "diesel", galones: "40", monto: "850" })), ctx);
    expect(res.status).toBe(403);
    expect(registrarCargaCombustible).not.toHaveBeenCalled();
  });

  it("viaje NO abierto (ya cerrado) -> 409, sin llamar a la lib", async () => {
    vi.mocked(colaboradorParticipaEnViaje).mockResolvedValue({ viajeId: 5, planId: 30, estado: "cerrado" });
    const res = await POST(req(formData({ tipoCombustible: "diesel", galones: "40", monto: "850" })), ctx);
    expect(res.status).toBe(409);
    expect(registrarCargaCombustible).not.toHaveBeenCalled();
  });

  // FLOTA-COMBUSTIBLE-HARDENING-1 (sección 1) — colaboradorParticipaEnViaje()
  // por sí solo acepta piloto O auxiliar (confirmado en su propio código,
  // ver JSDoc del route). El registro de combustible exige además que la
  // sesión sea el dueño real de flota_viajes (empleado_id) — nunca un
  // auxiliar, aunque esté legítimamente asignado al mismo viaje.
  describe("solo el piloto responsable (flota_viajes.empleado_id) registra combustible", () => {
    it("piloto asignado (empleado_id de la sesión) -> permitido (200)", async () => {
      vi.mocked(query).mockResolvedValue([{ vehiculo_id: 3, piloto_nombre: "Juan Pérez", empleado_id: 42 }] as never);
      const res = await POST(req(formData({ tipoCombustible: "diesel", galones: "40", monto: "850" })), ctx);
      expect(res.status).toBe(200);
      expect(registrarCargaCombustible).toHaveBeenCalled();
    });

    it("auxiliar asignado al mismo viaje (pasa colaboradorParticipaEnViaje, pero NO es el dueño) -> 403", async () => {
      // colaboradorParticipaEnViaje() sí lo autoriza (está asignado como
      // auxiliar), pero flota_viajes.empleado_id (99) es el PILOTO, no
      // esta sesión (42) — debe rechazarse igual.
      vi.mocked(colaboradorParticipaEnViaje).mockResolvedValue({ viajeId: 5, planId: 30, estado: "abierto" });
      vi.mocked(query).mockResolvedValue([{ vehiculo_id: 3, piloto_nombre: "Piloto Titular", empleado_id: 99 }] as never);
      const res = await POST(req(formData({ tipoCombustible: "diesel", galones: "40", monto: "850" })), ctx);
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toContain("piloto responsable");
      expect(registrarCargaCombustible).not.toHaveBeenCalled();
    });

    it("empleado ajeno (ni piloto ni auxiliar del viaje) -> 403 (colaboradorParticipaEnViaje ya lo rechaza)", async () => {
      vi.mocked(colaboradorParticipaEnViaje).mockResolvedValue(null);
      const res = await POST(req(formData({ tipoCombustible: "diesel", galones: "40", monto: "850" })), ctx);
      expect(res.status).toBe(403);
      expect(registrarCargaCombustible).not.toHaveBeenCalled();
    });
  });

  it("tipo de combustible inválido -> 400", async () => {
    const res = await POST(req(formData({ tipoCombustible: "premium", galones: "40", monto: "850" })), ctx);
    expect(res.status).toBe(400);
    expect(registrarCargaCombustible).not.toHaveBeenCalled();
  });

  it("galones <= 0 -> 400", async () => {
    const res = await POST(req(formData({ tipoCombustible: "diesel", galones: "0", monto: "850" })), ctx);
    expect(res.status).toBe(400);
    expect(registrarCargaCombustible).not.toHaveBeenCalled();
  });

  it("monto <= 0 -> 400", async () => {
    const res = await POST(req(formData({ tipoCombustible: "diesel", galones: "40", monto: "0" })), ctx);
    expect(res.status).toBe(400);
    expect(registrarCargaCombustible).not.toHaveBeenCalled();
  });

  it("sin foto del vale -> 400, sin llamar a la lib", async () => {
    const res = await POST(req(formData({ tipoCombustible: "diesel", galones: "40", monto: "850" }, false)), ctx);
    expect(res.status).toBe(400);
    expect(registrarCargaCombustible).not.toHaveBeenCalled();
  });

  // FLOTA-COMBUSTIBLE-2 (sección 2) — número de vale obligatorio.
  describe("número de vale (obligatorio)", () => {
    it("vacío -> 400, sin llamar a la lib", async () => {
      const res = await POST(req(formData({ tipoCombustible: "diesel", galones: "40", monto: "850", numeroVale: "" })), ctx);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("número de vale");
      expect(registrarCargaCombustible).not.toHaveBeenCalled();
    });

    it("solo espacios -> 400 (se recorta antes de validar)", async () => {
      const res = await POST(req(formData({ tipoCombustible: "diesel", galones: "40", monto: "850", numeroVale: "   " })), ctx);
      expect(res.status).toBe(400);
      expect(registrarCargaCombustible).not.toHaveBeenCalled();
    });

    it("no se asume formato numérico puro: un vale alfanumérico con guion se acepta", async () => {
      const res = await POST(req(formData({ tipoCombustible: "diesel", galones: "40", monto: "850", numeroVale: "A-00123/B" })), ctx);
      expect(res.status).toBe(200);
      expect(registrarCargaCombustible).toHaveBeenCalledWith(
        expect.objectContaining({ numeroVale: "A-00123/B" }),
      );
    });
  });

  // FLOTA-COMBUSTIBLE-2 (sección 3) — fecha de consumo obligatoria;
  // representa la fecha FÍSICA de la carga, no la de registro.
  describe("fecha de consumo (obligatoria)", () => {
    it("vacía -> 400, sin llamar a la lib", async () => {
      const res = await POST(req(formData({ tipoCombustible: "diesel", galones: "40", monto: "850", fechaConsumo: "" })), ctx);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("fecha");
      expect(registrarCargaCombustible).not.toHaveBeenCalled();
    });

    it("con formato inválido -> 400", async () => {
      const res = await POST(req(formData({ tipoCombustible: "diesel", galones: "40", monto: "850", fechaConsumo: "02/09/2026" })), ctx);
      expect(res.status).toBe(400);
      expect(registrarCargaCombustible).not.toHaveBeenCalled();
    });

    it("con formato pero fuera de rango de mes/día ('2026-13-40') -> 400", async () => {
      const res = await POST(req(formData({ tipoCombustible: "diesel", galones: "40", monto: "850", fechaConsumo: "2026-13-40" })), ctx);
      expect(res.status).toBe(400);
      expect(registrarCargaCombustible).not.toHaveBeenCalled();
    });

    // AJUSTE PRE-MERGE (PR #192) — bug real: "2026-02-31" (mes válido,
    // día imposible para febrero) pasaba el chequeo anterior
    // (`!Number.isNaN(new Date("2026-02-31").getTime())`) porque el
    // constructor de Date NORMALIZA el desbordamiento hacia el mes
    // siguiente en vez de fallar. esFechaCalendarioValida() (route.ts)
    // lo rechaza reconstruyendo la fecha y comparando año/mes/día.
    it("día imposible para el mes ('2026-02-31', un año NO bisiesto) -> 400 (bug real corregido)", async () => {
      const res = await POST(req(formData({ tipoCombustible: "diesel", galones: "40", monto: "850", fechaConsumo: "2026-02-31" })), ctx);
      expect(res.status).toBe(400);
      expect(registrarCargaCombustible).not.toHaveBeenCalled();
    });

    it("29 de febrero en un año NO bisiesto ('2026-02-29') -> 400", async () => {
      const res = await POST(req(formData({ tipoCombustible: "diesel", galones: "40", monto: "850", fechaConsumo: "2026-02-29" })), ctx);
      expect(res.status).toBe(400);
      expect(registrarCargaCombustible).not.toHaveBeenCalled();
    });

    it("29 de febrero en un año SÍ bisiesto ('2028-02-29') -> 200 (válida)", async () => {
      const res = await POST(req(formData({ tipoCombustible: "diesel", galones: "40", monto: "850", fechaConsumo: "2028-02-29" })), ctx);
      expect(res.status).toBe(200);
      expect(registrarCargaCombustible).toHaveBeenCalledWith(expect.objectContaining({ fechaConsumo: "2028-02-29" }));
    });

    it("día imposible para abril (30 días) ('2026-04-31') -> 400", async () => {
      const res = await POST(req(formData({ tipoCombustible: "diesel", galones: "40", monto: "850", fechaConsumo: "2026-04-31" })), ctx);
      expect(res.status).toBe(400);
      expect(registrarCargaCombustible).not.toHaveBeenCalled();
    });

    it("válida -> se envía tal cual a la lib (fecha física, distinta de creado_at)", async () => {
      const res = await POST(req(formData({ tipoCombustible: "diesel", galones: "40", monto: "850", fechaConsumo: "2026-08-15" })), ctx);
      expect(res.status).toBe(200);
      expect(registrarCargaCombustible).toHaveBeenCalledWith(
        expect.objectContaining({ fechaConsumo: "2026-08-15" }),
      );
    });
  });

  // FLOTA-COMBUSTIBLE-2 (sección 4) — precio por galón obligatorio; el
  // servidor NO recalcula ni rechaza por diferencia con el monto (eso es
  // solo una advertencia visual del formulario).
  describe("precio por galón (obligatorio)", () => {
    it("ausente/vacío -> 400, sin llamar a la lib", async () => {
      const res = await POST(req(formData({ tipoCombustible: "diesel", galones: "40", monto: "850", precioGalon: "" })), ctx);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("precio por galón");
      expect(registrarCargaCombustible).not.toHaveBeenCalled();
    });

    it("<= 0 -> 400", async () => {
      const res = await POST(req(formData({ tipoCombustible: "diesel", galones: "40", monto: "850", precioGalon: "0" })), ctx);
      expect(res.status).toBe(400);
      expect(registrarCargaCombustible).not.toHaveBeenCalled();
    });

    it("el monto ingresado y galones×precio pueden diferir: el servidor guarda el monto tal cual, sin recalcularlo ni rechazar", async () => {
      // 40 gal × Q21.26 = Q850.40, pero el piloto ingresó Q850.50 (el
      // vale real) — el servidor NO debe "corregir" monto a 850.40.
      const res = await POST(req(formData({ tipoCombustible: "diesel", galones: "40", monto: "850.50", precioGalon: "21.26" })), ctx);
      expect(res.status).toBe(200);
      expect(registrarCargaCombustible).toHaveBeenCalledWith(
        expect.objectContaining({ monto: 850.5, precioGalon: 21.26, galones: 40 }),
      );
    });
  });

  it("registra correctamente con km y gasolinera opcionales (y los 3 campos nuevos obligatorios)", async () => {
    const res = await POST(
      req(formData({ tipoCombustible: "diesel", galones: "40", monto: "850.50", km: "12000", gasolinera: "Shell Zona 10" })),
      ctx,
    );
    expect(res.status).toBe(200);
    expect(registrarCargaCombustible).toHaveBeenCalledWith(
      expect.objectContaining({
        empresaId: 7, vehiculoId: 3, viajeId: 5, empleadoId: 42, pilotoNombre: "Juan Pérez",
        tipoCombustible: "diesel", numeroVale: "A-12345", fechaConsumo: "2026-09-02",
        galones: 40, monto: 850.5, precioGalon: 21.26, km: 12000, gasolinera: "Shell Zona 10",
        username: "portal:E001",
      }),
    );
  });

  // FLOTA-COMBUSTIBLE-HARDENING-1 (sección 2) — antes quedaba "tms" por
  // inconsistencia con aprobar/rechazar (que ya audita "flota"); todo el
  // dominio de combustible debe quedar bajo el mismo módulo.
  it("audita bajo modulo 'flota' (coherente con aprobar/rechazar), nunca 'tms'", async () => {
    const res = await POST(req(formData({ tipoCombustible: "diesel", galones: "40", monto: "850" })), ctx);
    expect(res.status).toBe(200);
    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({ accion: "registrar_combustible", modulo: "flota" }),
    );
  });

  // FLOTA-COMBUSTIBLE-2 (sección 1) — el formulario del piloto NO pide
  // placa ni piloto: siguen saliendo automáticos del viaje/sesión. Un
  // intento de mandarlos por el body (cliente manipulado) se ignora —
  // el route nunca los lee del form, siempre usa viaje[0]/empleado de
  // la sesión.
  it("placa/piloto siguen saliendo automáticos del viaje/sesión — un valor enviado en el body se ignora", async () => {
    const res = await POST(
      req(formData({
        tipoCombustible: "diesel", galones: "40", monto: "850",
        placa: "Z-999ZZZ", piloto: "Alguien Más",
      })),
      ctx,
    );
    expect(res.status).toBe(200);
    expect(registrarCargaCombustible).toHaveBeenCalledWith(
      // vehiculoId sale de viaje[0].vehiculo_id (3) y pilotoNombre de
      // viaje[0].piloto_nombre ("Juan Pérez") — nunca de "placa"/"piloto"
      // del body, que ni siquiera se leen en route.ts.
      expect.objectContaining({ vehiculoId: 3, pilotoNombre: "Juan Pérez" }),
    );
  });

  it("sin km ni gasolinera -> se pasan como null (no como cadena vacía)", async () => {
    const res = await POST(req(formData({ tipoCombustible: "gasolina", galones: "10", monto: "200" })), ctx);
    expect(res.status).toBe(200);
    expect(registrarCargaCombustible).toHaveBeenCalledWith(
      expect.objectContaining({ km: null, gasolinera: null }),
    );
  });

  it("propaga el status real de UploadValidationError (p.ej. 413), nunca lo esconde como 500", async () => {
    vi.mocked(registrarCargaCombustible).mockRejectedValue(new UploadValidationError("Archivo demasiado grande.", 413));
    const res = await POST(req(formData({ tipoCombustible: "diesel", galones: "40", monto: "850" })), ctx);
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error).toBe("Archivo demasiado grande.");
  });

  it("una excepción no controlada se captura y responde JSON {error}, nunca un 500 sin cuerpo", async () => {
    vi.mocked(registrarCargaCombustible).mockRejectedValue(new Error("fallo real de DB"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await POST(req(formData({ tipoCombustible: "diesel", galones: "40", monto: "850" })), ctx);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(typeof body.error).toBe("string");
    errorSpy.mockRestore();
  });
});

describe("GET /api/portal/viajes/[id]/combustible", () => {
  it("exige participación en el viaje", async () => {
    vi.mocked(colaboradorParticipaEnViaje).mockResolvedValue(null);
    const res = await GET(new Request("http://localhost/x"), ctx);
    expect(res.status).toBe(403);
  });

  it("lista las cargas propias del viaje con su url de foto", async () => {
    const { listarCargasCombustibleViaje } = await import("@/lib/flota/combustible");
    vi.mocked(listarCargasCombustibleViaje).mockResolvedValue([
      {
        id: 1, viajeId: 5, tipoCombustible: "diesel", numeroVale: "A-12345", fechaConsumo: "2026-09-02",
        galones: 40, monto: 850.5, precioGalon: 21.26, km: 12000, gasolinera: "Shell Zona 10",
        nombreArchivo: "vale.jpg", estado: "PENDIENTE", motivoRechazo: null, creadoPor: "portal:E001",
        creadoEn: "2026-09-03 10:00:00",
      },
    ]);
    const res = await GET(new Request("http://localhost/x"), ctx);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.cargas[0].url).toBe("/api/portal/viajes/5/combustible?adjuntoId=1");
  });
});
