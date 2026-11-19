import type { PoolConnection } from "mysql2/promise";
import { ErrorCB2 } from "./model";
import { rows } from "./repository";
import { buscarCoincidencias, esPlacaAbreviada, placaComparable } from "../combustible-coincidencias";
import { canonizarVehiculoTx } from "../vehiculos-alias";

type VehiculoFlota = { id: number; placa: string; activo: number; estado: string };

/** Placa completa con prefijo opcional (una letra + 3 dígitos + 3 letras): la forma contra la que una placa abreviada puede coincidir. */
const FORMA_COMPLETA = /^[A-Z]?\d{3}[A-Z]{3}$/;

/**
 * Relación ENTRE DOS placas, en AMBOS sentidos (comprobación local; no cambia el comparador global `identificarPlaca`):
 *  - EXACTA: misma placa comparable (ignora espacios, guiones y mayúsculas).
 *  - ABREVIADA: una de las dos omite el prefijo (tres dígitos + tres letras) y la otra es la misma placa con su letra de prefijo. Se detecta
 *    tanto «placa nueva abreviada frente a Flota completa» como el caso INVERSO «placa nueva completa frente a Flota abreviada».
 */
export function relacionPlaca(a: string, b: string): "EXACTA" | "ABREVIADA" | null {
  const x = placaComparable(a), y = placaComparable(b);
  if (!x || !y) return null;
  if (x === y) return "EXACTA";
  if (esPlacaAbreviada(x) && FORMA_COMPLETA.test(y) && y.slice(-6) === x) return "ABREVIADA";
  if (esPlacaAbreviada(y) && FORMA_COMPLETA.test(x) && x.slice(-6) === y) return "ABREVIADA";
  return null;
}

export type OpcionesGuardaFlota = {
  /**
   * Reutilización de una unidad externa YA registrada (idempotencia): solo se aplica el bloqueo duro (exacta o abreviada) y no la sugerencia de
   * «placa casi igual», que esa unidad pudo confirmar legítimamente al crearse. Identifica la unidad en el mensaje.
   */
  reutilizando?: { id: number };
};

/**
 * Una placa que YA existe en Flota (propia o compartida con la empresa) no puede registrarse —ni reutilizarse— además como unidad EXTERNA: la misma
 * unidad quedaría duplicada en dos catálogos y sus consumos repartidos entre dos identidades.
 *
 * La comprobación es del SERVIDOR (no confía en el catálogo del navegador, que solo trae vehículos activos y sin alias) y cubre TODOS los
 * vehículos visibles para la empresa: activos, inactivos, en taller y los absorbidos por una fusión (alias). Si la placa pertenece a un
 * vehículo absorbido, el mensaje indica su vehículo CANÓNICO. Coincidencia exacta o abreviada, en cualquier sentido = bloqueo que
 * `confirmarCoincidencias` NO puede saltar; placa casi igual (un carácter) = bloqueo salvo `confirmarCoincidencias`.
 *
 * No usa predicadoVehiculoAccesible: con las fusiones habilitadas ese predicado oculta justamente los vehículos absorbidos.
 */
export async function exigirPlacaNoEsFlota(c: PoolConnection, empresaId: number, placa: string, confirmarCoincidencias = false, opciones: OpcionesGuardaFlota = {}): Promise<void> {
  const flota = (await rows(c,
    `SELECT v.id, v.placa, v.activo, v.estado FROM flota_vehiculos v
     WHERE v.empresa_id = ? OR EXISTS (SELECT 1 FROM flota_vehiculo_acceso fva WHERE fva.vehiculo_id = v.id AND fva.empresa_id = ?)
     ORDER BY v.id`, [empresaId, empresaId])) as unknown as VehiculoFlota[];
  const coincidentes = flota.filter((v) => relacionPlaca(placa, v.placa) !== null);
  if (coincidentes.length) {
    const detalle: string[] = [];
    for (const v of coincidentes) {
      const canonicoId = await canonizarVehiculoTx(c, empresaId, Number(v.id));
      const canonico = canonicoId != null && canonicoId !== Number(v.id) ? flota.find((x) => Number(x.id) === canonicoId) : undefined;
      const notas = [Number(v.activo) !== 1 || v.estado !== "Activo" ? "no operable: inactiva o en taller" : "", canonico ? `fusionada, vehículo canónico #${canonico.id} (${canonico.placa})` : ""].filter(Boolean);
      detalle.push(`#${v.id} (${v.placa})${notas.length ? ` — ${notas.join("; ")}` : ""}`);
    }
    throw new ErrorCB2(opciones.reutilizando
      ? `La unidad externa #${opciones.reutilizando.id} («${placa}») coincide con una unidad de Flota: ${detalle.join(" / ")}. No se reutiliza como externa; usa esa unidad de Flota (el registro externo existente y sus consumos no se modifican).`
      : `La placa «${placa}» ya existe en Flota: ${detalle.join(" / ")}. No se registra como unidad externa; usa esa unidad de Flota (si no está operable, resuélvelo en Flota).`, 409);
  }
  if (!confirmarCoincidencias && !opciones.reutilizando) {
    const parecidas = buscarCoincidencias(placa, flota, (v) => v.placa, "placa");
    if (parecidas.estado === "APROXIMADA" && parecidas.candidatos.length)
      throw new ErrorCB2(`La placa «${placa}» es casi igual a unidades de Flota: ${parecidas.candidatos.map((v) => `#${v.id} (${v.placa})`).join(" / ")}. Corrige el Excel o elige esa unidad; si de verdad es otra unidad externa, confírmalo expresamente.`, 409);
  }
}
