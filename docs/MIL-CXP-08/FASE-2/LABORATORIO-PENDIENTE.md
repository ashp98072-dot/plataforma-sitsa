# Suite concurrente preparada: ejecución futura requiere autorización

Archivo: `src/lib/contabilidad/cxp/mil-cxp08-concurrencia.db.test.ts`. Cuatro casos ahora omitidos. **Este documento no autoriza su ejecución ni el arranque del laboratorio histórico.** No se ejecutó SQL para esta entrega.

## Contrato del laboratorio

El custodio debe acreditar una instancia ya disponible, una base nueva exclusiva del ensayo y fixtures sintéticos, con contratos M-3A/M-3B1 compatibles e InnoDB. La suite no crea base/tablas/usuarios ni ejecuta migraciones; si falta aprovisionamiento, detener y solicitar una fase separada.

No usar bases reales, copias con datos no anonimizados ni el esquema original de LAB-02. No iniciar servicios por la mera existencia de un puerto o de variables de entorno. Una marca de entorno no equivale a autorización humana.

La suite exige, antes de abrir socket:

| Variable específica de QA | Condición |
| --- | --- |
| `MIL_CXP08_AUTHORIZED_RUN` | Exactamente `YES_ISOLATED_QA`, sólo tras autorización documentada |
| `MIL_CXP08_LAB_ID` | Alias `qa-desechable-cxp08` o sufijo de QA válido |
| `MIL_CXP08_PORT` | Sólo 3399 o 3407; host fijo 127.0.0.1 |
| `MIL_CXP08_DATABASE` | `cxp_qa08_` seguido de 32 hex minúsculas; recurso exclusivo previamente aprovisionado |
| `MIL_CXP08_VERSION` | Versión exacta que autorizó el custodio; comparar con VERSION() |
| `MIL_CXP08_DATADIR_SHA256` | Hash autorizado del texto exacto UTF-8 de @@datadir, sin normalizar |
| `MIL_CXP08_OWNER_TOKEN` | Marca privada de al menos 32 caracteres, una sola fila en `qa_ownership.token` |
| `MIL_CXP08_DB_USER` / `MIL_CXP08_DB_PASSWORD` | Credenciales exclusivas QA proporcionadas por canal privado; nunca publicar ni versionar |
| `MIL_CXP08_COMPANY_ID`, `…ENTITY_ID`, `…PROVIDER_ID`, `…INVOICE_ID`, `…PAYMENT_ID` | IDs positivos de fixtures sintéticos del esquema exclusivo |

Tras abrir la conexión de control, consulta identidad/propiedad y motores antes de cualquier UPDATE. No adopta otra base ni busca/borra recursos por prefijo. La propiedad se compara sin mostrar el token.

## Fixture mínimo y escrituras previstas

- Un proveedor y factura registrados en la empresa/libro indicados; la factura debe aparecer en la primera página y permanecer visible al reversar el pago.
- Un pago REGISTRADO, sin datos de reversión, del mismo proveedor/libro/empresa, con **una aplicación exacta de 20.02** a la factura designada. No usar movimientos empresariales reales.
- Usuario creador existente y válido para la FK. El escritor usa ese mismo ID sólo como actor sintético del ensayo.
- Esquema de propiedad `qa_ownership` con una única fila token, e índices/relaciones previamente verificados por el custodio; ningún DDL en la suite.
- Acceso exclusivo: ningún operador o suite debe modificar ese fixture en paralelo.

El escritor cambia únicamente el pago designado de REGISTRADO a REVERSADO, con motivo identificable del ensayo, en una transacción confirmada. El lector ya habrá recuperado la página y estará pausado por barrera. Luego continúa con totales y líneas; una segunda ejecución observa el reverso.

En finally se revierte cualquier transacción de escritor aún abierta y se restaura **sólo ese fixture QA** a REGISTRADO, borrando los tres campos de reversión que inicialmente eran null. La restauración exige scope completo, estado REVERSADO y el motivo exacto escrito por la suite; si no afecta exactamente una fila, falla y requiere intervención del custodio. Esta restauración directa es instrumentación exclusiva del fixture, no una función contable ni un procedimiento para rehabilitar pagos reales. No genera auditoría de negocio y no certifica el servicio de reversión.

Un corte abrupto, desconexión o commit de resultado incierto puede dejar el fixture cambiado. El custodio debe conservar respaldo/snapshot del laboratorio y disponer de recuperación verificada; no hay limpieza automática de bases o tablas. No borrar evidencias o bases globalmente.

## Orden y oráculos

1. Lector con pool dedicado de una conexión y default de sesión READ COMMITTED; conexión de escritor/control distinta. Se comparan CONNECTION_ID.
2. El servicio real emite SET TRANSACTION RR y START READ ONLY antes de las consultas. La barrera se activa después del SELECT de página real, sin sleeps.
3. Escritor confirma el reverso sintético; sólo entonces se libera la barrera.
4. La primera respuesta mantiene pagado, totales y líneas previas; la segunda muestra disminución exacta de 20.02 en pagado, aumento correspondiente del saldo y líneas vigentes coherentes.
5. Se comprueba suma Decimal de líneas vigentes frente a cada fila del estado de cuenta, delta de agregados, dos liberaciones de lector y ausencia de advertencia espuria por mezcla de vistas.
6. Se restaura el fixture y se cierran ambos recursos. No se infiere el aislamiento de la transacción sólo del default de sesión: se verifica traza y comportamiento observable.

La suite usa un watchdog de 30 segundos para detectar bloqueos; no es el mecanismo de orden. Fallos de identidad o de contrato abortan; no se debe reintentar cambiando hashes/alias para evitar guardas.

## Comando reservado para el futuro

Sólo después de autorización y configuración privada de las variables indicadas:

```powershell
node node_modules/vitest/vitest.mjs run src/lib/contabilidad/cxp/mil-cxp08-concurrencia.db.test.ts --no-file-parallelism --reporter=verbose
```

No se ejecutó con la autorización habilitada. La comprobación actual sólo verificó **4 SKIP** sin socket/SQL. La suite compila y pasa lint, pero puede requerir ajustes al ensayarse por primera vez en un motor real; cualquier fallo se debe registrar sin atribuir éxito a lo omitido.
