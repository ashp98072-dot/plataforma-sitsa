import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { PermisoModulo } from "@/lib/permisos-shared";
import {
  GRUPOS_PERMISOS,
  PERMISOS_ENTREGA,
  catalogoPermisosRol,
  labelPermiso,
  mergePermisosConCatalogo,
  moduloEmpresaDelPermiso,
  modulosPlataformaDesdePermisos,
  permisosDefaultPorRol,
} from "@/lib/permisos-shared";
import { CATALOGO_PERMISOS, VERSION_PERMISOS, cambiarAccion, tieneAccionCatalogo } from "@/lib/permisos-catalogo";
import { ROLES } from "@/lib/roles";
import { AREAS_ENTREGA, DEFINICIONES_ENTREGA, MODULOS_ENTREGA, destinosDesde, parEntrega } from "./catalogo";
import { areasRecepcionDelActor, calcularCustodia, permisoDeArea, puedeActuarPorArea, puedeAnularAjenas, puedeOperarPresencial, type ActorEntrega } from "./reglas";

const fila = (modulo: string, datos: Partial<PermisoModulo> = {}): PermisoModulo =>
  ({ modulo, puedeVer: false, puedeCrear: false, puedeEditar: false, puedeEliminar: false, ...datos });
/** Matriz V2 explícita (la que guarda hoy la pantalla de Usuarios). */
const matriz = (...filas: PermisoModulo[]) => [fila(VERSION_PERMISOS, { puedeVer: true }), ...filas];
const actor = (permisos: PermisoModulo[], extra: Partial<ActorEntrega> = {}): ActorEntrega =>
  ({ usuarioId: 1, username: "u1", nombre: "Usuario Uno", rol: "Operaciones", esAdmin: false, permisos, ...extra });

describe("catálogo de etapas — exactamente los pares aprobados (2026-10-13)", () => {
  const pares = (m: keyof typeof DEFINICIONES_ENTREGA) => DEFINICIONES_ENTREGA[m].pares.map((p) => `${p.origen}>${p.destino}`);

  it("Fondos: Operaciones→Tesorería, Tesorería→Contabilidad, Operaciones→Contabilidad, Contabilidad→Operaciones", () => {
    expect(pares("FONDOS")).toEqual(["OPERACIONES>TESORERIA", "TESORERIA>CONTABILIDAD", "OPERACIONES>CONTABILIDAD", "CONTABILIDAD>OPERACIONES"]);
  });
  it("Gastos: Operaciones→Contabilidad, Contabilidad→Operaciones (sin etapa de pago/reintegro)", () => {
    expect(pares("GASTOS")).toEqual(["OPERACIONES>CONTABILIDAD", "CONTABILIDAD>OPERACIONES"]);
  });
  it("Compras: Compras→Tesorería, Compras→Contabilidad, Tesorería→Contabilidad, Contabilidad→Compras", () => {
    expect(pares("COMPRAS")).toEqual(["COMPRAS>TESORERIA", "COMPRAS>CONTABILIDAD", "TESORERIA>CONTABILIDAD", "CONTABILIDAD>COMPRAS"]);
  });
  it("ningún par repetido ni hacia la misma área; todas las áreas de cada par tienen permiso", () => {
    for (const m of MODULOS_ENTREGA) {
      const lista = pares(m);
      expect(new Set(lista).size).toBe(lista.length);
      for (const p of DEFINICIONES_ENTREGA[m].pares) {
        expect(p.origen).not.toBe(p.destino);
        expect(permisoDeArea(m, p.origen)).not.toBeNull();
        expect(permisoDeArea(m, p.destino)).not.toBeNull();
      }
    }
  });
  it("parEntrega / destinosDesde", () => {
    expect(parEntrega("FONDOS", "OPERACIONES", "TESORERIA")).not.toBeNull();
    expect(parEntrega("FONDOS", "TESORERIA", "OPERACIONES")).toBeNull();
    expect(parEntrega("GASTOS", "OPERACIONES", "TESORERIA")).toBeNull();
    expect(parEntrega("COMPRAS", "OPERACIONES", "CONTABILIDAD")).toBeNull();
    expect(destinosDesde("FONDOS", "OPERACIONES").map((p) => p.destino)).toEqual(["TESORERIA", "CONTABILIDAD"]);
    expect(destinosDesde("GASTOS", "TESORERIA")).toEqual([]);
  });
  it("estados admitidos y área inicial por módulo", () => {
    expect(DEFINICIONES_ENTREGA.FONDOS.estadosDocumento).toEqual(["Autorizada", "Liquidada"]);
    expect(DEFINICIONES_ENTREGA.GASTOS.estadosDocumento).toEqual(["Autorizada"]);
    expect(DEFINICIONES_ENTREGA.COMPRAS.estadosDocumento).toEqual(["Autorizada"]);
    expect([DEFINICIONES_ENTREGA.FONDOS.areaInicial, DEFINICIONES_ENTREGA.GASTOS.areaInicial, DEFINICIONES_ENTREGA.COMPRAS.areaInicial])
      .toEqual(["OPERACIONES", "OPERACIONES", "COMPRAS"]);
  });
  it("las firmas se ligan al documento con los MISMOS modulo/entidad_tipo que sus firmas existentes", () => {
    const fuente = (ruta: string) => readFileSync(new URL(ruta, import.meta.url), "utf8");
    expect(fuente("../tms/fondos.ts")).toContain('modulo: "FONDOS", entidadTipo: "SOLICITUD_FONDO"');
    expect(fuente("../tms/gastos.ts")).toContain('modulo: "GASTOS", entidadTipo: "GASTO_OPERATIVO"');
    expect(fuente("../compras/requerimiento-firmas-captura.ts")).toContain('modulo: "COMPRAS", entidadTipo: "REQUERIMIENTO_COMPRA"');
    expect([DEFINICIONES_ENTREGA.FONDOS.moduloFirma, DEFINICIONES_ENTREGA.FONDOS.entidadTipo]).toEqual(["FONDOS", "SOLICITUD_FONDO"]);
    expect([DEFINICIONES_ENTREGA.GASTOS.moduloFirma, DEFINICIONES_ENTREGA.GASTOS.entidadTipo]).toEqual(["GASTOS", "GASTO_OPERATIVO"]);
    expect([DEFINICIONES_ENTREGA.COMPRAS.moduloFirma, DEFINICIONES_ENTREGA.COMPRAS.entidadTipo]).toEqual(["COMPRAS", "REQUERIMIENTO_COMPRA"]);
  });
});

describe("permisos por área", () => {
  it("cada área se resuelve a su fila; un área ajena al módulo no tiene fila", () => {
    expect(permisoDeArea("FONDOS", "OPERACIONES")).toBe("fondos_entrega_emitir");
    expect(permisoDeArea("GASTOS", "OPERACIONES")).toBe("gastos_entrega_emitir");
    expect(permisoDeArea("COMPRAS", "COMPRAS")).toBe("compras_entrega_emitir");
    expect(permisoDeArea("FONDOS", "TESORERIA")).toBe("entregas_area_tesoreria");
    expect(permisoDeArea("COMPRAS", "CONTABILIDAD")).toBe("entregas_area_contabilidad");
    expect(permisoDeArea("FONDOS", "COMPRAS")).toBeNull();
    expect(permisoDeArea("COMPRAS", "OPERACIONES")).toBeNull();
  });
  it("actuar exige la acción EDITAR de la fila; Ver solo no alcanza", () => {
    expect(puedeActuarPorArea(actor(matriz(fila("entregas_area_tesoreria", { puedeVer: true }))), "FONDOS", "TESORERIA")).toBe(false);
    expect(puedeActuarPorArea(actor(matriz(fila("entregas_area_tesoreria", { puedeVer: true, puedeEditar: true }))), "FONDOS", "TESORERIA")).toBe(true);
  });
  it("los permisos de área inicial son independientes entre módulos", () => {
    const a = actor(matriz(fila("fondos_entrega_emitir", { puedeVer: true, puedeEditar: true })));
    expect(puedeActuarPorArea(a, "FONDOS", "OPERACIONES")).toBe(true);
    expect(puedeActuarPorArea(a, "GASTOS", "OPERACIONES")).toBe(false);
    expect(puedeActuarPorArea(a, "COMPRAS", "COMPRAS")).toBe(false);
  });
  it("los permisos existentes de los módulos (gastos, autorizar, compras) NO dan autoridad de entrega", () => {
    const a = actor(matriz(
      fila("gastos", { puedeVer: true, puedeCrear: true, puedeEditar: true, puedeEliminar: true }),
      fila("gastos_autorizar", { puedeVer: true, puedeEditar: true }),
      fila("compras_requerimientos", { puedeVer: true, puedeEditar: true }),
      fila("compras_autorizar", { puedeVer: true, puedeEditar: true }),
      fila("tms", { puedeVer: true, puedeEditar: true }),
      fila("contabilidad", { puedeVer: true, puedeEditar: true }),
    ));
    for (const m of MODULOS_ENTREGA) for (const area of AREAS_ENTREGA) expect(puedeActuarPorArea(a, m, area)).toBe(false);
    expect(puedeOperarPresencial(a)).toBe(false);
    expect(puedeAnularAjenas(a)).toBe(false);
  });
  it("Admin conserva el bypass administrativo, pero nunca por un área que el módulo no tiene", () => {
    const admin = actor([], { esAdmin: true, rol: "Admin" });
    expect(puedeActuarPorArea(admin, "FONDOS", "CONTABILIDAD")).toBe(true);
    expect(puedeActuarPorArea(admin, "FONDOS", "COMPRAS")).toBe(false);
    expect(puedeOperarPresencial(admin)).toBe(true);
  });
  it("bandeja: áreas de recepción del actor por módulo", () => {
    const a = actor(matriz(fila("entregas_area_contabilidad", { puedeVer: true, puedeEditar: true })));
    expect(areasRecepcionDelActor(a)).toEqual({ FONDOS: ["CONTABILIDAD"], GASTOS: ["CONTABILIDAD"], COMPRAS: ["CONTABILIDAD"] });
    const t = actor(matriz(fila("entregas_area_tesoreria", { puedeVer: true, puedeEditar: true })));
    expect(areasRecepcionDelActor(t)).toEqual({ FONDOS: ["TESORERIA"], GASTOS: [], COMPRAS: ["TESORERIA"] });
    const o = actor(matriz(fila("fondos_entrega_emitir", { puedeVer: true, puedeEditar: true })));
    expect(areasRecepcionDelActor(o)).toEqual({ FONDOS: ["OPERACIONES"], GASTOS: [], COMPRAS: [] });
  });
});

describe("custodia", () => {
  const e = (id: number, estado: "EMITIDA" | "RECIBIDA" | "RECHAZADA" | "ANULADA", etapaDestino: "OPERACIONES" | "TESORERIA" | "CONTABILIDAD" | "COMPRAS") => ({ id, estado, etapaDestino });
  it("sin entregas: el área inicial del módulo", () => {
    expect(calcularCustodia("FONDOS", [])).toEqual({ area: "OPERACIONES", pendiente: null });
    expect(calcularCustodia("COMPRAS", [])).toEqual({ area: "COMPRAS", pendiente: null });
  });
  it("el destino de la última RECIBIDA (por id, sin importar el orden recibido)", () => {
    expect(calcularCustodia("FONDOS", [e(3, "RECIBIDA", "CONTABILIDAD"), e(1, "RECIBIDA", "TESORERIA")]).area).toBe("CONTABILIDAD");
    expect(calcularCustodia("FONDOS", [e(1, "RECIBIDA", "TESORERIA"), e(2, "RECIBIDA", "CONTABILIDAD"), e(3, "RECIBIDA", "OPERACIONES")]).area).toBe("OPERACIONES");
  });
  it("RECHAZADA/ANULADA no mueven la custodia; la EMITIDA es la pendiente", () => {
    const r = calcularCustodia("FONDOS", [e(1, "RECIBIDA", "TESORERIA"), e(2, "RECHAZADA", "CONTABILIDAD"), e(3, "ANULADA", "CONTABILIDAD"), e(4, "EMITIDA", "CONTABILIDAD")]);
    expect(r.area).toBe("TESORERIA");
    expect(r.pendiente?.id).toBe(4);
  });
});

describe("permisos nuevos en la plataforma — creados pero NO asignados a roles", () => {
  it("ocho filas, compatibles con usuario_modulo.modulo VARCHAR(40), con etiqueta propia y bajo el módulo de empresa 'tms'", () => {
    expect(PERMISOS_ENTREGA).toEqual(["documentos_entregas", "fondos_entrega_emitir", "gastos_entrega_emitir", "compras_entrega_emitir",
      "entregas_area_tesoreria", "entregas_area_contabilidad", "entregas_presencial", "entregas_anular"]);
    for (const p of PERMISOS_ENTREGA) {
      expect(p.length).toBeLessThanOrEqual(40);
      expect(labelPermiso(p)).not.toBe(p);
      expect(moduloEmpresaDelPermiso(p)).toBe("tms");
    }
  });
  it("ningún rol (salvo el bypass de Admin) los trae por defecto", () => {
    for (const rol of ROLES) {
      if (rol === "Admin") continue;
      const defaults = permisosDefaultPorRol(rol);
      for (const p of PERMISOS_ENTREGA) {
        const f = defaults.find((x) => x.modulo === p);
        expect(Boolean(f?.puedeVer || f?.puedeCrear || f?.puedeEditar || f?.puedeEliminar), `${rol}:${p}`).toBe(false);
      }
    }
  });
  it("son asignables manualmente: aparecen en el catálogo de los roles con matriz y en el grupo Operaciones", () => {
    for (const rol of ["Operaciones", "Contabilidad", "GerenteOperaciones", "Facturador", "CoordinadorCompras", "Visualizador"] as const) {
      for (const p of PERMISOS_ENTREGA) expect(catalogoPermisosRol(rol)).toContain(p);
    }
    const ops = GRUPOS_PERMISOS.find((g) => g.id === "operaciones")!;
    for (const p of PERMISOS_ENTREGA) expect(ops.modulos).toContain(p);
  });
  it("un usuario existente sin esas filas guardadas las recibe vacías (no se autoconceden al recargar)", () => {
    const merged = mergePermisosConCatalogo("GerenteOperaciones", [fila("gastos_autorizar", { puedeVer: true, puedeEditar: true })]);
    for (const p of PERMISOS_ENTREGA) {
      const f = merged.find((x) => x.modulo === p);
      expect(f && (f.puedeVer || f.puedeEditar)).toBeFalsy();
    }
  });
  it("no son módulos de navegación propios", () => {
    const todas = PERMISOS_ENTREGA.map((p) => fila(p, { puedeVer: true, puedeEditar: true }));
    expect(modulosPlataformaDesdePermisos(todas)).toEqual([]);
  });
  it("la matriz de Usuarios los muestra como acciones; activar una activa su Ver", () => {
    const transversal = CATALOGO_PERMISOS.find((m) => m.id === "documentos_entregas")!;
    expect(transversal.area).toBe("operaciones");
    expect(transversal.acciones.map((a) => a.modulo)).toEqual(["documentos_entregas", "entregas_area_tesoreria", "entregas_area_contabilidad", "entregas_presencial", "entregas_anular"]);
    expect(CATALOGO_PERMISOS.find((m) => m.id === "gastos")!.acciones.map((a) => a.modulo)).toEqual(expect.arrayContaining(["fondos_entrega_emitir", "gastos_entrega_emitir"]));
    expect(CATALOGO_PERMISOS.find((m) => m.id === "compras_requerimientos")!.acciones.map((a) => a.modulo)).toContain("compras_entrega_emitir");
    const activado = cambiarAccion(matriz(), "documentos_entregas", "presencial", true);
    expect(tieneAccionCatalogo(activado, "documentos_entregas", "presencial")).toBe(true);
    expect(activado.find((p) => p.modulo === "documentos_entregas")?.puedeVer).toBe(true);
    expect(puedeOperarPresencial(actor(activado))).toBe(true);
    const fondos = cambiarAccion(matriz(), "gastos", "entrega_fondos", true);
    expect(puedeActuarPorArea(actor(fondos), "FONDOS", "OPERACIONES")).toBe(true);
    expect(fondos.find((p) => p.modulo === "gastos")?.puedeVer).toBe(true);
  });
});
