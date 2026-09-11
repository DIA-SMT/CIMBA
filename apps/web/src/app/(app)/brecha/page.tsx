import Link from "next/link";
import { leerSesion } from "@/lib/auth";
import { brechaPorDistrito, estadisticasBrecha } from "@/lib/consultas";
import { ETIQUETA_FUENTE, ETIQUETA_TIPO, SEMAFORO, SEMAFORO_HEX, fechaCorta, numero } from "@/lib/formato";
import type { FuenteDemanda, TipoProblema } from "@cimba/domain";
import { Panel, TituloPagina } from "@/components/ui";
import { VerEnMapa } from "@/components/mapa/ver-en-mapa";
import { BotonCotejo } from "./boton-cotejo";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Acentos que NO son estado: acá el semáforo no manda. `pedidos` y `hechos` son
 * las dos series del gráfico mensual — dos cosas que se comparan, no dos pasos
 * de un mismo avance — y por eso siguen usando el azul y el verde heredados.
 * `obra` es la escala de obra contratada de SIGOV, que va en su propia columna
 * para no tapar al bacheo: un verde apagado, deliberadamente a un paso del
 * verde del semáforo.
 */
const SERIE = {
  pedidos: "var(--color-abierto)",
  hechos: "var(--color-resuelto)",
  obra: "var(--color-obra-contratada)",
} as const;

/**
 * Los colores que esta página necesita y que no son tokens globales. Viajan
 * como custom properties porque la página se renderiza en el servidor y no
 * puede leer el tema: el swap por tema lo hace CSS contra html[data-tema],
 * igual que el isotipo de la marca.
 *
 * `--color-reincidencia`: la reincidencia no es un paso del semáforo, es otra
 * dimensión (el problema volvió después de una reparación). Con el amarillo de
 * marca quedaba a 1.16:1 del ámbar de "en obra" — dos dorados idénticos en la
 * misma barra —, así que sale de la rampa rojo→verde y usa un fucsia propio,
 * que además queda a ΔE ≈ 28 del violeta con el que el mapa dibuja los
 * distritos por si algún día conviven.
 *
 * `--tinta-*`: el número que va ADENTRO de cada tramo de la barra. Sobre el
 * juego oscuro (colores claros) siempre entra tinta oscura; sobre el juego
 * claro el rojo, el verde y el fucsia se oscurecen y piden tinta blanca — con
 * la tinta oscura fija de antes quedaban en 3.96:1, abajo de AA.
 */
const CSS_COLORES = `
  .brecha {
    --color-reincidencia: #e879f9;
    --color-obra-contratada: #8fbfa8;
    --tinta-sin-atencion: #070a10;
    --tinta-en-cola: #070a10;
    --tinta-en-obra: #070a10;
    --tinta-hecho: #070a10;
    --tinta-reincidencia: #070a10;
  }
  html[data-tema="claro"] .brecha {
    --color-reincidencia: #a21caf;
    --color-obra-contratada: #4a7360;
    --tinta-sin-atencion: #ffffff;
    --tinta-hecho: #ffffff;
    --tinta-reincidencia: #ffffff;
  }
`;

/** Etiquetas de demandas.destino (enum destino_resolucion). Local, como en /cierres: formato.ts no es de esta tarea. */
const ETIQUETA_DESTINO: Record<string, string> = {
  bacheo: "Bacheo",
  sat: "SAT (Aguas)",
  ingenieria: "Ingeniería",
};
const AYUDA_DESTINO: Record<string, string> = {
  bacheo: "La cola real de la Dirección: lo que se resuelve con asfalto u hormigón.",
  sat: "Pérdidas de agua, tapas y sumideros: los resuelve la SAT por expediente, no la cuadrilla de bacheo.",
  ingenieria: "Lo que no es un bache (calle de ripio, apertura, traza): va a Ingeniería.",
};

/**
 * Todo link a /mapa de esta página abre las TRES colas. El mapa arranca
 * filtrado a bacheo y acá se cuentan los tres destinos: sin `destino=todos`, el
 * operador hace clic en "1.845 sin atención" y el mapa le muestra 1.063. El
 * desglose por cola lo pisa pasando su propio `destino`.
 */
function enMapa(extra: Record<string, string | number> = {}): string {
  const p = new URLSearchParams({ vista: "brecha", destino: "todos" });
  for (const [k, v] of Object.entries(extra)) p.set(k, String(v));
  return `/mapa?${p.toString()}`;
}

export default async function PaginaBrecha() {
  const sesion = (await leerSesion())!;
  const [b, porDistrito] = await Promise.all([
    estadisticasBrecha(sesion),
    brechaPorDistrito(sesion),
  ]);
  const puedeCotejar = ["admin", "atencion_ciudadana", "planificacion", "supervision"].includes(
    sesion.rol_cimba,
  );

  const pctBrecha = b.totalAbiertas > 0 ? Math.round((100 * b.brechaReal) / b.totalAbiertas) : 0;
  const pctSinPedido = b.trabajoTotal > 0 ? Math.round((100 * b.trabajoSinPedido) / b.trabajoTotal) : 0;
  // El titular del desglose: cuánto de la deuda sin tocar no le corresponde a
  // la Dirección de Bacheo. Sale de los mismos conteos, no de otra consulta.
  const deudaNoBacheo = b.porDestino
    .filter((d) => d.destino !== "bacheo")
    .reduce((n, d) => n + d.sinAtencion, 0);
  const pctNoBacheo = b.brechaReal > 0 ? Math.round((100 * deudaNoBacheo) / b.brechaReal) : 0;

  return (
    <div className="brecha mx-auto max-w-6xl p-6">
      <style>{CSS_COLORES}</style>
      <TituloPagina
        titulo="Brecha: lo pedido vs. lo hecho"
        sub="La medición central de CIMBA. Cada pedido abierto se cruza contra el territorio en un radio de 40 m."
        extra={
          <Link
            href={enMapa()}
            className="rounded-lg border border-celeste/50 bg-celeste/10 px-4 py-2 text-sm font-semibold text-celeste transition hover:bg-celeste/20"
          >
            Verla en el mapa (vista Brecha) →
          </Link>
        }
      />

      {/* La barra de la verdad: composición de los pedidos abiertos */}
      <Panel className="mb-6 p-5">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-bold">
            {numero(b.totalAbiertas)} pedidos abiertos con ubicación — ¿qué pasó con cada uno?
          </p>
          <p className="text-xs text-texto-3">
            + {numero(b.sinUbicacion)} sin ubicación (no se pueden cruzar) · {numero(b.yaVinculadas)} ya
            vinculados
          </p>
        </div>
        <div className="flex h-9 w-full overflow-hidden rounded-lg" role="img"
          aria-label={`Sin atención ${b.brechaReal}, en cola ${b.enCola}, en obra ${b.enObra}, ya resueltos probables ${b.yaResueltasProbable}`}>
          <Segmento n={b.brechaReal} total={b.totalAbiertas} color={SEMAFORO.sin_atencion}
            tinta="var(--tinta-sin-atencion)" href={enMapa({ brecha: "sin_atencion" })} />
          <Segmento n={b.enCola} total={b.totalAbiertas} color={SEMAFORO.en_cola}
            tinta="var(--tinta-en-cola)" href={enMapa({ brecha: "en_cola" })} />
          <Segmento n={b.enObra} total={b.totalAbiertas} color={SEMAFORO.en_obra}
            tinta="var(--tinta-en-obra)" href={enMapa({ brecha: "en_obra" })} />
          <Segmento n={b.yaResueltasProbable} total={b.totalAbiertas} color={SEMAFORO.resuelto}
            tinta="var(--tinta-hecho)" href={enMapa({ brecha: "posible_resuelta" })} />
        </div>
        <div className="mt-3 grid gap-2 text-[13px] sm:grid-cols-4">
          <Leyenda color={SEMAFORO.sin_atencion} n={b.brechaReal} titulo="Sin atención (brecha real)"
            detalle="Nadie los tocó: no hay reparación ni trabajo en curso cerca." href={enMapa({ brecha: "sin_atencion" })} />
          {/* En cola y en obra son la partición de lo que antes era un solo "en
              cola": van separados para que cada segmento lleve al mismo conjunto
              que muestra el mapa, y sumados siguen dando el mismo total. */}
          <Leyenda color={SEMAFORO.en_cola} n={b.enCola} titulo="En cola"
            detalle="Hay una orden emitida cerca, pero la cuadrilla todavía no arrancó." href={enMapa({ brecha: "en_cola" })} />
          <Leyenda color={SEMAFORO.en_obra} n={b.enObra} titulo="En obra"
            detalle="Hay un incidente en ejecución a menos de 40 m: se está trabajando ahora." href={enMapa({ brecha: "en_obra" })} />
          <Leyenda color={SEMAFORO.resuelto} n={b.yaResueltasProbable} titulo="Probablemente ya resueltos"
            detalle="Hay una reparación posterior al pedido a menos de 40 m: falta cerrar el circuito, no falta obra." href={enMapa({ brecha: "posible_resuelta" })} />
        </div>
        {/* La reincidencia no es un paso más: es una MARCA sobre los de arriba
            (casi siempre sobre «sin atención», porque desde que el problema
            volvió nadie lo tocó). Restarla de la barra hacía que este número
            no cerrara con el del mapa al que linkea cada segmento. */}
        {b.reincidencias > 0 && (
          <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-texto-3">
            <span className="mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: "var(--color-reincidencia)" }} />
            <span>
              De esos pedidos, <b className="num text-texto-2">{numero(b.reincidencias)}</b> son{" "}
              <b className="text-texto-2">reincidencias</b>: ya se había reparado ahí ANTES del reclamo y
              volvieron a pedir. No son un paso aparte del semáforo — están contados arriba (casi todos en
              «sin atención», porque desde que el problema volvió nadie lo tocó) —, pero son la señal más
              fuerte de falla estructural: ahí el bacheo no alcanza.
            </span>
          </p>
        )}
      </Panel>

      {/* ¿De quién es la deuda? — el desglose que descubrió el Director */}
      <Panel className="mb-6 p-5">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-bold">¿De quién es la deuda?</p>
          <p className="text-xs text-texto-3">
            <b className="num text-texto-2">{pctNoBacheo}%</b> de lo que nadie tocó ({numero(deudaNoBacheo)} pedidos)
            no le corresponde a la Dirección de Bacheo
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          {b.porDestino.map((d) => {
            const pct = d.abiertas > 0 ? Math.round((100 * d.sinAtencion) / d.abiertas) : 0;
            return (
              <Link
                key={d.destino}
                href={enMapa({ brecha: "sin_atencion", destino: d.destino })}
                className="rounded-lg border border-borde bg-panel-2 p-3 transition hover:border-borde-2 hover:bg-panel-3"
                title={`${AYUDA_DESTINO[d.destino] ?? ""} Clic para ver esta cola en el mapa.`}
              >
                <p className="text-[10px] font-semibold tracking-wider text-texto-3 uppercase">
                  {ETIQUETA_DESTINO[d.destino] ?? d.destino}
                </p>
                <p className="num mt-0.5 text-2xl font-extrabold" style={{ color: SEMAFORO.sin_atencion }}>
                  {numero(d.sinAtencion)}
                </p>
                <p className="text-[11px] leading-snug text-texto-2">
                  sin atención de {numero(d.abiertas)} abiertos · <b className="num text-texto">{pct}%</b>
                </p>
              </Link>
            );
          })}
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-texto-3">
          El destino lo clasifica el sistema al ingresar el pedido: una pérdida de agua o un reclamo de ripio
          nunca fue trabajo de la cuadrilla de bacheo. El mapa abre mostrando solo la cola de bacheo; los links
          de esta página abren las tres, que es lo que se cuenta acá.
        </p>
      </Panel>

      {/* Los dos números que duelen */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        <Link href={enMapa({ brecha: "sin_atencion" })} className="block">
        <Panel className="h-full p-5 transition hover:border-sin-atencion/50">
          <div className="num text-3xl font-extrabold" style={{ color: SEMAFORO.sin_atencion }}>
            {pctBrecha}%
          </div>
          <p className="mt-1 text-sm font-bold">de lo pedido no tiene ninguna respuesta</p>
          <p className="mt-1 text-xs leading-relaxed text-texto-2">
            {numero(b.brechaReal)} pedidos sin nada cerca. Es la deuda real con quien pidió — la lista de
            abajo muestra dónde se concentra. <span className="text-celeste">Verlos en el mapa →</span>
          </p>
        </Panel>
        </Link>
        <Link href="/intervenciones?estado=finalizada" className="block">
        <Panel className="h-full p-5 transition hover:border-amarillo/50">
          <div className="num text-3xl font-extrabold text-amarillo">{pctSinPedido}%</div>
          <p className="mt-1 text-sm font-bold">de lo hecho no responde a ningún pedido registrado</p>
          <p className="mt-1 text-xs leading-relaxed text-texto-2">
            {numero(b.trabajoSinPedido)} de {numero(b.trabajoTotal)} reparaciones sin pedido a menos de 40 m.
            Se trabaja mucho ({numero(b.m2Bacheo)} m² de bacheo y {numero(b.m2Obra)} m² en {numero(b.obras)}{" "}
            obras contratadas), pero no siempre donde está la demanda: la brecha es de dirección, no solo de
            volumen. <span className="text-celeste">Ver las intervenciones →</span>
          </p>
        </Panel>
        </Link>
      </div>

      {/* Acción: cerrar el circuito de lo ya hecho */}
      {puedeCotejar && <BotonCotejo cotejables={b.cotejablesAhora} cotejablesAmpliado={b.cotejablesAmpliado} />}

      {/* Evolución mensual */}
      <h2 className="mt-8 mb-3 text-sm font-bold tracking-wide uppercase">
        Evolución mensual <span className="font-normal text-texto-3">— pedidos con fecha confiable vs. trabajos finalizados</span>
      </h2>
      <Panel className="p-5">
        <GraficoMensual datos={b.mensual} />
        <div className="mt-3 flex items-center gap-5 text-[11px] font-medium">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: SERIE.pedidos }} /> Pedidos ingresados
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: SERIE.hechos }} /> Trabajos finalizados
          </span>
          <span className="ml-auto text-texto-3">
            No incluye los {numero(1631)} pedidos del consolidado histórico sin fecha de origen.
          </span>
        </div>
      </Panel>

      {/* Cobertura por fuente y por tipo */}
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Panel className="p-5">
          <p className="mb-3 text-sm font-bold">¿A quién le estamos respondiendo?</p>
          <div className="space-y-2.5">
            {b.porFuente.map((f) => {
              const pct = f.abiertas > 0 ? Math.round((100 * f.atendidas) / f.abiertas) : 0;
              return (
                <Link key={f.fuente} href={enMapa({ fuente: f.fuente })} className="block rounded-md px-1 py-0.5 transition hover:bg-panel-2" title="Ver esta fuente en el mapa">
                  <div className="mb-1 flex items-baseline justify-between text-[13px]">
                    <span>{ETIQUETA_FUENTE[f.fuente as FuenteDemanda] ?? f.fuente}</span>
                    <span className="num text-xs text-texto-2">
                      {numero(f.atendidas)} / {numero(f.abiertas)} · <b className="text-texto">{pct}%</b>
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-panel-3">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: SEMAFORO.resuelto }} />
                  </div>
                </Link>
              );
            })}
          </div>
          <p className="mt-3 text-[11px] text-texto-3">
            % de pedidos abiertos de cada fuente con una reparación a menos de 40 m.
          </p>
        </Panel>

        <Panel className="p-5">
          <p className="mb-3 text-sm font-bold">¿Qué tipo de problema queda más desatendido?</p>
          <div className="space-y-2.5">
            {b.porTipo.map((t) => {
              const pct = t.abiertas > 0 ? Math.round((100 * t.sinNadaCerca) / t.abiertas) : 0;
              return (
                <Link key={t.tipo} href={enMapa({ tipo: t.tipo })} className="block rounded-md px-1 py-0.5 transition hover:bg-panel-2" title="Ver este tipo en el mapa">
                  <div className="mb-1 flex items-baseline justify-between text-[13px]">
                    <span>{ETIQUETA_TIPO[t.tipo as TipoProblema] ?? t.tipo}</span>
                    <span className="num text-xs text-texto-2">
                      {numero(t.sinNadaCerca)} sin nada cerca · <b className="text-texto">{pct}%</b>
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-panel-3">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: SEMAFORO.sin_atencion }} />
                  </div>
                </Link>
              );
            })}
          </div>
        </Panel>
      </div>

      {/* La brecha distrito por distrito — responde "¿cómo estamos en el distrito 7?" */}
      <h2 className="mt-8 mb-3 text-sm font-bold tracking-wide uppercase">
        La brecha por distrito{" "}
        <span className="font-normal text-texto-3">— ordenada por deuda sin tocar; clic para verla en el mapa</span>
      </h2>
      {/* En un teléfono quedaban ~263 px útiles para una fila que pide 96 de
          Distrito + 64 + 80 + 96 de columnas fijas: la barra elástica —que es
          LA columna, la que muestra la deuda— se aplastaba a cero y el resto
          se pisaba. Con ancho mínimo y scroll propio la tabla se desliza de
          costado sola, en vez de arrastrar el main entero con el título y los
          demás paneles. Es lo que ya hacen las otras tablas del sistema; no se
          esconden los m² en celular porque entonces el teléfono y el
          escritorio mostrarían cifras distintas de lo mismo. */}
      <Panel className="overflow-x-auto">
      <div className="min-w-[620px] divide-y divide-borde/60">
        <div className="flex items-center gap-3 px-4 py-2 text-[10px] font-semibold tracking-wider text-texto-3 uppercase">
          <span className="w-24 shrink-0">Distrito</span>
          <span className="min-w-0 flex-1">Deuda sin tocar sobre lo pedido</span>
          <span className="num w-16 shrink-0 text-right">Reparados</span>
          <span className="num w-20 shrink-0 text-right" title="Bacheo: ~4 m² por reparación">
            m² bacheo
          </span>
          <span
            className="num w-24 shrink-0 text-right"
            title="Obra contratada de SIGOV: paños de hormigón y tramos de asfalto, ~196 m² cada uno. Va aparte porque si no tapa al bacheo."
          >
            m² obra
          </span>
        </div>
        {porDistrito.map((d) => {
          const pct = d.abiertas > 0 ? Math.round((100 * d.brechaReal) / d.abiertas) : 0;
          const fila = (
            <>
              <span className="w-24 shrink-0 truncate text-[13px] font-semibold" title={d.nombre}>
                {d.nombre}
              </span>
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-baseline justify-between text-[11px]">
                  <span className="num text-texto-2">
                    {numero(d.brechaReal)} / {numero(d.abiertas)} pedidos
                    {d.km2 > 0 && (
                      <span className="text-texto-3"> · {(d.abiertas / d.km2).toFixed(0)} por km²</span>
                    )}
                  </span>
                  <b className="num" style={{ color: pct >= 85 ? SEMAFORO.sin_atencion : "inherit" }}>{pct}%</b>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-panel-3">
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: SEMAFORO.sin_atencion }} />
                </div>
              </div>
              <span className="num w-16 shrink-0 text-right text-[13px]" style={{ color: SEMAFORO.resuelto }}>
                {numero(d.reparados)}
              </span>
              <span
                className="num w-20 shrink-0 text-right text-[13px]"
                style={{ color: d.m2Bacheo > 0 ? SEMAFORO.resuelto : "var(--color-texto-3, #6b7280)" }}
                title={d.m2Bacheo === 0 ? "Sin un solo m² de bacheo en este distrito" : undefined}
              >
                {d.m2Bacheo > 0 ? numero(d.m2Bacheo) : "—"}
              </span>
              <span
                className="num w-24 shrink-0 text-right text-[13px]"
                style={{ color: d.m2Obra > 0 ? SERIE.obra : "var(--color-texto-3, #6b7280)" }}
                title={
                  d.m2Obra > 0
                    ? `${numero(d.obras)} obras contratadas terminadas`
                    : "Sin obra contratada terminada en este distrito"
                }
              >
                {d.m2Obra > 0 ? numero(d.m2Obra) : "—"}
              </span>
            </>
          );
          // La fila "Fuera de los distritos" no es un lugar: no se puede abrir en el mapa.
          return d.id == null ? (
            <div key="sin-distrito" className="flex items-center gap-3 px-4 py-2.5" title="Pedidos y trabajos que caen fuera de los 20 polígonos oficiales">
              {fila}
            </div>
          ) : (
            <Link
              key={d.id}
              href={enMapa({ brecha: "sin_atencion", distrito: d.id })}
              className="flex items-center gap-3 px-4 py-2.5 transition hover:bg-panel-2"
              title={`Ver la deuda del ${d.nombre} en el mapa`}
            >
              {fila}
            </Link>
          );
        })}
      </div>
      </Panel>
      <p className="mt-2 text-[11px] text-texto-3">
        El distrito sale del cruce espacial con los 20 polígonos oficiales. “Fuera de los distritos” son los
        puntos que caen en los bordes o fuera del ejido — se muestran para que las sumas cierren.
      </p>

      {/* Top deuda */}
      <h2 className="mt-8 mb-3 text-sm font-bold tracking-wide uppercase">
        La deuda más concentrada <span className="font-normal text-texto-3">— direcciones con más pedidos y ninguna respuesta cerca</span>
      </h2>
      <Panel className="divide-y divide-borde/60">
        {b.topDeuda.map((d) => (
          <div key={d.direccion} className="flex items-center gap-3 px-4 py-2.5 text-sm">
            <span className="num w-8 shrink-0 text-center text-lg font-extrabold" style={{ color: SEMAFORO.sin_atencion }}>
              {d.pedidos}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate" title={d.direccion}>{d.direccion}</p>
              <p className="text-[11px] text-texto-3">
                {d.fuentes.map((f) => ETIQUETA_FUENTE[f as FuenteDemanda] ?? f).join(" · ")}
                {d.desde && <> · el más viejo: {fechaCorta(d.desde)}</>}
              </p>
            </div>
            {/* Hex crudo del juego claro (el tema por defecto): el mini-mapa
                concatena alfa sobre el color (`${color}33`) y var() no sirve. */}
            <VerEnMapa lat={d.lat} lon={d.lon} etiqueta={d.direccion} color={SEMAFORO_HEX.claro.sin_atencion} />
          </div>
        ))}
        {b.topDeuda.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-texto-3">Sin deuda concentrada. 🎉</p>
        )}
      </Panel>

      <p className="mt-6 text-xs leading-relaxed text-texto-3">
        Método: cruce espacial en radio de 40 m entre pedidos abiertos (con ubicación) y el historial de
        incidentes. "Probablemente resuelto" exige que la reparación sea posterior al pedido; los pedidos del
        consolidado histórico sin fecha se cuentan como probables si hay cualquier reparación cerca. La
        precisión mejora a medida que se corrige la geocodificación en{" "}
        <Link href="/calidad" className="text-celeste hover:underline">Calidad</Link>.
      </p>
    </div>
  );
}

function Segmento({
  n,
  total,
  color,
  tinta,
  href,
  titulo,
}: {
  n: number;
  total: number;
  color: string;
  tinta: string;
  /** Sin href el tramo se dibuja pero no se puede abrir: no hay un conjunto equivalente en el mapa. */
  href?: string;
  titulo?: string;
}) {
  if (n <= 0 || total <= 0) return null;
  const estilo = { width: `${(100 * n) / total}%`, background: color, marginRight: 2 };
  const etiqueta = (100 * n) / total > 7 && (
    <span className="num text-[11px] font-bold" style={{ color: tinta }}>{numero(n)}</span>
  );
  const clase = "flex h-full items-center justify-center overflow-hidden";
  return href ? (
    <Link href={href} className={`${clase} transition hover:brightness-125`} style={estilo}
      title={titulo ?? `${numero(n)} — clic para verlos en el mapa`}>
      {etiqueta}
    </Link>
  ) : (
    <span className={clase} style={estilo} title={titulo ?? numero(n)}>{etiqueta}</span>
  );
}

function Leyenda({ color, n, titulo, detalle, href }: { color: string; n: number; titulo: string; detalle: string; href?: string }) {
  const cuerpo = (
    <>
      <span className="mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
      <div>
        <span className="num font-bold">{numero(n)}</span> <span className="font-semibold">{titulo}</span>
        <p className="text-[11px] leading-snug text-texto-3">{detalle}</p>
      </div>
    </>
  );
  return href ? (
    <Link href={href} className="flex items-start gap-2 rounded-md p-1 transition hover:bg-panel-2" title="Ver en el mapa">
      {cuerpo}
    </Link>
  ) : (
    <div className="flex items-start gap-2 rounded-md p-1">{cuerpo}</div>
  );
}

/** Barras agrupadas SVG, sin librerías: pedidos vs. hechos por mes. */
function GraficoMensual({ datos }: { datos: Array<{ mes: string; pedidos: number; hechos: number }> }) {
  if (datos.length === 0) return <p className="py-6 text-center text-sm text-texto-3">Sin serie mensual aún.</p>;
  const alto = 160;
  const anchoGrupo = 46;
  const ancho = datos.length * anchoGrupo + 8;
  const max = Math.max(1, ...datos.flatMap((d) => [d.pedidos, d.hechos]));
  const h = (v: number) => Math.max(v > 0 ? 3 : 0, Math.round((v / max) * (alto - 24)));

  return (
    <div className="overflow-x-auto">
      <svg width={ancho} height={alto + 22} role="img" aria-label="Pedidos vs trabajos por mes">
        {datos.map((d, i) => {
          const x = 4 + i * anchoGrupo;
          const hp = h(d.pedidos);
          const hh = h(d.hechos);
          return (
            <a key={d.mes} href={`/demandas?mes=${d.mes}`}>
            <g style={{ cursor: "pointer" }}>
              <title>{`${d.mes}: ${numero(d.pedidos)} pedidos · ${numero(d.hechos)} trabajos — clic para ver esos pedidos`}</title>
              <rect x={x} y={alto - hp} width={16} height={hp} rx={3} fill={SERIE.pedidos} />
              <rect x={x + 19} y={alto - hh} width={16} height={hh} rx={3} fill={SERIE.hechos} />
              <text x={x + 18} y={alto + 14} textAnchor="middle" fontSize={9} fill="var(--color-texto-3)">
                {d.mes.slice(2).replace("-", "/")}
              </text>
            </g>
            </a>
          );
        })}
      </svg>
    </div>
  );
}
