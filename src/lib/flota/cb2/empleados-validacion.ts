import type { PoolConnection } from "mysql2/promise";
import { ErrorCB2, type Linea, type Seleccion } from "./model";
import { rows, type Contexto } from "./repository";
import { crearBuscadorEmpleados, type MetodoEmpleado } from "./empleados-coincidencias";

/** Bloqueos compartidos por PK, solo para los IDs elegidos, en orden estable.
 * El catálogo de unicidad es una lectura READ COMMITTED sin bloquear RRHH.
 * No usa el catálogo ni el nombre completo enviados por el navegador. */
export async function validarEmpleadosImportacion(c: PoolConnection, ctx: Contexto, seleccion: Seleccion, lineas: Linea[]) {
    const metodos = new Map<string, MetodoEmpleado | "NO_DECLARADO">();
    const elegidas = seleccion.filter(s => s.empleadoId != null);
    const elegidos = [...new Set(elegidas.map(s => s.empleadoId!))].sort((a, b) => a - b);
    const ids = new Set<number>();
    for (let i = 0; i < elegidos.length; i += 200) {
        const lote = elegidos.slice(i, i + 200);
        const activos = await rows(c, `SELECT id FROM empleados FORCE INDEX (PRIMARY) WHERE empresa_id=? AND estado='Activo' AND id IN (${lote.map(() => "?").join(",")}) ORDER BY id LOCK IN SHARE MODE`, [ctx.empresaId, ...lote]);
        activos.forEach(p => ids.add(Number(p.id)));
    }
    if (elegidos.some(id => !ids.has(id))) throw new ErrorCB2("Empleado no autorizado para esta empresa.", 403);
    const automatica = seleccion.some(s => s.metodoEmpleado === "EXACTA_NORMALIZADA" || s.metodoEmpleado === "TOKENS_COMPLETOS_UNICOS");
    // Después de esperar los bloqueos: un cambio de RRHH ya confirmado es visible.
    // Las altas/renombres de OTROS empleados posteriores a esta lectura no se serializan.
    const catalogo = automatica ? (await rows(c, "SELECT id,nombre FROM empleados WHERE empresa_id=? AND estado='Activo' ORDER BY id", [ctx.empresaId])).map(p => ({ id: Number(p.id), nombre: String(p.nombre ?? "") })) : [];
    const buscar = crearBuscadorEmpleados(catalogo);
    const nombres = new Map<string, Set<string>>();
    for (const l of lineas) if (l.clave) { const grupo = nombres.get(l.clave) ?? new Set<string>(); grupo.add(l.fila.textos.piloto); nombres.set(l.clave, grupo); }
    for (const s of seleccion) {
        if (s.empleadoId != null && !ids.has(s.empleadoId)) throw new ErrorCB2("Empleado no autorizado para esta empresa.", 403);
        const metodo = s.metodoEmpleado ?? (s.empleadoId == null ? "SIN_ASIGNACION" : "NO_DECLARADO");
        if (metodo === "EXACTA_NORMALIZADA" || metodo === "TOKENS_COMPLETOS_UNICOS") {
            const originales = nombres.get(s.candidato);
            if (!originales?.size || [...originales].some(original => { const match = buscar(original); return match.propuesta?.id !== s.empleadoId || match.metodo !== metodo; }))
                throw new ErrorCB2("La coincidencia automática del empleado cambió o es ambigua. Revisa el catálogo y vuelve a confirmar, o elige manualmente.");
        }
        metodos.set(s.candidato, metodo);
    }
    return metodos;
}
