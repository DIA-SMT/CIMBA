# Backlog de mejoras de alto impacto

> Salido de la auditoría multi-agente del 22/08/2026 (4 lentes: visual, operativo, datos, gestión + crítico de factibilidad contra el stack real). 22 propuestas viables, ninguna duplica lo ya construido. Marcar con `[x]` al completar.
>
> **Restricciones a recordar:** Vercel Hobby permite 2 crons (queda 1 libre → lo automático se encadena al cron diario existente) · funciones máx. 60 s (los lotes de IA van en tandas) · el email necesita un servicio nuevo (Resend tiene capa gratuita) · dos archivos externos destraban varias mejoras: **`distritosNuevo.json`** (repo derivador de la DIA) y el **GPKG de cuadrantes SIGOV**.

---

## Reemplazar QGIS por completo (pedido del Director de Bacheo)

Para su flujo diario (marcar puntos, geocodificar planillas, consolidar, informar) CIMBA ya lo cubre con ventajas. Para jubilar QGIS faltan:

- [ ] **Q1. Fondo satelital opcional** en el mapa (IGN/Argenmap, gratuito y oficial argentino) para ubicar puntos mirando la imagen aérea — *bajo*
- [ ] **Q2. Aceptar GPKG en la carga web** (`/cargar` hoy solo toma CSV/XLSX; el GeoPackage entra por CLI local) — *bajo*
- [ ] **Q3. Corregir un punto arrastrándolo** en el mapa (demanda mal geocodificada → arrastrar el marcador y guardar) — *bajo*
- [ ] **Q4. Exportar datos crudos** (CSV/GeoJSON de lo filtrado) para convivir con QGIS/PowerBI en la transición — *bajo*
- [ ] **Q5. Polígonos y líneas** (tramos de calle, áreas de obra; hoy CIMBA es 100 % puntos) — *medio/alto; solo si el Director realmente los dibuja*

---

## Nivel 1 — Golpes inmediatos (horas, impacto desproporcionado)

- [ ] **1. Evidencia antes/después visible** *(visual · bajo)* — Las fotos con GPS y hora que las cuadrillas están obligadas a sacar viven en Storage y ninguna pantalla las muestra (solo "📷 3"). Galería en la historia del incidente con comparador deslizable antes/después, sello de fecha+coordenadas, miniaturas en Campo y fotos dentro del reporte PDF. **La mejor relación impacto/esfuerzo de todo el sistema**: la prueba irrefutable del trabajo hecho, para prensa, Concejo y auditoría.

- [ ] **2. Distritos reales + métricas por distrito** *(datos+gestión · bajo)* — La tabla `distritos`, índices GiST y trigger espacial ya existen **vacíos** esperando `distritosNuevo.json` (20 features; ojo: no existe el ID 15). Cargar + backfill espacial de las ~4.700 geometrías + reemplazar el select provisorio de Funcionarios + agregación por distrito en Brecha/KPIs/mapa (coropletas). Responde LA pregunta del Intendente: "¿cómo estamos en el distrito 7?". *(Las propuestas 14 y 20 de la auditoría son este mismo trabajo visto desde datos y desde gestión: se hacen juntas.)*

- [ ] **3. SLA medido: cuánto tardamos** *(operativo · bajo)* — Mediana y p90 de días pedido→vinculación→programación→reparación, por fuente, tipo y distrito, con semáforo contra umbrales. Todas las fechas ya están en la base; es puro SQL. "Tardamos 23 días: 9 en el centro, 41 en la zona sur" es la frase que mueve presupuesto. Excluir explícitamente las 1.631 sin fecha (patrón de conteo honesto).

---

## Nivel 2 — Segunda ola (1–2 días c/u, transforman el producto)

- [ ] **4. Tablero ejecutivo "Sala de Situación" + modo TV** *(visual · medio)* — Ruta `/tablero`: 5-6 KPIs grandes con tendencia 30 días, barra de la verdad compacta, focos de deuda, "qué cambió esta semana". Modo `?tv=1` sin chrome, tipografía gigante, auto-refresh 5 min para proyectar en la oficina de Bacheo. El sistema se llama Centro de Monitoreo y no tiene la pantalla del centro.

- [ ] **5. Ciclo nocturno automático** *(datos · bajo)* — Encadenar al cron diario: sync → consolidación DBSCAN → cotejo retroactivo → recálculo de scores → snapshot de calidad. Hoy son botones que alguien tiene que apretar; si nadie entra, los datos se pudren. `conRls` ya acepta claims de sistema.

- [ ] **6. Devolución al vecino al reparar** *(operativo · medio)* — Agregar estado `resuelta` al enum de demandas, cascadear el cierre desde `finalizarIntervencion`, y bandeja de "devoluciones pendientes" con botón WhatsApp/email prellenado (dirección, fecha, foto del después) usando el `contacto` que ya está guardado y nunca se usó. Ataca directo el 71 % sin respuesta.

- [ ] **7. Devolución institucional formal** *(gestión · medio)* — La versión con membrete de la anterior: nota imprimible por demanda resuelta (foto antes/después, fecha, m², extracto de mapa) agrupada por canal — expediente por concejal para las 757 del HCD, oficio para las 794 intimaciones SAT, lote CSV para AC. Baja la brecha sin poner un metro de asfalto: comunica lo ya hecho.

- [ ] **8. Alertas automáticas: bache reabierto y zona en degradación** *(operativo · medio)* — En el cron diario: demanda nueva a <40 m de una reparación reciente → marca reincidencia, recalcula score y push a supervisión con link directo. Permite reclamar a la contratista dentro de garantía. También: hexbins con mayor crecimiento en 30 días → "zona degradándose".

- [ ] **9. Verificación en campo con foto** *(operativo · medio)* — Hoy "verificar" es un UPDATE ciego desde escritorio. Cola de verificación en Campo para supervisión: incidentes reparados ordenados por cercanía al GPS, fotos de la cuadrilla a la vista, y salida "verificado" (foto+GPS obligatorios) o "rechazado" (reabre con motivo). Vuelve auditables los 64.503 m² declarados — clave con contratistas SIGOV.

- [ ] **10. Hojas de ruta por zona para cuadrillas** *(operativo · medio)* — "Programar zona": tomar los incidentes priorizados dentro del círculo dibujable o de un distrito, crear intervenciones en lote, ordenarlas por vecino-más-cercano (PostGIS) y generar hoja de ruta imprimible. Campo agrupa por "jornada de hoy" y el push va solo a la cuadrilla asignada (hoy va a todas).

- [ ] **11. Coropletas por cuadrantes SIGOV** *(visual · medio · ⚠ depende del GPKG)* — Importar los cuadrantes a la tabla `cuadrantes` que ya existe en el esquema, vista "Territorial" en el mapa con coropletas de deuda/brecha/m² y ranking clickeable. Construir la capa una sola vez parametrizada (sirve para distritos y cuadrantes).

- [ ] **12. Consolidación encadenada a la ingesta + panel de fuentes** *(operativo · bajo)* — Al terminar cada carga (web o cron): consolidar y pushear el resumen ("entraron 37, se auto-vincularon 21"). Panel "Fuentes" leyendo `sync_runs` (hoy sin ninguna pantalla): última sync, insertados, errores, alerta si una fuente lleva N días muda.

- [ ] **13. Tablero de calidad con historia** *(datos · medio)* — Tabla `calidad_snapshots` (una fila diaria desde el ciclo nocturno), sparklines de tendencia en /calidad ("sin vincular: 2.743 → 1.910 en 30 días") y alerta push si la ingesta falla o inserta 0 registros N días seguidos.

- [ ] **14. Ingesta con vista previa (dry-run) + reprocesar desde staging** *(datos · medio)* — Mostrar el diff completo ANTES de promover (nuevas/actualizadas/errores fila por fila, mapa de los puntos, anomalías tipo coordenada-por-defecto) con confirmar/cancelar. Y "reprocesar desde staging": cuando un parser mejora, re-correr sobre los payloads ya guardados sin pedir el archivo de nuevo.

- [ ] **15. Informe ejecutivo mensual automático** *(gestión · medio · ⚠ email requiere Resend u otro, capa gratuita)* — El día 1 de cada mes: KPIs + brecha + deltas vs. mes anterior + top 5 deuda territorial, redactado por la IA ya existente, entregado como página imprimible + email. "Un sistema que gobierna" en vez de "una web que hay que abrir".

- [ ] **16. Tablero público de transparencia** *(gestión · medio)* — Ruta `/publico` (agregarla a PUBLICAS del middleware): mapa read-only de incidentes/intervenciones (sin demandas, cero PII), contadores grandes y barra de brecha, cacheado con ISR 1 h. "Entrá y mirá dónde se está bacheando hoy" en conferencia de prensa. Ninguna municipalidad del NOA lo tiene.

- [ ] **17. PWA de campo a prueba de mala señal** *(visual · medio)* — manifest + ícono SMT instalable, compresión de fotos client-side (8 MB → ~300 KB), cola de subida en IndexedDB con reintento automático y chips de estado ("pendiente de subir" ámbar / check verde). La foto que no se pudo subir es la obra que no se puede demostrar.

- [ ] **18. Modo claro + proyector/impresión** *(visual · medio)* — Segundo set de tokens `[data-theme='light']`, mapa CARTO positron, toggle persistido, `@media print` para las bandejas. El trabajo real es revalidar el contraste de la paleta de datos sobre fondo claro. Para proyectores lavados, sol de la calle y funcionarios de fondo blanco.

- [ ] **19. Modo relato: "Contame el mes"** *(visual · medio)* — Tour cinematográfico de 60-90 s con flyTo encadenados y tarjetas grandes: entraron X pedidos → acá está la deuda → esto se reparó → cierre con el mejor antes/después. Parámetro `?relato=1` para demos. La ciudad contando su propia historia con un botón.

---

## Nivel 3 — Estructural (para declararlo sistema oficial)

- [ ] **20. Salida de beta: FORCE RLS + acceso cerrado + visor de auditoría** *(gestión · alto)* — Checklist D8: rol de aplicación no-dueño + FORCE ROW LEVEL SECURITY (hoy la app bypasea sus propias políticas), WITH CHECK para HCD, rol de sistema para ingesta; activar `DEV_SSO_CODIGO` (es setear una env) y alta de CIMBA como sistema externo en Ciudad Digital (el SSO ya está programado punta a punta). Más `/auditoria`: la tabla se llena sola por triggers desde el día cero y no tiene UI. **EL prerrequisito para que la Intendencia lo adopte.**

- [ ] **21. Callejero municipal propio en PostGIS** *(datos · alto)* — Importar el extracto OSM de SMT (ejes con alturas + intersecciones) y una función `geocodificar_local()` con matching difuso pg_trgm, detrás de la interfaz Geocoder existente, Nominatim solo de emergencia. Desbloquea la corrección masiva con IA de las 2.197 demandas defectuosas y la ingesta en vivo (Nominatim público prohíbe volumen). Infraestructura que el municipio conserva para siempre.

- [ ] **22. Corrección masiva asistida por IA** *(datos · medio · ⚠ conviene después de la 21)* — Pasar las 2.197 demandas con geocodificación dudosa/sin tipo por la IA en tandas (límite 60 s de Vercel: lotes de 10-15), con bandeja de aprobación humana para lo no obvio. Convierte el 76 % de datos "a corregir" en datos operables.

---

### Orden sugerido de ejecución

**Semana 1:** 1 (fotos) + 3 (SLA) + Q1/Q2/Q3/Q4 (QGIS) — mientras se consiguen `distritosNuevo.json` y el GPKG.
**Semana 2:** 2 (distritos) + 5 (ciclo nocturno) + 4 (tablero TV).
**Después:** devoluciones (6+7), alertas (8), verificación (9), y el resto según prioridad política del momento.
**Antes de declararlo oficial:** 20 (salida de beta) sí o sí.
