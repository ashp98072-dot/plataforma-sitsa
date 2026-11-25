import { describe, expect, it } from 'vitest';
import { anularVenta, registrarVenta } from './ventas';
import { crearCatalogo } from './catalogos';
import { crearBase, hayLaboratorio, instaladorEn, k, opciones, type Fila } from './lab-simplificacion';
import mysql from 'mysql2/promise';
import { prepararBaseHastaVentas } from './lab-simplificacion';
import { ejecutarSimplificacionControlado } from '../../../scripts/ci/canecas/ejecutar-simplificacion-controlado.mjs';
import { ejecutarVentasControlado } from '../../../scripts/ci/canecas/ejecutar-ventas-controlado.mjs';
import { verificarContratoSimplificacion } from '../../../scripts/ci/canecas/contrato-simplificacion.mjs';

const BASES = ['canecas_simp_inst_a', 'canecas_simp_inst_b', 'canecas_simp_inst_c', 'canecas_simp_inst_d', 'canecas_simp_inst_e'];
const instalar = (pool: mysql.Pool) => instaladorEn(pool, c => ejecutarSimplificacionControlado(c));
const estado = async (pool: mysql.Pool) => {
  const [r] = await pool.query<Fila[]>(`SELECT
    (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='canecas_secuencias') secuencias,
    (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='canecas_ventas' AND COLUMN_NAME='direccion_entrega') direccion,
    (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='canecas_productos' AND COLUMN_NAME='activo_unico') activo_unico,
    (SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND EVENT_OBJECT_TABLE='canecas_ventas') triggers`);
  return Object.fromEntries(Object.entries(r[0]).map(([a, b]) => [a, Number(b)]));
};
const sinCambios = { secuencias: 0, direccion: 0, activo_unico: 0, triggers: 2 };
// La columna virtual activo_unico es parte de lo que agrega la migración: se excluye al comparar los datos existentes.
const instantanea = async (pool: mysql.Pool) => Object.fromEntries(await Promise.all(['canecas_productos', 'canecas_compras', 'canecas_recepciones', 'canecas_saldos', 'canecas_movimientos', 'canecas_capas_costo', 'canecas_ventas', 'canecas_clientes'].map(async t => [t, (await pool.query<Fila[]>(`SELECT * FROM ${t}`))[0].map(({ activo_unico: _virtual, ...fila }) => { void _virtual; return fila; })])));

describe.skipIf(!hayLaboratorio)('instalador controlado de la simplificación en MariaDB 11.8.9 desechable', () => {
  it('instala sin alterar datos, es idempotente, conserva el trigger y el instalador anterior de ventas no acepta el esquema nuevo', async () => {
    const pool = await crearBase(BASES[0]);
    try {
      await prepararBaseHastaVentas(pool, { historial: true });
      const cliente = await crearCatalogo(pool, 'clientes', 1, 1, { nombre_comercial: 'Cliente', nit: null, telefono: null, direccion: 'Zona 1' });
      const vieja = await registrarVenta(pool, 1, 1, { clienteId: cliente, productoId: 1, ubicacionId: 1, fechaVenta: '2026-11-10', documento: 'FAC-HIST', cantidad: 4, precio: '95.00', claveOperacion: k(1) }, '2026-11-24');
      expect(await estado(pool)).toEqual(sinCambios);
      const antes = await instantanea(pool);
      expect(await instalar(pool)).toEqual({ instalado: true, yaInstalado: false });
      expect(await estado(pool)).toEqual({ secuencias: 1, direccion: 1, activo_unico: 1, triggers: 2 });
      // Los datos históricos son idénticos salvo la columna nueva (NULL): no se inventan direcciones.
      const despues = await instantanea(pool);
      expect(despues.canecas_ventas.map((f: Fila) => ({ ...f, direccion_entrega: undefined }))).toEqual(antes.canecas_ventas.map((f: Fila) => ({ ...f, direccion_entrega: undefined })));
      expect((despues.canecas_ventas as Fila[]).every(f => f.direccion_entrega === null)).toBe(true);
      expect({ ...despues, canecas_ventas: 0 }).toEqual({ ...antes, canecas_ventas: 0 });
      await instaladorEn(pool, c => verificarContratoSimplificacion(c));
      // Idempotente.
      expect(await instalar(pool)).toEqual({ instalado: false, yaInstalado: true });
      expect(await instantanea(pool)).toEqual(despues);
      // El instalador ANTERIOR no acepta el esquema nuevo: no se relaja su contrato.
      await expect(instaladorEn(pool, c => ejecutarVentasControlado(c))).rejects.toThrow('ventas presentes o instalación parcial');
      // El trigger ampliado protege la dirección y la venta histórica sigue siendo inmutable/anulable.
      await expect(pool.query("UPDATE canecas_ventas SET direccion_entrega='otra' WHERE id=?", [vieja.id])).rejects.toThrow('CANECAS_VENTA_INMUTABLE');
      await expect(pool.query('DELETE FROM canecas_ventas WHERE id=?', [vieja.id])).rejects.toThrow('CANECAS_VENTA_NO_ELIMINABLE');
      expect(await anularVenta(pool, 1, 1, vieja.id, 'prueba')).toEqual({ yaAnulada: false });
      // El código anterior (sin dirección) y el nuevo (con dirección) conviven.
      const legado = await registrarVenta(pool, 1, 1, { clienteId: cliente, productoId: 1, ubicacionId: 1, fechaVenta: '2026-11-11', documento: 'FAC-LEG', cantidad: 1, precio: '95.00', claveOperacion: k(2) }, '2026-11-24');
      const pos = await registrarVenta(pool, 1, 1, { clienteId: cliente, ubicacionId: 1, direccionEntrega: 'Zona 4', cantidad: 1, precio: '95.00', claveOperacion: k(3) });
      const [filas] = await pool.query<Fila[]>('SELECT id,documento,direccion_entrega FROM canecas_ventas WHERE id IN (?,?) ORDER BY id', [legado.id, pos.id]);
      expect(filas).toMatchObject([{ documento: 'FAC-LEG', direccion_entrega: null }, { documento: 'VTA-000001', direccion_entrega: 'Zona 4' }]);
    } finally { await pool.end(); }
  }, 180000);

  it('estado previo incompatible: sin ventas instaladas se detiene sin ejecutar DDL', async () => {
    const pool = await crearBase(BASES[1]);
    try {
      await prepararBaseHastaVentas(pool);
      await pool.query('DROP TABLE canecas_compras_mapeo_proveedor; DROP TABLE canecas_ventas');
      await expect(instalar(pool)).rejects.toThrow(/ventas/);
      expect(await estado(pool)).toMatchObject({ secuencias: 0, direccion: 0, activo_unico: 0 });
    } finally { await pool.end(); }
  }, 180000);

  it('preflight: con más de una caneca activa en una empresa se detiene y no crea nada', async () => {
    const pool = await crearBase(BASES[2]);
    try {
      await prepararBaseHastaVentas(pool, { historial: true });
      await pool.query("INSERT INTO canecas_productos (empresa_id,codigo,nombre,presentacion,capacidad,unidad_capacidad,unidad_inventario) VALUES (1,'B','Otra caneca','Caneca',5,'litros','caneca')");
      await expect(instalar(pool)).rejects.toThrow(/más de una caneca activa/);
      expect(await estado(pool)).toEqual(sinCambios);
      await pool.query('UPDATE canecas_productos SET activo=0 WHERE codigo=?', ['B']);
      await expect(instalar(pool)).resolves.toEqual({ instalado: true, yaInstalado: false });
    } finally { await pool.end(); }
  }, 180000);

  it('estados parciales: se detiene sin ejecutar más DDL y deja el diagnóstico', async () => {
    const pool = await crearBase(BASES[3]);
    try {
      await prepararBaseHastaVentas(pool, { historial: true });
      await pool.query('CREATE TABLE canecas_secuencias (empresa_id INT NOT NULL, tipo VARCHAR(20) NOT NULL, ultimo BIGINT NOT NULL DEFAULT 0, PRIMARY KEY (empresa_id,tipo)) ENGINE=InnoDB');
      await expect(instalar(pool)).rejects.toThrow('simplificación parcial');
      expect(await estado(pool)).toEqual({ secuencias: 1, direccion: 0, activo_unico: 0, triggers: 2 });
      // Completo pero con contrato distinto (tabla manual): se rechaza, no se acepta "arbitrariamente".
      await pool.query('ALTER TABLE canecas_ventas ADD COLUMN direccion_entrega VARCHAR(500) NULL; ALTER TABLE canecas_productos ADD COLUMN activo_unico TINYINT(1) NULL');
      await pool.query("CREATE OR REPLACE TRIGGER trg_can_venta_bu BEFORE UPDATE ON canecas_ventas FOR EACH ROW BEGIN IF NOT (NEW.direccion_entrega <=> OLD.direccion_entrega) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='X'; END IF; END");
      await expect(instalar(pool)).rejects.toThrow('contrato incompatible');
    } finally { await pool.end(); }
  }, 180000);

  it('instalación concurrente: otro proceso con el bloqueo impide instalar', async () => {
    const pool = await crearBase(BASES[4]);
    try {
      await prepararBaseHastaVentas(pool, { historial: true });
      const otra = await mysql.createConnection(opciones(BASES[4]));
      try {
        await otra.query('SELECT GET_LOCK(?, 0)', [`canecas-costos:${BASES[4]}`]);
        await expect(instalar(pool)).rejects.toThrow('instalación concurrente');
        expect(await estado(pool)).toEqual(sinCambios);
      } finally { await otra.end(); }
      await expect(instalar(pool)).resolves.toEqual({ instalado: true, yaInstalado: false });
    } finally { await pool.end(); }
  }, 180000);
});
