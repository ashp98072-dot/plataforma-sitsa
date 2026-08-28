# Milenium → Contabilidad: fase 1, revisión en seco

## Decisión confirmada por el usuario

| Origen | Código empresa | Carpeta | Tratamiento |
| --- | --- | --- | --- |
| KT | 01 | BASES001 | Primera empresa a mapear |
| Mónaco actual | 08 | BASES008 | Separada de KT |
| Mónaco histórico | 00 | BASES000 | No combinar automáticamente con 08 |

Mónaco 00 y 08 tienen períodos solapados. No sumar saldos ni deduplicar por
número de cuenta o partida entre bases. Conservar siempre la identidad origen.
La selección de carpeta se contrasta con código y nombre en s02.dbf. Esa
comprobación no demuestra por sí sola que alguien no haya intercambiado carpetas:
la copia y su correspondencia con el sistema origen requieren validación humana.

## Herramienta local

Desde la raíz del repositorio:

```powershell
node scripts/milenium/revisar-cuentas.mjs 'D:\COPIA-LOCAL\Milenium2000' KT
node scripts/milenium/revisar-cuentas.mjs 'D:\COPIA-LOCAL\Milenium2000' MONACO
node scripts/milenium/revisar-cuentas.mjs 'D:\COPIA-LOCAL\Milenium2000' MONACO_HISTORICO
node --test scripts/milenium/cuentas.test.mjs
```

Usar una copia estable fuera del repositorio, con Milenium cerrado al obtenerla.
La herramienta abre exclusivamente s02.dbf y co01.dbf en lectura. No importa DB,
no carga .env, no ejecuta EXE/APP, no tiene SQL, no escribe archivos ni usa red.
Imprime un resumen sin nombres/códigos de cuentas ni registros personales, con
huellas SHA256 para comparar la fuente. No subir bases, PDFs, FPT, reportes reales
ni ZIP al repositorio. Las pruebas generan buffers ficticios en memoria.

Lector deliberadamente limitado a VFP 0x30 y Windows-1252 (marca 0x03), observados
en este catálogo. Otros formatos/campos se rechazan, no se convierten a ciegas.
Se excluyen registros marcados como borrados; cuenta inactiva no equivale a borrada.
Se comprueba modificación durante cada lectura, pero no existe snapshot atómico
entre archivos: una lectura exitosa no reemplaza un respaldo consistente.

## Mapeo propuesto, todavía sin escritura

| Milenium co01 | Plataforma cont_cuentas | Regla |
| --- | --- | --- |
| CODIGO_CTA | codigo | Texto, conservar ceros iniciales; límite 40 |
| NOMBRE_CTA | nombre | Windows-1252 a Unicode; límite 200 |
| NIVEL_CTA | nivel | Entero positivo; falta validar jerarquía |
| LINACTIVA_ | activa | Invertir únicamente booleano conocido |
| TIPO_CTA | tipo | Pendiente de homologación; NO asumir significado de 1–5 |
| CTACOM_CTA, MULTIP_CTA | Sin equivalencia aprobada | Confirmar semántica contable |
| Empresa/base origen | Identidad contable destino | Pendiente decisión de modelo |

Las equivalencias son propuestas, no una autorización de importación. No existe
todavía salida de filas importables, botón web ni cambio de funcionalidad actual.
`listo_para_importar` permanece falso incluso si las verificaciones pasan. El
resultado de proceso 0 solo significa que pudo analizarse el archivo, no que sea
apto para migrar. La detección normalizada de duplicados es orientativa; falta
comparar contra collation y datos del servidor destino.

## Bloqueos previos a importar

1. El tenant operativo kt-monaco agrupa dos empresas de origen. Actualmente
   cont_cuentas tiene unicidad (empresa_id, codigo); asignar ambas al mismo tenant
   mezclaría cuentas y asientos. Definir entidad/libro contable separado o tenants
   separados sin alterar el uso compartido de Operaciones. No resolver con prefijos
   improvisados ni modificar empresas existentes durante esta fase.
2. Homologar tipos, naturaleza y cuentas de movimiento con el responsable contable.
   No inferir debe/haber ni signos a partir de un código numérico.
3. Fortalecer asientos antes de movimientos: el endpoint actual inserta cabecera y
   líneas mediante llamadas separadas; necesita transacción y validación de que
   todas las cuentas pertenecen a la entidad autorizada.
4. Resolver límites temporales entre Mónaco histórico y actual con conciliación,
   sin sumar dos veces el mismo período. Definir saldos iniciales vs histórico.

## Etapas siguientes (PR separados)

2. Modelo de identidad contable, reglas de cuentas/períodos y transacciones, con
   migración aditiva propuesta si fuera necesaria; no ejecutar sin autorización.
3. Vista previa de catálogo, homologaciones y comparación destino, seguida de
   importación idempotente aprobada por empresa. Conservar ID/base de origen.
4. Saldos/partidas y bancos por lotes controlados: conciliar debe/haber, saldos y
   reportes origen/destino. Registrar auditoría y rechazos, probar rollback/reintento.
5. Cuentas por cobrar/pagar y reportes; coordinar con Facturación para reutilizar
   clientes/documentos y evitar asientos duplicados.

Esta fase no homologa tipos, migra datos, cambia permisos ni toca Facturación,
Planillas, TMS o evidencia de viajes. No requiere migración SQL.
