import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadRuntimeEnv } from "@/lib/load-env";
import { tercerosDirectosHabilitados } from "./terceros-directos";
import { tercerosHabilitados } from "./terceros-transaccion";

export function diagnosticoCB2() {
  loadRuntimeEnv();
  let buildId: string | null = null;
  try {
    const id = readFileSync(join(process.cwd(), ".next", "BUILD_ID"), "utf8").trim();
    if (/^[A-Za-z0-9_-]{1,128}$/.test(id)) buildId = id;
  } catch { /* Development or unavailable build: explicitly unknown. */ }
  const sha = process.env.NOVALVION_DEPLOY_SHA ?? "";
  return {
    revisionFuncional: "cb2-identidades-independientes-v2",
    // Marcador funcional de la interfaz Shell por vale (#641/#642: piloto desde el vale, unidad interna/externa, regla única). Un merge NO implica despliegue:
    // si este campo no aparece en el endpoint de producción, el build desplegado no incluye ese código. Cambia solo cuando cambia ese flujo.
    revisionShell: "cb2-shell-vales-unidades-v1",
    buildId,
    shaDeclarado: /^[0-9a-f]{40}$/i.test(sha) ? sha : null,
    tercerosDirectos: tercerosDirectosHabilitados(),
    tercerosHabilitados: tercerosHabilitados(),
    fusionesHabilitadas: process.env.FLOTA_FUSIONES_APROBADAS === "1",
    prioridadConfiguracion: "El archivo persistente config puede prevalecer sobre el panel; comprobar valores efectivos, sin cambiar configuracion.",
  };
}
