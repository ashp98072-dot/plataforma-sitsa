# C3C-14 — QA funcional integral y conciliación precontable

Fecha: 30 de octubre de 2026, America/Guatemala. Base: `cdb85965`, merge del PR #538. Rama: `feature/c3c14-qa-conciliacion-precontable`.

Resultado: **162 pruebas de integración SQL y 216 pruebas unitarias/contratos/API/render aprobadas**. No se reprodujo un defecto funcional que requiriera modificar servicios de negocio. La aceptación visual autenticada sigue pendiente por fallo de las herramientas del entorno. Este informe no constituye aprobación formal ni autorización para contabilizar.

## Recorrido nuevo

Se añaden 13 pruebas de QA que crean ejercicios y libros sintéticos independientes. El recorrido usa los servicios originales: diagnóstico C3C-5, simulación C3C-6, cuenta configurada C3C-7, propuesta C3C-8, procedencia y borrador C3C-9, revisión documental C3C-10, política/solicitud/decisiones C3C-11, evidencias C3C-12 e informe/constancia C3C-13. No introduce otro motor de cálculos.

Cada escenario carga una historia anterior de ingreso 900.00, movimientos del ejercicio, un Borrador por 777.00 y un movimiento posterior al corte por 888.00. Estos dos últimos y la historia no entran en la regularización del ejercicio. Los importes esperados son constantes independientes del motor; las sumas de prueba usan centavos enteros. Los servicios no generan asientos: los movimientos solo se insertan mediante el fixture en MariaDB temporal verificada.

| Escenario | Ingresos del ejercicio | Gastos del ejercicio | Resultado | Debe simulado | Haber simulado |
| --- | ---: | ---: | ---: | ---: | ---: |
| Beneficio | 100.00 | 40.00 | 60.00 | 100.00 | 100.00 |
| Pérdida | 40.00 | 100.00 | -60.00 | 100.00 | 100.00 |
| Resultado cero | 40.00 | 40.00 | 0.00 | 40.00 | 40.00 |
| Saldos contrarios | -20.00 | -5.00 | -15.00 | 20.00 | 20.00 |
| Centavos | 0.03 | 0.02 | 0.01 | 0.03 | 0.03 |
| Sin saldos del ejercicio | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |

En los seis escenarios se comprueba cuadre original y simulado, cancelación del saldo nominal mediante la inversa, separación del saldo histórico anterior (-900.00 en la nominal de ingreso), equivalencia de propuesta entre los servicios existentes y conservación exacta de todas las filas originales del fixture después del circuito documental. La constancia técnicamente completa permanece formalmente PENDIENTE y no contabilizada.

Las siete pruebas adicionales cubren:

1. Dos empresas con escenarios válidos y resultados diferentes, libros independientes y rechazo de combinaciones cruzadas de empresa/entidad/ejercicio/solicitud.
2. Una fuente sintética nueva que cambia las huellas y desactualiza la constancia, sin modificar ninguna fila anterior de movimientos.
3. Una decisión posterior que invalida las evidencias y su recuperación mediante nuevas versiones declaradas y revisadas.
4. Revocación de evidencia: la versión anterior verificada no recupera vigencia implícita.
5. Lector, preparador, resolutor y usuario sin asignación rechazados como emisores; revocación del resolutor que bloquea al revisor.
6. Exportación real XLSX y render SSR del informe real; cinco hojas, importes correctos, cero fórmulas y originales sin cambios.
7. API en proceso con JWT firmado realmente, usuario y guard tenant reales, rechazo de token ausente/falso, GET del lector, POST prohibido al lector, constancia del revisor, reintento idempotente y exportación protegida. Solo `next/headers.cookies` está simulado; no es un login HTTP ni una prueba de navegador.

## Regresión de C3C-5 a C3C-13

Cada suite se ejecutó en un datadir y un named pipe nuevos. Se reutilizó el SQL existente hasta C3C-13; no se creó ni modificó esquema de negocio. El ejecutor verifica el binario/distribución, elimina del entorno las variables de BD operativa, comprueba identidad por conexión y exige cierre ordenado. La ejecución de la suite de propuesta C3C-8 usa una instancia C3C-14 nueva; el laboratorio temporal C3C-8 previo no fue abierto ni intervenido.

| Suite | Aprobadas | Fallidas / omitidas |
| --- | ---: | --- |
| C3C-5 | 9 | 0 / 0 |
| C3C-6 | 8 | 0 / 0 |
| C3C-7 | 12 | 0 / 0 |
| C3C-8 | 10 | 0 / 0 |
| C3C-9 | 30 | 0 / 0 |
| C3C-10 | 20 | 0 / 0 |
| C3C-11 | 31 | 0 / 0 |
| C3C-12 | 9 | 0 / 0 |
| C3C-13 | 20 | 0 / 0 |
| Recorrido C3C-14 | 13 | 0 / 0 |
| **Total SQL** | **162** | **0 / 0** |

Las suites previas cubren además concurrencia, idempotencia, auditoría/rollback, corrupción de primeras y últimas versiones, inmutabilidad por triggers, cambios de permisos y contratos/FK. Algunas pruebas previas modifican exclusivamente sus propios fixtures sintéticos para provocar fallos; no son cambios en históricos productivos. La prueba nueva C3C-14 nunca actualiza ni elimina movimientos, y verifica las filas originales antes/después.

Se ejecutaron 216 pruebas unitarias de C3C-5 a C3C-13 en diez archivos. No se presentan estos conteos como 378 escenarios de negocio independientes: varias pruebas cubren capas distintas del mismo comportamiento. TypeScript `--noEmit`, ESLint de los archivos nuevos y `git diff --check` aprobados.

Todos los preflight/migrate/postcheck existentes del ejecutor pasaron. Los cinco postcheck C3C-13 posteriores a cada suite dieron errores=0. Se confirmaron los diez cierres de servidor. La versión observada en el recorrido final fue **11.8.9-MariaDB**.

## Evidencias y reproducción

- [Instrucciones y comandos](../../../scripts/ci/c3c14/README.md) — desde este directorio, el archivo está en la raíz del repositorio bajo `scripts/ci/c3c14/README.md`.
- [Evidencia JSON](evidencia.json): nombres/estados de las 162 pruebas SQL, conteos unitarios, cierres confirmados, postcheck, escenarios y hashes de artefactos.
- [Excel sintético original](artefactos/c3c14-precontable.xlsx): bytes producidos por la exportación real, sin edición posterior.
- [Informe sintético JSON](artefactos/c3c14-informe.json): condiciones y diagnóstico correspondientes al Excel.
- [Registro de ejecución](artefactos/qa-execution.json): versiones, base Git y SHA-256 de fuentes probadas. El HEAD registrado es la base porque los archivos QA estaban aún sin commit al ejecutar; sus hashes identifican el contenido probado.

Los directorios temporales completos están identificados por suite en `evidencia.json`. Conservan resultados Vitest, log de servidor, cierre, postcheck y render SSR. No se publicaron manifiestos privados ni tokens. La base original y los módulos productivos permanecen sin cambios; los únicos archivos añadidos son pruebas, ejecutores y evidencias/documentación.

## Discrepancias, límites y pruebas no realizadas

- **Navegador autenticado / DOM real: NO REALIZADO.** `mcp__cua_repl` falló antes de inventariar superficies: `failed to start Node runtime`, `os error 3`. No hay capturas ni navegación acreditadas. Chrome y Edge están presentes; su presencia no demuestra capacidad de automatización funcional.
- **Presentación visual en Microsoft Excel: NO REALIZADA.** Excel está instalado, pero la inicialización de `@oai/sky` mediante `mcp__node_repl` falló con el mismo error antes de listar aplicaciones. Se inspeccionó la estructura/celdas del XLSX con ExcelJS; eso no acredita alturas, cortes, paginación, ajuste real de textos ni impresión en Excel.
- **Servidor Next, login HTTP real, cookies de navegador y descargas por navegador: NO REALIZADOS.** El test JWT invoca el Route Handler en proceso y sustituye únicamente el almacén de cookies. SSR no prueba hidratación, eventos cliente ni accesibilidad del navegador.
- La revisión visual del Excel entregado y el recorrido autenticado deben completarse cuando funcionen las herramientas, antes de aceptar esas capas como validadas. No se instalaron herramientas ni se cambió configuración de seguridad para eludir los fallos.
- El circuito exige volver a declarar/revisar evidencias después de una decisión que cambie su huella base. Se verificó esa frontera: no se interpretó como aprobación ni se alteró el contrato para evitarla.
- No se acredita autenticidad de documentos externos, autorizaciones formales, equivalencia funcional completa con Milenium 2000, capacidad para contabilizar ni comportamiento de datos productivos. No se ejecutaron SQL, migraciones o pruebas en Hostinger.

## Alcance de la entrega

No hay correcciones de módulos de negocio porque no se demostró un defecto funcional en el alcance ejecutado. No se requieren nuevos preflight/migrate/postcheck ni nuevas migraciones. El PR debe permanecer Draft y sujeto a auditoría técnica independiente antes del merge. Sin merge ni despliegue automático.
