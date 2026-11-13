# Shell: importación independiente de piloto y fondos

La regresión estaba en `src/components/flota/cb2/preview-model.ts`, `seleccionSegura()`: al habilitar la política de #613, `!piloto` invalidaba cualquier asignación y `p && unidades.has(value)` impedía LISTO. `seleccionPilotoIndependiente()` también lanzaba error sin identidad de catálogo. No era una exigencia de fondos del backend.

## Corrección

- Vehículo propio/compartido válido + combustible clasificado: LISTO sin empleado, piloto externo ni fondos. Usa el contrato histórico ya admitido, sin DDL adicional.
- Vincular un piloto sigue siendo opcional. Elegir «Conservar solo el nombre reportado» evita que una sugerencia posterior reemplace la decisión. IDs de catálogo inválidos, empresa ajena, acceso revocado o unidad incompatible siguen bloqueados.
- Las cuatro combinaciones de #613 y las asociaciones verificadas anteriores se conservan.
- Una unidad externa sin piloto de catálogo usa `REPORTADO_V1`, con ampliación CHECK propuesta. Sin esa ampliación, la interfaz explica el pendiente y el servidor responde 503; no se esquiva el CHECK instalado ni se cambia ningún flag.
- `vPower` se clasifica como `VPOWER_NO_DETERMINADO`; no se adivina diésel o gasolina. `20W50` conserva su texto y exige revisión. Fecha, vale, serie, factura, placa, nombre, producto, galones, precio y monto mantienen su evidencia original.
- Parser 3 captura SUCURSAL/OBSERVACIONES. Las importaciones antiguas reanudan con su versión 1/2. La clave y el payload canónicos no cambian al añadir sucursal: siguen protegidos los reintentos anteriores.
- La clave de Shell conserva el vale normalizado dentro de empresa/proveedor; no usa persona, fecha o monto como identidad. Vales distintos con iguales persona/placa/importe son consumos distintos. Mismo vale con datos contradictorios queda bloqueado para revisión, sin duplicarlo. Los archivos examinados no aportan una identificación alternativa que permita resolver automáticamente esa contradicción.

## Fondos después de importar

Detalles del consumo → Consultar fondos → seleccionar una línea → revisar diferencias → motivo y confirmación manual. Requiere el permiso `conciliar`, sin nuevo requisito de administrador. La lectura usa `ver`, bajo demanda y con límite de 50 resultados.

El vínculo se guarda aparte, con empresa/proveedor, revisión de asignación y fotografía de ambas fuentes. Admite diferencias de monto, fecha y persona; no altera consumos, facturas, solicitudes ni pagos. Una vinculación repetida idéntica es idempotente; otra solicitud no sobrescribe el vínculo. Una corrección posterior de asignación muestra REVISAR_ASIGNACION. El contraste de monto es individual, no el saldo total de una solicitud; USD se señala como moneda no comparable con los fondos expresados en quetzales.

## SQL propuesto, sin ejecutar en producción

1. `sql/preflight-2026-11-cb2-shell-opcional.sql`: revisar faltantes, motores, CHECK e instalación parcial. Además, contrastar tipos INT de las FK e índices con el esquema real antes de autorizar DDL.
2. `sql/migrate-2026-11-cb2-piloto-reportado.sql`: amplía el CHECK en un ALTER, conserva sus ramas anteriores y las FK; añade una guarda para no vincular empleados/pilotos al modo REPORTADO.
3. `sql/migrate-2026-11-cb2-fondos-vinculos.sql`: índice empresarial y tabla de vínculos. Dos DDL: pueden dejar índice creado si falla CREATE TABLE. No repetir a ciegas; inspeccionar y resolver la instalación parcial. No hay backfill.
4. `sql/postcheck-2026-11-cb2-shell-opcional.sql`: CHECK, InnoDB, tres FK, cero vínculos automáticos y comparación de triggers completos contra la captura previa.

La importación de unidades propias funciona aunque no estén instaladas las dos propuestas. La conciliación opcional muestra su requisito de esquema sin impedir registrar consumos. No se certifica compatibilidad del DDL con producción por haber pasado un fixture local.

## Evidencia

- Se leyeron localmente las versiones disponibles sin el sufijo `(1)` de los tres Excel indicados. Nunca se publican archivos, nombres, placas ni filas privadas.
- Septiembre: 344 candidatos; octubre: 325. El archivo de fondos tiene columnas FECHA/COLABORADOR/PUESTO/PLACA/CLIENTE/DESCRIPCIÓN/MONTO/PRECIO/GALONES, carece de vale y no se acepta como reporte de abastecimientos Shell.
- Comparación de la vista previa contra `origin/main`, sin empleados y con catálogo sintético de placas normalizadas: antes 0 LISTO; después septiembre 343 LISTO y 1 placa ambigua; octubre 324 LISTO y 1 producto 20W50 pendiente. No acredita disponibilidad ni acceso de las unidades productivas.
- MariaDB 11.8.9 desechable, PIPE aleatorio y sin TCP: importación HTTP sin empleado/fondo, precisión y originales; dos vales legítimos iguales; reimportación y concurrencia sin doble consumo; permisos/tenant; CHECK y ampliación; fondos con diferencias e idempotencia; cuatro combinaciones anteriores e históricos intactos.
- Comando reproducible del laboratorio Windows: `node scripts/ci/cb2-identidades/run-windows.mjs --run-isolated <motor-verificado> scripts/ci/pricesmart-api06a/engine-manifest.json`.

Validacion final: 510 pruebas de modulo correctas; 34 pruebas MariaDB correctas (incluye pre/postchecks y conservacion de triggers); ESLint dirigido correcto; `npm ci` y `npm run build` completos correctos. Los warnings del build proceden de middleware, tracing del sandbox y la estrategia de workers existente.

Rama independiente y PR Draft para auditoría antes de cualquier merge, SQL productivo o despliegue.
