# CB2 / fusiones — auditoria 2026-11-13

Dictamen: **APTO en laboratorio MariaDB 11.8.9; BLOQUEADO para produccion hasta auditoria de ChatGPT**. No se modifico Hostinger ni se activo configuracion. Las compuertas se simularon exclusivamente con vi.stubEnv dentro de Vitest y se restauraron al terminar.

## Resultado funcional

- PR #601 ya implementa terceros directos en backend, catalogos, seleccion y confirmacion. No corresponde crear una segunda implementacion ni retirar la compuerta sin autorizacion.
- La pantalla exige asociacion A/B cuando `catalogos.tercerosDirectos` es falso. En el codigo actual ese campo depende de `CB2_TERCEROS_DIRECTOS_APROBADA === '1'`. La migracion SQL no activa esa variable. Si produccion presenta el texto anterior, corresponde comprobar primero la revision desplegada y la respuesta autenticada de catalogos; no se consulto ni cambio su configuracion. Un despliegue anterior tambien es posible. No se afirma conocer el valor productivo del flag.
- Reproduccion sintetica del vale **121646**, piloto Luis Escobar y placa M-060KHK: prueba DOM con referencia OCTUBRE:9 verifica LISTO inmediatamente al seleccionar; MariaDB confirma persistencia de ambas identidades sin asociacion, concurrencia sin doble consumo y denegacion por empresa/permisos/flag. Datos faltantes, ambiguedad, producto obligatorio ausente o candidato bloqueado conservan PENDIENTE/BLOQUEADO.
- LISTO es estado de revision derivado; confirmar persiste el consumo. Guardar un catalogo no confirma automaticamente un consumo ni elimina bloqueos del Excel.
- La interfaz de Combustibles CB2 ya tiene revision de duplicados y boton «Fusionar por alias preservando historicos». Requiere Admin, dos revisiones vigentes, placa equivalente, mismo tipo y chasis real no generico, unidades activas sin taller y sin viajes/reservas abiertos. La compuerta de fusiones sigue apagada.

## Defecto corregido

La tabla de fusiones impedia UPDATE pero permitia DELETE del alias auditado. Se agrega BEFORE DELETE inmutable, con regresion que rechaza borrado y repeticion. La migracion original aun no aplicada es el SQL corregido de instalacion; no se debe reaplicar sobre una instalacion parcial.

## Laboratorio privado

Se restauro el respaldo anterior a CB2 en una instancia nueva con PIPE aleatorio, `skip-networking=1`, version 11.8.9 verificada. Se aplico exclusivamente `migrate-2026-11-cb2-terceros-directos.sql` como base y luego fusiones. No se aplicaron otras migraciones sobre el respaldo.

Prueba del servicio real sobre el esquema restaurado: dos unidades sinteticas de una empresa, mismo chasis y placas C999LAB / C-999LAB; viaje cerrado, combustible y acceso previos. Fusion exitosa, origen inactivo, principal conservado, seis tablas historicas comparadas completas sin cambios (viajes, cargas, consumos CB2, filas, asignaciones y accesos). Lectura historica por JOIN mantiene placa. INSERT de viaje nuevo al origen y DELETE de alias fallan. No se reescribieron referencias.

Pruebas sinteticas MariaDB: 24 aprobadas, incluyendo asociaciones previas, permisos, empresas, identidades contradictorias, reservas, dos administradores concurrentes y rollback de alias/desactivacion si falla auditoria. DOM/HTTP: 9 pruebas aprobadas. ESLint de archivos TypeScript modificados aprobado.

Se simulo un instalador con TRIGGER solo en las tablas principales, sin ese permiso en referencias. La ejecucion falla dentro del procedimiento dinamico y deja tabla/triggers principales/procedimiento existentes. Los postchecks detectan las guardas ffi_/ffu_ faltantes. El DDL **no es atomico ni reejecutable**. No usar --force ni esconder errores con IF NOT EXISTS. Ante fallo, mantener compuertas apagadas y auditar exactamente lo aplicado; preparar reparacion especifica, no borrar objetos o aliases por receta generica.

El respaldo, datadirs y salidas SQL privadas permanecen locales en .lab-runtime excluido de Git. El PR contiene codigo/pruebas y este resumen sin filas del respaldo.

## SQL exacto para revision de produccion (no ejecutado)

1. `sql/preflight-2026-11-flota-fusiones.sql`: VERSION/DATABASE/CURRENT_USER, SHOW GRANTS, ausencia de tabla/triggers/procedimiento y listado completo de referencias/guardas esperadas. Todo motor involucrado debe ser InnoDB. Hacer respaldo actualizado POST-CB2 antes de cualquier aplicacion aprobada: el respaldo utilizado aqui es PRE-CB2.
2. `sql/migrate-2026-11-flota-fusiones.sql`: aplicar completo, con soporte DELIMITER y detencion ante el primer error. Requiere CREATE, REFERENCES, SELECT, TRIGGER en todas las tablas descubiertas, CREATE ROUTINE, ALTER ROUTINE y EXECUTE. Conservar la cuenta DEFINER de los triggers. El administrador debe comprobar sus grants reales; no se probaron los de Hostinger.
3. `sql/postcheck-2026-11-flota-fusiones.sql`: primera consulta sin filas (cada columna tiene INSERT y UPDATE), cuatro triggers principales, cero procedimientos pendientes, cero aliases inconsistentes, cero motores invalidos. La mera existencia de la tabla no acredita instalacion completa.
4. Antes/despues de una prueba autorizada: guardar IDs/revisiones y comparar tablas historicas; origen activo=0/estado Inactivo, destino activo sin alteraciones, un alias auditable, ninguna referencia movida. Verificar lecturas de viajes/combustible y que no pueda seleccionarse el origen para operaciones nuevas. Los nuevos reportes no agregan automaticamente historicos del alias al principal: conservan los IDs originales y lectura historica; una unificacion de reportes seria otro alcance.

No activar FLOTA_FUSIONES_APROBADAS ni CB2_TERCEROS_DIRECTOS_APROBADA desde este PR. La auditoria debe aprobar primero codigo, SQL, privilegios y version/configuracion a desplegar. No se hizo merge ni deploy.

## Nuevos duplicados: causa y correccion minima propuesta

El indice uq_flota_placa protege (empresa_id, placa literal), no su forma comparable. El POST de vehiculos y el importador buscan placa literal; C999LAB y C-999LAB pueden crear dos IDs, reproducido en el esquema real. La correccion debe compartir placaComparable en alta/edicion/importacion, resolver coincidencias normalizadas sin inferir prefijos y rechazar ambiguedades. Para cerrar tambien la carrera entre solicitudes, serializar escrituras por empresa en transaccion o agregar una clave unica normalizada despues de auditar/sanear duplicados existentes. No agregar esa UNIQUE directamente sobre el respaldo ni convertir el importador en una fusion automatica entre empresas. Esta prevencion aun no esta implementada y se entrega como propuesta, conforme al alcance solicitado.

## Repetir pruebas

Desde el worktree y con dependencias instaladas:

```
node scripts/ci/cb2-fusion-audit/run-windows.mjs --run-isolated <motor-portable-11.8.9> scripts/ci/pricesmart-api06a/engine-manifest.json
node scripts/ci/cb2-fusion-audit/restore-private.mjs <ruta-local-del-respaldo-pre-CB2>
npx vitest run src/components/flota/cb2/directos.dom.test.ts src/components/flota/cb2/terceros-seleccion.dom.test.ts src/lib/flota/cb2/terceros-http.test.ts --maxWorkers=1
```

El segundo runner usa el motor existente en ../../.lab-runtime/mariadb-11.8.9-winx64; exige el respaldo como argumento, sin incluirlo en Git. Esta prueba es de servicio/DOM y motor real, no una sesion manual de navegador con produccion.
