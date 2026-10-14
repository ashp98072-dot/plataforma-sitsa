// Coordinación del documento cliente, SOLO trabajo en curso. No guarda sesión,
// usuario, tenant, permisos ni respuestas resueltas; sin TTL ni autorización cacheada.
let renovacionEnCurso: Promise<Response> | null = null;
let salidaEnCurso: Promise<void> | null = null;
let cambioEnCurso: Promise<Response> | null = null;
let salidaSolicitada = false;

/** Nueva entrada al área autenticada tras login; no interrumpe una salida activa. */
export function reiniciarSalidaStaff(): void {
  if (!salidaEnCurso) salidaSolicitada = false;
}

/** El POST de actividad escribe cookie: debe terminar ANTES de borrarla con logout. */
export function actividadStaff(fetchFn: typeof fetch, init: RequestInit): Promise<Response | null> {
  if (salidaSolicitada || cambioEnCurso) return Promise.resolve(null);
  if (renovacionEnCurso) return renovacionEnCurso;
  renovacionEnCurso = Promise.resolve().then(() => fetchFn("/api/auth/activity", init)).finally(() => { renovacionEnCurso = null; });
  return renovacionEnCurso;
}

/** Selección y actividad también escriben la misma cookie: conservar la empresa elegida. */
export function seleccionarEmpresa(fetchFn: typeof fetch, empresaId: number): Promise<Response> {
  if (salidaSolicitada || cambioEnCurso) return Promise.reject(new Error("Hay una acción de sesión en curso."));
  const renovacion = renovacionEnCurso;
  cambioEnCurso = Promise.resolve().then(async () => {
    if (renovacion) await renovacion.catch(() => undefined);
    return fetchFn("/api/auth/select-empresa", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ empresaId }),
    });
  }).finally(() => { cambioEnCurso = null; });
  return cambioEnCurso;
}

export function salidaStaffSolicitada(): boolean { return salidaSolicitada; }

/** Un POST y una navegación, incluso si menú y guard solicitan salida simultáneamente. */
export function cerrarSesion(fetchFn: typeof fetch, irA: (ruta: string) => void): Promise<void> {
  if (salidaEnCurso) return salidaEnCurso;
  if (salidaSolicitada) return Promise.resolve(); // Una respuesta 401 tardía no repite una salida ya confirmada.
  salidaSolicitada = true;
  const renovacion = renovacionEnCurso;
  const cambio = cambioEnCurso;
  salidaEnCurso = Promise.resolve().then(async () => {
    try {
      // No abortar y asumir que desapareció un Set-Cookie: asegurar orden real.
      if (renovacion) await renovacion.catch(() => undefined);
      if (cambio) await cambio.catch(() => undefined);
      const response = await fetchFn("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("No se pudo cerrar sesión. Intenta nuevamente.");
      irA("/login");
    } catch (error) {
      salidaSolicitada = false;
      throw error;
    }
  }).finally(() => { salidaEnCurso = null; });
  return salidaEnCurso;
}
