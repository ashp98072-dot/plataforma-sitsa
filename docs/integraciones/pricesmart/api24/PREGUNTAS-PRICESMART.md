# Preguntas técnicas para PriceSmart — primera homologación

Documento para remitir. **No contiene secretos, credenciales ni datos reales.** No se ha intentado ninguna conexión a endpoints de PriceSmart. Todo lo descrito del lado de Mónaco es un **laboratorio sintético provisional**, no una oferta cerrada.

## 1. Autenticación y confianza (D02)
1. ¿Qué mecanismo usarán para autenticar sus llamadas (OAuth 2.0 client credentials, mTLS, JWT firmado, otro)? Formato exacto de la evidencia (cabecera, codificación, tamaño máximo).
2. Emisor (`iss`), audiencia (`aud`) y ancla de confianza (JWKS/CA/certificado): ¿cómo se publica, cómo se rota y con qué antelación se avisa?
3. Vigencia de credenciales, política de revocación (¿cómo nos notifican una revocación?) y de rotación (¿se solapan dos credenciales?).
4. Scopes o permisos que enviarán por operación (crear, consultar, cancelar). ¿Una credencial por club/país/cuenta?
5. ¿Enviarán una prueba ligada a la solicitud (firma del método, ruta y cuerpo, con identificador único y caducidad corta) para evitar repeticiones? Si no, ¿qué mecanismo anti-replay proponen?
6. Conectividad: ¿IPs/rangos de origen, requisitos de TLS/mTLS, certificados que debemos aportar nosotros?

## 2. Identificadores y ambientes (D03, D04, D15)
7. Identificador de integración y de ambiente (sandbox/producción) que usarán. ¿Credenciales y datos de sandbox estrictamente separados de producción?
8. `externalOrderId`: ¿único por qué ámbito (cuenta/país/club)? Longitud, mayúsculas/minúsculas, caracteres permitidos y si se reutiliza tras cancelar.
9. Catálogo de clubes/países/cuentas autorizados, quién lo mantiene y cómo se comunican altas y bajas.

## 3. Contrato de la orden (D05, D06, D07)
10. Diccionario definitivo: campos obligatorios y opcionales, tipos, longitudes, valores permitidos. Hoy nuestro laboratorio solo usa: referencia, club de origen, destinatario (nombre), dirección y fecha de entrega (y notas). ¿Qué más envían (contacto, coordenadas, ventana horaria, ítems/bultos/peso)?
11. ¿Un pedido = una entrega? ¿Habrá varias entregas por orden, entregas parciales, reintentos de entrega o viajes compartidos?
12. Fechas: zona horaria de referencia, ventanas horarias, reprogramaciones, y qué esperan si la fecha ya pasó.
13. Ejemplos **ficticios** válidos e inválidos que PriceSmart considere canónicos.

## 4. Estados y respuestas (D08, D12, D13)
14. Lista oficial de estados que necesitan ver y sus transiciones válidas. Nuestra propuesta (derivada de nuestro sistema): recibida, en revisión, rechazada, cancelada, programada, cargada, en tránsito, descargada sin confirmar, cerrada administrativamente y «requiere revisión». ¿Es suficiente?
15. ¿Qué constituye prueba de entrega para ustedes (actor, hora, evidencia, parciales)? Mónaco **no** afirmará una entrega por cierre administrativo, descarga o fotografías mientras no se defina.
16. ¿Basta con consulta (GET) o necesitan notificaciones/callbacks/acuses? Formato de errores y uso de `Retry-After`.
17. ¿Cómo desean recibir el acuse de una orden recibida (síncrono 202 con identificador) y qué debe hacer su sistema ante errores transitorios?

## 5. Cancelación (D09)
18. ¿Quién puede cancelar, en qué estados y con qué motivos? ¿Cómo debe tratarse una cancelación de una orden ya programada, en ruta o descargada, o en un viaje compartido? (Hoy Mónaco solo registra la solicitud y Operaciones decide; no se cancela automáticamente.)
19. Método y ruta exactos de la cancelación y el acuse esperado (síncrono o solicitud durable).
20. ¿Existen compensaciones/penalizaciones asociadas a la cancelación?

## 6. Reintentos, capacidad y operación (D10, D11)
21. ¿Enviarán `Idempotency-Key`? Plazo de reintentos, timeouts, orden de mensajes, y qué ocurre si reenvían la misma orden con contenido distinto (hoy respondemos 409).
22. Volumen esperado (pedidos/día, picos, ráfagas), tamaño máximo de cuerpo y latencia objetivo (SLA).

## 7. Privacidad y aceptación (D14, D15)
23. Clasificación de datos personales en la orden, requisitos de residencia, cifrado, retención y supresión.
24. Criterios formales de aceptación de la homologación, responsables de cada lado y calendario de pruebas.
