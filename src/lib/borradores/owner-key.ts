import { createHmac, hkdfSync } from "node:crypto";

/**
 * BORR-1b — IDENTIFICADOR OPACO DEL PROPIETARIO (`ownerKey`). SOLO SERVIDOR: usa `node:crypto`; este archivo NO se exporta
 * desde `index.ts` para que ningún componente cliente lo arrastre al bundle. El navegador lo RECIBE ya calculado (layout RSC →
 * AppShell → provider); jamás lo deriva ni lo elige.
 *
 * DISEÑO
 *   ownerKey = "o1_" + base64url( HMAC-SHA256( HKDF-SHA256(secreto, salt="novalvion/borradores", info="owner-key/v1"), "usuario:<id>" ) )
 *   - `<id>` es el id interno e inmutable de `usuarios` (`session.id`), NUNCA `username` (puede cambiar) ni el JWT.
 *   - Determinista: el mismo usuario obtiene el mismo ownerKey en cada inicio de sesión, equipo y empresa; usuarios distintos,
 *     valores distintos (HMAC es resistente a colisiones). No depende de nada aleatorio ni de la sesión actual.
 *   - Opaco e irreversible sin el secreto: no revela el id, ni el secreto, ni nada del JWT. HKDF aporta separación de
 *     dominio: el secreto de sesión (AUTH_SECRET) nunca se usa directamente como clave de este HMAC.
 *   - `o1_` versiona el algoritmo (un cambio futuro usaría otro prefijo sin confundirse con éste).
 *
 * FUENTE DEL SECRETO (en este orden; si ninguna es válida → `null` y la función de borradores queda DESACTIVADA, nunca se usa
 * un valor efímero, aleatorio por proceso ni público):
 *   1. `BORRADORES_OWNER_SECRET` (OPCIONAL, ≥ 32 caracteres): clave dedicada. Si está definida pero es inválida NO se cae a
 *      AUTH_SECRET en silencio (eso cambiaría los ownerKey sin avisar): el resultado es `null`.
 *   2. `AUTH_SECRET` (≥ 16 caracteres), el secreto persistente que Hostinger ya exige en producción.
 *   Se rechazan valores públicos conocidos (el de desarrollo del código y los de los ejemplos de despliegue).
 *
 * ROTACIÓN: cambiar la clave efectiva cambia TODOS los ownerKey. Los borradores locales ya guardados siguen en IndexedDB pero
 * dejan de ser alcanzables por su dueño (no se pierden ni se muestran a nadie más; caducan por retención a los 14 días). Rotar
 * AUTH_SECRET además cierra todas las sesiones, por lo que conviene hacerlo cuando no haya capturas en curso. Para
 * desacoplar ambos eventos, definir `BORRADORES_OWNER_SECRET` ANTES de rotar AUTH_SECRET y no cambiarlo después.
 * El secreto jamás se registra ni se incluye en mensajes de error.
 */

const SECRETOS_PUBLICOS: ReadonlySet<string> = new Set([
  "dev-insecure-secret-change-me-32", // respaldo de desarrollo en auth-secret.ts
  "cambia-este-secreto-largo-aleatorio", // env.hostinger.example
  "secreto-largo-aleatorio-min-16", // DEPLOY-HOSTINGER.md
]);
const LARGO_MIN_DEDICADO = 32;
const LARGO_MIN_AUTH = 16;
const PREFIJO = "o1_";

export type EntornoLectura = Readonly<Record<string, string | undefined>>;

const secretoAceptable = (s: string, minimo: number) => s.length >= minimo && !SECRETOS_PUBLICOS.has(s);

/** Secreto efectivo o `null` si no hay una fuente persistente adecuada. No registra nada. */
export function resolverSecretoPropietario(env: EntornoLectura = process.env): string | null {
  const dedicado = env.BORRADORES_OWNER_SECRET;
  if (dedicado !== undefined && dedicado !== "") return secretoAceptable(dedicado, LARGO_MIN_DEDICADO) ? dedicado : null;
  const base = env.AUTH_SECRET;
  return base !== undefined && secretoAceptable(base, LARGO_MIN_AUTH) ? base : null;
}

const idValido = (id: unknown): id is number => typeof id === "number" && Number.isSafeInteger(id) && id > 0;

/** Cálculo puro y determinista. Lanza si el id no es un entero positivo (no inventa identidades). */
export function calcularOwnerKey(usuarioId: number, secreto: string): string {
  if (!idValido(usuarioId)) throw new RangeError("Identificador de usuario no válido.");
  const clave = Buffer.from(hkdfSync("sha256", secreto, "novalvion/borradores", "owner-key/v1", 32));
  return PREFIJO + createHmac("sha256", clave).update(`usuario:${usuarioId}`).digest("base64url");
}

/**
 * ownerKey del usuario autenticado, o `null` si no hay secreto adecuado o el id no es válido (el llamador debe entonces
 * NO activar borradores). Nunca lanza.
 */
export function ownerKeyDeUsuario(usuarioId: unknown, env: EntornoLectura = process.env): string | null {
  if (!idValido(usuarioId)) return null;
  const secreto = resolverSecretoPropietario(env);
  return secreto === null ? null : calcularOwnerKey(usuarioId, secreto);
}
