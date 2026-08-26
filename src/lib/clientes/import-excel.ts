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
  "telefono",
  "email",
  "direccion",
  "contacto_nombre",
  "contacto_telefono",
  "tipo",
  "estado",
  "notas",
  "actualizar_si_existe",
] as const;

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
    "55550000",
    "contacto@ejemplo.com",
    "Ciudad de Guatemala",
    "Ana Pérez",
    "55551111",
    "Transporte",
    "Activo",
    "Fila de ejemplo: reemplazar o eliminar antes de importar",
    "NO",
  ]);
  ws.autoFilter = "A1:M1";
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
  ws.getRow(1).alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  ws.getRow(1).height = 32;
  ws.columns = [16, 30, 32, 18, 18, 30, 42, 26, 20, 22, 14, 42, 20].map((width) => ({ width }));
  ws.getColumn(1).numFmt = "@";
  ws.getColumn(4).numFmt = "@";
  ws.getColumn(5).numFmt = "@";
  ws.getColumn(9).numFmt = "@";
  for (let row = 2; row <= 1001; row += 1) {
    ws.getCell(`J${row}`).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ['"Transporte,Reciclaje,Tarimas,Comercial,Mixto,Otro"'],
    };
    ws.getCell(`K${row}`).dataValidation = { type: "list", allowBlank: true, formulae: ['"Activo,Inactivo"'] };
    ws.getCell(`M${row}`).dataValidation = { type: "list", allowBlank: true, formulae: ['"SI,NO"'] };
  }

  const ayuda = wb.addWorksheet("AYUDA");
  ayuda.addRow(["Campo", "Descripción"]);
  ayuda.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ayuda.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
  [
    ["nombre", "Obligatorio. Nombre operativo del cliente."],
    ["codigo / nit", "Recomendados. El sistema los usa, junto con el nombre, para detectar clientes existentes."],
    ["tipo", CLIENTE_TIPOS.map((x) => x.label).join(", ") + ". Si se deja vacío se usa Comercial."],
    ["estado", "Activo o Inactivo. Si se deja vacío se usa Activo."],
    ["actualizar_si_existe", "SI actualiza el cliente encontrado por código, NIT o nombre. NO lo omite sin modificarlo."],
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
      telefono: texto(value("telefono")) || null,
      email: texto(value("email", "correo")) || null,
      direccion: texto(value("direccion")) || null,
      contactoNombre: texto(value("contacto_nombre", "contacto")) || null,
      contactoTelefono: texto(value("contacto_telefono", "telefono_contacto")) || null,
      tipo: tipoCliente(value("tipo")) ?? (texto(value("tipo")) ? undefined : "comercial"),
      estado: estadoCliente(value("estado")) ?? (texto(value("estado")) ? undefined : "Activo"),
      notas: texto(value("notas", "observaciones")) || null,
      actualizar: esSi(value("actualizar_si_existe", "actualizar")),
    });
  }
  return filas;
}

export const normalizarIdentificadorCliente = clave;
