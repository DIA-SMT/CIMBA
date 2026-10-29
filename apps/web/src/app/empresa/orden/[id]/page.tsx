import Link from "next/link";
import { Download } from "lucide-react";
import { notFound } from "next/navigation";
import { leerSesion } from "@/lib/auth";
import { obtenerOrden, type ItemOrden } from "@/lib/ordenes";
import { TicketBache } from "@/components/ticket-bache";
import { HojaOrdenImprimible } from "@/app/(app)/ordenes/[id]/hoja-orden";
import { BotonPdfOrden } from "./boton-pdf";
import { estaVencida, fechaCorta, numero, venceHoy } from "@/lib/formato";
import { formatoToneladas } from "@/lib/medicion";
import { urlFoto } from "@/lib/fotos";
import { Panel } from "@/components/ui";
import { GaleriaFotos, type FotoVisor } from "@/components/visor-fotos";
import { COLOR_ESTADO_ITEM, fondoTenue } from "@/app/(app)/ordenes/etiquetas";
import { resolverVistaPortal } from "../../vista";
import { CorregirUbicacionItem } from "@/components/corregir-ubicacion-item";
import { FotosPropuesto } from "./fotos-propuesto";
import { fotoPropuestaAntes, fotoPropuestaDespues } from "@/lib/propuesto";
import { CorregirMedidas } from "@/app/(app)/ordenes/[id]/corregir-medidas";
import { MapaOrden } from "./mapa-orden";
import { ProponerItem } from "./proponer-item";
import { TerminarCarga } from "./terminar-carga";
import { CambiarFoto } from "./cambiar-foto";
import { ListaPendientes } from "./lista-pendientes";
import { ListaPorTandas } from "./lista-por-tandas";
import { CompletarHecho } from "./completar-hecho";

export const dynamic = "force-dynamic";

const TERCIARIA = { etiqueta: "TERCIARIA", clase: "bg-panel-3 text-texto-2" };
const PRIORIDAD: Record<string, { etiqueta: string; clase: string }> = {
  primaria: { etiqueta: "PRIMARIA", clase: "bg-encurso/15 text-encurso" },
  secundaria: { etiqueta: "SECUNDARIA", clase: "bg-amarillo/15 text-amarillo" },
  terciaria: TERCIARIA,
};

const m2 = (v: number | null) =>
  v != null ? new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 }).format(v) : "—";

const ETIQUETA_TRABAJO: Record<string, string> = {
  bache: "Bache",
  carpeta: "Carpeta",
  tramo: "Tramo",
};

/** Motivo del rechazo que dejó Bacheo en metadata.validacion (resolverPropuesto). */
function motivoRechazo(metadata: Record<string, unknown>): string | null {
  const v = metadata.validacion as { motivo?: unknown } | undefined;
  return typeof v?.motivo === "string" ? v.motivo : null;
}

/** El trabajo del día: lo pendiente arriba y grande, lo hecho abajo como confirmación. */
export default async function PaginaOrdenEmpresa({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ empresa?: string; proponer?: string }>;
}) {
  const { id } = await params;
  const idOrden = Number(id);
  if (!Number.isInteger(idOrden) || idOrden <= 0) notFound();

  const sesion = (await leerSesion())!;
  const sp = await searchParams;
  const resuelta = await resolverVistaPortal(sesion, sp);
  /* Viene de "Cargar un bache → esta orden": el panel de proponer abre solo. */
  const abrirProponer = sp.proponer === "1";
  // obtenerOrden filtra por empresa cuando el rol es 'empresa' (y excluye
  // borradores): si el id es de otra empresa, vuelve null y esto es un 404, no
  // una fuga. El filtro vive en la consulta porque la RLS hoy no se aplica.
  const orden = await obtenerOrden(sesion, idOrden);
  if (!orden) notFound();
  /**
   * El staff en el portal está SIEMPRE en vista espejo, venga o no ?empresa en
   * la URL: sin esto, entrar directo a /empresa/orden/N mostraba el portal
   * vivo sin el banner de advertencia. Sin ?empresa, la empresa espejada es la
   * dueña de la orden.
   */
  const vista =
    sesion.rol_cimba === "empresa" || sesion.rol_cimba === "cuadrilla"
      ? resuelta
      : { empresaId: resuelta.empresaId ?? orden.empresaId, esVistaEspejo: true };
  // Coherencia de la vista espejo: si el staff está mirando el portal de la
  // empresa N, una orden de otra empresa no existe "en ese portal".
  if (vista.esVistaEspejo && orden.empresaId !== vista.empresaId) notFound();
  // El portal muestra lo que ve la empresa, y la empresa nunca ve borradores:
  // el staff los revisa en /ordenes/[id], no acá.
  if (orden.estado === "borrador") notFound();
  // En vista espejo los links internos arrastran ?empresa=N para no perderse.
  const sufijoEspejo = vista.esVistaEspejo ? `?empresa=${vista.empresaId}` : "";

  const prioridad = PRIORIDAD[orden.prioridad] ?? TERCIARIA;
  const activa = orden.estado === "emitida" || orden.estado === "en_ejecucion";
  const pendientes = orden.itemsDetalle.filter((i) => i.estado === "pendiente");
  const hechos = orden.itemsDetalle.filter((i) => i.estado === "hecho");
  /**
   * HECHOS QUE FALTA COMPLETAR: sin la foto del después o sin lugar en el
   * mapa. Son, sobre todo, los baches que entraron desde una planilla (Ingeco,
   * septiembre): hechos con su fecha y su volumen, que la empresa completa
   * después. Sin la foto no entran en un acta (CERTIFICABLE). Lo que ya está
   * en un acta no se toca, así que no se ofrece.
   */
  const faltaCompletar = hechos.filter(
    (i) => i.actaId == null && (i.intervencionId == null || !i.fotos.some((f) => f.momento === "despues")),
  );
  const idsFalta = new Set(faltaCompletar.map((i) => i.id));
  const hechosCompletos = hechos.filter((i) => !idsFalta.has(i.id));
  const noEncontrados = orden.itemsDetalle.filter((i) => i.estado === "no_encontrado");
  const yaResueltos = orden.itemsDetalle.filter((i) => i.estado === "ya_resuelto");
  const propuestos = orden.itemsDetalle.filter((i) => i.estado === "propuesto");
  const rechazados = orden.itemsDetalle.filter((i) => i.estado === "rechazado");
  /**
   * El progreso se mide sobre el plan real: un propuesto sin validar (o
   * rechazado) no es trabajo encargado y no puede inflar el denominador.
   * Ahora enPlan y cerrados vienen calculados del servidor (lib/ordenes.ts),
   * los mismos que usa la lista: restarlos acá en TypeScript era lo que hacía
   * que las dos pantallas mostraran números distintos.
   */
  /**
   * Los puntos del mapa de ubicación: todo lo que tenga coordenada, con el
   * color del avance. Lo cerrado sin trabajo —no encontrado, ya resuelto—
   * cuenta como hecho a los fines del mapa: lo que importa dibujar es qué
   * queda por visitar.
   */
  const puntosDelMapa = orden.itemsDetalle.flatMap((i) =>
    i.lat != null && i.lon != null && i.estado !== "rechazado"
      ? [{
          id: i.id,
          lat: i.lat,
          lon: i.lon,
          direccion: i.direccion,
          hecho: i.estado !== "pendiente" && i.estado !== "propuesto",
          estado: i.estado === "propuesto" ? ("sin_validar" as const) : i.estado === "pendiente" ? ("falta" as const) : ("hecho" as const),
          fueraM: i.fueraDelAmbitoM ?? null,
        }]
      : [],
  );

  const enPlan = orden.enPlan;
  const pctHecho = enPlan > 0 ? Math.round((100 * orden.hechos) / enPlan) : 0;
  const pctSinTrabajo =
    enPlan > 0 ? Math.round((100 * (orden.cerrados - orden.hechos)) / enPlan) : 0;

  return (
    <div className="mx-auto max-w-xl p-4 pb-16">
      {vista.esVistaEspejo && (
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-amarillo/50 bg-amarillo/10 px-4 py-3 text-sm">
          <p className="min-w-0 flex-1">
            <b className="text-amarillo">Vista espejo:</b> estás viendo el portal como{" "}
            <b>{orden.empresaNombre}</b>. Lo que cargues acá vale de verdad.
          </p>
          <Link href="/ordenes/empresas" className="shrink-0 font-semibold text-celeste hover:underline">
            volver a Órdenes
          </Link>
        </div>
      )}
      <Link
        href={`/empresa${sufijoEspejo}`}
        className="inline-flex min-h-12 items-center text-sm font-medium text-texto-2 hover:text-texto"
      >
        ← Mis órdenes
      </Link>

      {/* Cabecera compacta: lo justo para saber qué orden es y cuánto falta */}
      <Panel className="mb-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="num text-xl font-extrabold">{orden.numero}</h1>
          <span className={`rounded px-2 py-1 text-[11px] font-bold ${prioridad.clase}`}>
            {prioridad.etiqueta}
          </span>
          {orden.circuitoCodigo && (
            <span className="rounded bg-celeste/10 px-2 py-1 text-[11px] font-bold text-celeste">
              Circuito {orden.circuitoCodigo}
            </span>
          )}
        </div>
        {orden.titulo && <p className="mt-1 text-base font-medium">{orden.titulo}</p>}
        {orden.indicaciones && (
          <p className="mt-2 rounded-lg border border-amarillo/30 bg-amarillo/5 px-3 py-2 text-sm leading-relaxed text-texto">
            <span className="font-bold text-amarillo">Indicaciones del Director: </span>
            {orden.indicaciones}
          </p>
        )}
        <div className="mt-3 flex items-baseline justify-between text-sm">
          <span>
            <b className="num">{numero(orden.hechos)}</b> de <b className="num">{numero(enPlan)}</b> hechos
            {orden.cerrados > orden.hechos && (
              <span className="text-texto-3">
                {" "}
                · {numero(orden.cerrados - orden.hechos)} sin trabajo
              </span>
            )}
            {faltaCompletar.length > 0 && (
              <span className="font-semibold text-amarillo"> · {numero(faltaCompletar.length)} por completar</span>
            )}
          </span>
          {/* Los m² porque son lo tangible, las toneladas porque son la unidad
              con la que se certifica el pago (2,4 t/m³). */}
          <span className="num text-texto-2">
            {numero(orden.m2Reportados)} m²
            {orden.tnReportadas > 0 && (
              <span className="text-amarillo"> · {formatoToneladas(orden.tnReportadas)}</span>
            )}
          </span>
        </div>
        <div className="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-panel-3">
          <div className="flex h-full">
            <div
              className="h-full bg-resuelto transition-[width]"
              style={{ width: `${pctHecho}%` }}
            />
            {/* Cerrado sin trabajo: cuenta para terminar la orden, pero no es
                bacheo hecho ni se certifica. Por eso va gris y no verde. */}
            <div
              className="h-full bg-inactivo/60 transition-[width]"
              style={{ width: `${pctSinTrabajo}%` }}
              title="Cerrados sin trabajo: no encontrados o que ya estaban resueltos"
            />
          </div>
        </div>
        {/* Carácter por carácter lo mismo que el capataz acaba de ver en la
            lista: antes acá decía "Vence el 05/09/26" en gris chico aunque
            hiciera seis días que estaba vencida. */}
        {orden.venceEn && (
          <p className="mt-2 text-sm">
            {estaVencida(orden) ? (
              <span className="font-bold text-peligro">VENCIDA — vencía el {fechaCorta(orden.venceEn)}</span>
            ) : venceHoy(orden) ? (
              <span className="font-bold text-amarillo">Vence HOY</span>
            ) : (
              <span className="text-texto-2">Vence el {fechaCorta(orden.venceEn)}</span>
            )}
          </p>
        )}
      </Panel>

      {/**
       * DÓNDE QUEDA EL TRABAJO. Antes la empresa recibía una lista de
       * direcciones y nada más: si está todo en tres cuadras o repartido en
       * medio distrito, y por dónde conviene arrancar, se armaba en la cabeza
       * del capataz leyendo direcciones sueltas. El mapa existía pero estaba
       * escondido dentro de la lista, detrás de un botón que solo aparecía con
       * cinco o más pendientes — o sea que en la mayoría de las órdenes no
       * había mapa, y en una terminada tampoco.
       *
       * Van TODOS los puntos de la orden, no solo los pendientes: lo rojo es
       * lo que falta y lo verde lo tapado, que es el avance dibujado.
       */}
      {(puntosDelMapa.length > 0 || orden.poligono != null) && (
        <div className="mb-4">
          <MapaOrden puntos={puntosDelMapa} area={orden.areaAmbito ?? orden.poligono} />
        </div>
      )}

      {/* La orden en PDF: la MISMA hoja que imprime la Dirección, con la
          tabla y las fotos (14/10). Solo existe al imprimir; acá va el botón. */}
      <BotonPdfOrden cerrados={orden.cerrados} numero={orden.numero} />
      <HojaOrdenImprimible o={orden} />

      {/* Lo cargado en ESTA orden: el papel que la empresa lleva a la
          medición conjunta. */}
      {orden.cerrados > 0 && (
        <a
          href={`/api/empresa/exportar?orden=${orden.id}${vista.esVistaEspejo ? `&empresa=${vista.empresaId}` : ""}`}
          className="mb-4 flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-borde-2 px-3 text-sm font-semibold text-texto-2 transition hover:border-celeste/60 hover:text-celeste"
        >
          <Download size={15} className="shrink-0" />
          Bajar lo cargado en esta orden ({numero(orden.cerrados)})
        </a>
      )}

      {!activa && (
        <p className="mb-4 rounded-xl border border-borde bg-panel px-4 py-3 text-sm text-texto-2">
          Esta orden está {orden.estado === "completada" ? "completada" : "anulada"}: ya no se pueden
          cargar trabajos.
        </p>
      )}

      {/**
       * ARRIBA, no al final. La cuadrilla no trabaja la orden leyéndola de
       * principio a fin: hace un barrido norte-sur y este-oeste de la calle y
       * va cargando los baches que ejecuta, que en su mayoría NO están en el
       * papel. Agregar un punto nuevo es la acción más frecuente del portal y
       * estaba debajo de la lista entera — en una orden de treinta items, a
       * treinta scrolls de distancia. Pedido de la Dirección de Bacheo (12/09).
       */}
      {activa && (
        <TerminarCarga
          ordenId={orden.id}
          pendientes={Math.max(0, enPlan - orden.cerrados)}
          terminada={orden.cargaTerminada}
          soloLectura={vista.esVistaEspejo}
        />
      )}

      {activa && (
        <div className="mb-4">
          <ProponerItem ordenId={orden.id} abrirAlEntrar={abrirProponer} />
        </div>
      )}

      {/* Lo pendiente, uno por uno y bien grande. La lista es una isla
          cliente porque busca, ordena por cercanía y dibuja el mapa de la
          orden: lo que hace navegable una orden de decenas de baches. */}
      {pendientes.length > 0 && activa && (
        <ListaPendientes pendientes={pendientes} hechos={hechos} ordenId={orden.id} />
      )}
      {pendientes.length === 0 && activa && (
        /**
         * Una ORDEN ABIERTA no tiene lista: se sale a barrer la zona y se carga
         * lo que se encuentra. Decirle "no queda nada pendiente, buen trabajo"
         * a una cuadrilla que recién arranca sería mandarla de vuelta al
         * camión.
         */
        orden.abierta ? (
          <p className="rounded-xl border border-amarillo/40 bg-amarillo/5 px-4 py-5 text-center text-sm leading-relaxed text-texto-2">
            <b className="block text-base text-amarillo">Orden abierta</b>
            Esta orden no trae una lista de baches: recorré{" "}
            <b className="text-texto">{orden.ambitoNombre ?? "la zona asignada"}</b> y cargá con el
            botón de arriba cada bache que tapes.
          </p>
        ) : (
          <p className="rounded-xl border border-resuelto/40 bg-resuelto/10 px-4 py-6 text-center text-base font-semibold text-resuelto">
            No queda nada pendiente en esta orden. Buen trabajo.
          </p>
        )
      )}

      {(propuestos.length > 0 || rechazados.length > 0) && (
        <>
          <h2 className="mt-8 mb-2 text-xs font-bold tracking-wider text-texto-3 uppercase">
            Propuestos por ustedes ({numero(propuestos.length + rechazados.length)})
          </h2>
          <div className="space-y-2">
            {propuestos.map((item) => (
              <Panel key={item.id} className="px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 font-medium">{item.direccion ?? "Sin dirección"}</span>
                  <TicketBache id={item.id} tickets147={item.tickets147} />
                  <span className="rounded bg-amarillo/15 px-2 py-1 text-[11px] font-bold text-amarillo">
                    Esperando validación
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-texto-3">
                  {ETIQUETA_TRABAJO[item.tipoTrabajo] ?? item.tipoTrabajo} · Bacheo lo está revisando: si
                  lo valida, aparece en los pendientes.
                </p>
                {/* Las fotos que mandó la cuadrilla: para verlas —y guiarse al
                    corregir el pin— y para cambiar una que subió mal, mientras
                    espera validación (pedido de INGECO, 15/10). */}
                <FotosPropuesto
                  itemId={item.id}
                  urlAntes={(() => {
                    const r = fotoPropuestaAntes(item.metadata);
                    return r ? urlFoto({ storagePath: r, urlExterna: null }) : null;
                  })()}
                  urlDespues={(() => {
                    const r = fotoPropuestaDespues(item.metadata);
                    return r ? urlFoto({ storagePath: r, urlExterna: null }) : null;
                  })()}
                />
                {/* Esperando validación era el único estado sin salida: ni la
                    empresa podía arreglar un pin mal puesto ni el Director
                    podía tocarlo antes de decidir. Se rechazaba y se cargaba
                    todo de nuevo. */}
                {activa && (
                  <div className="mt-1.5">
                    <CorregirUbicacionItem
                      itemId={item.id}
                      lat={item.lat}
                      lon={item.lon}
                      direccion={item.direccion}
                      compacto
                    />
                  </div>
                )}
              </Panel>
            ))}
            {rechazados.map((item) => {
              const motivo = motivoRechazo(item.metadata);
              return (
                <Panel key={item.id} className="px-4 py-3 text-sm opacity-80">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 font-medium">{item.direccion ?? "Sin dirección"}</span>
                    <TicketBache id={item.id} tickets147={item.tickets147} />
                    <span className="rounded bg-panel-3 px-2 py-1 text-[11px] font-bold text-texto-2">
                      Rechazado
                    </span>
                  </div>
                  {motivo && <p className="mt-0.5 text-xs text-texto-3">Motivo: {motivo}</p>}
                </Panel>
              );
            })}
          </div>
        </>
      )}

      {/* Hechos que falta completar: arriba, porque es lo que hay que hacer. */}
      {faltaCompletar.length > 0 && (
        <>
          <h2 className="mt-8 mb-1 text-xs font-bold tracking-wider text-amarillo uppercase">
            Falta completar ({numero(faltaCompletar.length)})
          </h2>
          <p className="mb-2 text-xs leading-relaxed text-texto-3">
            Baches hechos a los que les falta la foto del después o el lugar en el mapa. Entran en un acta recién
            cuando tienen la foto.
          </p>
          <ListaPorTandas
            filas={faltaCompletar.map((item) => ({
              id: item.id,
              texto: item.direccion ?? "",
              nodo: <ItemACompletar item={item} />,
            }))}
          />
        </>
      )}

      {/* Lo hecho, colapsado: sirve de confirmación de lo que ya se cargó */}
      {hechosCompletos.length > 0 && (
        <>
          <h2 className="mt-8 mb-2 text-xs font-bold tracking-wider text-texto-3 uppercase">
            Hechos ({numero(hechosCompletos.length)})
          </h2>
          <ListaPorTandas
            tanda={30}
            filas={hechosCompletos.map((item) => ({
              id: item.id,
              texto: item.direccion ?? "",
              nodo: <ItemHecho item={item} />,
            }))}
          />
        </>
      )}

      {yaResueltos.length > 0 && (
        <>
          <h2 className="mt-8 mb-2 text-xs font-bold tracking-wider text-texto-3 uppercase">
            Ya estaban hechos ({numero(yaResueltos.length)})
          </h2>
          <div className="space-y-2">
            {yaResueltos.map((item) => (
              <Panel key={item.id} className="px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 font-medium">{item.direccion ?? "Sin dirección"}</span>
                  <TicketBache id={item.id} tickets147={item.tickets147} />
                  {/* El MISMO verde apagado que ve el Director en /ordenes/[id]:
                      sale de COLOR_ESTADO_ITEM.ya_resuelto, no de un hex acá. */}
                  <span
                    className="rounded px-2 py-1 text-[11px] font-bold"
                    style={{
                      background: fondoTenue(COLOR_ESTADO_ITEM.ya_resuelto),
                      color: COLOR_ESTADO_ITEM.ya_resuelto,
                    }}
                  >
                    Ya estaba resuelto
                  </span>
                </div>
                {item.observaciones && (
                  <p className="mt-0.5 text-xs text-texto-3">{item.observaciones}</p>
                )}
              </Panel>
            ))}
          </div>
        </>
      )}

      {noEncontrados.length > 0 && (
        <>
          <h2 className="mt-8 mb-2 text-xs font-bold tracking-wider text-texto-3 uppercase">
            No encontrados ({numero(noEncontrados.length)})
          </h2>
          <div className="space-y-2">
            {noEncontrados.map((item) => (
              <Panel key={item.id} className="px-4 py-3 text-sm">
                <p className="font-medium">
                  {item.direccion ?? "Sin dirección"} <TicketBache id={item.id} tickets147={item.tickets147} />
                </p>
                {item.observaciones && (
                  <p className="mt-0.5 text-xs text-texto-3">Motivo: {item.observaciones}</p>
                )}
              </Panel>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const ETIQUETA_MOMENTO: Record<string, string> = { antes: "Antes", durante: "Durante", despues: "Después" };
// La misma paleta funcional del relato (incidentes): pedido / en curso / hecho.
const COLOR_MOMENTO: Record<string, string> = { antes: "#3987e5", durante: "#d95926", despues: "#199e70" };

/** Lo que se lee de la planilla en el item, si vino de una. */
function datosDePlanilla(metadata: Record<string, unknown>) {
  const remito = metadata.remito as { numero?: unknown } | null | undefined;
  const sugerida = metadata.falta_ubicar as { lat?: unknown; lon?: unknown } | null | undefined;
  return {
    remito: typeof remito?.numero === "string" ? remito.numero : null,
    puntoSugerido:
      typeof sugerida?.lat === "number" && typeof sugerida?.lon === "number"
        ? { lat: sugerida.lat, lon: sugerida.lon }
        : null,
  };
}

function ItemACompletar({ item }: { item: ItemOrden }) {
  const faltaUbicar = item.intervencionId == null;
  const tieneAntes = item.fotos.some((f) => f.momento === "antes");
  const tieneDespues = item.fotos.some((f) => f.momento === "despues");
  const { remito, puntoSugerido } = datosDePlanilla(item.metadata);
  return (
    <Panel className="px-4 py-3 text-sm">
      <div className="flex items-start gap-3">
        <span className="min-w-0 flex-1 font-medium">{item.direccion ?? "Sin dirección"}</span>
        <TicketBache id={item.id} tickets147={item.tickets147} />
        <span className="num shrink-0 font-bold text-resuelto">{m2(item.superficieM2)} m²</span>
      </div>
      <p className="mt-0.5 text-xs text-texto-3">
        {item.reportadoEn ? `Hecho el ${fechaCorta(item.reportadoEn)}` : "Hecho"}
        {remito && <> · remito {remito}</>}
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {faltaUbicar && (
          <span className="rounded bg-amarillo/15 px-2 py-0.5 text-[11px] font-bold text-amarillo">Falta ubicar</span>
        )}
        {!tieneDespues && (
          <span className="rounded bg-amarillo/15 px-2 py-0.5 text-[11px] font-bold text-amarillo">
            Falta la foto del después
          </span>
        )}
      </div>
      <div className="mt-2">
        <CompletarHecho
          itemId={item.id}
          direccion={item.direccion}
          faltaUbicar={faltaUbicar}
          puntoSugerido={puntoSugerido}
          tieneAntes={tieneAntes}
          tieneDespues={tieneDespues}
        />
      </div>
    </Panel>
  );
}

function ItemHecho({ item }: { item: ItemOrden }) {
  // Serializado para el visor (isla cliente): URL resuelta + etiqueta legible.
  const fotos: FotoVisor[] = item.fotos.flatMap((f) => {
    const url = urlFoto(f);
    if (!url) return [];
    const momento = ETIQUETA_MOMENTO[f.momento] ?? f.momento;
    return [
      {
        url,
        alt: `Foto ${momento}`,
        etiqueta: item.reportadoEn ? `${momento.toUpperCase()} · ${fechaCorta(item.reportadoEn)}` : momento.toUpperCase(),
        insignia: { texto: momento, color: COLOR_MOMENTO[f.momento] ?? "#ffffff" },
      },
    ];
  });

  return (
    <details className="rounded-xl border border-borde bg-panel">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-3">
        <span className="text-resuelto">✓</span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {item.direccion ?? "Sin dirección"}
        </span>
        <TicketBache id={item.id} tickets147={item.tickets147} />
        <span className="num shrink-0 text-sm font-bold text-resuelto">{m2(item.superficieM2)} m²</span>
      </summary>
      <div className="border-t border-borde px-4 py-3 text-sm">
        {/* Sin ancho ni largo la medida se cargó por superficie o por volumen
            de mezcla: mostrar "— × — m" haría parecer que falta un dato. */}
        <p className="num text-texto-2">
          {item.anchoM != null && item.largoM != null
            ? `${m2(item.anchoM)} × ${m2(item.largoM)} m · espesor ${m2(item.espesorCm)} cm`
            : `${m2(item.superficieM2)} m² · espesor ${m2(item.espesorCm)} cm`}
        </p>
        {item.reportadoEn && (
          <p className="mt-0.5 text-xs text-texto-3">Reportado el {fechaCorta(item.reportadoEn)}</p>
        )}
        {item.observaciones && <p className="mt-1 text-xs text-texto-2">{item.observaciones}</p>}
        {/**
         * CORREGIR LO PROPIO. Un 0,5 tipeado en vez de 5 certifica la décima
         * parte de lo colocado, y hasta acá la empresa no podía arreglarlo:
         * había que llamar a la Dirección. Medidas y pin, mientras el trabajo
         * no esté en un acta firmada — eso ya no lo toca nadie.
         */}
        {item.actaId == null ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <CorregirMedidas
              itemId={item.id}
              superficieM2={item.superficieM2}
              espesorCm={item.espesorCm}
              anchoM={item.anchoM}
              largoM={item.largoM}
              medicion={typeof item.metadata.medicion === "string" ? item.metadata.medicion : null}
              tipoObra={item.tipoObra ?? null}
              enActa={false}
              etiqueta="Corregir medidas"
            />
            <CorregirUbicacionItem
              itemId={item.id}
              lat={item.lat}
              lon={item.lon}
              direccion={item.direccion}
              compacto
            />
          </div>
        ) : (
          <p className="mt-2 text-[11px] text-texto-3">Certificado en acta: ya no se modifica.</p>
        )}
        {fotos.length > 0 && (
          /* El visor a pantalla completa: targets grandes para el capataz en
             el celular, sin abrir pestañas. */
          <GaleriaFotos fotos={fotos} miniAlto={96} miniAncho={128} className="mt-2 flex gap-2 overflow-x-auto pb-1" />
        )}
        {/* La foto equivocada o repetida se cambia acá, mientras no esté en
            un acta; la anterior queda guardada (28/10). */}
        {item.actaId == null && (
          <CambiarFoto
            itemId={item.id}
            fotos={item.fotos.flatMap((f) => {
              const url = urlFoto(f);
              return url ? [{ id: f.id, etiqueta: ETIQUETA_MOMENTO[f.momento] ?? f.momento, url }] : [];
            })}
          />
        )}
      </div>
    </details>
  );
}
