# PR A — infraestructura contable mínima

Base: main `1b182dbd824aa0194fcad5abeb6b3c22c1ca5514`.

## Alcance

Infraestructura sin callers en facturación, pagos o UI. No certifica/emite facturas, no confirma bancos,
no ejecuta ajustes ni cambia porcentajes. PR A no implementa control de periodos.
Sin backfill: asientos históricos no reciben eventos y configuración futura no los modifica.

## Contratos

- `cont_cuentas_rol`: UNIQUE empresa/entidad/rol y FKs compuestas a entidad/cuenta.
  CLIENTES, IVA_POR_PAGAR, RETENCION_IVA, VENTAS_SERVICIOS y VENTAS_BIENES.
  No hay seeds. VENTAS_BIENES válido sin fila: resolvedor falla explícitamente hasta configurar.
- `resolverCuentaPorRol(input, conn?)`: JOIN por empresa/entidad, valida entidad/configuración/cuenta activas;
  no fallback ni código contable fijo. Con conexión usa FOR UPDATE, sin ella solo lectura del pool.
- `registrarAsientoTx`: conexión/transacción externa; comparte el núcleo de la API manual.
  Cuadre exacto en centavos, cuentas activas del ámbito, cabecera/detalle/auditoría.
  No BEGIN, COMMIT, ROLLBACK ni release propios. El llamador debe rollback ante todo error.
  La futura validación de periodo se incorpora antes de INSERT, no se simula hoy.
- `cont_eventos`: vínculo factura/evento/asiento, clave/huella, snapshot y actor.
  UNIQUE clave y asiento por ámbito; FK compuesta a asiento y a origen incluyendo la factura.
  No incluye confirmacion_id: en PR B/D se añadirá junto con su FK/UNIQUE.
  COBRO_CONFIRMADO es tipo reservado pero CHECK/helper impiden persistirlo hasta esa fase.
- `registrarEventoContableTx`: no está conectado a endpoints; escritura explícita de infraestructura
  únicamente dentro de transacción del llamador. No determina el hito válido de factura ni reglas de retención.
  Bloquea empresa/entidad con helper existente antes de consultar la clave; serializa escritores concurrentes.
  Retención requiere origen FACTURA_EMITIDA en la misma empresa/entidad/factura.
- Clave de servidor: FACTURA_EMITIDA:facturaId / RETENCION_NO_EMITIDA:eventoOrigenId.
  SHA-256 de JSON canónico versionado: ámbito, factura/tipo/origen, fecha, líneas normalizadas y snapshot.
  Igual clave/huella retorna IDs existentes sin escritura; diferente huella = error de dominio 409.
  Número/glosa de presentación, actor y timestamps de ejecución no forman la huella.
- Snapshot V1 cerrado y validado: versionCalculo, origen tipo/id, cuentas rol/id, importes e impuestos
  como concepto/monto decimal canónico. Sin texto libre, rutas, credenciales o números bancarios.
  No se fija todavía contrato fiscal específico. El orden de arrays es significativo.

## Integridad física y límite conocido

No se altera `fact_facturas`. La FK de factura es simple a su PK existente:
el helper valida empresa/entidad mediante current read antes de insertar.
Una escritura SQL directa podría eludir ese control de ámbito de factura; la FK no prueba tenant de factura.
El vínculo de asiento y evento origen SÍ usa FKs compuestas.
Antes de automatización activa deberá aprobarse endurecimiento compuesto de factura con su índice padre,
fuera de esta PR que prohíbe tocar facturas. No ofrecer este helper directamente a payload de navegador.
Permisos e identidad deben validarse por guard del servidor antes de cualquier futuro caller.

## SQL manual propuesto

1. `sql/preflight-2026-10-contabilidad-infraestructura-a.sql` (solo SELECT/SHOW).
2. `sql/migrate-2026-10-contabilidad-infraestructura-a.sql` (solo CREATE TABLE IF NOT EXISTS).
3. `sql/verify-2026-10-contabilidad-infraestructura-a.sql` (solo SELECT/SHOW).

Objetivo MariaDB 11.8.9; InnoDB / utf8mb4_unicode_ci para tablas nuevas, claves ASCII binarias.
JSON puede aparecer físicamente como LONGTEXT en MariaDB: no convertir.
Preflight verifica DB elegida, versión, checks/FKs ON, padres, engines, tipos INT signed,
índices únicos compuestos, collations, huérfanos y DDL existentes.
Las FKs usan columnas numéricas: las collations de texto padre no se fuerzan ni se modifican.
Sin information_schema obligatorio: revisar SHOW CREATE de tablas cont_* para colisiones de nombres.
Si falta evidencia, DETENER; no inferir que la ausencia de permisos significa ausencia de constraints.

Si una tabla ya existe, ejecutar los bloques condicionales comentados del preflight y comparar DDL/datos.
IF NOT EXISTS NO comprueba compatibilidad ni modifica CHECKs existentes.
La propuesta antigua de roles contiene ANTICIPOS/TRANSITO_BANCARIO/DEVOLUCIONES_VENTAS y excluye VENTAS_BIENES:
si fue aplicada, DETENER y diseñar una migración separada aprobada; no perder filas ni quitar roles automáticamente.
APLICAR solo si nuevas tablas ausentes y padres compatibles; NOOP si ambas idénticas;
una instalación parcialmente creada solo puede completarse tras verificar exactamente la tabla presente.
Conteos vacíos esperados en primera instalación; si ya había configuración, registrar y comparar conteos antes/después.
La migración no carga cuentas, datos ni eventos.

Rollback operativo: no activar callers o revertir aplicación; conservar tablas/datos.
No DROP, DELETE de históricos ni reversos improvisados.

## Validación local y reproducción

`CONTA_A_TEST_PORT=3407 npx vitest run src/lib/contabilidad` contra instancia LOCAL DESECHABLE.
La suite DB fija host 127.0.0.1, puerto 3407, root local y base aleatoria prefijada conta_a_test_;
no lee .env ni usa la conexión de la app. Crea únicamente fixtures sintéticos, sin DROP final.
Prueba preflight, migrate dos veces, verify, ausencia de seeds, FK/CHECK, writer real,
rollback externo, dos intentos concurrentes iguales, conflicto de huella, claves diferentes y aislamiento.
La versión local disponible es MariaDB 10.4.32, NO 11.8.9: preflight físico real del objetivo sigue pendiente.
Pruebas unitarias sin puerto siguen ejecutándose; suite DB se omite explícitamente si no se habilita.

Resultado dirigido: 222/222 en Contabilidad + APIs manuales; incluye 6 casos DB reales.
TypeScript, ESLint dirigido y diff-check limpios.
Build exitoso con Next 16.3.6; warnings en configuración/middleware y cuatro accesos
filesystem en módulos no modificados. Sin cambios para silenciarlos.
El escritor conserva la compuerta existente `exigirEsquemaC2b`, que consulta information_schema:
el preflight propuesto no lo requiere, pero los futuros callers deben verificar que el usuario de aplicación
pueda ejecutar esa compuerta. No se elimina ni debilita en este PR.

## Blockers conservados

Hito de factura/FEL, VENTAS_BIENES sin cuenta, identidad/evidencia bancaria, moneda distinta de GTQ,
periodos/cierre/reapertura/numeración, reversos, NC parcial y retención real distinta.
No hay automatización activa, cambios de facturas/pagos/confirmaciones, periodos, RRHH ni entregas.
