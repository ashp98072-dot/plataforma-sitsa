import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { NotificacionesBell } from "./notificaciones-bell";

/**
 * COMPRAS-NOTIFICACIONES (Parte 8) — antes `puedeVer` era una allowlist
 * fija de roles que ni siquiera disparaba la petición para roles fuera
 * de la lista (p. ej. CoordinadorCompras, el más obvio candidato a
 * recibir compras_autorizar). El ajuste mínimo seguro fue dejar de
 * gatear por rol en el cliente — el filtrado real de QUÉ alerta ve cada
 * quien siempre lo hizo (y lo sigue haciendo) el propio endpoint por
 * sesión/permiso, ver src/app/api/empresas/[slug]/notificaciones/route.ts.
 */
it("la campana se monta para cualquier rol, incluidos los que antes quedaban excluidos por la allowlist fija", () => {
  for (const rol of ["CoordinadorCompras", "Reclutamiento", "Marcaje", "Contabilidad", "Piloto", "Visualizador", "Operaciones", "Admin"]) {
    const html = renderToStaticMarkup(createElement(NotificacionesBell, { slug: "a", rol }));
    expect(html).toContain('aria-label="Notificaciones"');
  }
});

it("no reintroduce una allowlist de roles hardcodeada: el filtrado real sigue siendo exclusivo del endpoint", () => {
  const source = readFileSync("src/components/notificaciones-bell.tsx", "utf8");
  expect(source).not.toMatch(/rol === "(Admin|RRHH|Operaciones|GerenteOperaciones|JefeOperaciones|AuxiliarOperaciones|Facturador|CoordinadorPredios)"/);
});
