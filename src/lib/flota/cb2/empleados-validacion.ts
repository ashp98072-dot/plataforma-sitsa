import type { PoolConnection } from "mysql2/promise";
import { ErrorCB2, type Linea, type Seleccion } from "./model";
import { rows, type Contexto } from "./repository";
import { crearBuscadorEmpleados, type MetodoEmpleado } from "./empleados-coincidencias";

/** Una lectura por operación, compartida por todos los consumos y apariciones.
 * No usa el catálogo ni el nombre completo enviados por el navegador. */
export async function validarEmpleadosImportacion(c: PoolConnection, ctx: Contexto, seleccion: Seleccion, lineas: Linea[]) {
    const metodos = new Map<string, MetodoEmpleado | "NO_DECLARADO">();
    const elegidas = seleccion.filter(s => s.empleadoId != null);
    const catalogo = elegidas.length ? (await rows(c, "SELECT id,nombre FROM empleados WHERE empresa_id=? AND estado='Activo' ORDER BY id FOR UPDATE", [ctx.empresaId])).map(p => ({ id: Number(p.id), nombre: String(p.nombre ?? "") })) : [];
    const ids = new Set(catalogo.map(p => p.id)), buscar = crearBuscadorEmpleados(catalogo);
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
