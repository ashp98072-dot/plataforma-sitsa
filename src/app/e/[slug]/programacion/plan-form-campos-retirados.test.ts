import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * PROGRAMACION-REPORTES-FILTROS-1 — Parte A ("Simplificar Programación"):
 * costo operativo de referencia, referencia del cliente y observaciones
 * ya no se muestran ni se capturan desde el formulario de Programación.
 *
 * Este proyecto no tiene @testing-library/react (ver comentarios en
 * plan-form.tsx sobre por qué las reglas puramente funcionales se extraen
 * como funciones exportadas probables por separado) — no hay forma de
 * "renderizar" el formulario y consultar el DOM. Como guarda de
 * regresión, esta prueba verifica directamente el CÓDIGO FUENTE: que ya
 * no queda ningún input/textarea/estado/payload atado a los 3 campos
 * retirados. Es intencionalmente una prueba a nivel de texto fuente, no
 * de comportamiento — el comportamiento real (que el navegador no
 * muestre esos campos y que el POST/PATCH no los incluya) se sigue
 * exactamente de que el código que los producía ya no existe.
 *
 * IMPORTANTE: los 3 campos se retiran SOLO de la UI/payload — la BD
 * conserva las columnas (tms_planes_viaje.costo_operativo_referencia/
 * referencia_cliente/notas) sin DROP ni migración, y el backend
 * (planes/route.ts) los sigue aceptando opcionalmente por compatibilidad
 * — ver src/app/api/empresas/[slug]/tms/planes/route.ts.
 */
const planForm = readFileSync(
  join(__dirname, "plan-form.tsx"),
  "utf-8",
);
const programacionClient = readFileSync(
  join(__dirname, "programacion-client.tsx"),
  "utf-8",
);

describe("plan-form.tsx ya no captura los 3 campos retirados", () => {
  it("no queda ningún estado de formulario, input ni payload para costoOperativoReferencia", () => {
    // TMS-SIN-COSTO-OPERATIVO-1: desde este ticket ya no queda NINGUNA
    // mención de costoOperativo* en plan-form.tsx — ni siquiera el ""
    // inerte que antes se pasaba a aplicarDefaultsRutaSinSobrescribir
    // (esa función ya no acepta el parámetro en absoluto, ver
    // src/lib/tms/ruta-defaults.ts).
    expect(planForm).not.toMatch(/costoOperativoReferencia/);
    expect(planForm).not.toMatch(/costoOperativo/i);
  });

  it("no queda ningún estado de formulario, input ni payload para referenciaCliente", () => {
    expect(planForm).not.toMatch(/referenciaCliente/);
  });

  it("no queda ningún estado de formulario, textarea ni payload para notas (Observaciones)", () => {
    expect(planForm).not.toMatch(/form\.notas/);
    expect(planForm).not.toMatch(/notas:\s*plan\?\.notas/);
    expect(planForm).not.toMatch(/>\s*Observaciones\s*</);
  });

  it("no quedan las etiquetas visibles de los 3 campos retirados", () => {
    expect(planForm).not.toContain("Costo operativo de referencia");
    expect(planForm).not.toContain("Referencia del cliente");
  });

  it("la tarifa comercial SÍ se conserva (no se retiró por error junto con los otros 3 campos)", () => {
    expect(planForm).toContain("tarifaComercial");
    expect(planForm).toContain("Tarifa comercial");
  });
});

describe("programacion-client.tsx ya no muestra referencia_cliente en el tablero", () => {
  it("no queda ninguna lectura de p.referencia_cliente en el JSX del tablero", () => {
    expect(programacionClient).not.toMatch(/p\.referencia_cliente/);
    expect(programacionClient).not.toContain("Referencia cliente");
  });

  it("la tarifa comercial SÍ se sigue mostrando en la tarjeta del viaje", () => {
    expect(programacionClient).toContain("p.tarifa_comercial");
    expect(programacionClient).toContain("Tarifa comercial");
  });

  it("el tipo Plan conserva los 3 campos (dato histórico que el GET sigue devolviendo, sin DROP de columna)", () => {
    expect(programacionClient).toContain("costo_operativo_referencia: number | null");
    expect(programacionClient).toContain("referencia_cliente: string | null");
    expect(programacionClient).toContain("notas: string | null");
  });
});
