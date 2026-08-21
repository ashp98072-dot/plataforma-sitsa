@AGENTS.md
## Planes activos multi-sesión

Antes de asumir que un proyecto grande empieza de cero, revisa si existe un
archivo `PLAN-*.md` en la raíz del repo — documentan trabajo en curso que
abarca varias sesiones/conversaciones de Claude, con checkboxes de estado real.

- `PLAN-PORTAL-PILOTOS.md` — portal del piloto (marcaje con km, ruta
  asignada) + marcaje multiubicación para Grupo SITSA.

# Plataforma SITSA — Reglas para Claude Code

## 1. Principio general
Este es un proyecto real en desarrollo y potencialmente conectado a información empresarial.

Antes de modificar código:
- inspecciona la implementación existente;
- busca helpers, servicios, componentes y patrones reutilizables;
- no dupliques lógica existente;
- no inventes requisitos;
- no asumas reglas de negocio no documentadas.

Si falta una decisión funcional importante, pregunta antes de implementar.

## 2. Alcance
Trabaja únicamente en el alcance solicitado.

No aproveches una tarea para:
- refactorizar módulos no relacionados;
- corregir deuda técnica ajena;
- cambiar arquitectura;
- actualizar dependencias;
- modificar configuración;
- cambiar documentación no relacionada.

Si encuentras otro problema, repórtalo pero no lo corrijas sin autorización.

## 3. Cambios pequeños
Preferir cambios pequeños, revisables y reversibles.

Cuando una tarea sea grande:
1. analiza;
2. propone un plan;
3. divide el trabajo en pasos;
4. espera autorización si el alcance implica varios módulos o decisiones de arquitectura;
5. implementa por etapas.

No continúes automáticamente con la siguiente fase de un roadmap solo porque la anterior terminó.

## 4. Base de datos
La base de datos requiere especial cuidado.

Nunca:
- ejecutes DROP;
- ejecutes TRUNCATE;
- elimines datos;
- modifiques datos masivamente;
- ejecutes migraciones;
- cambies esquemas;
- hagas ALTER TABLE;
- crees o elimines tablas en una base real;

sin autorización explícita.

Puedes preparar SQL para revisión, pero no ejecutarlo automáticamente.

Antes de modificar queries existentes revisa:
- aislamiento por empresa;
- empresa_id cuando corresponda;
- relaciones;
- transacciones;
- concurrencia;
- integridad de datos.

## 5. Multiempresa
El sistema es multiempresa.

Nunca asumas que un registro pertenece a la empresa correcta únicamente porque su ID existe.

Toda funcionalidad que maneje información empresarial debe respetar el aislamiento entre empresas existente en el proyecto.

Reporta cualquier posible fuga de datos entre empresas.

## 6. Seguridad
Nunca debilites:
- autenticación;
- autorización;
- sesiones;
- validación de empresa;
- permisos por rol;
- controles de acceso.

Datos enviados por el cliente no deben considerarse confiables.

Cuando sea posible, identidad, empleado, empresa y permisos deben obtenerse de la sesión o mecanismos existentes del servidor.

## 7. Git
Por defecto Claude NO debe ejecutar:
- git commit;
- git push;
- git pull;
- git reset;
- git rebase;
- git merge;
- force push;
- creación o eliminación de ramas;

salvo autorización explícita.

Sí puede utilizar comandos de lectura como:
- git status;
- git diff;
- git log;
- git show.

El usuario controla commit y push.

## 8. Verificación
Después de modificar código TypeScript ejecutar como mínimo:

npx tsc --noEmit

También ejecutar las verificaciones disponibles y relevantes para los archivos modificados.

Si npm run lint falla por deuda técnica preexistente:
- no corregir automáticamente archivos ajenos;
- comprobar si los archivos modificados introducen errores nuevos;
- reportar claramente la diferencia.

No afirmar que algo "funciona" únicamente porque TypeScript compila.

Distinguir entre:
- compilación correcta;
- lint correcto;
- prueba manual;
- prueba automatizada;
- prueba contra base de datos.

## 9. Producción
No ejecutar despliegues ni modificar producción sin autorización explícita.

No modificar:
- variables de entorno;
- credenciales;
- secretos;
- configuración de hosting;
- DNS;
- servicios externos;

sin autorización.

Nunca mostrar secretos encontrados en archivos.

## 10. Documentación
No modificar roadmaps o documentación simplemente para marcar una fase como terminada sin verificar que la implementación fue validada.

Diferenciar:
IMPLEMENTADO
VERIFICADO TÉCNICAMENTE
PROBADO
APROBADO PARA PRODUCCIÓN

No son equivalentes.

## 11. Comunicación
Antes de una modificación importante indicar:
- qué se pretende cambiar;
- qué archivos probablemente serán afectados;
- riesgos relevantes.

Después indicar:
- archivos modificados;
- qué se implementó;
- verificaciones realizadas;
- verificaciones pendientes;
- riesgos encontrados.

## 12. Regla de parada
Si una tarea requiere una decisión de negocio, cambio de arquitectura, migración riesgosa, modificación de producción o ampliación significativa del alcance:

DETENTE Y PREGUNTA.
