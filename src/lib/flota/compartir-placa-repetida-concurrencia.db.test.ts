import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import mysql from "mysql2/promise";

const h = vi.hoisted(() => ({ pool: null as unknown }));
vi.mock("@/lib/db", () => ({ getPool: () => h.pool }));
import { conflictosAlCompartirTx, ErrorIdentidadVehiculo, escribirVehiculos, exigirPlacaLibreTx, PLACA_REPETIDA_AL_COMPARTIR } from "./vehiculos-escritura";

/**
 * CONCURRENCIA contra una MariaDB LOCAL y DESECHABLE (127.0.0.1, root sin contraseña). Se OMITE sin `FLOTA_CANON_DB_PORT`.
 * Demuestra que una compartición y un alta de ficha en la empresa DESTINO no pueden escapar la una de la otra: con el bloqueo de las empresas
 * destino (escribirVehiculos(..., tambien)) exactamente una de las dos gana, SIN depender del nivel de aislamiento (se prueba con REPEATABLE READ
 * y con READ COMMITTED, que no usa bloqueos de hueco). `alta` y `compartir` componen las mismas piezas reales que usan las rutas
 * (escribirVehiculos + exigirPlacaLibreTx / conflictosAlCompartirTx). Esquema reducido y datos sintéticos; nada toca producción.
 */
const PUERTO = process.env.FLOTA_CANON_DB_PORT;
const base = `compartir_concurrencia_${process.pid}`;
let admin: mysql.Connection;
const pools: Record<string, mysql.Pool> = {};
const DUENA = 4, DESTINO = 1, PLACA = "C-092BXF";
const NIVELES = ["REPEATABLE READ", "READ COMMITTED"] as const;

const pausa = () => { let liberar!: () => void; const espera = new Promise<void>(r => { liberar = r; }); let llego!: () => void; const alcanzado = new Promise<void>(r => { llego = r; }); return { espera, liberar, alcanzado, llego }; };
const esperar = (ms: number) => new Promise(r => setTimeout(r, ms));
/** ¿Hay una sentencia de bloqueo de empresas esperando? (mismo proceso y misma sentencia en dos lecturas separadas 400 ms: no avanza). */
async function hayEsperaDeBloqueo(timeout = 3000) {
  const leer = async () => ((await admin.query("SELECT ID, INFO FROM information_schema.PROCESSLIST WHERE DB=DATABASE() AND INFO LIKE 'SELECT id FROM empresas%FOR UPDATE'"))[0] as { ID: number; INFO: string }[]);
  for (let t = 0; t < timeout; t += 50) {
    const antes = await leer();
    if (antes.length) { await esperar(400); const despues = await leer(); return despues.some(d => antes.some(a => a.ID === d.ID && a.INFO === d.INFO)); }
    await esperar(50);
  }
  return false;
}
/** Espera a que la transacción pausada llegue a su punto de pausa; si termina antes (error), lo muestra en vez de colgarse. */
const hastaPausa = (p: { alcanzado: Promise<void> }, tx: Promise<unknown>) => Promise.race([p.alcanzado, tx.then(r => { throw new Error(`la transacción terminó antes de la pausa: ${JSON.stringify(r, Object.getOwnPropertyNames(Object(r)))}`); })]);
async function resultado<T>(p: Promise<T>) { return p.then(v => ({ ok: true as const, v }), e => ({ ok: false as const, e: e as { status?: number; codigo?: string; message?: string; errno?: number } })); }

/** Alta de una ficha propia: lo que hacen POST vehículos, propiedad e importación (bloquea la fila de SU empresa primero). */
const alta = (empresa: number, placa: string, hooks: { despuesDeInsertar?: () => Promise<void> } = {}) =>
  escribirVehiculos(empresa, async c => {
    await exigirPlacaLibreTx(c, empresa, placa);
    await c.query("INSERT INTO flota_vehiculos (empresa_id, placa) VALUES (?,?)", [empresa, placa]);
    await hooks.despuesDeInsertar?.();
  });
/** Compartición: revisa y escribe el acceso, como el PATCH (sin confirmación). `bloquearDestino=false` reproduce el comportamiento ANTERIOR (solo la dueña). */
const compartir = (duena: number, vehiculoId: number, destinos: number[], hooks: { despuesDeComprobar?: () => Promise<void> } = {}, bloquearDestino = true) =>
  escribirVehiculos(duena, async c => {
    const conflictos = await conflictosAlCompartirTx(c, vehiculoId, destinos);
    if (conflictos.length) throw new ErrorIdentidadVehiculo("conflicto", 409, PLACA_REPETIDA_AL_COMPARTIR);
    await hooks.despuesDeComprobar?.();
    for (const d of destinos) await c.query("INSERT IGNORE INTO flota_vehiculo_acceso (vehiculo_id, empresa_id) VALUES (?,?)", [vehiculoId, d]);
  }, bloquearDestino ? destinos : []);

async function estado() {
  const [propias] = await admin.query("SELECT COUNT(*) n FROM flota_vehiculos WHERE empresa_id=? AND activo=1 AND REPLACE(placa,'-','')=REPLACE(?, '-','')", [DESTINO, PLACA]) as unknown as [{ n: number }[]];
  const [accesos] = await admin.query("SELECT COUNT(*) n FROM flota_vehiculo_acceso WHERE empresa_id=? AND vehiculo_id=651", [DESTINO]) as unknown as [{ n: number }[]];
  return { fichasPropiasDestino: Number(propias[0].n), compartidaConDestino: Number(accesos[0].n) };
}
async function reiniciar() {
  await admin.query("DELETE FROM flota_vehiculo_acceso; DELETE FROM flota_vehiculos; ALTER TABLE flota_vehiculos AUTO_INCREMENT=700");
  await admin.query("INSERT INTO flota_vehiculos (id, empresa_id, placa) VALUES (651, ?, ?)", [DUENA, PLACA]);
}

describe.skipIf(!PUERTO)("compartición y alta concurrentes en la empresa destino (MariaDB aislada)", () => {
  beforeAll(async () => {
    admin = await mysql.createConnection({ host: "127.0.0.1", port: Number(PUERTO), user: "root", password: "", multipleStatements: true });
    await admin.query(`DROP DATABASE IF EXISTS ${base}; CREATE DATABASE ${base} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; USE ${base}`);
    await admin.query(`
      CREATE TABLE empresas (id INT PRIMARY KEY, nombre VARCHAR(80), activa TINYINT NOT NULL DEFAULT 1) ENGINE=InnoDB;
      CREATE TABLE flota_vehiculos (id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, placa VARCHAR(40) NOT NULL, chasis VARCHAR(80) NULL, tipo_unidad VARCHAR(20) NOT NULL DEFAULT 'VEHICULO',
        activo TINYINT NOT NULL DEFAULT 1, UNIQUE KEY uq_flota_placa (empresa_id, placa)) ENGINE=InnoDB;
      CREATE TABLE flota_vehiculo_acceso (vehiculo_id INT NOT NULL, empresa_id INT NOT NULL, PRIMARY KEY (vehiculo_id, empresa_id)) ENGINE=InnoDB;
      INSERT INTO empresas VALUES (1,'Mónaco',1),(4,'Frescofresh',1),(5,'Otra',1);`);
    for (const nivel of NIVELES) {
      const pool = mysql.createPool({ host: "127.0.0.1", port: Number(PUERTO), user: "root", password: "", database: base, connectionLimit: 10 });
      pool.on("connection", (c) => { void c.query(`SET SESSION TRANSACTION ISOLATION LEVEL ${nivel}`); });
      pools[nivel] = pool;
    }
  }, 120_000);
  afterAll(async () => { try { for (const p of Object.values(pools)) await p.end(); await admin?.query(`DROP DATABASE IF EXISTS ${base}`); await admin?.end(); } catch { /* mejor esfuerzo */ } });

  describe.each(NIVELES)("con %s", (nivel) => {
    it("compartición primero (pausada tras comprobar): el alta en el destino ESPERA y luego se rechaza; no quedan dos fichas", async () => {
      h.pool = pools[nivel]; await reiniciar();
      const p = pausa();
      const comp = resultado(compartir(DUENA, 651, [DESTINO], { despuesDeComprobar: async () => { p.llego(); await p.espera; } }));
      await hastaPausa(p, comp);
      const altaP = resultado(alta(DESTINO, PLACA));
      expect(await hayEsperaDeBloqueo()).toBe(true); // el alta está bloqueada por la fila de la empresa destino
      p.liberar();
      const [c, a] = [await comp, await altaP];
      expect(c.ok).toBe(true);
      expect(a.ok).toBe(false); if (!a.ok) expect(a.e.status).toBe(409); // la placa ya corresponde a una unidad compartida vigente
      expect(await estado()).toEqual({ fichasPropiasDestino: 0, compartidaConDestino: 1 });
    });

    it("alta primero (pausada antes de confirmar): la compartición ESPERA, ve la ficha nueva y se rechaza con conflicto", async () => {
      h.pool = pools[nivel]; await reiniciar();
      const p = pausa();
      const altaP = resultado(alta(DESTINO, PLACA, { despuesDeInsertar: async () => { p.llego(); await p.espera; } }));
      await hastaPausa(p, altaP);
      const comp = resultado(compartir(DUENA, 651, [DESTINO]));
      expect(await hayEsperaDeBloqueo()).toBe(true); // la compartición está bloqueada por la fila de la empresa destino
      p.liberar();
      const [a, c] = [await altaP, await comp];
      expect(a.ok).toBe(true);
      expect(c.ok).toBe(false); if (!c.ok) { expect(c.e.status).toBe(409); expect(c.e.codigo).toBe(PLACA_REPETIDA_AL_COMPARTIR); }
      expect(await estado()).toEqual({ fichasPropiasDestino: 1, compartidaConDestino: 0 });
    });

    it("comparticiones CRUZADAS simultáneas (1→4 y 4→1) nunca se bloquean en orden inverso: sin interbloqueos", async () => {
      h.pool = pools[nivel];
      for (let i = 0; i < 12; i++) {
        await reiniciar();
        await admin.query("INSERT INTO flota_vehiculos (id, empresa_id, placa) VALUES (900, 1, 'C-900AAA')");
        const [x, y] = await Promise.all([resultado(compartir(DUENA, 651, [DESTINO])), resultado(compartir(DESTINO, 900, [DUENA]))]);
        for (const r of [x, y]) { if (!r.ok) expect(r.e.errno, `iteración ${i}`).not.toBe(1213); }
        expect(x.ok && y.ok, `iteración ${i}`).toBe(true);
      }
    });

    it("repetido 15 veces con tiempos libres: nunca queda una ficha propia Y una compartida con la misma placa en el destino", async () => {
      h.pool = pools[nivel];
      for (let i = 0; i < 15; i++) {
        await reiniciar();
        const lanzar = [() => resultado(compartir(DUENA, 651, [DESTINO])), () => resultado(alta(DESTINO, PLACA))];
        if (i % 2) lanzar.reverse();
        await Promise.all(lanzar.map(f => f()));
        const e = await estado();
        expect(e.fichasPropiasDestino + e.compartidaConDestino, `iteración ${i}`).toBe(1); // exactamente una ganó
      }
    });
  });

  it("CONTROL: sin bloquear la empresa destino (comportamiento anterior) el alta NO espera en el bloqueo de la empresa; con el cambio SÍ espera (es lo que detectan las pruebas anteriores)", async () => {
    // Con el comportamiento anterior la serialización dependía del plan de ejecución y de bloqueos de hueco; ahora es explícita: la fila de la empresa destino.
    h.pool = pools["READ COMMITTED"]; await reiniciar();
    const p = pausa();
    const comp = resultado(compartir(DUENA, 651, [DESTINO], { despuesDeComprobar: async () => { p.llego(); await p.espera; } }, false));
    await hastaPausa(p, comp);
    const altaP = resultado(alta(DESTINO, PLACA));
    expect(await hayEsperaDeBloqueo(1200)).toBe(false); // no hay espera sobre la fila de la empresa destino: nada la serializa explícitamente
    p.liberar();
    await Promise.all([comp, altaP]);
  });
});
