import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  esPatchDeEdicion, exigeVehiculoSolicitadoAlEditar, MSG_VEHICULO_SOLICITADO_OBLIGATORIO, vehiculoEfectivoTrasPatch,
} from "./vehiculo-solicitado";
import { respuestaVehiculoSolicitadoObligatorio } from "./validacion-programacion";

describe("vehículo solicitado obligatorio — reglas puras", () => {
  it("mensaje único", () => expect(MSG_VEHICULO_SOLICITADO_OBLIGATORIO).toBe("Selecciona el vehículo solicitado por el cliente."));

  it("solo se exige al editar donde el campo es EDITABLE (no en Cerrado/Cancelado ni En ruta sin llegada)", () => {
    for (const e of ["Programado", "Cargado"]) expect(exigeVehiculoSolicitadoAlEditar(e, false)).toBe(true);
    expect(exigeVehiculoSolicitadoAlEditar("En ruta", true)).toBe(true); // pendiente de cierre: el campo sí se edita
    expect(exigeVehiculoSolicitadoAlEditar("En ruta", false)).toBe(false);
    for (const e of ["Cerrado", "Cancelado"]) expect(exigeVehiculoSolicitadoAlEditar(e, false)).toBe(false);
  });

  it("una transición de estado (Cargado) o un cancelar NO es una edición de datos", () => {
    expect(esPatchDeEdicion({ id: 1, estado: "Cargado" })).toBe(false);
    expect(esPatchDeEdicion({ id: 1, estado: "Cancelado", notas: "x" })).toBe(false);
    expect(esPatchDeEdicion({ id: 1, estado: "Cargado", motivoCambio: "m" })).toBe(false);
    expect(esPatchDeEdicion({ id: 1, notas: "x" })).toBe(true);
    expect(esPatchDeEdicion({ id: 1, tarifaComercial: 10, estado: undefined })).toBe(true);
    expect(esPatchDeEdicion({ id: 1, estado: undefined, notas: undefined })).toBe(false);
  });

  it("vehículo efectivo: lo que trae el PATCH (null lo quita) o, si no lo toca, el guardado", () => {
    expect(vehiculoEfectivoTrasPatch(undefined, 11)).toBe(11);
    expect(vehiculoEfectivoTrasPatch(undefined, null)).toBeNull();
    expect(vehiculoEfectivoTrasPatch(12, null)).toBe(12);
    expect(vehiculoEfectivoTrasPatch(null, 11)).toBeNull();
  });

  it("la respuesta de falta de vehículo es 400 con error de campo (mismo formato que el resto de Programación)", async () => {
    const r = respuestaVehiculoSolicitadoObligatorio();
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({
      error: "Selecciona el vehículo solicitado por el cliente.",
      errores: [{ campo: "vehiculoSolicitadoPerfilId", etiqueta: "Vehículo solicitado", mensaje: "selecciona el vehículo solicitado por el cliente." }],
    });
  });
});

describe("plan-form: validación del frontend (no depende solo del atributo required)", () => {
  const src = readFileSync("src/app/e/[slug]/programacion/plan-form.tsx", "utf8");
  it("ya no ofrece «Sin especificar»; el selector es required, marca aria-invalid y muestra el error junto al campo", () => {
    expect(src).not.toContain("Sin especificar");
    expect(src).toContain("— Selecciona el vehículo solicitado —");
    expect(src).toMatch(/<select[^>]*[\s\S]{0,400}required[\s\S]{0,300}aria-invalid/);
    expect(src).toContain('id="error-vehiculo-solicitado" role="alert"');
  });
  it("onSubmit rechaza ANTES de enviar (creación siempre; edición solo si el campo es editable) y enfoca el campo", () => {
    const i = src.indexOf("async function onSubmit");
    const cuerpo = src.slice(i, i + 2500);
    expect(cuerpo).toContain("const exigeVehiculo = !esEdicion || exigeVehiculoSolicitadoAlEditar(plan!.estado, pendienteCierre);");
    expect(cuerpo).toContain("if (exigeVehiculo && !(form.vehiculoSolicitadoPerfilId > 0))");
    expect(cuerpo).toContain("vehiculoRef.current?.focus()");
    expect(cuerpo.indexOf("exigeVehiculo")).toBeLessThan(cuerpo.indexOf("setSaving(true)") === -1 ? Infinity : cuerpo.indexOf("setSaving(true)"));
  });
  it("el POST envía el id elegido (Propio y Tercerizado) y el PATCH solo lo envía si cambió", () => {
    expect(src).toContain("vehiculoSolicitadoPerfilId: form.vehiculoSolicitadoPerfilId,");
    expect(src).toContain("cambioVehiculoSolicitado(plan?.vehiculo_solicitado_perfil_id, form.vehiculoSolicitadoPerfilId)");
  });
  it("un histórico sin dato se puede abrir: se avisa y se exige elegir solo al guardar", () => {
    expect(src).toContain("selecciónalo para poder guardar cambios");
  });
});

describe("backend: todos los caminos que crean/modifican viajes", () => {
  const ruta = readFileSync("src/app/api/empresas/[slug]/tms/planes/route.ts", "utf8");
  it("POST exige el vehículo antes de cualquier regla y valida el perfil contra la empresa de la sesión", () => {
    const i = ruta.indexOf("export async function POST");
    const post = ruta.slice(i, i + 3500);
    expect(post).toContain("if (d.vehiculoSolicitadoPerfilId == null) return respuestaVehiculoSolicitadoObligatorio();");
    expect(post.indexOf("respuestaVehiculoSolicitadoObligatorio")).toBeLessThan(post.indexOf("salidaProgramada"));
    expect(post).toContain("resolverVehiculoSolicitado(empresaId, d.vehiculoSolicitadoPerfilId)");
  });
  it("PATCH exige el vehículo efectivo al guardar cambios editables y respeta Cargado/Cancelar", () => {
    expect(ruta).toContain("esPatchDeEdicion(d) && exigeVehiculoSolicitadoAlEditar(antes.estado, antes.pendienteCierre)");
    expect(ruta).toContain("vehiculoEfectivoTrasPatch(d.vehiculoSolicitadoPerfilId, actualVehiculo.id) == null");
  });
  it("copiar programación hereda el vehículo del ORIGEN en el servidor (nunca del cliente) y no inventa uno", () => {
    const copia = readFileSync("src/lib/tms/programacion-copia.ts", "utf8");
    expect(copia).toContain("vehiculoSolicitadoPerfilId: vehiculoOrigen.get(f.origenPlanId as number) ?? null, // del ORIGEN en servidor, nunca del cliente");
    expect(readFileSync("src/lib/tms/programacion-lote.ts", "utf8")).toContain("resolverVehiculoSolicitado(empresaId, b.vehiculoSolicitadoPerfilId)");
  });
  it("caminos que NO tocan el vehículo solicitado (documentados): edición rápida, importación Excel y alta desde solicitud de cliente", () => {
    for (const f of ["src/lib/tms/edicion-rapida-guardar.ts", "src/lib/tms/programacion-import.ts", "src/lib/tms/solicitudes-cliente-operaciones.ts"]) {
      expect(readFileSync(f, "utf8")).not.toContain("vehiculo_solicitado");
    }
  });
});
