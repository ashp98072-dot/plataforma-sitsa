# PR A — infraestructura contable mínima

Base: main `1b182dbd824aa0194fcad5abeb6b3c22c1ca5514`.

Corrección de #447: producción MariaDB 11.8.9-MariaDB-log ya tiene
`cont_cuentas_rol` desde 2026-10-12, con 14 configuraciones (7 por entidad), sin huérfanos.
`cont_eventos` no existe. Se reutilizará la tabla, sin cambiar ninguna de sus filas ni collation.
El operador confirmó nombre/definición exacta del CHECK histórico: `ck_cont_rol_valido`,
longitud física 126, siete roles en orden CLIENTES/IVA_POR_PAGAR/VENTAS_SERVICIOS/RETENCION_IVA/
TRANSITO_BANCARIO/ANTICIPOS/DEVOLUCIONES_VENTAS. VENTAS_BIENES se agrega al final.
No se ejecutó la corrección en producción; requiere preflight y autorización antes de aplicar.

## Alcance

Infraestructura sin callers en facturación, pagos o UI. No certifica/emite facturas, no confirma bancos,
no ejecuta ajustes ni cambia porcentajes. PR A no implementa control de periodos.
Sin backfill: asientos históricos no reciben eventos y configuración futura no los modifica.

## Contratos

- `cont_cuentas_rol`: UNIQUE empresa/entidad/rol y FKs compuestas a entidad/cuenta.
  ANTICIPOS, CLIENTES, DEVOLUCIONES_VENTAS, IVA_POR_PAGAR, RETENCION_IVA,
  TRANSITO_BANCARIO, VENTAS_SERVICIOS y VENTAS_BIENES.
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

1. `sql/preflight-2026-10-contabilidad-infraestructura-a.sql` (bloque de lectura de metadata/datos).
2. `sql/migrate-2026-10-contabilidad-infraestructura-a.sql` (DDL condicional guardado).
3. `sql/verify-2026-10-contabilidad-infraestructura-a.sql` (solo SELECT/SHOW).

Objetivo MariaDB 11.8.9; InnoDB / utf8mb4_uca1400_ai_ci para tablas nuevas, claves ASCII binarias.
No convierte la collation de la tabla existente.
JSON puede aparecer físicamente como LONGTEXT en MariaDB: no convertir.
Preflight verifica DB elegida, versión, checks/FKs ON, padres, engines, tipos INT signed,
índices únicos compuestos, collations, huérfanos y DDL existentes.
Las FKs usan columnas numéricas: las collations de texto padre no se fuerzan ni se modifican.
Compuerta automática usa information_schema y devuelve SHOW CREATE explícito de la tabla existente:
valida columnas/posiciones/defaults, PK/UNIQUE/índice, dos FK RESTRICT, CHECK único conocido,
engine/collation, tipos signed, datos y colisiones. Roles/activa inesperados, constraints adicionales,
triggers o metadata inaccesible => DETENER. No inferir ausencia de permisos como ausencia de constraints.
No asumir disponibilidad del permiso: comprobarlo con el preflight; no retirar la compuerta.
Compatibilidad Hostinger: la relación CHECK/tabla proviene exclusivamente de TABLE_CONSTRAINTS
(`tc.CONSTRAINT_SCHEMA`, `tc.TABLE_NAME`, `tc.CONSTRAINT_TYPE='CHECK'`).
Se une CHECK_CONSTRAINTS por schema + nombre para obtener la definición;
no se filtra ni consulta `CHECK_CONSTRAINTS.TABLE_NAME`. Aplica a 1 CHECK de roles y 5 de eventos,
incluida la consulta explícita de verificación.

Si una tabla ya existe, el preflight devuelve automáticamente su DDL y filas para comparación.
IF NOT EXISTS NO comprueba compatibilidad ni modifica CHECKs existentes.
La tabla productiva contiene ANTICIPOS/TRANSITO_BANCARIO/DEVOLUCIONES_VENTAS, que deben conservarse.
El upgrade solicitado ampliará únicamente el CHECK de roles para agregar VENTAS_BIENES,
con verificación del DDL histórico en la propia ejecución. No se convertirá collation ni se añadirá configuración.
APTO_NUEVO: ambas tablas ausentes y padres compatibles.
APTO_COMPATIBILIDAD: tabla histórica exactamente verificada, siete roles válidos, eventos ausente.
NOOP: ocho roles admitidos y tabla de eventos exactamente compatible.
DETENER: estructura/datos inesperados, colisiones o evidencia insuficiente.
El CHECK se compara tras normalizar únicamente espacios/backticks/mayúsculas; se conserva el orden.
No se permite otro conjunto de roles ni nombre de CHECK. Una tabla con ocho roles pero eventos ausente
(ejecución DDL interrumpida) devuelve DETENER y exige revisión/recuperación explícita, no reparación automática.
La variante histórica espera exactamente un CHECK de rol: ausencia de CHECK activa no se finge como uno existente;
cualquier CHECK adicional desconocido detiene. Valores activa fuera de 0/1 también detienen.
Conteos vacíos esperados en primera instalación; si ya había configuración, registrar y comparar conteos antes/después.
La migración no carga cuentas, datos ni eventos.

Rollback operativo: no activar callers o revertir aplicación; conservar tablas/datos.
No DROP TABLE ni DELETE de históricos. Único DROP: reemplazo de ck_cont_rol_valido en un solo ALTER.
DDL produce commits implícitos: ejecutar en ventana sin modificación de esquema/configuración.
No envolverlo en una transacción de negocio ni prometer rollback de todo el bloque.
BEGIN NOT ATOMIC/SIGNAL detiene el bloque antes de DDL si no coincide la compuerta.
No crea procedimientos persistentes. DELIMITER es directiva del cliente (mysql/phpMyAdmin);
mysql2 envía el bloque completo quitando únicamente esas directivas.

## Validación local y reproducción

`CONTA_A_TEST_PORT=3407 npx vitest run src/lib/contabilidad` contra instancia LOCAL DESECHABLE.
La suite DB fija host 127.0.0.1, puerto 3407, root local y base aleatoria prefijada conta_a_test_;
no lee .env ni usa la conexión de la app. Crea únicamente fixtures sintéticos, sin DROP final.
Prueba preflight, migrate dos veces, verify, ausencia de seeds, FK/CHECK, writer real,
rollback externo, dos intentos concurrentes iguales, conflicto de huella, claves diferentes y aislamiento.
Corrección probada en MariaDB 11.8.9 oficial local desechable, descargado de archive.mariadb.org.
No es la BD productiva: 14 filas de prueba sintéticas reproducen la variante física confirmada.
Upgrade compara todas las columnas/valores/timestamps antes/después, índices (sin estadísticas variables),
FK y collation; segunda ejecución NOOP. Instalación nueva permite los ocho roles sin seeds.
La habilitación de VENTAS_BIENES se prueba con un INSERT de fixture seguido de rollback; no queda configurado.
Casos de drift: CHECK renombrado/diferente, columna/índice/FK inesperados, activa inválida y colisión,
todos rechazados antes de crear cont_eventos o alterar el CHECK.
Regresión Hostinger: vista local de CHECK metadata sin columna TABLE_NAME; el acceso por schema/nombre
funciona, el patrón anterior falla, y los scripts corregidos completan upgrade, verificación y NOOP
preservando 14 filas. La metadata real no se modifica.
Pruebas unitarias sin puerto siguen ejecutándose; suite DB se omite explícitamente si no se habilita.

Resultado dirigido anterior (HEAD 4a41f98f): 240/240 Contabilidad + APIs manuales; 15 casos DB reales.
Delta Hostinger: 23/23 SQL/DB dirigidos (7 contratos estáticos y 16 casos DB reales),
incluyendo upgrade histórico, preservación de 14 filas y NOOP con metadata CHECK sin TABLE_NAME.
TypeScript, ESLint dirigido y diff-check limpios.
Build anterior exitoso con Next 16.3.6 (HEAD 9f73cb78); no se repite en este delta de
catálogo/SQL/tests/docs sin cambios de UI/endpoints/escritor. TypeScript sí se revalida.
El escritor conserva la compuerta existente `exigirEsquemaC2b`, que consulta information_schema:
la compuerta de migración también requiere esos metadatos, y los futuros callers deben verificar que el usuario de aplicación
pueda ejecutar esa compuerta. No se elimina ni debilita en este PR.

## Blockers conservados

Hito de factura/FEL, VENTAS_BIENES sin cuenta, identidad/evidencia bancaria, moneda distinta de GTQ,
periodos/cierre/reapertura/numeración, reversos, NC parcial y retención real distinta.
No hay automatización activa, cambios de facturas/pagos/confirmaciones, periodos, RRHH ni entregas.
