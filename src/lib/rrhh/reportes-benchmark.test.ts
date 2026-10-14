// Manual: $env:RRHH_REPORTES_BENCH='1'; npx vitest run src/lib/rrhh/reportes-benchmark.test.ts
// Ejecutar este MISMO archivo en BASE y HEAD. Nunca abre conexiones reales.
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ n: 104, mezcla: false, queries: 0 }));
vi.mock("@/lib/db", () => ({
  query: async (sql: string) => {
    m.queries++;
    if (sql.includes("FROM empleados WHERE")) return Array.from({ length: m.n }, (_, i) => ({
      id: i + 1, codigo: `E${i}`, nombre: `Empleado ${i}`, fecha_alta: "2020-01-01",
      hora_entrada_teorica: "08:00:00", hora_salida_teorica: "17:00:00",
      tipo_horario: m.mezcla && i % 2 === 0 ? "Variable" : "Fijo",
    }));
    if (sql.includes("configuracion")) return [{ valor: "0" }];
    return [];
  },
  execute: () => { throw new Error("Escritura no permitida en benchmark"); },
  getPool: () => { throw new Error("Sin BD real"); },
}));
import { obtenerReporteAsistencias } from "./reportes";

it.skipIf(process.env.RRHH_REPORTES_BENCH !== "1")("medianas de cinco ejecuciones: matriz sintética RRHH", async () => {
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  for (const caso of [
    { n: 104, mezcla: true, horario: "Variable" },
    { n: 1000, mezcla: true, horario: "Variable" },
    { n: 1000, mezcla: false, horario: "Variable" },
    { n: 1000, mezcla: true, horario: "Todos" },
  ]) {
    Object.assign(m, caso);
    const run = () => obtenerReporteAsistencias(7, "2026-01-01", "2026-12-31", { horario: caso.horario });
    await run(); // Calentar módulos, JIT y caché de configuración.
    let construidas = 0;
    const push = Array.prototype.push;
    Array.prototype.push = function (this: unknown[], ...items: unknown[]) {
      for (const item of items) if (item && typeof item === "object" && "fechaUi" in item && "tipoHorario" in item) construidas++;
      return push.apply(this, items);
    };
    try { await run(); } finally { Array.prototype.push = push; }
    const generacion: number[] = [], serializacion: number[] = [];
    let bytes = 0, filas = 0, hash = "", queries = 0;
    for (let vuelta = 0; vuelta < 5; vuelta++) {
      m.queries = 0;
      const t = performance.now();
      const resultado = await run();
      generacion.push(performance.now() - t);
      queries = m.queries;
      const s = performance.now();
      const json = JSON.stringify(resultado);
      serializacion.push(performance.now() - s);
      bytes = Buffer.byteLength(json);
      filas = resultado.length;
      hash = createHash("sha256").update(json).digest("hex");
    }
    expect(filas).toBe(caso.horario === "Todos" ? caso.n * 313 : caso.mezcla ? caso.n / 2 * 313 : 0);
    process.stdout.write(`RRHH_BENCH ${JSON.stringify({ ...caso, construidas, filas, bytes, queries, generacionMs: median(generacion), serializacionMs: median(serializacion), hash })}\n`);
  }
}, 60000);
