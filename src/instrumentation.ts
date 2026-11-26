export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { loadRuntimeEnv } = await import("./lib/load-env");
    loadRuntimeEnv();

    // Falla rápido y con un mensaje claro si AUTH_SECRET no está bien
    // configurado, en vez de arrancar y degradar silenciosamente a un
    // secreto inseguro conocido públicamente (ver src/lib/auth-secret.ts).
    const { verificarAuthSecretAlArrancar } = await import(
      "./lib/auth-secret"
    );
    verificarAuthSecretAlArrancar();

    // PRICESMART — arranque real del runtime de homologación. SOLO en un proceso que se declara sandbox y pide un modo distinto de DISABLED; en cualquier otro caso (producción, laboratorio, sin modo) no se importa
    // nada de PriceSmart. El arranque falla cerrado: si falta cualquier requisito deja las rutas en 503 DISABLED y el proceso sigue sirviendo el resto de la aplicación.
    const priceSmartMode = process.env.PRICESMART_RUNTIME_MODE;
    if (process.env.NOVALVION_ENV === "sandbox" && priceSmartMode && priceSmartMode !== "DISABLED") {
      try {
        const { bootHomologationRuntime } = await import("./lib/integrations/pricesmart/homologation/boot");
        const report = await bootHomologationRuntime(process.env);
        console.log(`[pricesmart] runtime de homologación: ${report.state} (${report.blockers.map((b) => b.code).join(",") || "sin bloqueos"})`);
      } catch {
        console.error("[pricesmart] el arranque del runtime de homologación falló; permanece cerrado.");
      }
    }
  }
}