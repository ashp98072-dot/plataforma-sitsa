# Milenium → SITSA: inventario funcional y ruta de integración

Fecha: 2026-08-28. Estado: inventario estructural inicial, NO equivalencia funcional certificada.

## Alcance y evidencia

Se enumeraron las bases locales BASES001 (KT), BASES008 (Mónaco actual) y
BASES000 (Mónaco histórico): 267 archivos DBF en cada una. El número de archivos
no representa módulos activos ni registros válidos. Se leyeron exclusivamente
cabeceras/descriptores de una selección de DBF, sin filas de personas, saldos ni
credenciales. No se ejecutaron EXE/APP, SQL, importaciones ni procesos del origen.

La clasificación siguiente se infiere de nombres y campos; no prueba reglas de
negocio, relaciones, signos, uso efectivo ni integridad. No se encontraron archivos
PRG/SCX/VCX/PJX/MNX en la búsqueda por extensiones dentro de la copia entregada.
Hay ejecutables, DBF y archivos auxiliares: no equivale a disponer del código
fuente editable completo. No asumir que se puede traducir automáticamente el EXE.

Referencia SITSA: código revisado de Contabilidad, entidades, Facturación,
esquema y limpieza. La fase 2B prepara un catálogo; NO separa libros existentes.
El analizador de cuentas de fase 1 se consultó en origin/codex/milenium-fase1:
su presencia en esa rama NO significa que esté integrado en main.

## Matriz inicial

| Proceso | Evidencia estructural Milenium | Situación SITSA / trabajo pendiente |
| --- | --- | --- |
| Identidad contable | Bases 01, 08 y 00, mapeo previamente acordado | cont_entidades y accesos preparatorios. Falta aplicar entidad a cuentas, partidas, obligaciones y consultas. No crear una tercera entidad por el histórico 00. |
| Catálogo de cuentas | co01: CODIGO_CTA, TIPO_CTA, MULTIP_CTA, NIVEL_CTA, CTACOM_CTA | cont_cuentas permite altas; falta homologar tipos/naturaleza, jerarquía y agrupadoras vs movimiento. No deducir estas reglas del código numérico. |
| Partidas / explicación | co02: NUMERO_CPC, GRUPOL_CPC, FECHA_CPC; co03: NUMPOL_DPC, CODCUE_DPC, MONTO_DPC; co04: RAZON_EPL (memo) | Asientos transaccionales con cuadre exacto y auditoría. UI todavía de demostración; faltan captura real, detalle, reversos y procedencia. Clave de unión y signo de MONTO pendientes de comprobar. |
| Períodos / grupos | co05: CODIGO_CG; co06: CODIGO_PER, MESINIP_PE, FECINI_PER | Falta ciclo contable de apertura/cierre y numeración por ámbito aprobado. La presencia de co06 no demuestra reglas de bloqueo del origen. |
| Monedas / centros / proyectos | co03: CODMON_DPC, MONTOOR_DP, TSACAM_DPC, CODCDC_DPC, CODPROY_DP | El detalle actual guarda cuenta/debe/haber, sin esas dimensiones. Homologar catálogos y decidir qué se usa; no confundir centro RRHH con centro contable sin validación. |
| Bancos y cuentas | b01: CODIGO_BAN; b02: CODBAN_BCT, CODCUE_BCT, CODMON_BCT | No se identificó un módulo bancario contable equivalente. Requiere catálogo bancario relacionado a cuentas contables y entidad. |
| Operaciones bancarias | b03: TIPOTR_BTR, NUMDOC_BTR, MONTO_BTR, ANULAD_BTR, HECHOP_BTR, REVP_BTR, AUTP_BTR | Faltan proceso bancario, autorizaciones y conciliación. Homologar tipos y estados antes de importar. |
| Saldos bancarios por período | b06: ANO_BFC, MES_BFC, SALIN_BFC, SALFIN_BFC | Requiere conciliación con movimientos; nunca importar ambos como movimientos sumables. |
| Clientes / cartera | cc01: CODIGO_CLI, CUECLI_CLI, DIASCR_CLI, LIMCRE_CLI | Reutilizar clientes existentes; añadir solo las relaciones contables necesarias. cont_cxc hoy usa nombre libre, no identidad del cliente. |
| Proveedores | cc02: CODIGO_PRV, CTAPRV_PRV, CTAANT_PRV, CTAGAS_PRV | cont_cxp usa nombre libre. Accesos de proveedores guarda enlaces/credenciales: NO sustituye el maestro contable de proveedores. |
| Documentos de cartera / venta | cc03 y cc05: tipo, serie, número, cliente, vencimiento, anulación, moneda y referencias FEL | Contabilidad CxC es básica. Facturación ya tiene facturas, emisión interna, anulación y pagos: reutilizar, no crear otro cobro paralelo. Falta puente al libro contable. |
| Compras / obligaciones | cc06, cc08, cc09: proveedor, documento, importes, cuentas, referencias e impuestos | CxP básica no cubre distribución contable, pagos ni aplicaciones. Validar relación cabecera/detalle y evitar doble importación de documentos. |
| Programación de pagos / anticipos | cc11: FECPAG_CPG, CERRADA_CP; cc12/cc13: NUMCPG, proveedor, monto | Estructura compatible con programación de pagos; semántica por confirmar. Falta proceso contable equivalente, con saldos y aplicación de anticipos. |
| Activos fijos | af01: VALADQ_AFI, VALLIB_AFI, DEPACU_AFI, FECADQ_AFI, FECBAJ_AFI; af02/af03: ubicación y referencias | No confundir vehículos/mantenimiento con contabilidad de activos. Confirmar uso, métodos y períodos antes de diseñar depreciación. |
| Inventarios | i01: bodegas; i02/i03/i04: agrupaciones y cuentas | Hay inventarios operativos en SITSA; su existencia no demuestra equivalencia con costo/kárdex contable. No reemplazarlos ni importar doble stock. |
| Rutas / ventas | f01: ORIGENR_RU, DESTINR_RU, CODCDC_RUT, CUEVEN_RUT; f02: vendedor/comisiones | Reutilizar Rutas, clientes y Facturación; homologar referencias comerciales/contables sin alterar viajes ya creados. |
| Producción | pr01/pr02/pr03: fórmulas, artículos, costos y cantidades | Indicio estructural, uso en KT/Mónaco sin confirmar. Fuera de la primera implementación contable. |
| Libros y reportes | co07/co08 contienen campos de folios; también hay reportes/exportaciones en la copia | No se verificaron fórmulas ni contenido de reportes. Falta comparar diario, mayor, balance y auxiliares con salidas del origen aprobadas. |

## Diferencias críticas antes de importar

1. Los datos actuales siguen agrupados por empresa operativa. No atribuir registros
   a KT o Mónaco automáticamente, aunque sean pruebas. Confirmar clasificación o
   tratamiento de esos datos mediante una decisión explícita.
2. El guard general acepta escritura por rol además de permisos: revisar la
   revocación de crear/editar para Contabilidad con pruebas del guard real.
3. Cuenta/CxC/CxP necesitan validación estricta, auditoría y errores controlados.
4. La UI de asiento demo no es un proceso de captura contable real.
5. La limpieza actual borra movimientos por empresa operativa; definir su bloqueo
   para libros definitivos antes de iniciar operación real.
6. Facturación tiene su propio historial de pagos. No replicar un pago en CxC sin
   vínculo y clave idempotente; registrar su efecto contable una sola vez.
7. Hay campos memo M en las fuentes: sus valores requieren FPT y codificación
   verificados. El lector limitado de catálogo no sirve aún para migrar todo.
8. No se ha demostrado integridad de filas, índices, saldos ni respaldo consistente.
   Examinar cabeceras no sustituye esas verificaciones.

## Entregas propuestas y criterio de aceptación

| Entrega | Trabajo | Criterio para darla por terminada |
| --- | --- | --- |
| C1 — endurecimiento | Permisos efectivos; validación/auditoría de cuentas y obligaciones | Solo lectura no escribe; entradas inválidas no insertan; errores controlados; pruebas sin regresiones. No reasignar datos. |
| C2 — separación | Entidad en libro y obligaciones; transición de registros existentes | Aislamiento tenant+entidad en API, UI y restricciones; clasificación aprobada; no mezcla de cuentas o movimientos. Migración manual. |
| C3 — operación contable | Captura/detalle de partidas, numeración, períodos y reversos | Cuadre exacto; cierre impide modificaciones; reverso conserva original y trazabilidad. |
| C4 — auxiliares e integración | Clientes/proveedores, cobros/pagos/anticipos y enlace con Facturación | Saldos reproducibles; pagos parciales y reversos; ningún documento/pago genera dos efectos contables. |
| C5 — bancos y reportes | Conciliación, diario, mayor, balance y auxiliares | Totales conciliados entre libro, auxiliares y reportes con casos conocidos. |
| C6 — importador controlado | Homologación, vista previa, lotes, procedencia, rechazos y reintentos | Primero catálogo; luego saldos o historia según corte aprobado. Reintentar no duplica; rollback probado; comparación con Milenium. |
| C7 — puesta en operación | Un período en paralelo, revisión contable y respaldo | Diferencias explicadas y aceptadas; restauración ensayada; aprobación del responsable antes del corte. |

Activos fijos, multimoneda avanzada, producción e inventario valorizado se
priorizarán según uso confirmado; no quedan autorizados por detectar sus tablas.
La migración de datos debe seguir el orden de dependencias, no el orden alfabético
de archivos. Histórico 00 y actual 08 se concilian por separado antes de decidir
qué períodos/lotes incorporar. No sumar saldos iniciales e historia duplicada.

## Información que falta para cerrar el inventario funcional

- Menús/procesos que realmente usan KT y Mónaco, validados con su responsable.
- Un ejemplo anonimizado por proceso: entrada, documento, partida y reporte final.
- Semántica de tipos, signos, claves, estados y cuentas agrupadoras del origen.
- Moneda, ejercicio, fechas de corte y decisión: historia completa o saldos iniciales.
- Reportes de referencia para conciliación; su revisión no ha ocurrido todavía.
- Confirmación de aplicación de la migración 2B y tratamiento de pruebas actuales.

No hay porcentaje de integración calculable aún. Esta revisión no certifica
cumplimiento fiscal ni fidelidad al ejecutable. Solo se crea este documento: no
se modificó el comportamiento de SITSA, no se copiaron bases privadas al repo,
no se ejecutó SQL y no se publicaron datos del origen.
