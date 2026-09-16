# Planillas: diseño fiscal mínimo (propuesta, no implementación)

Fecha: 2026-09-16. Base inspeccionada: `c4d15fa56705d3847996963089ed797c0e4aa81a`.
Rama: `codex/rrhh-planillas-isr-igss-scroll`.
Solo diseño. No existe migración SQL en el repositorio y esta rama/PR no ha ejecutado SQL. El responsable confirmó que las dos sentencias CREATE TABLE propuestas fueron ejecutadas manualmente en phpMyAdmin después de redactar el diseño; la existencia y el esquema efectivo de ambas tablas deben verificarse antes de cualquier PR de modelo. Sin cambios de cálculo, UI, históricos ni otros módulos.
El esquema descrito es el del repositorio; antes de una migración se requiere `SHOW CREATE TABLE` de producción y versión de MariaDB/MySQL.

## 1. Gaps y reutilización real

- `empleados`: `empresa_id`, `fecha_alta`, `fecha_inicio_laboral`, `fecha_egreso`, `estado`, `sueldo_base`, `bono_incentivo`, `bono_herramientas`, `tipo_contrato`. Fechas administrativas y laborales no son necesariamente fecha de percepción fiscal.
- `rrhh_planilla_periodos`: fechas, identidad mensual/quincenal, estado, `autorizado_por/en`. La autorización se determina por `autorizado_en IS NOT NULL`.
- `rrhh_planilla_lineas`: sueldo, bonos, `otros_ingresos`, IGSS laboral/patronal, ISR, descuentos, neto, estado de pago y `conceptos_snapshot JSON NULL`. Importes agregados no permiten reconstruir automáticamente la clasificación de todos los históricos.
- `planilla-conceptos.ts`: snapshot v1 estricto con sueldo mensual, cuotas/manuales, horas extra y prestaciones/descuentos legado; autorización revalida pendientes y sueldo antes de aplicar conceptos, dentro de transacción.
- `horas_extra_registros`, `rrhh_prestaciones(tipo VARCHAR(80), monto, fecha, notas)`, descuentos/cuotas/abonos: reutilizar identidades y montos; no recrear devengados ni consumirlos al generar.
- `configuracion`: PK `(empresa_id, parametro VARCHAR(100))`, `valor TEXT`. Puede guardar configuración JSON versionada, con validación en aplicación; hoy `rrhh/config.ts` maneja parámetros conocidos, por lo que se necesitan helpers fiscales separados, no ampliar indiscriminadamente el formulario actual.
- `documentos_empleados`: documento protegido, empresa, empleado, tipo, ruta y autor/fecha. Reutilizar IDs; ningún almacenamiento/upload nuevo.
- `auditoria`/`registrarAuditoriaTx`: reutilizar trazabilidad.
- `isr.ts` calcula mensual equivalente sobre sueldo/bono incentivo, no historial anual ni variables; usa Q3,024 para 2026 y un placeholder Q48,000 para 2027. Generar conserva ISR previo, incluso sin autorización. Esto debe cambiar únicamente en un PR posterior.
- `contratos-pago.ts`: `IGSS_PATRONAL_PCT = 0.1267` está documentado como suma aproximada IGSS + IRTRA/INTECAP. El neto ya resta solo laboral + ISR + descuentos, no patronal. Exportación y UI etiquetan incorrectamente ese agregado.

Faltan: constancias previas, deducciones con evidencia, condición de varios patronos, reglas versionadas por concepto/carga, fecha efectiva de percepción y liquidación/devolución identificable. No basta sumar todas las planillas, incluyendo vistas previas.

## 2. Antecedentes manuales: una entidad por empleado/ejercicio con revisiones

Nueva tabla `rrhh_fiscal_empleado_ejercicio`: versiones inmutables, no un saldo que polling/generación vaya incrementando. Clave `(empresa_id, id_empleado, ejercicio, revision)`; usar última revisión confirmada. Ausencia/NULL significa desconocido, no cero. RRHH puede confirmar explícitamente que no hay antecedentes.

Campos económicos externos:

- `ingresos_gravados_previos`, `ingresos_exentos_previos`, `igss_laboral_previo`, `isr_retenido_previo`: DECIMAL, acumulados documentados del ejercicio anterior a la incorporación, exclusivamente ajenos a las planillas ya registradas aquí. Retención previa = saldo efectivo luego de devoluciones previas; no volver a sumar esas devoluciones.
- `inicio_fiscal DATE`: inicio relevante de rentas en el ejercicio, según constancias/declaración; no usarlo para prorratear arbitrariamente la deducción personal. `corte_antecedentes DATE`: último día cubierto; rechazar solapamiento con nuestras fuentes.
- `datos JSON`: contrato versionado descrito abajo. Incluye evidencia, ajustes anteriores explicativos y deducciones aportadas por el trabajador; no duplicar totales calculados del sistema.
- `creado_por/en`, `confirmado_por/en`: distinguir captura y verificación. Corregir agregando revisión, nunca sobrescribir una confirmada.

Contrato `datos.version = 1`:

- `constancias[]`: NIT patrono, número/identificador, rango de cobertura, `documentoId`; respaldo de los cuatro acumulados, sin una segunda copia de sus importes. Detectar documentos/rangos repetidos.
- `ingresosPreviosPorConcepto[]`: cada entrada incluye `id` estable, `codigoConcepto`/`tipoConcepto`, `monto`, `tratamientoDeclarado` (`GRAVADO`, `EXENTO`, `CONDICIONAL`, `DESCONOCIDO`), `fundamentoDocumentado`, `fechaPercepcion` o `periodoDesde/Hasta`, `patronoNit`, `constanciaId`, `documentoId` y `observacionesLimitesAnuales`. Cuando corresponda, estas observaciones deben respaldar salario ordinario/base del límite y desglose gravado/exento documentado de aguinaldo, Bono 14 u otro concepto limitado. Tratamiento declarado no equivale a aceptación fiscal: validar evidencia y regla vigente. Las referencias pertenecen a las constancias/documentos del mismo empleado y empresa.
- `ajustesPrevios[]`: tipo, fecha, referencia/documento y explicación; importes ya reflejados en los acumulados NO se aplican de nuevo. Si constancia no permite determinar el saldo real, no confirmar.
- `deducciones[]`: clave estable, tipo (`DONACION`, `SEGURO_VIDA`, `IVA_PLANILLA`, `PREVISION_SOCIAL_OTRA`), monto solicitado, fechas, documentos, estado de comprobación y motivo. No equivale automáticamente a deducción admitida; el motor guarda monto admisible y límite en snapshot. IGSS propio/previo no se captura otra vez aquí.
- `otrosPatronos`: declaración (`NO`, `SI`, `DESCONOCIDO`), calidad de agente retenedor y remuneraciones externas concurrentes documentadas, separadas de acumulados previos. No confundir multiempleo con cambio de patrono. No habilitar automatismo sin declaración suficiente.

`ingresos_gravados_previos` e `ingresos_exentos_previos` sirven para conciliación y consulta rápida. El detalle por concepto permanece dentro de `datos JSON`, sin nuevas columnas/tablas, y debe conciliar con esos totales sin sumarse otra vez como ingreso adicional. Detectar entradas duplicadas y coberturas solapadas. El motor fiscal NO puede reconstruir límites de exención anual únicamente con `ingresos_exentos_previos`: si falta el desglose/evidencia necesario para un concepto limitado, exigir completarlo antes del cálculo automático y la autorización fiscal.

RRHH captura solo estos antecedentes/evidencias y confirma cobertura. Sueldo, fechas laborales, horas y conceptos propios se toman de fuentes existentes.
Planillas faltantes de esta misma empresa no se disfrazan de patrono anterior: requerir importación fiscal explícita con cobertura excluyente, en PR aparte si se necesita.

## 3. Clasificación de conceptos: configuración, no renombrar prestaciones históricas

Reutilizar `configuracion` con claves `rrhh.fiscal.conceptos.<ejercicio>.r<revision>`. JSON inmutable, esquema estricto y hash canónico. Una revisión publicada no se edita; otra revisión la sucede con nueva vigencia. Sin tabla nueva de conceptos en esta fase.

Cada regla: `codigo`, `origen` (campo fijo/horas/prestación), `claveOrigen` exacta, `tratamientoISR` (`GRAVADO`, `EXENTO`, `CONDICIONAL`, `PENDIENTE`), `reglaExencion` y límite cuando proceda, `afectaIGSSLaboral`, `afectaIGSSPatronal`, `afectaIRTRA`, `afectaINTECAP` (true/false/null), `requiereComprobacion`, `vigenteDesde/Hasta`, `fuenteLegal`, autor/aprobador y `estado`. Evitar dos booleans ISR contradictorios.

Resolver por código/origen exacto, nunca por coincidencia aproximada de texto. Alias explícitos aprobados para variantes del legado; `Otro` exige clasificación individual. Para excepciones por registro usar configuración `rrhh.fiscal.asignaciones.<ejercicio>.r<revision>` que mapea `(tabla,id)` a regla y documentos; validar empresa/empleado/fecha en servidor. Su contenido completo también queda en snapshot. No cambiar `catalogos-nomina.ts` ni las categorías actuales.

Defaults propuestos (no publicados todavía):

| Concepto/origen real | ISR propuesto | Base social/patronal propuesta |
| --- | --- | --- |
| Sueldo ordinario (`sueldo_base`) | Gravado | Remuneración salarial; validar régimen/cobertura |
| Bono incentivo (`bono_incentivo`) | Gravado bajo régimen LAT, sujeto a revisión de criterio aplicable | Exclusión IGSS únicamente si cumple bonificación legal, no todo bono por su nombre |
| Horas extra (`horas_extra_registros`) | Gravado | Remuneración extraordinaria; validar bases de cada carga |
| Bono; bono día festivo/domingo trabajado | Gravado si remuneración laboral | Condicional según naturaleza real, no exclusión automática |
| Comisiones | Gravado; hoy sin campo propio, asignación explícita de prestación | Remuneración salarial, bases sujetas a revisión |
| Aguinaldo / `Bono14` | Exención limitada; excedente gravado | Revisar exclusión de cada carga por separado |
| Indemnización | Exento solo cuando sea indemnización por tiempo servido | Clasificar naturaleza real antes de excluir cargas |
| Viáticos | Condicional a liquidación/comprobación; no exención por etiqueta | No asumir remuneración ni base por etiqueta |
| Bono herramientas (`bono_herramientas`) | Pendiente de naturaleza: remuneración o reintegro documentado | Pendiente; no presumir exención |
| Otro / texto libre | Pendiente: bloquear cálculo fiscal automático de esa línea hasta clasificar | Pendiente |

Respaldo ISR: artículos 68/70 LAT: remuneraciones laborales gravadas; viáticos comprobados tienen condiciones; aguinaldo y Bono 14 tienen límite equivalente al salario ordinario mensual; indemnización por tiempo servido exenta. Los límites requieren identificar pagos del mismo concepto ya percibidos en el año, incluidos externos. No basta una bandera `exento`. [Texto oficial publicado del Decreto 10-2012](https://s3-sa-east-1.amazonaws.com/guatemala/eregulations/Media/10-2012.pdf).

Respaldo social: IGSS explica que la exclusión corresponde a bonificaciones legalmente justificadas; otras bonificaciones integran salario. No usar el derogado Acuerdo 1118 como norma vigente. [IGSS, Reglamento de recaudación / Acuerdo 1421](https://www.igssgt.org/noticias/2018/11/23/igss-este-es-el-nuevo-reglamento-sobre-recaudacion-de-contribuciones-al-regimen-de-seguridad-social/).

## 4. Parámetros por año y reglas de proyección

Reutilizar `configuracion`, clave `rrhh.fiscal.parametros.<ejercicio>.r<revision>`; estructura: `schemaVersion`, `ejercicio`, vigencias, `estado` borrador/publicado, fuentes/artículos, deducciones, tramos, reglas de proyección/liquidación, redondeo monetario, autor/aprobador y hash. Ningún fallback al ejercicio anterior si falta una configuración publicada.

- 2026: Q48,000 ordinarios; Q3,024 extraordinarios SOLO 2026. Tramos: hasta Q300,000, 5%; excedente, Q15,000 + 7% sobre exceso. Separar el ejercicio al que beneficia una norma de la fecha desde la que se modifica una proyección. No reescribir retenciones autorizadas enero-mayo; conciliar posteriormente. [LAT](https://s3-sa-east-1.amazonaws.com/guatemala/eregulations/Media/10-2012.pdf), [Congreso, reforma 13-2026](https://www.congreso.gob.gt/noticias_congreso/15892/2026/), [Congreso, transitoria y aplicación a proyección](https://www.congreso.gob.gt/noticias_congreso/16364/2026/).
- Deducciones documentadas: previsión social, donaciones y seguro de vida; IVA de gastos personales hasta Q12,000 bajo acreditación/planilla. Diferenciar PROYECCION de LIQUIDACION y evidencia admitida; no aplicar automáticamente todos estos beneficios en cada mes ni restar IVA directamente del impuesto. No convertir préstamos, anticipos o descuentos de nómina en deducción fiscal. [SAT, obligaciones del patrono](https://portal.sat.gob.gt/portal/descarga/1817/orientacion-legal-y-derechos-de-contribuyentes/11575/obligaciones-tributarias-de-los-patronos-como-agentes-de-retencion-del-impuesto-sobre-la-renta-generado-por-rentas-del-trabajo-en-relacion-de-dependencia.pdf), [SAT, reglamento 213-2013](https://portal.sat.gob.gt/portal/descarga/1899/legislacion-tributaria/18250/acuerdo-gubernativo-numero-213-2013-reglamento-del-libro-i-de-la-ley-de-actualizacion-tributaria-decreto-numero-10-2012-del-congreso-de-la-republica-de-guatemala-que-establece-el-impuesto-sobre-la-r.pdf).
- 2027: revisión independiente vigente desde 01-01-2027 para la reforma estructural. Preparar regla paramétrica y variables del salario mínimo/bonificación conforme texto promulgado y criterio SAT; no publicar monto numérico todavía, no copiar Q48,000 del placeholder ni arrastrar Q3,024. Confirmar texto íntegro y ámbito/circunscripción aplicable antes de habilitar 2027.

Diseño del motor posterior: acumulados propios efectivos + antecedentes externos verificados + proyección restante; clasificar ingreso/exención y deducciones, calcular impuesto anual, descontar retención efectiva neta y distribuir saldo pendiente conforme reglamento. Quincenas reparten una obligación mensual, no hacen dos cálculos anuales independientes. Variables ya percibidas entran una vez; su proyección futura exige hipótesis explícita respaldada, nunca multiplicar una hora extra puntual por doce.

Fuentes propias: planes autorizados válidos como compromisos y fuentes de identidad; para retención EFECTIVA usar evento de percepción/pago acreditado, no mera autorización o `Generada`. `estado_pago` y `ref_pago` hoy no guardan por sí solos una fecha fiscal fiable: para nuevas líneas incorporar evento/fecha de puesta a disposición dentro del snapshot v2 al pagar; históricos sin fecha requieren revisión, no inferirla de `creado_en`. Separar en la proyección retenciones comprometidas pendientes de las efectivas para evitar duplicarlas. Confirmar política de percepción vs acreditación con contabilidad.

## 5. Configuración patronal por empresa

Clave `rrhh.fiscal.patronal.<ejercicio>.r<revision>` en `configuracion`: entradas por carga `IGSS`, `IRTRA`, `INTECAP`, y adicionales solo documentadas. Cada una tiene `aplica` (true/false/null), `tasa`, `reglaBase`, vigencia, régimen/cobertura, evidencia de aplicabilidad y fuente. NULL = pendiente, nunca exoneración tácita. No decidir condición legal por `tipo_contrato = outsourcing` solamente.

Tasas candidatas: laboral IGSS 4.83% y patronal IGSS 10.67% para régimen correspondiente ([IGSS](https://www.igssgt.org/noticias/2023/04/17/la-contribucion-del-patrono-al-igss-trae-beneficios-para-su-empresa/)); IRTRA 1% cuando afecto ([informe oficial IRTRA](https://irtra.org.gt/wp-content/uploads/2022/03/InformedeOperaciones2024.pdf)); INTECAP 1% cuando afecto, verificar exoneraciones ([Ley Orgánica INTECAP](https://www.intecap.edu.gt/informacionpublica/pdf/Ley%20Organica%20INTECAP.pdf), [reglamento de tasa patronal](https://www.intecap.edu.gt/legislacion/files/Reglam.recaudaci%C3%B3n%20tasa%20patronal%20%28Tasas%20y%20licencias%20varias%29.pdf)). No asumir misma base para las tres cargas.

Futuro snapshot guarda base/tasa/importe por carga y suma `totalCargasPatronales`. Para nuevas líneas `igss_patronal` representará exclusivamente IGSS real; IRTRA/INTECAP estarán en snapshot, no requieren columnas nuevas inicialmente. Líneas antiguas mantienen el valor agregado tal cual; marcarlo al leer como “cargas patronales históricas sin desglose”, nunca dividir retroactivamente 12.67%.

Neto permanece `ingresos - IGSS laboral - ISR - descuentos empleado`. Ninguna carga patronal se resta. UI/exportación futuras distinguirán IGSS patronal, IRTRA, INTECAP y total, y diferenciarán antiguo/no desglosado de nuevo/desglosado.

## 6. Snapshot, concurrencia e históricos

Ampliar el JSON existente, no añadir otra columna: lector dual de snapshot v1/v2; v1 sigue intacto y no obtiene autorización fiscal retroactiva. v2 conserva las claves de pendientes y añade `fiscal`:

- Versiones/hashes y copia de parámetros, clasificaciones/asignaciones y config patronal aplicadas; motor/regla de redondeo.
- Revisión de antecedentes y datos admitidos, documentos, límites de exenciones/deducciones, bases sociales, fecha/corte fiscal y evidencia de percepción.
- IDs de líneas/periodos/eventos propios incluidos, sus importes y condición comprometida/efectiva; rangos externos sin solapamiento.
- Ingresos clasificados por concepto, acumulados, proyección, deducciones, imponible/impuesto anual, retenciones efectivas/comprometidas, saldo, distribución, ISR de la línea y desglose patronal.
- Override ISR separado: automático, ajuste manual, resultado, motivo, responsable/fecha y auditoría. Un override no elimina el automático. No permitir después de autorización.

Generar/regenerar recalcula solo vistas previas; no actualiza acumulados externos ni consume conceptos. Autorizar bloquea empleado/ejercicio para serializar periodos del mismo trabajador; revalida TODAS las líneas (sueldo, bonos, fechas, pendientes, antecedentes, config vigente y fuentes anuales) antes de primera aplicación. Si hash/entrada cambió, exigir regenerar; nunca recalcular silenciosamente. Mantener orden de locks determinista para no cruzar pagos/configuración/autorizar y evitar deadlocks.

Tras autorización ninguna lectura, cambio de configuración o sueldo recompone ISR ni costos. Correcciones/reversiones son eventos explícitos auditados; no modificación automática de años anteriores. Pago posterior puede anexar fecha/evento fiscal sin alterar el resultado económico congelado.

## 7. Liquidaciones: segundo almacenamiento estrictamente necesario

Nueva `rrhh_fiscal_liquidaciones`: soporta fin de año/egreso y sus revisiones, snapshot fiscal definitivo, saldo por retener/devolver y ejecución idempotente. El ISR actual es no negativo y no hay entidad de devolución fiscal: representar una devolución como ISR negativo o descuento arbitrario debilitaría controles.

Clave lógica evento `(empresa, empleado, ejercicio, evento_clave)` + revisión. Campos `tipo` (ANUAL/EGRESO/RECTIFICACION), fechas, `estado` (BORRADOR/CONFIRMADA/EJECUTADA/ANULADA), `retener`, `devolver`, `snapshot`, aprobación y ejecución. `aplicacion_clave` única por empresa para impedir pagar/aplicar dos revisiones del mismo evento. Importes positivos mutuamente excluyentes. Solo una revisión confirmada activa por evento, validada bajo lock.

No registrar otra copia de cada ISR normal aquí. Una liquidación referencia retenciones originales, y solo su DIFERENCIA ejecutada participa una vez en el saldo fiscal. Devolución queda movimiento fiscal separado con pago/acreditación documentado, no recalcula netos aprobados. Rectificar una ejecutada requiere nuevo evento vinculado a la original, no editarla. Fecha fiscal del ajuste y ejercicio liquidado pueden diferir (por ejemplo devolución del año anterior en enero).

## 8. SQL de referencia y estado real de la BD

Solo estas dos tablas. Configuración y snapshot reutilizan estructuras existentes. No hay archivo de migración SQL en el repositorio ni ejecución de SQL por esta rama/PR. Según confirmación del responsable, las sentencias siguientes ya fueron ejecutadas manualmente en phpMyAdmin; esto no constituye verificación independiente de su esquema efectivo. Antes de cualquier PR de modelo, verificar en solo lectura existencia, columnas, tipos de IDs, índices/FKs, engine y compatibilidad JSON. No volver a crear, alterar ni borrar tablas sin autorización separada. `IF NOT EXISTS` no valida tablas preexistentes ni reemplaza una migración versionada. Sin seeds ni backfill; los importes manuales desconocidos deben conservar NULL hasta declaración confirmada.

```sql
-- REFERENCIA DOCUMENTAL. Ejecución manual en phpMyAdmin confirmada por el responsable.
-- Esta rama/PR no ejecutó SQL. Verificar existencia/esquema antes del PR de modelo.
CREATE TABLE IF NOT EXISTS rrhh_fiscal_empleado_ejercicio (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  id_empleado INT NOT NULL,
  ejercicio SMALLINT NOT NULL,
  revision INT NOT NULL,
  inicio_fiscal DATE NULL,
  corte_antecedentes DATE NULL,
  ingresos_gravados_previos DECIMAL(14,2) NULL,
  ingresos_exentos_previos DECIMAL(14,2) NULL,
  igss_laboral_previo DECIMAL(14,2) NULL,
  isr_retenido_previo DECIMAL(14,2) NULL,
  datos JSON NOT NULL,
  creado_por VARCHAR(100) NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  confirmado_por VARCHAR(100) NULL,
  confirmado_en DATETIME NULL,
  UNIQUE KEY uq_fiscal_emp_anio_rev (empresa_id, id_empleado, ejercicio, revision),
  FOREIGN KEY (empresa_id) REFERENCES empresas(id),
  FOREIGN KEY (id_empleado) REFERENCES empleados(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS rrhh_fiscal_liquidaciones (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  id_empleado INT NOT NULL,
  ejercicio SMALLINT NOT NULL,
  evento_clave VARCHAR(80) NOT NULL,
  revision INT NOT NULL,
  tipo VARCHAR(20) NOT NULL,
  fecha_corte DATE NOT NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'BORRADOR',
  retener DECIMAL(14,2) NOT NULL DEFAULT 0,
  devolver DECIMAL(14,2) NOT NULL DEFAULT 0,
  snapshot JSON NOT NULL,
  aplicacion_clave VARCHAR(100) NULL,
  fecha_fiscal_ejecucion DATE NULL,
  referencia_ejecucion VARCHAR(120) NULL,
  creado_por VARCHAR(100) NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  confirmado_por VARCHAR(100) NULL,
  confirmado_en DATETIME NULL,
  ejecutado_por VARCHAR(100) NULL,
  ejecutado_en DATETIME NULL,
  UNIQUE KEY uq_liquidacion_rev (empresa_id, id_empleado, ejercicio, evento_clave, revision),
  UNIQUE KEY uq_liquidacion_aplicacion (empresa_id, aplicacion_clave),
  FOREIGN KEY (empresa_id) REFERENCES empresas(id),
  FOREIGN KEY (id_empleado) REFERENCES empleados(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

Las FKs simples NO garantizan que empleado/documento sea del tenant: toda lectura/escritura requiere `empresa_id` y validación del empleado/documento del mismo tenant. Si se exige esa invariancia también en BD, proponer aparte índice único `(empresa_id,id)` de empleados y FK compuesta; no añadirlo sin comprobar esquema. JSON exige validación estricta en servidor; restricciones monetarias/estados también en aplicación hasta comprobar soporte CHECK. No borrado en cascada. Acceso restringido a RRHH autorizado, sin exposición de evidencias en catálogo general ni logs.

## 9. Decisiones pendientes antes del motor

1. Texto íntegro promulgado de 13-2026, fecha de vigencia/transición y criterio SAT de la fórmula 2027/circunscripción. Comunicados del Congreso confirman Q3,024, no sustituyen revisión legal final. SAT devolvió 403 al acceder a algunas publicaciones; extractos indexados no permiten cerrar todas las reglas.
2. Criterio fiscal vigente documentado del bono incentivo; naturaleza de herramientas, viáticos, “Otro” y bonos pactados; límites acumulados de aguinaldo/Bono14 cuando cambió salario o hubo otro patrono. No publicar excepciones sin aprobación contable/legal.
3. Empresas realmente afectas a IGSS/IRTRA/INTECAP, cobertura y bases; no deducir obligaciones del nombre de empresa o carnet del empleado.
4. Cobertura/completitud de históricos y constancias previas, casos de multiempleo/reingreso y reconocimiento fiscal de pago vs acreditación. Fecha administrativa del periodo no basta para todos los casos.
5. Evidencias admisibles, límites y momento de uso de donaciones/seguros/IVA, liquidación de egreso, política de correcciones y permisos de override. La distribución de retención debe validarse contra procedimiento SAT/reglamento, no una regla intuitiva de umbral mensual.

## 10. PRs pequeños propuestos

1. Modelo: verificar primero existencia/esquema de las dos tablas creadas manualmente; cualquier migración adicional requiere propuesta y autorización separadas. Schemas JSON/configuración versionada, captura/confirmación de antecedentes/evidencias, tenant/permisos/auditoría. Sin motor ni backfill.
2. Motor fiscal puro + parámetros 2026 aprobados; clasificación y proyección/liquidación, tests normativos/rounding/altas/variables/cambios/retenciones. 2027 permanece deshabilitado hasta validación separada.
3. Integración Planillas/snapshot v2: regeneración, overrides auditados, revalidación de todas las entradas y locks, congelamiento, pagos/fechas efectivas; conservar v1/históricos. Tests de idempotencia y concurrencia entre periodos.
4. Liquidaciones/devoluciones: confirmación/ejecución y rectificación separadas; no duplicación de retenciones, evidence/pagos/tenant.
5. Presentación: desglose empresarial sin descontarlo del neto y exportaciones compatibles. Tests de visualización de autorización, históricos y desglose fiscal/patronal.

Verificación de este ticket: solo documento y SQL de referencia incrustado, sin archivo de migración ni ejecución SQL por la rama/PR; no typecheck/tests de cálculo porque no cambia código. Revisar diff/espacios y ausencia de otros archivos modificados. Únicamente commit/push documental al PR de diseño; no PR de implementación ni merge en esta fase.
