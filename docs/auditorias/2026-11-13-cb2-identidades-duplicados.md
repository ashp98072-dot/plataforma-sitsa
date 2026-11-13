# CB2: identidades seguras y variantes de placa

## Resultado y limite productivo

Base: main con #608 mergeado. No hubo acceso a una sesion productiva; SHA publicado y booleanos reales siguen pendientes de verificar. El usuario autorizo continuar sin esa informacion. No se cambio Hostinger, SQL, configuracion, flags ni historicos productivos.

El mensaje A/B se renderiza con tercerosDirectos=false. La migracion no activa esa politica. El cargador del servidor permite que un archivo persistente config/.env prevalezca sobre el panel; hay que comprobar los valores efectivos, no inferirlos por la migracion aplicada.

## Cambios funcionales

- Autopropuesta de piloto exacto y unidad unica en catalogos de la empresa: valida placa completa/abreviada y tipo. Homonimos, prefijos ambiguos, varias unidades (incluidas propias), tipos contradictorios y selecciones borradas manualmente no se resuelven automaticamente. La unidad propuesta tambien aparece seleccionada en el control; LISTO se recalcula al actualizar catalogos. El backend revalida los IDs, empresa, tipo, nombre, permisos y compuerta al confirmar. Se conserva el flujo historico de asociaciones verificadas.
- Catalogos activos consultan aliases existentes aunque el flag que autoriza NUEVAS fusiones este apagado. Ocultan origenes y rotulan el destino Principal #ID. No se ocultan arbitrariamente dos unidades no fusionadas ni se agregan sus historicos al principal.
- Alta normal, alta con propiedad, edicion de placa e importacion serializan por empresa en la misma conexion/transaccion. Las coincidencias usan placaComparable, incluyendo espacios y guiones equivalentes. Se conservan placas existentes y no se agrega UNIQUE ni DDL. La garantia cubre estos escritores de la aplicacion, no SQL externo.
- El importador ya no usa LIMIT 1 por placa sobre otras empresas: exige importar desde la empresa administradora, rechaza coincidencias multiples y chasis contradictorios, y respeta aliases. Cada fila es atomica. El PATCH ya no transforma un error de escritura en un falso exito mediante un UPDATE de campos basicos.

## Pares reportados: solo copia privada pre-CB2

En ambos pares #651/#1300 y #684/#1301 se encontraron dos filas, con placa comparable y tipo coincidentes, pero **empresa diferente y sin chasis real coincidente acreditado**, ademas de referencias operativas. **BLOQUEADOS para fusion en esa copia**. No se trasladan propietarios, referencias ni IDs. Esto no acredita el estado productivo actual: cualquier cambio posterior al respaldo debe revisarse de nuevo. Los detalles de referencias permanecen en .lab-runtime/pares-auditoria-privada.json, excluido de Git.

## Diagnostico de solo lectura para el operador

Con sesion autorizada, GET `/api/empresas/<slug>/flota/combustible/catalogos` ya devuelve tercerosDirectos y tercerosHabilitados en versiones compatibles.

Este PR agrega GET `/api/empresas/<slug>/flota/combustible/cb2/diagnostico`. Tras un eventual despliegue aprobado devuelve revisionFuncional, BUILD_ID, SHA declarado opcional y los booleanos efectivos. No devuelve secretos, rutas, configuracion completa ni datos empresariales; no-store y guard de permisos. BUILD_ID identifica el build, no equivale al SHA; shaDeclarado es null si no se proporciono NOVALVION_DEPLOY_SHA valido. El endpoint no cambia configuracion ni confirma por si solo que una migracion se haya aplicado. Antes de desplegar el PR, un 404 no prueba el valor de ningun flag.

## Validacion local

- DOM/HTTP/modelos CB2 y regresiones relacionadas: 557 pruebas aprobadas, 44 omitidas sin entorno de laboratorio (las de MariaDB se ejecutaron aparte).
- MariaDB 11.8.9 por PIPE, sin red: 29 aprobadas, incluyendo handlers HTTP reales con altas concurrentes, colision al editar, importacion vs alta, empresa ajena, aliases con flag apagado, propiedad y rollback; incluye persistencia directa de 121646 y rechazo de tipo incompatible.
- Respaldo privado restaurado: 2 aprobadas (inspeccion de pares y fusion sintetica con seis tablas historicas intactas), postchecks completos y fallo intencional de privilegios detectado.
- Cinco regresiones del runner #608 aprobadas. TypeScript, ESLint dirigido y diff-check aprobados. SQL productivo sin cambios.

Repetir desde el worktree: `node scripts/ci/cb2-identidades/run-windows.mjs --run-isolated ../../.lab-runtime/mariadb-11.8.9-winx64 scripts/ci/pricesmart-api06a/engine-manifest.json`. El runner privado existente acepta como argumento el respaldo local; no subirlo ni adjuntar salidas privadas.

APTO para auditoria de codigo/laboratorio; operacion productiva pendiente de auditoria de ChatGPT, diagnostico real y aprobaciones. No se activa ninguna politica desde este PR.
