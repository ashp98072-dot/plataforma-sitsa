# PR A: pilotos y equivalencias de nombres

Shell aporta solo nombres. Antes de crear una identidad se revisan empleados de la empresa y equivalencias confirmadas. Un nombre completo normalizado, único y sin otros candidatos se propone automáticamente; parciales, variaciones, erratas y homónimos requieren confirmación. La similitud nunca vincula personas. Una identidad reportada no acredita empleo ni contrato.

La revisión agrupa nombres distintos para todo el archivo. Confirmar empleado guarda la variante; confirmar «ninguno corresponde» permite guardar un piloto reportado. Ambas decisiones se aplican a todos los consumos seleccionados del grupo. Vista previa y consulta de reanudación son de lectura. Solo confirmar/reanudar persiste dentro de la transacción del consumo; errores revierten también identidades y equivalencias. Se revalidan empresa, empleado activo y decisión vigente. Una elección automática incompatible se rechaza. Una elección manual distinta conserva el destino anterior, marca el nombre para revisión permanente y registra la nueva decisión en el diario; nunca sobrescribe identidades ni vuelve a autovincular un nombre acreditado ambiguo.

Normalización versionada NFC, mayúsculas y espacios conserva acentos y puntuación para las claves persistidas; el buscador de candidatos tolera tildes y erratas sin convertirlas en equivalencias. UNIQUE por empresa/versión/hash, comprobación de texto, bloqueo empresarial y búsqueda de ID tras upsert evitan duplicaciones concurrentes sin confiar en insertId. Solo nombre no permite distinguir homónimos nuevos no informados: ante ambigüedad conocida se exige revisión. Un identificador adicional futuro deberá tener tipo, emisor y ámbito explícitos; no se supone que Shell ya lo proporciona.

Cada consumo nuevo conserva el nombre exacto del Excel. IDs, huellas y originales históricos permanecen intactos; no se asignan retrospectivamente personas. Reporte con filtros, paginación, totales por moneda/producto y CSV acotado/protegido de fórmulas. Los históricos sin vínculo continúan visibles por nombre original.

SQL separado de unidades y del ledger #616/#620. Sin estas tres tablas, los flujos anteriores conservan el nombre y sus capacidades; no se simula persistencia ni se guardan decisiones nuevas. Una instalación parcial bloquea con 503. La unidad externa sin vínculo laboral sigue requiriendo su CHECK aprobado; no se activan flags.

Procedimiento manual propuesto, pendiente de auditoría:

1. Respaldo nativo completo privado, SHA-256 y restauración verificada en laboratorio. Capturar históricos y definiciones de triggers antes de aplicar.
2. Ejecutar preflight de este PR por bloques: padres InnoDB, INT signed, índices completos; cero objetos nuevos existentes. Revisar cualquier discrepancia antes de continuar.
3. Ejecutar migración sin --force y detener ante primer error. Solo tres CREATE TABLE nuevos, sin backfill ni ALTER históricos. Ante ejecución parcial, auditar; no repetir a ciegas.
4. Postcheck: tres InnoDB, ocho FK, siete CHECK; tres tablas inicialmente vacías, sin vínculos huérfanos ni equivalencias entre empresas. Comparar captura histórica y triggers.
5. Este PR no ejecuta SQL productivo ni autoriza despliegue o flags.
