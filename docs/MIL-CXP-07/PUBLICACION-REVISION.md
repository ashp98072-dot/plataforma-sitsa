# MIL-CXP-07 — Publicación controlada para revisión independiente

Fecha: 2026-11-06 (Guatemala). Rama exclusiva `feature/mil-cxp07-permisos-fiscales`, padre previsto `b350cac75bb698719fb8b79f8c0082fd8623482b` (main del inicio de MIL-CXP-07 y main remoto comprobado antes de publicar).

**Publicación autorizada sólo para auditoría independiente. No aprobado para integración, merge ni producción.**

## Alcance seleccionado

Tres archivos funcionales: HTTP de proveedores, proyección de proveedores y cliente CxP. Pruebas: dos suites nuevas H-01/consumidores y ajuste explícito de capacidad en dos llamadas del test DB existente. No se modificaron otros módulos, permisos centrales, H-02, esquemas ni migraciones.

Se publican exactamente estos trece archivos:

```text
docs/MIL-CXP-07/FASE-2/README.md
docs/MIL-CXP-07/FASE-2/regresion-h01.json
docs/MIL-CXP-07/PROPUESTA-FASE-2.md
docs/MIL-CXP-07/PUBLICACION-REVISION.md
docs/MIL-CXP-07/README.md
docs/MIL-CXP-07/VERIFICACION.md
docs/MIL-CXP-07/reproduccion-h01.json
src/components/contabilidad/cxp-client.tsx
src/lib/contabilidad/cxp/cxp-m3a.db.test.ts
src/lib/contabilidad/cxp/http.ts
src/lib/contabilidad/cxp/mil-cxp07-consumidores.dom.test.ts
src/lib/contabilidad/cxp/mil-cxp07-h01.test.ts
src/lib/contabilidad/cxp/proveedor-fiscal.ts
```

Los ZIP de entrega, sus hashes externos, manifiestos ligados a esos paquetes, logs crudos, JSON del runner con rutas locales, patches y capturas de estado Git **quedan fuera del commit** y se conservan localmente. No se incluyen dependencias instaladas, variables de entorno, bases, configuraciones privadas o archivos temporales.

Los documentos raíz de MIL-CXP-07 conservan el estado histórico de Fase 1 y la propuesta previa. Sus menciones a resultados, fuentes o archivos de evidencia locales corresponden a aquella fase. El comportamiento corregido y los riesgos actuales están en `FASE-2/README.md`; este documento registra la selección final de publicación. Las referencias a «sin commit» describen el estado de las entregas previas, no impiden esta publicación posterior expresamente autorizada.

Los dos JSON de respuesta publicados permiten comparar el defecto original y la respuesta corregida usando sólo datos sintéticos. Los tests actuales escriben la evidencia de Fase 2; no sobrescriben la reproducción histórica.

## Comportamiento e impacto operativo

Sin permiso fiscal efectivo, el listado conserva campos comerciales y devuelve `fiscal:null`; la consulta no lee configuración fiscal. La capacidad procede de `requireTenantCxp`, nunca de parámetros del cliente. Fiscal/Admin conservan el acceso existente; no se amplía el permiso de registrar o editar.

Los selectores usan únicamente proveedores comercialmente activos. Por ello pueden mostrar un proveedor sin configuración fiscal operativa. La configuración se valida en los servicios existentes al calcular/registrar facturas; el proveedor no válido recibe el rechazo ya existente. Para pagos se siguen cargando sus facturas y aplicando las restricciones de escritura existentes. No se publica un indicador nuevo de existencia/estado de configuración ni se filtra indirectamente el catálogo por esa información reservada.

Este impacto de experiencia requiere revisión independiente antes de integrar. La alternativa de mostrar sólo elegibles o un indicador operativo exigiría aprobar expresamente qué información fiscal indirecta se permite revelar; no está implementada ni se conceden permisos adicionales.

## Verificaciones finales requeridas para publicar

- Focalizadas: **93/93 PASS**, tres archivos.
- Regresión CxP offline: **368/368 PASS**, veintidós archivos; sin fallos esperados ni omitidos dentro de ese conjunto. Suites DB excluidas expresamente.
- TypeScript global `--noEmit --incremental false`, ESLint de los seis TS/TSX afectados `--max-warnings 0` y `git diff --check`: deben terminar sin errores antes del commit.
- Los datos de pruebas/respuestas son sintéticos; sesión, membresías y frontera de BD se sustituyen. No hay datos reales, secretos ni autenticadores reales en el conjunto publicado. Las referencias a variables de entorno del test DB son código de prueba, no credenciales incrustadas.
- La cuenta `ashp98072-dot` se selecciona sólo para la operación remota autorizada, sin cambiar la configuración persistente.

Reproducción:

```powershell
node node_modules/vitest/vitest.mjs run src/lib/contabilidad/cxp/mil-cxp07-h01.test.ts src/lib/contabilidad/cxp/mil-cxp07-consumidores.dom.test.ts src/lib/contabilidad/cxp/cxp-http.test.ts --no-file-parallelism --reporter=dot
node node_modules/vitest/vitest.mjs run src/lib/contabilidad/cxp --exclude '**/*.db.test.ts' --no-file-parallelism --reporter=dot
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js src/lib/contabilidad/cxp/http.ts src/lib/contabilidad/cxp/proveedor-fiscal.ts src/components/contabilidad/cxp-client.tsx src/lib/contabilidad/cxp/mil-cxp07-h01.test.ts src/lib/contabilidad/cxp/mil-cxp07-consumidores.dom.test.ts src/lib/contabilidad/cxp/cxp-m3a.db.test.ts --max-warnings 0
git diff --check
```

## Pendientes preservados

H-01 corregido y probado localmente en proceso/DOM simulado, pendiente de dictamen independiente e integración. No es validación con motor SQL, usuarios reales, middleware o navegador real. H-02 permanece abierto y sin cambios. La comprobación de M-3A/M-3B1 reales y la conciliación histórica Milenium siguen pendientes. Sin SQL, migraciones, PR, merge, squash, rebase ni intervención productiva.
