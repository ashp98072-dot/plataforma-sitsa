# Milenium → Contabilidad: fase 1, revisión en seco

> **Nota de actualización (CONTABILIDAD-MILENIUM-FASE1-ACTUALIZACION-DOCUMENTAL)**:
> este documento es histórico/diagnóstico — describe el estado en que se abrió
> esta fase. Trabajo posterior en `main` (`docs/CONTABILIDAD-C2-TRANSICION.md`,
> `docs/CONTABILIDAD-C3A-CAPTURA.md`, `docs/CONTABILIDAD-C3B-CONSULTA.md`) ya
> resolvió parte de lo que aquí se listaba como bloqueo abierto. Las secciones
> de abajo se anotaron con su estado real más reciente; el resto del documento
> (herramienta, lector DBF, alcance de esta fase) sigue vigente sin cambios.

## Decisión confirmada por el usuario

| Origen | Código empresa | Carpeta | Tratamiento |
| --- | --- | --- | --- |
| KT | 01 | BASES001 | Primera empresa a mapear |
| Mónaco actual | 08 | BASES008 | Separada de KT |
| Mónaco histórico | 00 | BASES000 | No combinar automáticamente con 08 |

Mónaco 00 y 08 tienen períodos solapados. No sumar saldos ni deduplicar por
número de cuenta o partida entre bases. Conservar siempre la identidad origen.
La selección de carpeta se contrasta con código y nombre en s02.dbf. Esa
comprobación no demuestra por sí sola que alguien no haya intercambiado carpetas:
la copia y su correspondencia con el sistema origen requieren validación humana.

**Actualización (C2, ver `docs/CONTABILIDAD-C2-TRANSICION.md`)**: 00 y 08
corresponden a la MISMA entidad contable Mónaco (no a dos entidades distintas)
— la separación real es KT vs. Mónaco. Lo que sigue pendiente entre 00 y 08 es
preservar su procedencia/lote de origen por separado y conciliar el
solapamiento temporal entre ambas bases antes de cualquier importación de
saldos; no es una decisión de identidad todavía abierta.

## Herramienta local

Desde la raíz del repositorio:

```powershell
node scripts/milenium/revisar-cuentas.mjs 'D:\COPIA-LOCAL\Milenium2000' KT
node scripts/milenium/revisar-cuentas.mjs 'D:\COPIA-LOCAL\Milenium2000' MONACO
node scripts/milenium/revisar-cuentas.mjs 'D:\COPIA-LOCAL\Milenium2000' MONACO_HISTORICO
node --test scripts/milenium/cuentas.test.mjs
```

Usar una copia estable fuera del repositorio, con Milenium cerrado al obtenerla.
La herramienta abre exclusivamente s02.dbf y co01.dbf en lectura. No importa DB,
no carga .env, no ejecuta EXE/APP, no tiene SQL, no escribe archivos ni usa red.
Imprime un resumen sin nombres/códigos de cuentas ni registros personales, con
huellas SHA256 para comparar la fuente. No subir bases, PDFs, FPT, reportes reales
ni ZIP al repositorio. Las pruebas generan buffers ficticios en memoria.

Lector deliberadamente limitado a VFP 0x30 y Windows-1252 (marca 0x03), observados
en este catálogo. Otros formatos/campos se rechazan, no se convierten a ciegas.
Se excluyen registros marcados como borrados; cuenta inactiva no equivale a borrada.
Se comprueba modificación durante cada lectura, pero no existe snapshot atómico
entre archivos: una lectura exitosa no reemplaza un respaldo consistente.

## Mapeo propuesto, todavía sin escritura

| Milenium co01 | Plataforma cont_cuentas | Regla |
| --- | --- | --- |
| CODIGO_CTA | codigo | Texto, conservar ceros iniciales; límite 40 |
| NOMBRE_CTA | nombre | Windows-1252 a Unicode; límite 200 |
| NIVEL_CTA | nivel | Entero positivo; falta validar jerarquía |
| LINACTIVA_ | activa | Invertir únicamente booleano conocido |
| TIPO_CTA | tipo | Pendiente de homologación; NO asumir significado de 1–5 |
| CTACOM_CTA, MULTIP_CTA | Sin equivalencia aprobada | Confirmar semántica contable |
| Empresa/base origen | Identidad contable destino | Modelo definido posteriormente (entidad_id, C2) — ver bloqueo 1 abajo |

Las equivalencias son propuestas, no una autorización de importación. No existe
todavía salida de filas importables, botón web ni cambio de funcionalidad actual.
`listo_para_importar` permanece falso incluso si las verificaciones pasan. El
resultado de proceso 0 solo significa que pudo analizarse el archivo, no que sea
apto para migrar. La detección normalizada de duplicados es orientativa; falta
comparar contra collation y datos del servidor destino.

## Bloqueos previos a importar

1. ~~El tenant operativo kt-monaco agrupa dos empresas de origen... Definir
   entidad/libro contable separado o tenants separados.~~ **RESUELTO
   posteriormente.** `docs/CONTABILIDAD-C2-TRANSICION.md` definió el modelo
   (identidad contable vía `entidad_id` en `cont_cuentas`/`cont_asientos`/
   `cont_asiento_detalle`/`cont_cxc`/`cont_cxp`, guard de tenant + permiso +
   entidad activa + asignación) y `docs/CONTABILIDAD-C3A-CAPTURA.md` confirma
   que retoma "C2B (separación funcional KT/Mónaco), cuyas migraciones el
   usuario confirmó aplicadas manualmente". KT y Mónaco permanecen dentro del
   mismo tenant operativo compartido, pero ya se separan por entidad/libro —
   ya NO es una decisión de diseño pendiente. Sigue sin existir, en cambio, el
   paso que ligue un catálogo IMPORTADO de Milenium a esa entidad (ver
   bloqueo 3).
2. Homologar tipos, naturaleza y cuentas de movimiento con el responsable
   contable. No inferir debe/haber ni signos a partir de un código numérico.
   **Sigue pendiente** — TIPO_CTA, MULTIP_CTA, CTACOM_CTA, naturaleza y
   jerarquía/cuentas de agrupación vs. movimiento no tienen equivalencia
   aprobada; nada en el trabajo posterior de C2/C3A homologó estos campos
   (esas entregas trataron identidad/transacción/captura, no el catálogo de
   Milenium en sí).
3. ~~Fortalecer asientos antes de movimientos: el endpoint actual inserta
   cabecera y líneas mediante llamadas separadas...~~ **El flujo NORMAL
   (manual) de asientos ya fue endurecido posteriormente** —
   `docs/CONTABILIDAD-C2-TRANSICION.md`/`FASE2.md` documentan que el POST de
   asientos pasó a una sola transacción/conexión (bloqueo de cuentas con
   `FOR UPDATE`, cuadre exacto, cabecera+detalle+auditoría atómicos,
   rollback ante fallo) — reutilizado tal cual por la captura real de C3A. Lo
   que **sigue sin existir es un IMPORTADOR de Milenium**: la estrategia
   transaccional/idempotente para una carga MASIVA de cuentas/partidas (lotes,
   reintentos sin duplicar, procedencia/huella por fila) es un problema
   distinto al de un asiento manual individual y no está definida en ningún
   documento posterior — sigue siendo un bloqueo real para importar.
4. Resolver límites temporales entre Mónaco histórico (00) y actual (08) con
   conciliación, sin sumar dos veces el mismo período. Definir saldos
   iniciales vs. histórico. **Matiz posterior (C2):** 00 y 08 son la MISMA
   entidad contable Mónaco (ver nota arriba) — lo pendiente es preservar
   procedencia/lote por separado y conciliar el solapamiento temporal, no
   decidir si son o no la misma identidad.

## Etapas siguientes (PR separados)

2. ~~Modelo de identidad contable, reglas de cuentas/períodos y
   transacciones...~~ **Identidad contable y transacción del asiento normal:
   YA RESUELTAS** (ver bloqueos 1 y 3 arriba, C2/C3A). Reglas de
   períodos/ejercicio/apertura/cierre siguen pendientes (`CONTABILIDAD-C3B-
   CONSULTA.md` las deja explícitamente para la siguiente entrega).
3. Vista previa de catálogo, homologaciones (bloqueo 2, sigue pendiente) y
   comparación destino, seguida de importación idempotente aprobada por
   empresa/entidad. Conservar ID/base de origen. Diseñar aquí la estrategia
   transaccional de IMPORTACIÓN MASIVA (distinta de la transacción ya
   existente para un asiento manual individual).
4. Saldos/partidas y bancos por lotes controlados: conciliar debe/haber, saldos y
   reportes origen/destino. Registrar auditoría y rechazos, probar rollback/reintento.
5. Cuentas por cobrar/pagar y reportes; coordinar con Facturación para reutilizar
   clientes/documentos y evitar asientos duplicados.

Esta fase no homologa tipos, migra datos, cambia permisos ni toca Facturación,
Planillas, TMS o evidencia de viajes. No requiere migración SQL.
