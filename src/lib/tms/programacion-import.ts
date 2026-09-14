import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { listarDisponibilidadVehiculos } from "@/lib/operaciones/disponibilidad";
import type { FilaProgramacionExcel } from "./programacion-import-excel";
import {
  finViajeDesdeInput,
  inicioViaje,
  mensajeConflicto,
  primerConflictoTraslape,
  type IntervaloViaje,
  type RecursoAValidar,
} from "./disponibilidad-traslapes";

/**
 * TMS-IMPORTACION-PROGRAMACION-EXCEL (PR 3 de 6) — validaciones PURAS
 * entre filas del mismo Excel: filas duplicadas y traslapes de piloto/
 * auxiliar/unidad DENTRO del lote (fila contra fila del propio archivo).
 * Ver docs/TMS-IMPORTACION-PROGRAMACION-EXCEL-{0,1,2}-*.md.
 *
 * Nada de esto consulta BD. Todavía NO se resuelve ruta/cliente/piloto/
 * auxiliar/unidad contra catálogo, NO se valida tarifa vigente, NO se
 * compara contra viajes YA EXISTENTES en BD (eso es
 * `primerConflictoTraslape` de disponibilidad-traslapes.ts, y es alcance
 * de una fase posterior — PR 4/5). Este módulo reutiliza de ese mismo
 * archivo únicamente sus dos funciones puras de combinación de fecha/hora
 * (`inicioViaje`/`finViajeDesdeInput`) y el tipo `IntervaloViaje` — nunca
 * `primerConflictoTraslape` en sí (esa sí toca BD).
 */

/** Comparación case-insensitive de códigos/placas — mismo criterio que normalizarCodigoEmpleado() en rutas-import.ts. */
function normalizarClave(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLocaleLowerCase("es-GT");
}

// ---------------------------------------------------------------------
// Filas duplicadas dentro del mismo archivo
// ---------------------------------------------------------------------

/**
 * Clave normalizada aprobada: fechaSalida + horaSalida + ruta + piloto +
 * unidad. La MISMA ruta puede repetirse varias veces en el archivo si
 * cambia piloto y/o unidad — por eso piloto/unidad forman parte de la
 * clave, no solo la ruta.
 */
export function claveDuplicadoFila(fila: FilaProgramacionExcel): string {
  return [
    fila.fechaSalidaExcel ?? "",
    fila.horaSalidaExcel ?? "",
    normalizarClave(fila.codigoRutaExcel),
    normalizarClave(fila.pilotoCodigoExcel),
    normalizarClave(fila.placaExcel),
  ].join("|");
}

/**
 * Una fila sin fecha/ruta/piloto/placa (ya reportado como error sintáctico
 * propio en el PR 2) no aporta una clave de duplicado significativa —
 * comparar filas rotas entre sí produciría falsos positivos (dos filas
 * distintas, ambas con estos campos vacíos, no son "la misma fila
 * repetida"). Se excluyen de la detección de duplicados, sin que eso
 * oculte sus propios errores (esos ya vienen en erroresSintacticos).
 */
function tieneClaveDuplicadoCompleta(fila: FilaProgramacionExcel): boolean {
  return Boolean(
    fila.fechaSalidaExcel && fila.codigoRutaExcel && fila.pilotoCodigoExcel && fila.placaExcel,
  );
}

export type FilaDuplicadaEnLote = {
  filaExcel: number;
  /** Otras filas del mismo archivo con la MISMA clave (fecha+hora+ruta+piloto+unidad). */
  duplicadaCon: number[];
};

/**
 * Detecta filas EXACTAMENTE duplicadas dentro del mismo archivo (misma
 * clave normalizada). Devuelve una entrada por cada fila involucrada en
 * un grupo de 2+ duplicados (ambas/todas se reportan, no solo la
 * "segunda"), ordenadas por número de fila de Excel. Si no hay
 * duplicados, devuelve `[]`.
 */
export function detectarFilasDuplicadas(filas: FilaProgramacionExcel[]): FilaDuplicadaEnLote[] {
  const grupos = new Map<string, number[]>();
  for (const fila of filas) {
    if (!tieneClaveDuplicadoCompleta(fila)) continue;
    const clave = claveDuplicadoFila(fila);
    const existentes = grupos.get(clave);
    if (existentes) existentes.push(fila.filaExcel);
    else grupos.set(clave, [fila.filaExcel]);
  }

  const resultado: FilaDuplicadaEnLote[] = [];
  for (const filasDelGrupo of grupos.values()) {
    if (filasDelGrupo.length < 2) continue;
    for (const filaExcel of filasDelGrupo) {
      resultado.push({
        filaExcel,
        duplicadaCon: filasDelGrupo.filter((otra) => otra !== filaExcel),
      });
    }
  }
  return resultado.sort((a, b) => a.filaExcel - b.filaExcel);
}

// ---------------------------------------------------------------------
// Traslapes de piloto/auxiliar/unidad ENTRE filas del mismo archivo
// ---------------------------------------------------------------------

type CategoriaRecurso = "persona" | "unidad";
type RolRecurso = "piloto" | "auxiliar" | "unidad";

type RecursoFila = {
  categoria: CategoriaRecurso;
  rol: RolRecurso;
  /** Valor tal como viene de la fila (ya normalizado por el parser del PR 2), para mostrar. */
  valor: string;
  /** Solo para comparar igualdad (case-insensitive). */
  claveComparacion: string;
};

/**
 * "piloto" y "auxiliar" comparten la MISMA categoría de recurso
 * ("persona") — mismo criterio ya documentado y usado por
 * disponibilidad-traslapes.ts (primerConflictoTraslape): un mismo
 * empleado no puede estar en dos viajes traslapados sin importar si en
 * uno es piloto y en el otro auxiliar, es la misma persona físicamente.
 * "unidad" (placa) es una categoría aparte. No se inventa una regla
 * nueva — se reutiliza la ya existente.
 */
function recursosDeFila(fila: FilaProgramacionExcel): RecursoFila[] {
  const recursos: RecursoFila[] = [];
  if (fila.pilotoCodigoExcel) {
    recursos.push({ categoria: "persona", rol: "piloto", valor: fila.pilotoCodigoExcel, claveComparacion: normalizarClave(fila.pilotoCodigoExcel) });
  }
  if (fila.auxiliar1CodigoExcel) {
    recursos.push({ categoria: "persona", rol: "auxiliar", valor: fila.auxiliar1CodigoExcel, claveComparacion: normalizarClave(fila.auxiliar1CodigoExcel) });
  }
  if (fila.auxiliar2CodigoExcel) {
    recursos.push({ categoria: "persona", rol: "auxiliar", valor: fila.auxiliar2CodigoExcel, claveComparacion: normalizarClave(fila.auxiliar2CodigoExcel) });
  }
  if (fila.placaExcel) {
    recursos.push({ categoria: "unidad", rol: "unidad", valor: fila.placaExcel, claveComparacion: normalizarClave(fila.placaExcel) });
  }
  return recursos;
}

/**
 * Intervalo real de la fila (salida -> regreso estimado), reutilizando
 * las MISMAS funciones puras que ya usa el resto de Programación
 * (inicioViaje/finViajeDesdeInput de disponibilidad-traslapes.ts) —
 * mismo formato "YYYY-MM-DD HH:mm:ss", comparable como string. `null` si
 * no se puede construir un intervalo completo: sin fecha de salida
 * válida, o sin regreso estimado completo (fecha+hora). Una fila sin
 * regreso NO se compara por traslape (no hay con qué) — su propia
 * ausencia de regreso, si corresponde, ya se reporta aparte (PR 2:
 * "incompleto" si viene a medias; completamente vacío se permite en V1).
 */
function intervaloDeFila(fila: FilaProgramacionExcel): IntervaloViaje | null {
  if (!fila.fechaSalidaExcel) return null;
  if (!fila.fechaRegresoExcel || !fila.horaRegresoExcel) return null;
  const fin = finViajeDesdeInput(`${fila.fechaRegresoExcel}T${fila.horaRegresoExcel}`);
  if (!fin) return null;
  return { inicio: inicioViaje(fila.fechaSalidaExcel, fila.horaSalidaExcel), fin };
}

/** Mismo criterio documentado en disponibilidad-traslapes.ts: se solapan si inicioA < finB Y inicioB < finA (tocar el límite NO es traslape). */
function seSolapan(a: IntervaloViaje, b: IntervaloViaje): boolean {
  return a.inicio < b.fin && b.inicio < a.fin;
}

export type ConflictoTraslapeEnLote = {
  filaExcel: number;
  filaExcelConflicto: number;
  categoria: CategoriaRecurso;
  /** El código/placa compartido, tal como viene en `filaExcel` (mismo valor salvo mayúsculas/espacios en `filaExcelConflicto`). */
  valor: string;
  /** Rol que jugaba el recurso compartido en `filaExcel`. */
  rolEnFila: RolRecurso;
  /** Rol que jugaba el recurso compartido en `filaExcelConflicto`. */
  rolEnFilaConflicto: RolRecurso;
};

/**
 * Detecta traslapes de piloto/auxiliar/unidad ENTRE filas del mismo
 * archivo (nunca contra BD — eso es una fase posterior). Dos filas
 * conflictúan cuando sus intervalos se solapan Y comparten al menos un
 * recurso de la MISMA categoría (persona o unidad). Devuelve una entrada
 * por cada lado del conflicto (ambas filas involucradas), ordenadas por
 * número de fila de Excel. `[]` si no hay ningún conflicto.
 */
export function detectarTraslapesEnLote(filas: FilaProgramacionExcel[]): ConflictoTraslapeEnLote[] {
  const intervalos = filas.map((fila) => ({ fila, intervalo: intervaloDeFila(fila), recursos: recursosDeFila(fila) }));

  const resultado: ConflictoTraslapeEnLote[] = [];
  for (let i = 0; i < intervalos.length; i++) {
    const a = intervalos[i];
    if (!a.intervalo || !a.recursos.length) continue;
    for (let j = i + 1; j < intervalos.length; j++) {
      const b = intervalos[j];
      if (!b.intervalo || !b.recursos.length) continue;
      if (!seSolapan(a.intervalo, b.intervalo)) continue;

      for (const ra of a.recursos) {
        for (const rb of b.recursos) {
          if (ra.categoria !== rb.categoria) continue;
          if (ra.claveComparacion !== rb.claveComparacion) continue;
          resultado.push({
            filaExcel: a.fila.filaExcel,
            filaExcelConflicto: b.fila.filaExcel,
            categoria: ra.categoria,
            valor: ra.valor,
            rolEnFila: ra.rol,
            rolEnFilaConflicto: rb.rol,
          });
          resultado.push({
            filaExcel: b.fila.filaExcel,
            filaExcelConflicto: a.fila.filaExcel,
            categoria: rb.categoria,
            valor: rb.valor,
            rolEnFila: rb.rol,
            rolEnFilaConflicto: ra.rol,
          });
        }
      }
    }
  }
  return resultado.sort((x, y) => x.filaExcel - y.filaExcel || x.filaExcelConflicto - y.filaExcelConflicto);
}

// ---------------------------------------------------------------------
// Previsualización contra catálogo/BD (PR 4) — SOLO LECTURA. No crea ni
// modifica ningún registro (ni tms_personal, ni tms_unidades, ni
// tms_planes_viaje). Ver nota sobre personalDesdeEmpleado más abajo.
// ---------------------------------------------------------------------

export type EstadoFilaProgramacion = "ok" | "error";

export type AuxiliarResueltoFila = {
  empleadoId: number;
  nombre: string;
  /** tms_personal.id YA existente para este auxiliar, o null si esta persona nunca ha sido piloto/auxiliar en TMS (se crearía recién al importar, PR 5). */
  personalId: number | null;
};

export type DatosResueltosFilaProgramacion = {
  rutaId: number;
  rutaCodigo: string;
  clienteId: number;
  clienteNombre: string;
  pilotoEmpleadoId: number;
  pilotoNombre: string;
  /** tms_personal.id YA existente para este piloto, o null si esta persona nunca ha sido piloto/auxiliar en TMS. */
  pilotoPersonalId: number | null;
  auxiliares: AuxiliarResueltoFila[];
  unidadPlaca: string;
  /** tms_unidades.id YA existente para esta placa, o null si nunca se ha usado en TMS. */
  unidadId: number | null;
  /** = tarifa_referencia de la ruta (predeterminada activa) — el mismo valor contra el que se contrastó fila.tarifaExcel. */
  tarifaVigente: number;
  /** "YYYY-MM-DDTHH:mm" combinado, solo si la fila trae regreso estimado completo. */
  regresoEstimado: string | null;
};

export type PreviewFilaProgramacion = {
  filaExcel: number;
  estado: EstadoFilaProgramacion;
  errores: string[];
  advertencias: string[];
  /** Solo presente cuando estado === "ok". */
  datos: DatosResueltosFilaProgramacion | null;
};

export type ResumenPreviewProgramacion = {
  totalFilas: number;
  filasOk: number;
  filasConError: number;
};

export type ResultadoPreviewProgramacion = {
  filas: PreviewFilaProgramacion[];
  resumen: ResumenPreviewProgramacion;
};

/** Comparación de NIT tolerante a espacios/guiones y mayúsculas/minúsculas — no existe un normalizador de NIT reutilizable hoy en el proyecto, se escribe uno mínimo aquí, mismo criterio de normalización que el resto del módulo. */
function normalizarNit(s: string): string {
  return s.trim().replace(/[\s-]/g, "").toLocaleUpperCase("es-GT");
}

type RutaCatalogo = {
  id: number;
  codigo: string;
  clienteId: number;
  clienteNombre: string;
  clienteNit: string;
  activo: boolean;
  /** tms_cliente_rutas.tarifa_referencia — el sistema ya lo mantiene sincronizado con el monto de la tarifa predeterminada activa (ver ruta-tarifas.ts), así que se reutiliza directamente en vez de volver a resolverlo tarifa por tarifa. */
  tarifaVigente: number | null;
};

type EmpleadoCatalogo = { id: number; codigo: string; nombre: string; activo: boolean };

/**
 * Resuelve y valida cada fila contra datos REALES del sistema — ruta,
 * cliente (contraste), piloto/auxiliares, unidad, tarifa vigente, y
 * disponibilidad/traslape contra viajes YA EXISTENTES en BD. Integra
 * también los errores sintácticos del PR 2 (`fila.erroresSintacticos`) y
 * los duplicados/traslapes INTERNOS del lote del PR 3
 * (`detectarFilasDuplicadas`/`detectarTraslapesEnLote`, de este mismo
 * archivo). Si una fila ya trae errores sintácticos, o es duplicada, o
 * traslapa con otra fila del propio archivo, NO se sigue resolviendo
 * catálogo para ella — no tiene sentido validar ruta/cliente/piloto/
 * placa/tarifa sobre una fila que de todas formas se va a rechazar.
 *
 * SOLO LECTURA: no crea ni modifica ningún registro — eso es alcance de
 * una fase posterior (PR 5, con transacción y candado).
 *
 * NOTA IMPORTANTE sobre "reutilizar personalDesdeEmpleado": esa función
 * (src/lib/tms/personal-resolucion.ts, PR 1) hace INSERT/UPDATE reales
 * en tms_personal como parte de su resolución — es exactamente lo
 * correcto para el alta real de un plan (POST/PATCH), pero usarla AQUÍ
 * escribiría en BD en cuanto alguien solo quisiera VER una vista previa,
 * lo cual contradice "todavía NO... INSERT/UPDATE de operación" (mismo
 * alcance de este PR). Por eso esta función NO la llama: reutiliza el
 * MISMO criterio de validación que su primera mitad (empleados.id +
 * empresa + estado='Activo') y busca si YA EXISTE un tms_personal para
 * ese código+tipo, SIN crearlo — exactamente el mismo patrón de
 * solo-lectura que ya usa `previsualizarImportacionRutas` en
 * rutas-import.ts (que tampoco escribe nada en su fase de preview; solo
 * `confirmarImportacionRutas` escribe). Si la persona/unidad nunca ha
 * estado en TMS, `personalId`/`unidadId` quedan `null` — no es un error:
 * sin un registro existente no puede haber ningún viaje real que lo
 * referencie, así que simplemente se omite del chequeo de traslape
 * contra BD (no hay nada que comprobar). Ese registro se crearía recién
 * al confirmar la importación (PR 5), igual que hoy hace el POST manual.
 */
export async function previsualizarImportacionProgramacion(
  empresaId: number,
  filas: FilaProgramacionExcel[],
): Promise<ResultadoPreviewProgramacion> {
  const [rutasRows, empleadosRows, personalRows, unidadesRows, disponibilidadVehiculos] = await Promise.all([
    query<RowDataPacket[]>(
      `SELECT r.id, r.codigo, r.cliente_id, r.activo, r.tarifa_referencia,
              c.nombre AS cliente_nombre, c.nit AS cliente_nit
       FROM tms_cliente_rutas r
       JOIN tms_clientes c ON c.id = r.cliente_id
       WHERE r.empresa_id = ?`,
      [empresaId],
    ),
    query<RowDataPacket[]>(
      `SELECT id, codigo, nombre, estado FROM empleados WHERE empresa_id = ?`,
      [empresaId],
    ),
    query<RowDataPacket[]>(
      `SELECT id, codigo, tipo FROM tms_personal WHERE empresa_id = ? AND codigo IS NOT NULL`,
      [empresaId],
    ),
    query<RowDataPacket[]>(`SELECT id, placa FROM tms_unidades WHERE empresa_id = ?`, [empresaId]),
    listarDisponibilidadVehiculos(empresaId),
  ]);

  const rutasPorCodigo = new Map<string, RutaCatalogo>();
  for (const r of rutasRows) {
    rutasPorCodigo.set(normalizarClave(String(r.codigo)), {
      id: Number(r.id),
      codigo: String(r.codigo),
      clienteId: Number(r.cliente_id),
      clienteNombre: String(r.cliente_nombre ?? ""),
      clienteNit: r.cliente_nit != null ? String(r.cliente_nit) : "",
      activo: Number(r.activo ?? 0) === 1,
      tarifaVigente: r.tarifa_referencia != null ? Number(r.tarifa_referencia) : null,
    });
  }

  const empleadosPorCodigo = new Map<string, EmpleadoCatalogo>();
  for (const e of empleadosRows) {
    empleadosPorCodigo.set(normalizarClave(String(e.codigo)), {
      id: Number(e.id),
      codigo: String(e.codigo),
      nombre: String(e.nombre),
      activo: normalizarClave(String(e.estado ?? "")) === "activo",
    });
  }

  const personalExistentePorClave = new Map<string, number>();
  for (const p of personalRows) {
    personalExistentePorClave.set(`${String(p.tipo)}|${normalizarClave(String(p.codigo))}`, Number(p.id));
  }

  const unidadesPorPlaca = new Map<string, number>();
  for (const u of unidadesRows) {
    unidadesPorPlaca.set(normalizarClave(String(u.placa)), Number(u.id));
  }

  const vehiculosPorPlaca = new Map(disponibilidadVehiculos.vehiculos.map((v) => [normalizarClave(v.placa), v]));

  const duplicadosPorFila = new Map(detectarFilasDuplicadas(filas).map((d) => [d.filaExcel, d]));
  const traslapesLotePorFila = new Map<number, ConflictoTraslapeEnLote[]>();
  for (const c of detectarTraslapesEnLote(filas)) {
    const arr = traslapesLotePorFila.get(c.filaExcel) ?? [];
    arr.push(c);
    traslapesLotePorFila.set(c.filaExcel, arr);
  }

  function personalIdExistente(tipo: "Piloto" | "Auxiliar", codigo: string): number | null {
    return personalExistentePorClave.get(`${tipo}|${normalizarClave(codigo)}`) ?? null;
  }

  const resultado: PreviewFilaProgramacion[] = [];

  for (const fila of filas) {
    const errores: string[] = [...fila.erroresSintacticos];
    const advertencias: string[] = [];

    const dup = duplicadosPorFila.get(fila.filaExcel);
    if (dup) {
      errores.push(
        `Fila duplicada dentro del mismo archivo (misma fecha/hora/ruta/piloto/unidad que la fila ${dup.duplicadaCon.join(", ")}).`,
      );
    }
    for (const c of traslapesLotePorFila.get(fila.filaExcel) ?? []) {
      errores.push(
        `Traslape con la fila ${c.filaExcelConflicto} del mismo archivo: comparten ${c.categoria === "unidad" ? "la unidad" : "personal"} "${c.valor}".`,
      );
    }

    if (errores.length) {
      resultado.push({ filaExcel: fila.filaExcel, estado: "error", errores, advertencias, datos: null });
      continue;
    }

    // 1) Ruta — existe y está activa.
    const ruta = rutasPorCodigo.get(normalizarClave(fila.codigoRutaExcel));
    if (!ruta) {
      errores.push(`La ruta "${fila.codigoRutaExcel}" no existe.`);
    } else if (!ruta.activo) {
      errores.push(`La ruta "${fila.codigoRutaExcel}" está inactiva.`);
    }

    // 2) Cliente — SOLO contraste contra el cliente que ya determina la
    // ruta; el clienteId NUNCA se resuelve desde el texto del Excel.
    if (ruta?.activo) {
      if (ruta.clienteNit) {
        if (normalizarNit(fila.clienteExcel) !== normalizarNit(ruta.clienteNit)) {
          errores.push(
            `El cliente informado ("${fila.clienteExcel}") no coincide con el NIT del cliente de la ruta (${ruta.clienteNit}, "${ruta.clienteNombre}").`,
          );
        }
      } else if (normalizarClave(fila.clienteExcel) !== normalizarClave(ruta.clienteNombre)) {
        errores.push(
          `El cliente informado ("${fila.clienteExcel}") no coincide con el cliente de la ruta ("${ruta.clienteNombre}").`,
        );
      } else {
        advertencias.push("Cliente validado por nombre porque el catálogo no tiene NIT registrado.");
      }
    }

    // 3) Piloto — existe y está habilitado (mismo criterio de
    // personalDesdeEmpleado, sin escribir nada — ver nota arriba).
    const piloto = empleadosPorCodigo.get(normalizarClave(fila.pilotoCodigoExcel));
    if (!piloto) {
      errores.push(`El piloto con código "${fila.pilotoCodigoExcel}" no existe.`);
    } else if (!piloto.activo) {
      errores.push(`El piloto con código "${fila.pilotoCodigoExcel}" está inactivo.`);
    }

    // 4) Auxiliares (0-2, opcionales) — mismo criterio.
    const codigosAuxiliar = [fila.auxiliar1CodigoExcel, fila.auxiliar2CodigoExcel].filter(Boolean);
    const auxiliaresResueltos: EmpleadoCatalogo[] = [];
    for (const codigo of codigosAuxiliar) {
      const aux = empleadosPorCodigo.get(normalizarClave(codigo));
      if (!aux) {
        errores.push(`El auxiliar con código "${codigo}" no existe.`);
      } else if (!aux.activo) {
        errores.push(`El auxiliar con código "${codigo}" está inactivo.`);
      } else {
        auxiliaresResueltos.push(aux);
      }
    }
    // Piloto/auxiliares repetidos en la MISMA fila — misma persona no
    // puede ir dos veces en un mismo viaje (mismo criterio de detección
    // de repetidos que ya usa rutas-import.ts para su personal habitual).
    const codigosPersonalFila = [fila.pilotoCodigoExcel, ...codigosAuxiliar].filter(Boolean).map(normalizarClave);
    if (new Set(codigosPersonalFila).size !== codigosPersonalFila.length) {
      errores.push("El piloto y los auxiliares no pueden repetirse entre sí en la misma fila.");
    }

    // 5) Placa/unidad — existe y está disponible (mismo criterio que el
    // POST manual: listarDisponibilidadVehiculos + v.puedeEnviar).
    const vehiculo = vehiculosPorPlaca.get(normalizarClave(fila.placaExcel));
    if (!vehiculo) {
      errores.push(`La unidad con placa "${fila.placaExcel}" no existe en el sistema.`);
    } else if (!vehiculo.puedeEnviar) {
      errores.push(
        `La unidad con placa "${fila.placaExcel}" no está disponible: ${vehiculo.motivoNoDisponible ?? vehiculo.estadoDisponibilidad}.`,
      );
    }

    // 6) Tarifa GTQ vs. tarifa vigente de la ruta — cualquier diferencia
    // es error bloqueante (decisión aprobada), sin override manual.
    if (ruta?.activo) {
      if (ruta.tarifaVigente == null) {
        errores.push(`La ruta "${fila.codigoRutaExcel}" no tiene una tarifa vigente configurada en el sistema.`);
      } else if (fila.tarifaExcel !== ruta.tarifaVigente) {
        errores.push(`Tarifa Excel: Q${fila.tarifaExcel} / Tarifa sistema: Q${ruta.tarifaVigente}`);
      }
    }

    if (errores.length) {
      resultado.push({ filaExcel: fila.filaExcel, estado: "error", errores, advertencias, datos: null });
      continue;
    }

    // A partir de aquí ruta/piloto/vehiculo/tarifaVigente están
    // garantizados no-nulos por los checks de arriba (ningún error se
    // acumuló) — TypeScript no lo infiere solo a través del `continue`
    // condicional, se afirma explícitamente con `!`.
    const rutaOk = ruta!;
    const pilotoOk = piloto!;
    const vehiculoOk = vehiculo!;

    const pilotoPersonalId = personalIdExistente("Piloto", fila.pilotoCodigoExcel);
    const auxiliaresDatos: AuxiliarResueltoFila[] = auxiliaresResueltos.map((aux) => ({
      empleadoId: aux.id,
      nombre: aux.nombre,
      personalId: personalIdExistente("Auxiliar", aux.codigo),
    }));
    const unidadId = unidadesPorPlaca.get(normalizarClave(fila.placaExcel)) ?? null;

    // 7) Disponibilidad/traslape contra viajes YA EXISTENTES en BD —
    // reutiliza primerConflictoTraslape tal cual (misma función que usa
    // el alta manual, sin `conn` ni candado: esto es solo lectura, el
    // candado/transacción son del PR 5). Solo se arman recursos con id
    // REAL ya existente (personalId/unidadId no nulos) — ver nota sobre
    // personalDesdeEmpleado más arriba. Sin regreso estimado completo no
    // hay intervalo que comparar, se omite el chequeo (igual que el
    // resto del sistema: sin regreso no se puede validar disponibilidad).
    let regresoEstimadoCombinado: string | null = null;
    if (fila.fechaRegresoExcel && fila.horaRegresoExcel) {
      regresoEstimadoCombinado = `${fila.fechaRegresoExcel}T${fila.horaRegresoExcel}`;
      const fin = finViajeDesdeInput(regresoEstimadoCombinado);
      if (fin) {
        // fechaSalidaExcel está garantizado no-nulo: es obligatorio (PR 2)
        // y cualquier fila sin él ya salió por `fila.erroresSintacticos`
        // en el chequeo de arriba.
        const intervalo: IntervaloViaje = { inicio: inicioViaje(fila.fechaSalidaExcel!, fila.horaSalidaExcel), fin };
        const recursos: RecursoAValidar[] = [
          ...(pilotoPersonalId != null ? [{ tipo: "piloto" as const, id: pilotoPersonalId }] : []),
          ...auxiliaresDatos
            .filter((a): a is AuxiliarResueltoFila & { personalId: number } => a.personalId != null)
            .map((a) => ({ tipo: "auxiliar" as const, id: a.personalId })),
          ...(unidadId != null ? [{ tipo: "unidad" as const, id: unidadId }] : []),
        ];
        if (recursos.length) {
          const conflicto = await primerConflictoTraslape(empresaId, recursos, intervalo, null);
          if (conflicto) errores.push(mensajeConflicto(conflicto));
        }
      }
    }

    if (errores.length) {
      resultado.push({ filaExcel: fila.filaExcel, estado: "error", errores, advertencias, datos: null });
      continue;
    }

    resultado.push({
      filaExcel: fila.filaExcel,
      estado: "ok",
      errores: [],
      advertencias,
      datos: {
        rutaId: rutaOk.id,
        rutaCodigo: rutaOk.codigo,
        clienteId: rutaOk.clienteId,
        clienteNombre: rutaOk.clienteNombre,
        pilotoEmpleadoId: pilotoOk.id,
        pilotoNombre: pilotoOk.nombre,
        pilotoPersonalId,
        auxiliares: auxiliaresDatos,
        unidadPlaca: vehiculoOk.placa,
        unidadId,
        tarifaVigente: rutaOk.tarifaVigente as number,
        regresoEstimado: regresoEstimadoCombinado,
      },
    });
  }

  const filasOk = resultado.filter((f) => f.estado === "ok").length;
  return {
    filas: resultado,
    resumen: { totalFilas: resultado.length, filasOk, filasConError: resultado.length - filasOk },
  };
}
