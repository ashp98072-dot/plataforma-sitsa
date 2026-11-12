# PRICESMART-API-12 — primera integración funcional demostrable (laboratorio local)

**Estado: IMPLEMENTADO y PROBADO de principio a fin en un laboratorio local aislado (MariaDB 11.8.9 real y `next dev` reales, datos ficticios). NO aprobado para producción; el runtime productivo sigue cerrado (503 `DISABLED`).**
D02, D06, D08, D09 y D12 de PriceSmart siguen PENDIENTES: nada de lo siguiente las ratifica.

## Circuito demostrado
`POST` (Postman) → rutas Next de API-11 → transporte/M2M/repositorio MariaDB (API-01…11, **reutilizados**) → orden cifrada + evento + outbox + auditoría → **solicitud real del TMS** (`tms_solicitudes_cliente` en `SOLICITADA`, creada con `crearSolicitudCliente`, la misma función del Portal del Cliente) → visible en la bandeja existente **Operaciones › TMS › Solicitudes de clientes** → `GET` devuelve el estado real.

| Pieza | Dónde |
|---|---|
| Contrato de PRUEBA `lab-demo-1` (referencia, club, destinatario, dirección, fecha de entrega), separado del borrador `api01-draft-1` | `src/lib/integrations/pricesmart/lab-demo/contract.ts` |
| Puntos de extensión OPCIONALES (contrato alternativo, campos extra de lectura, acción post-commit); sin ellos el comportamiento es idéntico | `contracts.ts`, `service.ts`, `mariadb-repository.ts`, `http-transport.ts` |
| Vinculación TMS, estado real y trazado de cancelación | `lab-demo/tms-link.ts` (+ `staging-tms-link.sql.in`: mapeo y vínculos) |
| Composición de laboratorio con autenticación de PRUEBA (HMAC, clave por ejecución en `%TEMP%`) | `lab-demo/composition.ts`, `autoinstall.ts`, `lab-crypto.ts` |
| Arnés, prueba E2E y colección Postman ejecutable | `scripts/ci/pricesmart-demo/`, `postman_collection.json` |

```
node scripts/ci/pricesmart-demo/demo.mjs up        # MariaDB efímero + esquema + datos ficticios + app (imprime la ruta del entorno de Postman)
node scripts/ci/pricesmart-demo/demo.mjs e2e       # 10 casos de principio a fin
node scripts/ci/pricesmart-demo/demo.mjs postman   # colección Postman (7 solicitudes, 10 aserciones)
node scripts/ci/pricesmart-demo/demo.mjs down
```

## Reglas de seguridad aplicadas
- La composición se instala SOLO si `NODE_ENV≠production`, `NOVALVION_ENV=sandbox`, la bandera `PRICESMART_LAB_DEMO`, base loopback con patrón `sandbox_api02_*` y una clave de laboratorio ≥ 32 caracteres **por entorno** (nunca en el repositorio). Probado en `lab-demo.test.ts`.
- El destino de la solicitud TMS (empresa/cliente/usuario) sale de la tabla administrativa `ps_api12_tms_mapping`, ligada al alcance autenticado; el cuerpo no puede elegirlo. El usuario de servicio está inactivo para el portal.
- NO se crean viajes/planes, asignaciones, tarifas ni estados de entrega. La orden queda en `SOLICITADA`; Operaciones decide (revisar, rechazar, programar).
- `GET` nunca informa entrega: `confirmsDelivery:false` siempre (Cerrado/Descargado no prueban entrega aceptada). Los estados son la **proyección propuesta** de API-10 (`projectExternalStatus`), marcada `labProposal:true`.
- La cancelación solo deja constancia (vínculo + auditoría) y evalúa con `assessCancellation`; `automatic:false`. No cancela solicitudes, planes ni viajes.

## Bloqueos y límites concretos
- **Vinculación**: el TMS exige cliente + usuario de portal para crear una solicitud. Se resolvió con un usuario de servicio inactivo y un mapeo administrativo; esa decisión de modelado (D04/D06) no está ratificada. `tms_linked` de API-01 se mantiene en 0 (su CHECK lo exige); el vínculo real vive en `ps_api12_tms_links`.
- **Lugares de carga/descarga**: PriceSmart no los envía; en el laboratorio son fijos por mapeo. La fecha pasada la rechaza el TMS: la orden queda `RECEIVED` sin vincular (probado, no se simula una solicitud).
- **Reintento de vinculación**: si falla tras el commit, se completa al reenviar la misma orden (idempotente); no hay worker. Tampoco hay `GET` masivo/listado de estados.
- **D02**: la autenticación del laboratorio es de PRUEBA. **Producción**: sin pool/cuenta/instancia reales, sin cifrado con KMS, sin TLS/gateway, reloj local.
- Uso de la bandeja existente sin cambios de UI: la cancelación solicitada se ve en `auditoría` y en `GET`, no como insignia en la bandeja.
