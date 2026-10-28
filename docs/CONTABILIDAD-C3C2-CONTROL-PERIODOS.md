# C3C-2: control de períodos por empresa y libro

Base: origin/main b3a04d27 (PR #523 integrado). Rama feature/c3c2-control-periodos.
Implementación local sin commit, publicación, activación ni migración operativa.
Son reglas de Novalvion; no equivalencia verificada con Milenium.

## Contrato implementado

- CONFIGURADO -> ABIERTO -> CERRADO; reapertura CERRADO -> ABIERTO con solicitud y
  aprobación por otra persona. Varios abiertos, sin cascadas. Ejercicios conservan
  CONFIGURADO; no hay cierre de ejercicio, asientos automáticos o saldos nuevos.
- Configuración por empresa/entidad inicialmente NO_ACTIVADO. Una fila se prepara
  bajo el lock de ámbito sin activar. No existe endpoint de desactivación.
- RegistrarAsientoTx valida el control antes de INSERT, tanto manual como desde
  eventos. Si está activo exige exactamente un período ABIERTO. Si falta esquema
  falla cerrada con 503; nunca vuelve silenciosamente a modo desactivado.
- Cerrar exige control ACTIVO: no existen cierres decorativos ignorados por los
  escritores. No cambia asientos anteriores ni asigna períodos por inferencia.
- Motivos de 20 a 1000 caracteres, sin controles/invisibles. Versiones esperadas e
  identificadores UUID de operación; repetición idéntica devuelve el resultado
  confirmado, contenido diferente entra en conflicto. Revalidación de permisos
  también al repetir. Ante confirmación incierta consultar historial antes de repetir.

## Permisos y operadores

Claves cont_periodos_abrir, cerrar, reabrir_solicitar, reabrir_aprobar, diagnosticar,
activar_solicitar, activar_aprobar y operadores (cada sufijo lleva cont_periodos_).
Se acortaron las propuestas funcionales para respetar usuario_modulo.modulo VARCHAR(40).
Se agregan al catálogo existente, sin legacy de contabilidad:editar ni defaults Admin.
Las acciones requieren filas explícitas puede_ver, incluida contabilidad_calendario_ver,
usuario activo, acceso vigente a empresa, módulo y operador habilitado en el libro.
El servicio relee grants/usuario dentro de la transacción; no confía en caché o rol.

Bootstrap: un administrador de accesos asigna explícitamente cont_periodos_operadores
y lectura desde la matriz existente. Esa capacidad permite administrar operadores
en sus empresas autorizadas sin requerir una habilitación previa circular. No puede
autoasignarse ni cambiar su propia habilitación; el destinatario debe tener la
capacidad explícita para habilitarse. Revocar es posible incluso si perdió el grant.
Los demás operadores requieren intersección de grant global y habilitación del libro.
cont_entidad_usuarios permanece sin reinterpretación. Consultas anteriores no cambian.

Solicitar y aprobar activación/reapertura exige dos usuarios distintos, activos y
autorizados al resolver. Aprobar y ejecutar son una transacción. Cambiar operadores,
período o diagnóstico invalida la ejecución; se rechaza sin activar y exige solicitud
nueva. Rechazo explícito se conserva. No hay aprobación diferida ni caducidad implícita.

## Transacciones, diagnóstico y evidencia

Orden: empresa -> entidad -> control -> solicitud/período -> datos -> historial y
auditoría -> commit. Todos los escritores comparten el lock estable de empresa.
El contador de cambios se modifica junto al asiento y revierte con él. Se conservan
lecturas con bloqueo del adaptador para no fijar una vista obsoleta antes del candado.

El diagnóstico conserva reglas, huella, versiones, contador, bloqueantes y advertencias.
Se repite al solicitar y aprobar. Bloquean incoherencia de calendario, ejercicios sin
períodos, cruces de ámbito, detalles huérfanos, importes inválidos y descuadres por
asiento. Historia válida sin cobertura y ausencia de abiertos son advertencias que
deben aceptarse expresamente. No se corrige historia ni se fabrica cobertura.

Cada cierre conserva revisión, actor, rango y versión del período, cantidades,
totales exactos en centavos y movimientos ordenados con huella SHA256. No usa
paginación de reportes. Se rechaza evidencia de más de 8 MiB, no se trunca. Reapertura
conserva cierres anteriores. Historial y auditoría son parte del mismo commit; sus
fallos revierten también estado, solicitudes y evidencia.

Reportes y Excel identifican fecha de generación y versiones/revisiones en su misma
instantánea READ ONLY. Son datos vigentes de esa instantánea, no reproducción
certificada de exportaciones antiguas. La evidencia no captura nombres históricos
de cuentas ni garantiza inmutabilidad frente a un administrador SQL.

## API e interfaz

GET/POST /api/empresas/[slug]/contabilidad/periodos-control?entidad=ID.
GET con cierre=ID obtiene evidencia, siempre acotada al mismo ámbito.
POST discriminado por accion: abrir, cerrar, diagnosticar, activar_solicitar,
reabrir_solicitar, resolver u operador; operacion UUID y motivo obligatorios.
La pantalla /e/[slug]/contabilidad/periodos usa versiones actuales y no reintenta
escrituras automáticamente. El servidor siempre autoriza aunque el cliente oculte
acciones. Lecturas limitan las listas a los últimos 100 eventos/solicitudes/cierres;
la evidencia puede consultarse por su identificador autorizado.

## Migración y ensayo

Tres SQL propuestos: preflight/migrate/postcheck-2026-10-contabilidad-periodos-c3c2.sql.
No se ejecutaron operativamente. La migración amplía CHECK de períodos, agrega
versiones y seis tablas; no inserta operadores ni activaciones ni actualiza asientos.
MySQL necesita DROP CHECK; MariaDB DROP CONSTRAINT: el adaptador migration.mjs hace
solo esa sustitución y rechaza destinos fuera del patrón de laboratorio.
DDL no atómico: una instalación parcial requiere recuperación revisada. Antes de
un corte real deben revisarse esquema real, backup/recuperación y todos los escritores.
No desplegar el servicio central sobre un esquema sin preparar: bloqueará registros.

Ensayos autorizados locales, con DATADIR nuevo, pipe UUID, TCP deshabilitado y X
deshabilitado en MySQL. Hashes fijos de binarios, --no-defaults y --no-monitor para
MySQL Windows; no se usa el servicio MySQL80 ni .env. Identidad, base y token se
revalidan antes de las operaciones. Datos completamente ficticios.

    node scripts/ci/c3c2/run-windows.mjs --run-isolated --engine=mariadb
    node scripts/ci/c3c2/run-windows.mjs --run-isolated --engine=mysql

El runner comparte utilidades C3C-1 versionadas; no depende de c3c1-mysql ni c3c1-ui.
No instala dependencias. Conserva registros, manifiesto privado y resultados en TEMP.
Los manifiestos contienen token de laboratorio: no publicarlos.

## Límites de revisión

No hay modificación, anulación ni reversión de asientos; son entregas futuras.
No se certifican conciliaciones, obligaciones fiscales o pendientes de sistemas externos.
SQL directo puede eludir invariantes del servicio: requiere permisos operativos
restrictivos. La limpieza general contable se bloquea con cualquier libro activo.
La revisión de cobertura de escritores debe repetirse si se añaden importadores.
Retención de evidencia, asignaciones iniciales y aceptación de incidencias históricas
siguen requiriendo aprobación operativa del responsable contable. No hay activaciones
productivas autorizadas ni realizadas. UI probada de forma estática, no DOM real.

## Validación local conservada (2026-10-28)

- 277/277 pruebas unitarias y regresiones seleccionadas, en 22 archivos: permisos,
  tenant, asientos, eventos, entidades, consultas, calendario, reportes y C3C-2.
- MariaDB 11.8.9: 14/14 pruebas transaccionales reales, cero fallidas/omitidas.
  Evidencia TEMP/novalvion-c3c2-6ce422b0a1b24ef4a3aef5b72afdda2e.
- MySQL 8.0.46: 14/14 pruebas transaccionales reales, cero fallidas/omitidas.
  Evidencia TEMP/novalvion-c3c2-69c4180958574bb68a6e3606274acf3d.
- Incluye diagnóstico obsoleto, revocación, dos actores, rollback de activación,
  cierre y asiento, FK/CHECK reales, evidencia aislada y concurrencia en ambos
  órdenes de registro/cierre, además de dos cierres competidores.
- Ambos servidores finales confirmaron apagado y código 0; PID ausentes después.
  Se conservaron también intentos fallidos anteriores. En el primer MySQL, Windows
  creó un monitor: la identidad rechazó el arranque antes del bootstrap. Se cerró
  el servidor temporal por su pipe tras verificar PID, ejecutable, hora y datadir;
  Shutdown complete confirmado. El lanzador final fija --no-monitor y hashes.
- Una ejecución general de tests ajenos se interrumpió al observar carga de .env;
  no cuenta como regresión aprobada. No se repitió esa selección general. Las
  suites citadas usan mocks o el pool de pipe temporal; no prueban toda la plataforma.
- TypeScript usa la configuración de aplicación sin emitir y excluye únicamente
  los directorios auxiliares sin seguimiento c3c1-ui/c3c1-mysql, ajenos a la entrega.
  No se modificó tsconfig para ocultar sus errores preexistentes.
  Resultado final: cero diagnósticos. ESLint, sintaxis de runners y diff --check
  aprobados. Los 60 archivos locales excluidos cotejados por hash siguen intactos.

Revisión operativa aún necesaria: UX montada/DOM, identidad personal de aprobadores,
política de retención, inventario de escritores externos y procedimiento de corte
en el esquema real. Ninguna cifra autoriza desplegar o aplicar SQL operativo.
