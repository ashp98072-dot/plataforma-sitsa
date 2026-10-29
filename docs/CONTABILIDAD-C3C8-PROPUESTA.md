# C3C-8 — Política y propuesta de regularización

## Alcance

Calendario contable incorpora **Simular propuesta de regularización**. Es una consulta
sin persistencia de política, propuesta, auditoría ni asiento. C3C-6 conserva su contrato
`estado=INCOMPLETA` y `propuestaCompleta=null`; C3C-8 agrega `propuestaSimulada`.
No hay aprobaciones, numeración de asientos ni operaciones para contabilizar.

## Política explícita de simulación

`C3C8-SIM-1`, estado `SIMULACION_PENDIENTE_APROBACION`, identifica empresa, libro,
ejercicio y cuenta de resultado validada por C3C-7. Incluye únicamente tipos exactos
Ingreso y Gasto y movimientos Registrados del ejercicio. No incluye historia anterior.
Es un contrato informativo en memoria, no una política contable formalmente aprobada.
Los parámetros de la petición no pueden aprobarla ni elegir una contrapartida arbitraria.

Por cuenta nominal se obtiene `s = Debe − Haber` del ejercicio y se propone la inversa:
si `s > 0`, Haber `s`; si `s < 0`, Debe `−s`. Ingresos netos = Haber − Debe de ingresos;
gastos netos = Debe − Haber de gastos; resultado preliminar = ingresos − gastos.
El neto Debe − Haber de las inversas debe coincidir con ese resultado. La contrapartida
es Haber para utilidad y Debe para pérdida, exclusivamente en la cuenta configurada.
Se totaliza y verifica Debe = Haber con BigInt en centavos, sin punto flotante.
Resultado cero no agrega contrapartida; cuentas con neto cero no generan líneas.
Sin saldos se devuelve una lista vacía con advertencia, no un asiento de importe cero.

## Condiciones y decisiones pendientes

Bloquean la propuesta los bloqueantes de C3C-5/C3C-6: calendario inválido, períodos
no cerrados, control no activo/disponible, descuadres, integridad, clasificación desconocida,
nominales inactivas con saldo y cuenta de resultado ausente o inválida. Una inconsistencia
entre inversas y resultado también la bloquea. No se corrigen datos históricos.

Se advierten saldos contrarios y saldos anteriores separados. Movimientos del ejercicio
en la cuenta de resultado son **indicios**, incluso si su neto es cero. El modelo no
identifica inequívocamente una regularización previa: siempre se informa esa limitación.
Su ausencia nunca se certifica y los indicios no se interpretan como prueba.

Quedan pendientes aprobación de política formal, idoneidad/imputabilidad formal de la
cuenta de resultado y mecanismo para identificar regularizaciones previas. Capital activo
del mismo libro solo demuestra elegibilidad técnica C3C-7. El cuadre y la validez técnica
se muestran separados de aprobación y contabilización; `listaParaContabilizar=false`
siempre, incluso sin bloqueantes técnicos. No se definen reglas fiscales ni aprobadores.

## API y consistencia

`GET /api/empresas/[slug]/contabilidad/ejercicios/[id]/propuesta-regularizacion?entidad=ID`
reutiliza `requireTenantCalendario(slug, 'ver')`, empresa de sesión, validación estricta
de identificadores y respuestas `private, no-store`. No exporta métodos de escritura.
La propuesta usa el resultado de una sola transacción READ ONLY / REPEATABLE READ
de C3C-6 que incluye diagnóstico, catálogo, movimientos y configuración C3C-7.
El cálculo posterior es puro sobre esa instantánea; no consulta una segunda conexión.
No se conceden permisos ni se cambian configuraciones. No hay SQL nuevo.

## Comprobaciones

- Unitarias focalizadas de C3C-6/C3C-7/C3C-8: utilidad, pérdida, cero, signos contrarios,
  centavos, historia excluida, cuenta ausente/inválida, clasificación, inactivas y bloqueos.
- HTTP y renderizado: autorización, ámbito de sesión, IDs, no caché, ausencia de acciones
  de escritura y avisos visibles. No equivalen a aprobación visual manual.
- Integración: `node scripts/ci/c3c8/run-windows.mjs --run-isolated --engine=mariadb`.
  MariaDB 11.8.9 verificada, nueva base sintética por ejecución, named pipe privado,
  TCP deshabilitado y cierre del proceso propio al terminar. Reutiliza fixtures y
  migraciones existentes solo en esa base nueva, incluida C3C-7. Prueba instantánea
  concurrente, separación de ejercicios/ámbitos, bloqueos y comparación de tablas para
  demostrar ausencia de escrituras/auditoría persistida durante la simulación.
