/**
 * MENÚ DE CUENTA — reglas del formulario "Cambiar contraseña" (usuarios internos). Puras y compartidas por la página y
 * por POST /api/auth/cambiar-password (el servidor las vuelve a aplicar: el cliente nunca es la autoridad).
 * Mínimo de 6 caracteres: misma política que ya usan los cambios de contraseña existentes (portal de colaboradores y
 * portal de clientes).
 */
export const PASSWORD_MIN = 6;
export const PASSWORD_MAX = 128;

export type CambioPasswordEntrada = {
  passwordActual: string;
  passwordNueva: string;
  confirmarPassword: string;
};

/** Primer error del formulario o null. Nunca incluye las contraseñas en el mensaje. */
export function validarCambioPassword(d: CambioPasswordEntrada): string | null {
  if (!d.passwordActual) return "Indica tu contraseña actual.";
  if (!d.passwordNueva) return "Indica la nueva contraseña.";
  if (d.passwordNueva.length < PASSWORD_MIN) return `La nueva contraseña debe tener al menos ${PASSWORD_MIN} caracteres.`;
  if (d.passwordNueva.length > PASSWORD_MAX) return `La nueva contraseña no puede superar ${PASSWORD_MAX} caracteres.`;
  if (d.passwordNueva !== d.confirmarPassword) return "La confirmación no coincide con la nueva contraseña.";
  if (d.passwordNueva === d.passwordActual) return "La nueva contraseña debe ser distinta a la actual.";
  return null;
}

/** Mensaje genérico ante contraseña actual incorrecta o fallo de guardado (no revela cuál de los dos fue). */
export const MSG_CAMBIO_PASSWORD_FALLIDO = "No se pudo cambiar la contraseña. Verifica tu contraseña actual e intenta de nuevo.";
