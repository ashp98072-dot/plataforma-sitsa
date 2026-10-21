import { descripcionReporteDistinta } from "./plan-lugares";

/**
 * PROGRAMACION-PERSISTENCIA — lógica PURA del formulario de Programación para que lo que el usuario edita en ESTE
 * viaje persista y nunca sea pisado por la ruta maestra ni por datos viejos (sin React: se prueba directo).
 *
 * Regla de negocio: la ruta maestra es SOLO una plantilla inicial. Se aplica cuando el usuario ELIGE una ruta distinta
 * de la que ya tiene el viaje; después, hora/destino/paradas/contacto pertenecen al viaje.
 *
 * Contrato del PATCH para snapshots: `undefined` = no tocar, `null` = el usuario lo borró, valor = actualizar.
 */

/** "06:30:00" | "06:30" -> "06:30"; vacío -> "". */
export function normalizarHora(hora: string | null | undefined): string {
  return (hora ?? "").trim().slice(0, 5);
}

/** horaCarga del PATCH: solo si cambió contra lo persistido. Vaciarla no se envía (el viaje conserva su hora). */
export function cambioHoraCarga(original: string | null | undefined, actual: string): string | undefined {
  const a = normalizarHora(actual);
  if (!a || a === normalizarHora(original)) return undefined;
  return a;
}

/** Snapshot de texto (destino, contacto, código de ruta): undefined si no cambió; null si el usuario lo borró. */
export function cambioTextoSnapshot(original: string | null | undefined, actual: string): string | null | undefined {
  const o = (original ?? "").trim();
  const a = actual.trim();
  if (a === o) return undefined;
  return a ? a : null;
}

export type ParadaPersistida = { id: number; lugar_nombre: string; tipo: string; requiere_evidencia: boolean };
export type ParadaPayload = {
  id?: number;
  lugarNombre: string;
  tipo: string;
  requiereEvidencia: boolean;
  clienteUbicacionId?: number;
};

/** Mismo mapeo de tipo que usa el formulario al cargar las paradas del viaje. */
export const tipoParadaFormulario = (tipo: string) => (["Carga", "Descarga", "Entrega"].includes(tipo) ? tipo : "Descarga");

/**
 * paradas del PATCH: solo si la lista REALMENTE cambió contra lo persistido (orden, id, lugar, tipo, evidencia, o se
 * eligió una ubicación guardada). Sin cambios => undefined: el backend no toca las paradas (ni re-evalúa evidencias).
 * Una lista vaciada por el usuario sí se envía como [] (eliminación real).
 */
export function cambioParadas(originales: ParadaPersistida[], actuales: ParadaPayload[]): ParadaPayload[] | undefined {
  const base = originales.map((p) => ({ id: p.id, lugarNombre: p.lugar_nombre.trim(), tipo: tipoParadaFormulario(p.tipo), requiereEvidencia: Boolean(p.requiere_evidencia) }));
  const iguales =
    base.length === actuales.length &&
    actuales.every((a, i) =>
      a.id === base[i].id &&
      a.lugarNombre.trim() === base[i].lugarNombre &&
      a.tipo === base[i].tipo &&
      a.requiereEvidencia === base[i].requiereEvidencia &&
      a.clienteUbicacionId == null,
    );
  return iguales ? undefined : actuales;
}

/**
 * ¿Aplicar los defaults de la ruta elegida? Solo si es una ruta DISTINTA a la que el viaje ya tiene: volver a elegir
 * la misma ruta (o un Enter accidental sobre ella) nunca debe pisar lo editado para este viaje.
 */
export function debeAplicarRuta(rutaIdActual: number, rutaIdElegida: number): boolean {
  return rutaIdElegida > 0 && rutaIdElegida !== rutaIdActual;
}

/**
 * RutaSelect: Enter elige la primera opción SOLO si el usuario está buscando (escribió algo distinto del valor que ya
 * muestra el campo). Con el campo precargado con la ruta actual, Enter no re-aplica la ruta.
 */
export function enterEligeRuta(o: { texto: string; valor: string; abierto: boolean; hayOpciones: boolean }): boolean {
  return o.abierto && o.hayOpciones && o.texto.trim() !== "" && o.texto.trim() !== o.valor.trim();
}

/**
 * Secuencia de cargas de Programación: cada consulta (sondeo pasivo o recarga explícita tras guardar) toma un turno, y
 * solo la MÁS RECIENTE puede aplicar su resultado. Evita que un sondeo que leyó la BD ANTES de guardar responda DESPUÉS
 * de la recarga y vuelva a mostrar los valores viejos del viaje.
 */
export function crearSecuenciaCargas() {
  let ultima = 0;
  return {
    iniciar: () => ++ultima,
    esVigente: (turno: number) => turno === ultima,
  };
}

export type TipoParadaForm = "Carga" | "Descarga" | "Entrega";

/**
 * PROGRAMACION-PARADAS-FUENTE — «descripción distinta en el reporte» al ABRIR un viaje: solo si lo guardado difiere de la
 * primera Descarga/Entrega de sus paradas (o el viaje histórico no tiene paradas). Si coincide, el campo queda vacío y el
 * servidor la sigue derivando de las paradas — no se muestra dos veces el mismo destino.
 */
export function descripcionReporteInicial(historico: string | null | undefined, paradas: ParadaPersistida[] | undefined): string {
  const lista = (paradas ?? []).map((p) => ({ lugarNombre: p.lugar_nombre, tipo: p.tipo }));
  return descripcionReporteDistinta(historico, lista) ? (historico ?? "").trim() : "";
}
export type ParadaFormulario = { id?: number; lugarNombre: string; tipo: TipoParadaForm; requiereEvidencia: boolean; clienteUbicacionId?: number | null };

/** Paradas del formulario al ABRIR un viaje guardado: exactamente las del viaje (con su id), nunca las de la ruta. */
export function paradasFormularioDesdePlan(paradas: ParadaPersistida[] | undefined): ParadaFormulario[] {
  return paradas?.length
    ? paradas.map((p) => ({
        id: p.id,
        lugarNombre: p.lugar_nombre,
        tipo: tipoParadaFormulario(p.tipo) as TipoParadaForm,
        requiereEvidencia: p.requiere_evidencia,
      }))
    : [
        { lugarNombre: "", tipo: "Carga", requiereEvidencia: true },
        { lugarNombre: "", tipo: "Descarga", requiereEvidencia: true },
      ];
}

/** Lo que la ruta maestra aporta como PLANTILLA (subconjunto de RutaOpt de ruta-select.tsx). */
export type RutaPlantilla = {
  id: number;
  codigo: string;
  horaHabitual: string | null;
  destinoDescripcion: string | null;
  lugarCargaTexto: string | null;
  ubicacionCargaId: number | null;
  paradas: { lugarNombre: string; tipo: string; clienteUbicacionId: number | null }[];
};

/**
 * Copia de la plantilla de la ruta (hora, destino, código, paradas) — se llama SOLO al elegir una ruta distinta.
 * Las paradas generadas son NUEVAS (sin id): la ruta nunca se enlaza "en vivo" con el viaje. `paradas` = null cuando
 * la ruta no trae nada que sugerir (se conservan las del formulario).
 */
export function plantillaDesdeRuta(
  ruta: RutaPlantilla,
  actual: { horaCarga: string; lugarDescargaHistorico: string },
): { rutaId: number; rutaCodigo: string; horaCarga: string; lugarDescargaHistorico: string; paradas: ParadaFormulario[] | null } {
  const paradas: ParadaFormulario[] = [];
  if (ruta.lugarCargaTexto) {
    paradas.push({ lugarNombre: ruta.lugarCargaTexto, tipo: "Carga", requiereEvidencia: true, clienteUbicacionId: ruta.ubicacionCargaId });
  }
  if (ruta.paradas.length) {
    for (const p of ruta.paradas) {
      paradas.push({ lugarNombre: p.lugarNombre, tipo: tipoParadaFormulario(p.tipo) as TipoParadaForm, requiereEvidencia: true, clienteUbicacionId: p.clienteUbicacionId });
    }
  } else if (ruta.destinoDescripcion) {
    // Respaldo solo para el tablero/seguimiento — el reporte tradicional lee lugar_descarga_historico.
    paradas.push({ lugarNombre: ruta.destinoDescripcion, tipo: "Descarga", requiereEvidencia: true, clienteUbicacionId: null });
  }
  // PROGRAMACION-PARADAS-FUENTE — el destino de la ruta alimenta las PARADAS; solo se conserva aparte como «descripción
  // distinta» cuando difiere de la primera descarga (VIAT-4b: texto libre tipo «RUTA-A - punto1-punto2»). Si coincide
  // (caso común) no se duplica en el formulario: el servidor la deriva de las paradas.
  const destino = ruta.destinoDescripcion?.trim() ?? "";
  return {
    rutaId: ruta.id,
    rutaCodigo: ruta.codigo,
    horaCarga: normalizarHora(ruta.horaHabitual) || actual.horaCarga,
    // Sin destino en la ruta no se pisa lo que el formulario ya tenía (igual que la hora).
    lugarDescargaHistorico: destino ? (descripcionReporteDistinta(destino, paradas) ? destino : "") : actual.lugarDescargaHistorico,
    paradas: paradas.length ? paradas : null,
  };
}
