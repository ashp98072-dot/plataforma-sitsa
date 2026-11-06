# Plan de preparación operativa — propuesta, no ejecución

Toda operación SQL productiva permanece reservada al usuario. Este plan no autoriza ejecutar scripts, migraciones, importaciones, restauraciones o iniciar laboratorios. La auditoría independiente de MIL-CXP-06 precede cualquier implementación/integración.

## Secuencia y puertas de control

| Paso | Responsable futuro / actividad | Evidencia y criterio de salida |
| --- | --- | --- |
| 0. Auditoría independiente | ChatGPT/revisor designado revisa expediente y LAB-02 | Dictamen escrito sobre alcance, H-01/H-02, faltantes; decisiones de negocio pendientes asignadas. Sin continuar automáticamente |
| 1. Preflight técnico | Usuario/DBA identifica entorno objetivo y custodio; diseño de ensayo aislado | Alias, versión exacta, motor/collation, InnoDB, CHECK/FK, zona horaria, sql_mode, aislamiento, privilegios, capacidad, respaldo/restauración verificables. Identidad sin secretos en entregable |
| 2. Migraciones efectivas | Usuario ejecuta sólo preflight autorizado por escrito, guarda salida y hashes en misma sesión por script | A: 74 objetos; B1: 43, depende de A. FINAL/FINAL para habilitar núcleo completo. CLEAN requiere autorización de migración separada; DIVERGENTE detiene. Revisar índices padres/contratos, no sólo nombres de tablas |
| 3. Integridad y saldos | Usuario/DBA y Contabilidad sobre copia consistente primero | Huérfanos/cross-tenant/proveedor, totales base+IVA−ISR, pagos=suma aplicaciones, anuladas sin pagos vigentes, excesos no compensados. Panel completo y postcheck B1; cada discrepancia resuelta o excepción firmada. Cero hallazgos no sustituye controles independientes |
| 4. Pruebas sintéticas/anonimizadas | QA, entorno identificado y autorizado por separado | Factura sin pago/parcial/pagada, múltiples aplicaciones, ISR fronteras, 0.01 exceso, reverso/anulación, claves iguales/distintas, concurrencia dos escritores y anulación/reverso. Ningún fixture se presenta como histórico real |
| 5. Conciliación origen/destino | Contabilidad con extractor revisado | Cantidades y montos por empresa/libro/proveedor/documento/tipo/estado a corte aprobado; obligación bruta, retención, pagadero, pagos y saldo separados. Trazabilidad por lote/clave origen, duplicados y rechazos identificados. Conciliar además con mayor/banco, no sólo entre dos reportes del destino |
| 6. Permisos y libros | Administrador funcional y QA | Sin sesión 401/403, empresa ajena 404/403, lectura sin escritura, ausencia de detalles pagos/fiscales sin permiso en todas las rutas, revocación efectiva, Admin documentado, cambio empresa/libro sin datos previos. Política de acceso central ratificada; decisión sobre segregación antes de cambiarla |
| 7. Recuperación | Usuario/DBA ensaya en copia | Respaldo restaurado y comprobado, RPO/RTO acordados, identificación de lote, bloqueo temporal de capturas, reanudación sin doble registro y conservación de auditoría. SQL rollback B1 sólo con tablas vacías; con datos, conservar y reversar o restaurar bajo autorización expresa |
| 8. Aceptación | Contabilidad + TI + custodio | Acta de resultados y pendientes, alcance soportado explícito, capacitación y procedimiento operativo; nueva autorización productiva separada con preflight y postcheck |

No se propone ejecutar indiscriminadamente todas las suites DB: algunas guardas heredadas difieren de LAB-02. Una fase de QA futura debe identificar cada conexión, base temporal y propietario, evitar `.env` productivo y probar limpieza de sólo sus recursos. No se reinicia el laboratorio conservado apagado sin nueva autorización.

## Cobertura existente y faltante

LAB-02 (2026-11-05, MariaDB 11.8.9):

1. Entidad vacía, contadores y limitaciones.
2. Sin pago/parcial/total/reversado/anulación mediante servicios reales.
3. Anomalías sintéticas múltiples y filtros/contadores.
4. DECIMAL exacto, exceso 0.01 y exclusión de reversos.
5. Separación de empresas/entidades/proveedores y 404.
6. Orden/páginas/exportación completa y fórmula neutralizada.
7. XLSX reabierto, céntimos, columnas/detalles por permiso.
8. Snapshot Integridad con escritor independiente y sesión READ COMMITTED sobreescrita por REPEATABLE READ/READ ONLY.
9. Error SQL deliberado, fin de transacción y liberación de conexión.
10. Volúmenes 10/100/1000, tiempos y cuatro EXPLAIN por volumen.
11. Exportación 10000 aceptada y 10001 rechazada antes de cargar filas.
12. Tablas de pagos ausentes, revisión incompleta y restauración en base QA.

Resumen verificado del JSON: **12 PASS / 0 FAIL / 0 SKIP**. Hash de cada archivo sanitizado validado en MIL-CXP-06. Cleanup y apagado son evidencia histórica del expediente, no nueva inspección de procesos. No se repitió el laboratorio.

Hay pruebas en `src/lib/contabilidad/cxp`: puras, HTTP con guard/SQL doblados, DOM happy-dom, DB M-3A/B1 y rollout, bitácora, antigüedad, estado de cuenta, integridad. La existencia de esos archivos y los resultados históricos narrados no acredita una ejecución actual de todas las suites DB. LAB-02 no ejecutó las otras suites DB ni todas las carreras de escritura M-3B1.

Cobertura por completar antes de habilitar operación:

- H-01 con usuario sin permiso fiscal, guard real y contenido exacto del JSON de proveedores/configuración/cuentas; ruta positiva y negativa.
- H-02 con sesión READ COMMITTED y escritor independiente para antigüedad y estado de cuenta; totales, páginas y líneas bajo misma vista.
- Concurrencia e idempotencia de escritores revalidadas en versión objetivo, reverso frente a nuevo pago/anulación y recuperación ante respuesta perdida tras commit; dos claves distintas para un desembolso.
- Configuración real de roles, tenant y módulo sin mocks; segregación y revocación; política de libros confirmada.
- Reapertura manual de Excel, QA visual de todos los flujos y catálogos grandes (más de 300 proveedores/2000 cuentas).
- Importación anonimizada con trazabilidad, fecha de corte e histórico; equivalencia de reportes origen; integridad de signos, códigos y referencias.
- Respaldo/restauración, conciliación mayor/banco, operación ante esquema parcial o divergente y contabilidad de períodos cerrados.
- Carga representativa y límites acordados. Los EXPLAIN de LAB-02 incluyen filesort/temporary: no justifican por sí solos un índice ni un SLA productivo.

## Criterios de aceptación para futura autorización

- Main/código, artefacto y migraciones identificados por SHA; entorno objetivo comprobado; preflight y postcheck exitosos conservados por usuario.
- H-01 cerrado mediante decisión y prueba; H-02 reproducido/resuelto o descartado con evidencia del aislamiento soportado, no por suposición del default.
- Ninguna fuga entre empresas ni campos restringidos sin permiso; roles y excepciones Admin aprobados.
- Conciliación exacta a centavo por documento y agregado: diferencias sin explicar = bloqueo. No compensar exceso de una factura contra deuda de otra.
- Tipo de cambio/moneda, factura especial, NC y anticipos excluidos expresamente del piloto o implementados y probados en tickets autorizados; no representarlos con documentos ficticios.
- Definición firmada del corte, procedencia, no doble conteo legado/nuevo y del rol del submayor frente al mayor y banco.
- Recuperación ensayada con tiempos/ responsables aprobados; conservación de auditoría; procedimiento para reversos e incidentes.
- Contabilidad acepta los reportes/formatos y resultados con datos anonimizados; custodio autoriza por escrito el alcance productivo. El PASS técnico no reemplaza estas decisiones.

## Tickets propuestos por dependencia (nombres sugeridos, no creados)

| Orden / propuesta | Depende de | Alcance y salida |
| --- | --- | --- |
| T1 CXP-PERMISOS-FISCAL | Auditoría independiente de MIL-CXP-06 y decisión de visibilidad | Reproducir H-01; definir contrato de campos y proponer corrección mínima con regresión de todos los consumidores |
| T2 CXP-REPORTES-SNAPSHOT | Auditoría independiente | Ensayar H-02; fijar contrato de aislamiento soportado para ambos reportes, corregir sólo con autorización posterior |
| T3 CXP-ORIGEN-CONTRATO | Custodio/Contabilidad | Diccionario, claves/signos, muestra anonimizada, mapa empresa/libro y corte; decisiones NC/anticipos/contraseñas/fechas históricas |
| T4 CXP-PREFLIGHT-OBJETIVO | Identidad y autorización del usuario, T1/T2 antes de habilitar | Usuario comprueba motor/migraciones/contratos y entrega salidas sanitizadas; divergencias se diagnostican en ticket separado |
| T5 CXP-QA-OPERATIVA | T1/T2, laboratorio autorizado, contrato T3 | Regresión DB de escrituras y reportes, guard real, roles, catálogo grande, Excel y restauración. No implica producción |
| T6 CXP-DISEÑO-IMPORTACION | T3 y compatibilidad de esquema T4 | Diseño de staging/procedencia/idempotencia, conciliación y recuperación; sin cargar histórico ni inventar saldo inicial |
| T7 CXP-MOVIMIENTOS-PENDIENTES | T3 y decisiones contables | Tickets separados para NC/anticipos/contraseñas/factura especial si se requieren; no ampliar automáticamente el núcleo |
| T8 CXP-CONTRATO-MAYOR-BANCO | T3 y definición del papel contable de CxP | Diseñar conciliación y efectos de pólizas/períodos/cuentas bancarias sin duplicar efectos; implementación posterior separada |
| T9 CXP-PILOTO-CONCILIADO | T4/T5/T6 y capacidades requeridas T7/T8 | Ensayo de importación autorizado en entorno aislado, controles origen/destino y aceptación de Contabilidad |
| T10 CXP-AUTORIZACION-OPERATIVA | Piloto aceptado, recuperación y bloqueantes cerrados | Expediente de autorización explícita; SQL productivo sólo por usuario con preflight, respaldo y postcheck |

Estado final de MIL-CXP-06: documentación para revisión independiente. **La migración de Milenium no se declara completada.** No se crea PR, commit, push ni integración, ni se ejecuta el siguiente ticket.
