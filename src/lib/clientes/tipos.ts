export type ClienteEstado = "Activo" | "Inactivo";

export type ClienteTipo =
  | "transporte"
  | "reciclaje"
  | "tarimas"
  | "comercial"
  | "mixto"
  | "otro";

export type Cliente = {
  id: number;
  empresaId: number;
  codigo: string | null;
  nombre: string;
  razonSocial: string | null;
  nit: string | null;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  contactoNombre: string | null;
  contactoTelefono: string | null;
  tipo: ClienteTipo;
  estado: ClienteEstado;
  notas: string | null;
  tmsClienteId: number | null;
  creadoAt: string | null;
  actualizadoAt: string | null;
};

export type ClienteInput = {
  codigo?: string | null;
  nombre: string;
  razonSocial?: string | null;
  nit?: string | null;
  telefono?: string | null;
  email?: string | null;
  direccion?: string | null;
  contactoNombre?: string | null;
  contactoTelefono?: string | null;
  tipo?: ClienteTipo;
  estado?: ClienteEstado;
  notas?: string | null;
};

export const CLIENTE_TIPOS: { value: ClienteTipo; label: string }[] = [
  { value: "transporte", label: "Transporte / logística" },
  { value: "reciclaje", label: "Reciclaje" },
  { value: "tarimas", label: "Tarimas" },
  { value: "comercial", label: "Comercial / venta" },
  { value: "mixto", label: "Mixto" },
  { value: "otro", label: "Otro" },
];
