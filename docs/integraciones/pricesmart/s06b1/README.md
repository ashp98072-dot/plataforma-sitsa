# S06-B1 — expediente para ejecución manual posterior

Preparado el 2026-11-02 sobre `1eb1e6b906d6fa8a8554d07b03f7eb25079ef7d8` (merge #551). Alcance: preparación, preflight y criterios de aceptación. **No autoriza operaciones. Las 25 pruebas permanecen NO EJECUTADA**, incluida L1, cuya revisión formal de procedencia requiere custodio y firma independientes. D01–D16 siguen pendientes de ratificación.

## Ruta de revisión

1. Revisar [inventario y laboratorio](INVENTARIO-Y-LABORATORIO.md).
2. Auditar las 25 filas de [dependencias y ejecución](PLAN-25.md), junto con los criterios detallados originales de [S06-A](../s06a/MATRIZ-S06.md). Ambos documentos son acumulativos; este expediente no rebaja ningún criterio anterior.
3. Completar por separado el [checklist, preflight y parada](PREFLIGHT-Y-RECUPERACION.md). Presentar primero este PR a auditoría independiente; no se solicita autorización operativa en esta entrega.
4. Una autorización futura debe identificar gate, operador, VM nueva, ventana UTC, acciones, evidencia, condiciones de parada y hash del expediente aprobado. No hay autorización implícita por merge, JSON válido, tests verdes o tiempo transcurrido.

## Ejecución local permitida: solamente documentos

Desde la raíz del checkout auditado, con Node ya disponible:

```sh
node scripts/sandbox-s06a/preflight.mjs validate infra/pricesmart-sandbox/s06a/dossier.example.json
node scripts/sandbox-s06a/preflight.mjs assess infra/pricesmart-sandbox/s06a/dossier.example.json
node --test scripts/sandbox-s06a/preflight.test.mjs
```

`validate`: exit 0 significa formato válido, `authorizedToExecute:false`. `assess`: exit 2, BLOCKED, 48 entradas pendientes, primer gate GATE1. Exit 1 significa entrada inválida. Se reutiliza el validador S06-A sin modificarlo; no existe un segundo mecanismo de aprobación. Las pruebas locales verifican software/documentos, nunca Linux, SQL, HTTP, durabilidad, aislamiento ni recuperación reales.

La plantilla original conserva su fase S06-A y sus campos sin modificación. Un operador futuro generará una copia privada sanitizada bajo su control, sin sobrescribir la plantilla ni introducir aprobaciones ficticias. El evaluador tampoco verifica existencia, firma o veracidad de adjuntos: eso corresponde a auditoría independiente.

## Límites que no se resuelven aquí

- S04 está ACCOUNT LOCK; su perfil SELECT no permite escrituras y el bloqueo impide incluso autenticar. No desbloquearlo ni crear una cuenta alternativa para superar pruebas.
- API-02 necesita un perfil transaccional distinto aún no autorizado; cifrado y retención de payloads siguen pendientes. No usar datos reales.
- API-03 no tiene proveedor M2M real; API-04 no tiene rutas activas; API-05 no modifica TMS. No convertir dobles o circuito sintético en recepción operativa.
- Canal HTTP privado y protocolo de restauración siguen pendientes. Las comprobaciones positivas dependientes no pueden aprobarse por inferencia.
- Sin infraestructura creada, servicios instalados/iniciados, SQL aplicado, firewall/SSH modificados, Hostinger, producción, cambios contables, PR #541, merge o despliegue.
