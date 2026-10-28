# Correcciones locales de C3C-1 / PR #523

Preparadas sin commit ni push sobre feature/c3c1-calendario-contable.

- Runner MariaDB: resultado funcional separado en functional-result.json; cierre
  registrado en shutdown.jsonl con PID del hijo conservado. Exige petición sin
  error, salida 0 sin señal y confirmación Shutdown complete/completed en server.log.
  Un timeout o terminación forzada siempre falla; nunca se termina por búsqueda de
  PID. La aprobación conjunta se anuncia después de la limpieza. Si fallan pruebas
  y cierre se conserva ambos errores. No cambia fixture, migración ni identidad.
- Selector: instancia con key por slug para reiniciar opciones, selección, error y
  carga al cambiar de empresa; carga visible y selector deshabilitado mientras
  consulta. Respuesta exitosa limpia error; respuestas canceladas no actualizan.
- HTTP: errores inesperados reciben UUID de correlación en cuerpo/cabecera y un
  registro con tipo y códigos limitados. No registra el objeto de error, mensaje,
  stack, SQL, cuerpo, cookies ni parámetros. Los códigos funcionales permanecen.

Validación: 150 pruebas aprobadas en 14 archivos, todas unitarias/con mocks, incluidas
regresiones de permisos y asientos. No se iniciaron bases de datos, Next o navegadores.
Las pruebas nuevas del selector distinguen render estático y efectos simulados:
NO son componentes montados ni interacción DOM. happy-dom y react-test-renderer
no están instalados; no se instalaron dependencias.

TypeScript del workspace completo falla por errores en los runners auxiliares
sin seguimiento scripts/ci/c3c1-ui y c3c1-mysql, excluidos de esta entrega. La misma
configuración de TypeScript, sin esos directorios y sin emitir archivos, obtuvo
cero diagnósticos para aplicación y correcciones. No se editó tsconfig para ocultarlos.

Los ocho casos visuales/DOM siguen PENDIENTES. El cierre real de este runner
corregido necesita un futuro ensayo autorizado; los mocks no lo certifican.
La limitación conocida del cierre Next.js/detached-flush no se modifica aquí.

Excluir de cualquier staging posterior schema.sql, su respaldo y los directorios
c3c1-ui/c3c1-mysql existentes. No modificar asientos ni ampliar esta entrega a C3C-2B.
