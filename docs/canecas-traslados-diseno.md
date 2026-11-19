# Traslados de Canecas: diseño de trabajo

Este documento describe trabajo en curso. La rama incorpora una implementación inicial que requiere revisión y pruebas adicionales antes de habilitarse.

## Modelo y saldos

Reutilizar productos, ubicaciones, saldos y movimientos existentes. Un traslado contendrá varias partidas de producto y tendrá un número único por empresa. El borrador no altera existencias. Al enviar, una transacción bloqueará el traslado y los saldos de origen en un orden determinista, verificará `fisico - reservado` y registrará la salida. El saldo en tránsito de cada partida será `enviado - recibido - faltante`.

Cada recepción parcial se registrará como evento independiente, con clave de operación y responsable. La transacción bloqueará el traslado, comprobará la clave y el saldo pendiente, registrará lo recibido y lo ingresará al destino junto con su movimiento. Los faltantes deberán declararse explícitamente con motivo; no son existencias del destino y quedarán como diferencia trazable. Mientras alguna cantidad no esté recibida ni declarada faltante, el traslado permanecerá ENVIADO. Una vez resuelto todo, quedará RECIBIDO si no hay faltantes, o CON_DIFERENCIAS si los hay. No se propone una regularización automática de faltantes: requerirá una operación posterior, autorizada y auditada.

Envíos y recepciones deben ser atómicos e idempotentes frente a reintentos, incluidos reintentos concurrentes. Las claves reutilizadas con datos diferentes deben rechazarse. Las restricciones de integridad deben incluir el identificador de empresa y las consultas y acciones deben verificar el permiso adecuado y la pertenencia a la empresa.

## Comprobante

Al emitir el envío debe conservarse una instantánea inmutable de la identidad de la empresa y los datos documentales, incluidos nombre y contenido del logotipo, ubicaciones, nombres y presentaciones de productos, cantidades, responsables, fechas y observaciones. Cada recepción debe añadirse como evento documentado sin alterar el comprobante de envío ya emitido. La impresión o PDF podrá combinar la instantánea de envío y los eventos de recepción disponibles, indicando claramente sus fechas; reimpresiones de una misma versión deben usar sus propios datos históricos.

Seleccionar la marca de la empresa emisora; para MONACO reutilizar el logo existente si corresponde a su configuración. No usar una marca predeterminada de otra empresa. La impresión incluirá espacios para firmas de entrega, transporte y recepción. Consultar y reimprimir desde el historial requiere el mismo aislamiento y permiso de lectura que el módulo.

## Instalación y rollback propuestos

La instalación requiere autorización independiente, respaldo verificado, suspensión de escrituras y comprobación de la versión del motor y del esquema existente. Ejecutar `preflight-2026-11-canecas-traslados.sql` y detenerse si alguna fila indica DETENER; luego revisar y ejecutar `migrate-2026-11-canecas-traslados.sql`, verificar `postcheck-2026-11-canecas-traslados.sql` y solo entonces coordinar la versión compatible de aplicación. Los scripts no son transaccionales y el preflight no sustituye la revisión del esquema. Un fallo intermedio requiere diagnóstico manual; no reejecutar a ciegas.

Si la instalación falla o el preflight detecta objetos parciales, mantener detenidas las escrituras y la versión de aplicación que usa traslados. Ejecutar solo el diagnóstico de metadatos `diagnostico-2026-11-canecas-traslados.sql`, revisar el error exacto y comparar tablas, columnas, índices, claves y triggers con la migración y el motor. Verificar manualmente si existen datos y respaldos antes de decidir cualquier reparación. El rollback incluido requiere todas las tablas y triggers esperados y no es una reparación de instalaciones parciales. No reejecutar la migración, eliminar objetos ni activar la función hasta aprobar un plan específico que preserve datos y dependencias; repetir preflight y postcheck después de la reparación autorizada.

El rollback SQL está diseñado solo para tablas vacías y con escrituras suspendidas. Su procedimiento detiene la operación si existen registros: no revierte saldos ni elimina datos históricos. Si ya hubo traslados, primero se necesita un plan específico de reversión operativa y conservación documental. Tras un error, comprobar si quedó el procedimiento auxiliar antes de reintentar. No ejecutar estos scripts en producción durante el desarrollo.

## Condiciones y trabajo pendiente de revisión

- Las cantidades de inventario son enteras en el esquema existente; la capacidad de cada presentación puede ser decimal.
- Crear borradores requiere permiso de recepciones; envío y recepción, incluido declarar faltantes, requieren permiso de confirmación. El actor autorizado se registra en cada evento.
- En esta versión `canecas_confirmar` autoriza explícitamente tanto el ingreso físico como la declaración de faltantes: la ruta comprueba ese permiso además de `canecas` de lectura y el acceso a la empresa antes de llamar al servicio; la recepción guarda `usuario_id`, fecha, persona que recibe y motivo. Debe asignarse solo a responsables autorizados para reconocer diferencias. Si la operación exige separación de funciones o aprobación por un segundo usuario, es necesario un permiso y flujo de aprobación separados antes de instalar; no están implementados.
- La declaración de faltante es definitiva para la partida y la deja en CON_DIFERENCIAS cuando ya no queda mercancía en tránsito; no ingresa el faltante al destino. Conservar el comprobante y el motivo, investigar físicamente y documentar la decisión fuera del sistema. Si el material aparece o procede un ajuste, no modificar tablas ni repetir el traslado: se necesita diseñar y autorizar una operación de regularización auditada antes de efectuarla.
- Con traslados existentes no hay rollback automático seguro. Suspender escrituras, respaldar y verificar base y documentos, conservar la versión compatible de aplicación y consultar el historial de salidas, recepciones, saldos y documentos. Preparar un plan revisado por responsables de inventario para compensar o migrar cada estado y conciliar cantidades antes de cambiar el esquema. El script de rollback rechaza estos casos y no revierte movimientos.
- El envío exige un logotipo válido configurado para la empresa. Para el recurso estático de MONACO existe un caso explícito sujeto a que la empresa tenga el slug y ruta configurados correspondientes; verificar esta configuración antes de instalar.
- La validación de laboratorio usa MariaDB aislada; faltan revisión del SQL frente al motor de destino, pruebas de navegador reales y revisión del PDF y sus escenarios de impresión.
