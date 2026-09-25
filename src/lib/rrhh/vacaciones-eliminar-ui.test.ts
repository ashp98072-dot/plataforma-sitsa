import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { PermisoModulo } from "@/lib/permisos-shared";
import {
  eliminarUnaVez,
  enviarEliminar,
  mensajeExito,
  puedeEliminarVacaciones,
  textoConfirmacion,
  tipoEliminable,
  urlEliminar,
} from "./vacaciones-eliminar-ui";

/** UI del botón Eliminar del historial de vacaciones: lógica pura + guardas del código fuente (sin @testing-library). */
const permiso = (p: Partial<PermisoModulo>): PermisoModulo[] =>
  [{ modulo: "vacaciones", puedeVer: false, puedeCrear: false, puedeEditar: false, puedeEliminar: false, ...p } as unknown as PermisoModulo];
const fila = { id: 501, emp_codigo: "E-12", emp_nombre: "Danis Mardoqueo Chub Choc", tipo: "Vacaciones", fecha_inicio: "2026-01-02", fecha_fin: "2026-01-03", dias_habiles: "2.00" };
const respuesta = (status: number, body: unknown) => vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }));
const page = readFileSync("src/app/e/[slug]/rrhh/vacaciones/page.tsx", "utf8").replace(/\r\n/g, "\n");

describe("Vacaciones — botón Eliminar (UI)", () => {
  it("20) visible con vacaciones:eliminar (y para Admin)", () => {
    expect(puedeEliminarVacaciones("RRHH", permiso({ puedeEliminar: true }))).toBe(true);
    expect(puedeEliminarVacaciones("Admin", [])).toBe(true);
  });

  it("21) oculto sin permiso (ver/crear/editar no bastan)", () => {
    expect(puedeEliminarVacaciones("RRHH", permiso({ puedeVer: true, puedeCrear: true, puedeEditar: true }))).toBe(false);
    expect(puedeEliminarVacaciones("RRHH", [])).toBe(false);
    expect(page).toContain("{puedeEliminar ? <th");
    expect(page).toContain("{puedeEliminar ? (\n                  <td");
  });

  it("22) la confirmación muestra empleado, fecha y días; el texto cambia según descuente saldo", () => {
    const t = textoConfirmacion(fila);
    expect(t).toMatchObject({ titulo: "Eliminar registro de vacaciones", empleado: "E-12 — Danis Mardoqueo Chub Choc", periodo: "02/01/2026 → 03/01/2026", dias: "2.00" });
    expect(t.aviso).toBe("Este registro será eliminado y los días consumidos serán devueltos al saldo del colaborador.");
    expect(t.botonConfirmar).toBe("Eliminar y devolver días");
    const sin = textoConfirmacion({ ...fila, tipo: "Permiso con goce" });
    expect(sin.aviso).toBe("Este registro será eliminado.");
    expect(sin.botonConfirmar).toBe("Eliminar");
  });

  it("23) Cancelar no hace request: el botón solo cierra el diálogo", () => {
    const cancelar = page.slice(page.indexOf(">\n                    Cancelar"), page.indexOf(">\n                    Cancelar") + 5);
    expect(cancelar).toBeTruthy();
    expect(page).toContain("onClick={() => setPorEliminar(null)}");
    // el único fetch de DELETE vive en confirmarEliminar (vía eliminarUnaVez)
    expect(page.match(/eliminarUnaVez\(/g)).toHaveLength(1);
    expect(page).not.toMatch(/method: "DELETE"/);
  });

  it("24) confirmar hace DELETE exacto por id", async () => {
    const f = respuesta(200, { ok: true, diasRestaurados: 2, empleadoId: 7 });
    await enviarEliminar(f, "sitsa", 501);
    expect(f).toHaveBeenCalledTimes(1);
    expect(f).toHaveBeenCalledWith("/api/empresas/sitsa/rrhh/vacaciones/501", { method: "DELETE" });
    expect(urlEliminar("sitsa", 501)).toBe("/api/empresas/sitsa/rrhh/vacaciones/501");
  });

  it("25) éxito recarga historial + saldo + períodos (cargar) y cierra el diálogo", () => {
    const fn = page.slice(page.indexOf("async function confirmarEliminar()"), page.indexOf("const usaSaldo ="));
    expect(fn).toContain("setPorEliminar(null)");
    expect(fn).toContain("await cargar()");
    expect(page).toContain("setSaldo(v.saldo ?? null);");
    expect(page).toContain("setPeriodos(v.periodos ?? []);");
  });

  it("26) el mensaje verde muestra los días restaurados", async () => {
    expect(mensajeExito(2)).toBe("Registro eliminado. Se restauraron 2 día(s) al saldo.");
    expect(mensajeExito(0, false)).toBe("Registro eliminado.");
    const r = await enviarEliminar(respuesta(200, { ok: true, diasRestaurados: 2, empleadoId: 7 }), "s", 1);
    expect(r).toMatchObject({ tipo: "ok", mensaje: "Registro eliminado. Se restauraron 2 día(s) al saldo.", diasRestaurados: 2 });
    expect(page).toContain("setMsg(r.mensaje");
  });

  it("27) un error conserva la fila: no se cierra el diálogo, no se recarga y se muestra el error", async () => {
    for (const [status, body] of [[409, { error: "Este registro tiene evidencias adjuntas. Elimínalas primero." }], [500, { error: "No se pudo eliminar el registro. No se modificó nada." }]] as const) {
      const r = await enviarEliminar(respuesta(status, body), "s", 1);
      expect(r).toEqual({ tipo: "error", error: body.error, status });
    }
    expect((await enviarEliminar(vi.fn(async () => { throw new Error("red"); }), "s", 1)).tipo).toBe("error");
    const fn = page.slice(page.indexOf("async function confirmarEliminar()"), page.indexOf("const usaSaldo ="));
    const rama = fn.slice(fn.indexOf('if (r.tipo === "error")'), fn.indexOf("setPorEliminar(null)"));
    expect(rama).toContain("setErrorEliminar(r.error)");
    expect(rama).toContain("return;");
    expect(rama).not.toContain("cargar");
  });

  it("28) doble clic rápido / loading: solo se manda UN DELETE", async () => {
    let liberar!: () => void;
    const f = vi.fn(() => new Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>((res) => { liberar = () => res({ ok: true, status: 200, json: async () => ({ ok: true, diasRestaurados: 2 }) }); }));
    const candado = { current: false };
    const a = eliminarUnaVez(candado, f, "s", 501);
    const b = eliminarUnaVez(candado, f, "s", 501); // segundo clic mientras el primero sigue en curso
    expect(await b).toBeNull();
    liberar();
    expect((await a)?.tipo).toBe("ok");
    expect(f).toHaveBeenCalledTimes(1);
    expect(candado.current).toBe(false); // se libera al terminar
    expect(page).toContain("disabled={eliminando}");
    expect(page).toContain('{eliminando ? "Eliminando…" : t.botonConfirmar}');
  });

  it("solo los tipos que esta pantalla crea muestran el botón", () => {
    for (const t of ["Vacaciones", "A cuenta de Vacaciones", "Permiso con goce", "Permiso sin goce", "IGSS", "Médico"]) expect(tipoEliminable(t)).toBe(true);
    expect(tipoEliminable("Falta injustificada")).toBe(false);
  });
});
