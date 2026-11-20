# CB2 Shell — guardar el vale sin vincular la unidad (placa ambigua o sin unidad en Flota)

**Qué resuelve.** Antes, un vale Shell cuya placa coincidía con dos fichas de Flota (o con ninguna) no se podía guardar sin elegir una unidad, justificarla o registrar una unidad externa. Ahora el consumo se guarda con la placa original del Excel, marcado `AMBIGUA` o `SIN_VINCULO`, sin crear vehículos y sin tocar Flota. Se vincula después, si se quiere, con la corrección auditada ya existente.

**Qué NO cambia:** una placa con una única unidad de Flota (o con una identidad externa registrada) sigue vinculándose; piloto, combustible, importes y duplicados se validan igual; el aislamiento por empresa se mantiene (el servidor vuelve a comprobar que la placa realmente sea ambigua o no tenga unidad); no se crean empleados, vehículos, gastos, inventario ni asientos.

## Compatibilidad con el despliegue (importante: Hostinger despliega cada merge)
El código se puede fusionar y desplegar **antes** de instalar la migración: sin ella la función está apagada y el comportamiento es el de hoy (la unidad ambigua sigue pendiente; la API rechaza con 503 un guardado sin vincular). La aplicación detecta la migración sola (columna `vinculo_unidad` + CHECK `ck_cb2c_vinculo` y `SIN_VINCULO` en `ck_cb2c_unidad_tipo`); una instalación a medias da 503 explícito. **No hay banderas nuevas.**

## Migración (1 ALTER, requiere el nivel 4 ya instalado)
Archivos (SHA-256 del contenido con saltos LF):
| Archivo | SHA-256 |
|---|---|
| `sql/preflight-2026-11-cb2-vinculo-unidad.sql` (solo lectura) | `87b0cc8f53e9d626a0c8d10bac6a24dfc518adb57d633cb6e1551712c8c0f8b3` |
| `sql/migrate-2026-11-cb2-vinculo-unidad.sql` | `50fa21daf4bc0d5a6c0776a13be2f0fa92e3a0e1a9ac6a918a0975e28064c312` |
| `sql/postcheck-2026-11-cb2-vinculo-unidad.sql` (solo lectura) | `da2e3a82ee1f6e97077deacf025abe4573aac7beac348c3a84cd37068ae3f844` |
| `sql/rollback-2026-11-cb2-vinculo-unidad.sql` | `8f33a35cbad7a61db4fd27318d7b2a8a31dc1a36af08ace91cde72c42c901be6` |

Contenido: `ADD COLUMN vinculo_unidad VARCHAR(20) NULL`, `ck_cb2c_unidad_tipo` ampliado con una rama más (las anteriores idénticas al nivel 4), y `ck_cb2c_vinculo`. No crea tablas ni toca filas ni FK; las filas existentes quedan con `vinculo_unidad` NULL y siguen cumpliendo el CHECK. Guarda de orden: si el nivel 4 no está, el ALTER entero falla sin cambiar nada. No es idempotente (repetirlo falla sin cambiar nada).

Procedimiento (lo ejecuta el operador, no la aplicación):
1. Pausar importaciones CB2 durante la ventana (el ALTER reconstruye `flota_cb2_consumos` como los niveles anteriores). Anotar `SELECT COUNT(*) FROM flota_cb2_consumos`.
2. Preflight → debe decir `APTO PARA APLICAR` (si dice `YA INSTALADO`, no aplicar; `DETENER Y AUDITAR`, parar).
3. Aplicar `migrate-…` completo, una sola vez.
4. Postcheck → `OK: VÍNCULO DE UNIDAD INSTALADO`, mismo conteo de filas.
5. Verificar con sesión: `GET …/flota/combustible/catalogos` debe incluir `"vinculoUnidad": true`.
Reversión: ver `rollback-…` (solo posible con 0 filas que usen `vinculo_unidad`; si las hay falla sin cambiar nada).

## Qué se probó (MariaDB 11.8.9 desechable)
`terceros.db.test.ts` 33/33, incluido el último caso: rechazo 503 sin migración; migración sin alterar filas existentes y no idempotente; preflight/postcheck; placa ambigua + empleado de baja y placa sin unidad + piloto reportado (sin crear vehículos, empleados ni unidades externas); el servidor rechaza marcar «sin vincular» una placa con unidad única, «ambigua» una que no lo es, y «sin unidad» una ambigua; aislamiento entre empresas; idempotencia por reimportación; CHECK que impide combinar «sin vincular» con una unidad; historial (filtros por placa, piloto, fecha, combustible y vínculo; la placa mostrada es la original); vinculación posterior con corrección auditada; reversión.
