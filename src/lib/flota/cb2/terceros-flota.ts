import type { PoolConnection } from "mysql2/promise";
import { ErrorCB2 } from "./model";
import { rows } from "./repository";
import { buscarCoincidencias, identificarPlaca } from "../combustible-coincidencias";
import { canonizarVehiculoTx } from "../vehiculos-alias";

type VehiculoFlota = { id: number; placa: string; activo: number; estado: string };

/**
 * Una placa que YA existe en Flota (propia o compartida con la empresa) no puede registrarse además como unidad EXTERNA: la misma unidad
 * quedaría duplicada en dos catálogos y sus consumos repartidos entre dos identidades.
 *
 * La comprobación es del SERVIDOR (no confía en el catálogo del navegador, que solo trae vehículos activos y sin alias) y cubre TODOS los
 * vehículos visibles para la empresa: activos, inactivos, en taller y los absorbidos por una fusión (alias). Si la placa pertenece a un
 * vehículo absorbido, el mensaje indica su vehículo CANÓNICO. Coincidencia exacta o abreviada (omisión del prefijo) = bloqueo; placa casi
 * igual (un carácter) = bloqueo salvo `confirmarCoincidencias`, igual que las coincidencias con otras unidades externas.
 *
 * No usa predicadoVehiculoAccesible: con las fusiones habilitadas ese predicado oculta justamente los vehículos absorbidos.
 */
export async function exigirPlacaNoEsFlota(c: PoolConnection, empresaId: number, placa: string, confirmarCoincidencias = false): Promise<void> {
  const flota = (await rows(c,
    `SELECT v.id, v.placa, v.activo, v.estado FROM flota_vehiculos v
     WHERE v.empresa_id = ? OR EXISTS (SELECT 1 FROM flota_vehiculo_acceso fva WHERE fva.vehiculo_id = v.id AND fva.empresa_id = ?)
     ORDER BY v.id`, [empresaId, empresaId])) as unknown as VehiculoFlota[];
  const exacta = identificarPlaca(placa, flota, (v) => v.placa);
  if (exacta.candidatos.length) {
    const detalle: string[] = [];
    for (const v of exacta.candidatos) {
      const canonicoId = await canonizarVehiculoTx(c, empresaId, Number(v.id));
      const canonico = canonicoId != null && canonicoId !== Number(v.id) ? flota.find((x) => Number(x.id) === canonicoId) : undefined;
      const notas = [Number(v.activo) !== 1 || v.estado !== "Activo" ? "no operable: inactiva o en taller" : "", canonico ? `fusionada, vehículo canónico #${canonico.id} (${canonico.placa})` : ""].filter(Boolean);
      detalle.push(`#${v.id} (${v.placa})${notas.length ? ` — ${notas.join("; ")}` : ""}`);
    }
    throw new ErrorCB2(`La placa «${placa}» ya existe en Flota: ${detalle.join(" / ")}. No se registra como unidad externa; usa esa unidad de Flota (si no está operable, resuélvelo en Flota).`, 409);
  }
  if (!confirmarCoincidencias) {
    const parecidas = buscarCoincidencias(placa, flota, (v) => v.placa, "placa");
    if (parecidas.estado === "APROXIMADA" && parecidas.candidatos.length)
      throw new ErrorCB2(`La placa «${placa}» es casi igual a unidades de Flota: ${parecidas.candidatos.map((v) => `#${v.id} (${v.placa})`).join(" / ")}. Corrige el Excel o elige esa unidad; si de verdad es otra unidad externa, confírmalo expresamente.`, 409);
  }
}
