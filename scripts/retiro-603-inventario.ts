import { createHash } from "node:crypto";

// Análisis offline de un JSON exportado; no abre conexiones ni genera DML.
const textos = ["constraint_schema", "table_schema", "table_name", "constraint_name", "column_name",
  "referenced_table_schema", "referenced_table_name", "referenced_column_name", "unique_constraint_schema",
  "match_option", "update_rule", "delete_rule"] as const;
type Texto = typeof textos[number];
export type FilaFk = Record<Texto, string> & {
  ordinal_position: number; position_in_unique_constraint: number; unique_constraint_name: string | null;
};
const identidad = (r: FilaFk) => JSON.stringify([r.constraint_schema, r.table_schema, r.table_name, r.constraint_name]);
export function resumirInventario603(entrada: unknown, esquema: string) {
  if (!esquema || !Array.isArray(entrada) || !entrada.length) throw Error("Inventario vacío o esquema ausente: bloqueo.");
  const filas: FilaFk[] = entrada.map((dato: unknown) => {
    if (!dato || typeof dato !== "object") throw Error("Fila de metadata inválida.");
    const r = dato as Record<string, unknown>;
    for (const campo of textos) if (typeof r[campo] !== "string" || !r[campo]) throw Error(`Metadata incompleta: ${campo}.`);
    for (const campo of ["ordinal_position", "position_in_unique_constraint"] as const) {
      if (!Number.isSafeInteger(r[campo]) || Number(r[campo]) < 1) throw Error(`Posición inválida: ${campo}.`);
    }
    if (r.unique_constraint_name !== null && (typeof r.unique_constraint_name !== "string" || !r.unique_constraint_name)) throw Error("Falta nombre de clave referenciada o NULL explícito.");
    if (r.referenced_table_schema !== esquema || r.referenced_table_name !== "flota_vehiculos") throw Error("Destino fuera del inventario aprobado.");
    return Object.fromEntries([...textos.map(k => [k, r[k]]), ["ordinal_position", r.ordinal_position],
      ["position_in_unique_constraint", r.position_in_unique_constraint], ["unique_constraint_name", r.unique_constraint_name]]) as FilaFk;
  });
  filas.sort((a, b) => identidad(a) < identidad(b) ? -1 : identidad(a) > identidad(b) ? 1 : a.ordinal_position - b.ordinal_position);
  const grupos = new Map<string, FilaFk[]>();
  for (const r of filas) { const k = identidad(r); const grupo = grupos.get(k) ?? []; grupo.push(r); grupos.set(k, grupo); }
  for (const grupo of grupos.values()) {
    const base = grupo[0];
    if (new Set(grupo.map(r => r.column_name)).size !== grupo.length) throw Error("Columna FK repetida: bloqueo.");
    grupo.forEach((r, i) => {
      if (r.ordinal_position !== i + 1) throw Error("Orden FK duplicado o incompleto: bloqueo.");
      for (const campo of ["referenced_table_schema", "referenced_table_name", "unique_constraint_schema", "unique_constraint_name", "match_option", "update_rule", "delete_rule"] as const) {
        if (r[campo] !== base[campo]) throw Error("Reglas inconsistentes dentro de una restricción: bloqueo.");
      }
    });
  }
  // Tuplas explícitas evitan depender del orden de propiedades de objetos del exportador.
  const manifiesto = filas.map(r => [r.constraint_schema, r.table_schema, r.table_name, r.constraint_name,
    r.ordinal_position, r.column_name, r.position_in_unique_constraint, r.referenced_table_schema,
    r.referenced_table_name, r.referenced_column_name, r.unique_constraint_schema, r.unique_constraint_name,
    r.match_option, r.update_rule, r.delete_rule]);
  const huella = createHash("sha256").update(JSON.stringify([2, esquema, manifiesto]), "utf8").digest("hex");
  return { version: 2 as const, esquema, cantidadColumnasFk: filas.length, cantidadRestriccionesFk: grupos.size,
    huella, manifiesto, retiroHabilitado: false as const };
}

export function compararInventarios603(aprobado: unknown, actual: unknown, esquema: string) {
  const a = resumirInventario603(aprobado, esquema), b = resumirInventario603(actual, esquema);
  return { coincide: a.huella === b.huella && a.cantidadColumnasFk === b.cantidadColumnasFk &&
    a.cantidadRestriccionesFk === b.cantidadRestriccionesFk, aprobado: a, actual: b, retiroHabilitado: false as const };
}
