import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { PermisoModulo } from "@/lib/permisos-shared";
import {
  borradorPendiente, confirmarRevision, construirCuerpoMigracion, estadoFiscalUi, formularioDesdeRevision, formularioVacio, guardarBorrador,
  montoATexto, permisosFiscal, resumenAcumulado, resumenFiscalLinea, unaSolaVez, urlFiscal, type LecturaFiscalUi, type RevisionFiscalUi,
} from "./fiscal-migracion-ui";

/** Sección "7. Fiscal / ISR" de la ficha (acumulado inicial de migración): lógica pura + guardas del código (sin harness de componentes). */
const HOY = "2026-10-05";
const rev = (over: Partial<RevisionFiscalUi> = {}): RevisionFiscalUi => ({
  revision: 1, corteAntecedentes: "2026-09-30", ingresosGravadosPrevios: "45000.00", ingresosExentosPrevios: "2000.00", igssLaboralPrevio: "2173.50", isrRetenidoPrevio: "1250.00",
  datos: { declaracionAntecedentes: "ACUMULADO_INICIAL_MIGRACION", migracion: { referenciaOrigen: "Sistema anterior", observacion: null, documentoId: null } },
  confirmadoPor: null, confirmadoEn: null, ...over,
});
const conf = (over: Partial<RevisionFiscalUi> = {}) => rev({ confirmadoPor: "gerente", confirmadoEn: "2026-10-02", ...over });
const form = () => ({ ...formularioVacio(2026), gravado: "45000", exento: "2000", igss: "2173.5", isr: "1250" });
const tabla = readFileSync("src/components/rrhh/fiscal-empleado-seccion.tsx", "utf8").replace(/\r\n/g, "\n");
const ficha = readFileSync("src/app/e/[slug]/rrhh/empleados/page.tsx", "utf8").replace(/\r\n/g, "\n");
const planillas = readFileSync("src/app/e/[slug]/rrhh/planillas/page.tsx", "utf8").replace(/\r\n/g, "\n");
const respuesta = (status: number, body: unknown) => vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }));
const permiso = (p: Partial<PermisoModulo>): PermisoModulo[] => [{ modulo: "configuracion", puedeVer: false, puedeCrear: false, puedeEditar: false, puedeEliminar: false, ...p } as unknown as PermisoModulo];

describe("UI — sección Fiscal / ISR en la ficha", () => {
  it("30) la sección '7. Fiscal / ISR' está en la ficha (solo al editar un empleado existente)", () => {
    expect(ficha).toContain('title="7. Fiscal / ISR"');
    expect(ficha).toContain("{editId != null ? (");
    expect(ficha).toContain("<FiscalEmpleadoSeccion slug={slug} empleadoId={editId}");
  });
  it("31) sin ninguna revisión: 'Sin configurar'", () => {
    expect(estadoFiscalUi(null)).toEqual({ clave: "SIN_CONFIGURAR", etiqueta: "Sin configurar" });
    expect(estadoFiscalUi({ ultima: null, confirmada: null })).toMatchObject({ clave: "SIN_CONFIGURAR" });
  });
  it("estados: borrador, sin antecedentes, otro patrono y acumulado de migración confirmado", () => {
    expect(estadoFiscalUi({ ultima: rev(), confirmada: null })).toMatchObject({ clave: "BORRADOR" });
    expect(estadoFiscalUi({ ultima: conf(), confirmada: conf() })).toMatchObject({ clave: "MIGRACION", etiqueta: "Acumulado inicial de migración · Confirmado" });
    const sin = conf({ datos: { declaracionAntecedentes: "SIN_ANTECEDENTES" } });
    expect(estadoFiscalUi({ ultima: sin, confirmada: sin })).toMatchObject({ clave: "SIN_ANTECEDENTES" });
    const otro = conf({ datos: { declaracionAntecedentes: "CON_ANTECEDENTES" } });
    expect(estadoFiscalUi({ ultima: otro, confirmada: otro })).toMatchObject({ clave: "OTRO_PATRONO" });
  });
  it("32) el formulario captura corte, 4 importes, origen y observaciones y arma el cuerpo del contrato existente (POST captura)", () => {
    for (const x of ["Fecha de corte", "Ingresos gravados acumulados", "Ingresos exentos acumulados", "IGSS laboral acumulado", "ISR retenido acumulado", "Origen / referencia", "Observaciones", "Guardar borrador", "Confirmar acumulado"]) expect(tabla).toContain(x);
    const r = construirCuerpoMigracion(form(), 2026, 0, HOY);
    expect("cuerpo" in r && r.cuerpo).toMatchObject({
      expectedRevision: 0,
      antecedente: { inicioFiscal: "2026-01-01", corteAntecedentes: "2026-09-30", ingresosGravadosPrevios: "45000.00", ingresosExentosPrevios: "2000.00", igssLaboralPrevio: "2173.50", isrRetenidoPrevio: "1250.00",
        datos: { declaracionAntecedentes: "ACUMULADO_INICIAL_MIGRACION", constancias: [], otrosPatronos: { declaracion: "NO" }, migracion: { referenciaOrigen: "Sistema anterior de planillas" } } },
    });
  });
  it("el cuerpo cumple el esquema estricto del servidor (mismo contrato de antecedentes)", async () => {
    const { antecedenteFiscalSchema } = await import("./fiscal-modelo");
    const r = construirCuerpoMigracion(form(), 2026, 0, HOY);
    expect("cuerpo" in r && antecedenteFiscalSchema.safeParse(r.cuerpo.antecedente).success).toBe(true);
  });
  it("validación de UX: monto negativo / más de 2 decimales / vacío, corte futuro o fuera del ejercicio, sin referencia", () => {
    for (const malo of ["-1", "10.123", "", "abc", "1e3"]) expect(construirCuerpoMigracion({ ...form(), gravado: malo }, 2026, 0, HOY)).toHaveProperty("error");
    expect(construirCuerpoMigracion({ ...form(), exento: "0" }, 2026, 0, HOY)).toHaveProperty("cuerpo"); // 0 es válido
    expect(construirCuerpoMigracion({ ...form(), fechaCorte: "2026-10-06" }, 2026, 0, HOY)).toMatchObject({ error: expect.stringContaining("posterior a hoy") });
    expect(construirCuerpoMigracion({ ...form(), fechaCorte: "2025-12-31" }, 2026, 0, HOY)).toMatchObject({ error: expect.stringContaining("ejercicio") });
    expect(construirCuerpoMigracion({ ...form(), referencia: " " }, 2026, 0, HOY)).toMatchObject({ error: expect.stringContaining("origen") });
    expect(montoATexto("Q 45000.5")).toBe("45000.50");
  });
  it("33) la confirmación muestra el resumen del acumulado ANTES de confirmar", () => {
    const r = resumenAcumulado(rev(), 2026);
    expect(r.titulo).toBe("ACUMULADO FISCAL INICIAL 2026");
    expect(r.corte).toBe("Corte: 30/09/2026");
    expect(r.lineas.map((l) => l.replace(/\s/g, " "))).toEqual([
      expect.stringMatching(/Ingresos gravados: Q45,?000\.00/), expect.stringMatching(/Ingresos exentos: Q2,?000\.00/),
      expect.stringMatching(/IGSS laboral: Q2,?173\.50/), expect.stringMatching(/ISR retenido: Q1,?250\.00/),
    ]);
    expect(r.aviso).toContain("acumulado en el sistema anterior hasta la fecha de corte");
    expect(tabla).toContain("<h3 className=\"text-base font-semibold\">{resumen.titulo}</h3>");
    expect(tabla).toContain("Cancelar");
  });
  it("34) éxito refresca el estado (recarga la lectura) tras guardar y tras confirmar", () => {
    expect(tabla.match(/await cargar\(\);/g)?.length).toBeGreaterThanOrEqual(2);
    expect(tabla).toContain("Acumulado fiscal confirmado.");
  });
  it("35) un error conserva el formulario: no se cierra ni se recarga, y se muestra el mensaje del servidor", async () => {
    const r = await guardarBorrador(respuesta(409, { error: "La revisión cambió; vuelva a consultar." }), "sitsa", 9, 2026, (construirCuerpoMigracion(form(), 2026, 0, HOY) as { cuerpo: never }).cuerpo);
    expect(r).toEqual({ tipo: "error", error: "La revisión cambió; vuelva a consultar.", status: 409 });
    const guardarFn = tabla.slice(tabla.indexOf("async function guardar()"), tabla.indexOf("async function confirmar()"));
    expect(guardarFn).toContain("setError(r.error); return; }");
    expect(guardarFn.slice(guardarFn.indexOf('r.tipo === "error"'), guardarFn.indexOf("setMensaje"))).not.toContain("setFormAbierto(false)");
    const err = await confirmarRevision(vi.fn(async () => { throw new Error("red"); }), "s", 9, 2026, 1);
    expect(err.tipo).toBe("error");
  });
  it("36) el candado evita el doble submit: dos clics rápidos envían UNA sola vez", async () => {
    let liberar!: () => void;
    const f = vi.fn(() => new Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>((res) => { liberar = () => res({ ok: true, status: 201, json: async () => ({ revision: 1 }) }); }));
    const candado = { current: false };
    const a = unaSolaVez(candado, () => guardarBorrador(f, "s", 9, 2026, (construirCuerpoMigracion(form(), 2026, 0, HOY) as { cuerpo: never }).cuerpo));
    const b = unaSolaVez(candado, () => guardarBorrador(f, "s", 9, 2026, (construirCuerpoMigracion(form(), 2026, 0, HOY) as { cuerpo: never }).cuerpo));
    expect(await b).toBeNull();
    liberar();
    expect((await a)?.tipo).toBe("ok");
    expect(f).toHaveBeenCalledTimes(1);
    expect(candado.current).toBe(false);
    expect(tabla).toContain("disabled={ocupado}");
  });
  it("guardar usa POST y confirmar usa PATCH del endpoint fiscal existente (sin un sistema paralelo)", async () => {
    const f = respuesta(201, { revision: 3 });
    await guardarBorrador(f, "sitsa", 9, 2026, (construirCuerpoMigracion(form(), 2026, 2, HOY) as { cuerpo: never }).cuerpo);
    expect(f).toHaveBeenCalledWith("/api/empresas/sitsa/rrhh/fiscal/empleados/9/2026", expect.objectContaining({ method: "POST" }));
    const g = respuesta(200, { revision: 3 });
    await confirmarRevision(g, "sitsa", 9, 2026, 3);
    expect(g).toHaveBeenCalledWith(urlFiscal("sitsa", 9, 2026), expect.objectContaining({ method: "PATCH", body: JSON.stringify({ accion: "confirmar", revision: 3 }) }));
  });
  it("37) una revisión confirmada se muestra de SOLO LECTURA (sin inputs); el borrador pendiente es lo que se confirma", () => {
    expect(tabla).toContain('aria-label="Revisión confirmada (solo lectura)"');
    const lectura = tabla.slice(tabla.indexOf('aria-label="Revisión confirmada'), tabla.indexOf("{mensaje ?"));
    expect(lectura).not.toContain("<input");
    const l: LecturaFiscalUi = { ultima: rev({ revision: 2 }), confirmada: conf({ revision: 1 }) };
    expect(borradorPendiente(l)?.revision).toBe(2);
    expect(borradorPendiente({ ultima: conf(), confirmada: conf() })).toBeNull();
  });
  it("38) nueva revisión según el flujo actual: el botón parte de la confirmada (prefilled) y guarda una revisión NUEVA (expectedRevision = última)", () => {
    expect(tabla).toContain("Nueva revisión del acumulado inicial");
    expect(formularioDesdeRevision(conf()).gravado).toBe("45000.00");
    const r = construirCuerpoMigracion(formularioDesdeRevision(conf({ revision: 3 })), 2026, 3, HOY);
    expect("cuerpo" in r && r.cuerpo.expectedRevision).toBe(3);
    expect(tabla).toContain("lectura?.ultima?.revision ?? 0");
  });
  it("el formulario NO es un <form> (la ficha ya está dentro de uno) y confirmar exige borrador guardado y sin cambios", () => {
    expect(tabla.match(/<form/g)).toBeNull();
    expect(tabla).toContain("disabled={ocupado || !pendiente || sucio || !permisos.puedeConfirmar}");
  });
});

describe("PERMISOS — reutiliza el submódulo RRHH 'configuracion' (sin permiso nuevo)", () => {
  it("quien solo VE empleados (sin configuracion) no captura ni confirma; ver/crear/editar se mapean a leer/guardar/confirmar", () => {
    expect(permisosFiscal("RRHH", [])).toEqual({ puedeVer: false, puedeCapturar: false, puedeConfirmar: false });
    expect(permisosFiscal("RRHH", permiso({ puedeVer: true }))).toEqual({ puedeVer: true, puedeCapturar: false, puedeConfirmar: false });
    expect(permisosFiscal("RRHH", permiso({ puedeVer: true, puedeCrear: true }))).toMatchObject({ puedeCapturar: true, puedeConfirmar: false });
    expect(permisosFiscal("RRHH", permiso({ puedeEditar: true }))).toMatchObject({ puedeConfirmar: true });
    expect(permisosFiscal("Admin", [])).toEqual({ puedeVer: true, puedeCapturar: true, puedeConfirmar: true });
  });
  it("el servidor exige los mismos permisos (GET ver · POST crear · PATCH editar en 'configuracion')", () => {
    const route = readFileSync("src/app/api/empresas/[slug]/rrhh/fiscal/empleados/[empleadoId]/[ejercicio]/route.ts", "utf8");
    expect(route).toContain('requireTenantRrhh(p.slug, "configuracion", "ver")');
    expect(route).toContain('requireTenantRrhh(p.slug, "configuracion", "crear")');
    expect(route).toContain('requireTenantRrhh(p.slug, "configuracion", "editar")');
  });
});

describe("PLANILLAS — información fiscal de la línea", () => {
  it("muestra 'Fiscal 2026: Migración inicial confirmada · Corte' con los acumulados usados (tooltip)", () => {
    const snap = { fiscal: { ejercicio: 2026, origenFiscal: { tipo: "ACUMULADO_INICIAL_MIGRACION", fechaCorte: "2026-09-30", revision: 4 },
      inputUsado: { antecedentes: { ingresosGravadosQ: "45000.00", ingresosExentosQ: "2000.00", igssLaboralQ: "2173.50", isrRetenidoQ: "1250.00" } } } };
    const r = resumenFiscalLinea(snap)!;
    expect(r.texto).toBe("Fiscal 2026: Migración inicial confirmada · Corte: 30/09/2026");
    expect(r.detalle).toMatch(/Gravado acumulado: Q45,?000\.00/);
    expect(r.detalle).toMatch(/ISR retenido: Q1,?250\.00/);
    expect(resumenFiscalLinea(null)).toBeNull();
    expect(resumenFiscalLinea({ fiscal: { ejercicio: 2026 } })).toBeNull(); // snapshots anteriores sin origen
    expect(planillas).toContain("resumenFiscalLinea(l.conceptosSnapshot)");
  });
});
