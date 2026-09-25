import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  analizarArchivo, cantidadAImportar, formatoTamano, importarArchivo, nombrePlantilla, puedeImportar, resumenAnalisis, textoConfirmacionImportacion, textoExito,
  TEXTO_PASO_PLANTILLA, urlImportar, urlPlantilla, type FilaAnalisis, type ResultadoAnalisis,
} from "./fiscal-importacion-ui";
import { unaSolaVez } from "./fiscal-migracion-ui";

/** Modal "Importar acumulados fiscales": lógica pura + guardas del código (no hay harness de componentes). */
const src = readFileSync("src/components/rrhh/importar-acumulados-fiscales-modal.tsx", "utf8").replace(/\r\n/g, "\n");
const ficha = readFileSync("src/app/e/[slug]/rrhh/empleados/page.tsx", "utf8").replace(/\r\n/g, "\n");
const fila = (n: number, estado: FilaAnalisis["estado"] = "VALIDA", mensajes: string[] = []): FilaAnalisis => ({
  numeroFila: n, empleadoId: n, codigo: `E${n}`, dpi: "", nombre: `Emp ${n}`, ejercicio: 2026, fechaCorte: "2026-09-15", gravado: "45000.00", exento: "2000.00", igss: "2173.50", isr: "1250.00",
  referencia: "Sistema anterior", observaciones: "", estado, mensajes,
});
const respuesta = (status: number, body: unknown) => vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }));
const archivo = new Blob(["x"]);

describe("UI — importar acumulados fiscales", () => {
  it("47) la descarga de plantilla apunta al endpoint con el ejercicio y el nombre sugerido", () => {
    expect(urlPlantilla("sitsa", 2026)).toBe("/api/empresas/sitsa/rrhh/fiscal/acumulados/plantilla?ejercicio=2026");
    expect(nombrePlantilla(2026)).toBe("Acumulados_Fiscales_Migracion_2026.xlsx");
    expect(src).toContain("Descargar plantilla");
    expect(src).toContain("href={urlPlantilla(slug, ejercicio)}");
    expect(src).toContain("{TEXTO_PASO_PLANTILLA}");
    expect(TEXTO_PASO_PLANTILLA).toBe("Usa los acumulados del sistema anterior hasta el último día incluido en el corte. No incluyas planillas que ya fueron procesadas en este sistema.");
  });
  it("48) seleccionar archivo: solo .xlsx y máximo 5 MB; muestra nombre y tamaño", () => {
    expect(src).toContain('accept=".xlsx"');
    expect(src).toContain("Solo se aceptan archivos .xlsx.");
    expect(src).toContain("El archivo excede el tamaño máximo de 5 MB.");
    expect(src).toContain("{archivo.name} · {formatoTamano(archivo.size)}");
    expect(formatoTamano(2048)).toBe("2 KB");
    expect(formatoTamano(3 * 1024 * 1024)).toBe("3.0 MB");
  });
  it("49) analizar envía el archivo con modo=analizar (dry-run) al endpoint", async () => {
    const f = respuesta(200, { analisis: resumenAnalisis([fila(2)]) });
    const r = await analizarArchivo(f, "sitsa", archivo, "a.xlsx");
    expect(r.tipo).toBe("ok");
    const [url, init] = f.mock.calls[0] as unknown as [string, { method: string; body: FormData }];
    expect(url).toBe(urlImportar("sitsa"));
    expect(init.method).toBe("POST");
    expect(init.body.get("modo")).toBe("analizar");
    expect((init.body.get("file") as File).name).toBe("a.xlsx");
  });
  it("50) el resumen cuenta filas, válidas, advertencias y errores", () => {
    const r = resumenAnalisis([fila(2), fila(3), fila(4, "ADVERTENCIA", ["aviso"]), fila(5, "ERROR", ["mal"])], 7);
    expect(r).toMatchObject({ totalFilas: 4, validas: 2, advertencias: 1, errores: 1, omitidasSinDatos: 7 });
    expect(src).toContain("Total filas:");
    expect(src).toContain("Con advertencias:");
    expect(src).toContain("Con errores:");
    for (const h of ["Fila", "Empleado", "Corte", "Gravado", "Exento", "IGSS", "ISR", "Estado"]) expect(src).toContain(`"${h}"`);
  });
  it("51) los errores son visibles y se pueden expandir por fila", () => {
    expect(src).toContain("aria-expanded={abiertas.has(f.numeroFila)}");
    expect(src).toContain("`Ver ${f.mensajes.length} mensaje(s)`");
    expect(src).toContain("{f.mensajes.map((m, i) => <li key={i}>{m}</li>)}");
    expect(src).toContain("Hay filas con error: corrige el Excel y vuelve a subirlo.");
  });
  it("52) el botón Importar se deshabilita con errores (las advertencias permiten continuar) o sin filas importables", () => {
    expect(puedeImportar(resumenAnalisis([fila(2), fila(3, "ERROR", ["x"])]))).toBe(false);
    expect(puedeImportar(resumenAnalisis([fila(2), fila(3, "ADVERTENCIA", ["aviso"])]))).toBe(true);
    expect(puedeImportar(resumenAnalisis([]))).toBe(false);
    expect(puedeImportar(null)).toBe(false);
    expect(src).toContain("disabled={!puedeImportar(analisis) || ocupado}");
    expect(src).toContain("Importar y guardar como borradores");
  });
  it("53) confirmación previa con el conteo y aviso de que no se confirma automáticamente", () => {
    expect(textoConfirmacionImportacion(92)).toBe("Se crearán 92 borradores de acumulado fiscal inicial. Ninguno quedará confirmado automáticamente. ¿Deseas continuar?");
    expect(cantidadAImportar(resumenAnalisis([fila(2), fila(3, "ADVERTENCIA", ["a"])]))).toBe(2);
    expect(src).toContain("onClick={() => setConfirmando(true)}");
    expect(src).toContain("Importar ${n} borradores");
    expect(src).toContain("Cancelar");
    // el botón que ejecuta solo existe DENTRO del diálogo de confirmación
    expect(src.indexOf("void importar()")).toBeGreaterThan(src.indexOf("{confirmando && analisis ? ("));
  });
  it("54) mensaje de éxito y refresco (no confirma nada; pide revisar y confirmar)", async () => {
    expect(textoExito(92)).toBe("Se importaron 92 borradores. Debes revisar y confirmar los acumulados fiscales antes de generar planillas que dependan de ellos.");
    const f = respuesta(201, { importados: 92 });
    expect(await importarArchivo(f, "sitsa", archivo, "a.xlsx")).toEqual({ tipo: "ok", importados: 92 });
    expect(((f.mock.calls[0] as unknown as [string, { body: FormData }])[1]).body.get("modo")).toBe("importar");
    expect(src).toContain("setExito(textoExito(r.importados));");
    expect(src).not.toMatch(/Confirmar todos/i); // NO hay confirmación masiva en este PR
  });
  it("55) loading: el candado evita el doble submit (un solo request aunque se pulse dos veces)", async () => {
    let liberar!: () => void;
    const f = vi.fn(() => new Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>((res) => { liberar = () => res({ ok: true, status: 201, json: async () => ({ importados: 3 }) }); }));
    const candado = { current: false };
    const a = unaSolaVez(candado, () => importarArchivo(f, "s", archivo, "a.xlsx"));
    const b = unaSolaVez(candado, () => importarArchivo(f, "s", archivo, "a.xlsx"));
    expect(await b).toBeNull();
    liberar();
    expect((await a)?.tipo).toBe("ok");
    expect(f).toHaveBeenCalledTimes(1);
    expect(src).toContain("unaSolaVez(candado");
    expect(src).toContain('{ocupado ? "Importando…" : `Importar ${n} borradores`}');
  });
  it("56) un error del servidor conserva la vista previa (y muestra su mensaje)", async () => {
    const analisis: ResultadoAnalisis = resumenAnalisis([fila(2, "ERROR", ["El empleado ya tiene una revisión fiscal confirmada para este ejercicio."])]);
    const r = await importarArchivo(respuesta(422, { error: "El archivo tiene errores.", analisis }), "s", archivo, "a.xlsx");
    expect(r).toMatchObject({ tipo: "error", error: "El archivo tiene errores.", analisis: { errores: 1 } });
    const fn = src.slice(src.indexOf("async function importar()"), src.indexOf("const n = analisis"));
    expect(fn).toContain('if (r.tipo === "error") { setError(r.error); if (r.analisis) setAnalisis(r.analisis); return; }');
    expect(fn.slice(fn.indexOf('r.tipo === "error"'), fn.indexOf("setAnalisis(null)"))).not.toContain("setAnalisis(null)");
    expect((await importarArchivo(vi.fn(async () => { throw new Error("red"); }), "s", archivo, "a.xlsx")).tipo).toBe("error");
    expect((await analizarArchivo(respuesta(400, { error: "no es xlsx" }), "s", archivo, "a.xlsx"))).toEqual({ tipo: "error", error: "no es xlsx" });
  });
  it("la acción vive en RRHH > Empleados y solo se ofrece con permiso de captura fiscal (configuracion:crear)", () => {
    expect(ficha).toContain("Importar acumulados fiscales");
    expect(ficha).toContain("permisosFiscal(rolSesion, permisosSesion).puedeCapturar ? (");
    expect(ficha).toContain("<ImportarAcumuladosFiscalesModal slug={slug}");
  });
});
