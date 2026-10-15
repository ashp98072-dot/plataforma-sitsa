# Combustibles C-1 — captura por Operaciones

Base inicial: `c416498c9d31c01f815f11aca838453b7bd5f6bd`.
Una sola fuente: `flota_combustible_cargas`; sin copiar registros, cambiar IDs o mover archivos.

## Uso y contratos

- Página: `/e/[slug]/combustibles`, dentro de Operaciones.
- `/e/[slug]/flota?tab=combustible` redirige desde el servidor. Las demás pestañas conservan el cliente de Flota.
- Permiso persistido: `flota_combustible`. `ver` permite consultar; `editar` permite registrar, editar pendientes, revisar y conciliar.
  No se agregan grants ni se separa registrar/revisar en C-1. Catálogo y guard pasan a Operaciones/TMS, sin exigir Flota completa.
- POST `/api/empresas/[slug]/flota/combustible`: multipart, alta PENDIENTE.
- PATCH `/api/empresas/[slug]/flota/combustible/[id]`: solo PENDIENTE, conservando el archivo si no se reemplaza.
- GET `.../combustible/catalogos`: únicamente para editar; proveedor id/nombre y unidad id/placa/descripción; sin cuentas bancarias.
- Alta: proveedor activo del tenant, vehículo activo propio/compartido, número/fecha de vale, diesel/gasolina,
  galones positivos (máximo 3 decimales), monto positivo (máximo 2 decimales), una imagen/PDF.
- Opcionales: `viajeId` de **flota_viajes**, kilometraje, estación y observaciones. Un viaje indicado debe pertenecer
  al tenant y a la unidad, pero NO se exige que esté abierto. No es un ID de plan TMS.
- `precio_por_galon = monto / galones`, calculado exclusivamente en servidor con Decimal y redondeo HALF_UP a 2 decimales.
  La UI muestra el mismo cálculo. No se usa precio manual para nuevas capturas staff ni conversiones a litros.
- Las altas guardan `empleado_id` y `piloto_nombre` NULL, incluso si se indica un viaje. No se inventa un piloto.
- Eje operacional: unidad + proveedor + vale + consumo + evidencia + actor de Operaciones + revisor. El piloto no es responsable sustituto.
- `creado_por`/`revisado_por` conservan el username textual. Además se guardan `creado_por_usuario_id` y
  `revisado_por_usuario_id` desde la sesión, siguiendo el patrón de referencia a `usuarios.id` ya usado en Compras y otros documentos.
  La auditoría común (`registrarAuditoriaTx`/`registrarAuditoria`) sigue siendo la misma; no tiene campo global de usuario ID,
  por lo que este ID también se incluye en el detalle sin alterar el modelo común. Una edición nunca reemplaza al creador original.
  Los IDs nuevos son nullable para históricos y NO se reconstruyen desde empleados, pilotos o usernames antiguos.
- La tabla distingue «Piloto histórico», «Registrado por» y «Revisado por»; el formulario no ofrece un selector de piloto.
- Los históricos mantienen piloto/viaje/proveedor ausente y sus archivos. `viaje_id=NULL` nunca se convierte en 0.
- Al editar un histórico pendiente sin proveedor, se debe seleccionar uno para guardar. Los registros aprobados/rechazados
  permanecen de solo lectura. Un proveedor/unidad inactivo ya seleccionado puede conservarse al editar; no se ofrece para altas.
- Duplicados: rechazo 409 por empresa + proveedor + número (TRIM/UPPER). El bloqueo del proveedor serializa los escritores staff
  durante esa comprobación. **No es un UNIQUE físico** ni protege escrituras SQL externas; no se deduplican históricos.
- Auditoría y escritura van en la misma transacción. Si falla antes del commit se compensa el archivo nuevo.
  Al reemplazar evidencia se conserva el archivo anterior: no se destruyen archivos históricos automáticamente.

## Portal anterior

Se retira el formulario de nueva captura del viaje. El POST antiguo responde 410, sin escrituras.
GET `/api/portal/viajes/[id]/combustible` conserva autorización de participante y lectura de históricos/archivo.
Se conserva el helper/formulario antiguo no montado por compatibilidad de código; no es un flujo activo.
No se modifica salida/llegada/cierre de viajes, disponibilidad ni liquidación.

## Lo que NO cambia

- Conciliación Excel e historial: COINCIDE/DIFERENCIA/SOLO_GASOLINERA/SOLO_SISTEMA/AMBIGUO.
- El lector `src/lib/flota/combustible-conciliacion-excel.ts` del PR #195 NO se modifica ni se traen sus commits.
- Resumen mensual: APROBADOS, por `creado_at`, NO por `fecha_consumo`.
- Descarga de evidencias y raíz persistente de `guardarUpload`, con límite/extensiones existentes.
- Sin Fondos/C-2, entidad requirente, factura/serie, estado ANULADO, litros ni escritura contable.
- No cambia `sql/schema.sql` ni código de Contabilidad/Milenium/RRHH o trabajo concurrente de Claude.

## Esquema y despliegue MANUAL, previo al código

No se ejecuta SQL productivo desde este trabajo, requests, build o deploy C-1.
Se eliminan las llamadas de preparación runtime de los endpoints de Combustibles. El bootstrap general de Flota existente
(`src/lib/flota/schema.ts`) no se amplía: en instalaciones nuevas primero se prepara su esquema histórico y luego se aplica
la migración explícita C-1. No se recrea ninguna tabla existente.

1. Backup y ventana operativa aprobados por el responsable de producción. Seleccionar la BD correcta en phpMyAdmin.
2. Ejecutar **solo** `sql/preflight-2026-10-combustibles-c1.sql` y revisar todos sus resultados.
   Incluye SHOW CREATE/COLUMNS/INDEX/STATUS, referencias, nulos, duplicados y fechas. SHOW CREATE descubre FK/CHECK no registrados en código.
3. APLICAR solo si se confirma: InnoDB; viaje/empleado INT signed; piloto VARCHAR(120); demás columnas legacy necesarias
   (numero_vale, fecha_consumo, precio_por_galon y galones DECIMAL(12,3)); sin referencias rotas ni FK/CHECK incompatibles.
   Revisar también SHOW CREATE de usuarios y los tipos de los campos de actor si existen.
   Si existe proveedor_id/observaciones/creado_por_usuario_id/revisado_por_usuario_id con otro tipo o un esquema parcial no explicado: DETENER y revisar.
   Los duplicados históricos requieren diagnóstico, nunca borrado ni backfill automático.
4. Con autorización explícita aparte: `sql/migrate-2026-10-combustibles-c1.sql`.
   Agrega proveedor_id INT NULL, observaciones VARCHAR(1000) NULL, creado_por_usuario_id INT NULL,
   revisado_por_usuario_id INT NULL y permite NULL en viaje/empleado/piloto.
   No agrega UNIQUE/FK, no cambia collation/índices existentes ni ejecuta DML. Reejecutable sobre el contrato esperado.
5. Ejecutar `sql/verificar-2026-10-combustibles-c1.sql`. Comparar conteos/IDs y definiciones; validar archivos por separado.
6. Desplegar solo después del postcheck. No habilitar el código sobre el esquema antiguo.
7. QA manual con usuarios ver/editar, otra empresa, alta sin viaje, edición pendiente, rechazo/aprobación,
   histórico del Portal, descarga, resumen mensual y conciliación con un archivo controlado.

NOOP significa que los cuatro campos nuevos y las tres nullabilities ya tienen la definición objetivo; no basta que existan los nombres.
No se agregan FKs nuevas sin preflight físico aprobado ni se crea un maestro paralelo de personal/usuarios.
No se promete validar archivos físicos con SQL. Si hay un archivo faltante, investigar antes de reemplazarlo.

## Pruebas reproducibles

Dirigidas: `npx vitest run src/lib/flota src/lib/tenant-combustible.test.ts src/lib/permisos-shared.test.ts src/lib/permisos-catalogo.test.ts src/app/api/empresas/[slug]/flota/combustible src/app/api/portal/viajes`.

Prueba DB opt-in: MariaDB **11.8.9** desechable en **127.0.0.1:33479**, root de la instancia de pruebas sin contraseña.
`COMBUSTIBLE_C1_DB_PORT=33479 npx vitest run src/lib/flota/combustible-c1.db.test.ts`.
Nunca configurar contra producción. Crea una BD `combustible_c1_test_<uuid>` y elimina únicamente esa BD tras finalizar.
Verifica preflight, migración repetida, conservación campo por campo del histórico y servicio real con aislamiento/revisión/resumen.
No abre/usa las bases preexistentes del servidor local. El resto de pruebas usa mocks/sintéticos.

Pendiente: QA manual en navegador y preflight/postcheck productivos, exclusivamente por el operador autorizado.
GitHub checks son independientes de estas verificaciones locales.

## Validación local inicial (anterior al ajuste de trazabilidad de actores)

- Dirigidas: **453/453**, incluidas tres pruebas reales contra MariaDB 11.8.9 desechable.
- TypeScript: limpio. Build Next.js: exitoso (advertencias preexistentes de tracing/middleware).
- ESLint: cero incidencias en los archivos tocados salvo **8 errores preexistentes** de react-hooks/set-state-in-effect
  en flota-client.tsx; BASE y HEAD tienen las mismas ocho incidencias. No se corrige deuda ajena.
- git diff --check: limpio.
- Suite completa con `--maxWorkers=4`, mismas dependencias, Node/npm y máquina:
  BASE **10435 pass / 22 fail / 482 skip**; C-1 **10454 pass / 22 fail / 485 skip**.
  Los 22 fallos coinciden por archivo, nombre y mensaje principal: **CERO REGRESIONES NUEVAS**.
  Los tres skips adicionales son las pruebas DB opt-in; esas tres se ejecutaron aparte y también en las 453 dirigidas.
- Fallos de base: 14 de API Programación (TC/tercerizados/regreso), 2 guards de Compras sensibles al diff,
  1 Centro logístico, 1 dependencia unzip ausente, 1 wiring catálogo vehículos, 1 wiring imagen Programación,
  1 contrato schema vacaciones, 1 contrato de montaje Atracción. No se modifican esos módulos.
- Primera exploratoria sin limitar workers produjo fallos adicionales de timing/expectativas de navegación;
  se ajustaron únicamente las dos expectativas afectadas por el traslado aprobado y se repitió BASE/HEAD con cuatro workers.
  El archivo de pruebas de escaneo contable pasó aisladamente **24/24**; no se modificó.
- PR #195 sigue abierto y solo toca combustible-conciliacion-excel.ts y su test: **sin archivos compartidos con C-1**.
- No se ejecutó SQL productivo ni se modificaron datos productivos. QA manual y postcheck productivo siguen pendientes.
- Los resultados anteriores son LOCALES, no una afirmación sobre checks de GitHub.

## Inventario exacto del cambio (37 archivos)

```text
docs/COMBUSTIBLES-C1.md
sql/migrate-2026-10-combustibles-c1.sql
sql/preflight-2026-10-combustibles-c1.sql
sql/verificar-2026-10-combustibles-c1.sql
src/app/api/empresas/[slug]/flota/combustible/[id]/route.ts
src/app/api/empresas/[slug]/flota/combustible/[id]/revisar/route.test.ts
src/app/api/empresas/[slug]/flota/combustible/[id]/revisar/route.ts
src/app/api/empresas/[slug]/flota/combustible/catalogos/route.ts
src/app/api/empresas/[slug]/flota/combustible/conciliaciones/route.ts
src/app/api/empresas/[slug]/flota/combustible/resumen/route.ts
src/app/api/empresas/[slug]/flota/combustible/route.ts
src/app/api/portal/viajes/[id]/combustible/route.test.ts
src/app/api/portal/viajes/[id]/combustible/route.ts
src/app/e/[slug]/combustibles/page.tsx
src/app/e/[slug]/flota/flota-client.tsx
src/app/e/[slug]/flota/flota-page-client.tsx
src/app/e/[slug]/flota/page.tsx
src/app/portal/viajes/viaje-form.tsx
src/components/app-shell-navegacion-pendiente.test.ts
src/components/app-shell.tsx
src/components/flota/combustible-registro.tsx
src/components/flota/combustible-revision.tsx
src/components/flota/combustibles-client.tsx
src/components/rendimiento-local.test.ts
src/lib/flota/combustible-c1-wiring.test.ts
src/lib/flota/combustible-c1.db.test.ts
src/lib/flota/combustible-staff-http.test.ts
src/lib/flota/combustible-staff-http.ts
src/lib/flota/combustible-staff-schema.ts
src/lib/flota/combustible-staff.test.ts
src/lib/flota/combustible-staff.ts
src/lib/flota/combustible.test.ts
src/lib/flota/combustible.ts
src/lib/permisos-catalogo.ts
src/lib/permisos-shared.ts
src/lib/tenant-combustible.test.ts
src/lib/tenant.ts
```

## Validación del ajuste funcional — control sin pilotos

- Pruebas dirigidas **456/456**; incluyen tres pruebas contra MariaDB 11.8.9 desechable con la migración ampliada.
- Se verifica: creador/revisor tomados de sesión (payload suplantado ignorado), creador inmutable al editar,
  actores históricos NULL sin backfill, viaje NULL sin convertir a 0 y altas sin empleado/piloto aunque se indique viaje.
- TypeScript, ESLint de los 13 archivos de este ajuste y diff-check: limpios. Build: exitoso.
  La deuda de ocho errores de Flota documentada arriba no fue modificada.
- Suite completa con cuatro workers: **10457 pass / 22 fail / 485 skip**, comparada con BASE
  **10435 pass / 22 fail / 482 skip**. Los fallos coinciden por archivo, nombre y mensaje: cero regresiones nuevas.
- La migración sigue sin ejecutarse en producción. Los nuevos IDs de usuario requieren revisar el preflight actualizado;
  no se agregan FKs, seeds, backfill ni un catálogo paralelo de empleados. No hay bloqueos operacionales nuevos.
- Ajuste sobre el mismo PR, sin merge. Resultados locales; QA manual y validación física productiva siguen pendientes.
