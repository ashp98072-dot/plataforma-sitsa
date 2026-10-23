# Despliegue en Hostinger — Plataforma SITSA

App: **Next.js SSR + MySQL**. Crea un sitio Node.js **nuevo** (aparte de asistencias).

> Nota: Hostinger Ilimitado sirve para prototipo. A largo plazo conviene VPS.

## Checklist

1. Crear **base MySQL nueva** (no reutilizar la de asistencias)  
2. Importar `sql/schema.sql` y luego `sql/seed-usuarios.sql`  
3. Subir el ZIP o conectar GitHub `plataforma-sitsa`  
4. Node **20.19+ / 22.12+ / 24+**, build `build`, output `.next`
5. Variables `DB_*` + `AUTH_SECRET` (o archivo `.builds/config/.env`)  
6. Deploy → login `admin` / `admin123`

---

## 1. Base de datos MySQL (hPanel)

1. **Bases de datos → MySQL → Crear**
   - Nombre sugerido: `plataforma` (Hostinger le pone prefijo `uXXXX_`)
2. Crear usuario MySQL y asignarlo a esa base (todos los privilegios).
3. Anota: `DB_NAME`, `DB_USER`, `DB_PASSWORD`.
4. **phpMyAdmin** → selecciona esa base → **Importar**:
   1. Primero: `sql/schema.sql`
   2. Después: `sql/seed-usuarios.sql`

`DB_HOST` en la app: usa `127.0.0.1` (no `localhost`).

---

## 2. Empaquetar / subir

### Opción A — ZIP

En tu PC:

```powershell
cd "C:\Users\Admin\Downloads\Proyecto\Control de asistencias\plataforma"
npm run pack:hostinger
```

ZIP: `dist-hostinger/plataforma-sitsa.zip`

hPanel → **Sitios web** → **Node.js** → subir ZIP.

### Opción B — GitHub

Repo: https://github.com/ashp98072-dot/plataforma-sitsa  

hPanel → Import Git Repository → rama `main`.

---

## 3. Ajustes Node.js

| Campo | Valor |
| --- | --- |
| Framework | Next.js / `next` |
| Node.js | **22.12+ recomendado**; también compatible con **20.19+** o **24+**, con la salvedad de loaders indicada abajo |
| Build | `build` |
| Output | `.next` |
| Start | `npm run start:hostinger` (recomendado) o `npm run start` |

### Dependencias y arranque de producción

Instala desde el lockfile con `npm ci` antes de `npm run build`: Tailwind,
TypeScript y las herramientas de build necesitan dependencias de desarrollo en
esa etapa. Una vez generado `.next`, `npm prune --omit=dev` permite dejar solo
las dependencias de ejecución. Si hPanel separa build y runtime, aplica la poda
únicamente al artefacto de runtime, después del build; el siguiente build debe
volver a instalar sus herramientas.

El proceso público debe arrancar con `NODE_ENV=production` y el comando Start
indicado arriba. No usar `npm run dev`, `npm run test:watch`, Vite ni Vitest como
servidores públicos. `npm run dev` se limita ahora a localhost para desarrollo
local. No publiques puertos de herramientas auxiliares.

**Build en Hostinger:** Next 16.4.1 cambia automáticamente `workerThreads` a
`childProcesses` en Node >=24.13.1 por una protección ante un fallo conocido de
Node. Esa sustitución puede reactivar el problema de procesos de loaders en
Hostinger compartido, aunque `cpus: 1` siga vigente. Para conservar los loaders
workerThreads, usa la línea Node 22 admitida por `engines.node` y comprueba el
log del build. No activar `forceWorkerThreads` para saltarse esa protección.
La validación local y las versiones exactas están en el informe de seguridad.

La actualización y sus límites de validación están documentados en
[SECURITY-PR512-DEPENDENCIAS.md](docs/SECURITY-PR512-DEPENDENCIAS.md). Este cambio
no ejecuta un deploy; la revisión independiente y la integración preceden
cualquier despliegue autorizado.

---

## 4. Variables de entorno

En el panel del app **o** en File Manager:

`.builds/config/.env` (más fiable si el panel falla):

```
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=uXXXX_plataforma
DB_PASSWORD=tu_password
DB_NAME=uXXXX_plataforma
AUTH_SECRET=secreto-largo-aleatorio-min-16
```

Plantilla: `env.hostinger.example`

Reinicia el app tras guardar.

---

## 5. Login

- `admin` / `admin123`
- `rrhh` / `rrhh123`
- `contabilidad` / `conta123`
- `operaciones` / `ops123` (solo KT)
- `predios` / `predios123` (solo KT)

Cambia las contraseñas después del primer acceso.

---

## Problemas frecuentes

| Síntoma | Qué hacer |
| --- | --- |
| ECONNREFUSED / Access denied | `DB_HOST=127.0.0.1`, usuario/base exactos del panel |
| Tablas no existen | Importaste `schema.sql` en la base correcta |
| Login falla | Importaste `seed-usuarios.sql` |
| Sesión no persiste | `AUTH_SECRET` fijo (≥16 chars) |
| 503 | Build OK, Node 20+, restart |
| Página sin estilos / CSS 404 en consola | El HTML apunta a un CSS de un build viejo (caché del navegador o CDN). **Redeploy completo** (Build + Start), luego en el navegador **Ctrl+F5** o ventana privada. No mezcles ZIP viejo con build nuevo. En otras PCs también: pedir Ctrl+F5 o borrar caché del sitio. |
| Sigue sin CSS | En hPanel verifica Output = `.next` y Start = `npm run start:hostinger`. Reinicia el sitio Node. Confirma que el deploy terminó (no un deploy parcial). |
| Página en blanco / `HTTP ERROR 429` | Hostinger está limitando peticiones (Too Many Requests). Espera 1–2 min, cierra pestañas extra del mismo sitio, entra por `/login` (no recargues el dashboard a lo loco). Redeploy con el fix de `prefetch={false}` en dashboards. Si persiste, reinicia el sitio Node en hPanel. |
| Import Excel: error genérico | Tras redeploy, la app muestra **fila + empleado/vehículo + motivo** en pantalla. Corrige esas filas en el Excel y vuelve a importar. |

---

## Relación con asistencias

| App | Repo / carpeta | Base MySQL |
| --- | --- | --- |
| Asistencias | `control_asistencias` / `web/` | la actual en Hostinger |
| Plataforma | `plataforma-sitsa` / `plataforma/` | **otra base nueva** |
