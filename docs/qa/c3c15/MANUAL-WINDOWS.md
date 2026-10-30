# C3C-15 — Protocolo manual Windows

**Pendiente de ejecución.** Estos pasos son un protocolo de aceptación, no evidencia de que la interfaz funcione. Se requiere una persona con navegador y Microsoft Excel. No usar Hostinger, credenciales reales, perfiles con sesiones productivas ni una copia de datos reales.

## 1. Puerta de entrada: entorno local sintético

**Actualización C3C-15B:** para la instancia persistente `127.0.0.1:43306`, base vacía `c3c15_lab`, usar [el bootstrap específico y sus comandos](../c3c15b/README.md). Sustituye la preparación genérica y el arranque por variables descritos en esta sección. No ejecutar ambos procedimientos. Los apartados 2–6 siguen siendo el protocolo visual pendiente; al finalizar, `Lab.ps1 -Action Stop` detiene exclusivamente Next y conserva MariaDB.

1. Usar una copia aislada de este commit creada con `git archive`, sin copiar `.env`, `.env.local`, `.env.production`, uploads ni configuraciones externas del checkout de trabajo. Instalar las dependencias del lockfile en esa copia.
2. Aprovisionar una **MariaDB 11.8.9 nueva y desechable**, datadir exclusivo y enlace solo a loopback, con un puerto no usado. Crear una base `c3c15_lab_<identificador>`, un usuario exclusivo sin permisos sobre otras bases y contraseña local temporal. Registrar versión, datadir, puerto, nombre de base y operador. No reutilizar un servicio ni el laboratorio C3C-8.
3. Aplicar en esa base vacía el esquema y dependencias existentes C3C-1 a C3C-13 según el proceso de aprovisionamiento del proyecto, con sus preflight/postcheck. **No se proporciona ni se ha probado en C3C-15 un bootstrap UI autocontenido.** No asumir que `schema.sql` por sí solo basta: el calendario y dependencias previas se gestionan en migraciones existentes. Si falta cualquier tabla, detener la aceptación y registrar el bloqueo; no omitir checks o FK.
4. Crear exclusivamente usuarios sintéticos: preparador, revisor designado, resolutor y lector; los tres primeros distintos, activos y asignados a la empresa, con `contabilidad` ver/editar explícitos. El lector tendrá acceso al Calendario y lectura, sin edición de gestión. Configurar permisos `contabilidad_calendario_ver` y los de creación solo cuando sean necesarios para preparar el fixture. No usar Admin para probar al lector ni herencias ambiguas de permisos.
5. Preparar dos empresas y dos libros sintéticos. En un ejercicio QA usar ingreso 100.00, gasto 40.00, historia anterior de ingreso 900.00, borrador excluido de 777.00 y movimiento posterior al corte de 888.00, siguiendo el fixture de `src/lib/contabilidad/c3c14-qa.integration.test.ts`. No introducir esos movimientos mediante contabilización productiva: forman parte de la carga inicial del laboratorio. Períodos en el estado inicial requerido, cuenta de resultado Capital activa y control del libro activo, sin ejercer acciones reales de cierre/apertura.
6. Preparar origen documental, revisión C3C-10, política propuesta, borrador y solicitud; realizar decisiones técnicas antes de declarar/verificar evidencias obligatorias POLITICA, BORRADOR y REVISION_DOCUMENTAL. Conservar otro expediente con una evidencia pendiente, y otro con una constancia histórica desactualizada. Usar los servicios y contratos actuales; no editar históricos para fabricar vigencia.
7. Registrar en una hoja privada del laboratorio: URL local, slugs, IDs de empresa/libro/ejercicio/solicitud, usuarios, responsables y contraseñas temporales. No incorporarla al PR ni capturar contraseñas/cookies/JWT. Esta preparación de login es distinta del fixture automático C3C-14, que no ofrece contraseñas de navegador ni mantiene un servidor Next abierto.

Los ejecutores `scripts/ci/c3c14/run-windows.mjs` son pruebas transitorias: cierran MariaDB al terminar. **No sirven para abrir posteriormente la aplicación contra su manifest ni para reutilizar su datadir.** No ejecutar `scripts/init-db.mjs` sin revisión: carga archivos `.env` y semillas generales, no este entorno manual específico.

Antes de arrancar Next, comprobar que no existen archivos de entorno en las rutas candidatas de `src/lib/load-env.ts` (incluidos `config/.env` y `config/app.env` en los ancestros). Esa función puede dar prioridad a configuración persistente sobre variables del proceso. Ante un candidato existente, detenerse y elegir una copia con ancestros limpios; no mostrar ni editar su contenido.

En la **copia aislada**, configurar únicamente variables de esa sesión de PowerShell. Reemplazar los valores de ejemplo por los registrados en el paso 7, nunca por los productivos:

```powershell
$env:DB_HOST = '127.0.0.1'
$env:DB_PORT = '<puerto exclusivo del laboratorio>'
$env:DB_NAME = 'c3c15_lab_<identificador>'
$env:DB_USER = '<usuario exclusivo sin acceso a otras bases>'
$env:DB_PASSWORD = '<contraseña local temporal>'
$env:AUTH_SECRET = '<secreto aleatorio temporal de al menos 32 caracteres>'
$env:NEXT_TELEMETRY_DISABLED = '1'
npm run dev -- --port 4315
```

Abrir solo `http://127.0.0.1:4315`. Mantener el servidor y la BD en el laboratorio; no navegar a servicios externos ni probar FEL, correo u otros módulos. Este arranque completo todavía **no ha sido ensayado** en C3C-15. Si falla, registrar FALLIDA la preparación y NO EJECUTADA las pruebas dependientes.

## 2. Navegación autenticada

Usar perfiles temporales separados para lector/revisor/preparador/resolutor o cerrar sesión entre cada rol. No inyectar un JWT ni reemplazar cookies para acreditar login.

1. Abrir `/login`; usuario incorrecto debe producir error sin sesión. Ingresar las credenciales sintéticas válidas. El formulario usa `POST /api/auth/login` y sigue el `redirect` devuelto.
2. En `/select-empresa`, seleccionar la empresa QA. El cliente usa `POST /api/auth/select-empresa` y `window.location.replace`, que crea un documento nuevo al cambiar de tenant. Si solo hay una empresa autorizada, puede seleccionarse automáticamente.
3. Abrir `/e/<slug-QA>/contabilidad/calendario`. Seleccionar el **Libro contable** y pulsar el botón del ejercicio. Si hay un único libro activo puede preseleccionarse; el ejercicio se elige explícitamente.
4. En **Validación integral e informe precontable**, pulsar **Evaluar / actualizar condiciones**. Abrir el detalle de solicitud. Confirmar empresa/libro/ejercicio, resultado preliminar 60.00, historia anterior separada y propuesta Debe/Haber 100.00. El asiento Borrador y el posterior al corte no entran en esos importes.
5. Revisar períodos, bloqueantes, referencias, evidencias, responsables, historial y huella integral. En el expediente pendiente debe verse el motivo concreto. Capturar antes y después de actualizar; no equiparar un HTML SSR a esa captura.

## 3. Responsabilidades, constancias y cambios

- **Lector:** ve el informe; no aparece el formulario de constancia. Una llamada POST a la ruta protegida con ese usuario debe rechazarse, sin nueva fila ni auditoría de éxito. Registrar el estado HTTP en DevTools sin copiar cookies.
- **Preparador y resolutor:** no pueden asumir el papel del revisor para emitir constancias. Comprobar ambos perfiles, no solo el lector.
- **Revisor designado:** formulario con justificación de al menos 15 caracteres y casilla de confirmación. Sin justificación/casilla, el navegador debe impedir el envío. Con datos válidos, registrar una constancia, comprobar mensaje de éxito, versión nueva e historial. No hay botón APROBAR ni estado formal aprobado.
- **Reintento:** si se prepara un fallo controlado del transporte en el laboratorio, volver a consultar y repetir el mismo contenido. Corroborar idempotencia con BD/auditoría sintética; no atribuir esa garantía solo al mensaje visual.
- **Cambio de fuente:** en una nueva versión documental o evidencia sintética, actualizar la evaluación y observar los componentes cambiados y la constancia DESACTUALIZADA. No editar ni borrar movimientos previos para esta prueba. Una decisión posterior puede exigir nuevas declaraciones/revisiones de evidencia.
- **Cambio de empresa/libro/ejercicio:** repetir navegación y comprobar que no permanecen informe, formulario o respuestas pendientes del tenant anterior. Revocar solo permisos del laboratorio y confirmar que la UI/POST rechazan el registro al actualizar.

## 4. Descargas por navegador

1. Pulsar **Exportar informe JSON**. Comprobar archivo en Descargas, nombre de solicitud, JSON válido, `vigencia=INSTANTANEA_REQUIERE_RECONSULTA`, IDs y estado formal pendiente. Este botón genera un Blob del informe mostrado; no reconsulta fuentes por sí mismo.
2. Pulsar **Exportar Excel de evaluación actual**. Registrar petición GET al mismo origen con `formato=xlsx&solicitud=...`, respuesta 200, tipo XLSX, cabecera de descarga y archivo real. Esta exportación sí reevalúa fuentes; el JSON anterior y el XLSX pueden diferir legítimamente si cambian las condiciones entre ambas acciones. Comparar huellas y fecha, no asumir identidad por el nombre.
3. Exportar una **constancia histórica JSON**. Confirmar `vigenciaActual` y `cambios` coherentes con su estado; no presentarla como actual después de un cambio.
4. Registrar hash de los archivos con `Get-FileHash -Algorithm SHA256`, tamaño y captura del historial de descarga. No usar lectura de XLSX por una librería para marcar aprobada la descarga de navegador.

## 5. Microsoft Excel: revisión visual real

La muestra existente `docs/qa/c3c14/artefactos/c3c14-precontable.xlsx` permite revisar offline una exportación sintética conocida incluso antes del servidor. Abrirla manualmente con **Archivo > Abrir**. Esto no acredita la descarga actual del navegador. Después repetir con el archivo descargado del caso anterior.

Comprobar visualmente las cinco hojas: Revision precontable, Saldos originales, Propuesta simulada, Diagnostico y Evidencias y decisiones. Confirmar 100.00 de ingresos, 40.00 de gastos, resultado 60.00, historia anterior -900.00 y propuesta balanceada 100.00/100.00 para el fixture base. Revisar encabezados, saltos de línea, anchos/alturas, celdas cortadas, legibilidad de hashes/justificaciones, primera fila inmovilizada, números negativos y centavos. Confirmar la separación entre originales y simulación y el aviso formal pendiente.

Abrir **Archivo > Imprimir** y revisar todas las hojas y saltos; no imprimir físicamente. Capturar la ventana real y la vista previa con nombre del libro/hoja. Si hay recortes, registrar hoja/celda, zoom, tamaño de página y captura antes de modificar nada. No guardar correcciones manuales sobre el XLSX original ni habilitar macros, vínculos externos o barreras de seguridad para hacer pasar la prueba.

## 6. Evidencia y cierre

Para cada ID de `matriz.json`, registrar APROBADA, FALLIDA o NO EJECUTADA, operador, fecha/hora America/Guatemala, commit, rol, IDs QA, esperado, observado y archivos de evidencia. La captura debe mostrar UI real y nunca contraseñas, cookies, tokens o datos de otras sesiones.

Detener Next y solicitar el cierre ordenado de **esa instancia** MariaDB; verificar PID/datadir y log de cierre. No usar terminaciones globales ni borrar laboratorios anteriores. Mantener el PR Draft hasta completar los casos obligatorios y la auditoría independiente. Aprobar regresión técnica no aprueba C3C-15 funcionalmente ni autoriza contabilizar.
