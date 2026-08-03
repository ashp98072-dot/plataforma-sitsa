export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { loadRuntimeEnv } = await import("./lib/load-env");
    loadRuntimeEnv();
  }
}
