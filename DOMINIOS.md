# Dominios por empresa

Cada dominio apunta a la misma app Node. El middleware fija la empresa según el host.
Ejemplo: `tarimacenter.com/dashboard-rrhh` → solo Tarimas.

## Asignación

| Dominio | Empresa (slug) | Estado |
|---------|----------------|--------|
| `logiserviciosmonaco.com` | KT / Mónaco (`kt-monaco`) | Confirmado (web ya existe; ideal `app.` para el sistema) |
| `monacoexpres.com` | KT / Mónaco (`kt-monaco`) | En lista Hostinger → mapeado a KT |
| `tarimacenter.com` | Tarimas (`tarimas`) | Confirmado |
| `recicladoraecoplanet.com` | Ecoplanet (`ecoplanet`) | Confirmado |
| `ecoplanetreciclaje.com` | Ecoplanet (`ecoplanet`) | Confirmado (si también lo usan) |
| `fuginsa.com` | ¿Francisco? | **Pendiente** — no mapeado aún |
| `ecowastegt.com` | ¿? | Pendiente |
| `multinegocios12.com` | ¿? | Pendiente |
| `innovacionesplasticas.com` | ¿? | Pendiente |
| Frescofresh | — | Sin dominio en la lista aún |

## URLs del sistema (por dominio de empresa)

Tras login:

- RRHH → `https://DOMINIO/dashboard-rrhh`
- Operaciones → `https://DOMINIO/dashboard-operaciones`
- Personal → `/personal`
- Vacaciones → `/vacaciones`
- Marcajes → `/marcajes`
- TMS (KT) → `/tms`

## Hostinger

1. Dominio con **Configuración pendiente** → Configurar → apuntar al sitio Node de la plataforma  
   (o crear `app.tudominio.com` si la raíz ya tiene página web).
2. Variable de entorno (opcional, sobrescribe el mapa del código):

```
EMPRESA_DOMINIOS={"logiserviciosmonaco.com":"kt-monaco","www.logiserviciosmonaco.com":"kt-monaco","app.logiserviciosmonaco.com":"kt-monaco","monacoexpres.com":"kt-monaco","tarimacenter.com":"tarimas","www.tarimacenter.com":"tarimas","recicladoraecoplanet.com":"ecoplanet","ecoplanetreciclaje.com":"ecoplanet"}
```

3. Redesplegar / reiniciar.

## Cuando confirmen Francisco

Avisar el dominio (¿`fuginsa.com`?) y se agrega:

```json
"fuginsa.com": "francisco",
"www.fuginsa.com": "francisco"
```
