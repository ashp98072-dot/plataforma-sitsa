# MIL-CXP-08 — Fase 2: corrección mínima de H-02

Fecha: 2026-11-06 (Guatemala). Rama: `feature/mil-cxp08-consistencia-reportes`. **Corrección implementada y verificada con pruebas aisladas; pendiente de auditoría independiente y validación MariaDB.** Sin commit, push, PR, merge, rebase, SQL, migraciones ni despliegue.

## Actualización de base

Se actualizó la referencia de main de `9d684f876c9a3638aed739496665df73dbec879d` a **`8790929f18c8394f759ef3dd0dd61d18c14a1ad9`**. Entre ambas referencias sólo había dos documentos PriceSmart ya integrados en main (#579); ningún archivo CxP o dependencia cambió. No se importó una rama ajena ni se modificaron esos documentos como parte del ticket.

La rama no tenía commits propios ni archivos rastreados modificados. Se avanzó su puntero/base al main vigente mediante `git switch -C` después de comprobar la relación de ancestro y ausencia de cambios rastreados, conservando el diagnóstico no rastreado y el ZIP anterior. No se hizo merge/rebase ni se modificaron otros worktrees. El diff propio se compara contra este main actualizado.

## Diff funcional exacto

Sólo cambia una línea en cada reporte:

```diff
--- a/src/lib/contabilidad/cxp/antiguedad.ts
+++ b/src/lib/contabilidad/cxp/antiguedad.ts
@@
     return { filas, tot };
-  });
+  }, { lecturaRepetible: true });
--- a/src/lib/contabilidad/cxp/estado-cuenta.ts
+++ b/src/lib/contabilidad/cxp/estado-cuenta.ts
@@
     return { prov, filas, tot, lineas, integ };
-  });
+  }, { lecturaRepetible: true });
```

`diff-funcional.patch` conserva la salida exacta de Git. **Dos archivos funcionales, dos inserciones y dos eliminaciones.**

No se modifica `lectura-cxp.ts`. La opción existente hace que el helper ejecute `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ` antes de `START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY`. Se aplica a cada ejecución de `consultarUnaVez`, por lo que cubre pantalla, exportación y cada intento del fallback sin pagos. Es una característica de esa transacción; no se cambia el default del pool o del servidor.

Se conservaron byte a byte en la base las consultas/cálculos de negocio, filtros, permisos, Decimal, orden, paginación, SQL fiscal, formato de exportación y helper. No se introducen bloqueos de filas/tablas ni cambios de aislamiento en escrituras. Integridad ya usaba la misma opción y permanece intacta.

## Antes/después de los dos casos H-02

Estos resultados son del **modelo en memoria**, no de MariaDB. El modelo usa sesión default RC y un cambio sintético confirmado después de leer las filas y antes de los agregados/detalles.

| Caso | Diagnóstico anterior (fallo esperado) | Ahora, regresión normal |
| --- | --- | --- |
| Antigüedad | Fila saldo 100.01, total 79.99 | Fila y total 100.01 |
| Estado de cuenta | Fila pagado 0.00, total/línea 20.02, advertencia de discrepancia | Fila y total pagado 0.00, sin la línea posterior ni advertencia espuria |

Ambos `it.fails` se convirtieron a `it` normales. Los casos que antes caracterizaban ausencia de SET y resultados mezclados ahora exigen SET RR seguido de START y resultados alineados, tanto bajo default RC como RR. Se mantuvo el control del helper sin opción (continúa heredando RC) para demostrar que la solución está acotada a los dos callers, no a un cambio global del modelo/helper.

Las distintas solicitudes siguen usando instantáneas distintas. Una lectura siguiente puede observar el movimiento posterior; no se promete que navegar páginas o exportar desde una pantalla anterior conserve una fotografía persistente entre requests.

## Cobertura ejecutada

| Comprobación | Resultado |
| --- | --- |
| Suite focalizada MIL-CXP-08 | **33/33 PASS**, exit 0, cero fallos esperados |
| Regresión CxP offline | **401/401 PASS**, 23 archivos, exit 0 |
| TypeScript global | `--noEmit --incremental false`: exit 0 |
| ESLint de los cuatro TS afectados | `--max-warnings 0`: exit 0 |
| `git diff --check` | Exit 0 |
| Suite futura de motor sin autorización | **4 SKIP**, exit 0; ninguna conexión/SQL. No cuentan como PASS |

La suite focalizada usa servicios/helper reales sobre un modelo MVCC explícito. Incluye:

- Lectura y exportación de ambos reportes bajo default RC y RR; secuencia SET → START y una sola vista dentro de cada transacción.
- Segunda página con total global, sin confundir total del conjunto con suma de la página.
- Reintento por tablas de pagos ausentes para las cuatro variantes: primera conexión hace COMMIT/release; la nueva vuelve a fijar RR antes de START; no reutiliza el snapshot anterior y no consulta tablas de pagos en fallback.
- Fallos de SET, START y COMMIT para las cuatro variantes: propagan el error, liberan una vez la conexión y no producen respuesta normal ni reintento por error desconocido.
- Error de consulta dentro de la transacción: cierre y release; ausencia de consultas fiscales/pagos cuando no hay capacidad; transacción siguiente que ve la nueva versión.

### Qué se verificó de los errores, y qué no

El helper actual libera la conexión incluso si SET, START o COMMIT falla. Ante error del callback intenta COMMIT porque es una transacción READ ONLY. Se verificó ese contrato existente, **sin cambiarlo**.

La prueba de COMMIT fallido no afirma que el motor haya cerrado la transacción o que la conexión sea segura para reutilizar: sólo verifica propagación y llamada a release. En el modelo, un COMMIT rechazado no se da por exitoso. Tampoco se certifica el estado real de la característica de «siguiente transacción» tras un START fallido. Estos casos requieren ensayo de motor y eventual ticket específico si se reproduce un defecto. No se demostró un defecto nuevo necesario para ampliar el helper dentro de H-02.

## Prueba MariaDB preparada, no ejecutada

Se añade `src/lib/contabilidad/cxp/mil-cxp08-concurrencia.db.test.ts`, con cuatro variantes (dos reportes × lectura/exportación). Está desactivada por defecto; no utiliza `DB_*`, `.env` ni `LIQ_TEST_DB_PORT`. Exige una autorización explícita y datos de identidad/propiedad antes de abrir socket; valida identidad antes de permitir escrituras.

Emplea dos conexiones físicas distintas, una barrera después de leer página y un escritor que confirma un cambio de un pago sintético. El lector debe mantener filas/totales/líneas del estado anterior; la siguiente lectura debe ver el cambio. No tiene CREATE/ALTER/DROP ni migraciones. Requiere esquema/fixtures previamente aprovisionados y exclusivos; restaura sólo el pago sintético designado. Detalles, condiciones y riesgos de ejecución futura: [LABORATORIO-PENDIENTE.md](LABORATORIO-PENDIENTE.md).

Se verificó únicamente que sin autorización los cuatro casos se omiten y no corren hooks de conexión. No se declara funcionamiento de la suite en un motor real ni se presenta como laboratorio acreditado. **No se ejecutó SQL en esta fase.**

## Archivos afectados

Funcionales modificados:

1. `src/lib/contabilidad/cxp/antiguedad.ts`.
2. `src/lib/contabilidad/cxp/estado-cuenta.ts`.

Pruebas nuevas/no rastreadas de MIL-CXP-08:

3. `src/lib/contabilidad/cxp/mil-cxp08-instantanea.test.ts`: actualizada respecto del diagnóstico, regresiones y errores/fallback.
4. `src/lib/contabilidad/cxp/mil-cxp08-concurrencia.db.test.ts`: preparada para ejecución posterior autorizada, ahora inerte.

Documentos/evidencias de esta fase: esta carpeta, patch exacto, logs/JSON, manifiesto y paquete de revisión externo. El diagnóstico y ZIP anteriores se conservan como historia del antes; su manifiesto anterior identifica la suite original archivada, no la suite actualizada en el workspace.

La regresión heredada MIL-CXP-07 genera su JSON de respuesta al ejecutarse; se restituyó ese artefacto a HEAD y se refrescaron metadatos de ese archivo en este worktree. No quedó un cambio de contenido ajeno a MIL-CXP-08 ni se alteraron sus pruebas.

## Riesgos pendientes y decisión

- El modelo no certifica MVCC, liberación real, estado de sesión ni concurrencia MariaDB. **Validación real pendiente: cuatro casos preparados, ninguno ejecutado.**
- Exportaciones largas pueden retener versiones InnoDB más tiempo. Los límites existentes no sustituyen medición de carga autorizada.
- La consistencia se garantiza por ejecución de reporte bajo el contrato de transacciones InnoDB; no se ofrece una fotografía común entre solicitudes, páginas o descargas posteriores.
- No se cambian fallback, política de permisos/libros, retenciones, importes ni interpretación de saldos históricos. Las comprobaciones reales de M-3A/M-3B1 y conciliación Milenium siguen pendientes.
- H-02 queda **corregido localmente y aprobado por las pruebas aisladas**, pendiente de auditoría independiente, validación real e integración. No se declara aprobado para producción.

Detención para auditoría independiente de ChatGPT. Sin commit, push, PR, merge, SQL productivo, migraciones o despliegue.
