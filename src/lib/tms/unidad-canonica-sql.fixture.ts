/** E/S SQL para los arneses de handlers: ejecutan los resolvedores REALES.
 * Este esquema sintético no tiene fusiones ni maestro físico instalado.
 * No sustituye decisiones de identidad, acceso, unicidad o transacciones.
 * Los esquemas con guardas/alias/identidad física se verifican en MariaDB real. */
type Vehiculo = { id:number; empresa_id:number; placa:string; activo:number; estado:string };
type Unidad = { id:number; empresa_id:number; placa:string; flota_vehiculo_id:number|null };
export function modeloSqlUnidadTms(empresaId:number, vehiculos:Vehiculo[] = []) {
  const modelo = { empresaActiva:true, unidades:[] as Unidad[] };
  return {
    modelo,
    consultar(sql:string, args:unknown[] = []):Record<string,unknown>[]|undefined {
      if(sql === "SELECT id FROM empresas WHERE id=? AND activa=1 FOR UPDATE")
        return modelo.empresaActiva && Number(args[0])===empresaId ? [{id:empresaId}] : [];
      if(sql.includes('information_schema.TABLES') && (sql.includes("'flota_vehiculos_fusiones'") || sql.includes("'flota_identidades_fisicas'"))) return [];
      if(sql.startsWith('SELECT v.id,v.empresa_id,v.placa,v.activo,v.estado FROM flota_vehiculos v WHERE')) {
        const visibles=vehiculos.filter(v=>v.empresa_id===empresaId);
        if(!args.slice(-2).every(e=>Number(e)===empresaId)) return [];
        if(sql.includes('WHERE v.id=?')) return visibles.filter(v=>v.id===Number(args[0]));
        if(sql.includes('WHERE v.id IN (')) return visibles.filter(v=>args.slice(0,-2).map(Number).includes(v.id));
        if(sql.includes('WHERE (v.empresa_id=?') && sql.includes('v.activo=1')) return visibles.filter(v=>v.activo===1);
        throw Error('Consulta Flota desconocida en modelo SQL de unidad TMS');
      }
      if(sql === 'SELECT id,placa,flota_vehiculo_id FROM tms_unidades WHERE empresa_id=? ORDER BY id FOR UPDATE')
        return modelo.unidades.filter(u=>u.empresa_id===Number(args[0]));
      if(sql === 'SELECT id FROM tms_unidades WHERE empresa_id=? AND placa=? AND flota_vehiculo_id <=> ?')
        return modelo.unidades.filter(u=>u.empresa_id===Number(args[0]) && u.placa===args[1] && u.flota_vehiculo_id===args[2]);
      return undefined; // Las demás consultas pertenecen al modelo propio de cada handler.
    },
    insertar(sql:string, args:unknown[], id:number) {
      if(sql !== 'INSERT INTO tms_unidades(empresa_id,placa,tipo,flota_vehiculo_id) VALUES(?,?,?,?)') return;
      if(Number(args[0])!==empresaId || !modelo.empresaActiva) throw Error('INSERT fuera del ámbito empresarial del modelo');
      if(args[3]!==null && !vehiculos.some(v=>v.id===Number(args[3]) && v.empresa_id===empresaId)) throw Error('FK Flota inexistente en el modelo');
      if(modelo.unidades.some(u=>u.id===id || (u.empresa_id===empresaId && u.placa===args[1]))) throw Error('Unidad duplicada en el modelo');
      modelo.unidades.push({id,empresa_id:Number(args[0]),placa:String(args[1]),flota_vehiculo_id:args[3]===null?null:Number(args[3])});
    },
  };
}
