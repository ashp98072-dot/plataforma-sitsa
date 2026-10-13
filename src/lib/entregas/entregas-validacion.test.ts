import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Validaciones del servicio que deben rechazar ANTES de tocar la base o escribir archivos: si una de estas pruebas llega a
 * `getPool`/`query`/`guardarUpload`, falla.
 */
const tocado = vi.hoisted(() => ({ db: 0, upload: 0 }));
vi.mock("@/lib/db", () => ({
  getPool: () => { tocado.db++; throw new Error("no debe tocar la base"); },
  query: async () => { tocado.db++; throw new Error("no debe tocar la base"); },
  execute: async () => { tocado.db++; throw new Error("no debe tocar la base"); },
}));
vi.mock("@/lib/uploads", () => ({
  guardarUpload: vi.fn(async () => { tocado.upload++; throw new Error("no debe escribir archivos"); }),
  borrarUpload: vi.fn(),
}));

import type { PermisoModulo } from "@/lib/permisos-shared";
import {
  MENSAJES_ENTREGA,
  anularEntrega,
  confirmarRecepcion,
  huellaEntrega,
  listarEntregasDocumento,
  rechazarRecepcion,
  registrarEntrega,
  registrarRecepcionPresencial,
  type FirmaEntregaInput,
} from "./entregas";
import type { ActorEntrega } from "./reglas";

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]).buffer;
const firma = (origen: "GUARDADA" | "DIBUJADA" = "DIBUJADA", bytes: ArrayBuffer = PNG): FirmaEntregaInput => ({ origen, imagen: { bytes, original: "firma.png" } });
const actor: ActorEntrega = { usuarioId: 7, username: "op", nombre: "Operador", rol: "Operaciones", esAdmin: false, permisos: [] as PermisoModulo[] };
const CLAVE = "clave_valida_123456";
const base = { empresaId: 1, actor, modulo: "FONDOS" as const, entidadId: 10, destino: "TESORERIA" as const, modo: "SISTEMA" as const, claveIdempotencia: CLAVE, firma: firma() };

/** Rechaza con ese mensaje/estado y SIN haber tocado la base ni escrito archivos. */
async function rechaza(promesa: Promise<unknown>, mensaje: string, status = 400) {
  const antes = { ...tocado };
  await expect(promesa).rejects.toMatchObject({ message: mensaje, status });
  expect(tocado).toEqual(antes);
}

beforeEach(() => { tocado.db = 0; tocado.upload = 0; });
afterEach(() => { expect(tocado).toEqual({ db: 0, upload: 0 }); });

describe("registrarEntrega — validación previa", () => {
  it("módulo, destino o modo desconocidos → 400", async () => {
    await rechaza(registrarEntrega({ ...base, modulo: "VIATICOS" as never }), MENSAJES_ENTREGA.datosInvalidos);
    await rechaza(registrarEntrega({ ...base, destino: "GERENCIA" as never }), MENSAJES_ENTREGA.datosInvalidos);
    await rechaza(registrarEntrega({ ...base, modo: "CORREO" as never }), MENSAJES_ENTREGA.datosInvalidos);
  });
  it("ids no positivos → 400", async () => {
    await rechaza(registrarEntrega({ ...base, entidadId: 0 }), MENSAJES_ENTREGA.datosInvalidos);
    await rechaza(registrarEntrega({ ...base, empresaId: -1 }), MENSAJES_ENTREGA.datosInvalidos);
    await rechaza(registrarEntrega({ ...base, entidadId: 1.5 }), MENSAJES_ENTREGA.datosInvalidos);
  });
  it("clave de envío obligatoria y con formato válido", async () => {
    await rechaza(registrarEntrega({ ...base, claveIdempotencia: "" }), MENSAJES_ENTREGA.claveRequerida);
    await rechaza(registrarEntrega({ ...base, claveIdempotencia: "corta" }), MENSAJES_ENTREGA.claveRequerida);
    await rechaza(registrarEntrega({ ...base, claveIdempotencia: "con espacios no válidos!!" }), MENSAJES_ENTREGA.claveRequerida);
  });
  it("firma obligatoria: ausente, vacía, no PNG o mayor a 1 MB → 400", async () => {
    await rechaza(registrarEntrega({ ...base, firma: null as never }), MENSAJES_ENTREGA.firmaRequerida);
    await rechaza(registrarEntrega({ ...base, firma: firma("GUARDADA", new ArrayBuffer(0)) }), MENSAJES_ENTREGA.firmaInvalida);
    await rechaza(registrarEntrega({ ...base, firma: firma("GUARDADA", new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]).buffer) }), MENSAJES_ENTREGA.firmaInvalida);
    const grande = new Uint8Array(1024 * 1024 + 1); grande.set(new Uint8Array(PNG));
    await rechaza(registrarEntrega({ ...base, firma: firma("GUARDADA", grande.buffer) }), MENSAJES_ENTREGA.firmaInvalida);
    await rechaza(registrarEntrega({ ...base, firma: { origen: "OTRA" as never, imagen: { bytes: PNG, original: "x.png" } } }), MENSAJES_ENTREGA.firmaInvalida);
  });
  it("observaciones demasiado largas → 400 (no se truncan en silencio)", async () => {
    await rechaza(registrarEntrega({ ...base, observaciones: "x".repeat(1001) }), "Las observaciones no puede exceder 1000 caracteres.");
  });
});

describe("huella de la emisión", () => {
  const h = (extra: Partial<Parameters<typeof huellaEntrega>[0]> = {}) =>
    huellaEntrega({ modulo: "FONDOS", entidadId: 10, destino: "TESORERIA", modo: "SISTEMA", observaciones: null, emisorUsuarioId: 7, ...extra });
  it("estable y sensible a cada campo funcional (incluido el emisor)", () => {
    expect(h()).toBe(h());
    expect(h()).toMatch(/^[0-9a-f]{64}$/);
    for (const cambio of [{ modulo: "GASTOS" as const }, { entidadId: 11 }, { destino: "CONTABILIDAD" as const }, { modo: "PRESENCIAL" as const }, { observaciones: "x" }, { emisorUsuarioId: 8 }]) {
      expect(h(cambio)).not.toBe(h());
    }
  });
});

describe("recepción / rechazo / anulación — validación previa", () => {
  it("confirmar: firma obligatoria y válida; id inválido", async () => {
    await rechaza(confirmarRecepcion({ empresaId: 1, actor, entregaId: 5, firma: null as never }), MENSAJES_ENTREGA.firmaRequerida);
    await rechaza(confirmarRecepcion({ empresaId: 1, actor, entregaId: 0, firma: firma() }), MENSAJES_ENTREGA.datosInvalidos);
  });
  it("presencial: firma DIBUJADA obligatoria (la guardada no vale), nombre obligatorio, permiso explícito", async () => {
    const conPermiso = { ...actor, esAdmin: true };
    await rechaza(registrarRecepcionPresencial({ empresaId: 1, actor: conPermiso, entregaId: 5, nombreReceptor: "Ana", firma: firma("GUARDADA") }), MENSAJES_ENTREGA.firmaDibujadaRequerida);
    await rechaza(registrarRecepcionPresencial({ empresaId: 1, actor: conPermiso, entregaId: 5, nombreReceptor: "Ana", firma: null as never }), MENSAJES_ENTREGA.firmaDibujadaRequerida);
    await rechaza(registrarRecepcionPresencial({ empresaId: 1, actor: conPermiso, entregaId: 5, nombreReceptor: "   ", firma: firma() }), MENSAJES_ENTREGA.nombreRequerido);
    await rechaza(registrarRecepcionPresencial({ empresaId: 1, actor: conPermiso, entregaId: 5, nombreReceptor: "x".repeat(201), firma: firma() }), "El nombre no puede exceder 200 caracteres.");
    await rechaza(registrarRecepcionPresencial({ empresaId: 1, actor, entregaId: 5, nombreReceptor: "Ana", firma: firma() }), MENSAJES_ENTREGA.sinPermisoPresencial, 403);
  });
  it("rechazar y anular exigen motivo", async () => {
    await rechaza(rechazarRecepcion({ empresaId: 1, actor, entregaId: 5, motivo: "  " }), MENSAJES_ENTREGA.motivoRequerido);
    await rechaza(anularEntrega({ empresaId: 1, actor, entregaId: 5, motivo: "" }), MENSAJES_ENTREGA.motivoRequerido);
    await rechaza(anularEntrega({ empresaId: 1, actor, entregaId: 5, motivo: "x".repeat(1001) }), "El motivo no puede exceder 1000 caracteres.");
  });
  it("consultas: módulo desconocido → 400", async () => {
    await rechaza(listarEntregasDocumento(1, "VIATICOS" as never, 1), MENSAJES_ENTREGA.datosInvalidos);
  });
});
