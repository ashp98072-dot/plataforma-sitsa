// Metadatos ficticios para pruebas unitarias; no sustituye una prueba MariaDB.
export const indicesC2b = [
  { tabla: "cont_cuentas", nombre: "uq_cuenta_entidad", columnas: "empresa_id,entidad_id,codigo" },
  { tabla: "cont_asientos", nombre: "uq_asiento_entidad", columnas: "empresa_id,entidad_id,numero" },
];
export const fksC2b = [
  ...[["cont_cuentas", "cuenta"], ["cont_asientos", "asiento"], ["cont_cxc", "cxc"], ["cont_cxp", "cxp"]].map(([tabla, nombre]) => ({
    tabla, nombre: "fk_cont_" + nombre + "_entidad", referencia: "cont_entidades", columnas: "empresa_id,entidad_id", destino: "empresa_id,id",
  })),
  ...[["cont_asientos", "asiento"], ["cont_cuentas", "cuenta"]].map(([referencia, nombre]) => ({
    tabla: "cont_asiento_detalle", nombre: "fk_cont_detalle_" + nombre + "_ambito", referencia,
    columnas: "empresa_id,entidad_id," + nombre + "_id", destino: "empresa_id,entidad_id,id",
  })),
];
