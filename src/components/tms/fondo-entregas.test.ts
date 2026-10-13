import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * CONTROL DE ENTREGA EN FONDOS (PR 2) — contratos de cableado de la pantalla y de los endpoints que se verifican leyendo el
 * código (mismo criterio que otros tests de UI del repo). La lógica en sí (permisos, destinos, estados) se prueba en
 * `src/lib/entregas/presentacion.test.ts`; los endpoints en `entregas-api.test.ts`.
 */
const leer = (ruta: string) => readFileSync(new URL(`../../${ruta}`, import.meta.url), "utf8");
const PAGINA = leer("app/e/[slug]/fondos/page.tsx");
const PANEL = leer("components/tms/fondo-entregas.tsx");
const FIRMA = leer("components/tms/firma-entrega.tsx");

function archivosRuta(dir: string): string[] {
  const base = new URL(`../../${dir}/`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
  const salida: string[] = [];
  const recorrer = (d: string) => {
    for (const nombre of readdirSync(d)) {
      const p = join(d, nombre);
      if (statSync(p).isDirectory()) recorrer(p);
      else if (nombre === "route.ts") salida.push(p);
    }
  };
  recorrer(decodeURIComponent(base));
  return salida;
}

describe("pantalla Solicitudes de fondo", () => {
  it("la acción se llama «Registrar entrega» y el botón final «Emitir entrega» (no «Emitir» a secas)", () => {
    expect(PAGINA).toContain("Registrar entrega");
    expect(PANEL).toContain("Emitir entrega");
    expect(PAGINA).not.toMatch(/>\s*Emitir\s*</);
  });

  it("solo se ofrece cuando las reglas comunes lo permiten (opcionesRegistro) y nunca por rol fijo", () => {
    expect(PAGINA).toContain('opcionesRegistro(actorEntrega, "FONDOS"');
    expect(PAGINA).toContain("opciones.permitido");
    // Nada de decidir por el nombre del rol (salvo el bypass de Admin que ya traen las reglas comunes).
    expect(PAGINA).not.toMatch(/rol === "(Operaciones|JefeOperaciones|GerenteOperaciones|Contabilidad)"/);
  });

  it("la bandeja «Entregas por recibir» solo se monta si el usuario puede recibir en algún área", () => {
    expect(PAGINA).toContain("areasRecepcionDelActor(actorEntrega).FONDOS.length > 0");
    expect(PAGINA).toMatch(/puedeRecibirEntregas \? <EntregasPorRecibir/);
  });

  it("el estado de entrega pendiente se muestra en el listado y el historial se abre bajo la fila", () => {
    expect(PAGINA).toContain("resumenEntregas[s.id]?.pendiente");
    expect(PAGINA).toContain("<HistorialEntregas");
  });

  it("el resumen se pide UNA vez por listado (sin N consultas) y no hay polling", () => {
    expect(PAGINA).toContain("/tms/fondos/entregas/resumen?ids=");
    for (const fuente of [PAGINA, PANEL, FIRMA]) {
      expect(fuente).not.toMatch(/setInterval\s*\(/);
    }
    expect(PANEL).not.toMatch(/setTimeout\s*\([^)]*cargar/);
  });

  it("liquidar, autorizar y rechazar de Fondos siguen en sus propios flujos (cambiarEstado) y no se tocan", () => {
    expect(PAGINA).toContain('cambiarEstado(s.id, "liquidar")');
    expect(PAGINA).toContain('cambiarEstado(id, "autorizar")');
    expect(PAGINA).toContain('cambiarEstado(s.id, "rechazar")');
  });
});

describe("componentes de entrega", () => {
  it("las acciones y los textos pedidos existen", () => {
    for (const texto of ["Entregas por recibir", "Registrar recepción presencial", "Anular entrega", "Recibir", "Rechazar", "Actualizar"]) {
      expect(PANEL).toContain(texto);
    }
  });

  it("los destinos del formulario vienen de `opciones.destinos` (catálogo común), no de una lista fija en pantalla", () => {
    expect(PANEL).toContain("opciones.destinos.map");
    expect(PANEL).not.toMatch(/"TESORERIA"\s*,\s*"CONTABILIDAD"/);
    expect(PANEL).not.toContain("DEFINICIONES_ENTREGA");
  });

  it("el modo PRESENCIAL solo se ofrece si `opciones.modos` lo incluye (permiso)", () => {
    expect(PANEL).toContain('opciones.modos.includes("PRESENCIAL")');
  });

  it("firma: se reutilizan SelectorFirma/FirmaCanvas y «Mi firma»; la presencial es solo dibujada", () => {
    expect(FIRMA).toContain("SelectorFirma");
    expect(FIRMA).toContain("FirmaCanvas");
    expect(FIRMA).toContain("/mi-firma");
    expect(PANEL).toMatch(/soloDibujada/);
  });

  it("idempotencia: el registro usa la clave de envío del patrón del repo y el guard anti doble clic", () => {
    expect(PANEL).toContain("nuevaClaveEnvio");
    expect(PANEL).toContain("crearGuardEnvio");
    expect(PANEL).toContain('fd.set("claveIdempotencia"');
  });

  it("no pide documento de identidad en la recepción presencial", () => {
    // Sin comentarios: el código documenta justamente que NO se pide.
    const codigo = PANEL.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(codigo).not.toMatch(/DPI|identificaci[oó]n|documento de identidad/i);
  });

  it("el cliente no envía empresa, usuario ni rol: solo datos de la operación", () => {
    for (const prohibido of ["empresaId", "usuarioId", "empresa_id", "usuario_id", '"rol"', "esAdmin"]) {
      expect(PANEL).not.toContain(`fd.set(${prohibido.startsWith('"') ? prohibido : `"${prohibido}"`}`);
      expect(PANEL).not.toMatch(new RegExp(`JSON\\.stringify\\(\\{[^}]*${prohibido.replace(/"/g, "")}`));
    }
  });
});

describe("endpoints de entregas de Fondos", () => {
  const rutas = archivosRuta("app/api/empresas/[slug]/tms/fondos").filter((p) => /entregas/.test(p));

  it("existen las 7 rutas esperadas", () => {
    expect(rutas.length).toBe(7);
  });

  it("ninguna escribe en documento_entregas ni usa SQL: todo pasa por el servicio común", () => {
    for (const ruta of rutas) {
      const src = readFileSync(ruta, "utf8");
      expect(src, ruta).not.toMatch(/INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|getPool|from "mysql2/i);
      expect(src, ruta).not.toContain("documento_entregas");
    }
  });

  it("todas resuelven empresa y actor con la puerta común de sesión (requireTenantEntregas)", () => {
    for (const ruta of rutas) {
      const src = readFileSync(ruta, "utf8");
      expect(src, ruta).toContain("requireTenantEntregas");
      // Nunca toman la empresa de la URL/cuerpo: siempre `guard.empresa.id`.
      expect(src, ruta).not.toMatch(/empresaId:\s*(Number\(|body\.|form\.get)/);
    }
  });
});
