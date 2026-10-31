# PriceSmart API-01 — contrato y aplicación provisional

2026-10-31. Base `fcae97647e764dcf0219ee2870d77566ce0c8d66`, merge confirmado #546/S06-A. Rama independiente `feature/pricesmart-api01`. **D01–D16 pendientes de ratificación. No hay endpoints instalados, autenticación M2M ni persistencia real.** API-01 implementa DTO, validación y lógica de aplicación comprobable con repositorio simulado; no es una integración funcional.

## Entregables y navegación

- [OpenAPI 3.1 provisional](openapi.draft.json): dos operaciones propuestas POST/GET, cancelación en extensión sin método seleccionado, `x-executable:false`. Sin servidores contratados, credenciales ni esquema de autenticación ficticio.
- [Auditoría previa, reutilización y adaptador TMS](AUDITORIA-Y-ADAPTADOR.md).
- [Staging, concurrencia, durabilidad y permisos futuros](PERSISTENCIA.md) y [DDL bloqueado, no ejecutable como instalación](staging.sql.in).
- [Matriz de seguridad, decisiones D01–D16 y preguntas a PriceSmart](SEGURIDAD-Y-DECISIONES.md).
- [Pruebas y limitaciones](EVIDENCIA.md).

Código nuevo: `src/lib/integrations/pricesmart/contracts.ts`, `ports.ts`, `service.ts`, `transport.ts`. El repositorio falso está exclusivamente en `__tests__`, fuera del stage S05. No hay driver MariaDB, worker, materializador TMS, credenciales, migración productiva, modificación de permisos ni wiring con Next. Se leyeron las guías instaladas Next 16.4.1 de route handlers antes de implementar; se eligió no agregar `route.ts`.

## Sobre técnico mínimo propuesto

```json
{
  "schemaVersion": "api01-draft-1",
  "externalOrderId": "QA-ORDER-01",
  "originClubReference": "QA-CLUB"
}
```

Sólo este sobre técnico es válido en el prototipo, sin afirmar que sea una orden comercial completa. D06 deberá definir dirección, destinatario, contactos, ítems y demás datos reales: **no se inventan ni admiten como campos libres**. `externalOrderId`: 1–120 ASCII seguros, sensible a mayúsculas y sin trim; club: 1–64. No se admite empresa/cliente/usuario/plan/estado del body. `originClubReference` sólo se compara contra el club obtenido de una identidad confiable, no determina autorización ni empresa. El namespace tentativo es entorno + principal estable + empresa + cliente contractual + ID externo; su unicidad y comportamiento entre clubes dependen de D03.

JSON UTF-8 sin BOM, claves duplicadas (incluidas escapadas), campos desconocidos, objetos anidados o valores no string rechazados; máximo 65.536 bytes antes de parsear. Las referencias y motivos usan listas/cotas cerradas. El futuro transporte deberá limitar streaming antes de acumular memoria, validar Content-Type y rechazar codificaciones de contenido, además de implementar límites distribuidos. Eso aún no existe como HTTP operativo.

## Semántica provisional

| Operación | Resultado de aplicación | Contrato HTTP futuro, todavía inactivo |
|---|---|---|
| `receive(bytes)` | Inserta orden + evento + outbox + auditoría en un único puerto transaccional; UNIQUE decide carreras. Replay devuelve snapshot original inmutable; otro contenido para mismo ID causa CONFLICT | POST `/api/integrations/pricesmart/v1/orders`; 202 únicamente tras durabilidad real confirmada, no por el doble |
| `get(id)` | Consulta sólo scope de la identidad y club autorizado; proyecta estado local seguro y audita lectura | GET `/api/integrations/pricesmart/v1/orders/{externalOrderId}`; desconocido y ajeno, mismo 404 |
| `requestCancellation(id, bytes)` | Solicitud auditable CANCELLATION_REQUESTED para orden no vinculada, motivo enumerado; repetición igual replay, motivo diferente conflicto | Método/path pendientes D09/D12. OpenAPI sólo enumera candidatos en extensión, no instala POST/DELETE |

El resultado de aplicación es `{value, durability}`; el repositorio de tests devuelve siempre `SIMULATED`. `OrderApplication` espera resolución del commit antes de devolver; no emite respuestas HTTP ni considera el doble una aceptación durable. El único límite HTTP preparatorio `disabledHttpContract()` devuelve incondicionalmente 503/DISABLED, sin constructor, banderas o conexiones. No se monta en Next y ninguna variable de entorno lo habilita. El build no crea rutas por presencia de estos módulos: no hay `route.ts`, imports desde la app ni clientes que los activen; tests inspeccionan el árbol/imports. **No se ejecutó build Linux/aceptación HTTP**.

Estados locales propuestos: RECEIVED (procesamiento PENDING), REVIEW_REQUIRED y CANCELLATION_REQUESTED (PAUSED), CANCELLED (CANCELLED). API-01 sólo produce RECEIVED y CANCELLATION_REQUESTED. El grafo reserva RECEIVED→REVIEW_REQUIRED, RECEIVED/REVIEW_REQUIRED→CANCELLATION_REQUESTED y CANCELLATION_REQUESTED→CANCELLED; no hay servicio que ejecute revisión, cancelación final o entrega. Esas transiciones requieren eventos/worker/contrato ampliados en otro PR. No equivalen a estados TMS ni PriceSmart. La creación repetida después de solicitar cancelar devuelve su acuse original RECEIVED; GET muestra el estado actual, sin reactivar la orden.

La clave de identificación de una orden no es una clave HTTP de idempotencia. No se exige, interpreta ni persiste `Idempotency-Key` en API-01; D10 debe ratificar formato, obligatoriedad, retención y semántica. El antecedente F1 la proponía obligatoria, no la aprobó. El cambio de ese contrato requiere actualizar wire schema y diseño de operación, no elegirlo silenciosamente aquí.

## Límites de activación

Faltan ratificación, autenticación M2M aprobada, almacenamiento durable y cifrado, catálogo de clubes, protección antiabuso/replay, controles de privacidad/retención y autorización de infraestructura. El perfil S04 sigue ACCOUNT LOCK y SELECT: **no puede recibir, cancelar ni auditar estas lecturas**. No se desbloquea ni se amplían grants para las pruebas. S02–S06-A, TMS, módulos contables, Hostinger y #541 permanecen intactos. Sin SQL real, conexiones externas, datos reales, merge o despliegue.
