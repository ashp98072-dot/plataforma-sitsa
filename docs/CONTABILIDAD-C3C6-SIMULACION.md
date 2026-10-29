# C3C-6: simulación de regularización

Base: main `db35115ad6f8a7f47ab70e2195f126b1c6ade6a6`.

En Calendario contable, seleccionar libro y ejercicio y pulsar **Simular regularización (solo lectura)**. El resultado incorpora el diagnóstico C3C-5 de la misma instantánea, sin invocar operaciones de activación ni persistir evidencia.

API: `GET /api/empresas/[slug]/contabilidad/ejercicios/[id]/simulacion-regularizacion?entidad=ID`. Permiso existente de consulta del calendario. Validación empresa/libro/ejercicio y `private, no-store`. No acepta parámetros para elegir o inferir una cuenta de resultados.

## Cálculo y límites

- Solo asientos `Registrado` con fechas inclusivas del ejercicio. Ingresos netos = Haber − Debe de cuentas de tipo exacto `Ingreso`; gastos netos = Debe − Haber de tipo `Gasto`; resultado preliminar = ingresos netos − gastos netos. Conserva saldos contrarios y centavos con DECIMAL/BigInt.
- Los tipos válidos existentes son Activo, Pasivo, Capital, Ingreso y Gasto (`registros.ts`). No se clasifican cuentas por código, prefijo, nombre o rol comercial. Los tipos desconocidos bloquean la clasificación completa; el resumen queda marcado como parcial.
- Muestra cuentas nominales sin movimientos y cuentas históricas inactivas. Las inactivas con saldo requieren revisión y son bloqueantes.
- Las sumas anteriores al ejercicio se muestran separadas. Nunca alimentan el resultado ni las inversas indicativas. La inversa neutraliza únicamente el saldo propio del ejercicio, no el saldo histórico acumulado C3C-4.
- Se heredan bloqueantes de C3C-5: períodos pendientes, control inactivo/no disponible, descuadres individuales e integridad. Los descuadres o integridad pendiente hacen que `resultadoConfiable=false`; las inversas siguen siendo cálculos indicativos, no una propuesta validada.
- Una única transacción REPEATABLE READ / READ ONLY contiene diagnóstico y agregados. C3C-5 expone su consulta sobre la conexión del llamador; su API anterior conserva su propia transacción. No hay escrituras, auditoría persistida ni locks de escritura en la funcionalidad.

## Decisiones indispensables pendientes

El catálogo identifica ingresos y gastos, pero **no define la cuenta de resultado del ejercicio**: `ROLES_CONTABLES` y la restricción vigente de `cont_cuentas_rol` no incluyen ese rol. Una cuenta `Capital` no identifica inequívocamente dicho destino. No se reutilizan roles de ventas como contrapartida.

Debe aprobarse: identificación/configuración del destino por empresa/libro y sus validaciones; política y alcance de regularización; tratamiento de ajustes y saldos contrarios; cómo reconocer regularizaciones formales ya existentes para evitar duplicaciones; tratamiento autorizado de saldos históricos. No se presume ninguna aprobación.

Por ello, en el esquema actual **toda simulación es INCOMPLETA**: `cuentaResultado=null` y `propuestaCompleta=null`, con bloqueantes explícitos de configuración/política. Se muestran únicamente las inversas por cuenta nominal, sin fabricar una línea de contrapartida. Tampoco el resultado cero autoriza a presentar un asiento formal. No existen botones de guardar, aprobar o contabilizar.

## Verificación

Pruebas unitarias de utilidad/pérdida, signos contrarios, precisión, clasificación, cuentas inactivas/vacías y separación histórica; contrato HTTP, permisos y render. Integración MariaDB temporal con datos sintéticos: ejercicios/libros/empresas separados, límites de fechas, borradores, clasificación incompleta, ausencia de cuenta destino, descuadres, ausencia de escrituras/auditoría y consistencia ante cambio concurrente del catálogo.

Ejecutor: `node scripts/ci/c3c6/run-windows.mjs --run-isolated --engine=mariadb`. Reutiliza utilidades y fixture sin modificarlos; requiere distribución verificada en `.lab-runtime`. Los enlaces locales a dependencias y binarios quedan fuera del commit. No se requiere SQL nuevo de aplicación ni dependencias nuevas. No hay validación visual en navegador.
