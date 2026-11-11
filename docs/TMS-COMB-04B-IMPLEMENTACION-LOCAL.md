# TMS-COMB-04B — Implementación local condicionada

Fecha: 2026-11-11. Base: `fd27b6378791577bcbf6a22f585237f1e929e453`. Rama: `feature/tms-comb04-idempotencia-vales`. Estado: **implementación preparada para publicación controlada autorizada; pendiente de auditoría independiente del commit publicado**. 04B no se considera terminado hasta esa auditoría.

## Condición de seguridad que sustituye la compensación del diseño inicial

El diseño publicado en `TMS-COMB-04B-DISENO-EVIDENCIA-STAFF.md` contemplaba compensar un upload propio tras rollback confirmado. La autorización posterior condiciona ese diseño: `guardarUpload()` usa un componente aleatorio pero no creación exclusiva; devolver una ruta y validarla no demuestra propiedad exclusiva ni ausencia de referencias ajenas.

**Esta implementación no compensa automáticamente ningún archivo**, tampoco tras un error anterior al COMMIT con rollback confirmado. Se retiran de staff los imports y llamadas a `borrarUpload` y `validarRutaArchivoEmpresa`. No se modifica `uploads.ts`, no se añade una compensación alternativa, no se buscan referencias con SQL ni se ejecutan tareas de limpieza.

## Diff funcional acotado

Solo cambia `guardarCombustibleStaff` dentro de `src/lib/flota/combustible-staff.ts`:

- Estados independientes de transacción (`INICIO_EN_CURSO`, `ABIERTA`, `COMMIT_INTENTADO`, `COMMIT_CONFIRMADO`) y rollback (`NO_INTENTADO`, `INTENTADO`, `CONFIRMADO`, `FALLIDO`). El intento se marca antes de invocar COMMIT, incluso si este arroja sin devolver Promise.
- Fallo de inicio: no se supone una transacción abierta, no se intenta rollback, se descarta la conexión y se propaga el error original.
- Error anterior al COMMIT: rollback protegido; si responde se libera la conexión, si falla se destruye. En ambos casos se conserva evidencia y el mismo objeto/valor de error original.
- Error en COMMIT: resultado desconocido aunque rollback responda. Se intenta rollback una vez como mejor esfuerzo, se destruye la conexión y se conserva evidencia. No hay reintento de la operación.
- COMMIT confirmado: se mantiene el resultado exitoso y el mismo cargaId. Una excepción de release no inicia rollback ni transforma el éxito en fallo; se intenta destroy como contingencia protegida.
- Release/destroy y diagnóstico están protegidos para no sustituir el resultado principal. Si destroy falla, no se reutiliza mediante release ni se afirma que el socket quedó cerrado.
- Diagnóstico de mejor esfuerzo solo con etapa y estados; sin payload, ruta, secretos ni texto del error secundario. Si el diagnóstico lanza, no altera éxito/error principal.

No se cambian consultas SQL, parámetros, transacción de negocio, validaciones, autorización, precio, normalización, deduplicación, campos omitidos, relaciones o formatos HTTP. No se modifican CB2, C2B, C2C, endpoints ni UI. El helper de decisión de disposición es local y no altera contratos exportados.

## Matriz implementada

| Resultado observado | Rollback | Conexión | Evidencia | Caller |
|---|---|---|---|---|
| Adquisición fallida | No se intenta | Ninguna adquirida que disponer | Sin upload de esta llamada | Mismo rechazo original |
| Inicio incierto | No se supone abierto | Destroy protegido | Conservar; flujo no llegó a upload | Mismo rechazo original |
| Error antes de COMMIT | Confirmado | Release protegido | Conservar, sin propiedad exclusiva demostrada | Mismo rechazo original |
| Error antes de COMMIT | Fallido | Destroy protegido | Conservar | Mismo rechazo original; rollback no lo sustituye |
| COMMIT incierto, mock aplicado/no aplicado | Confirmado o fallido | Destroy protegido | Conservar siempre | Mismo error de COMMIT |
| COMMIT confirmado | No se intenta | Release; si falla, destroy protegido | Conservar | Mismo cargaId, éxito |
| Disposición o diagnóstico también fallan | No cambia clasificación principal | Intento protegido, sin fallback a release tras destroy | Sin borrado | Resultado principal inmutable |

## Expectativas sustituidas de forma explícita

Se conserva el SHA `2eaa77e094170468fe63a53e68b176060454cc62` como referencia histórica de las 66 caracterizaciones 04A aceptadas. No se pretende que aquellas expectativas defectuosas sigan siendo obligaciones del producto.

| Prueba afectada | Expectativa anterior | Regresión segura local |
|---|---|---|
| 04A, fallo de INSERT/auditoría (2 casos) | Borrar evidencia nueva tras rollback confirmado | No validar propiedad por ruta ni borrar; mismo error por identidad; release tras rollback confirmado |
| 04A, COMMIT con respuesta perdida (2 casos originales) | Pedir borrado aun si COMMIT pudo aplicarse | Expandida a 4 combinaciones aplicado/no aplicado × rollback confirmado/fallido; cero borrados, destroy y mismo error original |
| 04A, rollback fallido | Error secundario oculta original; se pide borrado y release | Original preservado por identidad; cero borrados y destroy |
| 04A, edición con COMMIT incierto | Pedir borrado solo de la nueva | No pedir borrado de ninguna; mismo error original |
| Staff existente, fallo de BD (1 caso) | Compensar upload nuevo | Conservar por falta de propiedad exclusiva demostrada |

No se eliminan ni omiten pruebas para ocultar el defecto: las expectativas anteriores se sustituyen por los invariantes autorizados. No se alteran los casos de CB2/C2B ni las reglas de normalización. Las pruebas de secuencias CB2/C2B conservan sus expectativas propias de compensación: no se extrapola a staff su garantía de archivos.

Se añaden además escenarios de edición confirmada con/sin archivo nuevo, getConnection y beginTransaction fallidos, release fallido con destroy resuelto/fallido en éxito/error, destroy y diagnóstico fallidos, rechazo primitivo/null y compensadores simulados que lanzarían si fueran llamados. Cada caso del archivo de evidencia exige globalmente cero llamadas a borrado y validación de ruta.

## Validación local

Comando focal:

```text
npx.cmd vitest run src/lib/flota/combustible-04a-evidencia.test.ts src/lib/flota/combustible-staff.test.ts src/lib/flota/combustible-04a-identidades.test.ts src/lib/flota/combustible-04a-secuencias.test.ts src/lib/flota/combustible-staff-http.test.ts
```

Resultado: **145 PASS, 0 FAIL, 0 SKIP, 5 archivos**. El conteo incluye 83 casos de la familia 04A actualizada (29 evidencia/04B, 29 identidades y 25 secuencias) y 62 casos existentes de staff/HTTP. La cifra histórica de 66 sigue describiendo únicamente el SHA auditado 04A.

TypeScript completo (`npx.cmd tsc --noEmit`): **PASS, exit 0**. ESLint focal con `--max-warnings 0` sobre los tres archivos TypeScript modificados: **PASS, exit 0**. `git diff --check`, incluida la revisión del documento nuevo no rastreado: **PASS**. Se compararon los 13 literales SQL del archivo staff con la base mediante el AST de TypeScript, normalizando únicamente CRLF/LF: sin cambios. El control estático confirma ausencia de `borrarUpload` y `validarRutaArchivoEmpresa` en staff.

Todas las conexiones, queries, uploads y borrados de las pruebas focales son mocks; Excel se genera en buffers sintéticos. Los casos de estado aplicado/no aplicado representan escenarios del doble, no el resultado durable de MariaDB. El helper HTTP se ejercita con servicios/guardas simulados. No se ejecutan suites DB, SQL, migraciones, servidores ni conexiones productivas; no se lee ni altera evidencia real.

## Riesgos residuales y recuperación separada

- **Archivos huérfanos:** al no compensar ni siquiera tras rollback confirmado, un upload sin referencia puede permanecer en disco. Es la decisión conservadora exigida; no se añade GC, TTL, borrado por edad, inventario histórico ni limpieza manual.
- **Uploads no exclusivos:** esta corrección evita borrados automáticos desde staff, pero no corrige la posibilidad de colisión/sobrescritura del propio mecanismo de uploads sin creación exclusiva. No afirma que todos los archivos nuevos sean propios o que el helper garantice conservación histórica. Cambiar creación/propiedad/ausencia de referencias requiere otra mejora autorizada de uploads, con diseño y regresiones separados.
- **COMMIT desconocido:** no hay recibo idempotente durable staff. Conservar archivo no certifica que el vale se guardó ni que repetir el formulario sea seguro. Contrato y mensaje HTTP existentes permanecen iguales; revisión/recuperación futura requiere autorización específica.
- **Rollback y disposición fallidos:** se preserva el error original y se intenta destruir, pero no se prueba cierre físico ni ausencia de trabajo durable. No se reutiliza deliberadamente la conexión incierta.
- **Diagnóstico de mejor esfuerzo:** puede perderse; no se crea un registro durable nuevo. No garantiza reconciliación automática de archivos sin referencia.
- **Mocks:** no certifican propiedades del pool, atomicidad, colaciones, aislamiento o durabilidad del motor. Futuras pruebas con MariaDB desechable/fallos de transporte y revisión del mecanismo de uploads requieren autorización separada. No usar producción.

## Límite de entrega

Se autoriza exclusivamente un commit incremental y push normal de la implementación, las pruebas focales afectadas y este informe. Se detiene el trabajo después del push para auditoría independiente, sin iniciar otra fase. Sin PR, merge, despliegue, rebase, squash o force push. Main y PR #581 no se modifican; PR #582 no se incorpora. D1–D5 permanecen **NO APROBADAS**.
