import { describe, expect, it } from "vitest";
import {
  conciliarPorVale,
  detectarDiferencias,
  esFechaIsoCalendarioValida,
  normalizarFechaExcel,
  normalizarPlaca,
  normalizarProducto,
  normalizarVale,
  numeroSeguro,
  redondearGalones,
  redondearMoneda,
  type CargaGasolineraConciliacion,
  type CargaSistemaConciliacion,
} from "./combustible-conciliacion";

const sistemaBase: CargaSistemaConciliacion = {
  id: 1,
  numeroVale: "4334",
  fechaConsumo: "2026-09-04",
  placa: "C-035BXR",
  pilotoNombre: "Marvin Xol",
  producto: "diesel",
  galones: 7.15,
  precioGalon: 43.69,
  monto: 312.38,
};

const gasolineraBase: CargaGasolineraConciliacion = {
  fila: 2,
  numeroVale: "4334",
  fechaConsumo: "2026-09-04",
  placa: "035 BXR",
  pilotoNombre: "Marvin Xol",
  producto: "diesel",
  galones: 7.15,
  precioGalon: 43.69,
  monto: 312.38,
};

describe("normalizarVale", () => {
  it("recorta y normaliza a mayúsculas", () => {
    expect(normalizarVale("  a-123/b  ")).toBe("A-123/B");
  });

  it("null/undefined -> cadena vacía", () => {
    expect(normalizarVale(null)).toBe("");
    expect(normalizarVale(undefined)).toBe("");
  });

  it("preserva contenido numérico", () => {
    expect(normalizarVale(4334)).toBe("4334");
  });
});

describe("normalizarPlaca", () => {
  it("considera equivalentes los formatos usados entre sistema y gasolinera", () => {
    expect(normalizarPlaca("C-034BXR")).toBe("034BXR");
    expect(normalizarPlaca("034 BXR")).toBe("034BXR");
    expect(normalizarPlaca("034BXR")).toBe("034BXR");
    expect(normalizarPlaca("C034BXR")).toBe("034BXR");
  });

  it("no elimina letras distintas de la C de prefijo conocida", () => {
    expect(normalizarPlaca("P-123ABC")).toBe("P123ABC");
  });

  it("vacío -> cadena vacía", () => {
    expect(normalizarPlaca("   ")).toBe("");
    expect(normalizarPlaca(null)).toBe("");
  });
});

describe("normalizarProducto", () => {
  it("normaliza diesel sin importar mayúsculas/minúsculas", () => {
    expect(normalizarProducto("Diesel")).toBe("diesel");
    expect(normalizarProducto("DIESEL")).toBe("diesel");
    expect(normalizarProducto("diesel")).toBe("diesel");
  });

  it("normaliza gasolina", () => {
    expect(normalizarProducto("Gasolina")).toBe("gasolina");
  });

  it("producto desconocido -> null", () => {
    expect(normalizarProducto("GLP")).toBeNull();
    expect(normalizarProducto("")).toBeNull();
  });
});

describe("numeroSeguro", () => {
  it("acepta números directos", () => {
    expect(numeroSeguro(312.38)).toBe(312.38);
  });

  it("acepta valores monetarios tipo Q312.38", () => {
    expect(numeroSeguro("Q312.38")).toBe(312.38);
  });

  it("acepta separadores de miles", () => {
    expect(numeroSeguro("Q1,234.56")).toBe(1234.56);
  });

  it("valor inválido -> null", () => {
    expect(numeroSeguro("abc")).toBeNull();
    expect(numeroSeguro("")).toBeNull();
    expect(numeroSeguro(null)).toBeNull();
  });
});

describe("redondeos", () => {
  it("galones conserva 3 decimales", () => {
    expect(redondearGalones(5.0979)).toBe(5.098);
    expect(redondearGalones(7.1499)).toBe(7.15);
    expect(redondearGalones(13.2484)).toBe(13.248);
  });

  it("moneda conserva centavos", () => {
    expect(redondearMoneda(312.384)).toBe(312.38);
    expect(redondearMoneda(312.385)).toBe(312.39);
  });
});

describe("esFechaIsoCalendarioValida", () => {
  it("acepta fechas calendario válidas", () => {
    expect(esFechaIsoCalendarioValida("2026-02-28")).toBe(true);
    expect(esFechaIsoCalendarioValida("2028-02-29")).toBe(true);
  });

  it("rechaza fechas imposibles", () => {
    expect(esFechaIsoCalendarioValida("2026-02-29")).toBe(false);
    expect(esFechaIsoCalendarioValida("2026-02-31")).toBe(false);
    expect(esFechaIsoCalendarioValida("2026-04-31")).toBe(false);
  });

  it("rechaza formatos distintos de YYYY-MM-DD", () => {
    expect(esFechaIsoCalendarioValida("04/09/2026")).toBe(false);
  });
});

describe("normalizarFechaExcel", () => {
  it("mantiene una fecha ISO válida", () => {
    expect(normalizarFechaExcel("2026-09-04")).toBe("2026-09-04");
  });

  it("acepta dd/mm/yyyy", () => {
    expect(normalizarFechaExcel("04/09/2026")).toBe("2026-09-04");
  });

  it("acepta dd/mm/yy", () => {
    expect(normalizarFechaExcel("04/09/26")).toBe("2026-09-04");
  });

  it("acepta Date", () => {
    expect(
      normalizarFechaExcel(new Date(Date.UTC(2026, 8, 4))),
    ).toBe("2026-09-04");
  });

  it("acepta serial de Excel", () => {
    // 2026-09-04
    expect(normalizarFechaExcel(46269)).toBe("2026-09-04");
  });

  it("rechaza fecha imposible", () => {
    expect(normalizarFechaExcel("31/02/2026")).toBeNull();
  });

  it("vacío -> null", () => {
    expect(normalizarFechaExcel("")).toBeNull();
    expect(normalizarFechaExcel(null)).toBeNull();
  });
});

describe("detectarDiferencias", () => {
  it("no reporta diferencia si placa solo cambia de formato", () => {
    const diferencias = detectarDiferencias(
      sistemaBase,
      gasolineraBase,
    );

    expect(diferencias).toEqual([]);
  });

  it("detecta diferencia real de placa", () => {
    const diferencias = detectarDiferencias(
      sistemaBase,
      {
        ...gasolineraBase,
        placa: "999 XYZ",
      },
    );

    expect(diferencias).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          campo: "placa",
        }),
      ]),
    );
  });

  it("detecta diferencia de producto", () => {
    const diferencias = detectarDiferencias(
      sistemaBase,
      {
        ...gasolineraBase,
        producto: "gasolina",
      },
    );

    expect(diferencias).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          campo: "producto",
        }),
      ]),
    );
  });

  it("detecta diferencia de galones con precisión de 3 decimales", () => {
    const diferencias = detectarDiferencias(
      sistemaBase,
      {
        ...gasolineraBase,
        galones: 7.2,
      },
    );

    expect(diferencias).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          campo: "galones",
          sistema: "7.150",
          gasolinera: "7.200",
        }),
      ]),
    );
  });

  it("no marca diferencia por una variación dentro de la tolerancia de galones", () => {
    const diferencias = detectarDiferencias(
      {
        ...sistemaBase,
        galones: 7.15,
      },
      {
        ...gasolineraBase,
        galones: 7.1509,
      },
    );

    expect(diferencias.find((d) => d.campo === "galones")).toBeUndefined();
  });

  it("detecta diferencia de precio", () => {
    const diferencias = detectarDiferencias(
      sistemaBase,
      {
        ...gasolineraBase,
        precioGalon: 43.79,
      },
    );

    expect(diferencias).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          campo: "precio",
        }),
      ]),
    );
  });

  it("detecta diferencia de monto", () => {
    const diferencias = detectarDiferencias(
      sistemaBase,
      {
        ...gasolineraBase,
        monto: 310,
      },
    );

    expect(diferencias).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          campo: "monto",
          sistema: "Q312.38",
          gasolinera: "Q310.00",
        }),
      ]),
    );
  });

  it("detecta diferencia de fecha", () => {
    const diferencias = detectarDiferencias(
      sistemaBase,
      {
        ...gasolineraBase,
        fechaConsumo: "2026-09-05",
      },
    );

    expect(diferencias).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          campo: "fecha",
        }),
      ]),
    );
  });
});

describe("conciliarPorVale", () => {
  it("clasifica COINCIDE cuando existe un solo registro en ambos lados y no hay diferencias", () => {
    const out = conciliarPorVale(
      [sistemaBase],
      [gasolineraBase],
    );

    expect(out).toHaveLength(1);
    expect(out[0].estado).toBe("COINCIDE");
    expect(out[0].diferencias).toEqual([]);
  });

  it("clasifica DIFERENCIA cuando el mismo vale tiene monto distinto", () => {
    const out = conciliarPorVale(
      [sistemaBase],
      [
        {
          ...gasolineraBase,
          monto: 320,
        },
      ],
    );

    expect(out).toHaveLength(1);
    expect(out[0].estado).toBe("DIFERENCIA");
    expect(out[0].diferencias).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          campo: "monto",
        }),
      ]),
    );
  });

  it("clasifica SOLO_GASOLINERA cuando el vale no existe en el sistema", () => {
    const out = conciliarPorVale(
      [],
      [gasolineraBase],
    );

    expect(out).toHaveLength(1);
    expect(out[0].estado).toBe("SOLO_GASOLINERA");
    expect(out[0].sistema).toBeNull();
    expect(out[0].gasolinera).not.toBeNull();
  });

  it("clasifica SOLO_SISTEMA cuando el vale no viene en el reporte de gasolinera", () => {
    const out = conciliarPorVale(
      [sistemaBase],
      [],
    );

    expect(out).toHaveLength(1);
    expect(out[0].estado).toBe("SOLO_SISTEMA");
    expect(out[0].sistema).not.toBeNull();
    expect(out[0].gasolinera).toBeNull();
  });

  it("clasifica AMBIGUO si el mismo vale aparece duplicado en sistema", () => {
    const out = conciliarPorVale(
      [
        sistemaBase,
        {
          ...sistemaBase,
          id: 2,
        },
      ],
      [gasolineraBase],
    );

    expect(out.every((r) => r.estado === "AMBIGUO")).toBe(true);
  });

  it("clasifica AMBIGUO si el mismo vale aparece duplicado en gasolinera", () => {
    const out = conciliarPorVale(
      [sistemaBase],
      [
        gasolineraBase,
        {
          ...gasolineraBase,
          fila: 3,
        },
      ],
    );

    expect(out.every((r) => r.estado === "AMBIGUO")).toBe(true);
  });

  it("normaliza el vale antes de hacer matching", () => {
    const out = conciliarPorVale(
      [
        {
          ...sistemaBase,
          numeroVale: " a-123 ",
        },
      ],
      [
        {
          ...gasolineraBase,
          numeroVale: "A-123",
        },
      ],
    );

    expect(out).toHaveLength(1);
    expect(out[0].estado).toBe("COINCIDE");
  });

  it("puede procesar múltiples vales con estados distintos", () => {
    const sistema: CargaSistemaConciliacion[] = [
      sistemaBase,
      {
        ...sistemaBase,
        id: 2,
        numeroVale: "5000",
        placa: "C-034BXR",
        monto: 640,
      },
    ];

    const gasolinera: CargaGasolineraConciliacion[] = [
      gasolineraBase,
      {
        ...gasolineraBase,
        fila: 3,
        numeroVale: "6000",
        placa: "999 XYZ",
        monto: 900,
      },
    ];

    const out = conciliarPorVale(
      sistema,
      gasolinera,
    );

    expect(out).toHaveLength(3);

    expect(out.map((r) => r.estado).sort()).toEqual(
      ["COINCIDE", "SOLO_GASOLINERA", "SOLO_SISTEMA"].sort(),
    );
  });
});