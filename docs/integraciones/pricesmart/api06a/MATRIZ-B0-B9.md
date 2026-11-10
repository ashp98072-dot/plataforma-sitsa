# Matriz B0–B9 — estado REAL (no se ejecutó el laboratorio)

Leyenda: **NO EJECUTADA** = escrita pero sin ejecutar (requiere el motor real). **PASS (estático)** = comprobado sin base de datos. Ningún B1–B8 está en PASS; no se infiere nada de las pruebas estáticas.

| Bloque | Qué verifica | Dónde | Estado actual | Criterio PASS futuro |
|---|---|---|---|---|
| **B0** Identidad y aislamiento | Motor/hash; PID/puerto/bind; solo loopback; entorno en lista blanca; inalcanzabilidad de MySQL80 / PostgreSQL / Hostinger | Ejecutor (`B0.1`–`B0.6`) + `lab` `B0.t1`–`B0.t3` | **Guardas: PASS (estático, 103 pruebas) · Preflight del motor: PASS (624 archivos, 0 diferencias, 0 procesos `mariadbd`) · Con el motor real: NO EJECUTADA** | Identidad y escucha coinciden; la guardia de red lanza ante 3306/5432/externos |
| **B1** DDL efectivo | InnoDB, 6 tablas, ≥ 11 CHECK en orders, UNIQUE de identidad, 4 FK, columnas binarias, CHECK aplicados por el motor | `lab` `B1.1`–`B1.4` | NO EJECUTADA | Coincide con `staging-lab.sql`; el motor rechaza estado inválido |
| **B2** Persistencia básica | Recibir/leer/cancelar, payload cifrado (no en claro), eventos/outbox/auditoría | `lab` `B2.1`–`B2.2` | NO EJECUTADA | Roundtrip exacto; `DURABLE`; filas hijas consistentes |
| **B3** Idempotencia | Replay (JSON reordenado), conflicto, cancelación repetida | `lab` `B3.1`–`B3.3` | NO EJECUTADA | Sin duplicados; códigos esperados |
| **B4** Concurrencia | 10 recepciones simultáneas, dos clubes en conflicto, timeout de bloqueo (`RETRYABLE`), interbloqueo inducido | `lab` `B4.1`–`B4.4` | NO EJECUTADA | Un ganador; errores del motor → `PersistenceError` correcto |
| **B5** Multiempresa | 4 alcances con el mismo id externo; lectura/cancelación cruzada = NOT_FOUND; alcance no registrado rechazado por FK | `lab` `B5.1`–`B5.3` | NO EJECUTADA | 0 fugas; sin filas parciales |
| **B6** Atomicidad | Fallo inyectado tras INSERT; evento duplicado; FK de auditoría | `lab` `B6.1`–`B6.3` | NO EJECUTADA | Rollback total visto desde otra conexión |
| **B7** Recuperación | Caída dura (PID verificado) con una orden confirmada y otra en vuelo; reinicio sobre el MISMO datadir; verificación | Ejecutor (fases `crash-prepare`/`crash-verify`) + `lab` `B7.1`–`B7.4` | NO EJECUTADA. **`B7.5` (caída DURANTE el COMMIT / `COMMIT_UNKNOWN` real) = SKIP declarado**: no es determinista con este arnés | Confirmada íntegra; en vuelo ausente sin huérfanas; servicio operativo |
| **B8** Privilegios efectivos | Denegaciones (DELETE, UPDATE de eventos/columnas protegidas/outbox, DDL, TRUNCATE, scopes, `mysql.*`, otras bases); `SHOW GRANTS` | `lab` `B8.1`–`B8.2` | NO EJECUTADA | Errno 1142/1143/1044 esperados; sin ALL/GRANT OPTION |
| **B9** Cierre | Apagado, puerto liberado, limpieza segura | Ejecutor (`B9.1`) + `safeRemoveRunDir` | **Limpieza: PASS (estático: 3 pruebas, incluida la negativa ante uniones) · Con el motor real: NO EJECUTADA** | 0 procesos y 0 directorios residuales |

El resumen (`report.mjs`) nunca convierte un bloque sin resultados en PASS: «NO EJECUTADA»; el global es `INCOMPLETO` mientras falte alguno; un SKIP real se conserva como SKIP.

## Qué ya se verificó (sin iniciar MariaDB)
- 103 pruebas estáticas PASS (guardas, DDL, informe). `tsc --noEmit`: 0 errores en los archivos nuevos (28 errores preexistentes ajenos, por el módulo `fake-indexeddb` ausente en el checkout principal). ESLint de la carpeta: 0 errores, 0 advertencias.
- `--preflight-only`: gate OK, 624 archivos del motor verificados, ningún proceso `mariadbd`, ningún archivo/proceso creado.
- `--run-isolated` sin la confirmación: rechazado.
