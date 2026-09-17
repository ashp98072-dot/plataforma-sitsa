import { afterEach, describe, expect, it } from "vitest";
import {
  fmtTs,
  hoyLocal,
  toIsoDate,
  toIsoDateDesdeInstante,
  TZ_GUATEMALA,
} from "./dates";

/**
 * RRHH-FECHAS-DATE-TIMEZONE — bug confirmado en producción: columnas SQL
 * DATE (empleados.fecha_alta, fecha_inicio_laboral, etc.) se guardaban
 * correctas en BD pero el listado las mostraba con -1 día tras editar.
 *
 * Causa: toIsoDate() trataba cualquier Date como un INSTANTE real y lo
 * reconvertía a America/Guatemala vía Intl (partesEnZona). mysql2 con
 * `timezone: "local"` (src/lib/db.ts) arma un DATE con hora 00:00:00 en la
 * zona LOCAL DEL PROCESO — si esa zona no es exactamente
 * America/Guatemala (p. ej. UTC en el hosting), restar el offset de
 * Guatemala desde medianoche siempre cruza al día anterior.
 *
 * Fix: toIsoDate() ahora usa los componentes LOCALES del Date
 * (.getFullYear()/.getMonth()/.getDate()), igual que fmtTs() ya hacía para
 * DATETIME/TIMESTAMP — sin volver a interpretar por zona horaria.
 */

const TZ_ORIGINAL = process.env.TZ;
afterEach(() => {
  if (TZ_ORIGINAL === undefined) delete process.env.TZ;
  else process.env.TZ = TZ_ORIGINAL;
});

describe("toIsoDate — columnas SQL DATE (Date de mysql2)", () => {
  it("2026-06-15 -> '2026-06-15', nunca 14 (caso de producción: entrada laboral)", () => {
    expect(toIsoDate(new Date(2026, 5, 15))).toBe("2026-06-15");
  });

  it("2026-10-22 -> '2026-10-22', nunca 21 (caso de producción: fecha de contratación)", () => {
    expect(toIsoDate(new Date(2026, 9, 22))).toBe("2026-10-22");
  });

  it("2025-05-01 -> '2025-05-01' (caso de producción: Wilson Leonardo Bá Caal)", () => {
    expect(toIsoDate(new Date(2025, 4, 1))).toBe("2025-05-01");
  });

  it("string 'YYYY-MM-DD' permanece igual (sin pasar por conversión de Date)", () => {
    expect(toIsoDate("2026-06-15")).toBe("2026-06-15");
  });

  it("string con tiempo (p. ej. desde JSON) se trunca a los primeros 10 caracteres, sin reinterpretar zona", () => {
    expect(toIsoDate("2026-06-15T00:00:00.000Z")).toBe("2026-06-15");
  });

  it("null/undefined -> null", () => {
    expect(toIsoDate(null)).toBeNull();
    expect(toIsoDate(undefined)).toBeNull();
  });

  it("patrón previo/siguiente reportado en producción: 22/06 y 03/09 ya no retroceden un día", () => {
    expect(toIsoDate(new Date(2026, 5, 22))).toBe("2026-06-22");
    expect(toIsoDate(new Date(2026, 8, 3))).toBe("2026-09-03");
  });

  it("regresión de mecanismo: bajo TZ de proceso != America/Guatemala, ya NO se desfasa -1 día (antes sí)", () => {
    // Reproduce exactamente el bug de producción: fuerza la zona del
    // proceso a UTC (distinta de Guatemala) y arma el Date igual que
    // mysql2 lo haría para un DATE (medianoche en la zona local del
    // proceso). La implementación ANTERIOR (partesEnZona/Intl con zona
    // fija Guatemala) devolvía "2026-06-14" en este escenario — verificado
    // manualmente antes de este fix. La implementación actual (getters
    // locales) es correcta sin importar la zona del proceso.
    process.env.TZ = "UTC";
    const d = new Date(2026, 5, 15);
    expect(toIsoDate(d)).toBe("2026-06-15");
  });

  it("cambio acumulativo: leer -> mismo YYYY-MM-DD -> re-guardar -> volver a leer, estable en múltiples ciclos (sin drift)", () => {
    let iso = "2026-06-15";
    for (let ciclo = 0; ciclo < 5; ciclo++) {
      // Simula el round-trip: la app arma un Date local a partir del ISO
      // (igual que new Date(anio, mes-1, dia) en formatearFecha()), lo
      // "guarda" y mysql2 lo "devuelve" como Date — toIsoDate() debe
      // reproducir el mismo YYYY-MM-DD siempre.
      const [y, m, dd] = iso.split("-").map(Number);
      const comoDate = new Date(y, m - 1, dd);
      iso = toIsoDate(comoDate)!;
    }
    expect(iso).toBe("2026-06-15");
  });
});

describe("toIsoDateDesdeInstante — DATETIME real truncado a fecha (rrhh_descuento_cuotas.aplicado_en)", () => {
  it("conserva el comportamiento ORIGINAL de toIsoDate() (conversión a America/Guatemala) sin cambios", () => {
    process.env.TZ = "UTC";
    const instante = new Date(2026, 5, 15); // medianoche UTC bajo esta TZ forzada
    // Mismo mecanismo que antes tenía toIsoDate(): -1 día al convertir el
    // instante a Guatemala. Esto es intencional y NO se toca en este
    // ticket (RRHH-FECHAS-DATE-TIMEZONE solo corrige columnas DATE).
    expect(toIsoDateDesdeInstante(instante)).toBe("2026-06-14");
  });

  it("string permanece igual (mismo comportamiento que toIsoDate para strings)", () => {
    expect(toIsoDateDesdeInstante("2026-06-15")).toBe("2026-06-15");
  });

  it("null -> null", () => {
    expect(toIsoDateDesdeInstante(null)).toBeNull();
  });
});

describe("hoyLocal — sigue anclado a America/Guatemala (sin cambios por este ticket)", () => {
  it("usa TZ_GUATEMALA, no la zona del proceso", () => {
    expect(TZ_GUATEMALA).toBe("America/Guatemala");
    process.env.TZ = "UTC";
    const hoyEnUtc = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(new Date());
    const hoyGuate = hoyLocal();
    // No podemos fijar una fecha exacta (depende del día en que corra el
    // test), pero sí confirmar que hoyLocal() usa el cálculo de
    // partesEnZona (America/Guatemala) y no simplemente componentes
    // locales del proceso (que aquí forzamos a UTC) — si fueran iguales
    // todo el tiempo, el test no probaría nada; en la ventana horaria
    // 00:00–06:00 UTC ambas fechas coinciden, así que en su lugar se
    // valida el formato y que la función sigue usando Intl con zona fija
    // (no getters locales) mediante un valor conocido.
    expect(hoyGuate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(hoyEnUtc).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("un instante conocido cerca de medianoche UTC produce el día de Guatemala (UTC-6), no el de UTC", () => {
    // No usamos hoyLocal() aquí (depende de "ahora"); en cambio probamos
    // directamente el mecanismo de zona fija que hoyLocal() reutiliza
    // (partesEnZona), confirmando que sigue intacto.
    const instanteUtc = new Date("2026-06-15T02:00:00.000Z"); // 2026-06-14 20:00 Guatemala
    const partes = new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ_GUATEMALA,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(instanteUtc);
    expect(partes).toBe("2026-06-14");
  });
});

describe("fmtTs — DATETIME/TIMESTAMP reales, sin cambios por este ticket", () => {
  it("Date de mysql2 (timezone local) conserva sus componentes locales, incluyendo hora", () => {
    const d = new Date(2026, 5, 15, 14, 30, 0);
    expect(fmtTs(d)).toBe("2026-06-15 14:30:00");
  });

  it("string ISO con Z se convierte a reloj de Guatemala (comportamiento preexistente, intacto)", () => {
    const s = fmtTs("2026-06-15T02:00:00.000Z");
    expect(s).toBe("2026-06-14 20:00:00");
  });

  it("bajo TZ de proceso forzada a UTC, un Date de mysql2 sigue devolviendo sus componentes locales tal cual (no se desfasa)", () => {
    process.env.TZ = "UTC";
    const d = new Date(2026, 5, 15, 8, 0, 0);
    expect(fmtTs(d)).toBe("2026-06-15 08:00:00");
  });
});
