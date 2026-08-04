import { obtenerParametros } from "./config";

export async function obtenerDiaCorteQuincenal(
  empresaId: number,
): Promise<number> {
  const p = await obtenerParametros(empresaId);
  const n = Number.parseInt(p.ciclo_quincenal ?? "15", 10);
  return Number.isFinite(n) && n >= 1 && n <= 28 ? n : 15;
}

export async function obtenerOpcionesPeriodo(
  empresaId: number,
): Promise<string[]> {
  const corte = await obtenerDiaCorteQuincenal(empresaId);
  return [
    "Hoy",
    "Ayer",
    "Últimos 7 días",
    "Últimos 30 días",
    "Mes actual",
    "Mes anterior",
    `Quincena 1 (día 1 al ${corte})`,
    `Quincena 2 (día ${corte + 1} al fin de mes)`,
    "Rango personalizado",
  ];
}

function isoLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function obtenerRangoPeriodo(
  empresaId: number,
  periodo: string,
  fechaRef: Date = new Date(),
): Promise<{ desde: string; hasta: string } | null> {
  const hoy = new Date(
    fechaRef.getFullYear(),
    fechaRef.getMonth(),
    fechaRef.getDate(),
  );
  const anio = hoy.getFullYear();
  const mes = hoy.getMonth();
  const ultimo = new Date(anio, mes + 1, 0).getDate();
  const corte = await obtenerDiaCorteQuincenal(empresaId);

  if (periodo === "Hoy") {
    const s = isoLocal(hoy);
    return { desde: s, hasta: s };
  }
  if (periodo === "Ayer") {
    const ayer = new Date(hoy);
    ayer.setDate(ayer.getDate() - 1);
    const s = isoLocal(ayer);
    return { desde: s, hasta: s };
  }
  if (periodo === "Últimos 7 días") {
    const ini = new Date(hoy);
    ini.setDate(ini.getDate() - 6);
    return { desde: isoLocal(ini), hasta: isoLocal(hoy) };
  }
  if (periodo === "Últimos 30 días") {
    const ini = new Date(hoy);
    ini.setDate(ini.getDate() - 29);
    return { desde: isoLocal(ini), hasta: isoLocal(hoy) };
  }
  if (periodo === "Mes actual") {
    return {
      desde: `${anio}-${String(mes + 1).padStart(2, "0")}-01`,
      hasta: `${anio}-${String(mes + 1).padStart(2, "0")}-${String(ultimo).padStart(2, "0")}`,
    };
  }
  if (periodo === "Mes anterior") {
    const finMesAnt = new Date(anio, mes, 0);
    return {
      desde: `${finMesAnt.getFullYear()}-${String(finMesAnt.getMonth() + 1).padStart(2, "0")}-01`,
      hasta: isoLocal(finMesAnt),
    };
  }
  if (periodo.startsWith("Quincena 1")) {
    return {
      desde: `${anio}-${String(mes + 1).padStart(2, "0")}-01`,
      hasta: `${anio}-${String(mes + 1).padStart(2, "0")}-${String(corte).padStart(2, "0")}`,
    };
  }
  if (periodo.startsWith("Quincena 2")) {
    const inicioQ2 = Math.min(corte + 1, ultimo);
    return {
      desde: `${anio}-${String(mes + 1).padStart(2, "0")}-${String(inicioQ2).padStart(2, "0")}`,
      hasta: `${anio}-${String(mes + 1).padStart(2, "0")}-${String(ultimo).padStart(2, "0")}`,
    };
  }
  return null;
}

export const TIPOS_INCIDENCIA = [
  "Vacaciones",
  "Permiso con goce",
  "Permiso sin goce",
  "IGSS",
  "Médico",
  "Fallecimiento de Familiar",
  "Nacimiento de Hijo",
  "Enfermedad",
  "Sin Goce de Salario",
  "Matrimonio",
  "Citaciones Judiciales",
  "A cuenta de Vacaciones",
  "Cumpleaños",
  "Falta",
  "Suspensión",
  "Otro",
] as const;
