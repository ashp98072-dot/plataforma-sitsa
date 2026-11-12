import { z } from 'zod';
import { reference, type OrderContractOptions } from '../contracts';
import { isCalendarDate } from '../tms-solicitud-draft';
import { TMS_LIMITS } from '../tms-contract-proposal';

// PRICESMART API-12 — CONTRATO DE PRUEBA DEL LABORATORIO (`lab-demo-1`). NO es el contrato definitivo (D06 pendiente): existe solo para demostrar el circuito completo
// con los datos logísticos mínimos (referencia, club, destinatario, dirección y fecha de entrega). Vive aparte del borrador `api01-draft-1`, que NO cambia.
export const LAB_SCHEMA_VERSION = 'lab-demo-1';
export const labOrderSchema = z.object({
  schemaVersion: z.literal(LAB_SCHEMA_VERSION),
  externalOrderId: reference,
  originClubReference: reference.max(64),
  recipient: z.object({ name: z.string().trim().min(1).max(TMS_LIMITS.placeNameMax) }).strict(),
  address: z.string().trim().min(1).max(TMS_LIMITS.stopReferenceMax),
  deliveryDate: z.string().refine(isCalendarDate, 'fecha calendario inválida'),
  notes: z.string().trim().max(200).optional(),
}).strict();
export type LabOrderInput = z.infer<typeof labOrderSchema>;

/** Identidad de contenido: TODOS los campos. Mismo id con otro destinatario/dirección/fecha ⇒ CONFLICT (no se devuelve en silencio la orden original). */
export const labContract: OrderContractOptions = {
  orderSchema: labOrderSchema,
  canonicalInput: (input) => {
    const o = input as LabOrderInput;
    return [o.schemaVersion, o.externalOrderId, o.originClubReference, o.recipient.name, o.address, o.deliveryDate, o.notes ?? null];
  },
};
