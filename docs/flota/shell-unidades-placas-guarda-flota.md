# Shell: placas, vehículo canónico y alta de unidades externas — qué existía y qué faltaba

**Estado: IMPLEMENTADO y VERIFICADO TÉCNICAMENTE (MariaDB desechable). Sin migraciones, sin fusiones, sin producción.**

## Qué ya existía (se reutiliza, no se reconstruye)
- **Identificar por placa:** `placaComparable` / `identificarPlaca` (exacta, abreviada sin prefijo, ambigua) sobre el catálogo CB2; la vista previa clasifica cada fila (`unidad-shell.ts`).
- **Vehículo canónico:** el catálogo CB2 oculta los vehículos absorbidos (`catalogoSinAlias`) y `service.ts` resuelve cualquier selección al canónico (`resolverUnidadCanonica`); los filtros de consumos abarcan los IDs equivalentes. Los consumos conservan el ID original (trazabilidad).
- **Unidades propias vs externas:** la unidad INTERNA es un vehículo de Flota (ID > 0); la EXTERNA es una identidad en `flota_cb2_externos_unidades` (ID < 0). Un vehículo propio nuevo se da de alta en Flota (placa comparable única por empresa); desde el vale solo se registra una unidad externa, eligiendo VEHÍCULO/MOTOCICLETA (`UnidadShellVale`, referencia estable `shell:<placa>`).
- **Placas sospechosas:** `placasPendientes` excluye textos sin forma de placa (p. ej. «CANECA») y placas casi iguales a una conocida.

## Qué faltaba
La comprobación «esa placa ya existe» de la unidad externa estaba **solo en el navegador** y contra el catálogo operativo (vehículos **activos**, accesibles y **sin alias**). `registrarUnidad` (servidor) solo comparaba contra otras unidades externas. Por eso se podía registrar como externa —duplicando la unidad en dos catálogos y repartiendo sus consumos— una placa que ya era de Flota si el vehículo estaba **inactivo, en taller, compartido** o **absorbido por una fusión**, o si se llamaba a la API directamente o el catálogo estaba desactualizado.

## Qué se implementó
`src/lib/flota/cb2/terceros-flota.ts` → `exigirPlacaNoEsFlota`, llamada por `registrarUnidad` dentro de su transacción, tras la reutilización por referencia y antes de crear:
- Revisa **todos** los vehículos visibles para la empresa (propios y compartidos), sin filtrar por activo/estado y **sin ocultar los absorbidos** (a propósito no usa `predicadoVehiculoAccesible`, que con las fusiones habilitadas los excluye).
- Placa **exacta o abreviada** de un vehículo de Flota → **409**, sin posibilidad de confirmar; el mensaje identifica el vehículo, avisa si no es operable (inactivo/en taller) y, si fue fusionado, indica el **vehículo canónico**.
- Placa **casi igual** (un carácter) → 409 salvo `confirmarCoincidencias` expreso (mismo criterio que las coincidencias con otras unidades externas).
- No cambia el comportamiento de placas nuevas, la idempotencia por referencia ni las coincidencias entre externas.

## Fuera de alcance / pendiente
- El alta de un vehículo **propio** desde la importación no se añade (requiere los datos de ficha de Flota); se registra en Flota y luego se elige en el vale.
- La interfaz sigue ofreciendo «confirmar como externa» para placas que el catálogo operativo no conoce; el servidor ahora la rechaza con el motivo (mostrado en pantalla). Anticipar ese aviso en la UI requeriría exponer las placas no operables en el catálogo.
- No se ejecuta ninguna fusión ni migración; no se activa ninguna bandera.
