# Traslados de Canecas: diseño de trabajo

Este documento describe trabajo en curso; las reglas añadidas en esta rama aún no están conectadas a la aplicación ni a la base de datos.

## Modelo y saldos

Reutilizar productos, ubicaciones, saldos y movimientos existentes. Un traslado contendrá varias partidas de producto y tendrá un número único por empresa. El borrador no altera existencias. Al enviar, una transacción bloqueará el traslado y los saldos de origen en un orden determinista, verificará `fisico - reservado` y registrará la salida. El saldo en tránsito de cada partida será `enviado - recibido - faltante`.

Cada recepción parcial se registrará como evento independiente, con clave de operación y responsable. La transacción bloqueará el traslado, comprobará la clave y el saldo pendiente, registrará lo recibido y lo ingresará al destino junto con su movimiento. Los faltantes deberán declararse explícitamente con motivo; no son existencias del destino y quedarán como diferencia trazable. Mientras alguna cantidad no esté recibida ni declarada faltante, el traslado permanecerá ENVIADO. Una vez resuelto todo, quedará RECIBIDO si no hay faltantes, o CON_DIFERENCIAS si los hay. No se propone una regularización automática de faltantes: requerirá una operación posterior, autorizada y auditada.

Envíos y recepciones deben ser atómicos e idempotentes frente a reintentos, incluidos reintentos concurrentes. Las claves reutilizadas con datos diferentes deben rechazarse. Las restricciones de integridad deben incluir el identificador de empresa y las consultas y acciones deben verificar el permiso adecuado y la pertenencia a la empresa.

## Comprobante

Al emitir el envío debe conservarse una instantánea inmutable de la identidad de la empresa y los datos documentales, incluidos nombre y contenido del logotipo, ubicaciones, nombres y presentaciones de productos, cantidades, responsables, fechas y observaciones. Cada recepción debe añadirse como evento documentado sin alterar el comprobante de envío ya emitido. La impresión o PDF podrá combinar la instantánea de envío y los eventos de recepción disponibles, indicando claramente sus fechas; reimpresiones de una misma versión deben usar sus propios datos históricos.

Seleccionar la marca de la empresa emisora; para MONACO reutilizar el logo existente si corresponde a su configuración. No usar una marca predeterminada de otra empresa. La impresión incluirá espacios para firmas de entrega, transporte y recepción. Consultar y reimprimir desde el historial requiere el mismo aislamiento y permiso de lectura que el módulo.

## Pendiente para completar la funcionalidad

- Migración revisada con claves foráneas por empresa, partidas, eventos de recepción e instantáneas documentales.
- Transacciones de creación, envío y recepción con bloqueos, controles de idempotencia y permisos.
- Interfaz, consulta histórica y generación del comprobante imprimible.
- Pruebas dirigidas de concurrencia y aislamiento en MySQL de laboratorio, permisos, documentos y flujos de interfaz.

