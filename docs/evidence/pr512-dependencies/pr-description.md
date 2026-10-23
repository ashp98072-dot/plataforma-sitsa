## Resultado

Actualiza las dependencias vulnerables reportadas por Hostinger desde main con el PR #511 integrado, manteniendo la aplicación y sus reglas de negocio. El audit de producción baja de **2 vulnerabilidades a 0**. El audit completo baja de **10 a 5**; las cinco restantes son de desarrollo y proceden de un aviso retirado, explicado abajo. No se usa audit fix --force ni se excluyen alertas.

| Paquete | Antes → después |
| --- | --- |
| Next.js | 16.3.6 → 16.4.1 |
| eslint-config-next | 16.2.12 → 16.4.1 |
| Vitest / @vitest/mocker | 4.1.11 → 4.1.12 |
| Vite transitivo | 8.2.2 → 8.2.4 |
| source-map-js transitivo | 1.2.1 → 1.2.2 |

Se mantienen React/React DOM 19.2.4 y sharp 0.35.5. El lockfile se actualiza con npm; Vite queda limitado mediante override dentro de Vitest a un parche compatible de la misma línea. Se ajusta engines a los requisitos efectivos y se limita `npm run dev` a localhost. La prueba existente de workers verifica la nueva versión fijada.

## Hostinger y pendientes

**Recomendación de build: Node 22 compatible con engines.** Next 16.4.1 sustituye workerThreads por childProcesses en Node >=24.13.1 por un fallo conocido de Node. El build local con Node 24.18.0 pasa, pero ese fallback podría reactivar la limitación de procesos de loaders en Hostinger compartido. Con Node **22.23.4** se verificaron workerThreads resueltos, cpus=1 y build completo. No se fuerza el bypass de esa protección. No se modifica el servidor Hostinger ni se despliega.

El audit completo sigue en exit 1: `braces → micromatch → fast-glob → @next/eslint-plugin-next → eslint-config-next`. [GHSA-vfj7-8cjw-p6xm fue retirado por GitHub el 23/10/2026](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) por no ser prácticamente explotable; npm aún lo reporta y no existe braces corregido publicado. No se oculta ni se aplica el downgrade a Next/ESLint 14 propuesto por audit.

## Validación y límites

- npm ci actualizado correcto con Node 24.18.0/npm 11.16.0 y Node 22.23.4/npm 10.9.9; un primer intento tuvo ECONNRESET y fue repetido limpiamente.
- TypeScript: exit 0. ESLint de archivos cambiados/scripts de auditoría: exit 0.
- ESLint global: **40 errores previos antes y después**, diagnósticos idénticos; no se presenta como aprobado.
- Suite completa: **11,363 aprobadas, 31 fallidas y 749 omitidas** en 731 archivos, idénticos conteos y nombres de fallo antes/después; cero fallos nuevos. Los fallos previos se enumeran en la evidencia.
- Áreas prioritarias: **1,199 casos aprobados y cero fallidos en 110 archivos** dentro de la suite completa.
- Regresión adicional en Node 22: **375 pruebas aprobadas en 37 archivos**.
- Builds limpios Next 16.4.1 con Node 24 y Node 22: exit 0, 54/54 páginas y un worker de prerender. Warnings preservados en logs.
- Tras podar devDependencies: **11 comprobaciones de runtime aprobadas en cada Node**, en localhost sin credenciales/BD, rechazando fallback a node_modules de worktrees padres. Se restauran después las herramientas de desarrollo.

No se ejecutan pruebas con BD real, login autenticado en navegador ni operaciones en producción. No se cambia SQL, migraciones, guards, origen/CSRF, permisos, aislamiento multiempresa, reglas de negocio, UI ni GitHub Actions. Sin merge ni deploy. Se mantiene en Draft para auditoría independiente.

[Informe, fuentes y comandos reproducibles](https://github.com/ashp98072-dot/plataforma-sitsa/blob/security/pr512-dependency-updates/docs/SECURITY-PR512-DEPENDENCIAS.md) · [Evidencia](https://github.com/ashp98072-dot/plataforma-sitsa/tree/security/pr512-dependency-updates/docs/evidence/pr512-dependencies)
