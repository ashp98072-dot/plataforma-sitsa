export type ProductoCombustibleNormalizado = "diesel" | "gasolina";

export type EstadoConciliacionCombustible =
  | "COINCIDE"
  | "DIFERENCIA"
  | "SOLO_GASOLINERA"
  | "SOLO_SISTEMA"
  | "AMBIGUO";

export type CargaSistemaConciliacion = {
  id: number;
  numeroVale: string | null;
  fechaConsumo: string | null;
  placa: string;
  pilotoNombre: string;
  producto: ProductoCombustibleNormalizado;
  galones: number;
  precioGalon: number | null;
  monto: number;
};

export type CargaGasolineraConciliacion = {
  fila: number;
  numeroVale: string;
  fechaConsumo: string | null;
  placa: string;
  pilotoNombre: string | null;
  producto: ProductoCombustibleNormalizado | null;
  galones: number | null;
  precioGalon: number | null;
  monto: number | null;
};

export type DiferenciaCampo = {
  campo:
    | "fecha"
    | "placa"
    | "producto"
    | "galones"
    | "precio"
    | "monto";
  sistema: string;
  gasolinera: string;
};

export type ResultadoConciliacion = {
  estado: EstadoConciliacionCombustible;
  sistema: CargaSistemaConciliacion | null;
  gasolinera: CargaGasolineraConciliacion | null;
  diferencias: DiferenciaCampo[];
};

const TOLERANCIA_GALONES = 0.001;
const TOLERANCIA_MONTO = 0.01;

export function normalizarVale(valor: unknown): string {
  if (valor == null) return "";

  return String(valor).trim().toUpperCase();
}

export function normalizarPlaca(valor: unknown): string {
  if (valor == null) return "";

  return String(valor)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/^C(?=\d{3}[A-Z]{3}$)/, "");
}

export function normalizarProducto(
  valor: unknown,
): ProductoCombustibleNormalizado | null {
  if (valor == null) return null;

  const limpio = String(valor)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");

  if (!limpio) return null;

  if (limpio.includes("diesel")) {
    return "diesel";
  }

  if (limpio.includes("gasolina")) {
    return "gasolina";
  }

  return null;
}

export function redondearMoneda(valor: number): number {
  return Math.round((valor + Number.EPSILON) * 100) / 100;
}

export function redondearGalones(valor: number): number {
  return Math.round((valor + Number.EPSILON) * 1000) / 1000;
}

export function numeroSeguro(valor: unknown): number | null {
  if (typeof valor === "number") {
    return Number.isFinite(valor) ? valor : null;
  }

  if (typeof valor !== "string") {
    return null;
  }

  const limpio = valor
    .trim()
    .replace(/[Qq$]/g, "")
    .replace(/,/g, "");

  if (!limpio) return null;

  const numero = Number(limpio);

  return Number.isFinite(numero) ? numero : null;
}

export function esFechaIsoCalendarioValida(valor: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    return false;
  }

  const [y, m, d] = valor.split("-").map(Number);

  const fecha = new Date(Date.UTC(y, m - 1, d));

  return (
    fecha.getUTCFullYear() === y &&
    fecha.getUTCMonth() === m - 1 &&
    fecha.getUTCDate() === d
  );
}

export function normalizarFechaExcel(valor: unknown): string | null {
  if (valor == null || valor === "") {
    return null;
  }

  if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
    const y = valor.getUTCFullYear();
    const m = String(valor.getUTCMonth() + 1).padStart(2, "0");
    const d = String(valor.getUTCDate()).padStart(2, "0");

    const iso = `${y}-${m}-${d}`;

    return esFechaIsoCalendarioValida(iso) ? iso : null;
  }

  if (typeof valor === "number") {
    // Fecha serial de Excel.
    // Excel toma 1899-12-30 como base práctica para seriales modernos.
    const ms = Math.round((valor - 25569) * 86400 * 1000);
    const fecha = new Date(ms);

    if (Number.isNaN(fecha.getTime())) {
      return null;
    }

    const y = fecha.getUTCFullYear();
    const m = String(fecha.getUTCMonth() + 1).padStart(2, "0");
    const d = String(fecha.getUTCDate()).padStart(2, "0");

    const iso = `${y}-${m}-${d}`;

    return esFechaIsoCalendarioValida(iso) ? iso : null;
  }

  if (typeof valor !== "string") {
    return null;
  }

  const limpio = valor.trim();

  if (!limpio) {
    return null;
  }

  if (esFechaIsoCalendarioValida(limpio)) {
    return limpio;
  }

  const ddmmyyyy = limpio.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);

  if (ddmmyyyy) {
    const [, d, m, yRaw] = ddmmyyyy;
    const y = yRaw.length === 2 ? `20${yRaw}` : yRaw;

    const iso = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;

    return esFechaIsoCalendarioValida(iso) ? iso : null;
  }

  return null;
}

export function compararNumeros(
  a: number | null,
  b: number | null,
  tolerancia: number,
): boolean {
  if (a == null || b == null) {
    return a === b;
  }

  return Math.abs(a - b) <= tolerancia;
}

export function detectarDiferencias(
  sistema: CargaSistemaConciliacion,
  gasolinera: CargaGasolineraConciliacion,
): DiferenciaCampo[] {
  const diferencias: DiferenciaCampo[] = [];

  if (
    sistema.fechaConsumo &&
    gasolinera.fechaConsumo &&
    sistema.fechaConsumo !== gasolinera.fechaConsumo
  ) {
    diferencias.push({
      campo: "fecha",
      sistema: sistema.fechaConsumo,
      gasolinera: gasolinera.fechaConsumo,
    });
  }

  const placaSistema = normalizarPlaca(sistema.placa);
  const placaGasolinera = normalizarPlaca(gasolinera.placa);

  if (
    placaSistema &&
    placaGasolinera &&
    placaSistema !== placaGasolinera
  ) {
    diferencias.push({
      campo: "placa",
      sistema: sistema.placa,
      gasolinera: gasolinera.placa,
    });
  }

  if (
    gasolinera.producto &&
    sistema.producto !== gasolinera.producto
  ) {
    diferencias.push({
      campo: "producto",
      sistema: sistema.producto,
      gasolinera: gasolinera.producto,
    });
  }

  if (
    gasolinera.galones != null &&
    !compararNumeros(
      redondearGalones(sistema.galones),
      redondearGalones(gasolinera.galones),
      TOLERANCIA_GALONES,
    )
  ) {
    diferencias.push({
      campo: "galones",
      sistema: sistema.galones.toFixed(3),
      gasolinera: gasolinera.galones.toFixed(3),
    });
  }

  if (
    sistema.precioGalon != null &&
    gasolinera.precioGalon != null &&
    !compararNumeros(
      redondearMoneda(sistema.precioGalon),
      redondearMoneda(gasolinera.precioGalon),
      TOLERANCIA_MONTO,
    )
  ) {
    diferencias.push({
      campo: "precio",
      sistema: `Q${sistema.precioGalon.toFixed(2)}`,
      gasolinera: `Q${gasolinera.precioGalon.toFixed(2)}`,
    });
  }

  if (
    gasolinera.monto != null &&
    !compararNumeros(
      redondearMoneda(sistema.monto),
      redondearMoneda(gasolinera.monto),
      TOLERANCIA_MONTO,
    )
  ) {
    diferencias.push({
      campo: "monto",
      sistema: `Q${sistema.monto.toFixed(2)}`,
      gasolinera: `Q${gasolinera.monto.toFixed(2)}`,
    });
  }

  return diferencias;
}

export function conciliarPorVale(
  sistema: CargaSistemaConciliacion[],
  gasolinera: CargaGasolineraConciliacion[],
): ResultadoConciliacion[] {
  const resultados: ResultadoConciliacion[] = [];

  const sistemaPorVale = new Map<string, CargaSistemaConciliacion[]>();
  const gasolineraPorVale = new Map<string, CargaGasolineraConciliacion[]>();

  for (const carga of sistema) {
    const vale = normalizarVale(carga.numeroVale);

    if (!vale) continue;

    const actuales = sistemaPorVale.get(vale) ?? [];
    actuales.push(carga);
    sistemaPorVale.set(vale, actuales);
  }

  for (const carga of gasolinera) {
    const vale = normalizarVale(carga.numeroVale);

    if (!vale) continue;

    const actuales = gasolineraPorVale.get(vale) ?? [];
    actuales.push(carga);
    gasolineraPorVale.set(vale, actuales);
  }

  const todosLosVales = new Set<string>([
    ...sistemaPorVale.keys(),
    ...gasolineraPorVale.keys(),
  ]);

  for (const vale of todosLosVales) {
    const cargasSistema = sistemaPorVale.get(vale) ?? [];
    const cargasGasolinera = gasolineraPorVale.get(vale) ?? [];

    if (cargasSistema.length > 1 || cargasGasolinera.length > 1) {
      const max = Math.max(cargasSistema.length, cargasGasolinera.length);

      for (let i = 0; i < max; i += 1) {
        resultados.push({
          estado: "AMBIGUO",
          sistema: cargasSistema[i] ?? null,
          gasolinera: cargasGasolinera[i] ?? null,
          diferencias: [],
        });
      }

      continue;
    }

    const cargaSistema = cargasSistema[0] ?? null;
    const cargaGasolinera = cargasGasolinera[0] ?? null;

    if (cargaSistema && !cargaGasolinera) {
      resultados.push({
        estado: "SOLO_SISTEMA",
        sistema: cargaSistema,
        gasolinera: null,
        diferencias: [],
      });

      continue;
    }

    if (!cargaSistema && cargaGasolinera) {
      resultados.push({
        estado: "SOLO_GASOLINERA",
        sistema: null,
        gasolinera: cargaGasolinera,
        diferencias: [],
      });

      continue;
    }

    if (!cargaSistema || !cargaGasolinera) {
      continue;
    }

    const diferencias = detectarDiferencias(
      cargaSistema,
      cargaGasolinera,
    );

    resultados.push({
      estado: diferencias.length ? "DIFERENCIA" : "COINCIDE",
      sistema: cargaSistema,
      gasolinera: cargaGasolinera,
      diferencias,
    });
  }

  return resultados;
}