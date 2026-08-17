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
  }
}