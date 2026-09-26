import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));

import { query } from "@/lib/db";
import { colaboradorParticipaEnViaje, listarAsignacionesOperativasEmpleado, obtenerViajeAbiertoDeEmpleado } from "@/lib/flota/viajes-piloto";
import { destinatariosDelPlan, mensajeAsignacion } from "@/app/e/[slug]/programacion/notificar-personal";
import { calcularCambioSensible, camposSensiblesPatch } from "@/app/e/[slug]/programacion/plan-form";
import { filaOperativa } from "./reporte-viajes-historial-pdf";
import { filaReporteDiario } from "./reporte-diario-viajes";
import type { Plan } from "@/app/e/[slug]/programacion/programacion-client";

/**
 * PILOTO EXTRA — portal, notificaciones, reportes/PDF/imagen, formulario de Programación y migración SQL.
 */
const src = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const sqlSinComentarios = (f: string) => src(f).split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
beforeEach(() => vi.resetAllMocks());

describe("20) PORTAL: el piloto extra ve el viaje que tiene asignado (y solo ese)", () => {
  it("historial: une el piloto extra del plan y filtra por SU empleado; tenant y ventana intactos", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await listarAsignacionesOperativasEmpleado(7, 23);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(String(sql)).toContain("LEFT JOIN tms_plan_pilotos_adicionales pe ON pe.plan_id = p.id");
    expect(String(sql)).toContain("LEFT JOIN tms_personal pex ON pex.id = pe.personal_id");
    expect(String(sql)).toContain("(pil.id_empleado = ? OR pex.id_empleado = ? OR aux.id_empleado = ? OR aux_legacy.id_empleado = ?)");
    expect(String(sql)).toContain("p.empresa_id = ?");
    expect(params).toEqual([7, 23, 23, 23, 23]); // NO se amplía a otros viajes: siempre el mismo empleado
  });

  it("muestra el nombre del piloto extra con UNA consulta para todos los viajes", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce([{ id: 1, codigo: "P1", fecha_plan: "2026-09-30", estado: "Programado", piloto: "Juan Pérez" }, { id: 2, codigo: "P2", fecha_plan: "2026-09-30", estado: "Programado", piloto: "Ana" }] as never)
      .mockResolvedValueOnce([{ plan_id: 1, nombre: "Carlos López" }] as never) // extra
      .mockResolvedValueOnce([] as never); // auxiliares
    const r = await listarAsignacionesOperativasEmpleado(7, 300);
    expect(r.map((x) => [x.codigo, x.piloto, x.pilotoExtra])).toEqual([["P1", "Juan Pérez", "Carlos López"], ["P2", "Ana", null]]);
    expect(vi.mocked(query).mock.calls.filter(([sql]) => String(sql).includes("tms_plan_pilotos_adicionales x"))).toHaveLength(1);
  });

  it("puede participar (evidencias/acciones de participante) y ve su viaje abierto, siempre acotado por empresa y por SU empleado", async () => {
    vi.mocked(query).mockResolvedValue([{ id: 5, plan_id: 9, estado: "abierto", km_salida: 1, hora_salida: "x", placa: "C-1", ev_tablero_salida: 0, ev_tablero_llegada: 0 }] as never);
    await colaboradorParticipaEnViaje(7, 300, 5);
    const [sql1, p1] = vi.mocked(query).mock.calls[0];
    expect(String(sql1)).toContain("pex.id_empleado = ?");
    expect(p1).toEqual([5, 7, 300, 300, 300, 300, 300]);
    await obtenerViajeAbiertoDeEmpleado(7, 300);
    const [sql2, p2] = vi.mocked(query).mock.calls[1];
    expect(String(sql2)).toContain("pex.id_empleado = ?");
    expect(String(sql2)).toContain("v.empresa_id = ?");
    expect(p2).toEqual([7, 300, 300, 300, 300, 300]);
  });

  it("decisión documentada: SALIR/iniciar el viaje, vincular el viaje técnico y cerrar siguen siendo del piloto PRINCIPAL (piloto_id)", () => {
    expect(src("src/app/api/portal/viajes/route.ts")).toContain("INNER JOIN tms_personal pil ON pil.id = p.piloto_id");
    expect(src("src/lib/tms/vincular-viaje-plan.ts")).toContain("INNER JOIN tms_personal pil ON pil.id = p.piloto_id");
    expect(src("src/lib/flota/viajes-piloto.ts")).toContain("Iniciar la salida");
    expect(src("src/lib/tms/piloto-extra.ts")).toContain("siguen usando `piloto_id`");
  });
});

describe("23) NOTIFICACIONES: ambos pilotos son destinatarios", () => {
  const plan = (over: Record<string, unknown> = {}) => ({
    id: 40, codigo: "PLAN-40", fecha_plan: "2026-09-30", hora_carga: "08:00:00", cliente: "Acme", placa: "C-100", piloto: "Juan Pérez", pilotoId: 10, pilotoTelefono: "5555-0001",
    pilotoExtraId: null, pilotoExtraNombre: null, pilotoExtraTelefono: null, auxiliares: ["Pedro Gómez"], auxiliaresDetalle: [{ personalId: 20, empleadoId: 200, nombre: "Pedro Gómez", telefono: "5555-0003" }],
    paradas: [], regreso_estimado: null, ...over,
  }) as unknown as Plan;

  it("con extra: destinatarios = principal (Piloto) + extra (Piloto, su propio teléfono) + auxiliares", () => {
    const d = destinatariosDelPlan(plan({ pilotoExtraId: 30, pilotoExtraNombre: "Carlos López", pilotoExtraTelefono: "5555-0002" }));
    expect(d.map((x) => [x.rol, x.nombre, x.telefono])).toEqual([["Piloto", "Juan Pérez", "5555-0001"], ["Piloto", "Carlos López", "5555-0002"], ["Auxiliar", "Pedro Gómez", "5555-0003"]]);
    expect(new Set(d.map((x) => x.clave)).size).toBe(3);
  });
  it("mensaje: 'Pilotos: Juan Pérez, Carlos López' con extra; 'Piloto: Juan Pérez' con uno (idéntico a antes)", () => {
    expect(mensajeAsignacion(plan({ pilotoExtraNombre: "Carlos López" }), "Carlos López", "https://x/portal")).toContain("Pilotos: Juan Pérez, Carlos López");
    const uno = mensajeAsignacion(plan(), "Juan Pérez", "https://x/portal");
    expect(uno).toContain("Piloto: Juan Pérez");
    expect(uno).not.toContain("Pilotos:");
  });
  it("sin extra el resultado es EXACTAMENTE el de siempre (2 destinatarios)", () => {
    expect(destinatariosDelPlan(plan()).map((x) => x.rol)).toEqual(["Piloto", "Auxiliar"]);
  });
});

describe("22) REPORTES / PDF / imagen / Excel: 'Principal / Extra'; sin extra, igual que antes", () => {
  const p = (extra: string | null) => ({ fechaPlan: "2026-09-30", codigo: "P1", cliente: "Acme", rutaCodigo: "R1", unidadTipo: null, placa: "C-1", piloto: "Juan Pérez", pilotoExtra: extra, auxiliares: [], horaSalida: null, horaLlegada: null,
    kmSalida: null, kmLlegada: null, kmRecorridos: null, evidencias: 0, tarifaNombre: null, tarifaComercial: null, estado: "Programado", tcPlaca: null, tcOrigen: null }) as never;
  it("historial de viajes (PDF): la columna Piloto combina ambos", () => {
    expect(filaOperativa(p("Carlos López"))[5]).toBe("Juan Pérez / Carlos López");
    expect(filaOperativa(p(null))[5]).toBe("Juan Pérez");
  });
  it("reporte diario: la celda Piloto combina ambos; sin extra igual que antes", () => {
    const v = (extra: string | null) => ({ fechaPlan: "2026-09-30", cliente: "Acme", unidadTipo: null, placa: "C-1", rutaCodigo: null, lugarDescargaHistorico: null, horaSalida: null, horaCarga: null, piloto: "Juan Pérez", pilotoExtra: extra, auxiliares: [], estado: "Programado", tarifaComercial: null });
    expect(filaReporteDiario(v("Carlos López") as never)[6]).toBe("Juan Pérez / Carlos López");
    expect(filaReporteDiario(v(null) as never)[6]).toBe("Juan Pérez");
  });
  it("Planes/Viajes, exportación Excel del filtro, PDF del viaje, imagen de Programación y listado TMS usan textoPilotos", () => {
    expect(src("src/app/api/empresas/[slug]/tms/reportes/viajes/export/route.ts")).toContain("textoPilotos(p.piloto, p.pilotoExtra) || \"—\"");
    const pdf = src("src/lib/tms/reporte-viaje-pdf.ts");
    expect(pdf).toContain('campo("Pilotos", textoPilotos(p.piloto, p.pilotoExtra))');
    expect(pdf).toContain('else campo("Piloto", p.piloto ?? "—")'); // sin extra: exactamente como antes
    const pv = src("src/app/e/[slug]/planes/planes-viajes-client.tsx");
    expect(pv).toContain("textoPilotos(p.piloto, p.pilotoExtra) || \"—\"");
    expect(pv).toContain('p.pilotoExtra ? "Pilotos" : "Piloto"');
    expect(src("src/app/e/[slug]/tms/page.tsx")).toContain("textoPilotos(p.piloto, p.pilotoExtraNombre) || \"—\"");
    expect(src("src/app/e/[slug]/programacion/programacion-client.tsx")).toContain(": textoPilotos(p.piloto, p.pilotoExtraNombre),"); // imagen de Programación
    expect(src("src/lib/tms/reportes-viajes.ts")).toContain("pilotoExtra: extraMap.get(id)?.nombre ?? null");
  });
  it("el reporte de viajes cuenta al extra al filtrar por piloto y lo lee en UNA consulta", () => {
    const f = src("src/lib/tms/reportes-viajes.ts");
    expect(f).toContain("x.personal_id = ?");
    expect(f).toContain("pilotoExtraDePlanes(planIds)");
  });
  it("las pantallas de Programación muestran 'Piloto extra' con su disponibilidad y el filtro por piloto lo incluye", () => {
    const c = src("src/app/e/[slug]/programacion/programacion-client.tsx");
    expect(c).toContain("Piloto extra</p>");
    expect(c).toContain("p.piloto !== fPiloto && p.pilotoExtraNombre !== fPiloto");
    expect(src("src/components/tms/viaticos-panel.tsx")).toContain('{pilotos.length > 1 ? "Pilotos" : "Piloto"}');
  });
});

describe("UI de Programación: '+ Agregar piloto extra' (máximo 1, solo Propio, solo RRHH)", () => {
  const f = src("src/app/e/[slug]/programacion/plan-form.tsx");
  it("el bloque vive DENTRO de la rama Propio y nunca en la de Tercerizado; no hay fila vacía permanente", () => {
    const extra = f.lastIndexOf("+ Agregar piloto extra");
    const propio = f.lastIndexOf('{form.tipoViaje === "Propio" ? (', extra);
    const terc = f.indexOf(") : (", propio);
    expect(propio).toBeGreaterThan(-1);
    expect(extra).toBeGreaterThan(propio);
    expect(extra).toBeLessThan(terc);
    expect(f).toContain("{form.mostrarPilotoExtra && (");
    expect(f).toContain("{!form.mostrarPilotoExtra && (");
    expect(f).toContain("mostrarPilotoExtra: Boolean(plan?.pilotoExtraNombre)");
  });
  it("reutiliza PilotoSelect en modo solo-catálogo (sin texto libre) con la misma disponibilidad; Quitar vuelve a un solo piloto", () => {
    expect(f).toContain('etiqueta="Piloto extra"');
    expect(f).toContain("soloCatalogo");
    expect(f).toContain("ocupados={ocupacionPersonal}");
    expect(f).toContain("setForm((f) => ({ ...f, mostrarPilotoExtra: false, pilotoExtraEmpleadoId: 0, pilotoExtraNombre: \"\" }))");
    expect(f).toContain("pilotosParaExtra = pilotos.filter((p) => p.id !== form.pilotoEmpleadoId && !form.auxiliarEmpleadoIds.includes(p.id))");
    expect(f).toContain("pilotosParaPrincipal = pilotos.filter((p) => !(form.mostrarPilotoExtra && p.id === form.pilotoExtraEmpleadoId))");
    const sel = src("src/components/tms/piloto-select.tsx");
    expect(sel).toContain("soloCatalogo?: boolean");
    expect(sel).toContain("no se acepta texto libre");
  });
  it("validación en UI: hay que elegir de RRHH o quitarlo, y nadie se repite (principal / extra / auxiliares)", () => {
    expect(f).toContain('setError("Selecciona el piloto extra de la lista de RRHH o quítalo.");');
    expect(f).toContain("hayPersonaDuplicada(form.pilotoEmpleadoId || null, form.pilotoExtraEmpleadoId, form.auxiliarEmpleadoIds)");
    expect(f).toContain("setError(MSG_PERSONA_DUPLICADA);");
  });
  it("en creación, el bloque 'Viáticos del viaje' incluye la fila del extra: rol Piloto y monto propio (nunca el del principal)", () => {
    expect(f).toContain('key: "piloto-extra"');
    const i = f.indexOf('key: "piloto-extra"');
    expect(f.slice(i, i + 300)).toContain('rol: "Piloto"');
    expect(f.indexOf('key: "piloto-extra"')).toBeGreaterThan(f.indexOf('key: "piloto",')); // justo después del principal
    expect(f).toContain('pilotoExtraEmpleadoId:\n              form.tipoViaje === "Propio" && form.mostrarPilotoExtra && form.pilotoExtraEmpleadoId ? form.pilotoExtraEmpleadoId : undefined,');
  });
  it("edición: cambiar/quitar el extra es cambio SENSIBLE (motivo); editar tarifa/notas no lo envía ni lo toca", () => {
    const base = { piloto: { empleadoId: 100, nombre: "Juan" }, placa: "C-1", auxiliares: [] };
    const conExtra = { ...base, pilotoExtra: { empleadoId: 200, nombre: "Carlos" } };
    expect(calcularCambioSensible(base, base)).toBe(false);
    expect(calcularCambioSensible(base, conExtra)).toBe(true); // asignar
    expect(calcularCambioSensible(conExtra, { ...base, pilotoExtra: null })).toBe(true); // quitar
    expect(calcularCambioSensible(conExtra, { ...base, pilotoExtra: { empleadoId: 201, nombre: "Otro" } })).toBe(true); // cambiar
    expect(calcularCambioSensible(conExtra, conExtra)).toBe(false); // sin cambio: no exige motivo
    const entrada = { bloqueadoParaPreCierre: false, cambioSensible: true, pilotoNombre: "Juan", placa: "C-1", auxiliarEmpleadoIds: [], auxiliarNombres: [], motivoCambioFinal: "Ruta larga" };
    expect(camposSensiblesPatch({ ...entrada, pilotoExtraCambio: true, pilotoExtraEmpleadoId: 200 }).pilotoExtraEmpleadoId).toBe(200);
    expect(camposSensiblesPatch({ ...entrada, pilotoExtraCambio: true, pilotoExtraEmpleadoId: null }).pilotoExtraEmpleadoId).toBeNull(); // quitar
    expect(camposSensiblesPatch({ ...entrada, pilotoExtraCambio: false, pilotoExtraEmpleadoId: 200 }).pilotoExtraEmpleadoId).toBeUndefined(); // otro cambio sensible: no toca el extra
    expect(camposSensiblesPatch({ ...entrada, cambioSensible: false, pilotoExtraCambio: true, pilotoExtraEmpleadoId: 200 }).pilotoExtraEmpleadoId).toBeUndefined(); // solo tarifa/notas: nada se envía
    expect(camposSensiblesPatch({ ...entrada, bloqueadoParaPreCierre: true, pilotoExtraCambio: true, pilotoExtraEmpleadoId: 200 }).pilotoExtraEmpleadoId).toBeUndefined();
  });
});

describe("importación: no borra ni rompe los extras (documentado)", () => {
  it("la importación solo crea el piloto principal y sincroniza viáticos con pilotoExtra: null en planes NUEVOS; no reescribe planes existentes", () => {
    const f = src("src/lib/tms/programacion-import.ts");
    expect(f).toContain("pilotoExtra: null, auxiliares: auxPersonalIds");
    expect(f).not.toContain("tms_plan_pilotos_adicionales");
  });
});

describe("migración SQL del piloto extra (solo se crea, NO se ejecuta)", () => {
  const m = sqlSinComentarios("sql/migrate-2026-09-tms-plan-pilotos-adicionales.sql");
  const pre = sqlSinComentarios("sql/preflight-2026-09-tms-plan-pilotos-adicionales.sql");
  it("tabla hermana de tms_plan_auxiliares con UNIQUE(plan_id, personal_id), índices y FKs por convención de tms_viaticos", () => {
    expect(m).toContain("CREATE TABLE IF NOT EXISTS tms_plan_pilotos_adicionales");
    for (const t of ["id INT AUTO_INCREMENT PRIMARY KEY", "empresa_id INT NOT NULL", "plan_id INT NOT NULL", "personal_id INT NOT NULL", "orden TINYINT NOT NULL DEFAULT 1",
      "UNIQUE KEY uq_tppa_plan_personal (plan_id, personal_id)", "INDEX idx_tppa_plan (plan_id)", "INDEX idx_tppa_empresa_plan (empresa_id, plan_id)",
      "FOREIGN KEY (empresa_id)  REFERENCES empresas(id)", "FOREIGN KEY (plan_id)     REFERENCES tms_planes_viaje(id) ON DELETE CASCADE", "FOREIGN KEY (personal_id) REFERENCES tms_personal(id)"]) expect(m).toContain(t);
    expect(m).toContain("ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
  });
  it("no toca tms_planes_viaje.piloto_id ni ninguna tabla existente: sin ALTER/DROP/DELETE/UPDATE/INSERT/TRUNCATE", () => {
    expect(m).not.toMatch(/\b(ALTER|DROP|UPDATE|INSERT|TRUNCATE)\b/i);
    expect(m).not.toMatch(/(?<!ON )DELETE\b/i); // solo aparece en "ON DELETE CASCADE" de las FK
    expect(m).not.toMatch(/piloto_id/);
  });
  it("el preflight es de solo lectura y revisa tablas de referencia, tipos de columna, motor y la tabla hermana", () => {
    expect(pre).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|DROP|TRUNCATE|CREATE|ALTER)\b/im);
    for (const t of ["tabla_nueva_existe", "information_schema.COLUMNS", "COLUMN_TYPE", "SHOW CREATE TABLE tms_plan_auxiliares"]) expect(pre).toContain(t);
  });
  it("el esquema usado por la app coincide con la migración (columnas que escribe/lee piloto-extra.ts)", () => {
    const lib = src("src/lib/tms/piloto-extra.ts");
    expect(lib).toContain("INSERT INTO tms_plan_pilotos_adicionales (empresa_id, plan_id, personal_id, orden)");
    expect(lib).toContain("DELETE FROM tms_plan_pilotos_adicionales WHERE plan_id = ? AND empresa_id = ?");
  });
});
