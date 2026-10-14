import { readFileSync } from "fs";
import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  permisos: new Set<string>(),
  guardLlamadas: [] as string[],
  justificar: vi.fn(),
  editar: vi.fn(),
  revertir: vi.fn(),
  contexto: vi.fn(),
  subir: vi.fn(),
  eliminar: vi.fn(),
  listar: vi.fn(),
  empleado: vi.fn(),
  obtenerConPrefijo: vi.fn(),
}));

vi.mock("@/lib/tenant", () => ({
  requireTenantRrhh: vi.fn(async (_slug: string, sub: string, accion: string) => {
    const clave = `${sub}:${accion}`;
    m.guardLlamadas.push(clave);
    return m.permisos.has(clave)
      ? { session: { id: 3, username: "rrhh", rol: "RRHH" }, empresa: { id: 7, nombre: "Empresa Siete" } }
      : { error: NextResponse.json({ error: "Sin permiso." }, { status: 403 }) };
  }),
}));
vi.mock("@/lib/rrhh/justificaciones-faltas", () => ({
  justificarFalta: m.justificar,
  editarJustificacion: m.editar,
  revertirJustificacion: m.revertir,
  obtenerContextoJustificacion: m.contexto,
}));
vi.mock("@/lib/rrhh/documentos-por-tipo", () => ({
  subirDocumentoPorTipo: m.subir,
  eliminarDocumentoPorTipo: m.eliminar,
  listarDocumentosPorTipo: m.listar,
  empleadoDeEmpresa: m.empleado,
  obtenerDocumentoConPrefijo: m.obtenerConPrefijo,
}));
vi.mock("@/lib/db", () => ({ query: vi.fn(async () => [{ id: 1 }]), getPool: vi.fn() }));

import { GET as getJust, POST as postJust, PATCH as patchJust } from "../../app/api/empresas/[slug]/rrhh/justificaciones-faltas/route";
import { POST as postRevertir } from "../../app/api/empresas/[slug]/rrhh/justificaciones-faltas/[id]/revertir/route";
import { POST as postEvidencia } from "../../app/api/empresas/[slug]/rrhh/justificaciones-faltas/evidencias/route";
import { DELETE as delEvidencia, GET as getEvidencia } from "../../app/api/empresas/[slug]/rrhh/justificaciones-faltas/evidencias/[docId]/route";
import { GET as getComp, POST as postComp } from "../../app/api/empresas/[slug]/rrhh/cumpleanios/comprobantes/route";
import { DELETE as delComp, GET as getCompDoc } from "../../app/api/empresas/[slug]/rrhh/cumpleanios/comprobantes/[docId]/route";
import { TIPOS_INCIDENCIA } from "./periodos";
import {
  AVISO_PLANILLA_JUSTIFICACION,
  TIPOS_JUSTIFICACION,
  esFilaFalta,
  validarMotivoReversion,
  validarObservacionJustificacion,
  validarTipoJustificacion,
} from "./justificaciones-faltas-shared";
import { EXTENSIONES_EVIDENCIA, firmaArchivoCoincide, nombreSeguro } from "./documentos-por-tipo-validacion";

const leer = (p: string) => readFileSync(p, "utf8");
const ctx = { params: Promise.resolve({ slug: "acme" }) };
const ctxId = (id: string) => ({ params: Promise.resolve({ slug: "acme", id }) });
const ctxDoc = (docId: string) => ({ params: Promise.resolve({ slug: "acme", docId }) });
const json = (body: unknown, method = "POST") =>
  new Request("http://x/api", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const formulario = (campos: Record<string, string>, archivo?: File) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  if (archivo) f.set("file", archivo);
  return new Request("http://x/api", { method: "POST", body: f });
};
const jpg = () => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], "a.jpg");

beforeEach(() => {
  m.permisos = new Set();
  m.guardLlamadas.length = 0;
  for (const f of [m.justificar, m.editar, m.revertir, m.contexto, m.subir, m.eliminar, m.listar, m.empleado, m.obtenerConPrefijo]) f.mockReset();
  m.justificar.mockResolvedValue({ justificacion: { id: 1 }, evento: "JUSTIFICADA", idempotente: false });
  m.editar.mockResolvedValue({ justificacion: { id: 1 }, evento: "EDITADA", idempotente: false });
  m.revertir.mockResolvedValue({ justificacion: { id: 1 }, evento: "REVERTIDA", idempotente: false });
  m.contexto.mockResolvedValue({ empleado: { id: 5 }, fecha: "2026-09-16", justificacion: null, estadoActual: "Falta", justificable: true, planilla: {} });
  m.listar.mockResolvedValue([]);
  m.empleado.mockResolvedValue({ id: 5, codigo: "E-005", nombre: "Ana" });
  m.subir.mockResolvedValue({ id: 9, nombreOriginal: "a.jpg", subidoEn: "2026-10-14 10:00:00", subidoPor: "rrhh" });
  m.eliminar.mockResolvedValue(true);
});

describe("Justificación de faltas · reglas puras", () => {
  it("los motivos reutilizan el catálogo de incidencias (sin inventar ni incluir Falta/Vacaciones)", () => {
    for (const t of TIPOS_JUSTIFICACION) expect(TIPOS_INCIDENCIA as readonly string[], t).toContain(t);
    for (const excluido of ["Falta", "Vacaciones", "A cuenta de Vacaciones"]) expect(TIPOS_JUSTIFICACION as readonly string[]).not.toContain(excluido);
    expect(validarTipoJustificacion("Médico")).toEqual({ ok: true, valor: "Médico" });
    expect(validarTipoJustificacion("Falta").ok).toBe(false);
    expect(validarTipoJustificacion("Inventado").ok).toBe(false);
    expect(validarTipoJustificacion(undefined).ok).toBe(false);
  });

  it("observación y motivo de reversión se validan", () => {
    expect(validarObservacionJustificacion("  ")).toEqual({ ok: true, valor: null });
    expect(validarObservacionJustificacion("x".repeat(501)).ok).toBe(false);
    expect(validarMotivoReversion("1234").ok).toBe(false);
    expect(validarMotivoReversion(" Constancia falsa ")).toEqual({ ok: true, valor: "Constancia falsa" });
  });

  it("solo las filas «Falta» / «Falta justificada» abren la justificación (doble clic)", () => {
    for (const estado of ["Falta", "Falta justificada"]) expect(esFilaFalta({ estadoEntrada: estado }), estado).toBe(true);
    for (const estado of ["A tiempo", "Retraso", "Vacaciones", "En Ruta", "En viaje", "Permiso con goce", "Presente", "Médico"]) {
      expect(esFilaFalta({ estadoEntrada: estado }), estado).toBe(false);
    }
  });
});

describe("Justificación de faltas · permisos y tenant de los endpoints", () => {
  it("leer exige Reportes:ver; justificar incidencias:crear; editar/revertir incidencias:editar", async () => {
    expect((await getJust(new Request("http://x/api?empleadoId=5&fecha=2026-09-16"), ctx)).status).toBe(403);
    expect((await postJust(json({ empleadoId: 5, fecha: "2026-09-16", tipo: "Médico" }), ctx)).status).toBe(403);
    expect((await patchJust(json({ id: 1, expectedVersion: 1, tipo: "Otro" }, "PATCH"), ctx)).status).toBe(403);
    expect((await postRevertir(json({ expectedVersion: 1, motivo: "Constancia falsa" }), ctxId("1"))).status).toBe(403);
    expect(m.guardLlamadas).toEqual(["reportes:ver", "incidencias:crear", "incidencias:editar", "incidencias:editar"]);
    for (const f of [m.contexto, m.justificar, m.editar, m.revertir]) expect(f).not.toHaveBeenCalled();
  });

  it("con permiso: la empresa y el usuario salen de la sesión, no del cuerpo", async () => {
    m.permisos = new Set(["incidencias:crear", "incidencias:editar", "reportes:ver"]);
    const r = await postJust(json({ empleadoId: 5, fecha: "2026-09-16", tipo: "Médico", observacion: "IGSS" }), ctx);
    expect(r.status).toBe(201);
    expect(m.justificar).toHaveBeenCalledWith({ empresaId: 7, usuario: "rrhh" }, { empleadoId: 5, fecha: "2026-09-16", tipo: "Médico", observacion: "IGSS" });
    for (const extra of [{ empresaId: 1 }, { empresa_id: 1 }, { creadoPor: "x" }, { estado: "ACTIVA" }]) {
      const mala = await postJust(json({ empleadoId: 5, fecha: "2026-09-16", tipo: "Médico", ...extra }), ctx);
      expect(mala.status, JSON.stringify(extra)).toBe(400);
    }
    expect(m.justificar).toHaveBeenCalledTimes(1);
    const rev = await postRevertir(json({ expectedVersion: 2, motivo: "Constancia falsa" }), ctxId("1"));
    expect(rev.status).toBe(200);
    expect(m.revertir).toHaveBeenCalledWith({ empresaId: 7, usuario: "rrhh" }, { id: 1, versionEsperada: 2, motivo: "Constancia falsa" });
    expect((await postRevertir(json({ motivo: "Constancia falsa" }), ctxId("1"))).status).toBe(400); // falta expectedVersion
  });

  it("evidencias: subir exige incidencias:crear/editar; descargar Reportes:ver; borrar incidencias:editar", async () => {
    const sin = await postEvidencia(formulario({ empleadoId: "5", fecha: "2026-09-16" }, jpg()), ctx);
    expect(sin.status).toBe(403);
    expect((await getEvidencia(new Request("http://x/api"), ctxDoc("9"))).status).toBe(403);
    expect((await delEvidencia(new Request("http://x/api", { method: "DELETE" }), ctxDoc("9"))).status).toBe(403);
    expect(m.subir).not.toHaveBeenCalled();
    expect(m.eliminar).not.toHaveBeenCalled();
    m.permisos = new Set(["incidencias:editar"]);
    const ok = await postEvidencia(formulario({ empleadoId: "5", fecha: "2026-09-16" }, jpg()), ctx);
    expect(ok.status).toBe(201);
    expect(m.subir).toHaveBeenCalledWith(expect.objectContaining({ empresaId: 7, empleadoId: 5, tipoDocumento: "Justificación de falta 2026-09-16", usuario: "rrhh" }));
    expect((await postEvidencia(formulario({ empleadoId: "5", fecha: "no-es-fecha" }, jpg()), ctx)).status).toBe(400);
  });
});

describe("Comprobantes de cumpleaños · permisos, tenant y formato de los endpoints", () => {
  it("listar exige Reportes:ver; adjuntar empleados:editar; eliminar empleados:eliminar", async () => {
    expect((await getComp(new Request("http://x/api?empleadoId=5&anio=2026"), ctx)).status).toBe(403);
    expect((await postComp(formulario({ empleadoId: "5", anio: "2026" }, jpg()), ctx)).status).toBe(403);
    expect((await getCompDoc(new Request("http://x/api"), ctxDoc("9"))).status).toBe(403);
    expect((await delComp(new Request("http://x/api", { method: "DELETE" }), ctxDoc("9"))).status).toBe(403);
    expect(m.subir).not.toHaveBeenCalled();
    expect(m.eliminar).not.toHaveBeenCalled();
    expect(m.guardLlamadas).toEqual(["reportes:ver", "empleados:editar", "empleados:crear", "reportes:ver", "empleados:eliminar"]);
  });

  it("con permiso: el año va en el tipo de documento y la empresa/usuario salen de la sesión", async () => {
    m.permisos = new Set(["empleados:editar", "reportes:ver", "empleados:eliminar"]);
    const r = await postComp(formulario({ empleadoId: "5", anio: "2027", empresaId: "999" }, jpg()), ctx);
    expect(r.status).toBe(201);
    expect(m.subir).toHaveBeenCalledWith(expect.objectContaining({ empresaId: 7, empleadoId: 5, tipoDocumento: "Comprobante de cumpleaños 2027", usuario: "rrhh" }));
    const body = await r.json();
    expect(JSON.stringify(body)).not.toMatch(/ruta|uploads|empresas\/7|http/i); // sin rutas ni URLs de almacenamiento
    const lista = await getComp(new Request("http://x/api?empleadoId=5&anio=2026"), ctx);
    expect(lista.status).toBe(200);
    expect(m.listar).toHaveBeenCalledWith(7, 5, "Comprobante de cumpleaños 2026");
    expect((await delComp(new Request("http://x/api", { method: "DELETE" }), ctxDoc("9"))).status).toBe(200);
    expect(m.eliminar).toHaveBeenCalledWith(expect.objectContaining({ empresaId: 7, docId: 9, usuario: "rrhh" }));
  });

  it("empleado de otra empresa = 404; año/empleado inválidos = 400", async () => {
    m.permisos = new Set(["empleados:editar", "reportes:ver"]);
    m.empleado.mockResolvedValue(null);
    expect((await postComp(formulario({ empleadoId: "5", anio: "2026" }, jpg()), ctx)).status).toBe(404);
    expect((await getComp(new Request("http://x/api?empleadoId=5&anio=2026"), ctx)).status).toBe(404);
    m.empleado.mockResolvedValue({ id: 5, codigo: "E-005", nombre: "Ana" });
    expect((await postComp(formulario({ empleadoId: "5", anio: "26" }, jpg()), ctx)).status).toBe(400);
    expect((await postComp(formulario({ empleadoId: "x", anio: "2026" }, jpg()), ctx)).status).toBe(400);
    expect((await getComp(new Request("http://x/api?empleadoId=5"), ctx)).status).toBe(400);
  });

  it("descarga de documento ajeno al flujo o de otra empresa = 404 (nunca otro documento del expediente)", async () => {
    m.permisos = new Set(["reportes:ver"]);
    m.obtenerConPrefijo.mockResolvedValue(null);
    expect((await getCompDoc(new Request("http://x/api"), ctxDoc("9"))).status).toBe(404);
    expect(m.obtenerConPrefijo).toHaveBeenCalledWith(7, 9, "Comprobante de cumpleaños ");
    expect((await getEvidencia(new Request("http://x/api"), ctxDoc("9"))).status).toBe(404);
    expect(m.obtenerConPrefijo).toHaveBeenLastCalledWith(7, 9, "Justificación de falta ");
  });
});

describe("Archivos · validación de formato (extensión + firma real + nombre seguro)", () => {
  it("solo JPG, JPEG, PNG, WebP y PDF (no BMP ni otros)", () => {
    expect([...EXTENSIONES_EVIDENCIA].sort()).toEqual([".jpeg", ".jpg", ".pdf", ".png", ".webp"]);
  });

  it("la firma debe coincidir con la extensión", () => {
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 0, 0, 0, 0, 0, 0, 0]);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 9, 9, 9, 9, 0x57, 0x45, 0x42, 0x50]);
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0, 0, 0, 0, 0, 0, 0]);
    expect(firmaArchivoCoincide(jpg, ".jpg")).toBe(true);
    expect(firmaArchivoCoincide(jpg, ".jpeg")).toBe(true);
    expect(firmaArchivoCoincide(png, ".png")).toBe(true);
    expect(firmaArchivoCoincide(webp, ".webp")).toBe(true);
    expect(firmaArchivoCoincide(pdf, ".pdf")).toBe(true);
    // Cruces: una extensión no basta.
    expect(firmaArchivoCoincide(pdf, ".jpg")).toBe(false);
    expect(firmaArchivoCoincide(png, ".webp")).toBe(false);
    expect(firmaArchivoCoincide(jpg, ".pdf")).toBe(false);
    expect(firmaArchivoCoincide(jpg, ".exe")).toBe(false);
  });

  it("el nombre guardado no conserva rutas ni caracteres de control", () => {
    expect(nombreSeguro("..\\..\\etc\\passwd.pdf")).toBe("passwd.pdf");
    expect(nombreSeguro("a/b/c.jpg")).toBe("c.jpg");
    expect(nombreSeguro('x"<>|:*?.png')).toBe("x_______.png");
    expect(nombreSeguro("\u0000\u001f")).toBe("__");
    expect(nombreSeguro("")).toBe("archivo");
  });
});

describe("Justificación y comprobantes · alcance (arquitectura)", () => {
  const pagina = leer("src/app/e/[slug]/rrhh/reportes/page.tsx");
  const modalJust = leer("src/components/rrhh/justificar-falta-modal.tsx");
  const paginaCumple = leer("src/app/e/[slug]/rrhh/reportes/cumpleanios/page.tsx");
  const reportes = leer("src/lib/rrhh/reportes.ts");
  const lib = leer("src/lib/rrhh/justificaciones-faltas.ts");

  it("doble clic solo sobre filas de falta, con cursor/tooltip y acción visible «Justificar»", () => {
    expect(pagina).toMatch(/const abreJustificacion = \(f: Fila\) => esFilaFalta\(f\) && f\.idEmpleado != null;/);
    expect(pagina).toMatch(/onDoubleClick=\{abreJustificacion\(f\) \? \(\) => setJustificando\(f\) : undefined\}/);
    expect(pagina).toMatch(/cursor-pointer/);
    expect(pagina).toMatch(/Doble clic para justificar/);
    expect(pagina).toMatch(/\{f\.justificacion \? "Ver justificación" : "Justificar"\}/);
    // El botón visible solo se renderiza para filas que abren la justificación.
    expect(pagina).toMatch(/\{abreJustificacion\(f\) \? \(\s*<button/);
  });

  it("el modal muestra empleado, código, fecha, estado, tipo, observación y evidencia; protege el doble envío", () => {
    for (const t of ["Empleado:", "Código:", "Fecha:", "Estado actual:", "Tipo / motivo", "Observación", "Evidencia"]) expect(modalJust).toContain(t);
    expect(modalJust).toMatch(/ocupadoRef\.current/);
    expect(modalJust).toMatch(/Confirmar reversión/);
    expect(modalJust).toMatch(/AVISO_PLANILLA_JUSTIFICACION/); // texto único: «Esta justificación no modifica automáticamente el descuento en planilla.»
  });

  it("la justificación NO inserta marcajes ni toca incidencias, ausencias, vacaciones ni planilla", () => {
    expect(lib).not.toMatch(/INSERT INTO (sesiones_trabajo|incidencias|marcajes|rrhh_asistencia_ausencias|saldos_vacaciones|descuentos)/i);
    expect(lib).not.toMatch(/(UPDATE|DELETE FROM) (sesiones_trabajo|incidencias|rrhh_asistencia_ausencias|empleados|descuentos)/i);
    expect(lib).not.toMatch(/DELETE FROM rrhh_asistencia_justificaciones/i); // nunca se borra: se revierte
    expect(lib).toMatch(/registrarAuditoriaTx/);
  });

  it("el reporte solo agrega la capa: la ausencia sigue siendo «Falta» sin entrada/salida inventadas", () => {
    expect(reportes).toMatch(/estadoEntrada: just \? ESTADO_FALTA_JUSTIFICADA : "Falta"/);
    expect(reportes).toMatch(/mapaJustificacionesActivas\(empresaId, fechaInicio, fechaFin\)/);
    // La rama de falta mantiene horaEntrada/horaSalida en null (no hay marcaje falso).
    const rama = reportes.slice(reportes.indexOf("// Ausencia real:"), reportes.indexOf("resultado.sort("));
    expect(rama).toMatch(/horaEntrada: null,\s*horaSalida: null/);
  });

  it("comprobantes: columna con cantidad/estado, «Ver / Adjuntar», año consultado y sin URLs privadas", () => {
    expect(paginaCumple).toMatch(/Comprobante<\/th>/);
    expect(paginaCumple).toMatch(/Sin comprobante/);
    expect(paginaCumple).toMatch(/1 archivo/);
    expect(paginaCumple).toMatch(/archivos/);
    expect(paginaCumple).toMatch(/Ver \/ Adjuntar/);
    expect(paginaCumple).toMatch(/anio=\{datos\?\.anio \?\? anio\}/);
    const modal = leer("src/components/rrhh/comprobantes-cumpleanios-modal.tsx");
    expect(modal).toMatch(/accept=\{EXT_ACEPTADAS\}/);
    expect(modal).not.toMatch(/\/uploads\/|\.builds|ruta_archivo|rutaArchivo/);
  });

  it("la migración es aditiva (solo CREATE TABLE IF NOT EXISTS) y no hay SQL para comprobantes", () => {
    const sql = leer("sql/migrate-2026-10-rrhh-justificaciones-faltas.sql").replace(/--[^\n]*/g, "");
    expect(sql).not.toMatch(/(^|;)\s*(DROP|TRUNCATE|ALTER|DELETE|UPDATE|INSERT)\b/im);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS rrhh_asistencia_justificaciones/);
    expect(sql).toMatch(/UNIQUE KEY uq_asist_just \(empresa_id, empleado_id, fecha\)/);
    expect(sql).not.toMatch(/cumpleanios|comprobante/i);
    for (const f of ["preflight", "verify"]) {
      const s = leer(`sql/${f}-2026-10-rrhh-justificaciones-faltas.sql`).replace(/--[^\n]*/g, "");
      expect(s, f).not.toMatch(/(^|;)\s*(DROP|TRUNCATE|ALTER|DELETE|UPDATE|INSERT|CREATE)\b/im);
    }
    expect(leer("sql/schema.sql")).toMatch(/CREATE TABLE IF NOT EXISTS rrhh_asistencia_justificaciones/);
  });

  it("FK TENANT-SAFE: el empleado se referencia por (empresa_id, id), nunca solo por id; sin ALTER a empleados", () => {
    const sql = leer("sql/migrate-2026-10-rrhh-justificaciones-faltas.sql").replace(/--[^\n]*/g, "");
    expect(sql).toMatch(/FOREIGN KEY \(empresa_id, empleado_id\)\s+REFERENCES empleados\(empresa_id, id\)/);
    expect(sql).not.toMatch(/FOREIGN KEY \(empleado_id\)/);
    expect(sql).not.toMatch(/ALTER TABLE/i);
    // schema.sql refleja la misma FK compuesta.
    const schema = leer("sql/schema.sql");
    const bloque = schema.slice(schema.indexOf("CREATE TABLE IF NOT EXISTS rrhh_asistencia_justificaciones"));
    expect(bloque).toMatch(/FOREIGN KEY \(empresa_id, empleado_id\)\s+REFERENCES empleados\(empresa_id, id\)/);
    expect(bloque).not.toMatch(/FOREIGN KEY \(empleado_id\)/);
    // El índice padre que exige existe en el schema de empleados (UNIQUE empresa_id, id).
    const emp = schema.slice(schema.indexOf("CREATE TABLE IF NOT EXISTS empleados"), schema.indexOf("CREATE TABLE IF NOT EXISTS rrhh_vacaciones_sync_estado"));
    expect(emp).toMatch(/UNIQUE KEY \w+ \(empresa_id, id\)/);
  });

  it("preflight/verify resistentes al contexto: base explícita, sin DATABASE() en filtros, guarda y decisión que DETIENE", () => {
    for (const f of ["preflight", "verify"]) {
      const s = leer(`sql/${f}-2026-10-rrhh-justificaciones-faltas.sql`);
      const sinComentarios = s.replace(/--[^\n]*/g, "");
      // Toda consulta a information_schema filtra por el literal de la base, nunca por DATABASE() ni por variables de sesión.
      expect(sinComentarios, f).not.toMatch(/(TABLE_SCHEMA|CONSTRAINT_SCHEMA|SCHEMA_NAME)\s*=\s*DATABASE\(\)/i);
      expect(sinComentarios, f).not.toMatch(/\bSET @/i);
      for (const m of sinComentarios.matchAll(/(TABLE_SCHEMA|CONSTRAINT_SCHEMA|SCHEMA_NAME)\s*=\s*'([^']+)'/g)) {
        expect(m[2], f).toBe("u611730801_Plataforma");
      }
      // Todo SHOW usa nombre calificado.
      for (const m of sinComentarios.matchAll(/SHOW (CREATE TABLE|INDEX FROM|TABLES FROM)\s+(\S+)/gi)) {
        expect(m[2], f).toMatch(/^u611730801_Plataforma/);
      }
      expect(s, f).toMatch(/Para otra instalación: |Para otra instalación,/);
    }
    const pre = leer("sql/preflight-2026-10-rrhh-justificaciones-faltas.sql");
    expect(pre).toMatch(/decision_contexto/);
    expect(pre).toMatch(/DETENER: selecciona la base u611730801_Plataforma/);
    expect(pre).toMatch(/UNIQUE \(empresa_id, id\)/);
    expect(pre).toMatch(/THEN 'OK' ELSE 'DETENER' END AS decision/);
    const ver = leer("sql/verify-2026-10-rrhh-justificaciones-faltas.sql");
    expect(ver).toMatch(/decision_fk_tenant/);
    expect(ver).toMatch(/KEY_COLUMN_USAGE/);
    // El verify no se limita a «detectar cruces»: comprueba la estructura y deja la auditoría de datos para lo que el schema no impide.
    expect(ver).toMatch(/ya IMPIDEN el cruce de tenant/);
  });

  it("planilla: la regla vigente está explícita (modal, doc) y no hay lógica nueva de planilla", () => {
    expect(AVISO_PLANILLA_JUSTIFICACION).toBe("Esta justificación no modifica automáticamente el descuento en planilla.");
    // El modal lo muestra SIEMPRE (no solo cuando hay ausencia confirmada).
    expect(modalJust).toMatch(/data-aviso-planilla="siempre"/);
    expect(modalJust).toMatch(/AVISO_PLANILLA_JUSTIFICACION/);
    expect(modalJust).toMatch(/data-aviso-planilla="ausencia-confirmada"/);
    // Documentación.
    const doc = leer("docs/RRHH-JUSTIFICACION-FALTAS-Y-COMPROBANTES-CUMPLEANIOS.md");
    expect(doc).toContain(AVISO_PLANILLA_JUSTIFICACION);
    expect(doc).toMatch(/NO elimina ni cambia automáticamente el descuento de planilla/);
    // Nada de planilla en la capa de justificación; sin con goce/sin goce como regla, ni incidencia artificial.
    for (const f of ["src/lib/rrhh/justificaciones-faltas.ts", "src/lib/rrhh/justificaciones-faltas-mapa.ts", "src/lib/rrhh/justificaciones-faltas-shared.ts"]) {
      expect(leer(f), f).not.toMatch(/from "\.\/(planilla|descuentos|vacaciones)/);
      expect(leer(f), f).not.toMatch(/\bINSERT INTO incidencias\b/i);
    }
    const planilla = leer("src/lib/rrhh/planilla-faltas.ts");
    expect(planilla).not.toMatch(/justificaciones/); // planilla-faltas.ts no se tocó ni consulta justificaciones
  });
});
