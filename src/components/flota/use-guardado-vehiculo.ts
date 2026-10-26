"use client";
import { useRef, useState } from "react";

/** Un candado por formulario, compartido por los dos guardados.
 * La referencia se toma antes del primer await: también cubre eventos del mismo render.
 * Incluye la respuesta y la recarga, y se libera ante cualquier error.
 */
export function useGuardadoVehiculo() {
  const enCurso = useRef(false);
  const [guardando, setGuardando] = useState(false);
  const ocupado = () => enCurso.current;
  async function ejecutar(operacion: () => Promise<void>) {
    if (enCurso.current) return false;
    enCurso.current = true;
    setGuardando(true);
    try {
      await operacion();
      return true;
    } finally {
      enCurso.current = false;
      setGuardando(false);
    }
  }
  return { guardando, ocupado, ejecutar };
}
