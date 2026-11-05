import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { SnapshotBorrador } from "@/lib/borradores/controlador";
import { ESTADO_GUARDADO_INICIAL } from "@/lib/borradores/estado-guardado";
import { crearEnvioUnico } from "@/lib/idempotencia/clave-envio";
import {
  aEstado, avisosDeRecuperacion, construirPayload, ESQUEMA_REQUERIMIENTO_BORRADOR, hayContenidoEscrito, motivoBloqueoPorBorrador, restaurarPayload,
  type EstadoFormularioRequerimiento,
} from "./requerimiento-borrador";
import {
  clasificarResultadoEnvio, crearPuenteBorrador, limpiarBorradorEnviado, liberarEnvioRechazado, marcarEnvioCompletado, planearEnvio, prepararEnvioBorrador,
  type ApiBorradorEnvio,
} from "./requerimiento-borrador-envio";
import { validarPayload } from "@/lib/borradores/payload";

/** BORR-1d — adaptador JSON explícito y puente de envío (lógica pura; el comportamiento con la interfaz real está en el .dom.test). */
const linea = (n: number) => ({
  key: `L${n}`, vehiculo_id: n === 1 ? 5 : null, unidad_descripcion: n === 1 ? null : "Pick-up manual", fecha: "2026-10-0" + n, serie_factura: "A", numero_factura: String(1000 + n),
  proveedor_id: 9, repuesto_descripcion: `Filtro ${n}`, metodo_pago: "Transferencia", condicion_pago: "Contado" as const, total: "100.50", observaciones: null as string | null,
  documentosPendientes: [{ key: "d", tipo: "FACTURA", file: new File(["secreto"], "factura.pdf") }],
});
const estado = (): EstadoFormularioRequerimiento => aEstado({ fecha: "2026-10-01", entidad: 4, requirente: 2, encargado: 3, observaciones: "Urgente", lineas: [linea(1), linea(2), linea(3)] });

describe("adaptador JSON explícito", () => {
  it("construye el payload campo por campo, con versión de esquema explícita y SIN archivos ni claves sensibles", () => {
    const p = construirPayload(estado());
    expect(ESQUEMA_REQUERIMIENTO_BORRADOR).toBe(1);
    expect(p.cabecera).toEqual({ fechaRequerimiento: "2026-10-01", entidadRequirenteId: 4, requirenteUsuarioId: 2, encargadoComprasUsuarioId: 3, observaciones: "Urgente" });
    expect(p.lineas.map((l) => l.clave)).toEqual(["L1", "L2", "L3"]);
    expect(Object.keys(p.lineas[0]).sort()).toEqual(["clave", "condicionPago", "fecha", "metodoPago", "numeroFactura", "observaciones", "proveedorId", "repuestoDescripcion", "serieFactura", "total", "unidadDescripcion", "vehiculoId"]);
    const json = JSON.stringify(p);
    expect(json).not.toMatch(/factura\.pdf|secreto|documentosPendientes|"file"/);
    expect(validarPayload(p, 1_000_000)).toBeNull(); // lo acepta la validación JSON del núcleo (sin File/Blob, sin claves sensibles)
  });

  it("ida y vuelta exacta: conserva orden, claves estables, importes como los espera el formulario y hasta 500 líneas", () => {
    const e = estado();
    const r = restaurarPayload(JSON.parse(JSON.stringify(construirPayload(e))));
    expect(r).toEqual({ ok: true, estado: e });
    const muchas = aEstado({ fecha: "2026-10-01", entidad: 1, requirente: 1, encargado: 0, observaciones: "", lineas: Array.from({ length: 500 }, (_, i) => ({ ...linea(1), key: `k${i}` })) });
    const r2 = restaurarPayload(JSON.parse(JSON.stringify(construirPayload(muchas))));
    expect(r2.ok && r2.estado.lineas.map((l) => l.clave)).toEqual(muchas.lineas.map((l) => l.clave));
  });

  it("rechaza un payload dañado o alterado sin aplicarlo a medias", () => {
    const bueno = JSON.parse(JSON.stringify(construirPayload(estado())));
    const malo = (f: (p: typeof bueno) => void) => { const c = structuredClone(bueno); f(c); return restaurarPayload(c).ok; };
    expect(restaurarPayload(null).ok).toBe(false);
    expect(restaurarPayload({ cabecera: {}, lineas: [] }).ok).toBe(false);
    expect(malo((p) => { p.lineas = "x"; })).toBe(false);
    expect(malo((p) => { p.lineas = []; })).toBe(false);
    expect(malo((p) => { p.lineas[1].clave = p.lineas[0].clave; })).toBe(false); // clave repetida
    expect(malo((p) => { p.lineas[0].proveedorId = "9"; })).toBe(false);
    expect(malo((p) => { p.lineas[0].condicionPago = "Otro"; })).toBe(false);
    expect(malo((p) => { p.cabecera.entidadRequirenteId = -1; })).toBe(false);
    expect(malo((p) => { p.lineas = Array.from({ length: 501 }, (_, i) => ({ ...bueno.lineas[0], clave: `x${i}` })); })).toBe(false);
  });

  it("revalida contra el catálogo vigente: lo que ya no existe se avisa y no se presenta como vigente", () => {
    const cat = { entidades: [{ id: 4 }], usuarios: [{ id: 3 }], requirentesOperaciones: [{ id: 2 }], proveedores: [{ id: 9 }], vehiculos: [{ id: 5 }] };
    expect(avisosDeRecuperacion(estado(), cat)).toEqual([]);
    const e = estado(); e.entidad = 99; e.requirente = 98; e.encargado = 97; e.lineas[0].proveedor_id = 96; e.lineas[0].vehiculo_id = 95;
    const avisos = avisosDeRecuperacion(e, cat);
    expect(avisos).toHaveLength(5);
    expect(avisos.join("|")).toMatch(/Línea 1: el proveedor guardado ya no está disponible/);
    expect(avisosDeRecuperacion(e, null)).toEqual([]); // sin catálogos aún: no se afirma nada
  });

  it("detecta contenido escrito (para pedir confirmación al reemplazar) y no confunde el estado inicial", () => {
    const vacio = aEstado({ fecha: "2026-10-01", entidad: 0, requirente: 0, encargado: 0, observaciones: "", lineas: [{ key: "nueva-1", vehiculo_id: null, unidad_descripcion: null, fecha: "2026-10-01", serie_factura: null, numero_factura: null, proveedor_id: 0, repuesto_descripcion: "", metodo_pago: "Transferencia", condicion_pago: "Contado", total: "", observaciones: null }] });
    expect(hayContenidoEscrito(vacio, "2026-10-01")).toBe(false);
    expect(hayContenidoEscrito({ ...vacio, observaciones: "x" }, "2026-10-01")).toBe(true);
    expect(hayContenidoEscrito({ ...vacio, lineas: [...vacio.lineas, vacio.lineas[0]] }, "2026-10-01")).toBe(true);
  });
});

const snap = (parcial: Partial<SnapshotBorrador>): SnapshotBorrador => ({
  fase: "activo", guardado: ESTADO_GUARDADO_INICIAL, guardadoEn: null, revision: 1, recuperacion: null, conflicto: null, otraPestana: false, bloqueo: null, suspension: null,
  errorLectura: null, sinCanal: true, estadoEnvio: "ninguno", claveEnvio: null, ...parcial,
});
const api = (s: SnapshotBorrador, extra: Partial<ApiBorradorEnvio> = {}): ApiBorradorEnvio => ({
  snapshot: s, registrarEnvio: vi.fn(async () => ({ ok: true as const })), resolverEnvio: vi.fn(async () => ({ ok: true as const })), descartar: vi.fn(async () => ({ ok: true as const })), ...extra,
});

describe("envío: plan, clasificación y puente", () => {
  it("el plan depende de la fase: sin autoguardado se comporta como antes; con decisión pendiente o conflicto bloquea", () => {
    const k = "clave-de-prueba-0123456789";
    expect(planearEnvio(null, k).tipo).toBe("sin_borrador");
    for (const fase of ["desactivado", "sin_contexto", "cerrado"] as const) expect(planearEnvio(api(snap({ fase })), k).tipo).toBe("sin_borrador");
    expect(planearEnvio(api(snap({ fase: "activo" })), k).tipo).toBe("registrar");
    for (const fase of ["consultando", "decision_pendiente", "en_espera", "conflicto", "suspendido"] as const) expect(planearEnvio(api(snap({ fase })), k).tipo).toBe("bloqueado");
    expect(planearEnvio(api(snap({ fase: "bloqueado", bloqueo: "envio_en_curso", estadoEnvio: "enviando", claveEnvio: k })), k).tipo).toBe("reintento");
    expect(planearEnvio(api(snap({ fase: "bloqueado", bloqueo: "envio_en_curso", estadoEnvio: "enviando", claveEnvio: "otra-clave-distinta-0123" })), k).tipo).toBe("bloqueado"); // jamás con otra clave
    expect(planearEnvio(api(snap({ fase: "bloqueado", bloqueo: "enviado" })), k).tipo).toBe("bloqueado");
    const pend = planearEnvio(api(snap({ fase: "decision_pendiente", estadoEnvio: "enviando" })), k);
    expect(pend.tipo === "bloqueado" && pend.mensaje).toMatch(/Reconciliación pendiente/);
  });

  it("clasifica la respuesta: éxito solo con 2xx + id; 5xx/red/2xx ilegible = incierto; 4xx = rechazo definitivo", () => {
    expect(clasificarResultadoEnvio({ lanzo: true })).toBe("incierto");
    expect(clasificarResultadoEnvio({ lanzo: false, ok: true, status: 201, id: 12 })).toBe("exito");
    expect(clasificarResultadoEnvio({ lanzo: false, ok: true, status: 201, id: undefined })).toBe("incierto");
    expect(clasificarResultadoEnvio({ lanzo: false, ok: true, status: 200, id: "12" })).toBe("incierto");
    for (const status of [500, 502, 503, 504, 408, 429]) expect(clasificarResultadoEnvio({ lanzo: false, ok: false, status })).toBe("incierto");
    for (const status of [400, 401, 403, 404, 409, 422]) expect(clasificarResultadoEnvio({ lanzo: false, ok: false, status })).toBe("rechazo_definitivo");
  });

  it("prepara el envío registrando ANTES la clave del envío único; si el registro falla, no hay POST", async () => {
    const envio = crearEnvioUnico();
    const puente = crearPuenteBorrador();
    puente.publicar(api(snap({ fase: "activo" })));
    const ok = await prepararEnvioBorrador(puente, envio);
    expect(ok).toEqual({ ok: true, registrado: true });
    expect(puente.api!.registrarEnvio).toHaveBeenCalledWith(envio.clave());

    const falla = crearPuenteBorrador();
    falla.publicar(api(snap({ fase: "activo" }), { registrarEnvio: vi.fn(async () => ({ ok: false as const, motivo: "escritura_fallida", mensaje: "x" })) }));
    expect((await prepararEnvioBorrador(falla, crearEnvioUnico())).ok).toBe(false);
    const lanza = crearPuenteBorrador();
    lanza.publicar(api(snap({ fase: "activo" }), { registrarEnvio: vi.fn(async () => { throw new Error("boom"); }) }));
    expect((await prepararEnvioBorrador(lanza, crearEnvioUnico())).ok).toBe(false);
  });

  it("alinea la clave del envío único con la persistida en el borrador recuperado (y rechaza claves de formato inválido)", async () => {
    const guardada = "11111111-2222-4333-8444-555555555555";
    const envio = crearEnvioUnico();
    envio.clave(); // ya generó una propia
    const puente = crearPuenteBorrador();
    puente.publicar(api(snap({ fase: "activo", claveEnvio: guardada })));
    await prepararEnvioBorrador(puente, envio);
    expect(envio.clave()).toBe(guardada);
    expect(puente.api!.registrarEnvio).toHaveBeenCalledWith(guardada);
    const e2 = crearEnvioUnico();
    expect(e2.adoptarClave("corta")).toBe(false);
    expect(e2.adoptarClave("../../x".padEnd(20, "a"))).toBe(false);
  });

  it("resolver/limpiar: «completado» antes de borrar; nunca se borra un envío no marcado; los fallos no lanzan", async () => {
    const puente = crearPuenteBorrador();
    const a = api(snap({ fase: "bloqueado", bloqueo: "envio_en_curso" }));
    puente.publicar(a);
    expect(await limpiarBorradorEnviado(puente, false)).toBe(false);
    expect(a.descartar).not.toHaveBeenCalled();
    expect(await marcarEnvioCompletado(puente)).toBe(true);
    expect(a.resolverEnvio).toHaveBeenCalledWith({ estadoEnvio: "completado" });
    expect(await limpiarBorradorEnviado(puente, true)).toBe(true);
    expect(await liberarEnvioRechazado(puente)).toBe(true);
    expect(a.resolverEnvio).toHaveBeenLastCalledWith({ estadoEnvio: "ninguno" }); // conserva la clave
    puente.publicar(api(snap({}), { resolverEnvio: vi.fn(async () => { throw new Error("x"); }), descartar: vi.fn(async () => { throw new Error("x"); }) }));
    expect(await marcarEnvioCompletado(puente)).toBe(false);
    expect(await liberarEnvioRechazado(puente)).toBe(false);
    expect(await limpiarBorradorEnviado(puente, true)).toBe(false);
    expect(await marcarEnvioCompletado(crearPuenteBorrador())).toBe(false);
  });

  it("motivos de bloqueo del formulario por fase", () => {
    expect(motivoBloqueoPorBorrador(null)).toBeNull();
    expect(motivoBloqueoPorBorrador(snap({ fase: "activo" }))).toBeNull();
    expect(motivoBloqueoPorBorrador(snap({ fase: "desactivado" }))).toBeNull();
    expect(motivoBloqueoPorBorrador(snap({ fase: "bloqueado", bloqueo: "envio_en_curso" }))).toBeNull();
    expect(motivoBloqueoPorBorrador(snap({ fase: "decision_pendiente" }))).toMatch(/sin resolver/);
    expect(motivoBloqueoPorBorrador(snap({ fase: "conflicto" }))).toMatch(/conflicto/);
    expect(motivoBloqueoPorBorrador(snap({ fase: "bloqueado", bloqueo: "sesion_anterior" }))).toMatch(/Recarga/);
  });
});

describe("alcance de BORR-1d", () => {
  const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8");
  it("Gastos (BORR-1f) y las líneas de Fondos no usan el autoguardado (Fondos creación = BORR-1e) y la edición de Compras no monta el componente", () => {
    for (const r of ["src/app/e/[slug]/gastos/page.tsx", "src/components/tms/fondo-lineas-client.tsx", "src/components/tms/gastos-listado.tsx", "src/lib/tms/fondos.ts", "src/lib/tms/gastos.ts"]) {
      expect(leer(r)).not.toMatch(/requerimiento-autoguardado|requerimiento-borrador|useBorradorLocal|lib\/borradores/);
    }
    const form = leer("src/components/compras/requerimiento-form-client.tsx");
    expect(form).toMatch(/\{!detalle && editable \? <AutoguardadoRequerimiento /); // solo al CREAR
    expect(form).toMatch(/if \(!detalle\) \{\s+const preparado = await prepararEnvioBorrador/);
    expect(form).not.toMatch(/lib\/borradores/); // el formulario no toca el núcleo directamente
  });

  it("el adaptador y el puente no tocan MariaDB ni la API: sin mysql, sin db, sin fetch", () => {
    for (const r of ["src/lib/compras/requerimiento-borrador.ts", "src/lib/compras/requerimiento-borrador-envio.ts", "src/components/compras/requerimiento-autoguardado.tsx"]) {
      expect(leer(r)).not.toMatch(/mysql|@\/lib\/db|\bfetch\(|localStorage|sessionStorage/);
    }
    expect(existsSync(join(process.cwd(), "sql", "migrate-2026-11-borradores.sql"))).toBe(false);
  });

  it("el POST sigue siendo el único camino de creación y sigue llevando la clave de envío único", () => {
    const form = leer("src/components/compras/requerimiento-form-client.tsx");
    expect(form).toMatch(/clave_idempotencia: envio\.clave\(\)/);
    expect(form).not.toContain("reiniciarClave");
  });
});
