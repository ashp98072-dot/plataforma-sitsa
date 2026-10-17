"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Contenedor de una tabla ancha con una barra de desplazamiento horizontal ADICIONAL, pegada al borde inferior de la pantalla (escritorio).
 *
 * Problema: la barra nativa vive al final del contenedor, así que con un día de muchas filas hay que bajar hasta el final para poder desplazarse
 * de lado. Aquí la barra "proxy" es sticky (bottom: 0), aparece SOLO si hay desborde horizontal Y la tabla está en pantalla, y se sincroniza en
 * ambos sentidos con el scroll real. La barra nativa del contenedor se conserva como respaldo (y es la que usa el táctil).
 *
 * Sin timers ni banderas: el bucle de eventos se evita porque solo se asigna `scrollLeft` cuando el valor DIFIERE (asignar el mismo valor no
 * dispara `scroll`). El scroll vertical no se toca. Oculta por debajo de `lg` (tablet/móvil ya desplazan con el dedo).
 */
/** Copia `scrollLeft` solo si DIFIERE: asignar el mismo valor no dispara `scroll`, así que dos elementos sincronizados nunca entran en bucle. */
export function sincronizarScroll(desde: { scrollLeft: number } | null, hacia: { scrollLeft: number } | null): boolean {
  if (!desde || !hacia || hacia.scrollLeft === desde.scrollLeft) return false;
  hacia.scrollLeft = desde.scrollLeft;
  return true;
}

export function TablaConBarraHorizontal({ children, className = "" }: { children: ReactNode; className?: string }) {
  const contenedor = useRef<HTMLElement | null>(null);
  const barra = useRef<HTMLDivElement | null>(null);
  /** scrollWidth del contenido cuando hay desborde horizontal; 0 si no lo hay. */
  const [anchoContenido, setAnchoContenido] = useState(0);
  const [enPantalla, setEnPantalla] = useState(false);

  useEffect(() => {
    const el = contenedor.current;
    if (!el) return;
    const medir = () => setAnchoContenido(el.scrollWidth > el.clientWidth + 1 ? el.scrollWidth : 0);
    // Los observadores notifican al registrarse: no hace falta medir de forma síncrona aquí.
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(medir);
    ro?.observe(el);
    if (el.firstElementChild) ro?.observe(el.firstElementChild);
    const io = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(([e]) => setEnPantalla(e.isIntersecting));
    io?.observe(el);
    return () => { ro?.disconnect(); io?.disconnect(); };
  }, []);

  const visible = anchoContenido > 0 && enPantalla;
  // Al aparecer, la barra toma la posición actual de la tabla (pudo desplazarse mientras estaba oculta).
  useEffect(() => { if (visible) sincronizarScroll(contenedor.current, barra.current); }, [visible]);

  return (
    <>
      <section
        ref={contenedor}
        data-tabla-scroll
        className={`overflow-x-auto ${className}`}
        onScroll={() => sincronizarScroll(contenedor.current, barra.current)}
      >
        {children}
      </section>
      <div
        ref={barra}
        data-barra-horizontal
        aria-hidden="true"
        className={visible
          ? "sticky bottom-0 z-20 mx-px hidden overflow-x-auto overflow-y-hidden border-t border-[var(--border)] bg-[var(--card)] lg:block"
          : "hidden"}
        onScroll={() => sincronizarScroll(barra.current, contenedor.current)}
      >
        <div style={{ width: anchoContenido, height: 1 }} />
      </div>
    </>
  );
}
