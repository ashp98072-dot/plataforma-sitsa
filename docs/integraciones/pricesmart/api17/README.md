# PriceSmart API-17 — atestación de conformidad

**Estado: IMPLEMENTADO y VERIFICADO TÉCNICAMENTE (pruebas unitarias, tsc, ESLint). No probado contra base de datos (no la usa) y NO aprobado para producción.** Nada en la aplicación la invoca; PriceSmart sigue en 503 `DISABLED`; el diagnóstico de API-15 no cambia (`ready=false`, ningún puerto `OK`).

`conformance-attestation.ts`: `issueAttestation` (ejecuta `runPortConformance` y firma el resultado), `verifyAttestation` (sin efectos), `redeemAttestation` (verifica y consume el nonce), `portFingerprint`, `createMemoryNonceStore` (solo pruebas/laboratorio).

- **Vínculo con lo evaluado:** cada puerto se firma con `implementationId`, `version`, `subject` y una huella SHA-256 del código real (nombre y fuente de sus métodos). `compositionId` cubre destino + todos los puertos. Cambiar instancia, versión, identidad, método, ranura o sujeto → `COMPOSITION_MISMATCH`.
- **Vigencia y reuso:** TTL máximo 15 min (también al verificar), nonce de un solo uso en `redeem`, tolerancia de desfase 5 s.
- **Laboratorio vs producción:** el destino va firmado y la clave se deriva por destino (HMAC); una atestación `LAB` da `WRONG_TARGET` como `PRODUCTION` y viceversa.
- **Sin escritura sobre recursos vivos:** en `PRODUCTION`, contador y replay (que consumen/escriben) solo se ejecutan si se declaran `ISOLATED_COPY`; si son `LIVE` no se ejecutan, quedan en `skipped` y la atestación es incompleta (no verifica por defecto). Que `ISOLATED_COPY` sea verdad es responsabilidad de la composición; este módulo solo lo registra y firma.
- **No concede nada:** no toca readiness, handlers ni runtime. No define ni ratifica D02/D06/D08/D09/D12.

Límites: la clave maestra de firma y el almacén durable de nonces los debe aportar la composición administrativa (decisión/infra pendiente).
