# Decisiones y pendientes

## Decisiones tomadas en esta etapa

### D1 — Mapa: MapLibre GL JS en lugar de Leaflet
El prompt original fijaba Leaflet (lo que usa el portal `derivador`). A pedido
de la Dirección ("precisión, dinamismo, revolucionar este tipo de desarrollo")
se evaluó y se adoptó **MapLibre GL JS** (+ `react-map-gl`):

- **Render WebGL vectorial**: 60 fps con miles de puntos, rotación, pitch,
  animaciones de cámara (`flyTo`), clustering y heatmap nativos. Leaflet es
  raster/DOM y se degrada con volumen.
- **Costo cero**: fork abierto de Mapbox GL v1 (licencia BSD), sin API key.
  Es el estándar de Amazon Location, y de todo el ecosistema post-Mapbox.
- **Teselas base**: en desarrollo se usan los estilos GL gratuitos de CARTO
  (`dark-matter` / `positron`, con atribución). Para producción con SLA se
  recomienda **MapTiler** (~USD 25/mes) o self-hosting de teselas
  (OpenFreeMap/Planetiler) — decisión pendiente de presupuesto (D-abierta 8).
- `@turf/*` y `distritosNuevo.json` siguen siendo compatibles (todo es GeoJSON).

### D2 — Enums extendidos por los datos reales
Al relevar los archivos de la Dirección de Bacheo (20-08-2026):

- `fuente_demanda` suma **`sat`**: 794 intimaciones a la Sociedad Aguas del
  Tucumán (pérdidas que rompen calzada). Es una fuente institucional distinta
  de Atención Ciudadana.
- `tipo_problema` suma **`tapa_registro`** y **`perdida_agua`**: son el 40 %
  de los motivos reales del dataset SAT y despachan distinto (coordinación con
  la SAT vs. cuadrilla propia).
- El consolidado QGIS trae fuentes `DIE (SSGED-SG)` → `redes_sociales` y
  `DRR (SSGED-SG)` → `secretaria` (se conserva el área exacta en
  `metadata.area_origen`).

### D3 — Intervenciones históricas crean su incidente
Las planillas de bacheo (mar–jul 2026) y las obras SIGOV son trabajos ya
ejecutados sin incidente previo. La ingesta les crea el incidente en estado
coherente (`reparado` si finalizó) para no romper el modelo
demanda → incidente → intervención y habilitar la detección de **reincidencia**
(un bache que reaparece donde ya se bacheó).

### D4 — Contacto del vecino: protección en dos niveles
RLS de Postgres es por fila, no por columna. `demandas.contacto` (nombre,
teléfono, email, CUIT) se protege así:
1. La vista `demandas_publicas` (security_invoker) no incluye la columna.
2. La capa de consultas de la app solo selecciona `contacto` para los roles
   `admin` y `atencion_ciudadana` (`puedeVerContacto`).
Nunca se expone en el mapa (`/api/geodata` no la consulta) ni en exportaciones.
Los archivos fuente con datos personales NO se commitean al repo.

### D5 — Coordenadas por defecto en el export de Atención Ciudadana
El xlsx de 463 reclamos abiertos repite la misma coordenada para cientos de
filas (valor por defecto de la repartición, no geocodificación real). El parser
detecta coordenadas repetidas (>5 apariciones), las descarta y marca
`geocod_confianza = 0.05` + `metadata.coordenada_defecto = true` → esas
demandas van a revisión manual y JAMÁS auto-vinculan.

### D6 — Paleta de datos del mapa (accesibilidad computada)
La paleta de marca (#0066FF/#2EB1FF/#F4DC00/#333333) rige la identidad (logo,
navegación, acentos) pero **no** discrimina estados sobre el mapa oscuro:
falló la validación de daltonismo/contraste. El mapa codifica **3
macro-estados** validados computacionalmente sobre #0B0F16
(deutan ΔE ≥ 9.4, contraste ≥ 3:1):

| Macro | Estados | Color |
|---|---|---|
| Abierto | detectado, priorizado | `#3987e5` |
| En curso | programado, en_ejecucion (con pulso animado) | `#d95926` |
| Resuelto | reparado, verificado (✓) | `#199e70` |

El sub-estado se lee por anillo/pulso/ícono y en el panel de detalle. El anillo
amarillo `#F4DC00` marca obras SIGOV (contratadas).

### D7 — packages/ui pospuesto
Los componentes compartidos viven en `apps/web/src/components` hasta que exista
una segunda app que los consuma. Crear el paquete hoy es indirección sin uso.

## Pendientes (bloqueantes externos y definiciones)

1. **Endpoint de listado incremental en Atención Ciudadana** — bloqueante para
   la ingesta real. Pedido al equipo de AC:
   `GET /reclamos/listarPorRango?actualizado_desde=<ISO8601>&id_categoria=&page=&limit=`
   (orden estable por fecha de actualización). Mientras: `CIMBA_FUENTE_AC=mock`.
   El mapeo real ya está implementado y probado con el export de 463 reclamos.
2. **Categorías/tipos de reclamo de pavimento**: falta la lista cerrada de
   `id_categoria`/`id_treclamo` para filtrar en la API (hoy se mapea por texto).
3. **Alta de CIMBA como `sistema_externo`** en los permisos del portal Ciudad
   Digital, con su `id_proceso`.
4. **Geocodificador definitivo**: Nominatim propio vs. callejero municipal.
   Hoy: Nominatim público solo dev, siempre server-side y cacheado.
5. **GeoPackage de cuadrantes de hormigón** de SIGOV (tabla `cuadrantes` lista).
6. **Devolución al ciudadano**: ¿CIMBA escribe el cierre en AC (¿qué endpoint?)
   o notifica por fuera?
7. **`distritosNuevo.json`**: falta el archivo (vive en el repo `derivador`).
   La tabla `distritos` y el trigger de autocompletado ya esperan sus 20
   features (ojo: no existe el ID 15).
8. **Teselas de producción**: MapTiler (pago) vs. self-hosting. Ver D1.
9. **Planilla "Mayo"**: el zip dice 2026 pero `mes_bacheo` dice "Mayo 2025" —
   confirmar el año real con la Dirección de Bacheo.
