# C3C-15B: revision de cierre del bloqueo NTFS

Fecha: 2026-10-31 (America/Guatemala). PR #541. Base revisada: `9ce37afc94d0f85538de10a5a0e347da290ac82a`.

**Resultado: correccion tecnica validada; aceptacion integral PENDIENTE.** No autoriza merge ni despliegue. Decision reservada a auditoria independiente. Este informe reemplaza las afirmaciones de cierre del informe historico REPORT.md.

## Causa y correccion

Ambas entradas creaban un DirectorySecurity nuevo, fijaban propietario con SetOwner y lo persistian mediante Set-Acl. Esa ruta solicita/persiste secciones de seguridad adicionales y fallo por SeSecurityPrivilege en Windows de aceptacion. No se requiere cambiar propietario para crear el laboratorio. La ejecucion anterior que declaraba ACL aprobada no acreditaba compatibilidad con el token de aceptacion.

La implementacion compartida usa DirectoryInfo.Create(DirectorySecurity) de .NET Framework en PowerShell 5.1: crea el directorio con DACL protegida desde el inicio, exactamente FullControl para el SID del operador y SYSTEM, con herencia a archivos y carpetas. Windows asigna el propietario. No usa Set-Acl, SetOwner, SACL, elevacion ni cambios de politica. Lab.ps1 invoca el mismo helper Node que la alternativa lab.mjs; initialize y verify tambien lo ejecutan antes de escribir o leer secretos.

Un directorio existente debe tener propietario igual al operador, DACL protegida y exactamente las dos reglas esperadas. No se corrigen ACL inseguras automaticamente. Se rechazan reparse points en la ruta, ACL expuestas y propietarios ajenos en descendientes. El padre nuevo tambien nace con DACL privada; un padre existente con escritura ajena (incluido DELETE_CHILD) se rechaza, exceptuando Administrators como actor privilegiado fuera del modelo de amenaza. No se modifican ACL existentes. Se relee la ACL y se realiza una prueba real de crear/escribir/leer/borrar un archivo sin secretos. La lectura anonima tambien se probo con impersonacion nativa. Una DACL exacta acredita los permisos de SYSTEM; no se inicio un proceso como SYSTEM.

El comando Credentials de ambas entradas queda deshabilitado: devuelve C15B_CREDENTIALS_CONSOLE_DISABLED. Ninguna clave se imprime en consola. No se publican private.json, logs de Next, cookies ni JWT.

## Matriz vigente

| Prueba | Resultado | Evidencia / limite |
|---|---|---|
| Directorio nuevo y existente seguro, persistencia de sentinel | PASS | safety.test.mjs; creacion con DACL atomica y repeticion sin sobrescribir |
| Directorio existente heredado, Everyone, deny, flags incorrectos | PASS | Rechazo sin escribir secretos ni reparar ACL |
| Junction, archivo en lugar de directorio, archivo hijo expuesto | PASS | Rechazo conservando destino/contenido sintetico |
| Acceso no autorizado | PASS | Token anonimo real recibe UnauthorizedAccessException; sin cuenta adicional |
| Propietario inesperado, rama de rechazo | PASS (simulada) | Se sustituye solo el SID esperado en la fuente del test; NO acredita un propietario extranjero real |
| Propietario realmente ajeno | PENDIENTE | Requiere fixture creado por otra cuenta; no se cambia propietario ni se solicita privilegio para fabricarlo |
| Fallo de PowerShell despues de crear | PASS | Fallo inyectado en copia de la fuente; carpeta queda privada, vacia y validable |
| Bateria de seguridad | PASS | 18/18; incluye las simulaciones expresamente identificadas arriba |
| Token de ejecucion / runtime | PASS | Administrador=False; Windows PowerShell 5.1.26100.9711 |
| MariaDB exclusivamente sintetica nueva | PASS | integration-evidence.json; hash fijado, loopback, puertos efimeros propios; nunca 43306 |
| Prepare interno, Verify, Start | PASS | Inicializador y control reales sobre instancia nueva; 101 controles SQL con errores=0 |
| Segundo Prepare | PASS | C15B_STATE_EXISTS y comparacion byte a byte de private.json intacto |
| Cuatro roles con password y cookie reales | PASS HTTP | Next real; no JWT inyectados; seleccion de empresa y Calendario |
| Constancias y autorizacion | PASS HTTP | Revisor 200; preparador/resolutor/lector 403 |
| Exportacion XLSX | PASS HTTP limitado | HTTP 200 y firma ZIP; no acredita contenido completo ni apertura visual |
| Ausencia de contabilizacion indebida | PASS | Escritura bloqueada 403, cantidad de asientos antes/despues igual; semilla verifica estado formal PENDIENTE y contabilizado=false |
| Stop y reinicio Next | PASS | SELECT 1 sigue funcionando despues de ambas paradas de Next |
| Wrapper PS 5.1 | PASS parser / PENDIENTE interactivo | Cero errores parser; -File rechazado por politica efectiva (UnauthorizedAccess) |
| Entrada Node | PASS helper y rechazo no TTY / PENDIENTE prompt | C15B_INTERACTIVE_REQUIRED sin terminal interactiva; inicializador/control compartidos probados |
| Regresion relevante | PASS | 43/43, cuatro archivos listados abajo |
| TypeScript / ESLint del alcance | PASS | Exit 0 |
| Diferencias / alcance | PASS | git diff --check; solo scripts de laboratorio y docs/qa/c3c15b |
| Navegador y Excel | PENDIENTE | Conector informa `The browser access host is unavailable`; no se declara aceptacion visual |

La integracion detiene primero Next y acredita que MariaDB sigue viva. Su finally cierra posteriormente SOLO su MariaDB desechable mediante handle original. No se modifica ni se detiene ninguna instancia manual/existente. No hubo SQL en Hostinger, servicios de Windows, migraciones nuevas ni cambios en src, sql o configuraciones productivas.

## Comandos reproducibles

En un checkout limpio de la rama del PR, con dependencias y binarios portables ya instalados:

```powershell
node --test scripts/ci/c3c15b/safety.test.mjs
node scripts/ci/c3c15b/integration.mjs --run-owned-instance
npx.cmd vitest run src/lib/contabilidad/precontable.test.ts src/lib/contabilidad/expediente.test.ts src/lib/contabilidad/expediente-http.test.ts src/lib/tenant-calendario.test.ts
npx.cmd tsc --noEmit
npx.cmd eslint scripts/ci/c3c15b
git diff --check
git diff 9ce37afc94d0f85538de10a5a0e347da290ac82a HEAD
git diff 3737a5891e33b1349ce867cce816f1cc0e1925e3 HEAD
```

Diff completo tambien disponible en https://github.com/ashp98072-dot/plataforma-sitsa/pull/541/files y https://github.com/ashp98072-dot/plataforma-sitsa/pull/541.diff. El SHA publicado se registra en el PR para evitar una referencia circular dentro del propio commit.

## Intervencion manual exacta pendiente

1. Otra cuenta local crea una carpeta de fixture nueva bajo el patron de laboratorio permitido, conservando su propiedad y concediendo al operador solo el acceso necesario para observarla. El operador ejecuta secureDirectory y acredita C15B_PRIVATE_ACL, sin escritura ni cambio de propietario. No cambiar propietarios de carpetas existentes ni usar elevacion para esta prueba. La simulacion actual no sustituye este caso.
2. Para el wrapper completo, usar una consola interactiva de Windows PowerShell 5.1 en un entorno cuya politica vigente permita Lab.ps1 (por ejemplo, version firmada por un firmante ya confiable). No cambiar la politica ni usar Bypass. Si esa condicion no existe, conservar PENDIENTE para el wrapper y usar Node en una consola TTY.
3. Aprovisionar una instancia NUEVA, exclusivamente sintetica, conforme al README. No reutilizar ni resetear la instancia manual existente en 43306. Si ese puerto/directorio ya esta ocupado, el operador debe preparar un entorno Windows aislado distinto. Ejecutar Prepare introduciendo la clave local sin eco; Verify; Start; repetir Prepare y comprobar rechazo sin cambio del archivo privado.
4. Leer los cuatro usuarios sinteticos desde el archivo privado en un editor local sin transcript/capturas y autenticar cada uno en el navegador local. Ejecutar la matriz de ../c3c15/MANUAL-WINDOWS.md: tres escenarios, bloqueantes, vigencia e historial, confirmaciones y cambios de empresa. Capturar solo pantallas sin secretos. Descargar JSON/XLSX por botones y abrir el XLSX en Excel; verificar contenido/formato e impresion. Registrar caso por caso PASS/FAIL, fecha y operador.
5. Ejecutar Stop; despues Verify para acreditar MariaDB aun abierta. No apagar otras instancias ni borrar directorios privados para repetir.

## Riesgos residuales

La comprobacion de ruta/ACL no es una sandbox frente a un administrador hostil ni frente al mismo usuario autorizado que modifique archivos concurrentemente. El rechazo de ACL heredadas es intencional: una carpeta antigua insegura no se adopta aunque este vacia. El padre y el propietario del directorio nuevo se verifican (incluyendo rechazo de padre escribible por Everyone en el test 18); un fallo anterior a terminar no habilita Prepare. Las pruebas con otro propietario, prompts interactivos y aceptacion visual siguen pendientes; por ello no se declara cierre funcional definitivo ni aptitud para merge.
