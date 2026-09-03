/**
 * Catálogo único de las funcionalidades del mapa comando. Es LA fuente de
 * verdad compartida: la lee el recorrido guiado (botón "?") para mostrarlas
 * sobre la pantalla, y la lee Migue para explicarlas cuando le preguntan.
 * Si se agrega una función al mapa, se agrega acá y ambos la conocen.
 *
 * Módulo plano (sin "use client"/"server-only"): importable desde ambos lados.
 */

export interface FuncionMapa {
  id: string;
  titulo: string;
  /** Para qué sirve, en lenguaje llano. */
  desc: string;
  /** Cómo se usa (el gesto concreto), si no es obvio. */
  como?: string;
  /** data-tour del elemento en pantalla; sin esto el paso se muestra centrado. */
  tour?: string;
}

export const GUIA_FUNCIONES: FuncionMapa[] = [
  {
    id: "intro",
    titulo: "El mapa comando",
    desc: "Acá vive todo el bacheo de la ciudad: lo que la gente pide (puntos azules), los problemas detectados y lo que ya se reparó. Este recorrido te muestra cada herramienta; podés salir cuando quieras y volver desde el botón «?».",
  },
  {
    id: "buscador",
    titulo: "Buscador inteligente",
    desc: "Escribí o dictá (micrófono) una frase como «baches sin atender en av. Belgrano» y el mapa la entiende: marca las coincidencias con anillo amarillo, vuela a la zona y prende las capas necesarias.",
    como: "Escribí y Enter, o tocá el micrófono y hablá. La ✕ despeja las marcas.",
    tour: "buscador",
  },
  {
    id: "vistas",
    titulo: "Vistas del mapa",
    desc: "Cinco miradas prearmadas: OPERATIVO (lo que hay que resolver hoy), HISTÓRICO (el trabajo ya hecho), ANÁLISIS (mapa de calor de demanda), BRECHA (lo pedido vs. lo hecho, cada pedido coloreado según si nadie lo tocó, está en cola o parece resuelto) y TODO (todas las capas juntas).",
    tour: "vistas",
  },
  {
    id: "kpis",
    titulo: "Los números de arriba",
    desc: "Las cifras globales del sistema: demandas totales, sin vincular (pedidos que nadie cotejó todavía), abiertos, en curso, resueltos y m² intervenidos. Dejá el dedo o el mouse sobre cada una y te explica qué mide.",
    tour: "kpis",
  },
  {
    id: "capas",
    titulo: "Panel de Capas",
    desc: "El control fino de qué se ve: vista satelital, avenidas, nombres de calles, límites de distritos/circuitos electorales/barrios (los barrios con problemas reportados se tiñen de rojo), incidentes por estado, puntos de demanda, mapa de calor, densidad 3D, Top 20 urgentes, filtro por quién pide (fuente), por tipo de problema y por período.",
    como: "Se abre y cierra con el botón de capas (abajo a la izquierda). Cada casilla prende o apaga una capa.",
    tour: "capas",
  },
  {
    id: "ficha",
    titulo: "Tocar cualquier punto",
    desc: "Un toque en cualquier punto abre su ficha completa: qué es, quién lo pidió, cuándo, su estado y el acceso a la historia completa del lugar (pedido → problema → trabajo). Pasando el mouse por encima ya te adelanta dirección y estado.",
  },
  {
    id: "alta-rapida",
    titulo: "Cargar con clic derecho",
    desc: "Clic derecho (o toque largo) en cualquier lugar del mapa abre el alta rápida: cargás un pedido nuevo ahí mismo, con la dirección detectada sola. También sirve para abrir Street View de ese punto exacto.",
  },
  {
    id: "cotejo",
    titulo: "Cotejo desde el mapa",
    desc: "En vista BRECHA, tocá un pedido pendiente y el mapa dibuja hilos amarillos hacia los trabajos que hay a menos de 60 metros: ahí decidís si ya estaba atendido (lo vinculás) o si es brecha real. Es la forma más rápida de bajar la deuda de «sin vincular».",
  },
  {
    id: "informe-ia",
    titulo: "Informe IA",
    desc: "Genera un informe ejecutivo escrito sobre exactamente lo que estás viendo en el mapa (filtros incluidos): situación, zonas críticas y recomendaciones. Listo para copiar o llevar a una reunión.",
    tour: "informe-ia",
  },
  {
    id: "comparar",
    titulo: "Comparar: lo pedido | lo hecho",
    desc: "Divide la pantalla con una cortina arrastrable: a la izquierda LO PEDIDO (reclamos abiertos, en azul) y a la derecha LO HECHO (reparado o en obra). Cada lado muestra su número real en pantalla: pedidos pendientes y m² hechos. El botón Capturar descarga la comparación como imagen.",
    como: "Arrastrá la línea amarilla para correr la cortina. Movés el mapa y los números se recalculan.",
    tour: "comparar",
  },
  {
    id: "analizar-zona",
    titulo: "Analizador de zona",
    desc: "Dibujá un círculo sobre el mapa (mantené apretado y arrastrá) y te da las estadísticas de esa zona al instante: pedidos pendientes, % sin respuesta, reparaciones, m², qué se pide y quién lo pide.",
    tour: "analizar-zona",
  },
  {
    id: "historia",
    titulo: "Línea de tiempo",
    desc: "Reproduce la historia del bacheo mes a mes como una película: vas viendo cómo aparecieron los pedidos y cómo los fueron apagando las reparaciones.",
    tour: "historia",
  },
  {
    id: "exportar",
    titulo: "Exportar y compartir",
    desc: "Saca lo que estás viendo del mapa: reporte imprimible (PDF con el extracto cartográfico real), GeoJSON para QGIS/PowerBI, link de esta vista exacta (cámara + filtros) para pegar donde quieras, o envío directo por WhatsApp a un contacto.",
    tour: "exportar",
  },
  {
    id: "despejar",
    titulo: "Despejar la pantalla",
    desc: "El botón del ojo tachado esconde todos los paneles y números de un golpe para ver el mapa limpio. Volvés a tocarlo y reaparece todo.",
    tour: "despejar",
  },
  {
    id: "arrastrar",
    titulo: "Todo se puede mover",
    desc: "La barra de herramientas, el panel de Capas, el análisis de zona y Migue se arrastran desde su agarre (⋮⋮) y quedan donde los dejás, incluso al volver mañana. Si moviste algo, aparece un botón para devolver todo a su lugar.",
  },
  {
    id: "balance",
    titulo: "Balance de lo que ves",
    desc: "La pastilla de abajo resume el encuadre actual: cuántos pedidos pendientes hay EN PANTALLA, qué % está sin respuesta y cuántos m² se hicieron ahí. Se recalcula solo al mover el mapa.",
    tour: "balance",
  },
  {
    id: "tema",
    titulo: "Tema claro y oscuro",
    desc: "CIMBA arranca en claro para el trabajo de oficina; el botón de luna/sol del encabezado lo pasa a oscuro (ideal para la pantalla de comando o de noche). El mapa cambia con el tema: callejero claro u oscuro. La elección queda guardada en este dispositivo.",
    como: "Tocá el ícono de luna (o sol) arriba a la derecha.",
  },
  {
    id: "capas-viales",
    titulo: "Red vial y licitaciones",
    desc: "En Capas → Territorio hay cuatro capas nuevas: avenidas primarias y secundarias, pavimento/ripio/cordón cuneta por cuadra (el ripio bien visible: ahí no se bachea, se pasa la máquina), los sectores de licitación con su empresa adjudicataria (hormigón y asfalto) y los recorridos de colectivos. Con la red vial, cada reclamo se clasifica solo: bacheo, SAT o ingeniería.",
    como: "Panel de Capas → grupo Territorio. Tocá un sector de licitación para ver empresa y n° de licitación.",
  },
  {
    id: "circuitos-operativos",
    titulo: "Circuitos operativos",
    desc: "Con la capa de circuitos prendida, cada circuito se pinta según la empresa que lo trabaja y su borde marca la prioridad vial (naranja = primaria, amarillo = secundaria). Tocá un circuito para ver su ficha: pendientes, reclamos, empresa asignada y órdenes activas. La asignación se maneja desde Órdenes.",
    como: "Prendé «Circuitos» en el panel de Capas y hacé click sobre cualquier circuito.",
  },
  {
    id: "migue",
    titulo: "Migue, tu asistente",
    desc: "Preguntale lo que quieras sobre los datos en lenguaje natural: consulta la base real y contesta con números exactos. También sabe usar el mapa: pedile «mostrame los baches sin atender en Belgrano» y te lleva y los marca. Y conoce esta guía completa: preguntale para qué sirve cualquier botón. También conoce las órdenes de trabajo, los circuitos y la proyección de capacidad.",
    tour: "migue",
  },
];

/** La guía en texto plano, para el prompt de sistema de Migue. */
export function guiaParaPrompt(): string {
  return GUIA_FUNCIONES.filter((f) => f.id !== "intro")
    .map((f) => `- ${f.titulo}: ${f.desc}${f.como ? ` (${f.como})` : ""}`)
    .join("\n");
}
