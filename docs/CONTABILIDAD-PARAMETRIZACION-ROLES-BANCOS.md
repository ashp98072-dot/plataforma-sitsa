# Parametrización contable por entidad — roles → cuentas y bancos (KT / Mónaco)

> **Fase de PROPUESTA.** No ejecuta SQL en producción, no genera pólizas, no toca FEL, facturas, pagos, retenciones ni `registrarAsiento`.
> **Archivos:** `sql/preflight-2026-10-contabilidad-parametrizacion-roles-bancos.sql` (solo lectura) y `sql/propuesta-2026-10-contabilidad-parametrizacion-roles-bancos.sql` (propuesto, **no ejecutado**).
> **Base:** `main` = `1a4b170a`; producción informada por el responsable: `cont_cuentas` con 10 cuentas homologadas en KT y 8 en MONACO (cuenta de prueba eliminada). `empresa_id = 1`, entidad 1 = KT, entidad 2 = MONACO.
> **Regla:** un motor común; las diferencias son **datos por entidad**. Nada de `if MONACO` / `if KT`. **Mismo código no significa misma fila:** todo se resuelve por `empresa_id + entidad_id + codigo`.

## 1. Estructura existente

Revisado en `main` (esquema, migraciones y código): **no existe** ninguna tabla reutilizable de `rol → cuenta por entidad`. Lo único relacionado:
- `cont_cuentas_bancarias` (FACT-4): resuelve **bancos** (cuenta contable + alias/referencia/moneda) por entidad.
- `poliza-venta.ts`: define roles solo como **constantes en código** (`CLIENTES`, `BANCOS`, `RETENCION_IVA`, `VENTAS_SERVICIOS`, `VENTAS_BIENES`, `IVA_POR_PAGAR`), sin cuentas. Los roles `ANTICIPOS`, `TRANSITO_BANCARIO` y `DEVOLUCIONES_VENTAS` aún no existen ahí (fase posterior).
- Solo hay propuestas comentadas en documentos previos. → **Se propone la tabla `cont_cuentas_rol`.**

## 2. Tabla propuesta `cont_cuentas_rol` (NO migrada)

| Campo | Tipo | Nota |
|---|---|---|
| `id` | INT PK | |
| `empresa_id`, `entidad_id` | INT NOT NULL | ámbito |
| `rol` | VARCHAR(40) NOT NULL | lista cerrada por `CHECK` |
| `cuenta_id` | INT NOT NULL | cuenta de **esa** empresa y entidad |
| `activa` | TINYINT(1) DEFAULT 1 | |
| `creado_en`, `actualizado_en` | DATETIME | |

Garantías **en la base de datos** (probadas, ver §6):

| Se debe impedir | Mecanismo | Resultado en la prueba |
|---|---|---|
| Cuenta de KT en MONACO (o al revés) | FK compuesta `(empresa_id, entidad_id, cuenta_id)` → `cont_cuentas(empresa_id, entidad_id, id)` | rechazada (1452), en ambos sentidos |
| Duplicar un rol en una entidad | `UNIQUE (empresa_id, entidad_id, rol)` | rechazada (1062) |
| Entidad inexistente / de otra empresa | FK compuesta `(empresa_id, entidad_id)` → `cont_entidades(empresa_id, id)` | — |
| Usar `VENTAS_BIENES` sin cuenta confirmada | `CHECK` de lista cerrada **sin** `VENTAS_BIENES`: habilitarlo exige un `ALTER` aprobado con código confirmado | rechazada (4025) |
| Rol inventado, o `BANCOS` como rol fijo | misma `CHECK` | rechazada (4025) |
| Borrar una cuenta usada por un rol | `ON DELETE RESTRICT` | rechazada (1451) |
| Cuenta **inactiva** en un rol | una FK no puede verificarlo: (a) la carga solo toma cuentas activas y revierte si no lo son, (b) el resolvedor siempre une `c.activa = 1`, (c) preflight §7, (d) trigger opcional comentado | la carga revierte (ROLLBACK, 0 roles) |

**Resolvedor futuro (patrón, no implementado):** `SELECT c.* FROM cont_cuentas_rol r JOIN cont_cuentas c ON c.id = r.cuenta_id WHERE r.empresa_id = ? AND r.entidad_id = ? AND r.rol = ? AND r.activa = 1 AND c.activa = 1`. Sin fila → **error explícito** (no cae a otra cuenta); en particular `VENTAS_BIENES` falla hasta configurarse.

## 3. Mapeo de roles (confirmado) — se resuelve por empresa + entidad + código

Mismo mapeo en ambas entidades, **filas distintas** de `cont_cuentas` (ids distintos):

| Rol | Código | Nombre | Tipo (aprobado) | KT (entidad 1) | MONACO (entidad 2) |
|---|---|---|---|---|---|
| `CLIENTES` | `11203001` | CLIENTES LOCALES | Activo | ✔ | ✔ |
| `IVA_POR_PAGAR` | `21401001` | IVA POR PAGAR | Pasivo | ✔ | ✔ |
| `VENTAS_SERVICIOS` | `41101003` | VENTAS DE SERVICIOS | Ingreso | ✔ | ✔ |
| `RETENCION_IVA` | `11302005` | RETENCIONES DE IVA | Activo | ✔ | ✔ |
| `ANTICIPOS` | `21302001` | ANTICIPO DE CLIENTES MONEDA LOCAL | Pasivo | ✔ | ✔ |
| `TRANSITO_BANCARIO` | `11101002` | TRASLADO EN TRANSITO | Activo | ✔ | ✔ |
| `DEVOLUCIONES_VENTAS` | `41501002` | DEV. SOBRE VENTAS VARIAS | Ingreso | ✔ | ✔ |
| `VENTAS_BIENES` | — | **PENDIENTE CONTABILIDAD** (rol confirmado; **sin código**) | — | ✗ | ✗ |
| `BANCOS` | — | **no es un rol fijo**: se resuelve por `cont_cuentas_bancarias` | — | — | — |

**Carga (propuesta §2):** 14 filas (7 + 7) con patrón *falla cerrado*: cada cuenta debe existir en esa entidad, estar **activa** y tener el **tipo esperado**; `INSERT` simple (un rol existente hace fallar); verificación exacta; `COMMIT` solo si insertó 14 y hay 0 diferencias, si no `ROLLBACK`.

## 4. Bancos

**No se asume qué bancos siguen operativos.** El preflight (§6) muestra bancos actuales, su cuenta contable, entidad y estado, candidatos sin banco, y detecta duplicados, colisiones de alias/banco, **referencias que parezcan números completos** y mezcla entre entidades.

| Entidad | Cuenta contable | Banco (Milenium) | Evidencia | Estado |
|---|---|---|---|---|
| KT | `11103002` | Banco Industrial | movimiento hasta 2026-05 | **detectado** — alta pendiente de alias y últimos 4 |
| KT | `11103001` | G&T Continental | movimiento hasta 2026-05 | **detectado** — idem |
| KT | `11103004` | Banco Industrial (fondo operativo) | movimiento hasta 2026-04 | **detectado** — idem |
| KT | `11103006` | G&T Continental | sin movimiento desde 2023-06; **no homologada** | **PENDIENTE**: confirmar si sigue activa (y homologar la cuenta primero) |
| MONACO | `11103002` | Banco Industrial | movimiento hasta 2026-05 | **detectado** — idem |

- **Duplicado de Milenium (Mónaco 0001/0002 → misma cuenta):** `UNIQUE(empresa, entidad, cuenta)` impide dos filas sobre la misma cuenta: queda **una**; un segundo alias no es posible sobre esa cuenta.
- Los `INSERT` de bancos están **comentados y bloqueados** (§3 de la propuesta) con marcadores `<ALIAS A CONFIRMAR>` y `***<ULTIMOS_4>`: **no se inventan alias ni números**, nunca el número completo.
- **Qué debe confirmar el responsable, por banco:** (a) si sigue operativo, (b) alias, (c) moneda, (d) últimos 4 dígitos.

## 5. Pendientes
1. **Código de `VENTAS_BIENES`** por entidad (hasta entonces: sin fila y rechazado por la `CHECK`).
2. **Bancos:** vigencia, alias, moneda y últimos 4; decisión sobre `11103006`, `11101001` (caja, sin uso desde 2023-06) y `11104003` (dólares).
3. **Integración posterior** (fuera de esta fase): que `poliza-venta.ts` consuma el resolvedor y añada los roles `ANTICIPOS`, `TRANSITO_BANCARIO`, `DEVOLUCIONES_VENTAS`; pólizas reales; gestión de roles desde la interfaz.
4. Endurecimientos opcionales comentados: `UNIQUE (empresa, entidad, banco, alias)` y trigger de cuenta activa (requiere privilegio `TRIGGER`).

## 6. Verificación (local, base desechable; no hay checks de GitHub)

Preflight y propuesta se ejecutaron **solo** en una MariaDB 10.4 desechable con el esquema del repositorio y la carga de 18 cuentas:
- **Preflight:** sin errores; 18 cuentas `OK`; «cont_cuentas_rol NO existe todavía»; 14 roles «SIN CONFIGURAR»; `VENTAS_BIENES` «PENDIENTE»; compuerta «APTO»; sin una sola sentencia de escritura.
- **Propuesta:** carga limpia → `COMMIT` (7 + 7 roles); segunda ejecución → error de duplicado y `ROLLBACK` (sin duplicar); con una cuenta inactiva → `ROLLBACK` y 0 roles.
- **Integridad por SQL directo:** FK compuesta rechaza cuenta de KT en MONACO y de MONACO en KT (acepta la de la misma entidad); `UNIQUE` rechaza duplicado; `CHECK` rechaza `VENTAS_BIENES` y roles inventados; `RESTRICT` rechaza borrar una cuenta en uso.
- **Bancos:** el preflight detectó banco+alias repetido, misma referencia en varias entidades y una referencia con número largo.

## 7. Qué NO hace esta fase
No migra ni ejecuta nada en producción; no carga bancos; no configura `VENTAS_BIENES`; no genera pólizas ni asientos; no modifica `registrarAsiento`, FEL, facturas, pagos ni retenciones; no toca `src/`.
