import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validarPayload } from "@/lib/borradores/payload";
import { ESTADO_GUARDADO_INICIAL } from "@/lib/borradores/estado-guardado";
import type { SnapshotBorrador } from "@/lib/borradores/controlador";
import { CLAVE_ENVIO_REGEX } from "@/lib/idempotencia/clave-envio";
import {
  aFormularioFondo, avisosDeRecuperacionFondo, construirPayloadFondo, ESQUEMA_FONDO_BORRADOR, hayContenidoFondo, motivoBloqueoFondo, restaurarPayloadFondo,
  type EstadoFondoForm,
} from "./fondo-borrador";
import { clasificarResultadoEnvioFondo, envioDesdeRef } from "./fondo-borrador-envio";

/** BORR-1e — adaptador de Solicitudes de fondo y contrato de envío (lógica pura; el comportamiento con la pantalla real está en el .dom.test). */
const EMPLEADOS = [{ id: 7, cuentaBancaria: "123-456-7", telefono: "55512345" }];
const linea = (n: number, extra: Record<string, string> = {}) => ({
  categoria: "Combustible", descripcion: `Gasto ${n}`, cantidad: "2", monto: `${n}00.10`, fechaViaje: "2026-10-03", empleadoId: "7", vehiculoId: "5", clienteId: "8", planId: "11",
  empleadoNombre: "Pedro Pérez", cuenta: "123-456-7", cargo: "Piloto", metodoPago: "Transferencia", ...extra,
});
const estado = (): EstadoFondoForm => ({ entidadRequirenteId: "4", requirenteUsuarioId: "2", solicitanteUsuarioId: "3", fechaRequerimiento: "2026-10-05", observaciones: "Urgente", lineas: [linea(1), linea(2), linea(3)] });

describe("adaptador JSON de lista blanca", () => {
  it("guarda solo campos editables, importes como TEXTO exacto, y no la cuenta derivada del catálogo", () => {
    const p = construirPayloadFondo(estado(), EMPLEADOS);
    expect(ESQUEMA_FONDO_BORRADOR).toBe(1);
    expect(p.lineas.map((l) => l.monto)).toEqual(["100.10", "200.10", "300.10"]);
    expect(p.lineas.every((l) => l.cuentaOverride === null)).toBe(true);
    expect(JSON.stringify(p)).not.toMatch(/123-456-7|55512345/);
    expect(Object.keys(p.lineas[0]).sort()).toEqual(["cantidad", "cargo", "categoria", "clienteId", "cuentaOverride", "descripcion", "empleadoId", "empleadoNombre", "fechaViaje", "metodoPago", "monto", "planId", "vehiculoId"].sort());
    expect(validarPayload(p, 1_000_000)).toBeNull();
  });

  it("una cuenta sobrescrita por el usuario SÍ se guarda; una derivada de otro método no", () => {
    const e = estado();
    e.lineas[0].cuenta = "999-OTRA";
    e.lineas[1] = linea(2, { metodoPago: "Efectivo", cuenta: "" });
    e.lineas[2] = linea(3, { metodoPago: "Efectivo", cuenta: "cuenta manual" });
    const p = construirPayloadFondo(e, EMPLEADOS);
    expect(p.lineas.map((l) => l.cuentaOverride)).toEqual(["999-OTRA", null, "cuenta manual"]);
  });

  it("ida y vuelta: conserva orden, cantidad y valores; la cuenta se re-sugiere del catálogo vigente", () => {
    const e = estado();
    const r = restaurarPayloadFondo(JSON.parse(JSON.stringify(construirPayloadFondo(e, EMPLEADOS))));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(aFormularioFondo(r.estado, EMPLEADOS)).toEqual(e);
    // el catálogo cambió: se sugiere la cuenta VIGENTE, no una vieja
    expect(aFormularioFondo(r.estado, [{ id: 7, cuentaBancaria: "NUEVA-1" }]).lineas[0].cuenta).toBe("NUEVA-1");
  });

  it("rechaza payloads dañados sin aplicarlos a medias", () => {
    const bueno = JSON.parse(JSON.stringify(construirPayloadFondo(estado(), EMPLEADOS)));
    const malo = (f: (p: typeof bueno) => void) => { const c = structuredClone(bueno); f(c); return restaurarPayloadFondo(c).ok; };
    expect(restaurarPayloadFondo(null).ok).toBe(false);
    expect(malo((p) => { p.lineas = "x"; })).toBe(false);
    expect(malo((p) => { p.lineas = []; })).toBe(false);
    expect(malo((p) => { p.lineas[0].monto = 100.1; })).toBe(false); // un número binario perdería precisión: debe ser texto
    expect(malo((p) => { p.lineas[0].empleadoId = "7; DROP"; })).toBe(false);
    expect(malo((p) => { p.cabecera.entidadRequirenteId = 4; })).toBe(false);
    expect(malo((p) => { p.lineas[1].cuentaOverride = 5; })).toBe(false);
    expect(malo((p) => { p.lineas = Array.from({ length: 101 }, () => bueno.lineas[0]); })).toBe(false);
  });

  it("revalida contra catálogos vigentes (sin catálogos aún no afirma nada)", () => {
    const cat = { entidadesRequirentes: [{ id: 4 }], usuariosOperaciones: [{ id: 2 }], solicitantes: [{ id: 3 }], empleados: [{ id: 7 }], vehiculos: [{ id: 5 }], clientes: [{ id: 8 }], planes: [{ id: 11 }], metodosPago: ["Transferencia"], categorias: ["Combustible"] };
    expect(avisosDeRecuperacionFondo(estado(), cat)).toEqual([]);
    const e = estado(); e.entidadRequirenteId = "99"; e.requirenteUsuarioId = "98"; e.solicitanteUsuarioId = "97";
    e.lineas[0] = linea(1, { empleadoId: "96", vehiculoId: "95", clienteId: "94", planId: "93", categoria: "X", metodoPago: "Y" });
    expect(avisosDeRecuperacionFondo(e, cat)).toHaveLength(9);
    expect(avisosDeRecuperacionFondo(e, null)).toEqual([]);
  });

  it("detecta contenido escrito y bloqueos por fase", () => {
    const vacio: EstadoFondoForm = { entidadRequirenteId: "", requirenteUsuarioId: "", solicitanteUsuarioId: "", fechaRequerimiento: "2026-10-01", observaciones: "", lineas: [{ categoria: "", descripcion: "", cantidad: "1", monto: "", fechaViaje: "", empleadoId: "", vehiculoId: "", clienteId: "", planId: "", empleadoNombre: "", cuenta: "", cargo: "", metodoPago: "" }] };
    expect(hayContenidoFondo(vacio, "2026-10-01")).toBe(false);
    expect(hayContenidoFondo({ ...vacio, observaciones: "x" }, "2026-10-01")).toBe(true);
    expect(hayContenidoFondo({ ...vacio, lineas: [{ ...vacio.lineas[0], monto: "5" }] }, "2026-10-01")).toBe(true);
    const snap = (parcial: Partial<SnapshotBorrador>): SnapshotBorrador => ({ fase: "activo", guardado: ESTADO_GUARDADO_INICIAL, guardadoEn: null, revision: 1, recuperacion: null, conflicto: null, otraPestana: false, bloqueo: null, suspension: null, errorLectura: null, sinCanal: true, estadoEnvio: "ninguno", claveEnvio: null, ...parcial });
    expect(motivoBloqueoFondo(null)).toBeNull();
    expect(motivoBloqueoFondo(snap({ fase: "desactivado" }))).toBeNull();
    expect(motivoBloqueoFondo(snap({ fase: "bloqueado", bloqueo: "envio_en_curso" }))).toBeNull();
    expect(motivoBloqueoFondo(snap({ fase: "decision_pendiente" }))).toMatch(/sin resolver/);
    expect(motivoBloqueoFondo(snap({ fase: "conflicto" }))).toMatch(/conflicto/);
  });
});

describe("contrato de envío de Fondos", () => {
  it("clasifica según el contrato real del backend: solo 400/401/403/404 son definitivos; 409, 5xx y lo desconocido son inciertos", () => {
    expect(clasificarResultadoEnvioFondo({ lanzo: true })).toBe("incierto");
    expect(clasificarResultadoEnvioFondo({ lanzo: false, ok: true, status: 200, id: 55 })).toBe("exito");
    expect(clasificarResultadoEnvioFondo({ lanzo: false, ok: true, status: 200, id: undefined })).toBe("incierto");
    for (const status of [400, 401, 403, 404]) expect(clasificarResultadoEnvioFondo({ lanzo: false, ok: false, status })).toBe("rechazo_definitivo");
    for (const status of [409, 408, 413, 422, 429, 500, 502, 503, 0]) expect(clasificarResultadoEnvioFondo({ lanzo: false, ok: false, status })).toBe("incierto");
  });

  it("el adaptador del ref genera la clave una vez, la conserva y adopta solo claves con formato válido", () => {
    const ref: { current: string | null } = { current: null };
    const envio = envioDesdeRef(ref);
    const k = envio.clave();
    expect(k).toMatch(CLAVE_ENVIO_REGEX);
    expect(envio.clave()).toBe(k);
    expect(envio.adoptarClave("corta")).toBe(false);
    expect(ref.current).toBe(k);
    expect(envio.adoptarClave("11111111-2222-4333-8444-555555555555")).toBe(true);
    expect(envio.clave()).toBe("11111111-2222-4333-8444-555555555555");
  });
});

describe("alcance de BORR-1e", () => {
  const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").replace(/\r\n/g, "\n");
  it("Gastos (BORR-1f) no se toca y el autoguardado solo se monta al CREAR", () => {
    for (const r of ["src/app/e/[slug]/gastos/page.tsx", "src/lib/tms/gastos.ts", "src/lib/tms/gastos-envio-cliente.ts"]) expect(leer(r)).not.toMatch(/fondo-borrador|fondo-autoguardado|requerimiento-borrador|lib\/borradores/);
    const pagina = leer("src/app/e/[slug]/fondos/page.tsx");
    expect(pagina).toMatch(/\{!editandoId \? <AutoguardadoFondo /);
    expect(pagina).toMatch(/if \(!editandoId\) \{\s+const preparado = await prepararEnvioBorrador/);
    expect(pagina).not.toMatch(/lib\/borradores/); // la página no toca el núcleo directamente
    expect(pagina).toMatch(/claveIdempotencia: \(claveEnvioRef\.current \?\?= nuevaClaveEnvio\(\)\)/); // una única fuente de la clave
  });

  it("el adaptador, el contrato y el componente no tocan MariaDB ni la API", () => {
    for (const r of ["src/lib/tms/fondo-borrador.ts", "src/lib/tms/fondo-borrador-envio.ts", "src/components/tms/fondo-autoguardado.tsx"]) expect(leer(r)).not.toMatch(/mysql|@\/lib\/db|\bfetch\(|localStorage|sessionStorage/);
    expect(existsSync(join(process.cwd(), "sql", "migrate-2026-11-borradores.sql"))).toBe(false);
  });
});
