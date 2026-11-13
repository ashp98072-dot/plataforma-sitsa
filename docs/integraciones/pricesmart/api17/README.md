# PriceSmart API-17 — atestación de conformidad

**Estado: IMPLEMENTADO y VERIFICADO TÉCNICAMENTE (pruebas unitarias, tsc, ESLint). No probado contra base de datos (no la usa) y NO aprobado para producción.** Nada en la aplicación la invoca; PriceSmart sigue en 503 `DISABLED`; el diagnóstico de API-15 no cambia (`ready=false`, ningún puerto `OK`).

`conformance-attestation.ts`: `issueAttestation`, `verifyAttestation` (sin efectos; admite `requireConformant:false` solo para inspección), `redeemAttestation` (canje estricto), `portFingerprint`, `createInProcessIdentityAuthority` (referencia para pruebas/laboratorio), `createMemoryNonceStore`.

## Dos planos de identidad (no confundirlos)
- **Código** — `portFingerprint`: huella de los métodos cargados. **Solo identifica código**: dos instancias con el mismo código (p. ej. cifrado con distinta clave) comparten huella.
- **Recurso / instancia** — aportada por una **autoridad de identidad confiable**, ajena a la composición evaluada: por puerto y con un desafío fresco en cada operación, firma `resourceId` + `subject` + huella de código del **objeto** presentado, ligado al destino. El emisor/verificador valida esa firma con material de verificación que él mismo posee (`TrustedAuthorities`); una autoridad desconocida, una clave distinta, una afirmación grabada o un objeto no inscrito se rechazan (`IDENTITY_MISMATCH`, o no se emite). La verificación vuelve a preguntar a la autoridad por los objetos presentados hoy.
- Las claims solo llevan `authorityId`, `resourceId` (opaco, validado por formato: se rechazan cadenas de conexión, `@`, `=`, espacios…) y `subject`. Nunca claves, contraseñas ni cadenas de conexión.

## Límites declarados
- El `subject` (`LIVE` / `ISOLATED_COPY`) **lo afirma la autoridad**; este módulo **no comprueba** que una copia esté realmente aislada ni que un `resourceId` corresponda al recurso físico. Confía en la afirmación firmada y la registra.
- La autoridad de referencia es en proceso (inscripción por referencia de objeto). En producción debe ser un componente confiable externo, inscrito por el arranque confiable; clave maestra y almacén durable de nonces siguen pendientes (decisiones/infra).

## Garantías (se conservan de la primera versión)
HMAC con clave derivada por destino (`LAB` ≠ `PRODUCTION`); TTL máximo 15 min; nonce de un solo uso; en `PRODUCTION`, contador y replay (que escriben/consumen) no se ejecutan salvo que la autoridad declare `ISOLATED_COPY`; no toca readiness, handlers ni runtime; no ratifica D02/D06/D08/D09/D12.

## Canje estricto
`redeemAttestation` no tiene opción `requireConformant`: siempre exige atestación auténtica, vigente, con identidad vigente, **completa y conforme**; cualquier valor recibido se ignora y el nonce no se consume si falla.
