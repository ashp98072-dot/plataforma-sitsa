# Despliegue en Hostinger — Plataforma SITSA

App: **Next.js SSR + MySQL**. Crea un sitio Node.js **nuevo** (aparte de asistencias).

> Nota: Hostinger Ilimitado sirve para prototipo. A largo plazo conviene VPS.

## Checklist

1. Crear **base MySQL nueva** (no reutilizar la de asistencias)  
2. Importar `sql/schema.sql` y luego `sql/seed-usuarios.sql`  
3. Subir el ZIP o conectar GitHub `plataforma-sitsa`  
4. Node **20/22**, build `build`, output `.next`  
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
| Node.js | **20** o **22** |
| Build | `build` |
| Output | `.next` |
| Start | `npm run start:hostinger` (recomendado) o `npm run start` |

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
| Página sin estilos / CSS 404 en consola | El HTML apunta a un CSS de un build viejo. **Redeploy completo** (Build + Start), luego en el navegador **Ctrl+F5** o ventana privada. No mezcles ZIP viejo con build nuevo. |
| Sigue sin CSS | En hPanel verifica Output = `.next` y Start = `npm run start:hostinger`. Reinicia el sitio Node. |

---

## Relación con asistencias

| App | Repo / carpeta | Base MySQL |
| --- | --- | --- |
| Asistencias | `control_asistencias` / `web/` | la actual en Hostinger |
| Plataforma | `plataforma-sitsa` / `plataforma/` | **otra base nueva** |
