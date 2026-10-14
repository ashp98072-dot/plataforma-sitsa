import { readFileSync } from "fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  badgeLiquidacion,
  claseFilaLiquidacion,
  esPendienteDeLiquidar,
  estaPendienteDeLiquidacion,
  puedeOfrecerConfirmarReporte,
} from "./liquidacion-viaje-shared";
import {
  PERMISOS_LIQUIDACION_VIAJE,
  catalogoGlobalPermisos,
  esPlataformaPermisible,
  labelPermiso,
  moduloEmpresaDelPermiso,
  permisosDefaultPorRol,
  tienePermiso,
  type PermisoModulo,
} from "@/lib/permisos-shared";
import { CATALOGO_PERMISOS } from "@/lib/permisos-catalogo";
import { accionesViaje } from "../../app/e/[slug]/planes/planes-viajes-client";
import { liquidacionesDePlanes } from "./liquidacion-viaje";

const leer = (p: string) => readFileSync(p, "utf8").replaceAll("\r\n", "\n");

// ───────────────────────────── presentación (colores/badges) ─────────────────────────────
describe("Liquidación Fase 2 · presentación", () => {
  it("mapeo final: todo viaje ACTIVO no liquidado es amarillo; solo LIQUIDADO vuelve a la superficie normal", () => {
    // sin liquidación registrada (viaje activo)
    for (const estado of ["Programado", "Cargado", "En ruta", "Descargado"]) {
      expect(claseFilaLiquidacion(null, estado), estado).toBe("pendiente");
      expect(claseFilaLiquidacion(undefined, estado), estado).toBe("pendiente");
      expect(badgeLiquidacion(null, estado)?.texto, estado).toBe("Pendiente");
    }
    expect(claseFilaLiquidacion({ estado: "REPORTE_RECIBIDO", version: 1 }, "En ruta")).toBe("pendiente");
    expect(claseFilaLiquidacion({ estado: "EN_AJUSTE", version: 3 }, "Descargado")).toBe("pendiente");
    expect(claseFilaLiquidacion({ estado: "LIQUIDADO", version: 2 }, "Descargado")).toBe("normal");
    expect(badgeLiquidacion({ estado: "REPORTE_RECIBIDO", version: 1 }, "En ruta")?.texto).toBe("Reporte recibido");
    expect(badgeLiquidacion({ estado: "EN_AJUSTE", version: 3 }, "En ruta")?.texto).toBe("En ajuste");
    expect(badgeLiquidacion({ estado: "LIQUIDADO", version: 2 }, "Descargado")?.texto).toBe("Liquidado");
  });

  it("Cerrado/Cancelado SIN liquidación (histórico / no aplica) no se pintan «pendientes» ni «liquidados»: fondo normal y «—»", () => {
    for (const estado of ["Cerrado", "Cancelado"]) {
      expect(claseFilaLiquidacion(null, estado), estado).toBe("normal");
      expect(badgeLiquidacion(null, estado), estado).toBeNull();
    }
    // Con liquidación registrada manda su estado aunque el viaje esté cerrado.
    expect(claseFilaLiquidacion({ estado: "LIQUIDADO", version: 2 }, "Cerrado")).toBe("normal");
    expect(claseFilaLiquidacion({ estado: "EN_AJUSTE", version: 3 }, "Cerrado")).toBe("pendiente");
  });

  it("los tres estados pendientes se distinguen por TEXTO y por clase de badge (el color no es el único indicador)", () => {
    const t = [badgeLiquidacion(null, "En ruta"), badgeLiquidacion({ estado: "REPORTE_RECIBIDO", version: 1 }, "En ruta"), badgeLiquidacion({ estado: "EN_AJUSTE", version: 3 }, "En ruta")];
    expect(new Set(t.map((b) => b?.texto)).size).toBe(3);
    expect(new Set(t.map((b) => b?.clase)).size).toBe(3);
  });

  it("amarillo = pendiente de liquidar para los tres estados; LIQUIDADO no", () => {
    expect(esPendienteDeLiquidar("REPORTE_RECIBIDO")).toBe(true);
    expect(esPendienteDeLiquidar("EN_AJUSTE")).toBe(true);
    expect(esPendienteDeLiquidar("LIQUIDADO")).toBe(false);
    expect(estaPendienteDeLiquidacion(null, "Programado")).toBe(true);
    expect(estaPendienteDeLiquidacion({ estado: "LIQUIDADO", version: 2 }, "Programado")).toBe(false);
  });

  const f = { liquidacion: null, tienePermiso: true, soloConsulta: false };
  it("«Confirmar reporte» solo se ofrece con permiso, sin liquidación, viaje no cerrado/cancelado y fuera de la vista de consulta", () => {
    expect(puedeOfrecerConfirmarReporte({ ...f, estadoPlan: "En ruta" })).toBe(true);
    expect(puedeOfrecerConfirmarReporte({ ...f, estadoPlan: "Programado" })).toBe(true); // advertencia, no bloqueo (D02)
    expect(puedeOfrecerConfirmarReporte({ ...f, estadoPlan: "Cerrado" })).toBe(false);
    expect(puedeOfrecerConfirmarReporte({ ...f, estadoPlan: "Cancelado" })).toBe(false);
    expect(puedeOfrecerConfirmarReporte({ ...f, estadoPlan: "En ruta", tienePermiso: false })).toBe(false);
    expect(puedeOfrecerConfirmarReporte({ ...f, estadoPlan: "En ruta", soloConsulta: true })).toBe(false);
    expect(puedeOfrecerConfirmarReporte({ ...f, estadoPlan: "En ruta", liquidacion: { estado: "REPORTE_RECIBIDO", version: 1 } })).toBe(false);
  });

  it("las acciones de CIERRE no cambian: accionesViaje ignora por completo la liquidación", () => {
    const base = { estado: "Descargado", pendienteCierre: true, tarifaComercial: 100 };
    const sin = accionesViaje("operativo", base, true);
    const con = accionesViaje("operativo", { ...base, liquidacion: { estado: "REPORTE_RECIBIDO", version: 1 } } as never, true);
    expect(con).toEqual(sin);
    expect(sin.cerrar).toBe(true);
    const cuerpo = leer("src/app/e/[slug]/planes/planes-viajes-client.tsx");
    const inicio = cuerpo.indexOf("export function accionesViaje");
    const fin = cuerpo.indexOf("\n}\n", inicio);
    expect(cuerpo.slice(inicio, fin)).not.toMatch(/liquidaci/i);
  });

  it("tokens CSS: amarillo #FFF3BF (claro) y #3A3218 (oscuro) y contraste accesible sobre la fila pendiente", () => {
    const css = leer("src/app/globals.css");
    const bloque = (sel: string) => {
      const i = css.indexOf(sel);
      return css.slice(i, css.indexOf("}", i));
    };
    const luz = (h: string) => {
      const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const ratio = (a: string, b: string) => {
      const [x, y] = [luz(a), luz(b)].sort((p, q) => q - p);
      return (x + 0.05) / (y + 0.05);
    };
    const esperado: Record<string, string> = { '[data-theme="dark"]': "#3a3218", '[data-theme="light"]': "#fff3bf" };
    for (const tema of ['[data-theme="dark"]', '[data-theme="light"]']) {
      const b = bloque(tema);
      const tok = (n: string) => new RegExp(`--${n}:\\s*(#[0-9a-fA-F]{6})`).exec(b)?.[1];
      const fila = tok("fila-pendiente-liquidar");
      expect(fila?.toLowerCase(), `${tema} --fila-pendiente-liquidar`).toBe(esperado[tema]);
      expect(b).toMatch(/--fila-hover:/);
      expect(b).toMatch(/--accion-reporte:/);
      expect(ratio(tok("text")!, fila!), `${tema} texto`).toBeGreaterThanOrEqual(7); // texto principal (sin cambio de color)
      // El texto secundario (10 px) y el enlace de acento se ajustan SOLO dentro de la fila pendiente.
      expect(ratio(tok("fila-pendiente-muted")!, fila!), `${tema} muted`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(tok("fila-pendiente-accent")!, fila!), `${tema} acento`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(tok("accion-reporte")!, fila!), `${tema} «Confirmar reporte»`).toBeGreaterThanOrEqual(4.5);
      // Visible sin ser chillón: se distingue de la superficie normal pero con luminosidad suave.
      expect(fila!.toLowerCase()).not.toBe("#ffffff");
    }
    // La superficie «liquidado» es la normal del tema: blanco en claro, nunca blanco literal en oscuro.
    expect(bloque('[data-theme="light"]')).toMatch(/--card:\s*#ffffff/i);
    expect(bloque('[data-theme="dark"]')).not.toMatch(/--card:\s*#ffffff/i);
  });

  it("badges de texto blanco con contraste ≥ 4.5:1 (700/600 de la paleta) y claras sobre la fila clara", () => {
    const luz = (h: string) => {
      const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const blancoSobre = (h: string) => 1.05 / (luz(h) + 0.05);
    const paleta: Record<string, string> = { "bg-slate-600": "#475569", "bg-amber-700": "#b45309", "bg-orange-700": "#c2410c", "bg-emerald-700": "#047857" };
    for (const b of [badgeLiquidacion(null, "En ruta"), badgeLiquidacion({ estado: "REPORTE_RECIBIDO", version: 1 }, "En ruta"),
      badgeLiquidacion({ estado: "EN_AJUSTE", version: 1 }, "En ruta"), badgeLiquidacion({ estado: "LIQUIDADO", version: 2 }, "En ruta")]) {
      expect(blancoSobre(paleta[b!.clase]), b!.texto).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("CSS de fila: fondo por estado en <tr>, hover y selección como capas independientes (visibles sobre el amarillo)", () => {
    const css = leer("src/app/globals.css");
    expect(css).toMatch(/\.fila-viaje\s*\{[^}]*background-color:\s*var\(--card\)/);
    expect(css).toMatch(/\.fila-viaje\[data-liquidacion="pendiente"\]\s*\{[^}]*background-color:\s*var\(--fila-pendiente-liquidar\)/);
    // El ajuste de contraste solo toca texto secundario/enlace, nunca --text.
    const regla = /\.fila-viaje\[data-liquidacion="pendiente"\]\s*\{([^}]*)\}/.exec(css)![1];
    expect(regla).toMatch(/--muted:\s*var\(--fila-pendiente-muted\)/);
    expect(regla).toMatch(/--accent:\s*var\(--fila-pendiente-accent\)/);
    expect(regla).not.toMatch(/--text:|(^|[^-])color:/);
    expect(css).toMatch(/\.fila-viaje:hover\s*\{[^}]*background-image:/);
    expect(css).toMatch(/\.fila-viaje\[data-seleccionada="true"\]\s*>\s*td:first-child\s*\{[^}]*box-shadow:/);
    const c = leer("src/app/e/[slug]/planes/planes-viajes-client.tsx");
    expect(c).toMatch(/className="fila-viaje /);
    expect(c).toMatch(/data-liquidacion=\{claseFilaLiquidacion\(p\.liquidacion, p\.estado\)\}/);
    expect(c).toMatch(/Fila amarilla = viaje pendiente de liquidación/);
    expect(c).toMatch(/data-seleccionada=\{seleccion\.has\(p\.id\) \? "true" : undefined\}/);
    // El color de TEXTO no se cambia por estado de liquidación: la clase de la fila no incluye text-*.
    expect(c).not.toMatch(/className="fila-viaje[^"]*text-/);
    expect(c).toMatch(/"Liquidación",/);
    expect(c).not.toMatch(/fila-viaje[^>]*\bbg-white\b|fila-viaje[^>]*bg-\[#fff/i);
  });
});

// ───────────────────────────── permisos ─────────────────────────────
describe("Liquidación Fase 2 · permisos (patrón real del repositorio)", () => {
  it("viajes_confirmar_reporte sigue el patrón de viajes_cerrar: fila propia, flag editar, módulo TMS", () => {
    expect([...PERMISOS_LIQUIDACION_VIAJE]).toEqual(["viajes_confirmar_reporte"]);
    expect(esPlataformaPermisible("viajes_confirmar_reporte")).toBe(true);
    expect(moduloEmpresaDelPermiso("viajes_confirmar_reporte")).toBe("tms");
    expect(labelPermiso("viajes_confirmar_reporte")).toBe("Viajes: confirmar reporte recibido");
    expect("viajes_confirmar_reporte".length).toBeLessThanOrEqual(40); // usuario_modulo.modulo VARCHAR(40)
    expect(catalogoGlobalPermisos()).toContain("viajes_confirmar_reporte");
    const prog = CATALOGO_PERMISOS.find((m) => m.id === "programacion")!;
    const a = prog.acciones.find((x) => x.modulo === "viajes_confirmar_reporte")!;
    expect(a).toMatchObject({ id: "confirmar_reporte", flag: "puedeEditar" });
    // Separado del cierre: ninguna acción comparte fila con viajes_cerrar.
    expect(prog.acciones.find((x) => x.modulo === "viajes_cerrar")!.modulo).not.toBe(a.modulo);
  });

  it("ningún rol lo trae por defecto (se asigna manualmente) y no se concede con viajes_cerrar", () => {
    // Admin recibe TODO el catálogo (igual que viajes_cerrar); aquí se verifica que ningún OTRO rol lo traiga.
    const admin = permisosDefaultPorRol("Admin" as never);
    expect(admin.find((p) => p.modulo === "viajes_confirmar_reporte")?.puedeEditar).toBe(admin.find((p) => p.modulo === "viajes_cerrar")?.puedeEditar);
    const roles = [
      "RRHH", "Marcaje", "Contabilidad", "Operaciones", "GerenteOperaciones", "JefeOperaciones",
      "AuxiliarOperaciones", "Facturador", "CoordinadorPredios", "CoordinadorCompras", "Piloto", "Visualizador",
    ];
    for (const rol of roles) {
      const perms: PermisoModulo[] = permisosDefaultPorRol(rol as never);
      const fila = perms.find((p) => p.modulo === "viajes_confirmar_reporte");
      expect(fila?.puedeEditar ?? false, rol).toBe(false);
    }
    const soloCerrar: PermisoModulo[] = [{ modulo: "viajes_cerrar", puedeVer: true, puedeCrear: true, puedeEditar: true, puedeEliminar: true }];
    expect(tienePermiso(soloCerrar, "viajes_confirmar_reporte", "editar")).toBe(false);
  });

  it("el guard exige el permiso explícito (nunca el rol) salvo Admin", () => {
    const t = leer("src/lib/tenant.ts");
    const i = t.indexOf("export async function requireTenantViajesConfirmarReporte");
    const cuerpo = t.slice(i, t.indexOf("\n}\n", i));
    expect(cuerpo).toMatch(/tienePermiso\(perms, "viajes_confirmar_reporte", accion\)/);
    expect(cuerpo).not.toMatch(/viajes_cerrar/);
    expect(cuerpo).toMatch(/session\.rol === "Admin"/);
  });
});

// ───────────────────────────── lectura tolerante ─────────────────────────────
describe("Liquidación Fase 2 · lectura para la tabla", () => {
  it("liquidacionesDePlanes: ids vacíos no consultan; sin tabla (1146) = mapa vacío; otros errores se propagan", async () => {
    const q = vi.fn();
    expect((await liquidacionesDePlanes(7, [], { query: q } as never)).size).toBe(0);
    expect(q).not.toHaveBeenCalled();
    const sinTabla = { query: async () => { throw Object.assign(new Error("no table"), { errno: 1146 }); } };
    expect((await liquidacionesDePlanes(7, [1, 2], sinTabla as never)).size).toBe(0);
    const caida = { query: async () => { throw Object.assign(new Error("lost"), { errno: 2013 }); } };
    await expect(liquidacionesDePlanes(7, [1], caida as never)).rejects.toThrow("lost");
    const ok = { query: async () => [[{ plan_id: 5, estado: "LIQUIDADO", version: 2 }]] };
    const m = await liquidacionesDePlanes(7, [5, 6, 5], ok as never);
    expect(m.get(5)).toEqual({ estado: "LIQUIDADO", version: 2 });
    expect(m.has(6)).toBe(false); // sin fila: nunca «liquidado»
  });

  it("la consulta de la lista es por empresa y no altera el SQL del reporte/exportación", () => {
    const d = leer("src/lib/tms/liquidacion-viaje.ts");
    expect(d).toMatch(/WHERE empresa_id = \? AND plan_id IN/);
    const r = leer("src/lib/tms/reportes-viajes.ts");
    expect(r).toMatch(/liquidacionesDePlanes\(empresaId, planIds\)/);
    expect(r).toMatch(/liquidacion: liquidacionMap\.get\(id\) \?\? null/);
  });
});

// ───────────────────────────── endpoint ─────────────────────────────
const holder = vi.hoisted(() => ({
  guard: null as unknown,
  confirmar: vi.fn(),
}));
vi.mock("@/lib/tenant", () => ({ requireTenantViajesConfirmarReporte: async () => holder.guard }));
vi.mock("@/lib/tms/liquidacion-viaje-reporte", () => ({ confirmarReporteOperativo: (...a: unknown[]) => holder.confirmar(...a) }));

describe("Liquidación Fase 2 · endpoint POST /tms/planes/[id]/reporte-recibido", () => {
  const llamar = async (id: string, body: unknown) => {
    const { POST } = await import("../../app/api/empresas/[slug]/tms/planes/[id]/reporte-recibido/route");
    return POST(new Request("http://x", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ slug: "e", id }) });
  };
  beforeEach(() => {
    holder.confirmar.mockReset();
    holder.guard = { session: { id: 4, username: "ana", rol: "JefeOperaciones" }, empresa: { id: 7 } };
  });

  it("sin permiso devuelve la respuesta del guard y NO ejecuta nada", async () => {
    const { NextResponse } = await import("next/server");
    holder.guard = { error: NextResponse.json({ error: "Sin permiso" }, { status: 403 }) };
    const r = await llamar("5", {});
    expect(r.status).toBe(403);
    expect(holder.confirmar).not.toHaveBeenCalled();
  });

  it("empresa y usuario salen de la SESIÓN; el body no puede enviarlos (esquema estricto)", async () => {
    const mal = await llamar("5", { empresaId: 9 });
    expect(mal.status).toBe(400);
    expect(holder.confirmar).not.toHaveBeenCalled();
    holder.confirmar.mockResolvedValue({ ok: true, resultado: { idempotente: false, evento: "REPORTE_RECIBIDO", liquidacion: { estado: "REPORTE_RECIBIDO", version: 1 } } });
    const r = await llamar("5", { observacion: "ok", reconocerAdvertencias: true });
    expect(r.status).toBe(200);
    expect(holder.confirmar).toHaveBeenCalledWith(
      { empresaId: 7, usuarioId: 4, usuario: "ana" },
      { planId: 5, observacion: "ok", reconocerAdvertencias: true },
    );
    expect(await r.json()).toMatchObject({ idempotente: false, liquidacion: { estado: "REPORTE_RECIBIDO", version: 1 } });
  });

  it("advertencias: 409 con código ADVERTENCIAS (sin escribir); id inválido: 400", async () => {
    holder.confirmar.mockResolvedValue({ ok: false, advertencias: [{ codigo: "SIN_LLEGADA_REGISTRADA", mensaje: "x" }] });
    const r = await llamar("5", {});
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ codigo: "ADVERTENCIAS", advertencias: [{ codigo: "SIN_LLEGADA_REGISTRADA" }] });
    expect((await llamar("abc", {})).status).toBe(400);
    expect((await llamar("-3", {})).status).toBe(400);
  });

  it("errores de dominio se traducen con su estado y mensaje; otros errores no filtran detalles", async () => {
    const { ErrorLiquidacionViaje } = await import("./liquidacion-viaje");
    holder.confirmar.mockRejectedValue(new ErrorLiquidacionViaje("NO_ENCONTRADO", "Viaje no encontrado.", 404));
    const r = await llamar("5", {});
    expect(r.status).toBe(404);
    expect((await r.json()).error).toBe("Viaje no encontrado.");
    holder.confirmar.mockRejectedValue(new Error("SELECT secreto FROM tabla"));
    const r500 = await llamar("5", {});
    expect(r500.status).toBe(500);
    expect(JSON.stringify(await r500.json())).not.toContain("secreto");
  });

  it("el endpoint no importa cierre, facturación, fondos ni cuadrilla", () => {
    const t = leer("src/app/api/empresas/[slug]/tms/planes/[id]/reporte-recibido/route.ts").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(t).not.toMatch(/cierre-viaje|cierre-masivo|@\/lib\/facturacion|@\/lib\/fel|@\/lib\/contabilidad|fondos|cuadrilla/);
    expect(t).toMatch(/requireTenantViajesConfirmarReporte\(slug, "editar"\)/);
  });
});
