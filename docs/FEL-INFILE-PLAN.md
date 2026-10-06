# FEL con INFILE — Plan por fases, convivencia con Milenium y riesgos

Estado: **PLAN. No implementado.** Las fases FEL-3 en adelante **no pueden empezar** sin la documentación y el sandbox de INFILE ([DATOS FALTANTES](FEL-INFILE-DATOS-FALTANTES.md)). Cada fase es un PR aparte con autorización previa (CLAUDE.md §3: no se avanza a la siguiente fase automáticamente). Ver [DISCOVERY](FEL-INFILE-DISCOVERY.md) y [ARQUITECTURA](FEL-INFILE-ARQUITECTURA.md).

## 1. Fases

### FEL-0 — Decisiones y accesos (sin código)
- Respuestas de negocio: IVA (¿las tarifas incluyen IVA?), descripción del ítem, tipos de documento reales, régimen/frases por emisor, retenciones.
- Datos fiscales de cada emisor (KT, Mónaco) y regla de numeración/corte con Milenium.
- Solicitar a INFILE el paquete de [DATOS FALTANTES §B](FEL-INFILE-DATOS-FALTANTES.md).
- **Criterio de salida:** documentación oficial, sandbox y credenciales de **TEST** en poder del responsable; decisiones de negocio firmadas.

### FEL-2 — Modelo + dominio + proveedor mock (sin red)
- Migración manual propuesta (`fel_emisores`, `fel_documentos`, `fel_intentos`, columnas aditivas en `fact_facturas`) con preflight; reconciliar `schema.sql`.
- `src/lib/fel`: tipos, estados, `FelProvider`, mapper `Factura → DTO` (con fixtures sintéticos), servicio con el protocolo de idempotencia (§7), redacción de logs, cifrado con `FEL_CREDENTIALS_KEY`.
- Proveedor `MOCK` determinista (incluye timeout/respuesta perdida).
- Pruebas: protocolo completo contra el mock, **caso de corte de conexión**, doble clic/concurrencia, bloqueos de estado, redacción de logs, aislamiento por empresa/entidad.
- **No** toca UI productiva ni emite nada. **Criterio:** el caso «certificó pero no recibí respuesta» se recupera sin doble certificación en pruebas.

### FEL-3 — Integración sandbox INFILE
- `providers/infile`: autenticación, certificar, consultar (y anular si el contrato lo permite) **según la documentación oficial**, clasificando resultados en CERTIFICADO/RECHAZADO/INCIERTO/ERROR_CONFIG.
- Solo ambiente TEST; guard que impide credenciales TEST contra URL PROD.
- Pruebas de contrato con respuestas grabadas del sandbox (sin secretos).
- Herramienta offline de comparación con histórico de Milenium (estructura/totales, sin guardar datos).
- **Criterio:** facturas de prueba certificadas en sandbox, estructura equivalente a los casos históricos.

### FEL-4 — UI + permisos + flujo completo
- Permisos FEL en el catálogo; rutas (`emitir` delega, `fel/*`); estado FEL en la tabla/detalle; configuración de emisores write-only; PDF (proveedor y/o propio); descargas XML/PDF.
- Bloqueos de edición/pagos según estado FEL.
- **Criterio:** flujo completo en TEST por usuarios reales sin tocar producción.

### FEL-5 — Anulaciones y notas de crédito/débito
- Anulación FEL (motivo, confirmación, reintento/consulta) y notas con referencia al origen; reglas por tipo; resolución del caso «anular con pagos».
- **Criterio:** anulación y nota de crédito certificadas en sandbox con trazabilidad.

### FEL-6 — Piloto en un emisor
- Un emisor (propuesta: el de menor volumen) en modo `PROD` desde una **fecha de corte**; período de operación en paralelo con revisión del contador; criterios de reversión.

### FEL-7 — Segundo emisor y operación normal
- Resto de emisores/empresas, retiro de la emisión en Milenium para esos emisores, conciliación contable (enlace con C4 del roadmap contable).

*Ajuste respecto al borrador del ticket:* se agregó FEL-0 (prerrequisitos) y el mock se mantiene en FEL-2 para poder probar la idempotencia antes de tener sandbox.

## 2. Convivencia temporal con Milenium

Escenario: durante un tiempo Milenium **sigue pudiendo emitir** y SITSA empieza a emitir.

| Riesgo | Mitigación propuesta |
|---|---|
| **Doble facturación del mismo viaje** (una en Milenium, otra en SITSA) | Fecha de corte por emisor (`inicio_emision`): SITSA solo factura viajes con `fecha_plan ≥ corte` (o desbloqueo explícito con permiso). Para viajes ya facturados en Milenium, marca `facturado_externo` (carga inicial desde Milenium o marcado manual) que los excluye de «viajes pendientes» |
| **Numeración** | La serie/número los asigna el certificador; **un emisor/establecimiento/serie no se usa en los dos sistemas a la vez** tras el corte. Antes del corte Milenium emite; después, SITSA. Si INFILE usa series separadas, usar una serie propia de SITSA durante la transición (A CONFIRMAR) |
| **Notas de crédito de facturas de Milenium** | Documento origen **externo**: campos de referencia manual (autorización, serie, número, fecha) validados con la consulta al certificador; hasta FEL-5 las notas sobre facturas viejas se siguen emitiendo desde Milenium |
| **Conciliación contable** | Mientras la contabilidad siga en Milenium, SITSA exporta cada documento certificado (factura/nota/anulación) para su captura; definir con el contador si es manual o por archivo. A largo plazo lo cubre el roadmap contable (C4) |
| **Cobros/pagos** | Pagos de SITSA solo para documentos de SITSA; los de Milenium se cobran en Milenium hasta cerrar la cartera |
| **Clientes con requisitos especiales** | Pasar al flujo SITSA por cliente (después del piloto), no todos a la vez |

**Estrategia de corte (preferida):** definir **fecha y emisor** desde los cuales SITSA es el sistema emisor; antes de esa fecha SITSA no certifica (el emisor queda en `TEST`/`DESACTIVADO`); después, Milenium no emite para ese emisor. Un período de paralelo de revisión y un plan de reversión (volver a Milenium en la fecha X) acordados con el responsable.

## 3. Riesgos y mitigaciones

| # | Riesgo | Mitigación |
|---|---|---|
| 1 | Certificar dos veces tras un timeout | Protocolo §7 (clave de idempotencia, `INCIERTA`, consultar/conciliar) |
| 2 | Emisor equivocado (KT vs Mónaco) | Emisor = (empresa, entidad); `entidad_id` obligatorio al certificar; verificación visible en UI |
| 3 | Datos fiscales incorrectos del receptor (NIT) | Validación de NIT, congelado, revisión antes de certificar |
| 4 | Regla de IVA mal definida | Decisión de negocio en FEL-0; pruebas con casos conocidos de Milenium |
| 5 | Pérdida de credenciales / rotación | Clave dedicada `FEL_CREDENTIALS_KEY`, `kid` versionado, procedimiento de rotación |
| 6 | Mezclar TEST y PROD | Filas y modos separados; rotulado «PRUEBA»; exclusión de reportes; guard URL/credenciales |
| 7 | Fuga de datos en logs | Redacción obligatoria + pruebas |
| 8 | Hostinger sin colas/cron | Reconciliación bajo demanda; si hiciera falta, un job externo después |
| 9 | Depender de un solo proveedor | Interfaz `FelProvider` |
| 10 | Limpieza de pruebas borra facturas con FEL PROD | Bloquear `limpiar-*` para facturas con documento PROD |
| 11 | `fact_facturas` fuera de `schema.sql` | Reconciliar al aplicar la migración |

## 4. Fuera de alcance de este plan

Importar datos de Milenium, contabilidad (partidas, libros), conciliación bancaria y cualquier emisión real. Se tratan en el roadmap contable (`docs/MILENIUM-INVENTARIO-FUNCIONAL.md`).
