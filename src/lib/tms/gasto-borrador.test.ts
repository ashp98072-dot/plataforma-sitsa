import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { validarPayload } from "@/lib/borradores/payload";
import { ESTADO_GUARDADO_INICIAL } from "@/lib/borradores/estado-guardado";
import type { SnapshotBorrador } from "@/lib/borradores/controlador";
import {
  aFormularioGasto, avisosDeRecuperacionGasto, construirPayloadGasto, ESQUEMA_GASTO_BORRADOR, hayContenidoGasto, motivoBloqueoGasto, restaurarPayloadGasto,
  type EstadoGastoForm, type FormGasto,
} from "./gasto-borrador";
import { clasificarCreacionGasto } from "./gasto-borrador-envio";
import { enviarGasto, subirComprobanteGasto, type FetchGasto } from "./gastos-envio-cliente";

/** BORR-1f — adaptador de Gastos, contrato de envío y subida del comprobante (lógica pura; el comportamiento con la pantalla real está en el .dom.test). */
const EMPLEADOS = [{ id: 7, cuentaBancaria: "123-456-7", telefono: "55512345" }];
const lin = (n: number, extra: Record<string, unknown> = {}) => ({
  categoria: "Peajes", descripcion: `Extra ${n}`, cantidad: "3", monto: `${n}0.05`, metodoPago: "Transferencia", numeroCuentaPago: "123-456-7", fechaViaje: "2026-10-04",
  empleadoId: 7, vehiculoId: 5, clienteId: 8, planId: 11, ...extra,
});
const estado = (): EstadoGastoForm => ({
  form: {
    fechaSolicitud: "2026-10-05", fechaViaje: "2026-10-03", empleadoId: 7, vehiculoId: 5, clienteId: 8, planId: 11, categoria: "Combustible", descripcion: "Diesel", cantidad: "2", monto: "1234567.10",
    metodoPago: "Transferencia", numeroCuentaPago: "123-456-7", tieneFactura: true, observaciones: "Obs", entidadRequirenteId: 4, requirenteUsuarioId: 2, requirenteNombre: "", solicitanteUsuarioId: 3,
  },
  lineasAdicionales: [lin(1), lin(2), lin(3)],
});

describe("adaptador JSON de lista blanca", () => {
  it("guarda solo campos editables, importes como TEXTO exacto, sin el destino de pago derivado ni el archivo", () => {
    const p = construirPayloadGasto(estado(), EMPLEADOS);
    expect(ESQUEMA_GASTO_BORRADOR).toBe(1);
    expect(p.cabecera.monto).toBe("1234567.10");
    expect(p.cabecera.cantidad).toBe("2");
    expect(p.cabecera.tieneFactura).toBe(true);
    expect(p.lineasAdicionales.map((l) => l.monto)).toEqual(["10.05", "20.05", "30.05"]);
    expect([p.cabecera, ...p.lineasAdicionales].every((l) => l.numeroCuentaOverride === null)).toBe(true);
    expect(JSON.stringify(p)).not.toMatch(/123-456-7|55512345|requirenteNombre|Pedro|archivo|comprobante/i);
    expect(Object.keys(p.cabecera).sort()).toEqual(["categoria", "cantidad", "clienteId", "descripcion", "empleadoId", "entidadRequirenteId", "fechaSolicitud", "fechaViaje", "metodoPago", "monto", "numeroCuentaOverride", "observaciones", "planId", "requirenteUsuarioId", "solicitanteUsuarioId", "tieneFactura", "vehiculoId"].sort());
    expect(validarPayload(p, 1_000_000)).toBeNull();
  });

  it("un destino de pago sobrescrito por el usuario SÍ se guarda (cabecera y líneas); uno derivado no", () => {
    const e = estado();
    e.form.numeroCuentaPago = "999-OTRA";
    e.lineasAdicionales[0] = lin(1, { metodoPago: "Efectivo", numeroCuentaPago: "referencia manual" });
    e.lineasAdicionales[1] = lin(2, { metodoPago: "Efectivo", numeroCuentaPago: "" });
    const p = construirPayloadGasto(e, EMPLEADOS);
    expect(p.cabecera.numeroCuentaOverride).toBe("999-OTRA");
    expect(p.lineasAdicionales.map((l) => l.numeroCuentaOverride)).toEqual(["referencia manual", null, null]);
  });

  it("ida y vuelta: conserva orden, cantidad y valores; el destino se re-sugiere del catálogo vigente", () => {
    const e = estado();
    const r = restaurarPayloadGasto(JSON.parse(JSON.stringify(construirPayloadGasto(e, EMPLEADOS))));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(aFormularioGasto(r.estado, EMPLEADOS)).toEqual(e);
    expect(aFormularioGasto(r.estado, [{ id: 7, cuentaBancaria: "NUEVA-1" }]).form.numeroCuentaPago).toBe("NUEVA-1");
  });

  it("rechaza payloads dañados sin aplicarlos a medias", () => {
    const bueno = JSON.parse(JSON.stringify(construirPayloadGasto(estado(), EMPLEADOS)));
    const malo = (f: (p: typeof bueno) => void) => { const c = structuredClone(bueno); f(c); return restaurarPayloadGasto(c).ok; };
    expect(restaurarPayloadGasto(null).ok).toBe(false);
    expect(malo((p) => { p.lineasAdicionales = "x"; })).toBe(false);
    expect(malo((p) => { p.cabecera.monto = 1234567.1; })).toBe(false); // un número perdería precisión: debe ser texto
    expect(malo((p) => { p.cabecera.empleadoId = "7"; })).toBe(false);
    expect(malo((p) => { p.cabecera.empleadoId = -1; })).toBe(false);
    expect(malo((p) => { p.cabecera.tieneFactura = "si"; })).toBe(false);
    expect(malo((p) => { p.lineasAdicionales[1].monto = null; })).toBe(false);
    expect(malo((p) => { p.lineasAdicionales[0].numeroCuentaOverride = 5; })).toBe(false);
    expect(malo((p) => { p.lineasAdicionales = Array.from({ length: 101 }, () => bueno.lineasAdicionales[0]); })).toBe(false);
    expect(malo((p) => { p.lineasAdicionales = []; })).toBe(true); // sin líneas adicionales es válido (gasto simple)
  });

  it("revalida contra catálogos vigentes (sin catálogos aún no afirma nada)", () => {
    const cat = { entidadesRequirentes: [{ id: 4 }], usuariosOperaciones: [{ id: 2 }], solicitantes: [{ id: 3 }], empleados: [{ id: 7 }], vehiculos: [{ id: 5 }], clientes: [{ id: 8 }], planes: [{ id: 11 }], metodosPago: ["Transferencia", "Efectivo"], categorias: ["Combustible", "Peajes"] };
    expect(avisosDeRecuperacionGasto(estado(), cat)).toEqual([]);
    const e = estado();
    e.form = { ...e.form, entidadRequirenteId: 99, requirenteUsuarioId: 98, solicitanteUsuarioId: 97, empleadoId: 96, vehiculoId: 95, clienteId: 94, planId: 93, categoria: "X", metodoPago: "Y" };
    e.lineasAdicionales[1] = lin(2, { empleadoId: 50 });
    expect(avisosDeRecuperacionGasto(e, cat)).toHaveLength(10);
    expect(avisosDeRecuperacionGasto(e, null)).toEqual([]);
  });

  it("detecta contenido escrito y bloqueos por fase (creado → lo gestiona la página)", () => {
    const vacio: FormGasto = { ...estado().form, fechaSolicitud: "2026-10-01", fechaViaje: "", empleadoId: 0, vehiculoId: 0, clienteId: 0, planId: 0, categoria: "", descripcion: "", cantidad: "1", monto: "", metodoPago: "", numeroCuentaPago: "", tieneFactura: false, observaciones: "", entidadRequirenteId: 0, requirenteUsuarioId: 0, solicitanteUsuarioId: 0 };
    expect(hayContenidoGasto({ form: vacio, lineasAdicionales: [] }, vacio, false)).toBe(false);
    expect(hayContenidoGasto({ form: { ...vacio, monto: "5" }, lineasAdicionales: [] }, vacio, false)).toBe(true);
    expect(hayContenidoGasto({ form: vacio, lineasAdicionales: [lin(1)] }, vacio, false)).toBe(true);
    expect(hayContenidoGasto({ form: vacio, lineasAdicionales: [] }, vacio, true)).toBe(true);
    const snap = (parcial: Partial<SnapshotBorrador>): SnapshotBorrador => ({ fase: "activo", guardado: ESTADO_GUARDADO_INICIAL, guardadoEn: null, revision: 1, recuperacion: null, conflicto: null, otraPestana: false, bloqueo: null, suspension: null, errorLectura: null, sinCanal: true, estadoEnvio: "ninguno", claveEnvio: null, ...parcial });
    expect(motivoBloqueoGasto(null)).toBeNull();
    expect(motivoBloqueoGasto(snap({ fase: "desactivado" }))).toBeNull();
    expect(motivoBloqueoGasto(snap({ fase: "bloqueado", bloqueo: "envio_en_curso" }))).toBeNull();
    expect(motivoBloqueoGasto(snap({ fase: "bloqueado", bloqueo: "enviado" }))).toBeNull();
    expect(motivoBloqueoGasto(snap({ fase: "decision_pendiente" }))).toMatch(/sin resolver/);
    expect(motivoBloqueoGasto(snap({ fase: "decision_pendiente", recuperacion: { situacion: "envio_incierto" } as never }))).toMatch(/Reconciliación pendiente/);
    expect(motivoBloqueoGasto(snap({ fase: "conflicto" }))).toMatch(/conflicto/);
  });
});

describe("contrato de envío de Gastos", () => {
  it("clasifica según el contrato real de POST /tms/gastos: solo 400/401/403/404 son definitivos; 409, 5xx y lo desconocido son inciertos", () => {
    expect(clasificarCreacionGasto({ lanzo: true })).toBe("incierto");
    expect(clasificarCreacionGasto({ lanzo: false, ok: true, status: 200, gastoId: 55 })).toBe("exito");
    expect(clasificarCreacionGasto({ lanzo: false, ok: true, status: 200, gastoId: null })).toBe("incierto");
    expect(clasificarCreacionGasto({ lanzo: false, ok: true, status: 200, gastoId: "55" })).toBe("incierto");
    for (const status of [400, 401, 403, 404]) expect(clasificarCreacionGasto({ lanzo: false, ok: false, status })).toBe("rechazo_definitivo");
    for (const status of [409, 408, 413, 422, 429, 500, 502, 503, 0]) expect(clasificarCreacionGasto({ lanzo: false, ok: false, status })).toBe("incierto");
  });
});

describe("comprobante: dos operaciones distintas (crear / adjuntar)", () => {
  const resp = (status: number, data: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
  const ARCHIVO = new File([new Uint8Array([1])], "f.pdf", { type: "application/pdf" });

  it("enviarGasto: una red caída durante la subida devuelve fase «comprobante» (creación confirmada), no una excepción", async () => {
    const fetchFn: FetchGasto = vi.fn(async (url) => { if (url.endsWith("/comprobante")) throw new TypeError("Failed to fetch"); return resp(200, { mensaje: "Gasto registrado.", gasto: { id: 55 } }); });
    const r = await enviarGasto({ fetchFn, slug: "kt", editandoId: null, payload: { categoria: "Combustible" }, claveIdempotencia: "3f2a9c1e-7b64-4d0a-9e51-2c8f6a1b0d33", comprobante: ARCHIVO });
    expect(r).toMatchObject({ fase: "comprobante", ok: false, gastoId: 55 });
  });

  it("subirComprobanteGasto: sube SOLO el archivo al id indicado (sin POST de creación) y no lanza ante fallos", async () => {
    const llamadas: { url: string; metodo?: string }[] = [];
    const ok = vi.fn(async (url: string, init?: { method?: string }) => { llamadas.push({ url, metodo: init?.method }); return resp(200, {}); });
    expect(await subirComprobanteGasto({ fetchFn: ok, slug: "kt", gastoId: 55, comprobante: ARCHIVO })).toEqual({ ok: true });
    expect(llamadas).toEqual([{ url: "/api/empresas/kt/tms/gastos/55/comprobante", metodo: "POST" }]);
    const falla = await subirComprobanteGasto({ fetchFn: async () => resp(500, { error: "No se pudo guardar el comprobante." }), slug: "kt", gastoId: 55, comprobante: ARCHIVO });
    expect(falla).toEqual({ ok: false, error: "No se pudo guardar el comprobante." });
    const red = await subirComprobanteGasto({ fetchFn: async () => { throw new TypeError("x"); }, slug: "kt", gastoId: 55, comprobante: ARCHIVO });
    expect(red.ok).toBe(false);
  });
});

describe("alcance de BORR-1f", () => {
  const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").replace(/\r\n/g, "\n");
  it("el autoguardado solo se monta al CREAR y la página no toca el núcleo ni la API de borradores directamente", () => {
    const pagina = leer("src/app/e/[slug]/gastos/page.tsx");
    expect(pagina).toMatch(/\{!editandoId \? <AutoguardadoGasto /);
    expect(pagina).toMatch(/if \(!editandoId\) \{\s+const preparado = await prepararEnvioBorrador/);
    expect(pagina).not.toMatch(/lib\/borradores/);
    expect(pagina).toMatch(/const clave = editandoId \? "" : \(claveEnvioRef\.current \?\?= nuevaClaveEnvio\(\)\)/); // contrato previo intacto
    expect(pagina).toContain("crearGuardEnvio()");
    expect(pagina).toContain("enviarGasto({ fetchFn: fetch");
  });

  it("el adaptador, el contrato y el componente no tocan MariaDB ni la API; Fondos y Compras no se modifican aquí", () => {
    for (const r of ["src/lib/tms/gasto-borrador.ts", "src/lib/tms/gasto-borrador-envio.ts", "src/components/tms/gasto-autoguardado.tsx"]) expect(leer(r)).not.toMatch(/mysql|@\/lib\/db|\bfetch\(|localStorage|sessionStorage/);
    expect(existsSync(join(process.cwd(), "sql", "migrate-2026-11-borradores.sql"))).toBe(false);
    expect(leer("src/app/e/[slug]/fondos/page.tsx")).not.toMatch(/gasto-borrador|gasto-autoguardado/);
    expect(leer("src/components/compras/requerimiento-form-client.tsx")).not.toMatch(/gasto-borrador|gasto-autoguardado/);
  });
});
