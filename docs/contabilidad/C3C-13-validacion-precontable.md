# C3C-13 - Validacion integral y expediente precontable

Fecha: 2026-10-30 (America/Guatemala).
Base: 4d0c3f0bbf3a8688545488362f60e2e34edb6ea0, merge C3C-12.
Rama: feature/c3c13-validacion-precontable.
Worktree: .worktrees/c3c13. Main local actualizado sin modificar cambios preexistentes del directorio original.

## Resultado funcional

GET/POST /api/empresas/[slug]/contabilidad/ejercicios/[id]/validacion-precontable?entidad=ID.
GET evalua cada solicitud C3C-11 del ejercicio y libro. Sin solicitudes indica preparar primero el expediente; no inventa uno.

Una transaccion REPEATABLE READ de solo lectura reune los motores C3C-5 a C3C-12: diagnostico de periodos/movimientos, saldos nominales, cuenta de resultado, propuesta C3C-8/C3C-9, politicas, borradores, procedencia y revisiones C3C-10, solicitudes y decisiones C3C-11, evidencias C3C-12 y responsables. No se implementa otro motor de calculos.

Informe estructurado con originales y simulacion separados, identificacion de empresa/libro/ejercicio, fecha, huellas por componente, referencias a registros, bloqueantes y advertencias. Pendientes formales son advertencias explicitas, no se convierten en aprobacion cuando el expediente esta tecnicamente completo. La propuesta no se muestra si el motor existente detecta bloqueantes.

Constancias exclusivas del revisor C3C-11, distinto de preparador y resolutor; los tres deben conservar permisos explicitos, actividad y asignacion. Se permite documentar una evaluacion con bloqueantes: queda guardada como tal, sin aprobar ni contabilizar. Justificacion obligatoria, version esperada, huella integral, UUID de idempotencia y confirmacion expresa. La constancia conserva el informe completo con su fecha y enlace SHA-256 a la constancia anterior.

Panel en Calendario contable: informe, estado de periodos, saldos originales e historia anterior, propuesta simulada, diagnostico, responsables, evidencias, decisiones, historial C3C-10, constancias y motivos de desactualizacion. Al actualizar compara componentes con la consulta anterior. Exporta JSON de informe y constancias con aviso de instantanea. Excel reevalua fuentes al exportar y reutiliza ExcelJS instalado; hojas separan saldos originales, propuesta simulada, diagnostico y evidencia. Textos se escriben como valores, sin formulas ni enlaces externos ejecutables. Sin dependencias nuevas.

## Huella integral y vigencia

Contrato C3C13-CONDICIONES-1 incluye ambito y huellas de movimientos (incluida historia anterior y detalles inconsistentes/huerfanos), permisos relevantes, calendario, condiciones C3C-9, catalogo/configuracion, politicas, solicitudes, decisiones, evidencias, procedencia, todos los borradores e identificacion.

Las fechas de evaluacion y el actor lector no afectan la huella; guardar una constancia tampoco la altera. Se invalidan conservadoramente todas las constancias del mismo ambito si cambia una fuente compartida. Los detalles de todo el libro se incluyen para no ocultar huerfanos, por lo que cambios ajenos al intervalo tambien pueden invalidar conservadoramente. No existe caducidad temporal automatica inventada.

Toda consulta recomputa las fuentes y compara cada componente de las constancias; verifica contenido, ambito, actor, version, huella integral y enlace de cadena. Corrupcion en cualquier version bloquea nuevas constancias y ninguna se presenta vigente. Estado SIN CAMBIOS solo significa igualdad con la instantanea actual, no autenticidad ni autorizacion formal. Una exportacion fuera de linea requiere reconsulta para validar vigencia.

Escrituras reutilizan bloquearGestion C3C-11 y bloquean evidencias/constancias antes de la primera lectura consistente. Se serializan cambios de fuentes y permisos mediante el protocolo existente. Auditoria e insercion forman una sola transaccion; fallo de auditoria revierte la constancia. Reintentos idempotentes requieren permiso vigente; devuelve version original sin nueva escritura y su vigencia se consulta por GET.

## Persistencia y operacion

Tabla append-only cont_regularizacion_evaluaciones: PK por ambito/solicitud/version, clave idempotente por empresa/libro, FK compuesta a solicitud y FK de usuario, CHECK de identidad/contrato/formal pendiente y triggers anti UPDATE/DELETE. Canonizacion SHA-256 compartida con C3C-9; SQL verifica estructura/contrato y la aplicacion recomputa huellas canonicas.

SQL preparado para ejecucion manual posterior a C3C-12:

- sql/preflight-2026-10-validacion-precontable-c3c13.sql
- sql/migrate-2026-10-validacion-precontable-c3c13.sql
- sql/postcheck-2026-10-validacion-precontable-c3c13.sql

Schema para instalaciones nuevas actualizado. Sin migracion, API responde 503 MIGRACION_PENDIENTE. No se aplico SQL en Hostinger ni en otra base operativa.

## Evidencia de validacion

- 175 pruebas unitarias, contratos, API, calculos y render estatico aprobadas en 8 archivos.
- MariaDB 11.8.9 temporal sin red, pipe/datadir unicos por ejecucion y cierre confirmado: C3C-13 20/20; compatibilidad C3C-9 30/30, C3C-10 20/20, C3C-11 31/31, C3C-12 9/9.
- Migracion C3C-13 ejecutada dos veces por instancia para verificar repetibilidad. Tres preflight y cinco postcheck aprobados. Postcheck repetido despues de las pruebas C3C-13: cinco controles con errores=0.
- Cobertura: no escrituras al consultar, saldos y propuesta existentes, historia anterior separada, huella reproducible entre lectores, constancias con/sin bloqueantes, permisos y separacion, empresa/entidad/ejercicio, concurrencia misma/distinta clave, idempotencia, rollback de auditoria, revocacion del revisor, corrupcion de primera/ultima version, integridad historica, FK y contratos SQL, cambios e invalidacion, render de informe real y seguridad de textos Excel.
- TypeScript noEmit, ESLint de cambios y git diff --check aprobados.

Comandos reproducibles (requieren binarios temporales verificados ya disponibles y node_modules):

    node scripts/ci/c3c13/run-windows.mjs --run-isolated --engine=mariadb
    node scripts/ci/c3c13/run-windows.mjs --run-c9-isolated --engine=mariadb
    node scripts/ci/c3c13/run-windows.mjs --run-compat-isolated --engine=mariadb
    node scripts/ci/c3c13/run-windows.mjs --run-c11-isolated --engine=mariadb
    node scripts/ci/c3c13/run-windows.mjs --run-c12-isolated --engine=mariadb

El ejecutor escribe results.json, tests.log y postcheck-c13.json en su directorio temporal; nunca carga configuracion de BD operativa. Instancia C3C-13 final de referencia: novalvion-c3c2-1d6b76c705fa43f68fcac37d318e0426.

## Archivos

- src/lib/contabilidad/precontable.ts: servicio transaccional, informe, huellas, constancias e historial.
- src/lib/contabilidad/precontable-contrato.ts: contratos, permisos y comparacion.
- src/lib/contabilidad/precontable-http.ts: guard tenant, API y exportacion protegida.
- src/lib/contabilidad/precontable-excel.ts: exportacion ExcelJS.
- src/lib/contabilidad/precontable.test.ts y precontable.integration.test.ts: pruebas.
- src/lib/contabilidad/expediente.ts: permite reutilizar contexto C3C-11 en la misma transaccion.
- src/components/contabilidad/precontable.tsx y calendario-contable.tsx: panel e integracion.
- src/app/api/empresas/[slug]/contabilidad/ejercicios/[id]/validacion-precontable/route.ts.
- scripts/ci/c3c13/run-windows.mjs e integration.config.mts.
- Los tres SQL anteriores, sql/schema.sql y este informe.

## Limites pendientes

Interfaz validada por render estatico y contratos HTTP; no recorrido autenticado en navegador. Excel validado por lectura de workbook/celdas y ausencia de formulas, sin inspeccion visual en Microsoft Excel. Los documentos externos siguen siendo referencias y huellas declaradas; no se verifican bytes ni autenticidad. Las evidencias obligatorias conservan el contrato fijo C3C-12. Las fuentes e informes completos pueden requerir optimizacion futura para libros muy grandes; no se oculta historia mediante paginacion al verificar integridad.

Sin asientos reales, modificacion de saldos historicos, regularizacion definitiva, apertura/cierre de periodos, aprobacion formal, equivalencia Milenium, merge o despliegue. Laboratorio C3C-8 conservado sin intervencion.
