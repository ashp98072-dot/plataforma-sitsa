# Prerrequisitos de VM futura — etapa B no ejecutada

Observaciones heredadas de consultas de sólo lectura del host del 2026-11-05. No identifican ni autorizan una VM y deben repetirse al reservar recursos. No se publican IDs físicos, rutas privadas, red ni configuraciones del host.

| Control | Evidencia disponible | Falta antes de autorizar |
|---|---|---|
| RAM | 15.69 GiB utilizables; 3.79 GiB libres en esa consulta | Reservar 4 GiB para guest más margen medido del host; actualmente no demostrado |
| Disco | 39.28 GiB libres en unidad consultada | 40–80 GB privados más reserva y recuperación; capacidad insuficiente para ese plan |
| CPU/virtualización | i5-1235U, hipervisor presente; flags WMI firmware/SLAT/monitor false | Capacidad real del hipervisor elegido y virtualización completa con kernel propio; no inferir incompatibilidad sólo de esos flags |
| Seguridad host | Firewall tres perfiles y protección antivirus/tiempo real activos | No sustituyen reglas IPv4/IPv6, cgroup/BPF y firewall efectivos del guest |
| Disco independiente | Sin evidencia | Identidad/procedencia de imagen y discos nuevos, sin adopción de datadir ni volúmenes productivos |
| Carpetas compartidas | Sin evidencia | Deshabilitadas; ausencia de montajes host/guest y agentes con acceso productivo |
| Portapapeles e integración | Sin evidencia | Portapapeles, arrastrar/soltar y redirección de dispositivos deshabilitados |
| Red controlada | Sin evidencia de VM | Sin bridge productivo, Internet, DNS/metadata ni túneles implícitos; reglas efectivas y canarios autorizados |
| Credenciales | No se accedió a secretos | Identidades sintéticas nuevas, namespace, custodia y ausencia de credenciales productivas; no publicar valores |
| Consola separada | Sin evidencia | Consola privada fuera de banda y rescate independiente del guest |
| Recuperación | Checklist S06 existente | Operador, procedimiento exacto aprobado, backup cifrado independiente, claves fuera del guest y destino nuevo; pruebas reales y RPO/RTO |

Se preservan los gates de [preflight y recuperación](../PREFLIGHT-Y-RECUPERACION.md). El perfil S04 no se desbloquea, no se ejecuta provisionamiento ni SQL y no se declara aislamiento certificado. La VM de laboratorio futura y el runtime de análisis APT son necesidades distintas; no se crea ninguno en este ticket.

Bloqueantes reales: falta de runtime APT autorizado, selección/política pendiente y evidencia física/operativa no reunida. Mejoras no críticas: presentación del inventario, comparación de tamaños y optimización de espacio del medio. Reducir documentación o elegir el perfil más pequeño no elimina los bloqueantes.
