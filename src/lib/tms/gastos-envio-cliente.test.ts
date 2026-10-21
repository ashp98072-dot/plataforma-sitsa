import { describe, expect, it, vi } from "vitest";
import { crearGuardEnvio } from "@/lib/idempotencia/clave-envio";
import { enviarGasto, type FetchGasto } from "./gastos-envio-cliente";

const CLAVE = "3f2a9c1e-7b64-4d0a-9e51-2c8f6a1b0d33";
const PAYLOAD = { fechaSolicitud: "2026-10-01", categoria: "Combustible", monto: 450 };
const ARCHIVO = new File([new Uint8Array([1, 2, 3])], "factura.pdf", { type: "application/pdf" });

const resp = (status: number, data: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => data });

/** Servidor simulado: POST /gastos es idempotente por clave (misma clave → mismo gasto); el comprobante falla N veces. */
function servidor(opts: { fallosComprobante: number }) {
  const gastos = new Map<string, number>();
  let siguienteId = 55;
  let fallos = opts.fallosComprobante;
  const llamadas: { url: string; metodo: string; cuerpo?: Record<string, unknown> }[] = [];
  const fetchFn: FetchGasto = vi.fn(async (url, init) => {
    const metodo = init?.method ?? "GET";
    const cuerpo = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    llamadas.push({ url, metodo, cuerpo });
    if (url.endsWith("/comprobante")) {
      if (fallos > 0) { fallos -= 1; return resp(500, { error: "No se pudo guardar el comprobante." }); }
      return resp(200, { mensaje: "Comprobante adjuntado." });
    }
    if (metodo === "POST") {
      const clave = String(cuerpo?.claveIdempotencia ?? "");
      let id = gastos.get(clave);
      if (id === undefined) { id = siguienteId++; if (clave) gastos.set(clave, id); }
      return resp(200, { mensaje: "Gasto registrado.", gasto: { id } });
    }
    return resp(200, { mensaje: "Gasto actualizado." });
  });
  return { fetchFn, llamadas, gastos };
}

describe("enviarGasto — creación + comprobante", () => {
  it("crea con la clave y sube el comprobante al id devuelto", async () => {
    const { fetchFn, llamadas } = servidor({ fallosComprobante: 0 });
    const r = await enviarGasto({ fetchFn, slug: "kt", editandoId: null, payload: PAYLOAD, claveIdempotencia: CLAVE, comprobante: ARCHIVO });
    expect(r).toMatchObject({ fase: "completo", ok: true, gastoId: 55 });
    expect(llamadas[0]).toMatchObject({ url: "/api/empresas/kt/tms/gastos", metodo: "POST" });
    expect(llamadas[0].cuerpo).toMatchObject({ ...PAYLOAD, claveIdempotencia: CLAVE });
    expect(llamadas[1]).toMatchObject({ url: "/api/empresas/kt/tms/gastos/55/comprobante", metodo: "POST" });
  });

  it("CASO CRÍTICO: POST exitoso → falla el comprobante → reintento con la MISMA clave → mismo gasto, NO crea otro, y sube el comprobante a ese id", async () => {
    const { fetchFn, llamadas, gastos } = servidor({ fallosComprobante: 1 });

    const primero = await enviarGasto({ fetchFn, slug: "kt", editandoId: null, payload: PAYLOAD, claveIdempotencia: CLAVE, comprobante: ARCHIVO });
    expect(primero).toMatchObject({ fase: "comprobante", ok: false, gastoId: 55 });

    const reintento = await enviarGasto({ fetchFn, slug: "kt", editandoId: null, payload: PAYLOAD, claveIdempotencia: CLAVE, comprobante: ARCHIVO });
    expect(reintento).toMatchObject({ fase: "completo", ok: true, gastoId: 55 });

    expect(gastos.size).toBe(1);
    const posts = llamadas.filter((l) => l.url === "/api/empresas/kt/tms/gastos");
    expect(posts).toHaveLength(2);
    expect(posts.every((p) => p.cuerpo?.claveIdempotencia === CLAVE)).toBe(true);
    const subidas = llamadas.filter((l) => l.url.endsWith("/comprobante"));
    expect(subidas.map((s) => s.url)).toEqual([
      "/api/empresas/kt/tms/gastos/55/comprobante",
      "/api/empresas/kt/tms/gastos/55/comprobante",
    ]);
  });

  it("un fallo del POST (400/409) no sube comprobante y devuelve status y cuerpo", async () => {
    const fetchFn: FetchGasto = vi.fn(async () => resp(409, { error: "Esta operación ya se registró con datos distintos…" }));
    const r = await enviarGasto({ fetchFn, slug: "kt", editandoId: null, payload: PAYLOAD, claveIdempotencia: CLAVE, comprobante: ARCHIVO });
    expect(r).toMatchObject({ fase: "crear", ok: false, status: 409 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("sin comprobante, termina tras el POST", async () => {
    const { fetchFn, llamadas } = servidor({ fallosComprobante: 0 });
    const r = await enviarGasto({ fetchFn, slug: "kt", editandoId: null, payload: PAYLOAD, claveIdempotencia: CLAVE, comprobante: null });
    expect(r).toMatchObject({ fase: "completo", ok: true, gastoId: 55 });
    expect(llamadas).toHaveLength(1);
  });

  it("edición: PATCH al id, SIN clave de envío, y comprobante al mismo id", async () => {
    const { fetchFn, llamadas } = servidor({ fallosComprobante: 0 });
    const r = await enviarGasto({ fetchFn, slug: "kt", editandoId: 12, payload: PAYLOAD, claveIdempotencia: "", comprobante: ARCHIVO });
    expect(r).toMatchObject({ fase: "completo", ok: true, gastoId: 12 });
    expect(llamadas[0]).toMatchObject({ url: "/api/empresas/kt/tms/gastos/12", metodo: "PATCH" });
    expect(llamadas[0].cuerpo).not.toHaveProperty("claveIdempotencia");
    expect(llamadas[1].url).toBe("/api/empresas/kt/tms/gastos/12/comprobante");
  });
});

describe("Guardar con guard de envío único", () => {
  it("dos clics seguidos producen UN solo POST; tras un error de red el botón queda libre y el reintento reutiliza la clave", async () => {
    const guard = crearGuardEnvio();
    let falla = true;
    const llamadas: string[] = [];
    const fetchFn: FetchGasto = vi.fn(async (_url, init) => {
      llamadas.push(String((JSON.parse(String(init?.body)) as { claveIdempotencia?: string }).claveIdempotencia));
      await Promise.resolve();
      if (falla) throw new Error("Failed to fetch");
      return resp(200, { mensaje: "ok", gasto: { id: 1 } });
    });
    const guardar = () => guard.ejecutar(() => enviarGasto({ fetchFn, slug: "kt", editandoId: null, payload: PAYLOAD, claveIdempotencia: CLAVE, comprobante: null }));

    const [a, b] = await Promise.allSettled([guardar(), guardar()]);
    expect(a.status).toBe("rejected"); // la primera falló por red…
    expect(b).toMatchObject({ status: "fulfilled", value: { omitido: true } }); // …y la segunda nunca disparó un segundo POST
    expect(fetchFn).toHaveBeenCalledTimes(1);

    falla = false;
    const reintento = await guardar();
    expect(reintento).toMatchObject({ omitido: false, valor: { fase: "completo", ok: true } });
    expect(llamadas).toEqual([CLAVE, CLAVE]);
  });
});
