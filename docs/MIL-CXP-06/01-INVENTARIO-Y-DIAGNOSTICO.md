# Inventario funcional y diagnóstico técnico

Base y convenciones: [README](README.md). Todas las aprobaciones productivas permanecen **PENDIENTES**. Las reglas fiscales descritas son las del repositorio y sus decisiones documentadas, no una validación legal nueva.

## Inventario

| Funcionalidad | IMPLEMENTADO | VERIFICADO TÉCNICAMENTE | PROBADO y evidencia | APROBADO | PENDIENTE |
| --- | --- | --- | --- | --- | --- |
| Proveedor comercial y consulta | Sí, maestro Compras reutilizado; CxP no crea otro maestro | `compras/proveedores.ts`, `cxp/proveedor-fiscal.ts`, `cxp/http.ts` | Suites CxP validan config/ámbito; alta comercial completa no certificada aquí | Sin aprobación productiva acreditada | Homologación NIT/código origen, duplicados, revisión de campos expuestos H-01 |
| Configuración fiscal por entidad | Sí, régimen/sujeción/cuentas | Validación cuenta activa, tipo y ámbito; transacción/auditoría | `cxp-m3a.db.test.ts` y puras existentes; no reejecutadas DB aquí | Decisiones parciales documentadas M-3A/B1 | Validación operativa de catálogos y política fiscal |
| Facturas pendientes/parciales/pagadas | Sí, estado financiero derivado | `facturas.ts`, `saldo.ts`, `saldo-lectura.ts` | LAB-02 caso 2; tests puros/HTTP/DOM | QA sintética limitada; producción pendiente | Datos reales conciliados; corrección documental y distribución entre libros |
| Pagos y aplicaciones | Sí, un proveedor y entidad, hasta 50 facturas | `pagos.ts`, `aplicaciones.ts`, DDL M-3B1 | LAB-02 casos 2/4; suite heredada M-3B1 contiene concurrencia/idempotencia | QA de casos LAB-02; producción pendiente | Duplicidad de negocio con claves distintas, autorización de desembolso, vínculo banco/póliza |
| Reversión y anulación | Sí, reverso completo con motivo; anulación sin pagos vigentes | Filas conservadas; bloqueos y auditoría | LAB-02 caso 2; pruebas heredadas y regresión offline | Sin aprobación productiva | Reversa parcial, fechas de efecto histórico, recuperación probada |
| Antigüedad | Sí, saldo actual; tramos por fecha documento | `antiguedad.ts`, `lectura-cxp.ts` | Suites puro/HTTP/DB existentes; documento CXP-01 reporta QA navegador sintética histórica | Decisiones de alcance; no producción | Consistencia H-02; equivalencia de tramos/corte Milenium |
| Estado de cuenta proveedor | Sí, actual, pagadas/anuladas opcionales | `estado-cuenta.ts`; datos de pago/fiscales según permiso en este reporte | Suites puro/HTTP/DB; QA histórica documentada CXP-02 | D1–D8 documentadas; no producción | Histórico por fecha y reporte comparativo validado |
| ISR factura normal | Sí, regla versionada y snapshot | `isr-proveedor.ts`, `facturas.ts`; Decimal HALF_UP | Pruebas puras y DB heredadas con fronteras; LAB-02 no sustituye toda esa suite | Documento M-3B1 registra confirmación de Contabilidad | Reconcilio con configuración origen; factura especial/IVA retenido |
| Excel | Sí, antigüedad/estado de cuenta/integridad | Tres generadores Excel; neutralización y precisión | LAB-02 casos 6/7/11 para integridad; tests específicos de otros libros | QA técnica limitada; no producción | Apertura operativa en Excel y aprobación de formato por usuarios |
| Notas de crédito/débito CxP | No se identificó flujo operativo | Fuera del modelo y de los reportes actuales | Sin cobertura de capacidad inexistente | Pendiente | Reglas, signos, documentos origen, fiscalidad y aplicaciones |
| Anticipos CxP | No; cuenta de anticipo configurable no crea movimientos | Pago exige al menos una aplicación | Validación de pago existente | Pendiente | Saldo no aplicado, posterior aplicación, devolución y permisos |
| Saldos históricos/conciliación | No hay corte histórico ni importación acreditada | Reportes advierten saldo actual; `cont_cxp` separado | LAB-02 sólo datos sintéticos | Pendiente | Extracción, trazabilidad, saldos iniciales/corte y conciliación al mayor |
| Permisos y bitácora | Sí, filas propias, tenant, `auditoria` | `tenant.ts:770`, `http.ts`, `bitacora.ts`; Admin exento del guard de módulo/fila tras tenant | Puras/HTTP/bitácora DB existentes; LAB-02 cubre ámbito y visibilidad de pagos | Política central documentada; no producción | Guard real extremo a extremo y H-01; segregación de funciones |
| Integridad | Sí, diagnóstico de lectura sin correcciones | `integridad.ts`, `saldo-lectura.ts` | LAB-02 12 casos | Informe LAB-02 declara QA integración aprobada, alcance limitado | No certifica origen, saldos reales ni ausencia total de anomalías |

## Arquitectura y relaciones reales del código/DDL

- `compras_proveedores`: identidad comercial por empresa; `cxp_proveedor_fiscal`: PK `(empresa_id, entidad_id, proveedor_id)`, FK al maestro, entidad y cuentas. No es un maestro importado de Milenium.
- `cxp_facturas`: documentos, fechas, importes DECIMAL(14,2), tasa DECIMAL(5,2), regla ISR y régimen congelados. FK a configuración fiscal; estado REGISTRADA/ANULADA y actor/fecha/motivo. UNIQUE `(empresa_id, proveedor_id, serie_norm, numero_norm)` atraviesa entidades de la misma empresa y reserva anuladas. No incluye moneda, ID origen ni asiento contable.
- `cxp_pagos`: proveedor/entidad, fecha, monto, medio y referencia de texto, clave idempotente por empresa/entidad, huella de contenido, REGISTRADO/REVERSADO y trazabilidad.
- `cxp_pago_aplicaciones`: relación N:M pago/factura, monto positivo y UNIQUE pago/factura en ámbito. FK compuestas impiden cruces empresa/entidad. La igualdad de proveedor, suma de aplicaciones y límite de saldo se imponen en servicio/postcheck, **no** por una FK o CHECK entre cabeceras.
- `auditoria`: acciones CxP escritas dentro de la transacción; bitácora exige `cxp_bitacora:ver`. No se acredita auditoría inmutable ante acceso SQL privilegiado.
- `cont_cxp` legado persiste separado. No hay puente/importación automática a `cxp_facturas`; sumarlos sin conciliación puede duplicar obligaciones. `fact_*` pertenece a clientes, no es sustituto de pagos CxP.

El modelo descrito está comprobado en fuentes y contratos SQL. El esquema efectivamente instalado en una base empresarial no fue inspeccionado.

## Integridad monetaria y transaccional

El servidor calcula total=base+IVA, ISR y pagadero=total−ISR. Pagado vigente=suma de aplicaciones de pagos REGISTRADOS, excluye REVERSADOS; ISR no es pago. Saldo válido=pagadero−pagado. Decimal sobre strings evita coma flotante; exportadores preservan precisión ante límite de 15 dígitos de Excel. Para anomalías, Facturas devuelve saldo null y advertencias; estado de cuenta conserva saldo crudo informativo y no compensa excesos. No usar null como cero.

Pagos usan READ COMMITTED, bloqueo de facturas `ORDER BY id FOR UPDATE`, validan proveedor/estado/saldo antes de INSERT y registran auditoría antes del commit. Anulación bloquea factura y rechaza aplicaciones vigentes. Reverso bloquea cabecera de pago, conserva aplicaciones. Los conflictos transitorios se traducen a 409; no se acredita ausencia universal de deadlocks. La clave evita repetir el mismo envío; **dos claves distintas pueden representar el mismo desembolso real**, especialmente pagos parciales sobre saldo disponible. No hay unicidad bancaria por referencia.

Facturas/pagos no generan pólizas, no ejecutan transferencias y no validan cierre contable mediante helpers de períodos en estos servicios. Debe definirse si son submayor informativo o proceso contable integrado antes de operar. No se modifican reglas actuales.

## Permisos y aislamiento

Empresa y actor proceden del tenant; entidad es parámetro único entero y se verifica en servicios correspondientes. Consultas y joins CxP inspeccionados incluyen empresa/entidad. No se identificó una fuga confirmada entre empresas; esto no equivale a prueba exhaustiva de todos los endpoints.

La política vigente `CONTABILIDAD-ACCESO-UNIFICADO.md` permite acceso a libros de la empresa según permiso central. `cont_entidad_usuarios` es legado sin efecto; no es por sí mismo un defecto nuevo ni se cambia aquí. Documentos M-3A/B1 antiguos lo presentan como pendiente; la política posterior y CXP-01/02 aclaran la decisión. Cualquier restricción usuario–entidad es transversal, referencia #555, cuyo estado remoto no se comprobó.

## Hallazgos y riesgos

| ID / prioridad | Evidencia y alcance | Riesgo / acción propuesta |
| --- | --- | --- |
| H-01 / alta | `http.ts:listarProveedoresHttp` acepta sólo `cxp_facturas:ver`; `proveedor-fiscal.ts:listarProveedoresCxp` devuelve objeto `fiscal` completo sin filtrar por `cxp_proveedor_fiscal:ver`. Inspección estática; no se hizo petición real | Posible exposición de régimen/sujeción/IDs de cuentas sin permiso fiscal específico. CXP-02 protege esos campos sólo en su reporte. Confirmar contrato con responsable; reproducir matriz de permisos y proponer filtrado en ticket separado. No se afirma fuga entre tenants |
| H-02 / alta condicionada al aislamiento | `lectura-cxp.ts:enInstantanea` impone REPEATABLE READ sólo con opción; `integridad.ts` la activa, `antiguedad.ts` y `estado-cuenta.ts` no. Inspección estática | Con sesión READ COMMITTED la instantánea podría no cubrir todas las consultas; validar dos conexiones/escritor en ambas suites. LAB-02 caso 8 acredita Integridad, no esos reportes. Sin defecto reproducido en motor durante este ticket |
| H-03 / bloqueante | No se consultó base real; sólo hay DDL y laboratorio | Preflight contractual y postcheck del entorno objetivo por usuario antes de uso; no inferir migración por existencia de tablas/código |
| H-04 / bloqueante | No hay importador/histórico CxP acreditado; `cont_cxp` y modelo nuevo separados | Cartera incompleta/doble conteo. Inventario de origen, corte, conciliación documental y al mayor |
| H-05 / alta | FK de aplicación no comprueba mismo proveedor; no existe CHECK de suma/sobreaplicación interfilas | Escritura SQL externa puede violar invariantes; privilegios mínimos, controles de importación y postcheck. Panel detecta sólo categorías definidas, no integridad universal |
| H-06 / alta | Pagos: clave idempotente técnica; referencia libre; sin banco/póliza/período | Doble desembolso y divergencia con contabilidad. Diseñar conciliación y segregación; decidir contrato contable antes de implementar |
| H-07 / media | UNIQUE documental sin entidad y anuladas reservan número; vencimiento manual, GTQ rotulado sin moneda persistida | Bloqueo de distribución entre libros, captura errónea, datos multimoneda no representables. Confirmar necesidades sin relajar controles automáticamente |
| H-08 / media | `listarProveedoresCxp LIMIT 300`, `listarCuentasCxp LIMIT 2000` sin paginación explícita en esas funciones | Catálogos extensos pueden quedar fuera del selector; evaluar volumen real anonimizado y diseño de búsqueda/paginación |
| H-09 / documental | CXP-05 integrado conserva estado previo a LAB-02; originales privados no revalidados | Consolidar expediente con cadena de evidencia, sin elevar QA a autorización productiva |

La antigüedad usa saldos positivos y no sustituye al panel de integridad. `PAGADO_NO_COINCIDE_CON_LINEAS` no es evaluable en Integridad, responde 422 si se solicita; se conserva en estado de cuenta. Sin tablas de pagos, Integridad declara revisión incompleta, mientras otras lecturas pueden asumir pagado cero. Un despliegue incompleto o pérdida de tablas no debe interpretarse como cartera saldada o limpia.

## Migraciones y compatibilidad

| Migración | Existencia e integración | Laboratorio LAB-02 | Base real |
| --- | --- | --- | --- |
| M-3A | preflight/migrate/postcheck, generador y DDL; merge #481 | aplicada, hash 58f1925639253417e4facf922bd99f20dbfa699819369f20808814fab0154db4 | PENDIENTE, ninguna conexión |
| M-3B1 | preflight/migrate/postcheck/rollback, generador y DDL; merge #491 | aplicada, hash 14c5a10576d22b2abccc970031818e55c4c98a43a1b9f53883327f37002cb821 | PENDIENTE, ninguna conexión |

M-3A audita 74 objetos y requiere estructuras base compatibles (`compras_proveedores`, `usuarios`, `cont_entidades`, `cont_cuentas` e índices compuestos). M-3B1 audita 43 objetos y depende de M-3A. Estados CLEAN/FINAL/DIVERGENTE son contratos del esquema; no certificados de conciliación contable. Los DDL usan InnoDB y `utf8mb4_uca1400_ai_ci`; compatibilidad del motor objetivo debe verificarse, no se presume compatibilidad MySQL por usar mysql2.

Después de B1, el postcheck A antiguo no cubre la fórmula ISR de tramo alto: usar postcheck B1 para integridad fiscal actual. No editar generados manualmente. Rollback B1 sólo con ambas tablas vacías; con movimientos, reversos no vacían tablas y no habilitan ese rollback. No se encontró rollback M-3A equivalente en el conjunto revisado: recuperación exige plan de respaldo/restauración aprobado.
