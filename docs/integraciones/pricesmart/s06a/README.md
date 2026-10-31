# PRICESMART-SANDBOX-S06-A

Preparación de aceptación operativa para auditoría, sin infraestructura creada/modificada ni pruebas Linux ejecutadas. Base `1f3857c2696b820e3081a468929854d9b02f53f8` (merge #545), rama `feature/pricesmart-sandbox-s06a`. S02–S05 íntegros; #541 sin cambios. D01–D16 pendientes.

- [Arquitectura, comparación de modalidades y recursos](ARQUITECTURA.md).
- [Preflight crítico, siete gates y validador reproducible](PREFLIGHT-Y-GATES.md).
- [Matriz A–L: 25 pruebas reales propuestas, todas NO EJECUTADA](MATRIZ-S06.md).
- [Recuperación, backup cifrado, restore nuevo y reversión](RECUPERACION.md).
- [Resultados estáticos y límites de evidencia](EVIDENCIA.md).
- [Modelo sanitizado de expediente](../../../../infra/pricesmart-sandbox/s06a/dossier.example.json).

Bloqueos: selección/costo/VM sin aprobar; sin build Linux S05; acceso privado de navegador aún incompatible con perfil de red cerrado; cuenta S04 bloqueada impide positivos de login/SELECT; compatibilidad ensureSchema con sólo lectura no demostrada; restore seguro sin implementar/validar. Ninguno se resuelve abriendo permisos o sustituyendo pruebas reales por mocks. Revisar cada dependencia antes de autorizar la fase futura correspondiente.

La automatización sólo valida un JSON local sanitizado y devuelve siempre `authorizedToExecute:false`. Un expediente artificial completo usado en tests no es evidencia real. La siguiente ejecución operativa requiere autorización posterior y expresa del operador; ni este PR ni su eventual merge la conceden.
