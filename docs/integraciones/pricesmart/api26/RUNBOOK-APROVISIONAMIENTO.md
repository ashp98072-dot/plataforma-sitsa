# Runbook de aprovisionamiento del sandbox de homologación (PROCEDIMIENTO — NO se ejecuta en esta fase)

**No ejecutar contra producción ni contra Hostinger.** El ejecutor rechaza cualquier host que no sea 127.0.0.1/::1, exige confirmación explícita y falla si hay indicios de producción o variables del laboratorio. Todo se ejecuta **en el host dedicado del sandbox**, por una persona autorizada, cuando existan los prerrequisitos.

## Prerrequisitos (hoy NO se cumplen)
Verificador acordado (D02) y adaptador KMS revisado · contrato de orden (D06) · host dedicado con MariaDB en 127.0.0.1, Node, proxy inverso y TLS · dominio y certificado · allowlist de IPs de PriceSmart · gestor de secretos · usuario del sistema sin privilegios.

## Pasos
1. **Plan (sin tocar nada):** `node scripts/ci/pricesmart-homologation/provision.mjs plan --n <nombre> --out <dir vacío> --hostname <dns> --cert <ruta> --key <ruta> --allow <cidr,cidr>` → genera `bootstrap.sql`, `destroy.sql`, `nginx-pricesmart-sandbox.conf`, `pricesmart-sandbox.service`, `runtime.env.template`, `monitoring.json`. **Revisar** el SQL y el perfil (`evaluateSandboxExposure`, sin bloqueantes).
2. **Secretos internos:** `init-secrets --n <nombre> --root <dir> --out-env <archivo 0600 fuera del repo>` (genera DB_PASSWORD/AUTH_SECRET/PORTAL_CREDENTIALS_KEY y `isolation.json`; no imprime valores). Las contraseñas de worker y monitor las genera el operador.
3. **Aplicar:** variables `PS_HOMOLOG_ADMIN_USER/PASSWORD`, `PS_HOMOLOG_APP_PASSWORD` (= DB_PASSWORD), `PS_HOMOLOG_WORKER_PASSWORD`, `PS_HOMOLOG_MONITOR_PASSWORD`, `PS_HOMOLOG_PROVISION_ACK=CONFIRMO-APROVISIONAR-SANDBOX-HOMOLOGACION-AISLADO`; `apply --n <nombre> --db-port <p>` (resumen) y luego `--execute`. Falla si la base ya existe.
4. **Esquema de ejecución y privilegios finales:** `finalize --n <nombre> --root <dir> --secrets-env <archivo> --db-port <p>` (privilegios temporales siempre revocados).
5. **Credenciales de PriceSmart:** emitidas por Mónaco según D02 y registradas con `registerIntegrationStatement` (vigencia acotada, alcances y clubes cerrados); se revocan con `revokeStatement` (efecto inmediato, sin reinicio). **No generar credenciales antes de D02.**
6. **Servicios:** instalar la unidad systemd y el proxy (revisados), `PRICESMART_RUNTIME_MODE=DISABLED` hasta ratificar decisiones; encender solo con decisiones ratificadas, ACK y `killswitch` en `ON`.
7. **Verificar:** `/api/admin/pricesmart/readiness`, consultas de `monitoring.json` con la cuenta `monitor`, suites de homologación contra el sandbox.
8. **Apagar/destruir:** escribir `OFF` en el archivo `killswitch` (efecto inmediato); baja completa con `destroy` (ACK de destrucción), eliminar unidad, proxy, DNS y secretos, y comprobar que producción no cambió.

## Revocación de emergencia
1. `OFF` en el archivo del interruptor (todas las rutas → 503 DISABLED al instante). 2. Revocar la credencial (`revokeStatement`). 3. Revisar la auditoría de acceso (`ps_api01_audit`) y `monitoring.json`.
