import type { Empleado, EmpleadoInput } from "./empleados";
import type { CampoConDefaultImport } from "./empleados-export";

/**
 * IMPORT-EMPLEADOS-SEGURA
 *
 * Esta capa aplica ÚNICAMENTE a la reimportación Excel de empleados
 * (src/app/api/empresas/[slug]/empleados/import/route.ts, ruta de
 * ACTUALIZACIÓN cuando el empleado ya existe). NO se usa para la
 * creación de empleados nuevos (esos mantienen el comportamiento normal
 * de creación) ni para la ficha de edición manual de RRHH — esa ruta ya
 * envía valores reales e intencionales para cada campo.
 *
 * Problema que resuelve: el importador manda un payload "completo" por
 * fila, y actualizarEmpleado() siempre reescribe todo lo que recibe. Si
 * el Excel trae una celda vacía o un placeholder ("48", "N/A",
 * "Pendiente", "0000", "-"…) en un campo que en la base SÍ tiene un dato
 * real, una reimportación borraría ese dato real sin que nadie lo haya
 * pedido.
 *
 * IMPORT-EMPLEADOS-SEGURA-2 — "ausencia de columna != valor default":
 * varios campos del parser (tipoHorario, estado, tipoContrato,
 * formaPago, horaEntradaTeorica, horaSalidaTeorica) usan un `|| default`
 * cuando la columna del Excel está ausente o vacía, para que un ALTA
 * nueva siga teniendo un valor razonable. Ese default ("Fijo", "Activo",
 * "fijo", "transferencia", "07:00:00", "16:00:00") NO es un dato
 * explícito del Excel, así que para un empleado EXISTENTE nunca debe
 * sobreescribir el valor real ya guardado. La única forma de saber si el
 * valor es un default o un dato real es la metadata
 * FilaImportEmpleado.camposConDefault, calculada en el parser ANTES de
 * aplicar el `|| default` — mirar el valor final ya parseado no alcanza,
 * porque para ese momento el default ya borró la diferencia.
 */

/**
 * Valores que el Excel de importación usa como "placeholder" — nunca
 * deben sobreescribir un dato real ya existente. Comparación siempre
 * trim + case-insensitive.
 */
const PLACEHOLDERS_IMPORT = new Set([
  "",
  "48",
  "n/a",
  "na",
  "pendiente",
  "0000",
  "-",
  "—",
]);

export function esPlaceholderImport(valor: unknown): boolean {
  if (valor == null) return true;
  return PLACEHOLDERS_IMPORT.has(String(valor).trim().toLowerCase());
}

/** El valor del Excel gana solo si es real (no placeholder); si no, se conserva el valor actual. */
function stringPreservado(
  valorExcel: string | undefined,
  valorActual: string | undefined,
): string | undefined {
  const excel = (valorExcel ?? "").trim();
  if (!esPlaceholderImport(excel)) return excel;
  return valorActual;
}

/** El valor del Excel gana solo si es una fecha realmente provista; si no, se conserva la actual. */
function fechaPreservada(
  valorExcel: string | null | undefined,
  valorActual: string | null | undefined,
): string | null {
  if (valorExcel && valorExcel.trim()) return valorExcel;
  return valorActual ?? null;
}

/** El valor del Excel gana solo si es un número realmente provisto (no ausente/no numérico); si no, se conserva el actual. */
function numeroPreservado(
  valorExcel: number | null | undefined,
  valorActual: number | null | undefined,
): number | null {
  if (valorExcel != null) return valorExcel;
  return valorActual ?? null;
}

/**
 * Campo cuyo valor del Excel puede venir de un `|| default` del parser
 * (ver CampoConDefaultImport): si `camposConDefault` marca este campo,
 * el default NO cuenta como dato explícito y se conserva el valor
 * actual del empleado — sin importar si el default "parece" válido.
 */
function valorSegunPresencia<T>(
  campo: CampoConDefaultImport,
  camposConDefault: ReadonlySet<CampoConDefaultImport>,
  valorExcel: T,
  valorActual: T,
): T {
  return camposConDefault.has(campo) ? valorActual : valorExcel;
}

/**
 * Combina el payload construido a partir de una fila de Excel
 * (`candidato`) con el registro YA EXISTENTE en la base (`existente`)
 * para producir el payload final a pasar a actualizarEmpleado().
 *
 * `camposConDefault` viene de FilaImportEmpleado.camposConDefault (la
 * fila de origen de `candidato`) — indica qué campos de esta fila en
 * particular son un default del parser, no un dato real del Excel.
 *
 * Reglas:
 * - tipoHorario/estado/tipoContrato/formaPago/horaEntradaTeorica/
 *   horaSalidaTeorica: si `camposConDefault` marca el campo, se conserva
 *   el valor ACTUAL del empleado (columna ausente/vacía); si no lo
 *   marca, gana el valor del Excel (columna con dato explícito) — regla
 *   general: "el Excel solo puede modificar lo que realmente contiene".
 * - Campos de texto "blandos" (identidad/contacto/demografía/laboral no
 *   crítica): el valor del Excel gana solo si NO es un placeholder;
 *   si es un placeholder o viene vacío, se conserva el valor actual.
 * - Fechas opcionales (nacimiento, vencimiento de licencia, inicio
 *   laboral): igual — solo se reemplazan si el Excel trae una fecha
 *   real.
 * - Montos (sueldo/bonos): solo se reemplazan si el Excel trae un
 *   número real; una celda vacía/no numérica conserva el monto actual.
 * - Campos sensibles que el importador Excel NUNCA debe tocar (no hay
 *   forma de expresar una intención explícita para ellos desde el
 *   Excel actual): supervisorIds (se deja `undefined`, que
 *   actualizarEmpleado() ya interpreta como "no tocar"),
 *   horasExtraHabilitado y fechaEgreso (se preserva el valor actual
 *   explícitamente, porque actualizarEmpleado() SIEMPRE reescribe esos
 *   dos campos con lo que reciba — a diferencia de supervisorIds, no
 *   tienen un "no tocar" propio).
 * - codigo/nombre/fechaAlta NO se tocan aquí: son campos obligatorios
 *   que el importador siempre controla directamente (la fila nunca
 *   llega hasta aquí sin ellos), igual que antes de este ajuste.
 */
export function fusionarEmpleadoImport(
  existente: Empleado,
  candidato: EmpleadoInput,
  camposConDefault: ReadonlySet<CampoConDefaultImport>,
): EmpleadoInput {
  return {
    ...candidato,

    tipoHorario: valorSegunPresencia(
      "tipoHorario",
      camposConDefault,
      candidato.tipoHorario,
      existente.tipoHorario === "Variable" ? "Variable" : "Fijo",
    ),
    estado: valorSegunPresencia(
      "estado",
      camposConDefault,
      candidato.estado,
      existente.estado === "Baja" ? "Baja" : "Activo",
    ),
    tipoContrato: valorSegunPresencia(
      "tipoContrato",
      camposConDefault,
      candidato.tipoContrato,
      existente.tipoContrato,
    ),
    formaPago: valorSegunPresencia(
      "formaPago",
      camposConDefault,
      candidato.formaPago,
      existente.formaPago,
    ),
    horaEntradaTeorica: valorSegunPresencia(
      "horaEntradaTeorica",
      camposConDefault,
      candidato.horaEntradaTeorica,
      existente.horaEntradaTeorica,
    ),
    horaSalidaTeorica: valorSegunPresencia(
      "horaSalidaTeorica",
      camposConDefault,
      candidato.horaSalidaTeorica,
      existente.horaSalidaTeorica,
    ),

    primerNombre: stringPreservado(candidato.primerNombre, existente.primerNombre),
    segundoNombre: stringPreservado(candidato.segundoNombre, existente.segundoNombre),
    primerApellido: stringPreservado(candidato.primerApellido, existente.primerApellido),
    segundoApellido: stringPreservado(candidato.segundoApellido, existente.segundoApellido),
    apellidoCasada: stringPreservado(candidato.apellidoCasada, existente.apellidoCasada),
    dpi: stringPreservado(candidato.dpi, existente.dpi),
    nit: stringPreservado(candidato.nit, existente.nit),
    igss: stringPreservado(candidato.igss, existente.igss),
    irtra: stringPreservado(candidato.irtra, existente.irtra),
    sexo: stringPreservado(candidato.sexo, existente.sexo),
    profesion: stringPreservado(candidato.profesion, existente.profesion),
    telefono: stringPreservado(candidato.telefono, existente.telefono),
    email: stringPreservado(candidato.email, existente.email),
    direccion: stringPreservado(candidato.direccion, existente.direccion),
    paisOrigen: stringPreservado(candidato.paisOrigen, existente.paisOrigen),
    municipio: stringPreservado(candidato.municipio, existente.municipio),
    etnia: stringPreservado(candidato.etnia, existente.etnia),
    religion: stringPreservado(candidato.religion, existente.religion),
    idioma: stringPreservado(candidato.idioma, existente.idioma),
    licenciaNumero: stringPreservado(candidato.licenciaNumero, existente.licenciaNumero),
    licenciaTipo: stringPreservado(candidato.licenciaTipo, existente.licenciaTipo),
    cuentaBancaria: stringPreservado(candidato.cuentaBancaria, existente.cuentaBancaria),
    tipoCuenta: stringPreservado(candidato.tipoCuenta, existente.tipoCuenta),
    banco: stringPreservado(candidato.banco, existente.banco),
    contactoEmergencia: stringPreservado(candidato.contactoEmergencia, existente.contactoEmergencia),
    observaciones: stringPreservado(candidato.observaciones, existente.observaciones),
    puesto: stringPreservado(candidato.puesto, existente.puesto) || "",
    categoriaOps: stringPreservado(candidato.categoriaOps, existente.categoriaOps) || "",

    fechaNacimiento: fechaPreservada(candidato.fechaNacimiento, existente.fechaNacimiento),
    licenciaVence: fechaPreservada(candidato.licenciaVence, existente.licenciaVence),
    fechaInicioLaboral: fechaPreservada(candidato.fechaInicioLaboral, existente.fechaInicioLaboral),

    sueldoBase: numeroPreservado(candidato.sueldoBase, existente.sueldoBase),
    bonoIncentivo: numeroPreservado(candidato.bonoIncentivo, existente.bonoIncentivo),
    bonoHerramientas: numeroPreservado(candidato.bonoHerramientas, existente.bonoHerramientas),

    // Campos sensibles — jamás los toca una reimportación Excel.
    supervisorIds: undefined,
    horasExtraHabilitado: existente.horasExtraHabilitado ?? false,
    fechaEgreso: existente.fechaEgreso ?? null,
  };
}

/**
 * Validación CONSERVADORA del código de una fila de importación: NO
 * asume que todo código deba ser un DPI (podrían existir esquemas
 * históricos distintos como "EMP-003", "325", "00325"…) — solo señala
 * casos claramente anómalos, para que Operaciones/RRHH los revise
 * manualmente.
 *
 * Las filas sin código en absoluto ya se descartan antes de llegar aquí
 * (ver parsearPlantillaEmpleadosConAdvertencias — motivo "Fila sin
 * código identificador."), así que esta función asume un código no
 * vacío y solo señala:
 * - un código de un solo dígito;
 * - un código que PARECE un DPI (13 dígitos) y hay un DPI válido de 13
 *   dígitos en la misma fila, pero no coinciden entre sí. La
 *   discrepancia contra el DPI SOLO cuenta como sospechosa cuando AMBOS
 *   —código y DPI— tienen forma de DPI (13 dígitos); un código interno
 *   que claramente no es un intento de DPI (letras, otra longitud) NUNCA
 *   se marca sospechoso solo por no coincidir con el DPI de la fila.
 *
 * Un código sospechoso NUNCA debe crear ni actualizar automáticamente
 * (ver route.ts) — la seguridad tiene prioridad sobre dar de alta una
 * ficha con identidad dudosa.
 */
export function codigoSospechosoImport(
  codigo: string,
  dpi: string,
): boolean {
  const c = (codigo ?? "").trim();

  if (!c) return true;

  if (/^\d$/.test(c)) return true;

  const d = (dpi ?? "").trim();

  const codigoPareceDpi = /^\d{13}$/.test(c);
  const dpiValido = /^\d{13}$/.test(d);

  if (codigoPareceDpi && dpiValido && c !== d) return true;

  return false;
}
