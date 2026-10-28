import { z } from "zod";
import { fechaValida } from "./reportes/calculo";

export const AVISO_CALENDARIO = "Configurar el calendario no activa el control de períodos. La activación se administra expresamente por libro.";
const codigo = z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/).transform((v) => v.toUpperCase());
const fecha = z.string().refine((v) => v >= "1000-01-01" && v <= "9999-12-31" && fechaValida(v) === v, "Fecha inválida (AAAA-MM-DD).");
const periodoSchema = z.object({ codigo, fechaInicio: fecha, fechaFin: fecha }).strict();
export const calendarioSchema = z.object({
  codigo, fechaInicio: fecha, fechaFin: fecha,
  periodos: z.array(periodoSchema).min(1).max(366),
}).strict().superRefine((d, ctx) => {
  const error = (message: string) => ctx.addIssue({ code: "custom", path: ["periodos"], message });
  if (d.fechaInicio > d.fechaFin) error("El inicio del ejercicio debe ser anterior o igual al fin.");
  const codigos = new Set<string>();
  d.periodos.forEach((p, i) => {
    if (codigos.has(p.codigo)) error("Los códigos de período no pueden repetirse.");
    codigos.add(p.codigo);
    if (p.fechaInicio > p.fechaFin || p.fechaInicio < d.fechaInicio || p.fechaFin > d.fechaFin) error("Cada período debe estar dentro del ejercicio y tener fechas ordenadas.");
    if (i === 0 && p.fechaInicio !== d.fechaInicio) error("El primer período debe comenzar con el ejercicio.");
    if (i > 0) {
      const anterior = d.periodos[i - 1];
      if (fechaValida(anterior.fechaFin) && fechaValida(p.fechaInicio)) {
        const diferencia = Date.parse(`${p.fechaInicio}T00:00:00Z`) - Date.parse(`${anterior.fechaFin}T00:00:00Z`);
        if (diferencia !== 86_400_000) error("Los períodos deben ser consecutivos, en orden y sin huecos ni solapamientos.");
      }
    }
  });
  if (d.periodos.at(-1)?.fechaFin !== d.fechaFin) error("El último período debe terminar con el ejercicio.");
});
export type CalendarioEntrada = z.input<typeof calendarioSchema>;
export type EjercicioCalendario = { id: number; codigo: string; fechaInicio: string; fechaFin: string; estado: "CONFIGURADO" };
export type PeriodoCalendario = Omit<EjercicioCalendario,'estado'> & { ejercicioId: number; orden: number; estado:'CONFIGURADO'|'ABIERTO'|'CERRADO' };
export function validarCalendarioContable(input: unknown) { return calendarioSchema.parse(input); }
