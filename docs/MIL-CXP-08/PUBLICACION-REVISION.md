# MIL-CXP-08 — Publicación para auditoría independiente

Base comprobada: `origin/main` en `8790929f18c8394f759ef3dd0dd61d18c14a1ad9`. Rama exclusiva: `feature/mil-cxp08-consistencia-reportes`. La publicación no implica aprobación para integración ni producción.

El cambio funcional añade únicamente `{ lecturaRepetible: true }` a `enInstantanea()` en antigüedad y estado de cuenta. El helper compartido, los cálculos, consultas, filtros, permisos, paginación y exportación quedan intactos. El helper establece el aislamiento antes de iniciar la transacción.

Antes, el modelo reproducía filas y totales de versiones diferentes bajo READ COMMITTED; después, ambos casos originales son pruebas normales aprobadas. Las evidencias JSON son sintéticas: la evidencia de esta carpeta corresponde al diagnóstico anterior y la de FASE-2 al resultado corregido. No son registros de MariaDB ni datos reales.

## Verificaciones repetidas antes de publicar

- Focalizadas: 33/33 PASS, sin fallos esperados.
- Regresión CxP offline: 401/401 PASS, 23 archivos.
- TypeScript: `node node_modules/typescript/bin/tsc --noEmit --incremental false`, exit 0.
- ESLint de los cuatro archivos TS incluidos: `--max-warnings 0`, exit 0.
- `git diff --check` y comprobación del índice: sin errores.
- Suite concurrente MariaDB: cuatro casos SKIP por ausencia de autorización. No se abrió conexión ni se ejecutó SQL. La validación real sigue pendiente.

La regresión heredada genera un JSON MIL-CXP-07; se restituyó su contenido de HEAD y se excluyó del commit. Se excluyen ZIP, manifiestos de paquetes externos, patches, logs, salidas de runners y estados temporales. El README de FASE-2 conserva el informe previo a publicación; sus referencias a paquetes/logs locales y su cierre «sin commit/push» describen aquella entrega, no archivos adicionales de esta publicación.

## Lista exacta autorizada para el commit

```text
src/lib/contabilidad/cxp/antiguedad.ts
src/lib/contabilidad/cxp/estado-cuenta.ts
src/lib/contabilidad/cxp/mil-cxp08-instantanea.test.ts
src/lib/contabilidad/cxp/mil-cxp08-concurrencia.db.test.ts
docs/MIL-CXP-08/evidencia-modelo.json
docs/MIL-CXP-08/FASE-2/README.md
docs/MIL-CXP-08/FASE-2/LABORATORIO-PENDIENTE.md
docs/MIL-CXP-08/FASE-2/evidencia-modelo.json
docs/MIL-CXP-08/PUBLICACION-REVISION.md
```

## Límites y riesgos pendientes

No existe laboratorio vigente autorizado. La suite concurrente requiere autorización posterior, identidad y propiedad verificadas del laboratorio y fixtures exclusivamente sintéticos previamente aprovisionados; no ejecuta migraciones. El modelo en memoria no certifica MVCC ni recuperación real de sesiones MariaDB ante errores de START/COMMIT. El helper no se amplía en este ticket.

La instantánea corresponde a cada ejecución, no a solicitudes sucesivas de páginas/exportación. Las exportaciones largas pueden retener versiones InnoDB y requieren medición posterior autorizada. M-3A/M-3B1 reales y conciliación histórica Milenium permanecen pendientes. H-02 queda corregido en código y pruebas aisladas, pendiente de auditoría e integración; no se declara validado en motor ni producción.

No se incluyen credenciales, datos reales ni cambios ajenos. No se abre PR ni se realiza merge, SQL, migraciones o despliegue. La rama se publica sólo para auditoría independiente.
