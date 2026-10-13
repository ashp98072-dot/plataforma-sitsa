# CONT PR C — Contabilización de facturas: DISCOVERY y bloqueo (CASO B)

Estado: **DISCOVERY + PREPARACIÓN INERTE.** Resultado: **NO existe hoy un hito real de certificación/emisión definitiva**, por lo que
**la contabilización automática NO se activa**. Cero SQL, cero migraciones, cero datos, cero backfill, cero asientos reales. Base:
`main` con PR #447 (PR A) y #449 (PR B) mergeadas.

## 1. Hallazgos exactos del flujo actual

| Pregunta | Respuesta (con evidencia) |
|---|---|
| ¿Dónde se crea `fact_facturas`? | `crearFactura` (`src/lib/facturacion/facturas.ts`, `INSERT INTO fact_facturas`, ~L1292) siempre en estado **Borrador**, desde viajes Cerrados. |
| ¿Qué es BORRADOR / EMITIDA / ANULADA? | `estado_admin ENUM('Borrador','Emitida','Anulada')`. **Borrador**: editable. **Emitida**: `emitirFactura` (~L1475) exige un número y una fecha de emisión **digitados por el usuario**, valida monto > 0 y que los viajes sigan Cerrados, y hace `UPDATE … SET estado_admin='Emitida'`. **Anulada**: `anularFactura` (~L1566; solo Borrador o Emitida sin pagos), conserva el detalle en el histórico y libera viajes. |
| ¿Existe integración FEL? | **No.** Ni certificador (INFILE), ni UUID/serie/número de autorización, ni fecha de certificación, ni XML, ni llamada HTTP externa. `fact_facturas` no tiene columnas FEL (`sql/migrate-2026-10-fact-2-…` lo dice: «Sin FEL: no hay UUID, serie, XML ni …»). Hay una prueba de arquitectura que lo exige (`sin-fel-fase1.test.ts`). Los documentos `docs/FEL-INFILE-*.md` son **PLAN/DISEÑO «No implementado»**, bloqueados por la documentación y el sandbox de INFILE (`FEL-INFILE-DATOS-FALTANTES.md`). |
| ¿Existe el punto «registro administrativo → documento certificado»? | **No.** «Emitida» es un cambio de estado administrativo: el número lo escribe una persona y nada demuestra que SAT/certificador haya autorizado el DTE. |
| ¿Quién consume `registrarEventoContableTx`? | **Nadie** (PR A: «Infraestructura sin callers productivos»; verificado también por prueba). `emitirFactura` no toca `cont_eventos` ni asientos. |
| `FACTURA_EMITIDA` en `cont_eventos` | Permitido (`TIPOS_EVENTO = FACTURA_EMITIDA, COBRO_CONFIRMADO, RETENCION_NO_EMITIDA`); clave `FACTURA_EMITIDA:<facturaId>` por (empresa, entidad). |

**Conclusión: CASO B.** Conectar contabilidad a `emitirFactura` contabilizaría documentos que aún pueden no ser fiscalmente válidos
(el propio diseño dice «Sin FEL real no hay póliza»; Milenium tampoco deja póliza en facturas anuladas ni antes de certificar).

## 2. Datos que ya existen para cuando haya hito (no hay que inventarlos)

| Dato | Fuente |
|---|---|
| Empresa / entidad contable | `fact_facturas.empresa_id` / `entidad_id` (**NULL** en facturas anteriores a FACT-4) |
| Moneda | `fact_facturas.moneda CHAR(3) DEFAULT 'GTQ'` |
| Base / IVA / total | importes oficiales por línea (`base_monto`, `iva_monto`, `total_linea`) y `subtotal`, `iva_monto`, `monto_total` de la cabecera |
| Clasificación bienes/servicios | **por línea**: `clasificacion` SERVICIO/BIEN (FACT-4, `modelo_lineas`); facturas anteriores: `NULL` ⇒ no inequívoca |
| Condición de pago | `condicion_pago` CREDITO/CONTADO (informativa para la póliza) |
| Retención | `retencion_iva_pct` 0/15/30 |
| Anulación | `estado_admin='Anulada'` + histórico de líneas (`fact_factura_viajes_anuladas`) |

## 3. `poliza-venta.ts` (revisado y corregido)

- **Sin consumidores productivos:** solo `calcularRetencionIva` se importa desde `facturas.ts`; `proponerPartidaVenta` solo lo usan
  pruebas. Era código de **propuesta**.
- **Contradecía la regla confirmada:** CONTADO → rol `BANCOS` (que ni siquiera existe en `ROLES_CONTABLES`). **Corregido en esta
  PR**: CONTADO y CRÉDITO → `CLIENTES`; se eliminó el rol `BANCOS` y el requisito de cuenta bancaria. Es la **única fuente de verdad**
  de la partida; el evaluador de PR C la reutiliza (no hay un segundo motor).
- La retención sigue modelada (DEBE `RETENCION_IVA`) solo como cálculo/propuesta; la automatización la **bloquea** (§5).

## 4. Qué se preparó (INERTE, sin activar nada)

- `src/lib/contabilidad/factura-emitida.ts`: **evaluador puro** `evaluarContabilizacionFactura(factura, rolesConfigurados)` →
  `LISTA` (Dr CLIENTES / Cr VENTAS_x / Cr IVA_POR_PAGAR, Decimal, cuadrada, fecha contable = fecha de emisión) o `BLOQUEADA` con
  código y mensaje visibles; y `construirSnapshotFacturaEmitida` (contrato cerrado de `snapshotContableSchema`, huella estable).
- **Bloqueos** (sin fallback): anulada · no emitida · **no certificada** · sin entidad · moneda ≠ GTQ · retención ≠ 0 · línea sin
  clasificar · rol sin cuenta (p. ej. `VENTAS_BIENES`: «Cuenta VENTAS_BIENES no configurada», **sin** usar `VENTAS_SERVICIOS`) ·
  importes que no cuadran · sin fecha · sin líneas.
- Pruebas de arquitectura que fijan la inercia: nadie lo importa, `emitirFactura` no registra eventos/asientos y
  `registrarEventoContableTx` sigue sin llamadores.
- **No** se crean seeds (`VENTAS_BIENES` queda sin cuenta), ni botón «contabilizar», ni estado contable en pantalla (no habría qué
  mostrar: todo estaría «Factura aún no certificada»).

## 5. Qué falta para activar PR C

1. **El hito FEL real** (bloqueo principal): certificación con INFILE (FEL-2…FEL-4 del plan): modelo FEL **separado** de
   `estado_admin` (`fel_documentos` con estado `CERTIFICADO`, UUID/serie/número de autorización, fecha de certificación y su vínculo
   a `fact_facturas`); proveedor real con sandbox y credenciales de TEST, clasificación CERTIFICADO/RECHAZADO/INCIERTO y
   recuperación sin doble certificación. Ver §6.1: `estado_admin` nunca será la fuente de verdad fiscal.
2. **Decisión de negocio sobre retenciones** (esperada vs. constancia SAT; ajuste `Dr CLIENTES / Cr RETENCION_IVA`) — PR C las bloquea.
3. **Cuenta `VENTAS_BIENES`** configurada por Contabilidad para cada entidad que venda bienes.
4. **Regla de anulación contable** (mismo período / posterior / período cerrado / fecha del reverso / nota de crédito).
5. **Backfill/transición**: qué hacer con facturas Emitidas previas (no se contabilizan: decisión explícita, nunca implícita).

## 6. Propuesta mínima para cerrar el hito (cuando FEL exista)

### 6.1 Dos conceptos que NO se mezclan

| Concepto | Dónde vive | Para qué sirve |
|---|---|---|
| **Estado administrativo / operativo** | `fact_facturas.estado_admin` (`Borrador`/`Emitida`/`Anulada`) | Flujo interno: editar, bloquear edición, listar, registrar pagos. **No es prueba de certificación.** |
| **Estado fiscal (FEL)** | modelo FEL **separado**: `fel_documentos.estado = 'CERTIFICADO'` + UUID + autorización + serie/número certificados + fecha de certificación | **Única fuente de verdad fiscal** y, por tanto, de la contabilización. |

Reglas, desde ahora y para cuando exista FEL:

- `estado_admin = 'Emitida'` **nunca** será prueba ni criterio suficiente para generar `FACTURA_EMITIDA`. Puede **actualizarse o
  sincronizarse** como estado operativo si el diseño FEL lo requiere, pero el asiento jamás depende de él.
- La transacción de reconocimiento contable **debe comprobar** que existe el registro FEL `CERTIFICADO` **bajo la misma empresa y
  la misma factura** (y entidad) antes de generar el evento; sin él, no hay asiento aunque el estado administrativo diga «Emitida».
- El evaluador (`evaluarContabilizacionFactura`) recibe la `certificacion` **derivada de ese registro FEL real** (lectura dentro de
  la misma transacción), nunca un objeto armado a partir de `estado_admin`, del número digitado o de cualquier dato de la factura.

### 6.2 Patrón transaccional (sin transacción distribuida y sin transacción abierta durante la llamada HTTP)

1. Acción de emitir → servicio FEL: persiste el **intento** (`fel_intentos`) con clave idempotente y llama al certificador **fuera**
   de toda transacción de BD.
2. El resultado `CERTIFICADO` se **persiste** en `fel_documentos` (UUID, autorización, serie/número, fecha de certificación).
3. **Transacción DB idempotente de reconocimiento** (única): `SELECT … FOR UPDATE` de la factura (empresa/entidad) → **lee el
   `fel_documentos` CERTIFICADO de esa empresa/factura** → (opcional) sincroniza `estado_admin` como estado operativo →
   `evaluarContabilizacionFactura` con la certificación leída → `registrarEventoContableTx(FACTURA_EMITIDA)` (evento + asiento +
   líneas + auditoría) → commit. Si el evaluador **bloquea**, el documento fiscal queda certificado (no se deshace) y la factura
   queda «contabilización bloqueada» con su motivo; un reintento idempotente la reconoce al resolverse el bloqueo (misma clave ⇒
   nunca dos asientos).
4. Una factura contabilizada **nunca** se corrige mutando ni borrando el asiento: reverso/nota de crédito.

### 6.3 El modelo FEL debe soportar después (sin mutar el asiento original)

- **Notas de crédito FEL** (documento fiscal propio, certificado, con su evento contable `NOTA_CREDITO`).
- **Anulación** del documento certificado (según contrato del certificador y regla de período).
- **Refacturación** (documento nuevo que sustituye al anulado/corregido).
- **Relación original ↔ correctivo** (`documento_origen`): una nota de crédito o una refacturación apuntan al documento FEL original.

En todos los casos el asiento original **permanece intacto**: la corrección es un **asiento nuevo** (reverso/NC) vinculado por
`evento_origen_id`, jamás un `UPDATE`/`DELETE` del asiento de la venta.

Permiso administrativo (opcional, a proponer entonces): «reintentar contabilización» — solo ejecuta la misma transacción
idempotente; no permite crear asientos manuales ni evita la comprobación del registro FEL.

Permiso administrativo (opcional, a proponer entonces): «reintentar contabilización» — solo ejecuta la misma transacción
idempotente; no permite crear asientos manuales.

## 7. UX

Sin cambios: mostrar «Estado contable» hoy solo diría «Factura aún no certificada» en todas. Se activará con el hito.

## 8. Tests mínimos pedidos (cuando se active)

Los casos 1-28 del ticket quedan listos como contrato: el **evaluador** ya cubre (1-8, 19-23, 27 y la parte pura de 16-18 vía
roles faltantes). Faltan, y dependen del hito/BD: idempotencia same/same y same/different (11-12), carreras (13), otra empresa/
entidad (14-15), rollbacks por cuenta faltante en BD (16-18), atomicidad evento↔asiento (24-25), auditoría (26) y «no crea
`fact_pagos`/`fact_pago_confirmaciones`» (9-10), todos contra MariaDB desechable.
