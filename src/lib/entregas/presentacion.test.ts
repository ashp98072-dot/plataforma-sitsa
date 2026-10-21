import { describe, expect, it } from "vitest";
import type { PermisoModulo } from "@/lib/permisos-shared";
import { VERSION_PERMISOS } from "@/lib/permisos-catalogo";
import type { Entrega } from "./entregas";
import { actorDesdeSesion, puedeUsarEntregas } from "./actor";
import { accionesDisponibles, aDto, opcionesRegistro, textoEntregaPendiente } from "./presentacion";
import { areasRecepcionDelActor, type ActorEntrega } from "./reglas";

const fila = (modulo: string): PermisoModulo => ({ modulo, puedeVer: true, puedeCrear: false, puedeEditar: true, puedeEliminar: false });
const matriz = (...filas: string[]): PermisoModulo[] => [
  { modulo: VERSION_PERMISOS, puedeVer: true, puedeCrear: false, puedeEditar: false, puedeEliminar: false },
  ...filas.map(fila),
];
const actor = (usuarioId: number, ...permisos: string[]): ActorEntrega =>
  ({ usuarioId, username: `u${usuarioId}`, nombre: `Usuario ${usuarioId}`, rol: "Operaciones", esAdmin: false, permisos: matriz(...permisos) });

const entrega = (extra: Partial<Entrega> = {}): Entrega => ({
  id: 5, empresaId: 1, modulo: "FONDOS", entidadId: 10, documentoCodigo: "SF-1", etapaOrigen: "OPERACIONES", etapaDestino: "TESORERIA",
  modo: "SISTEMA", estado: "EMITIDA", emitidoPorUsuarioId: 7, emitidoPorNombre: "Olga", emitidoPorRol: "JefeOperaciones",
  emitidoEn: new Date("2026-10-13T16:00:00Z"), firmaEmisionId: 100, observacionesEmision: null,
  recibidoPorUsuarioId: null, recibidoPorNombre: null, recibidoPorRol: null, recibidoEn: null, firmaRecepcionId: null,
  observacionesRecepcion: null, recepcionOperadaPorUsuarioId: null, recepcionOperadaPorNombre: null,
  cerradoPorUsuarioId: null, cerradoPorNombre: null, cerradoEn: null, motivoCierre: null, ...extra,
});

const OPS = actor(7, "fondos_entrega_emitir");

describe("opcionesRegistro — «Registrar entrega»", () => {
  it("destinos según la CUSTODIA actual, tomados del catálogo (no de una lista fija en pantalla)", () => {
    const desdeOps = opcionesRegistro(OPS, "FONDOS", "OPERACIONES", false, "Autorizada");
    expect(desdeOps.permitido).toBe(true);
    expect(desdeOps.destinos.map((d) => d.destino)).toEqual(["TESORERIA", "CONTABILIDAD"]);
    const tes = actor(8, "entregas_area_tesoreria");
    expect(opcionesRegistro(tes, "FONDOS", "TESORERIA", false, "Autorizada").destinos.map((d) => d.destino)).toEqual(["CONTABILIDAD"]);
    const cont = actor(9, "entregas_area_contabilidad");
    expect(opcionesRegistro(cont, "FONDOS", "CONTABILIDAD", false, "Liquidada").destinos.map((d) => d.destino)).toEqual(["OPERACIONES"]);
  });

  it("solo ofrece entregar a quien puede actuar por el área que tiene la custodia (no a «todo Operaciones»)", () => {
    const sinPermiso = actor(7);
    expect(opcionesRegistro(sinPermiso, "FONDOS", "OPERACIONES", false, "Autorizada")).toMatchObject({ permitido: false, destinos: [] });
    // Permisos de otras áreas o de los módulos no sirven para entregar desde Operaciones.
    const otraArea = actor(7, "entregas_area_contabilidad", "gastos", "gastos_autorizar", "tms");
    expect(opcionesRegistro(otraArea, "FONDOS", "OPERACIONES", false, "Autorizada").permitido).toBe(false);
    // Y quien solo es de Tesorería no entrega cuando la custodia es de Operaciones.
    expect(opcionesRegistro(actor(8, "entregas_area_tesoreria"), "FONDOS", "OPERACIONES", false, "Autorizada").permitido).toBe(false);
  });

  it("una entrega pendiente BLOQUEA registrar otra", () => {
    const r = opcionesRegistro(OPS, "FONDOS", "OPERACIONES", true, "Autorizada");
    expect(r.permitido).toBe(false);
    expect(r.motivo).toMatch(/pendiente/i);
  });

  it("estados del documento: solo Autorizada y Liquidada admiten entregas", () => {
    for (const estado of ["Pendiente", "Rechazada", null]) {
      expect(opcionesRegistro(OPS, "FONDOS", "OPERACIONES", false, estado).permitido).toBe(false);
    }
    for (const estado of ["Autorizada", "Liquidada"]) {
      expect(opcionesRegistro(OPS, "FONDOS", "OPERACIONES", false, estado).permitido).toBe(true);
    }
  });

  it("modo PRESENCIAL solo con el permiso entregas_presencial (Admin conserva el bypass)", () => {
    expect(opcionesRegistro(OPS, "FONDOS", "OPERACIONES", false, "Autorizada").modos).toEqual(["SISTEMA"]);
    const conPresencial = actor(7, "fondos_entrega_emitir", "entregas_presencial");
    expect(opcionesRegistro(conPresencial, "FONDOS", "OPERACIONES", false, "Autorizada").modos).toEqual(["SISTEMA", "PRESENCIAL"]);
    const admin = { ...actor(1), esAdmin: true, rol: "Admin" };
    expect(opcionesRegistro(admin, "FONDOS", "OPERACIONES", false, "Autorizada").modos).toEqual(["SISTEMA", "PRESENCIAL"]);
  });

  it("sin ningún permiso de entrega la funcionalidad queda oculta (nada permitido, ninguna área de recepción)", () => {
    const nadie = actor(3, "gastos", "gastos_autorizar", "compras_requerimientos", "tms", "contabilidad");
    for (const custodia of ["OPERACIONES", "TESORERIA", "CONTABILIDAD"] as const) {
      expect(opcionesRegistro(nadie, "FONDOS", custodia, false, "Autorizada").permitido).toBe(false);
    }
    expect(areasRecepcionDelActor(nadie).FONDOS).toEqual([]);
    expect(puedeUsarEntregas(nadie.permisos, false)).toBe(false);
  });
});

describe("accionesDisponibles — qué puede hacer el actor con cada entrega", () => {
  const tes = actor(8, "entregas_area_tesoreria");

  it("EMITIDA en sistema: el receptor del área destino recibe/rechaza; el emisor no; el emisor sí anula", () => {
    expect(accionesDisponibles(tes, entrega())).toEqual({ recibir: true, rechazar: true, presencial: false, anular: false });
    // El emisor, aunque además tenga permiso de Tesorería, no recibe ni rechaza lo suyo.
    const ambos = actor(7, "fondos_entrega_emitir", "entregas_area_tesoreria");
    expect(accionesDisponibles(ambos, entrega())).toEqual({ recibir: false, rechazar: false, presencial: false, anular: true });
    expect(accionesDisponibles(actor(9, "entregas_area_contabilidad"), entrega())).toMatchObject({ recibir: false, rechazar: false });
  });

  it("entregas_anular permite anular entregas ajenas; sin él, solo la propia", () => {
    expect(accionesDisponibles(actor(20, "entregas_anular"), entrega()).anular).toBe(true);
    expect(accionesDisponibles(actor(21), entrega()).anular).toBe(false);
  });

  it("PRESENCIAL: no aparece para recibir/rechazar; la recepción presencial exige entregas_presencial", () => {
    const presencial = entrega({ modo: "PRESENCIAL" });
    expect(accionesDisponibles(tes, presencial)).toEqual({ recibir: false, rechazar: false, presencial: false, anular: false });
    expect(accionesDisponibles(actor(30, "entregas_presencial"), presencial)).toMatchObject({ presencial: true, recibir: false });
  });

  it("RECIBIDA / RECHAZADA / ANULADA no admiten ninguna acción (una RECIBIDA se corrige con una devolución)", () => {
    for (const estado of ["RECIBIDA", "RECHAZADA", "ANULADA"] as const) {
      expect(accionesDisponibles(actor(7, "fondos_entrega_emitir", "entregas_anular", "entregas_presencial", "entregas_area_tesoreria"), entrega({ estado })))
        .toEqual({ recibir: false, rechazar: false, presencial: false, anular: false });
    }
  });
});

describe("DTO y textos", () => {
  it("el DTO no expone ids de usuario ni de firma, y trae etiquetas en español", () => {
    const dto = aDto(entrega({ estado: "RECIBIDA", recibidoPorUsuarioId: 8, recibidoPorNombre: "Tere", recibidoEn: new Date("2026-10-13T17:00:00Z"), firmaRecepcionId: 101 }), OPS);
    const json = JSON.stringify(dto);
    for (const prohibido of ["emitidoPorUsuarioId", "recibidoPorUsuarioId", "firmaEmisionId", "firmaRecepcionId", "empresaId", "cerradoPorUsuarioId", "recepcionOperadaPorUsuarioId"]) {
      expect(json).not.toContain(prohibido);
    }
    expect(dto).toMatchObject({ estadoEtiqueta: "Recibida", origenEtiqueta: "Operaciones", destinoEtiqueta: "Tesorería", modoEtiqueta: "En el sistema", recibidoPor: "Tere" });
  });

  it("etiquetas de estado legibles y texto de entrega pendiente", () => {
    expect(aDto(entrega({ estado: "EMITIDA" }), OPS).estadoEtiqueta).toBe("Pendiente");
    expect(aDto(entrega({ estado: "RECHAZADA" }), OPS).estadoEtiqueta).toBe("Rechazada");
    expect(aDto(entrega({ estado: "ANULADA" }), OPS).estadoEtiqueta).toBe("Anulada");
    expect(textoEntregaPendiente("TESORERIA")).toBe("Entrega pendiente → Tesorería");
  });
});

describe("identidad del actor y puerta de entrada", () => {
  it("el actor sale de la sesión; sin nombre cae al username; Admin se reconoce por el rol de la sesión", () => {
    const a = actorDesdeSesion({ id: 9, username: "hsitan", nombre: "  ", rol: "Operaciones" }, matriz());
    expect(a).toMatchObject({ usuarioId: 9, username: "hsitan", nombre: "hsitan", rol: "Operaciones", esAdmin: false });
    expect(actorDesdeSesion({ id: 1, username: "adm", nombre: "Ana Admin", rol: "Admin" }, []).esAdmin).toBe(true);
  });

  it("puedeUsarEntregas: alguna fila de entrega; ver Fondos solo si el endpoint lo acepta", () => {
    const soloGastos = matriz("gastos");
    expect(puedeUsarEntregas(soloGastos, false)).toBe(false);
    expect(puedeUsarEntregas(soloGastos, false, { aceptaGastosVer: true })).toBe(true);
    expect(puedeUsarEntregas(matriz("entregas_presencial"), false)).toBe(true);
    expect(puedeUsarEntregas([], true)).toBe(true);
  });
});
