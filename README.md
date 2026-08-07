# Plataforma Corporativa Multiempresa (SITSA)

Next.js + MySQL. Login → selector de empresa → módulos por tenant (`/e/[slug]/...`).

## Empresas

| Código | Slug | Módulos |
|--------|------|---------|
| KT | `kt-monaco` | RRHH, TMS, Flota, Contabilidad, CMS |
| FRANCISCO | `francisco` | RRHH, Contabilidad, Reciclaje, CMS |
| TARIMAS | `tarimas` | RRHH, Contabilidad, Tarimas, CMS |
| FRESCOFRESH | `frescofresh` | RRHH, Contabilidad, CMS |
| ECOPLANET | `ecoplanet` | RRHH, Contabilidad, Reciclaje, CMS |

## Roles

| Rol | Empresas | Módulos |
|-----|----------|---------|
| Admin | Todas | Todos |
| RRHH | Todas | RRHH, Usuarios |
| Contabilidad | Todas | Contabilidad |
| Operaciones | Asignadas | TMS, Flota, Reciclaje, Tarimas |
| CoordinadorPredios | Asignadas | Flota (+ lectura TMS) |
| Visualizador | Asignadas | Solo lectura |

## Arranque

```bash
cp .env.example .env.local
# edita DB_* y AUTH_SECRET

npm run db:init
npm run dev
```

http://localhost:3000

### Usuarios seed

- `admin` / `admin123`
- `rrhh` / `rrhh123`
- `contabilidad` / `conta123`
- `operaciones` / `ops123` (solo KT)
- `predios` / `predios123` (solo KT)

## Módulos entregados

0. Núcleo multiempresa + usuarios/empresas + auditoría  
1. RRHH: empleados, marcajes, vacaciones, incidencias, reportes Excel, inventario EPP  
2. TMS: catálogos, planes de viaje, cambios mismo día, evidencias foto+geo  
3. Flota/predios: vehículos, lecturas km, servicios, taller, alertas y costos, inventario de equipo/herramientas (empresa por área + propias del empleado RRHH)  
4. Contabilidad: cuentas, asientos, CxC/CxP (esqueleto migración SKAS)  
5. Reciclaje, Tarimas, CMS + sitio público `/site/[slug]`  

## Relación con apps actuales

- `web/` (asistencias Hostinger): satélite / referencia; lógica se absorbe bajo `empresa_id`  
- `control_flota`: base funcional integrada en módulo Flota  
- SKAS Java: referencia UX; no se modifica  

## Hosting

Preferir VPS/cloud para producción. Hostinger Ilimitado sirve para prototipo.
