# Backend CB2 de Combustibles (continuacion del PR #507)

Base: main 8cf7efc2995fd9562ec1dc8fd4f58dd073e2b7d8, que ya incluye PR #507.
No cambia SQL, columnas, indices, FK ni CHECK. No agrega interfaces ni Actions.
Solo escribe las cuatro tablas CB2 y la auditoria transaccional existente.
No llama al bootstrap de esquema ni a migraciones. No escribe cargas/vales,
conciliaciones C2B/C2C, vehiculos, CxP o facturacion financiera.

## Endpoints

Prefijo: `/api/empresas/[slug]/flota/combustible/cb2`.
Todos requieren sesion y acceso a la empresa del slug; tenant/actor nunca se toman
como autoridad del body. Respuestas private/no-store y errores sin SQL/celdas/rutas.

| Metodo / ruta | Funcion / permiso |
| --- | --- |
| POST /preview | Analiza HALEL/SHELL y firma decisiones durante 15 minutos; conciliar |
| POST /confirmar | Confirma seleccion parcial y todos los ORIGEN; conciliar |
| POST /reanudar | Relee Excel privado, revalida candidatos completos y agrega RESOLUCION; Admin |
| POST /asociar | Crea/reutiliza factura y asocia lote atomico, incluso multicabecera; conciliar |
| GET /importaciones | Historial, revision y resumen operativo; ver |
| GET /consumos | Consumos tenant y estado documental generado; ver |
| GET /facturas | Documentos operativos existentes; ver |
| GET /importaciones/[id]/filas | Evidencia original y diario append-only; ver |
| GET /importaciones/[id]/archivo | Descarga privada attachment con hash verificado; ver |

Lecturas paginadas: `?despues=0&limite=100` (cursor id ascendente; limite 1..500).
No se expone archivo_ruta. La lectura historica no requiere comparticion actual
para ver consumos que ya pertenecen al tenant.

## Peticiones

Preview/confirmar usan multipart acotado por bytes reales: file (.xlsx), proveedorId,
perfil (HALEL/SHELL), moneda (GTQ/USD explicita), seleccion (JSON de objetos
`{candidato: "sha256 de identidad", vehiculoId: 123}`). IDs numericos positivos.

1. Preview inicial puede usar seleccion `[]` para obtener candidatos. No garantiza
   ausencia de previos: la respuesta lo indica; el historial se revalida al confirmar.
2. Elegir candidatos/unidades accesibles y repetir preview con la seleccion final.
3. Confirmar con el MISMO archivo, perfil, moneda y seleccion, mas token del paso 2
   y clave aleatoria ASCII `[A-Za-z0-9_-]{16,64}`. Conservar clave y peticion para
   reintentos. Las decisiones se ordenan por identidad antes de firmar.
4. Se registran todas las posiciones reales (incluidas cabeceras, invalidas,
   ignoradas y omitidas). Los candidatos no seleccionados siguen pendientes.
   El mismo archivo/hash existente devuelve su ID y requiere reanudacion explicita.

Reanudar usa JSON estricto:

```json
{"proveedorId":1,"importacionId":123,"revision":1,"clave":"REANUDAR_DEMO_0001","seleccion":[{"candidato":"<64 hex>","vehiculoId":123}],"motivo":"Unidad verificada"}
```

No recibe filas editadas ni otra copia del archivo. Usa moneda/versiones originales,
comprueba hash, compara los originales y agrega eventos para todas las apariciones
seleccionadas. Una revision vieja da 409 salvo recuperacion de la misma operacion.
La capacidad resolver_importaciones todavia no existe: solo Admin puede reanudar;
conciliar/revisar no heredan esa facultad. Tampoco Admin puede forzar conflictos.

Asociar usa JSON estricto:

```json
{"proveedorId":1,"clave":"ASOCIACION_DEMO_0001","documento":{"serie":"SERIE","numero":"000001","moneda":"GTQ","fecha":null,"total":null},"consumos":[123,124],"revisiones":[{"id":10,"revision":1},{"id":11,"revision":2}],"motivo":"Documento verificado"}
```

Revisiones enumera exactamente las importaciones de origen del lote. Para utilizar
una factura existente, enviar su identidad textual completa, obtenida de GET
/facturas; no mezclar IDs de venta/CxP. Fecha documental ISO y total decimal STRING
son opcionales; nunca se infieren de fecha de consumo o suma de lineas. La moneda
siempre debe coincidir. Un documento existente incompatible no se sobrescribe.
Misma factura produce evento SIN_CAMBIO; otra factura revierte el lote entero.
No hay editar, reasignar, desasociar, borrar ni crear facturas sin procedencia.
Una importacion nueva con consumo reutilizado pendiente no lo asocia de manera
implicita: se utiliza /asociar con revisiones vigentes.

La respuesta de escritura contiene eventos (id, importacionId, revision, resultado,
consumoId), reconstruidos del diario. Un reintento no usa el resumen mutable ni
agrega auditoria. HTTP 400: contrato invalido; 403: acceso; 404: ambito inexistente;
409: conflicto/revision/digest/evidencia; 413: limite; 503: entorno o resultado
transaccional incierto. Ante 503 incierto repetir EXACTA clave/peticion, no inventar
otra clave ni asumir rollback. Puede recuperarse una confirmacion ya persistida
sin recibo vigente; una confirmacion nueva siempre necesita recibo valido.

## Reglas y transacciones

- Parsing y defensas ZIP/XML/formulas existentes. Un callback opcional informa
  campos invalidos sin cambiar el JSON ni semantica del preview v2 existente.
  CB2 separa incidencias documentales de operativas por campos estructurados,
  no por strings de motivos. Documento ausente/inseguro permite operacion segura
  pendiente; operacion invalida o documentos fiables contradictorios bloquean
  TODO el candidato, independientemente del orden de las apariciones.
- Payload v1: tupla JSON [1, vale_norm, fecha, placa, piloto normalizado, producto
  normalizado, galones, precio, monto, kilometraje, kilometraje_texto, moneda].
  Decimales en strings canonicos, NULL distinto de cero/vacio; huella SHA256.
  Excluye factura, archivo, perfil y vehiculo elegido. Compara payload ademas de
  hash y todas las versiones/consumos previos por identidad/vale.
- Evidencia historica HALEL C2B coincidente queda bloqueada; no se promueve ni se
  certifica ausencia en legacy sin identidad. No hay override de un vale previo
  con otra operacion o de una unidad elegida incompatible.
- Maximo cuatro transacciones CB2 simultaneas por proceso (cola acotada a 32):
  reserva conexiones del pool para revalidar el guard central.
- Conexion dedicada, READ COMMITTED, proveedor FOR UPDATE; revalida guard tras
  esperar. Importaciones por ID, documentos existentes por ID, vehiculos y acceso
  compartido por ID, consumos por ID. Todas las escrituras CB2 usan este protocolo.
- STRICT_ALL_TABLES e innodb_strict_mode por sesion y restaurados. Rechaza FK/CHECK
  apagados, nunca los deshabilita. Auditoria en la misma conexion; fallo => rollback.
  Deadlock/timeout: hasta tres intentos con mismo plan/clave. Commit/rollback incierto:
  no retry automatico, conexion destruida y evidencia preservada.
- Diario exige N eventos con ordinales 1..N, mismo actor/digest/total y namespace
  empresa/proveedor/tipo/clave. Recuperacion precede a revision. No IGNORE/UPSERT.
- Evidencia privada bajo empresas/<id>/flota/cb2, UUID y apertura exclusiva. Valida
  tenant/ruta/directorio real, rechaza symlinks hacia otra empresa, hash antes de
  reanudar/descargar. Compensa solo archivo NUEVO tras rollback conocido/carrera
  perdida; nunca borra evidencia tras commit incierto. Caida de proceso puede dejar
  huerfanos: reconciliacion posterior autorizada, sin limpieza global automatica.

## Pruebas y reproduccion

Las pruebas de motor son opt-in: sin CB2_TEST_PIPE se omiten. El runner crea un
MariaDB 11.8.9 portable propio con TCP deshabilitado, datadir UUID y named pipe
cb2-508-UUID. La suite rechaza otras pipes/versiones/datadirs; no carga .env ni
credenciales. Crea bases sinteticas UUID, aplica SOLO el DDL de prueba en esas
bases y las elimina al finalizar. Cierra el servidor propio. No usa respaldos.
No debe apuntarse esta suite a una instancia compartida, Hostinger o produccion.

PowerShell, desde raiz de checkout (Node 20+, npm ci previamente):

```powershell
New-Item -ItemType Directory -Force .lab-runtime | Out-Null
curl.exe --fail --location --output .lab-runtime/mariadb-11.8.9-winx64.zip https://archive.mariadb.org/mariadb-11.8.9/winx64-packages/mariadb-11.8.9-winx64.zip
Get-FileHash -Algorithm SHA256 .lab-runtime/mariadb-11.8.9-winx64.zip
# Exigir 830c46727d9278eae212ae3eca44eeb9e71b2a68704e95f344a64fba7b1963f5
Expand-Archive -LiteralPath .lab-runtime/mariadb-11.8.9-winx64.zip -DestinationPath .lab-runtime
node scripts/ci/combustibles-pr508-backend/run-windows.mjs --run-isolated
npx vitest run src/lib/flota/cb2 --maxWorkers=1
npx tsc --noEmit --incremental false
npx eslint src/lib/flota/cb2 src/lib/flota/combustible-importacion-v2.ts 'src/app/api/empresas/[slug]/flota/combustible/cb2'
```

CB2_MARIADB_HOME opcional permite reutilizar esa distribucion local verificada;
el ZIP oficial debe estar al lado de su directorio. El runner verifica su SHA.
Evidencia local en .lab-runtime/backend-UUID: inicializacion, log, pruebas y cierre.
El manifiesto publicado de esta entrega enlaza resultados y hashes de fuentes.

Limites: no se probo UI nueva (no existe), despliegue Hostinger, volumen maximo de
10000 eventos ni fallos reales de red durante COMMIT; estos ultimos usan doubles.
No se ejecuto build conectado a servicios. La estructura productiva ya aprobada
por PR #507 y el almacenamiento persistente privado son precondiciones de despliegue.
Permanece pendiente auditoria independiente antes de desplegar o hacer merge.

## Resultado de esta entrega (2026-10-22)

138 pruebas dirigidas de unidad/regresion PASS y 16 casos reales MariaDB 11.8.9
PASS; las 15 incidencias canonicas dieron cero tras cada caso. TypeScript, ESLint,
node --check y git diff --check PASS. No hay servidores MariaDB de prueba activos.
Evidencia: [summary.json](evidence/combustibles-pr508-backend/summary.json), salida
del motor, cierre y hashes normalizados LF de fuentes en el mismo directorio.

## Correccion de auditoria: moneda original de reanudacion

Revision sobre SHA 915f110498ffb876e1d862d35244103f32933e9f. La moneda ya no
se obtiene de consultar(filas, limite=1). Reanudar lee TODOS los ORIGEN de empresa,
proveedor e importacion explicitos, sin LIMIT/OFFSET, ordenados por hoja/fila/id.
Exige evento ORIGEN de revision 1/CONFIRMAR, marca y referencia originales validas,
JSON de decision version 1 con estructura completa, datos_origen con posicion
coincidente y una unica moneda GTQ/USD entre todos los originales. Ausencia,
version desconocida, monedas mezcladas o JSON no certificable rechazan con 409.
Los eventos posteriores RESOLUCION/ASOCIACION_FACTURA no son fuente de moneda.

Antes de escribir vuelve a leer los mismos originales con FOR UPDATE y a validar
su coherencia y moneda respecto al analisis. La verificacion de cantidad y la
comparacion del archivo privado/originales permanecen vigentes. El resumen lee
el diario completo ordenado por revision/id; no pagina evidencia de reanudacion.
La paginacion publica GET /filas queda limitada a consultas del usuario y no se
utiliza como fuente de la reanudacion. Recuperar una operacion ya confirmada
sigue reconstruyendo su resultado del diario antes de revisar revision/evidencia.

Pruebas de esta correccion: 46 dirigidas PASS y 19 casos MariaDB 11.8.9 aislado
PASS (incluidos los 16 anteriores). Casos nuevos: multiples eventos hasta
revision 4 y otro proveedor con moneda distinta, moneda incoherente en un
original posterior, y JSON valido para SQL pero sin estructura certificable.
Snapshots confirman rechazo sin nuevas escrituras. Se evaluan las mismas
15 incidencias canonicas tras cada caso: todas cero. TypeScript y ESLint PASS.
Evidencia de esta revision separada de la entrega inicial:
[evidence/combustibles-pr508-backend/revision-originales/](evidence/combustibles-pr508-backend/revision-originales/).
No cambia esquema, permisos, endpoints ni contratos SQL. Sin produccion ni merge.