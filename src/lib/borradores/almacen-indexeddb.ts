import { exito, fallo, type AlmacenBorradores, type Decision, type Fallo, type MotivoFallo, type Resultado } from "./almacen";

/**
 * Almacén IndexedDB del núcleo de borradores. Todo es asíncrono (no bloquea el hilo principal) y una operación de escritura
 * solo se da por buena cuando la TRANSACCIÓN se confirma (`oncomplete`), nunca al terminar la petición individual.
 *
 * Limitaciones conocidas (ver cabecera de tipos.ts): sin cifrado; el navegador puede borrar el almacenamiento (presión de
 * disco, modo privado, «borrar datos de sitio»); IndexedDB puede no existir o fallar al abrir (se devuelve `no_disponible`
 * y un intento posterior vuelve a abrir: un fallo transitorio no deja el almacén inutilizado).
 */

export const NOMBRE_BD_BORRADORES = "novalvion-borradores";
const VERSION_BD = 1;
const TIENDA = "borradores";

type Opciones = {
  /** Fábrica de IndexedDB inyectable (pruebas). Por defecto, el `indexedDB` global si existe. */
  fabrica?: IDBFactory | null;
  nombreBd?: string;
};

function nombreError(e: unknown): string {
  return e && typeof e === "object" && "name" in e ? String((e as { name: unknown }).name) : "Error";
}
const esCuota = (e: unknown) => nombreError(e) === "QuotaExceededError" || (e as { code?: number } | null)?.code === 22;

function clasificar(e: unknown, porDefecto: MotivoFallo): Fallo {
  if (esCuota(e)) return fallo("cuota_excedida", "No hay espacio suficiente para guardar el borrador en este equipo.");
  const msg = porDefecto === "lectura_fallida" ? "No se pudo leer el borrador de este equipo." : "No se pudo guardar el borrador en este equipo.";
  // Solo el NOMBRE del error: nunca contenido del borrador.
  return fallo(porDefecto, `${msg} (${nombreError(e)})`);
}

export function crearAlmacenIndexedDB(opciones: Opciones = {}): AlmacenBorradores {
  const nombreBd = opciones.nombreBd ?? NOMBRE_BD_BORRADORES;
  let conexion: IDBDatabase | null = null;
  let abriendo: Promise<Resultado<IDBDatabase>> | null = null;

  function fabrica(): IDBFactory | null {
    if (opciones.fabrica !== undefined) return opciones.fabrica;
    try {
      return typeof indexedDB === "undefined" ? null : indexedDB; // algunos navegadores lanzan al acceder en modo restringido
    } catch {
      return null;
    }
  }

  function abrir(): Promise<Resultado<IDBDatabase>> {
    if (conexion) return Promise.resolve(exito(conexion));
    if (abriendo) return abriendo;
    const p = new Promise<Resultado<IDBDatabase>>((resolve) => {
      const f = fabrica();
      if (!f) return resolve(fallo("no_disponible", "Este navegador no permite guardar borradores en este equipo."));
      let req: IDBOpenDBRequest;
      try {
        req = f.open(nombreBd, VERSION_BD);
      } catch (e) {
        return resolve(fallo("no_disponible", `No se pudo abrir el almacenamiento local. (${nombreError(e)})`));
      }
      req.onupgradeneeded = () => {
        const bd = req.result;
        if (!bd.objectStoreNames.contains(TIENDA)) {
          const tienda = bd.createObjectStore(TIENDA, { keyPath: "clave" });
          tienda.createIndex("ownerKey", "ownerKey");
          tienda.createIndex("ambito", "ambitoClave");
        }
      };
      req.onsuccess = () => {
        const bd = req.result;
        bd.onversionchange = () => { bd.close(); conexion = null; };
        bd.onclose = () => { conexion = null; };
        conexion = bd;
        resolve(exito(bd));
      };
      req.onerror = () => resolve(fallo("no_disponible", `No se pudo abrir el almacenamiento local. (${nombreError(req.error)})`));
    }).finally(() => { abriendo = null; });
    abriendo = p;
    return p;
  }

  function transaccion(bd: IDBDatabase, modo: IDBTransactionMode): IDBTransaction | Fallo {
    try {
      return bd.transaction(TIENDA, modo);
    } catch (e) {
      conexion = null; // conexión cerrada/inválida: la próxima operación reabre
      return fallo("no_disponible", `El almacenamiento local no respondió. (${nombreError(e)})`);
    }
  }

  return {
    async obtener(clave) {
      const a = await abrir();
      if (!a.ok) return a;
      const tx = transaccion(a.valor, "readonly");
      if ("ok" in tx) return tx;
      return new Promise((resolve) => {
        let valor: unknown;
        try {
          const req = tx.objectStore(TIENDA).get(clave);
          req.onsuccess = () => { valor = req.result; };
        } catch (e) {
          try { tx.abort(); } catch { /* ya cerrada */ }
          return resolve(clasificar(e, "lectura_fallida"));
        }
        tx.oncomplete = () => resolve(exito(valor));
        tx.onabort = () => resolve(clasificar(tx.error, "lectura_fallida"));
        tx.onerror = () => { /* el detalle llega por onabort */ };
      });
    },

    async modificar<R>(clave: string, decidir: (actual: unknown | undefined, adicionales: (unknown | undefined)[]) => Decision<R>, opciones?: { tambienLeer?: readonly string[] }): Promise<Resultado<R>> {
      const a = await abrir();
      if (!a.ok) return a;
      const tx = transaccion(a.valor, "readwrite");
      if ("ok" in tx) return tx;
      return new Promise<Resultado<R>>((resolve) => {
        let resultado: R | undefined;
        let interno: Fallo | null = null;
        const abortar = (f: Fallo) => { interno = f; try { tx.abort(); } catch { /* ya cerrada */ } };
        try {
          const tienda = tx.objectStore(TIENDA);
          const extras = opciones?.tambienLeer ?? [];
          const adicionales: (unknown | undefined)[] = [];
          const decidirYEscribir = (principal: unknown) => {
            let d: Decision<R>;
            try {
              d = decidir(principal, adicionales);
            } catch (e) {
              return abortar(clasificar(e, "escritura_fallida"));
            }
            resultado = d.resultado;
            try {
              if (d.accion === "escribir") tienda.put(d.registro);
              else if (d.accion === "eliminar") tienda.delete(clave);
            } catch (e) {
              abortar(clasificar(e, "escritura_fallida"));
            }
          };
          // Las lecturas adicionales se encadenan DENTRO de la misma transacción (cada petición se emite desde el `onsuccess` de la
          // anterior): la decisión y la escritura ven un estado coherente y nada puede intercalarse entre ellas.
          const leerAdicionales = (principal: unknown) => {
            if (adicionales.length >= extras.length) return decidirYEscribir(principal);
            try {
              const rq = tienda.get(extras[adicionales.length]!);
              rq.onsuccess = () => { adicionales.push(rq.result); leerAdicionales(principal); };
            } catch (e) {
              abortar(clasificar(e, "lectura_fallida"));
            }
          };
          const lectura = tienda.get(clave);
          lectura.onsuccess = () => leerAdicionales(lectura.result);
        } catch (e) {
          return resolve(clasificar(e, "escritura_fallida"));
        }
        // Éxito SOLO con la transacción confirmada.
        tx.oncomplete = () => resolve(interno ?? exito(resultado as R));
        tx.onabort = () => resolve(interno ?? clasificar(tx.error, "escritura_fallida"));
        tx.onerror = () => { /* el detalle llega por onabort */ };
      });
    },

    async listar(indice, valor) {
      const a = await abrir();
      if (!a.ok) return a;
      const tx = transaccion(a.valor, "readonly");
      if ("ok" in tx) return tx;
      return new Promise((resolve) => {
        let filas: unknown[] = [];
        try {
          const req = tx.objectStore(TIENDA).index(indice).getAll(valor);
          req.onsuccess = () => { filas = req.result as unknown[]; };
        } catch (e) {
          try { tx.abort(); } catch { /* ya cerrada */ }
          return resolve(clasificar(e, "lectura_fallida"));
        }
        tx.oncomplete = () => resolve(exito(filas));
        tx.onabort = () => resolve(clasificar(tx.error, "lectura_fallida"));
        tx.onerror = () => { /* el detalle llega por onabort */ };
      });
    },
  };
}
