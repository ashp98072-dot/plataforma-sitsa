# MIL-CXP-06 — Auditoría y preparación operativa de Cuentas por Pagar

Fecha: 2026-11-06, Guatemala. Fase: auditoría y diseño. **No autoriza implementación, integración ni producción.**

## Dictamen

El núcleo de proveedores fiscales, facturas normales, pagos aplicados, reversos completos y reportes actuales está implementado e integrado. Hay evidencia técnica y pruebas sintéticas; no se acredita equivalencia operativa completa con Milenium, importación del histórico, conciliación de saldos reales ni aplicación de migraciones en producción. Recomendación: continuar con validación de permisos, consistencia de reportes y discovery del origen; mantener bloqueada la habilitación productiva hasta cerrar los criterios del plan.

## Expediente

- [Inventario y diagnóstico](01-INVENTARIO-Y-DIAGNOSTICO.md).
- [Matriz Milenium → Novalvion](02-MATRIZ-MILENIUM.md).
- [Preparación operativa, aceptación y próximos tickets](03-PLAN-OPERATIVO.md).
- [Evidencia verificable](evidencia.json): identidad de revisión, hashes, cobertura y comparación de código.
- [Verificación final](04-VERIFICACION.md): **300/300 pruebas offline PASS en 20 archivos**, exit 0. `verificacion-offline-final.log` conserva la salida; `verificacion-offline.log` conserva el intento inicial incompleto por dependencia DOM ausente.

## Verificación inicial obligatoria

1. Se ejecutó `git fetch origin main` sin integrar cambios. `origin/main` pasó de `d4efd59d` a **a85df2648121cb419ca7e9d866512f2f326415b7**, merge #575. Esta es la referencia observada al inicio, no una afirmación de inmovilidad futura de main.
2. Se leyeron `AGENTS.md` y `CLAUDE.md` de raíz y de la base aislada. `rg --files -g AGENTS.md -g CLAUDE.md` en la base identifica sólo ambos archivos raíz. Se revisó el plan raíz `PLAN-PORTAL-PILOTOS.md`: trata de pilotos/RRHH, fuera de CxP; no se modificó. No se escribió código Next.js; no fue necesario aplicar guías de implementación de Next.
3. Merges comprobados en la historia de `origin/main`:

| Entrega | Merge | PR |
| --- | --- | --- |
| M-3A | 1adf9cd7 | #481 |
| M-3B1 | 9373adf4 | #491 |
| Bitácora | 303ef272 | #498 |
| MIL-CXP-01 antigüedad | 0d8dafc6 | #554 |
| MIL-CXP-02 estado de cuenta | 424dc6c8 | #556 |
| Corrección de lectura sobreaplicada | 0c793ba3 | #562 |
| MIL-CXP-03 integridad | 3fbbe9cb | #564 |
| MIL-CXP-04 Excel integridad | f035bec9 | #566 |
| MIL-CXP-05 suite MariaDB | cb1c351c | #568 |

Integración Git no equivale a aprobación financiera o productiva.

4. Localizado `docs/CXP-QA-MARIADB-MIL-CXP-05.md` (preparación de suite) y el expediente local **`artifacts/auditoria-mil-cxp05-lab02-20261105/`** del workspace principal (fuera de este worktree). LAB-02 documenta ejecución posterior: 12 PASS, 0 FAIL, 0 SKIP sobre `59aef47a99fd12d287915a16c169cce7d8c7604a`. El documento integrado de CXP-05 aún dice integración pendiente: discrepancia de cronología documental, no evidencia de fallo del laboratorio. No se reescribió esa entrega.
5. M-3A y M-3B1 existen; los hashes de las migraciones actuales coinciden con LAB-02. Aplicación comprobada documentalmente **sólo en la base desechable**. Estado de cualquier base real: **PENDIENTE DE COMPROBACIÓN**.
6. El workspace inicial pertenece a `feature/c3c2-control-periodos` y tenía cambios ajenos. Se creó **`.worktrees/mil-cxp06`**, detached HEAD en main observado, sin crear rama. No se reutilizó PriceSmart ni se editaron otros worktrees. Fetch y registro del worktree modifican metadatos Git; no se ejecutó commit, push, merge o PR.
7. Antes de crear este expediente: sin coincidencias de MIL-CXP-06/MIL-CXP06 en docs/artifacts consultados, nombres de ramas locales/remotas y log Git `--all` (incluyendo variante cxp-06). No había worktree cxp06 en el inventario. **No se comprobó el inventario remoto de issues/PR abiertos**; la ausencia de expediente local no acredita ausencia de un ticket remoto. Esta entrega es documental y no duplica implementación.

## Alcance de la evidencia

IMPLEMENTADO = existe código integrado. VERIFICADO TÉCNICAMENTE = inspección o chequeo técnico con alcance explícito. PROBADO = ejecución con evidencia identificada. APROBADO = decisión explícita para un alcance concreto; un merge o PASS no la sustituye. PENDIENTE = ausencia de prueba, decisión, datos o capacidad.

Se verificaron los 12 hashes de `SHA256SUMS.json` del paquete sanitizado; `ORIGINALES-SHA256.json` contiene un registro histórico de verificación de originales privados, **no** una nueva verificación de esos originales. No hay sello externo que demuestre integridad retrospectiva absoluta. Se consultaron informe, resumen, JSON Vitest y métricas sin abrir conexiones SQL ni arrancar servicios. La aprobación de QA declarada por LAB-02 se limita a sus 12 casos.

Entre la base LAB-02 y main auditado, `git diff 59aef47a origin/main -- src/lib/contabilidad/cxp src/components/contabilidad/cxp* sql/*cxp*` no arroja cambios. Esto vincula las fuentes CxP examinadas, no certifica dependencias transitivas, despliegue o configuración del entorno real.

## Entrega a auditoría independiente

Entregar esta carpeta completa y el paquete sanitizado LAB-02 ya existente. El revisor debe confirmar hallazgos H-01/H-02, límites de cobertura, semántica de origen y separación entre QA y autorización productiva. No se enviaron mensajes a terceros ni se publicó el expediente. Se detiene el trabajo al completar documentación y verificación; toda fase posterior requiere nueva autorización.

