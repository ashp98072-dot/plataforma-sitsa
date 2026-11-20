/**
 * ALCANCE de la política de copia fiel: «ignorar la disponibilidad del destino» y «ventana incompleta = aviso» aplican
 * EXCLUSIVAMENTE al flujo Copiar programación (programacion-lote). La programación ordinaria (alta/edición de plan,
 * importación, edición rápida, TC) sigue BLOQUEANDO por disponibilidad. Estas pruebas fijan esa frontera:
 *  1. el primitivo compartido sigue devolviendo el conflicto (no existe ningún modo «ignorar»);
 *  2. ningún módulo ordinario importa el motor de copia ni sus avisos;
 *  3. cada llamador ordinario sigue convirtiendo el conflicto en rechazo.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
import { query } from "@/lib/db";
import { ESTADOS_ASIGNACION_DIARIA } from "./disponibilidad-programacion-dia";
import { primerConflictoProgramacionIntervalo } from "./disponibilidad-programacion-intervalos";

const RAIZ = join(__dirname, "..", "..", "..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");

const ORDINARIOS = [
  "src/app/api/empresas/[slug]/tms/planes/route.ts",
  "src/lib/tms/programacion-import.ts",
  "src/lib/tms/edicion-rapida-validar.ts",
  "src/lib/tms/tc-plan.ts",
  "src/lib/tms/disponibilidad-programacion-intervalos.ts",
  "src/lib/tms/disponibilidad-programacion-dia.ts",
];

describe("copia fiel: el primitivo compartido de disponibilidad NO se relaja", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(query).mockImplementation(async (sql, params) => {
      const t = String(sql);
      if (!t.includes("FROM tms_personal tp")) return [] as never;
      const v = params as unknown[];
      return [{
        categoria: "personal", recurso_id: 10, nombre: "Juan Pérez", plan_id: 9, codigo: "PLAN-9", empresa_id: Number(v[0]),
        estado: ESTADOS_ASIGNACION_DIARIA[0], fecha_plan: "2026-11-20", hora_carga: "08:00:00", regreso_estimado: "2026-11-20 12:00:00",
      }] as never;
    });
  });

  it("un recurso ocupado en una ventana que se traslapa SIGUE devolviendo conflicto (programación ordinaria bloquea)", async () => {
    const c = await primerConflictoProgramacionIntervalo(7, [{ tipo: "piloto", id: 10 }], { fechaPlan: "2026-11-20", horaCarga: "09:00", regresoEstimado: "2026-11-20 10:00" }, []);
    expect(c).toMatchObject({ planIdConflicto: 9 });
  });

  it("sin hora/regreso reserva todo el día y SIGUE chocando con el viaje existente", async () => {
    const c = await primerConflictoProgramacionIntervalo(7, [{ tipo: "piloto", id: 10 }], { fechaPlan: "2026-11-20", horaCarga: null, regresoEstimado: null }, []);
    expect(c).not.toBeNull();
  });

  it("la firma no admite un modo «ignorar»: (empresa, recursos, ventana, excluir, conn?)", () => {
    expect(primerConflictoProgramacionIntervalo.length).toBeLessThanOrEqual(5);
  });
});

describe("copia fiel: la política vive solo en el motor de copia", () => {
  it.each(ORDINARIOS)("%s no importa el motor de copia ni sus avisos", (rel) => {
    const src = leer(rel);
    expect(src).not.toMatch(/programacion-lote/);
    expect(src).not.toMatch(/programacion-copia-avisos/);
    expect(src).not.toMatch(/destino_ocupado|ventana_incompleta|avisosAceptados/);
  });

  it("el motor de copia es el ÚNICO que degrada el conflicto de destino a aviso", () => {
    const lote = leer("src/lib/tms/programacion-lote.ts");
    expect(lote).toMatch(/tipo: "destino_ocupado"/);
  });

  it.each([
    ["src/app/api/empresas/[slug]/tms/planes/route.ts", /if \(conflicto\) \{\s*return NextResponse\.json\(\{ error: mensajeConflictoProgramacionIntervalo\(conflicto\) \}, \{ status: 409 \}\);/],
    ["src/app/api/empresas/[slug]/tms/planes/route.ts", /if \(conflicto\) throw new CuadrillaError\(mensajeConflictoProgramacionIntervalo\(conflicto\), 409\)/],
  ])("%s mantiene el rechazo 409 por conflicto", (rel, patron) => {
    expect(leer(rel)).toMatch(patron);
  });

  it.each(["src/lib/tms/programacion-import.ts", "src/lib/tms/edicion-rapida-validar.ts"])(
    "%s sigue usando el primitivo de disponibilidad y convirtiendo el conflicto en error",
    (rel) => {
      const src = leer(rel);
      expect(src).toMatch(/primerConflictoProgramacionIntervalo/);
      expect(src).toMatch(/mensajeConflictoProgramacionIntervalo|conflicto/);
    },
  );
});
