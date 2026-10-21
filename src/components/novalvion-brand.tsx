/**
 * Marca GLOBAL de la plataforma (Novalvion). No sustituye nunca el nombre de la empresa activa: este componente solo pinta el
 * producto; el nombre real de la empresa (empresaNombre) se muestra aparte, donde corresponda.
 *
 * Assets en /public/branding (NO bajo /public/brands, que son los logos de las empresas):
 *  - novalvion-logo.png: horizontal «N + Novalvion + PLATAFORMA CORPORATIVA». Su texto es casi blanco (diseñado para fondo oscuro).
 *  - novalvion-icon.png: monograma N.
 */

export const NOVALVION_LOGO_SRC = "/branding/novalvion-logo.png";
export const NOVALVION_ICON_SRC = "/branding/novalvion-icon.png";

/** Monograma N decorativo (el texto «Novalvion» siempre lo acompaña, por eso no lleva alt). */
export function NovalvionIcono({ className = "h-6 w-6" }: { className?: string }) {
  return (
    // Asset estático propio; sin optimizador para que cargue también en la pantalla de acceso.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={NOVALVION_ICON_SRC} alt="" aria-hidden="true" className={`${className} shrink-0 object-contain`} />
  );
}

/**
 * Logo horizontal. En tema oscuro usa la imagen completa; en tema claro el texto blanco del PNG no se vería, así que se
 * muestra el monograma + texto vivo con los colores del tema (contraste correcto en ambos temas).
 */
export function NovalvionLogo({ className = "w-64 max-w-full" }: { className?: string }) {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={NOVALVION_LOGO_SRC} alt="Novalvion" className={`${className} h-auto [[data-theme=light]_&]:hidden`} />
      <span className="hidden items-center gap-3 [[data-theme=light]_&]:flex">
        <NovalvionIcono className="h-14 w-14" />
        <span className="leading-tight">
          <span className="block text-4xl font-semibold tracking-tight text-[var(--text)]">Novalvion</span>
          <span className="block text-[10px] uppercase tracking-[0.35em] text-[var(--muted)]">Plataforma Corporativa</span>
        </span>
      </span>
    </>
  );
}
