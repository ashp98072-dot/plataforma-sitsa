# Procedimiento de instalación y verificación del sandbox de homologación

> **PROCEDIMIENTO — no se ejecuta en esta fase.** Prohibido usar producción o el MariaDB de Hostinger de producción. No hay credenciales reales en este repositorio. Este documento ordena los pasos que ya existen (`provision.mjs`, `readiness`, kill switch) y lo que falta por configurar. Detalle del aprovisionador: [`api26/RUNBOOK-APROVISIONAMIENTO.md`](../api26/RUNBOOK-APROVISIONAMIENTO.md); arquitectura: [`api25/ARQUITECTURA-SANDBOX.md`](../api25/ARQUITECTURA-SANDBOX.md).

## 0. Condiciones previas (hoy NO se cumplen)
D02 ratificada (verificador M2M) · adaptador KMS/HSM revisado · D06 y decisiones requeridas por `evaluateSandboxExposure` · aprobación humana (sin bloqueantes en ese perfil) · host dedicado · dominio y certificado.

## 1. Requisitos mínimos
| Componente | Requisito |
|---|---|
| Servidor | **Dedicado al sandbox**, distinto de producción (VPS o Cloud con Node.js 22, proxy inverso y systemd). El hosting compartido de producción **no** se reutiliza. |
| MariaDB | **11.8.x** (verificado en 11.8.9) en `127.0.0.1`/socket, **sin** acceso remoto; instancia propia; `max_connections` dimensionado a la carga (el laboratorio usa 400); copia de seguridad propia |
| Aplicación | Instancia separada de la de producción (otro directorio, otro usuario del SO, otras variables); build de la misma rama aprobada |
| Dominio | Subdominio propio del sandbox (no el de producción), DNS bajo control de Mónaco |
| TLS | Certificado válido (TLS ≥ 1.2) en el proxy inverso; HTTP→HTTPS; la app escucha solo en loopback |
| Conectividad | Solo 443 público; allowlist de IPs de PriceSmart en el proxy/cortafuegos; MariaDB no expuesto |
| Reloj | NTP activo (la evidencia M2M y la caducidad dependen del tiempo) |

## 2. Credenciales y secretos
- Se generan **en el servidor del sandbox** (`provision.mjs init-secrets`): `DB_PASSWORD`, `AUTH_SECRET`, `PORTAL_CREDENTIALS_KEY` e `isolation.json`. Archivo `0600`, **fuera del repositorio**, distintos de producción, con rotación documentada. Nunca por argumentos de línea de comandos.
- Tres cuentas de MariaDB de **mínimo privilegio**, reales y distintas: `app` (sin `DELETE`/DDL/`GRANT`; auditoría solo de inserción), `worker` (solo columnas de la cola) y `monitor` (solo consultas de vigilancia). Ninguna con privilegios globales. Verificado por P3–P6.
- Credenciales de PriceSmart: las emite Mónaco según D02, por canal seguro, con vigencia, alcances (`orders:create|read|cancel`) y clubes cerrados (`registerIntegrationStatement`); se revocan con `revokeStatement`. **No** se reutilizan las del laboratorio.
- Variables del aprovisionador: `PS_HOMOLOG_ADMIN_USER/PASSWORD`, `PS_HOMOLOG_APP_PASSWORD`, `PS_HOMOLOG_WORKER_PASSWORD`, `PS_HOMOLOG_MONITOR_PASSWORD`, `PS_HOMOLOG_PROVISION_ACK` (confirmación explícita). Solo en el entorno del operador, no persistidas.

## 3. Aislamiento
- Esquema propio `sandbox_api02_homolog_<n>` marcado con propiedad y procedencia (`novalvion_environment`: `environment=sandbox`, `sandbox_id`); la app rechaza arrancar con una base que no declare `sandbox`.
- Datos **sintéticos** (empresas, clubes, usuarios, mapeo TMS ficticios); ninguna empresa real.
- Aislamiento entre empresas: cada integración está ligada a una empresa y clubes; otra empresa recibe `404` (`DEMO.5`, `C4`, `R6`). Nada consulta sin `empresa_id`.
- El aprovisionador solo opera sobre `127.0.0.1`, exige el ACK y se niega ante indicios de producción.

## 4. Secuencia de instalación
1. `plan` (sin tocar nada) → revisar `bootstrap.sql`/`destroy.sql` (solo lectura).
2. `init-secrets`.
3. `apply --execute` → estado `APPLIED` (**no** es «listo»).
4. `finalize` → esquema de ejecución, migraciones del TMS dentro de alcance y privilegios finales → estado `COMPLETE` (`status` es de solo lectura y debe mostrar `COMPLETE`).
5. Registrar la integración de PriceSmart (datos sintéticos; credencial emitida por Mónaco).
6. Instalar unidad systemd y proxy revisados con `PRICESMART_RUNTIME_MODE=DISABLED`.
7. Verificación (§6) con el servicio aún **apagado**.
8. Aprobación humana → modo `READ_ONLY` (solo GET) → verificación → `ENABLED` solo con las decisiones requeridas ratificadas y el ACK explícito.

## 5. Controles de activación y apagado
| Control | Efecto |
|---|---|
| `PRICESMART_RUNTIME_MODE` = `DISABLED` / `READ_ONLY` / `ENABLED` | `DISABLED`: todo `503 DISABLED`; `READ_ONLY`: solo GET, POST → `503 READ_ONLY`; `ENABLED`: todo, con ACK y decisiones ratificadas |
| Archivo kill switch (`PS_HOMOLOG_KILLSWITCH_FILE`) | Solo el contenido exacto `ON` habilita; **ausente, vacío o cualquier otro valor ⇒ apagado** (falla cerrado), efecto inmediato sin reiniciar |
| Sonda `provisioning` | El runtime no se activa si el aprovisionamiento no está `COMPLETE` (R14) |
| Revocación | `revokeStatement`: efecto inmediato sobre esa credencial |
Apagado de emergencia: (1) escribir `OFF` en el archivo; (2) revocar la credencial; (3) revisar `ps_api01_audit` y `monitoring.json`.

## 6. Pruebas de seguridad y de salud (antes de abrir a PriceSmart)
- **Salud:** `GET /api/admin/pricesmart/readiness` (diagnóstico de solo lectura; solo rol Admin) y consultas de `monitoring.json` con la cuenta `monitor`.
- **Suites contra el sandbox:** `homologation.e2e.ts`, `pricesmart-flow.e2e.ts`, `sandbox-readiness.e2e.ts` y la colección Postman (flujo + errores).
- **Seguridad mínima que debe pasar:** sin evidencia → 401; firma alterada/credencial revocada/de otro entorno → 401; evidencia repetida → 409 `REPLAY_REJECTED`; sin permiso → 403; otra empresa → 404; cuerpo excesivo → 413; errores sin eco de datos; app sin privilegio para borrar/alterar. Todo esto ya está cubierto en laboratorio por `DEMO.9`, `F10–F12`, `R6`, P3–P6.
- **TLS:** verificar cadena, TLS ≥ 1.2, redirección HTTP→HTTPS y que el puerto de MariaDB no sea alcanzable desde fuera.
- Resultado en un acta de verificación (fecha, SHA desplegado, resultados); sin ella no se habilita `ENABLED`.

## 7. Reversión y limpieza
1. `OFF` en el kill switch y `PRICESMART_RUNTIME_MODE=DISABLED`.
2. Revocar todas las credenciales de PriceSmart.
3. `destroy` (ACK de destrucción): exige propiedad y procedencia (`DESTROY_REFUSED` ante cualquier duda, sin ningún `DROP`), elimina el esquema y las tres cuentas; **no** toca bases ajenas (P8, P9, P13–P15).
4. Eliminar unidad systemd, proxy, DNS, certificado y archivos de secretos.
5. Comprobar que producción no cambió (esquemas, cuentas, DNS, variables).
6. Fallo parcial del aprovisionamiento: `status` → si `BOOTSTRAP_PARTIAL`/`FINALIZE_FAILED`, recuperar con `destroy` + `apply` limpio (no hay reversión parcial del DDL).

## 8. Lo que debemos configurar nosotros (lista corta)
Servidor/VPS dedicado · MariaDB 11.8.x local · subdominio + TLS + proxy · allowlist de IPs · gestor de secretos y KMS/HSM · verificador M2M (D02) · `provision.mjs` plan/apply/finalize · unidad systemd · credenciales de PriceSmart · acta de verificación · aprobación humana.
