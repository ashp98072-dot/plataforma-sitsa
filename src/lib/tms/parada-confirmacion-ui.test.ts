import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ getPool: vi.fn(), query: vi.fn(), execute: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: vi.fn(), registrarAuditoria: vi.fn() }));

import { query } from "@/lib/db";
import { listarEntregasDelViaje, RESULTADOS_CONFIRMACION } from "./parada-confirmacion";
import { ETIQUETA_RESULTADO, fechaConfirmacion, notaValida, puedeActuar, puedeEnviar, RESULTADOS_CON_INCIDENCIA, rutaConfirmar, usuarioVisible, type EntregaVista } from "./parada-confirmacion-ui";

// TMS-ENTREGA-PILOTO-2 — datos que el servidor entrega a la pantalla y la parte pura de la interfaz.
const read = (p: string) => readFileSync(join(__dirname, "../../..", p), "utf8");
const confRow = (id: number, paradaId: number, resultado: string, revision = "NO_REQUERIDA") => ({ id, plan_id: 55, parada_id: paradaId, resultado, revision, piloto_usuario: "portal:P01", confirmado_en: "2026-11-11 10:05:00", evidencia_id: 70, nota: null });
beforeEach(() => { vi.clearAllMocks(); });

describe("listarEntregasDelViaje", () => {
  it("devuelve solo las paradas de Entrega/Descarga del plan de ESTA empresa, con su evidencia aceptable y su última confirmación", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce([{ id: 11, orden: 2, lugar_nombre: "Club Zona 10", tipo: "Entrega" }, { id: 12, orden: 3, lugar_nombre: "Club Mixco", tipo: "Entrega" }, { id: 13, orden: 4, lugar_nombre: "Club Villa", tipo: "Descarga" }] as never)
      .mockResolvedValueOnce([{ parada_id: 11, n: 2 }, { parada_id: 13, n: 1 }] as never)
      .mockResolvedValueOnce([confRow(9, 11, "ENTREGADA_POR_PILOTO"), confRow(8, 11, "PARCIAL", "PENDIENTE"), confRow(7, 13, "INCIDENCIA", "PENDIENTE")] as never);
    const r = await listarEntregasDelViaje(7, 55, 900);
    expect(r.map((e) => [e.paradaId, e.orden, e.lugarNombre, e.tipo, e.evidencias, e.confirmacion?.id ?? null])).toEqual([[11, 2, "Club Zona 10", "Entrega", 2, 9], [12, 3, "Club Mixco", "Entrega", 0, null], [13, 4, "Club Villa", "Descarga", 1, 7]]);
    expect(r[0].confirmacion).toMatchObject({ resultado: "ENTREGADA_POR_PILOTO", recepcionOficial: "NO_ACEPTADA_POR_PRICESMART", estadoExternoPublicado: false });   // la más reciente de la parada gana
  });
  it("cada consulta lleva el alcance completo (empresa, plan, viaje) y no consulta evidencias si no hay paradas", async () => {
    vi.mocked(query).mockResolvedValueOnce([] as never); expect(await listarEntregasDelViaje(7, 55, 900)).toEqual([]); expect(query).toHaveBeenCalledTimes(1);
    vi.mocked(query).mockReset();
    vi.mocked(query).mockResolvedValueOnce([{ id: 11, orden: 1, lugar_nombre: "x", tipo: "Entrega" }] as never).mockResolvedValueOnce([] as never).mockResolvedValueOnce([] as never);
    await listarEntregasDelViaje(7, 55, 900);
    const [paradas, evidencias, confirmaciones] = vi.mocked(query).mock.calls;
    expect(paradas[1]).toEqual([55, 7]); expect(String(paradas[0])).toContain("pp.tipo IN ('Entrega', 'Descarga')"); expect(String(paradas[0])).toContain("p.empresa_id = ?");
    expect(evidencias[1]).toEqual([7, 900]); expect(String(evidencias[0])).toContain("tipo = 'producto'"); expect(confirmaciones[1]).toEqual([7, 55]);
    for (const c of vi.mocked(query).mock.calls) expect(String(c[0])).toMatch(/^\s*SELECT/i);
  });
  it("si la tabla de confirmaciones no existe todavía, las paradas salen sin confirmación (no se rompe la pantalla)", async () => {
    vi.mocked(query).mockResolvedValueOnce([{ id: 11, orden: 1, lugar_nombre: "x", tipo: "Entrega" }] as never).mockResolvedValueOnce([{ parada_id: 11, n: 1 }] as never).mockRejectedValueOnce(Object.assign(new Error("x"), { errno: 1146 }));
    const r = await listarEntregasDelViaje(7, 55, 900); expect(r).toHaveLength(1); expect(r[0]).toMatchObject({ evidencias: 1, confirmacion: null });
  });
});

describe("parte pura de la interfaz", () => {
  const e = (over: Partial<EntregaVista> = {}): EntregaVista => ({ paradaId: 1, orden: 1, lugarNombre: "x", tipo: "Entrega", evidencias: 0, confirmacion: null, ...over });
  it("las etiquetas cubren todos los resultados reales y separan lo del piloto de la recepción oficial", () => {
    expect(Object.keys(ETIQUETA_RESULTADO).sort()).toEqual([...RESULTADOS_CONFIRMACION].sort()); expect(ETIQUETA_RESULTADO.ENTREGADA_POR_PILOTO).toBe("ENTREGADA POR PILOTO");
    for (const etiqueta of Object.values(ETIQUETA_RESULTADO)) expect(etiqueta).not.toMatch(/PriceSmart|oficial|aceptad/i);
    expect([...RESULTADOS_CON_INCIDENCIA]).toEqual(RESULTADOS_CONFIRMACION.filter((r) => r !== "ENTREGADA_POR_PILOTO"));
  });
  it("la nota exige 5..500 caracteres reales (sin contar espacios de los extremos)", () => {
    for (const n of ["", "    ", "abcd", "  ab  "]) expect(notaValida(n)).toBe(false); for (const n of ["abcde", "  abcde  ", "x".repeat(500)]) expect(notaValida(n)).toBe(true); expect(notaValida("x".repeat(501))).toBe(false);
  });
  it("se puede actuar solo sin confirmación previa y con permiso; enviar exige evidencia", () => {
    expect(puedeActuar(e(), true)).toBe(true); expect(puedeActuar(e(), false)).toBe(false);
    const c = { id: 1 } as never; expect(puedeActuar(e({ confirmacion: c }), true)).toBe(false);
    expect(puedeEnviar(e({ evidencias: 0 }))).toBe(false); expect(puedeEnviar(e({ evidencias: 1 }))).toBe(true); expect(puedeEnviar(e({ evidencias: 1, confirmacion: c }))).toBe(false);
  });
  it("formatea fecha y usuario; un valor desconocido se muestra tal cual", () => {
    expect(fechaConfirmacion("2026-11-11 10:05:00")).toBe("11/11/2026 10:05"); expect(fechaConfirmacion("2026-11-11T08:09:10.000Z")).toBe("11/11/2026 08:09"); expect(fechaConfirmacion("ayer")).toBe("ayer");
    expect(usuarioVisible("portal:P01")).toBe("P01"); expect(usuarioVisible("ana")).toBe("ana");
    expect(rutaConfirmar(900, 11)).toBe("/api/portal/viajes/900/paradas/11/confirmar");
  });
});

describe("cableado y límites (estático)", () => {
  it("la página consulta las entregas con la empresa de la SESIÓN solo para el viaje en curso y se las pasa al formulario", () => {
    const page = read("src/app/portal/viajes/page.tsx");
    expect(page).toContain("listarEntregasDelViaje(session!.empresaId, asignacionEnCurso.planId, asignacionEnCurso.viajeId)"); expect(page).toContain("asignacionEnCurso?.viajeId"); expect(page).toContain("entregas={entregas}");
  });
  it("el formulario reutiliza la pantalla de evidencia: un solo formulario de cámara, enlazado desde la confirmación", () => {
    const form = read("src/app/portal/viajes/viaje-form.tsx"); const conf = read("src/app/portal/viajes/confirmacion-entregas.tsx");
    expect(form).toContain('id="adjuntar-evidencia"'); expect(form.match(/getUserMedia\(/g)).toHaveLength(1); expect(conf).not.toMatch(/getUserMedia|geolocation|type="file"|FormData|canvas/);
    expect(form).toContain("onSubirEvidencia={prepararEvidenciaDeParada}"); expect(form).toContain('asignacionEnCurso?.estado === "En ruta"');
  });
  it("la pantalla nunca publica estados externos ni toca PriceSmart/solicitudes, y no hay SQL ni migraciones nuevas", () => {
    const conf = read("src/app/portal/viajes/confirmacion-entregas.tsx") + read("src/lib/tms/parada-confirmacion-ui.ts");
    expect(conf).not.toMatch(/integrations\/pricesmart|outbox|solicitud(es)?-cliente|api\/pricesmart/i); expect((conf.match(/fetch\(/g) ?? [])).toHaveLength(1); expect(conf).toContain("rutaConfirmar(viajeId, paradaId)");
    expect(conf).not.toMatch(/\b(SELECT|INSERT|UPDATE|DELETE)\b\s+\w+\s+(FROM|INTO|SET)\b/);
  });
});
