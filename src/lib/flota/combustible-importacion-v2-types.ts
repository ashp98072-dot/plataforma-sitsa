/** Contrato de preview exclusivamente. No sustituye FilaImportada ni el contrato HALEL v1 persistido. */
export type PerfilProveedor = "HALEL" | "SHELL";
export type CampoProveedor = "fecha" | "vale" | "placa" | "piloto" | "galones" | "precio" | "monto" | "serie" | "factura" | "km" | "producto" | "lote" | "auxiliar";
export type FilaProveedorV2 = {
  hoja: string;
  fila: number;
  textos: Record<CampoProveedor, string>;
  celdas: { direccion: string; tipo: number; formato: string; valor: unknown }[];
  fechaConsumo: string | null;
  placaOriginal: string;
  placaNormalizada: string;
  vale: string;
  serie: string;
  factura: string;
  pilotoInformado: string | null;
  producto: string | null;
  lote: string | null;
  galones: string | null;
  precio: string | null;
  monto: string | null;
  kilometraje: string | null;
  galonesCalculados: boolean;
  estado: "VALIDA" | "ADVERTENCIA" | "INVALIDA" | "IGNORADA";
  motivos: string[];
  identidadCandidata: string | null;
  huella: string | null;
  duplicadoDe: number | null;
  conflicto: boolean;
  posiblePrevio: boolean;
};
export type PreviewProveedorV2 = {
  versionContrato: 2;
  versionParser: 1 | 2;
  perfil: PerfilProveedor;
  filas: FilaProveedorV2[];
  resumen: {
    apariciones: number; candidatos: number; duplicados: number; conflictos: number;
    invalidas: number; ignoradas: number; posiblesPrevios: number; bloqueados: number; elegibles: number;
    galonesElegibles: string; montoElegible: string;
  };
  coberturaPrevios: string;
};
