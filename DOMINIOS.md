# Dominios por empresa (sin revolver datos)

Cada dominio apunta a la **misma** app Node, pero el middleware fija la empresa según el host.

## Ejemplos de URL

| Dominio | Empresa | RRHH | Operaciones |
|---------|---------|------|-------------|
| `logiserviciosmonaco.com` | KT / Mónaco | `/dashboard-rrhh` | `/dashboard-operaciones` |
| `tarimascenter.com` | Tarimas | `/dashboard-rrhh` | (si aplica) |

El usuario ve solo esa empresa. No pasa por selector multiempresa.

## Configuración en Hostinger

1. En hPanel, asigna cada dominio al **mismo** sitio Node de la plataforma (o aliases).
2. Variable de entorno (recomendado):

```
EMPRESA_DOMINIOS={"logiserviciosmonaco.com":"kt-monaco","www.logiserviciosmonaco.com":"kt-monaco","tarimascenter.com":"tarimas","www.tarimascenter.com":"tarimas"}
```

3. Reinicia el sitio Node.

Si ya hay web pública en `logiserviciosmonaco.com`, opciones:

- **A)** `app.logiserviciosmonaco.com` → plataforma (recomendado; no pisa la web actual)
- **B)** Rutas del sistema en el mismo dominio (`/dashboard-rrhh`, `/login`) y la web en `/` con cuidado de no chocar

## Mapa por defecto en código

Ver `src/lib/dominios.ts`. Ajústalo o sobrescribe con `EMPRESA_DOMINIOS`.

## Flujo

1. Entran a `https://logiserviciosmonaco.com/login`
2. RRHH → `https://logiserviciosmonaco.com/dashboard-rrhh`
3. Operaciones → `https://logiserviciosmonaco.com/dashboard-operaciones`
4. Personal: `/personal` · Vacaciones: `/vacaciones` · TMS: `/tms`
