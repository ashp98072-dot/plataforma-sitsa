# Contabilidad → Cuentas por cobrar (pantalla propia)

Estado: **IMPLEMENTADO y VERIFICADO TÉCNICAMENTE** (tests unitarios + MariaDB 11.8.9 desechable local). No probado con datos reales ni aprobado para producción. **Sin migración ni cambio de esquema.**

## Decisión de arquitectura
La CxC oficial de la plataforma es la de Facturación (`fact_facturas` + `fact_pagos`, lógica de `lib/facturacion/cuentas-por-cobrar.ts` y `registrarPago` de `lib/facturacion/facturas.ts`). La nueva pantalla **reutiliza ese servicio**; no agrega reglas contables. `cont_cxc` queda como **registro manual legado**: no se borra, no se migra, no se mezcla con los saldos reales.

## Discovery (respuestas)
| # | Pregunta | Hallazgo |
|---|---|---|
| 1 | Estados de `fact_facturas` en CxC | Solo `Emitida` y `Anulada` (`ESTADOS_ADMIN_CXC`). El `Borrador` no es un documento por cobrar |
| 2 | Cobrado y saldo | `cobrado = Σ fact_pagos.monto` por factura; `saldo = monto_total − cobrado` (informativo; no resta retención de IVA esperada ni confirmaciones bancarias). Anulada: saldo `null` |
| 3 | Endpoint que registra `fact_pagos` | `POST /facturacion/facturas/[id]/pagos` → `registrarPago` (permiso `facturacion:pagos`). La pantalla nueva usa **el mismo `registrarPago`** desde `POST /contabilidad/cxc/cobros` con su propio permiso |
| 4 | Sobrepago | `registrarPago` bloquea la factura `FOR UPDATE`, suma los pagos y rechaza `monto > saldo` (409). Solo contra factura `Emitida` |
| 5 | Entidad | `fact_facturas.entidad_id` (FACT-4). El servicio acepta un filtro de entidad opcional; **la pantalla lo fuerza al libro seleccionado** (obligatorio y único, validado activo y de la empresa). `fact_pagos` no tiene entidad: se acota por su factura |
| 6 | Anuladas | Aparecen solo en "Todas"/"Anuladas", con situación Anulada y sin saldo; no admiten cobros (409) |
| 7 | `cont_cxc` en fixtures/tests | Solo en pruebas de registros y de limpieza administrativa y como fixture de M-2a (con cifras distintas para probar que **no** influye). No hay suposición de que tenga datos reales |

## Qué existe de verdad y qué no (límites de esta pantalla)
* **Existe:** listado de documentos, cobros parciales, **múltiples cobros** por factura, bloqueo de sobrepago, auditoría (`registrar_pago`, módulo facturación), filtro por entidad.
* **No existe (no se inventó):** reversión/anulación de cobros, anticipos, retención de IVA real, vencimiento/antigüedad, configuración por cliente. Por eso la pantalla **no tiene** pestaña de configuración/clientes ni botón de reversión, y lo dice en pantalla.
* Las facturas históricas **sin entidad** (`entidad_id IS NULL`) no aparecen en ningún libro de esta pantalla (siguen en Facturación → CxC); no se asignan automáticamente.

## Pantalla
Contabilidad → **Cuentas por cobrar** (`/e/[slug]/contabilidad/cxc`), con el mismo patrón que CxP: selector de libro contable arriba y pestañas.
* **Documentos:** Fecha, Cliente, Documento, Total, Cobrado, Saldo, Situación (Sin cobros / Cobro parcial / Cobrada / Anulada); totales del filtro; búsqueda por cliente y documento, rango de fechas, situación; paginación; acción **Cobrar** (con permiso) sobre facturas emitidas con saldo ("Cobrar saldo" copia el saldo del servidor).
* **Cobros:** cobros reales (`fact_pagos`) de las facturas del libro, con filtros y total.
* **Registros manuales (legado):** solo lectura de `cont_cxc` del libro, con aviso de que no son facturas, no tienen cobros y no entran en los saldos. Ya no se crean desde la UI (la API legada sigue existiendo).

## API nueva
`GET /contabilidad/cxc/documentos?entidad=` · `GET /contabilidad/cxc/cobros?entidad=` · `POST /contabilidad/cxc/cobros?entidad=`. Empresa y usuario salen de la sesión; la entidad, de `?entidad=` (obligatoria y única). El `GET/POST /contabilidad/cxc` anterior (cont_cxc) **no se tocó**.

## Permisos (propios; ningún rol por defecto; Admin por catálogo)
Patrón idéntico al de CxP (`PERMISOS_CXP`): filas dentro de "Contabilidad".
* `cxc_cuentas` (ver) — catálogo `cxc_ver`: documentos y cobros.
* `cxc_cobros` (editar) — catálogo `cxc_cobrar` (requiere `cxc_ver`): registrar cobros.
Guard `requireTenantCxc`: exige el módulo Contabilidad de la empresa y el permiso explícito; **sin fallback** a `contabilidad:editar` ni a `facturacion:*`. Un usuario con CxC y **sin** Facturación puede consultar y cobrar CxC y sigue sin poder usar Facturación. Facturación conserva sus permisos y endpoints sin cambios.
**Impacto de despliegue:** como ningún rol los trae por defecto, hay que asignar `cxc_ver`/`cxc_cobrar` a quienes antes usaban el bloque de CxC de la pantalla general.

## Retiro del bloque antiguo
De la pantalla general de Contabilidad se retiraron: el formulario "Cliente CxC / Proveedor CxP / monto / CxC / CxP" y el listado de CxC (cubiertos por las pantallas dedicadas; CxC ya no se captura a mano). **Se conserva**, como "Registros manuales de CxP — legado, solo lectura", el listado de `cont_cxp`, porque la pantalla de CxP (cxp_facturas) no muestra esos registros y no debe perderse el acceso a esos datos. Nada se borra de `cont_cxc` ni `cont_cxp`; si existieran registros, siguen en BD y se consultan en la pestaña "Registros manuales (legado)".
**Pendiente para operación:** contar los registros de `cont_cxc` en cada base real (solo lectura: `SELECT empresa_id, entidad_id, COUNT(*), SUM(saldo) FROM cont_cxc GROUP BY 1,2`) y decidir con Contabilidad si se concilian contra facturas; esta PR no ejecutó ese conteo.

## Fuera de alcance
Reversión de cobros, anticipos, retención de IVA, fórmulas fiscales, pólizas/asientos automáticos, importación de Milenium, migración de `cont_cxc`, cambios de CxP.

## Pruebas
`src/lib/contabilidad/cxc/{cxc.db,cxc-http,cxc-ui}.test.ts` y `src/lib/tenant-cxc.test.ts` (`LIQ_TEST_DB_PORT=3399 npx vitest run src/lib/contabilidad/cxc --no-file-parallelism`).
