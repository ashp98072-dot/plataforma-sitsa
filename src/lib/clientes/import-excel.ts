import ExcelJS from "exceljs";
import { CLIENTE_TIPOS, type ClienteEstado, type ClienteInput, type ClienteTipo } from "@/lib/clientes/tipos";

export type FilaClienteExcel = ClienteInput & {
  filaExcel: number;
  actualizar: boolean;
};

const HEADERS = [
  "codigo",
  "nombre",
  "razon_social",
  "nit",
  "rtu",
  "telefono",
  "email",
  "direccion",
  "contacto_nombre",
  "contacto_telefono",
  "tipo",
  "estado",
  "condicion_credito",
  "notas",
  "actualizar_si_existe",
] as const;

/** Hoja opcional "CONTACTOS" — varios contactos por cliente (tms_cliente_contactos ya soporta N por cliente). Si la hoja no existe, el comportamiento es idéntico al de antes. */
const HEADERS_CONTACTOS = [
  "cliente_codigo",
  "cliente_nombre",
  "nombre",
  "cargo",
  "telefono",
  "email",
  "observaciones",
] as const;

export type FilaContactoClienteExcel = {
  filaExcel: number;
  clienteCodigo: string | null;
  clienteNombre: string | null;
  nombre: string;
  cargo: string | null;
  telefono: string | null;
  email: string | null;
  observaciones: string | null;
};

function texto(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const v = value as { result?: unknown; text?: string; richText?: { text: string }[] };
    if (v.result != null) return texto(v.result);
    if (typeof v.text === "string") return v.text.trim();
    if (Array.isArray(v.richText)) return v.richText.map((x) => x.text).join("").trim();
  }
  return String(value).trim();
}

function clave(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function tipoCliente(value: unknown): ClienteTipo | null {
  const normalizado = clave(texto(value));
  const alias: Record<string, ClienteTipo> = {
    transporte: "transporte",
    transporte_logistica: "transporte",
    logistica: "transporte",
    reciclaje: "reciclaje",
    tarimas: "tarimas",
    comercial: "comercial",
    comercial_venta: "comercial",
    venta: "comercial",
    mixto: "mixto",
    otro: "otro",
  };
  return alias[normalizado] ?? null;
}

function estadoCliente(value: unknown): ClienteEstado | null {
  const normalizado = clave(texto(value));
  if (!normalizado || normalizado === "activo") return "Activo";
  if (normalizado === "inactivo") return "Inactivo";
  return null;
}

function esSi(value: unknown): boolean {
  return ["si", "sí", "s", "1", "true"].includes(texto(value).toLowerCase());
}

export async function generarPlantillaClientes(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "SITSA Plataforma";
  const ws = wb.addWorksheet("CLIENTES", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.addRow([...HEADERS]);
  ws.addRow([
    "EJEMPLO-NO-IMPORTAR",
    "Cliente de ejemplo",
    "Cliente de Ejemplo, S.A.",
    "1234567-8",
    "RTU-1234567",
    "55550000",
    "contacto@ejemplo.com",
    "Ciudad de Guatemala",
    "Ana Pérez",
    "55551111",
    "Transporte",
    "Activo",
    "30 días",
    "Fila de ejemplo: reemplazar o eliminar antes de importar",
    "NO",
  ]);
  ws.autoFilter = "A1:O1";
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
  ws.getRow(1).alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  ws.getRow(1).height = 32;
  ws.columns = [20, 30, 32, 18, 20, 18, 30, 42, 26, 20, 22, 14, 20, 42, 20].map((width) => ({ width }));
  ws.getColumn(1).numFmt = "@";
  ws.getColumn(4).numFmt = "@";
  ws.getColumn(5).numFmt = "@";
  ws.getColumn(6).numFmt = "@";
  ws.getColumn(10).numFmt = "@";
  for (let row = 2; row <= 1001; row += 1) {
    ws.getCell(`K${row}`).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ['"Transporte,Reciclaje,Tarimas,Comercial,Mixto,Otro"'],
    };
    ws.getCell(`L${row}`).dataValidation = { type: "list", allowBlank: true, formulae: ['"Activo,Inactivo"'] };
    ws.getCell(`O${row}`).dataValidation = { type: "list", allowBlank: true, formulae: ['"SI,NO"'] };
  }

  const contactos = wb.addWorksheet("CONTACTOS");
  contactos.addRow([...HEADERS_CONTACTOS]);
  contactos.addRow([
    "EJEMPLO-NO-IMPORTAR",
    "Cliente de ejemplo",
    "Ana Pérez",
    "Gerente de Compras",
    "55551111",
    "ana.perez@ejemplo.com",
    "Fila de ejemplo: reemplazar o eliminar antes de importar",
  ]);
  contactos.autoFilter = "A1:G1";
  contactos.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  contactos.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
  contactos.getRow(1).alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  contactos.getRow(1).height = 32;
  contactos.columns = [20, 30, 26, 26, 20, 30, 40].map((width) => ({ width }));
  contactos.getColumn(1).numFmt = "@";
  contactos.getColumn(5).numFmt = "@";

  const ayuda = wb.addWorksheet("AYUDA");
  ayuda.addRow(["Campo", "Descripción"]);
  ayuda.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ayuda.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
  [
    ["nombre", "Obligatorio. Nombre operativo del cliente."],
    ["codigo", "Opcional. Si se deja vacío, el sistema genera un código automático al crear el cliente."],
    ["nit / rtu", "Opcionales. Ayudan a identificar al cliente y detectar registros existentes."],
    ["tipo", CLIENTE_TIPOS.map((x) => x.label).join(", ") + ". Si se deja vacío se usa Comercial."],
    ["estado", "Activo o Inactivo. Si se deja vacío se usa Activo."],
    ["condicion_credito", "Opcional, texto libre: '30 días', '100 días / Pronto Pago', 'Sin Fecha Límite', 'Pendiente', etc. No se interpreta como número."],
    ["actualizar_si_existe", "SI actualiza el cliente encontrado por código, NIT o nombre. NO lo omite sin modificarlo."],
    ["Hoja CONTACTOS (opcional)", "Varios contactos por cliente (nombre/cargo/teléfono/email). Cada fila debe identificar el cliente por cliente_codigo (recomendado) o cliente_nombre — deben coincidir con una fila de la hoja CLIENTES (nueva o ya existente). Si la hoja no existe o está vacía, no cambia nada del comportamiento actual."],
    ["Seguridad", "Primero use Validar Excel. Las filas con identificadores contradictorios se bloquean."],
  ].forEach((row) => ayuda.addRow(row));
  ayuda.columns = [{ width: 28 }, { width: 100 }];
  ayuda.eachRow((row) => { row.alignment = { vertical: "top", wrapText: true }; });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function parsearExcelClientes(buffer: Buffer): Promise<FilaClienteExcel[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const ws = wb.getWorksheet("CLIENTES") ?? wb.getWorksheet("IMPORTAR") ?? wb.worksheets[0];
  if (!ws) return [];

  const columnas = new Map<string, number>();
  ws.getRow(1).eachCell((cell, col) => columnas.set(clave(texto(cell.value)), col));
  if (!columnas.has("nombre") && !columnas.has("cliente")) {
    throw new Error('No se encontró la columna obligatoria "nombre". Usa el Excel modelo oficial.');
  }
  const col = (...names: string[]) => names.map(clave).map((name) => columnas.get(name)).find(Boolean) ?? 0;
  const filas: FilaClienteExcel[] = [];
  for (let i = 2; i <= ws.rowCount; i += 1) {
    const row = ws.getRow(i);
    const value = (...names: string[]) => {
      const c = col(...names);
      return c ? row.getCell(c).value : null;
    };
    const nombre = texto(value("nombre", "cliente"));
    const codigo = texto(value("codigo", "codigo_interno"));
    const nit = texto(value("nit"));
    if (!nombre && !codigo && !nit) continue;
    if (clave(codigo) === "ejemplo_no_importar") continue;
    filas.push({
      filaExcel: i,
      codigo: codigo || null,
      nombre,
      razonSocial: texto(value("razon_social", "razon social")) || null,
      nit: nit || null,
      rtu: texto(value("rtu", "numero_rtu", "numero de rtu")) || null,
      telefono: texto(value("telefono")) || null,
      email: texto(value("email", "correo")) || null,
      direccion: texto(value("direccion")) || null,
      contactoNombre: texto(value("contacto_nombre", "contacto")) || null,
      contactoTelefono: texto(value("contacto_telefono", "telefono_contacto")) || null,
      tipo: tipoCliente(value("tipo")) ?? (texto(value("tipo")) ? undefined : "comercial"),
      estado: estadoCliente(value("estado")) ?? (texto(value("estado")) ? undefined : "Activo"),
      condicionCredito: texto(value("condicion_credito", "limite_de_credito", "limite_credito", "dias_credito", "credito")) || null,
      notas: texto(value("notas", "observaciones")) || null,
      actualizar: esSi(value("actualizar_si_existe", "actualizar")),
    });
  }
  return filas;
}

export const normalizarIdentificadorCliente = clave;

/**
 * TMS-CLIENTES-CREDITO-CONTACTOS-1 — hoja OPCIONAL "CONTACTOS": varios
 * contactos por cliente (tms_cliente_contactos ya soporta N por cliente,
 * ver src/lib/tms/cliente-contactos.ts). Si el archivo no trae esta hoja
 * (o está vacía), devuelve `[]` — el comportamiento del resto del import
 * queda idéntico al de antes de este cambio.
 */
export async function parsearContactosExcelClientes(buffer: Buffer): Promise<FilaContactoClienteExcel[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const ws = wb.getWorksheet("CONTACTOS");
  if (!ws) return [];

  const columnas = new Map<string, number>();
  ws.getRow(1).eachCell((cell, col) => columnas.set(clave(texto(cell.value)), col));
  if (!columnas.has("nombre")) return [];
  const col = (...names: string[]) => names.map(clave).map((name) => columnas.get(name)).find(Boolean) ?? 0;
  const filas: FilaContactoClienteExcel[] = [];
  for (let i = 2; i <= ws.rowCount; i += 1) {
    const row = ws.getRow(i);
    const value = (...names: string[]) => {
      const c = col(...names);
      return c ? row.getCell(c).value : null;
    };
    const clienteCodigo = texto(value("cliente_codigo", "codigo_cliente", "codigo"));
    const clienteNombre = texto(value("cliente_nombre", "nombre_cliente", "cliente"));
    const nombre = texto(value("nombre", "nombre_contacto"));
    if (!clienteCodigo && !clienteNombre && !nombre) continue;
    if (clave(clienteCodigo) === "ejemplo_no_importar") continue;
    if (!nombre) continue; // fila sin nombre de contacto: nada que crear.
    filas.push({
      filaExcel: i,
      clienteCodigo: clienteCodigo || null,
      clienteNombre: clienteNombre || null,
      nombre,
      cargo: texto(value("cargo", "puesto")) || null,
      telefono: texto(value("telefono", "celular")) || null,
      email: texto(value("email", "correo")) || null,
      observaciones: texto(value("observaciones", "notas")) || null,
    });
  }
  return filas;
}
