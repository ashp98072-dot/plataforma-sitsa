import { createHash } from "node:crypto";
import type {
  FelProvider,
  ResultadoAnulacion,
  ResultadoCertificar,
  ResultadoConsulta,
  SolicitudAnular,
  SolicitudCertificar,
  SolicitudConsultar,
} from "../provider";
import type { IdentidadFiscal } from "../tipos";

/**
 * PROVEEDOR MOCK — SOLO pruebas/desarrollo. Determinista, EN MEMORIA y SIN RED: este archivo no importa ni usa
 * fetch/http/https/axios/net (una prueba de arquitectura lo exige). Un «CERTIFICADO» del MOCK NO es un documento SAT
 * válido: su autorización lleva el prefijo «MOCK-» y el esquema impide que pertenezca a un ambiente PROD.
 *
 * Simula también el LADO REMOTO (qué certificó realmente el «certificador»): permite reproducir «certificó pero perdí
 * la respuesta» y contar cuántas certificaciones efectivas hubo (para demostrar que no hay doble certificación).
 */

export type EscenarioCertificar =
  | "CERTIFICA"
  | "RECHAZA"
  | "TIMEOUT_ANTES_DE_PROCESAR"
  | "PROCESA_Y_PIERDE_RESPUESTA"
  | "PENDIENTE"
  | "ERROR_CONFIG"
  | "LANZA_EXCEPCION";

export type EscenarioConsulta = "SEGUN_ESTADO_REMOTO" | "INCIERTO" | "ERROR_CONFIG" | "LANZA_EXCEPCION";
export type EscenarioAnular = "ANULA" | "RECHAZA" | "INCIERTO" | "PROCESA_Y_PIERDE_RESPUESTA" | "ERROR_CONFIG" | "LANZA_EXCEPCION";

type Programable<T> = T | ((referencia: string, llamada: number) => T);
type RegistroRemoto = { estado: "CERTIFICADO" | "PENDIENTE" | "ANULADO"; identidad: IdentidadFiscal };

export type OpcionesMockFel = {
  certificar?: Programable<EscenarioCertificar>;
  consultar?: Programable<EscenarioConsulta>;
  anular?: Programable<EscenarioAnular>;
  /** Si false, un reenvío de una referencia ya certificada crea OTRA certificación (peor caso: lo que NO se debe permitir). */
  remotoIdempotente?: boolean;
  ahora?: () => Date;
};

function resolver<T>(v: Programable<T>, referencia: string, llamada: number): T {
  return typeof v === "function" ? (v as (r: string, n: number) => T)(referencia, llamada) : v;
}

export class MockFelProvider implements FelProvider {
  readonly nombre = "MOCK";
  readonly requiereCredenciales = false;

  readonly llamadas = { certificar: 0, consultar: 0, anular: 0 };
  /** Certificaciones efectivas creadas en el «remoto» (incluye duplicadas si remotoIdempotente=false). */
  certificacionesEfectivas = 0;
  readonly remoto = new Map<string, RegistroRemoto>();

  private certificarEsc: Programable<EscenarioCertificar>;
  private consultarEsc: Programable<EscenarioConsulta>;
  private anularEsc: Programable<EscenarioAnular>;
  private readonly remotoIdempotente: boolean;
  private readonly ahora: () => Date;
  private secuencia = 0;

  constructor(opciones: OpcionesMockFel = {}) {
    this.certificarEsc = opciones.certificar ?? "CERTIFICA";
    this.consultarEsc = opciones.consultar ?? "SEGUN_ESTADO_REMOTO";
    this.anularEsc = opciones.anular ?? "ANULA";
    this.remotoIdempotente = opciones.remotoIdempotente ?? true;
    this.ahora = opciones.ahora ?? (() => new Date("2026-10-13T12:00:00.000Z"));
  }

  /** Cambia el escenario de las siguientes llamadas. */
  programar(cambios: Pick<OpcionesMockFel, "certificar" | "consultar" | "anular">): void {
    if (cambios.certificar) this.certificarEsc = cambios.certificar;
    if (cambios.consultar) this.consultarEsc = cambios.consultar;
    if (cambios.anular) this.anularEsc = cambios.anular;
  }

  /** El «certificador» termina de procesar los documentos que tenía en proceso. */
  resolverPendientes(): void {
    for (const r of this.remoto.values()) if (r.estado === "PENDIENTE") r.estado = "CERTIFICADO";
  }

  private identidad(referencia: string): IdentidadFiscal {
    const hex = createHash("sha256").update(`mock|${referencia}|${this.secuencia}`).digest("hex");
    return {
      autorizacion: `MOCK-${hex.slice(0, 32).toUpperCase()}`,
      serie: "MOCK",
      numero: String(parseInt(hex.slice(0, 7), 16) % 100000000),
      fechaCertificacion: this.ahora().toISOString(),
    };
  }

  private registrar(referencia: string, estado: RegistroRemoto["estado"]): RegistroRemoto {
    const previo = this.remoto.get(referencia);
    if (previo && this.remotoIdempotente) return previo;
    this.secuencia += 1;
    const registro: RegistroRemoto = { estado, identidad: this.identidad(referencia) };
    this.remoto.set(referencia, registro);
    this.certificacionesEfectivas += 1;
    return registro;
  }

  async certificar(s: SolicitudCertificar): Promise<ResultadoCertificar> {
    const llamada = ++this.llamadas.certificar;
    const escenario = resolver(this.certificarEsc, s.referenciaEmisor, llamada);
    switch (escenario) {
      case "CERTIFICA": {
        const r = this.registrar(s.referenciaEmisor, "CERTIFICADO");
        return { tipo: "CERTIFICADO", ...r.identidad };
      }
      case "RECHAZA":
        return { tipo: "RECHAZADO", codigo: "MOCK_RECHAZO", mensaje: "Documento rechazado por el proveedor simulado." };
      case "TIMEOUT_ANTES_DE_PROCESAR":
        return { tipo: "INCIERTO", codigo: "MOCK_TIMEOUT", mensaje: "Tiempo de espera agotado (simulado)." };
      case "PROCESA_Y_PIERDE_RESPUESTA":
        this.registrar(s.referenciaEmisor, "CERTIFICADO");
        return { tipo: "INCIERTO", codigo: "MOCK_RESPUESTA_PERDIDA", mensaje: "Conexión cortada antes de la respuesta (simulado)." };
      case "PENDIENTE":
        this.registrar(s.referenciaEmisor, "PENDIENTE");
        return { tipo: "PENDIENTE", codigo: "MOCK_EN_PROCESO", mensaje: "Documento en proceso (simulado)." };
      case "ERROR_CONFIG":
        return { tipo: "ERROR_CONFIG", codigo: "MOCK_CONFIG", mensaje: "Configuración inválida (simulado)." };
      case "LANZA_EXCEPCION":
        throw new Error("MOCK: excepción simulada del proveedor");
    }
  }

  async consultar(s: SolicitudConsultar): Promise<ResultadoConsulta> {
    const llamada = ++this.llamadas.consultar;
    const escenario = resolver(this.consultarEsc, s.referenciaEmisor, llamada);
    if (escenario === "INCIERTO") return { tipo: "INCIERTO", codigo: "MOCK_CONSULTA_TIMEOUT", mensaje: "La consulta no respondió (simulado)." };
    if (escenario === "ERROR_CONFIG") return { tipo: "ERROR_CONFIG", codigo: "MOCK_CONFIG", mensaje: "Configuración inválida (simulado)." };
    if (escenario === "LANZA_EXCEPCION") throw new Error("MOCK: excepción simulada en la consulta");
    const r = this.remoto.get(s.referenciaEmisor);
    if (!r) return { tipo: "NO_ENCONTRADO", codigo: "MOCK_NO_EXISTE", mensaje: "El proveedor simulado no tiene ese documento." };
    if (r.estado === "PENDIENTE") return { tipo: "PENDIENTE", codigo: "MOCK_EN_PROCESO", mensaje: "Documento en proceso (simulado)." };
    return { tipo: "CERTIFICADO", ...r.identidad };
  }

  async anular(s: SolicitudAnular): Promise<ResultadoAnulacion> {
    const llamada = ++this.llamadas.anular;
    const escenario = resolver(this.anularEsc, s.referenciaEmisor, llamada);
    switch (escenario) {
      case "ANULA": {
        const r = this.remoto.get(s.referenciaEmisor);
        if (!r || r.estado === "PENDIENTE") return { tipo: "RECHAZADO", codigo: "MOCK_NO_ANULABLE", mensaje: "El documento no está certificado." };
        r.estado = "ANULADO";
        return { tipo: "ANULADO", fechaAnulacion: this.ahora().toISOString() };
      }
      case "RECHAZA":
        return { tipo: "RECHAZADO", codigo: "MOCK_ANULACION_RECHAZADA", mensaje: "Anulación rechazada (simulado)." };
      case "INCIERTO":
        return { tipo: "INCIERTO", codigo: "MOCK_TIMEOUT", mensaje: "Tiempo de espera agotado (simulado)." };
      case "PROCESA_Y_PIERDE_RESPUESTA": {
        // El «certificador» SÍ anula, pero la respuesta no llega: el peor caso de una operación irreversible.
        const r = this.remoto.get(s.referenciaEmisor);
        if (r && r.estado === "CERTIFICADO") r.estado = "ANULADO";
        return { tipo: "INCIERTO", codigo: "MOCK_RESPUESTA_PERDIDA", mensaje: "Conexión cortada antes de la respuesta (simulado)." };
      }
      case "ERROR_CONFIG":
        return { tipo: "ERROR_CONFIG", codigo: "MOCK_CONFIG", mensaje: "Configuración inválida (simulado)." };
      case "LANZA_EXCEPCION":
        throw new Error("MOCK: excepción simulada en la anulación");
    }
  }
}
