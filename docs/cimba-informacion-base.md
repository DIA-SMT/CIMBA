# CIMBA — Información base

**Para qué sirve este documento.** Texto institucional listo para citar en notas,
expedientes y pedidos formales. No es el manual de uso: ese es
[`manual-cimba.html`](manual-cimba.html) (y su PDF), que explica cómo se opera
cada pantalla.

Todos los números son medidos sobre la base de producción. **Fecha de corte:
18 de septiembre de 2026.** Si la nota sale más de un mes después, conviene
volver a pedirlos antes de firmarla.

---

## 1 · Qué es (párrafo para pegar)

> CIMBA (Centro Inteligente de Monitoreo de Baches y Asfalto) es el sistema de
> gestión de bacheo y reparación de pavimento de la Municipalidad de San Miguel
> de Tucumán, desarrollado por la Dirección de Inteligencia Artificial para la
> Dirección de Bacheo. Reúne en un solo lugar los reclamos de la ciudadanía y de
> las instituciones, el relevamiento del estado de la calzada, la planificación
> y emisión de las órdenes de trabajo, la carga de lo ejecutado por las empresas
> contratistas y por las cuadrillas municipales, y la certificación de lo
> realizado.

Versión corta, para cuando la nota ya viene larga:

> CIMBA es el sistema municipal de gestión de bacheo: registra los reclamos,
> los convierte en problemas de calzada priorizados, emite las órdenes de
> trabajo a las empresas y certifica lo ejecutado con evidencia fotográfica y
> medidas.

## 2 · Qué problema resuelve

Antes de CIMBA, el mismo bache podía llegar por cinco canales distintos —el
vecino al 147, el concejal por nota, la red social, la Secretaría, la S.A.T.— y
cada canal se trabajaba por separado. No había forma de saber si un pedido ya
estaba resuelto, ni de responderle a quien lo pidió, ni de medir cuánto se
reparó realmente.

CIMBA ordena eso en una sola cadena:

```
PEDIDO         lo que alguien reclama (vecino, Concejo, S.A.T., Secretaría, red)
   ↓           varios pedidos del mismo lugar se agrupan en un solo problema
PROBLEMA       el bache real en la calle, priorizado con un puntaje explicable
   ↓           el problema entra en una orden de trabajo, con empresa y plazo
TRABAJO        lo ejecutado: medidas, fotos antes y después, GPS y fecha
   ↓
CERTIFICACIÓN  superficie y toneladas, que es lo que se paga
```

La consecuencia práctica: se puede contestar **quién pidió qué, cuándo se
reparó y con qué evidencia**, que es exactamente lo que hace falta para
responder una nota del Concejo o una intimación de la S.A.T.

## 3 · Qué contiene hoy

**Pedidos registrados: 3.275**, de seis canales.

| Canal | Pedidos |
|---|---|
| S.A.T. (Aguas) | 794 |
| Concejo Deliberante | 758 |
| Atención Ciudadana (147) | 745 |
| Secretarías | 603 |
| Redes sociales / DIE | 274 |
| Cuadrillas municipales | 101 |

3.184 de esos pedidos (97%) tienen ubicación geográfica.

**Problemas de calzada identificados: 3.480.** De ellos, 3.264 figuran
reparados o verificados y 216 están abiertos en alguna etapa.

**Trabajos ejecutados y registrados: 3.393**, que suman **99.858 m² de calzada
intervenida**, con **4.869 fotografías** de respaldo. Los ejecutores son 15
entre empresas contratistas y cuadrillas propias; hay 13 empresas dadas de alta
en el sistema.

**Cobertura territorial:** los 20 distritos, 327 barrios, 47 circuitos, 149
corredores viales y las 4 zonas del contrato de bacheo integral.

**Órdenes de trabajo emitidas: 21**, de las cuales 12 están activas.

La certificación usa la densidad de asfalto de **2,4 t/m³** para convertir la
superficie y el espesor declarados en toneladas.

## 4 · Quiénes lo usan

- **Dirección de Bacheo** — planifica, emite las órdenes y valida lo cargado.
- **Inspectores (supervisión)** — verifican en calle y validan lo que las
  empresas declaran.
- **Empresas contratistas** — tienen su propio acceso: ven solo sus órdenes y
  cargan cada bache con medidas y fotos desde el celular, en la calle.
- **Cuadrillas municipales** — cargan por el mismo circuito que las empresas.
- **Atención Ciudadana** — consulta el estado de un reclamo para responderle al
  vecino.
- **Conducción** — tablero de brecha, productividad por empresa y reportes por
  canal.

## 5 · Párrafos armados para notas de pedido

### 5.1 · Pedido de conexión con Atención Ciudadana

> A los fines de completar la trazabilidad entre el reclamo del vecino y su
> resolución efectiva, se solicita se disponga la provisión del servicio de
> consulta (API) del sistema de Atención Ciudadana, que permita a CIMBA la
> lectura periódica y automática de los reclamos vinculados a calzada. En la
> actualidad los reclamos se incorporan mediante carga manual de archivos, lo
> que impide informar al vecino el estado de su pedido en tiempo real.

*Sustento para esa nota:* de los 3.275 pedidos registrados, 2.750 todavía no
están vinculados a un problema concreto de calzada, en buena medida porque la
incorporación es manual y por lotes.

### 5.2 · Pedido de datos de ejecución a las empresas o a Administración

> Se solicita que las planillas de obra ejecutada incorporen, para cada
> intervención, la **superficie efectivamente reparada** (o el ancho y el largo)
> y el **espesor colocado**. Ambos datos son indispensables para la conversión a
> toneladas y, por lo tanto, para la certificación de lo ejecutado. Las
> planillas actuales informan la ubicación y la fecha, pero no la magnitud del
> trabajo.

*Sustento:* las cuadrillas de Administración registran 1.779 trabajos y solo 38
tienen superficie cargada. Sin ese dato, esos trabajos certifican cero
toneladas.

### 5.3 · Pedido de acceso o de alta de usuarios

> Se solicita se otorgue acceso al sistema CIMBA al agente [NOMBRE], D.N.I.
> [NÚMERO], en carácter de [inspector de obra / planificación / consulta], a los
> efectos de [verificar y validar los trabajos ejecutados / planificar y emitir
> órdenes de trabajo / consultar el estado de los reclamos].

### 5.4 · Respuesta a una nota del Concejo o a una intimación

> En relación con lo solicitado, se informa que el problema de calzada sito en
> [DIRECCIÓN] se encuentra registrado en el sistema CIMBA bajo el identificador
> [N°], habiendo sido [reparado el DD/MM/AAAA por la empresa X, con una
> superficie de N m² y evidencia fotográfica de antes y después / incorporado a
> la orden de trabajo N° X con fecha prevista de ejecución].

### 5.5 · Presentación del sistema ante otra área u organismo

> La Municipalidad de San Miguel de Tucumán cuenta con CIMBA, sistema propio de
> gestión de bacheo desarrollado por su Dirección de Inteligencia Artificial,
> que integra los reclamos de los distintos canales de atención, la
> planificación de las cuadrillas y contratistas, y la certificación de lo
> ejecutado con evidencia georreferenciada. A la fecha registra 3.275 pedidos
> ciudadanos e institucionales y 3.393 trabajos ejecutados sobre 99.858 m² de
> calzada.

## 6 · Lo que conviene no afirmar

Para que las notas no queden expuestas:

- **No afirmar que CIMBA recibe los reclamos automáticamente.** Hoy la
  incorporación desde Atención Ciudadana es manual, por archivo.
- **No informar toneladas de las cuadrillas de Administración.** No tienen
  superficie cargada: darían cero.
- **No presentar los m² como "reparados este año".** Los 99.858 m² incluyen
  obras de pavimento de distinta escala y de todo el período cargado.
- **No citar el detalle diario de abril y mayo de 2026.** Esas planillas traían
  solo el mes, y todos los trabajos quedaron fechados el día 15. Los totales
  mensuales sí son correctos.

---

*Mantenimiento: los números de la sección 3 salen de una consulta directa a la
base. Pedirlos actualizados a la Dirección de IA antes de usar este texto en una
presentación formal.*
