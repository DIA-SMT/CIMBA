"use client";

import { MapPin, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { RolUsuario } from "@cimba/domain";
import {
  conMayuscula,
  diasEntre,
  etiquetaVentana,
  fechaLarga,
  nombreRecorte,
  type DatosAvance,
  type DiasVentana,
  type EventoAvance,
  type Proyeccion,
  type AvisosCierre,
  type TerritorioRef,
} from "@/lib/avance-tipos";
import { colorDeEmpresaEn } from "@/lib/color-empresa";
import { fechaCorta, numero } from "@/lib/formato";
import { LogoCimba } from "@/components/marca";
import { usarTemaMapa } from "@/components/mapa/tema-mapa";

/**
 * LA COLUMNA DE DATOS de Avance: las cifras de la ventana, el ritmo semanal,
 * dónde se avanzó más, quién produjo, las órdenes activas, las últimas fotos
 * y lo que está pasando.
 *
 * Positiva primero y honesta después: la cifra grande es lo hecho, pero la
 * tarjeta "Queda por hacer" está siempre, en neutro, con el mismo número que
 * dibuja el mapa en gris; y al lado de los m² dice cuántos trabajos no tienen
 * medida. Una pantalla de gestión que esconde eso no es positiva, es incompleta.
 *
 * La columna le habla al mapa: pasar el cursor por una empresa o una orden la
 * resalta; tocar una empresa la aísla y la encuadra; tocar un barrio recorta
 * la pantalla a ese barrio; tocar una foto o una línea del feed vuela al lugar.
 */

type Lugar = { lon: number; lat: number; id: number | null };

export function RailAvance({
  datos,
  dias,
  empresaSel,
  alElegirEmpresa,
  alResaltarEmpresa,
  alResaltarOrden,
  alEnfocar,
  alElegirTerritorio,
  alAmpliarFotos,
  alAbrirMuro,
  alcance,
  modoFalta,
  alAlternarFalta,
  pantalla,
  publico,
  rol,
}: {
  datos: DatosAvance;
  dias: DiasVentana;
  empresaSel: string | null;
  alElegirEmpresa: (empresa: string) => void;
  alResaltarEmpresa: (empresa: string | null) => void;
  alResaltarOrden: (id: number | null) => void;
  alEnfocar: (lugar: Lugar) => void;
  alElegirTerritorio: (t: TerritorioRef | null) => void;
  /** Abrir el antes y el después a pantalla completa, desde la foto tocada. */
  alAmpliarFotos: (indice: number) => void;
  /** Abrir el muro con todos los antes y después. */
  alAbrirMuro: () => void;
  /** En cuántas cuadras y barrios hubo trabajo en lo que se mira (null hasta que llegan las capas). */
  alcance: { cuadras: number; barrios: number; totalBarrios: number | null } | null;
  /** Si se está mirando lo que falta (pendientes al frente, proyección a la vista). */
  modoFalta: boolean;
  alAlternarFalta: () => void;
  pantalla: boolean;
  publico: boolean;
  rol: RolUsuario;
}) {
  const tema = usarTemaMapa();
  const color = (e: string) => colorDeEmpresaEn(e, tema);
  const c = datos.cifras;
  const filaSel = empresaSel ? datos.porEmpresa.find((e) => e.empresa === empresaSel) : null;
  /* Con una empresa elegida, la cifra grande es la de ESA empresa. */
  const hero = filaSel
    ? { n: filaSel.n, m2: filaSel.m2, toneladas: filaSel.toneladas, empresas: 1 }
    : c.ventana;
  const puedeNavegar = !pantalla && !publico;
  /* Lo cargado en las últimas 48 h que está en la ventana (con "Hoy" solo lo de hoy). */
  const recientes = datos.hechos.features.reduce((n, f) => n + (f.properties.reciente ? 1 : 0), 0);
  const nAnimado = useContador(hero.n);
  const m2Animado = useContador(hero.m2);

  return (
    <aside
      className={`flex shrink-0 flex-col gap-4 overflow-y-auto border-borde bg-panel p-4 lg:border-l ${
        pantalla ? "lg:w-[27rem] lg:p-5" : "lg:w-[24rem]"
      }`}
    >
      <Encabezado pantalla={pantalla} />

      {/* La cifra grande: lo hecho en la ventana */}
      <section className="rounded-2xl border border-borde bg-panel-2 p-4">
        <p className="flex flex-wrap items-center gap-x-1.5 text-[10px] font-bold tracking-[0.14em] text-texto-3 uppercase">
          <span>{etiquetaVentana(dias, c.total.desde)}</span>
          {datos.territorio && (
            <>
              <span aria-hidden="true">·</span>
              <button
                type="button"
                onClick={() => alElegirTerritorio(null)}
                title="Volver a toda la ciudad"
                className="flex items-center gap-1 rounded-md bg-amarillo/15 px-1.5 py-0.5 text-amarillo normal-case tracking-normal"
              >
                {nombreRecorte(datos.territorio)}
                <X size={10} />
              </button>
            </>
          )}
          {empresaSel && (
            <>
              <span aria-hidden="true">·</span>
              <span className="normal-case tracking-normal" style={{ color: color(empresaSel) }}>
                {empresaSel}
              </span>
            </>
          )}
        </p>
        <p className={`num mt-1 leading-none font-extrabold tracking-tight ${pantalla ? "text-6xl" : "text-5xl"}`}>
          {numero(nAnimado)}
          <span className="ml-2 text-lg font-bold text-texto-2">{hero.n === 1 ? "bache" : "baches"}</span>
        </p>
        <p className={`num mt-2 font-semibold text-celeste ${pantalla ? "text-2xl" : "text-xl"}`}>
          {numero(m2Animado)} m²
          <span className="ml-2 text-sm font-medium text-texto-2">
            · {numero(hero.toneladas)} t de mezcla
            {!empresaSel && ` · ${numero(hero.empresas)} ${hero.empresas === 1 ? "empresa" : "empresas"}`}
          </span>
        </p>
        {alcance && hero.n > 0 && (
          <p className="num mt-2 text-sm font-semibold text-texto-2">
            en <b className="text-texto">{numero(alcance.cuadras)}</b> {alcance.cuadras === 1 ? "cuadra" : "cuadras"}
            {alcance.totalBarrios != null && (
              <>
                {" "}de <b className="text-texto">{numero(alcance.barrios)}</b>{" "}
                {alcance.barrios === 1 ? "barrio" : "barrios"}
                <span className="font-normal text-texto-3">
                  {" "}
                  (de {numero(alcance.totalBarrios)}
                  {datos.territorio?.tipo === "distrito" ? " del distrito" : ""})
                </span>
              </>
            )}
          </p>
        )}
        {!empresaSel && c.ventana.sinMedida > 0 && (
          <p className="num mt-1 text-[11px] text-texto-3">
            {numero(c.ventana.sinMedida)} de los {numero(c.ventana.n)} sin medida cargada: los m² reales son más.
            {puedeNavegar && (
              <>
                {" "}
                <Link href="/intervenciones?medida=sin" className="font-semibold text-celeste">
                  Completarlos →
                </Link>
              </>
            )}
          </p>
        )}
        {c.ventana.vecinos > 0 && !empresaSel && (
          <p className="num mt-2 text-sm font-semibold" style={{ color: "var(--color-hecho)" }}>
            ✓ {numero(c.ventana.vecinos)} {c.ventana.vecinos === 1 ? "vecino" : "vecinos"} con su pedido cerrado
          </p>
        )}
        {hero.n === 0 && (
          <p className="mt-2 text-xs text-amarillo">
            {dias === 1 ? "Hoy todavía no hay trabajo cargado." : "Sin trabajo cargado en esta ventana."}
          </p>
        )}
      </section>

      {/* Las referencias fijas, siempre las mismas cinco */}
      <dl className="grid grid-cols-5 gap-1 text-center">
        <Referencia etiqueta="Hoy" cifra={c.hoy} />
        <Referencia etiqueta="Ayer" cifra={c.ayer} />
        <Referencia etiqueta="7 días" cifra={c.semana} />
        <Referencia etiqueta="30 días" cifra={c.mes} />
        <Referencia etiqueta={c.total.desde ? `Desde ${fechaCorta(c.total.desde).slice(0, 5)}` : "Total"} cifra={c.total} />
      </dl>

      <EnObraAhora datos={datos} recientes={recientes} alResaltarEmpresa={alResaltarEmpresa} alElegirEmpresa={alElegirEmpresa} color={color} />

      {/* Lo que falta, en neutro y con el mismo número que el mapa. Tocarlo
          pone los pendientes en el mapa y, recién ahí, la proyección. */}
      <section className={`rounded-2xl border px-4 py-3 ${modoFalta ? "border-borde-2 bg-panel-2" : "border-dashed border-borde-2"}`}>
        <p className="text-[10px] font-bold tracking-[0.14em] text-texto-3 uppercase">Queda por hacer</p>
        <p className="num mt-1 text-sm text-texto-2">
          <b className="text-texto">{numero(c.pendientes.pedidos)}</b> pedidos de bacheo en cola ·{" "}
          <b className="text-texto">{numero(c.pendientes.incidentes)}</b> baches en agenda
          {c.pendientes.asignadas > 0 && (
            <>
              {" "}· <b className="text-texto">{numero(c.pendientes.asignadas)}</b> obras asignadas sin empezar
              {c.pendientes.asignadasM2 > 0 && <> ({numero(c.pendientes.asignadasM2)} m²)</>}
            </>
          )}
        </p>
        {!publico && (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <button
              type="button"
              onClick={alAlternarFalta}
              aria-pressed={modoFalta}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                modoFalta ? "bg-panel-3 text-texto ring-1 ring-borde-2 hover:bg-panel" : "text-white hover:brightness-110"
              }`}
              style={modoFalta ? undefined : { background: "var(--color-sin-atencion)" }}
            >
              {modoFalta ? "Volver a lo hecho ✕" : "Ver lo que falta en el mapa"}
            </button>
            {puedeNavegar && (
              <Link href="/mapa?vista=brecha" className="text-xs font-semibold text-celeste">
                Brecha completa →
              </Link>
            )}
          </div>
        )}
      </section>

      {/* La proyección y los avisos aparecen solo cuando se pidió ver lo que
          falta: la fecha es información para quien la busca, no una presión
          permanente en la portada. */}
      {modoFalta && datos.proyeccion && <CuandoTerminamos p={datos.proyeccion} hoy={datos.hoy} recorte={datos.territorio != null} />}
      {modoFalta && datos.avisos && <AvisarAlVecino a={datos.avisos} puedeNavegar={puedeNavegar} />}

      <Ritmo serie={datos.serie} desde={datos.ventana.desde} />

      <DondeSeAvanzo datos={datos} alElegirTerritorio={alElegirTerritorio} />

      <QuienProdujo
        datos={datos}
        empresaSel={empresaSel}
        alElegir={alElegirEmpresa}
        alResaltar={alResaltarEmpresa}
        color={color}
      />

      <OrdenesActivas ordenes={datos.ordenes} puedeNavegar={puedeNavegar} alResaltar={alResaltarOrden} color={color} />

      {datos.fotos.length > 0 && (
        <section>
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <p className="text-[10px] font-bold tracking-[0.14em] text-texto-3 uppercase">Últimos trabajos, con foto</p>
            {datos.paresFotos > 0 && (
              <button type="button" onClick={alAbrirMuro} className="num shrink-0 text-xs font-bold text-celeste hover:underline">
                Ver los {numero(datos.paresFotos)} antes y después →
              </button>
            )}
          </div>
          <p className="-mt-1 mb-2 text-[10px] text-texto-3">Pasá el cursor para ver el antes; tocá para verlo grande.</p>
          <div className="grid grid-cols-3 gap-2">
            {datos.fotos.map((f, i) => {
              return (
                <button
                  key={`${f.url}-${i}`}
                  type="button"
                  onClick={() => alAmpliarFotos(i)}
                  title={[f.direccion, f.empresa, f.urlAntes ? "con antes y después" : null].filter(Boolean).join(" · ") || undefined}
                  className="group relative aspect-square overflow-hidden rounded-lg border border-borde bg-panel-3 text-left transition hover:border-celeste/60 focus:border-celeste disabled:cursor-default"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- fotos de Storage/externas */}
                  <img
                    src={f.url}
                    alt={f.direccion ?? "Trabajo terminado"}
                    className="absolute inset-0 h-full w-full object-cover transition group-hover:scale-105"
                    loading="lazy"
                  />
                  {f.urlAntes && (
                    // eslint-disable-next-line @next/next/no-img-element -- fotos de Storage/externas
                    <img
                      src={f.urlAntes}
                      alt=""
                      aria-hidden="true"
                      className="absolute inset-0 h-full w-full object-cover opacity-0 transition duration-300 group-hover:opacity-100 group-focus:opacity-100"
                      loading="lazy"
                    />
                  )}
                  {f.empresa && (
                    <span
                      className="absolute top-1 left-1 h-2.5 w-2.5 rounded-full border border-black/40"
                      style={{ background: color(f.empresa) }}
                      aria-hidden="true"
                    />
                  )}
                  {f.urlAntes && (
                    <span className="absolute top-1 right-1 rounded bg-black/60 px-1 py-0.5 text-[9px] font-bold tracking-wider text-white uppercase">
                      <span className="group-hover:hidden">después</span>
                      <span className="hidden group-hover:inline">antes</span>
                    </span>
                  )}
                  {f.direccion && (
                    <span className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-1.5 py-0.5 text-[10px] text-white">
                      {f.direccion}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {datos.feed.length > 0 && ["admin", "planificacion"].includes(rol) && (
        <section>
          <Rotulo>Pasando ahora · última semana</Rotulo>
          <ul className="space-y-1">
            {datos.feed.map((e) => (
              <Movimiento key={e.id} e={e} alEnfocar={alEnfocar} color={color} />
            ))}
          </ul>
        </section>
      )}

      <p className="mt-auto pt-2 text-center text-[10px] text-texto-3">
        Actualizado a las {horaDe(datos.generadoEn)} · se renueva solo cada minuto · la fecha es la del trabajo, no la de la carga
        {publico ? " · Municipalidad de San Miguel de Tucumán" : ""}
      </p>
    </aside>
  );
}

/**
 * Los números SUBEN hasta su valor en vez de aparecer: al abrir (desde cero)
 * y en cada cambio de ventana, recorte o empresa. Es lo que hace que la
 * pantalla se sienta viva desde la otra punta de la oficina. Con movimiento
 * reducido, aparecen directo.
 */
function useContador(valor: number): number {
  const [mostrado, setMostrado] = useState(valor);
  const anterior = useRef<number | null>(null);
  useEffect(() => {
    const desde = anterior.current ?? 0;
    anterior.current = valor;
    if (desde === valor) {
      setMostrado(valor);
      return;
    }
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setMostrado(valor);
      return;
    }
    const t0 = performance.now();
    const duracion = 900;
    let raf = 0;
    const paso = (t: number) => {
      const k = Math.min(1, (t - t0) / duracion);
      const suave = 1 - Math.pow(1 - k, 3);
      setMostrado(Math.round(desde + (valor - desde) * suave));
      if (k < 1) raf = requestAnimationFrame(paso);
    };
    raf = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(raf);
  }, [valor]);
  return mostrado;
}

const horaDe = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });
};

function Encabezado({ pantalla }: { pantalla: boolean }) {
  const [reloj, setReloj] = useState("");
  useEffect(() => {
    if (!pantalla) return;
    const tic = () =>
      setReloj(new Date().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false }));
    tic();
    const id = window.setInterval(tic, 1000);
    return () => window.clearInterval(id);
  }, [pantalla]);

  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        {pantalla && (
          <div className="mb-2">
            <LogoCimba />
          </div>
        )}
        <h1 className="text-lg leading-tight font-extrabold tracking-tight">Avance</h1>
        <p className="text-xs text-texto-2">Lo hecho y lo que se está haciendo · San Miguel de Tucumán</p>
      </div>
      {pantalla && (
        <div className="text-right">
          <p className="num text-4xl leading-none font-extrabold tracking-tight">{reloj}</p>
          <p className="mt-0.5 text-[11px] text-texto-3">
            {conMayuscula(new Date().toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" }))}
          </p>
        </div>
      )}
    </div>
  );
}

function Referencia({ etiqueta, cifra }: { etiqueta: string; cifra: { n: number; m2: number } }) {
  return (
    <div className="rounded-xl bg-panel-2 px-1 py-2">
      <dt className="text-[9px] font-bold tracking-wider text-texto-3 uppercase">{etiqueta}</dt>
      <dd className="num mt-0.5 text-base leading-none font-extrabold">{numero(cifra.n)}</dd>
      <dd className="num mt-0.5 text-[10px] text-texto-2">{numero(cifra.m2)} m²</dd>
    </div>
  );
}

function Rotulo({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 text-[10px] font-bold tracking-[0.14em] text-texto-3 uppercase">{children}</p>;
}

/**
 * EN OBRA AHORA: no depende de la ventana. Las órdenes activas por empresa
 * (un chip cada una: se ve de un golpe quién tiene trabajo mandado hoy), las
 * obras en curso y lo cargado en las últimas 48 horas.
 */
function EnObraAhora({
  datos,
  recientes,
  alResaltarEmpresa,
  alElegirEmpresa,
  color,
}: {
  datos: DatosAvance;
  recientes: number;
  alResaltarEmpresa: (e: string | null) => void;
  alElegirEmpresa: (e: string) => void;
  color: (e: string) => string;
}) {
  const c = datos.cifras.ahora;
  const porEmpresa = new Map<string, number>();
  for (const o of datos.ordenes) porEmpresa.set(o.empresa, (porEmpresa.get(o.empresa) ?? 0) + 1);
  const chips = [...porEmpresa.entries()].sort((a, b) => b[1] - a[1]);
  return (
    <section className="rounded-2xl border border-celeste/30 bg-celeste/5 px-4 py-3">
      <p className="text-[10px] font-bold tracking-[0.14em] text-celeste uppercase">En obra ahora</p>
      <p className="num mt-1 text-sm text-texto-2">
        <b className="text-texto">{numero(c.ordenesActivas)}</b>{" "}
        {c.ordenesActivas === 1 ? "orden activa" : "órdenes activas"} ·{" "}
        <b className="text-texto">{numero(c.obras)}</b> {c.obras === 1 ? "obra" : "obras"} en curso
        {c.m2 > 0 && <> ({numero(c.m2)} m²)</>} ·{" "}
        <b className="text-texto">{numero(recientes)}</b> {recientes === 1 ? "carga" : "cargas"} en 48 h
      </p>
      {chips.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {chips.map(([empresa, n]) => (
            <button
              key={empresa}
              type="button"
              onClick={() => alElegirEmpresa(empresa)}
              onMouseEnter={() => alResaltarEmpresa(empresa)}
              onMouseLeave={() => alResaltarEmpresa(null)}
              onFocus={() => alResaltarEmpresa(empresa)}
              onBlur={() => alResaltarEmpresa(null)}
              title={`${empresa}: ${numero(n)} ${n === 1 ? "orden activa" : "órdenes activas"}. Tocá para verla sola.`}
              className="flex items-center gap-1.5 rounded-full border border-borde bg-panel px-2 py-0.5 text-[11px] font-semibold text-texto-2 transition hover:border-celeste/60 hover:text-texto"
            >
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: color(empresa) }} aria-hidden="true" />
              {empresa}
              <span className="num text-texto-3">{n}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * EL RITMO: m² por semana en las últimas 26. Las semanas dentro de la ventana
 * van en celeste, las de afuera apagadas, la actual en amarillo: se ve de un
 * golpe si el mes que se está mirando fue fuerte o flojo respecto del resto.
 */
function Ritmo({ serie, desde }: { serie: DatosAvance["serie"]; desde: string | null }) {
  const usaM2 = serie.some((s) => s.m2 > 0);
  const max = Math.max(1, ...serie.map((s) => (usaM2 ? s.m2 : s.n)));
  const pico = serie.reduce((a, b) => ((usaM2 ? b.m2 : b.n) > (usaM2 ? a.m2 : a.n) ? b : a), serie[0]!);
  const ANCHO = 12;
  const W = serie.length * ANCHO - 3;
  const H = 48;
  return (
    <section>
      <Rotulo>Ritmo · {usaM2 ? "m²" : "baches"} por semana, últimas 26 semanas</Rotulo>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-14 w-full" role="img" aria-label="Metros cuadrados ejecutados por semana">
        {serie.map((s, i) => {
          const v = usaM2 ? s.m2 : s.n;
          const h = Math.max(1.5, Math.round((v / max) * (H - 4)));
          const actual = i === serie.length - 1;
          const enVentana = !desde || s.semana >= desde.slice(0, 10) || actual;
          const color = actual ? "var(--color-amarillo)" : enVentana ? "var(--color-celeste)" : "var(--color-borde-2)";
          return (
            <rect key={s.semana} x={i * ANCHO} y={H - h} width={ANCHO - 3} height={h} rx="1.5" fill={color}>
              <title>{`Semana del ${fechaCorta(s.semana)} · ${numero(s.m2)} m² · ${numero(s.n)} baches`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-texto-3">
        <span>hace 26 semanas</span>
        {pico && (usaM2 ? pico.m2 : pico.n) > 0 && (
          <span className="num">
            pico: {numero(usaM2 ? pico.m2 : pico.n)} {usaM2 ? "m²" : "baches"} · semana del {fechaLarga(pico.semana)}
          </span>
        )}
        <span className="text-amarillo">esta semana</span>
      </div>
    </section>
  );
}

/** "2 de enero" o "2 de enero de 2027" si cambia el año; con el día de la semana en el título. */
function fechaProyectada(iso: string, hoy: string) {
  const d = new Date(`${iso}T12:00:00Z`);
  const mismoAnio = iso.slice(0, 4) === hoy.slice(0, 4);
  return {
    corta: new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "long", ...(mismoAnio ? {} : { year: "numeric" }), timeZone: "UTC" }).format(d),
    larga: conMayuscula(new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(d)),
  };
}

/**
 * ¿CUÁNDO TERMINAMOS? La regla de tres, dicha completa y sin promesas: lo
 * hecho, lo que falta (el mismo número que "Queda por hacer"), el ritmo de
 * los últimos 90 días, lo que sigue entrando, y las dos fechas que salen de
 * ahí. Abajo, el gráfico del acumulado con la proyección punteada: la misma
 * curva que se mostró en papel el 1/10, ahora viva.
 *
 * Es deliberadamente SERIA: la fecha grande es la realista (con los pedidos
 * que siguen entrando), la optimista va en segundo plano, y si el ritmo no
 * alcanza se dice "a este ritmo no se termina" en vez de inventar una fecha.
 */
function CuandoTerminamos({ p, hoy, recorte }: { p: Proyeccion; hoy: string; recorte: boolean }) {
  const total = p.hechos + p.pendientes;
  const pct = total > 0 ? Math.round((p.hechos / total) * 100) : 100;
  const realista = p.fechaRealista ? fechaProyectada(p.fechaRealista, hoy) : null;
  const sinNuevos = p.fechaSinNuevos ? fechaProyectada(p.fechaSinNuevos, hoy) : null;
  const tendencia = p.ritmoMes > 0 ? (p.ritmoUltimoMes - p.ritmoMes) / p.ritmoMes : 0;
  const meses = (dias: number) => (dias / 30.44).toFixed(1).replace(".", ",");

  return (
    <section className="rounded-2xl border border-borde bg-panel-2 p-4">
      <Rotulo>¿Cuándo terminamos lo que falta?</Rotulo>

      {p.pendientes === 0 ? (
        <p className="text-sm font-semibold" style={{ color: "var(--color-hecho)" }}>
          No hay nada pendiente{recorte ? " en este recorte" : ""}. Al día.
        </p>
      ) : p.ritmoMes === 0 ? (
        <p className="text-sm text-texto-2">
          Sin trabajo resuelto en los últimos 90 días{recorte ? " en este recorte" : ""}: no hay ritmo con qué proyectar.
        </p>
      ) : (
        <>
          {realista ? (
            <>
              <p className="text-3xl leading-none font-extrabold tracking-tight" title={realista.larga}>
                {realista.corta}
              </p>
              <p className="num mt-1.5 text-xs text-texto-2">
                Si siguen entrando ≈{numero(p.entranMes)} pedidos de bacheo por mes · {meses(p.diasRealista!)} meses
              </p>
            </>
          ) : (
            <>
              <p className="text-xl leading-tight font-extrabold tracking-tight text-amarillo">A este ritmo no se termina</p>
              <p className="num mt-1.5 text-xs text-texto-2">
                Entran ≈{numero(p.entranMes)} pedidos por mes y se resuelven ≈{numero(p.ritmoMes)}: lo pendiente crece.
              </p>
            </>
          )}
          {sinNuevos && (
            <p className="num mt-2 text-xs text-texto-3">
              Si no entrara nada nuevo: <b className="text-texto-2">{sinNuevos.corta}</b> · {meses(p.diasSinNuevos!)} meses
            </p>
          )}
        </>
      )}

      <GraficoProyeccion p={p} hoy={hoy} />

      <dl className="num mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-panel px-2 py-1.5">
          <dt className="text-[9px] font-bold tracking-[0.12em] text-texto-3 uppercase">Hecho</dt>
          <dd className="text-sm font-bold" style={{ color: "var(--color-hecho)" }}>{numero(p.hechos)}</dd>
          <dd className="text-[10px] text-texto-3">{pct}%</dd>
        </div>
        <div className="rounded-lg bg-panel px-2 py-1.5">
          <dt className="text-[9px] font-bold tracking-[0.12em] text-texto-3 uppercase">Falta</dt>
          <dd className="text-sm font-bold">{numero(p.pendientes)}</dd>
          <dd className="text-[10px] text-texto-3">{100 - pct}%</dd>
        </div>
        <div className="rounded-lg bg-panel px-2 py-1.5">
          <dt className="text-[9px] font-bold tracking-[0.12em] text-texto-3 uppercase">Ritmo</dt>
          <dd className="text-sm font-bold">{numero(p.ritmoMes)}<span className="text-[10px] font-medium text-texto-3">/mes</span></dd>
          <dd className="text-[10px] text-texto-3" title="Resueltos en los últimos 30 días contra el promedio de 90">
            últ. 30 d: {numero(p.ritmoUltimoMes)}{Math.abs(tendencia) >= 0.1 ? (tendencia > 0 ? " ↑" : " ↓") : ""}
          </dd>
        </div>
      </dl>

      <p className="mt-2.5 text-[10px] leading-snug text-texto-3">
        Cuenta como pendiente todo pedido sin confirmar: la fecha se acerca a medida que se reparan o se confirman. Es el
        ritmo de hoy aplicado a lo que falta, no una promesa.
      </p>
    </section>
  );
}

/**
 * El acumulado de resueltos por mes, y desde hoy la proyección punteada hasta
 * la meta. La meta sube con lo que sigue entrando (línea azul). Sin ejes
 * cargados: en la columna vale más la forma que el detalle; los valores
 * exactos están arriba.
 */
function GraficoProyeccion({ p, hoy }: { p: Proyeccion; hoy: string }) {
  if (p.serie.length === 0 || p.ritmoMes === 0) return null;
  const W = 320;
  const H = 96;
  const M = { l: 4, r: 4, t: 10, b: 16 };
  const total = p.hechos + p.pendientes;
  const diasHorizonte = Math.max(60, Math.min(400, (p.diasRealista ?? p.diasSinNuevos ?? 90) + 30));
  const hoyDia = Date.parse(`${hoy}T12:00:00Z`) / 86_400_000;
  const dia0 = Date.parse(`${p.serie[0]!.mes}-01T12:00:00Z`) / 86_400_000;
  const diaFin = hoyDia + diasHorizonte;
  const x = (dia: number) => M.l + ((dia - dia0) / (diaFin - dia0)) * (W - M.l - M.r);
  const yMax = Math.max(total * 1.08, p.hechos * 1.08, 1);
  const y = (v: number) => H - M.b - (v / yMax) * (H - M.t - M.b);

  let acum = 0;
  const puntos: Array<[number, number]> = [[dia0, 0]];
  for (const s of p.serie) {
    acum += s.n;
    const [a, m] = s.mes.split("-").map(Number);
    const finMes = Date.UTC(a!, m!, 0, 12) / 86_400_000; // último día del mes
    puntos.push([Math.min(finMes, hoyDia), acum]);
  }
  puntos.push([hoyDia, p.hechos]);
  const linea = puntos.map(([d, v], i) => `${i ? "L" : "M"}${x(d).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${linea} L${x(hoyDia).toFixed(1)},${y(0).toFixed(1)} L${x(dia0).toFixed(1)},${y(0).toFixed(1)} Z`;

  const ritmoDia = p.ritmoMes / 30.44;
  const entranDia = p.entranMes / 30.44;
  const finProy = p.diasRealista != null ? hoyDia + p.diasRealista : diaFin;
  const proy = `M${x(hoyDia).toFixed(1)},${y(p.hechos).toFixed(1)} L${x(finProy).toFixed(1)},${y(p.hechos + ritmoDia * (finProy - hoyDia)).toFixed(1)}`;
  const meta = `M${x(hoyDia).toFixed(1)},${y(total).toFixed(1)} L${x(diaFin).toFixed(1)},${y(total + entranDia * diasHorizonte).toFixed(1)}`;

  /* Marcas de mes en el eje: una letra por mes, sin apretar. */
  const meses: Array<[number, string]> = [];
  for (let d = new Date(dia0 * 86_400_000); d.getTime() / 86_400_000 < diaFin; d.setUTCMonth(d.getUTCMonth() + 1, 1)) {
    meses.push([d.getTime() / 86_400_000, "EFMAMJJASOND"[d.getUTCMonth()]!]);
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 block h-24 w-full" role="img" aria-label="Baches resueltos acumulados y proyección hasta terminar lo pendiente">
      <line x1={M.l} x2={W - M.r} y1={y(0)} y2={y(0)} stroke="var(--color-borde-2)" strokeWidth="1" />
      <line x1={M.l} x2={W - M.r} y1={y(total)} y2={y(total)} stroke="var(--color-borde-2)" strokeWidth="1" strokeDasharray="4 3" />
      <path d={meta} fill="none" stroke="var(--color-celeste)" strokeWidth="1.5" strokeDasharray="4 3" opacity="0.8" />
      <path d={area} fill="var(--color-hecho)" opacity="0.14" />
      <path d={linea} fill="none" stroke="var(--color-hecho)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <path d={proy} fill="none" stroke="var(--color-hecho)" strokeWidth="2" strokeDasharray="2 4" strokeLinecap="round" />
      <line x1={x(hoyDia)} x2={x(hoyDia)} y1={M.t} y2={y(0)} stroke="var(--color-amarillo)" strokeWidth="1.2" strokeDasharray="2 3" />
      <circle cx={x(hoyDia)} cy={y(p.hechos)} r="3.5" fill="var(--color-hecho)" stroke="var(--color-panel-2)" strokeWidth="1.5" />
      {p.diasRealista != null && (
        <circle cx={x(finProy)} cy={y(p.hechos + ritmoDia * p.diasRealista)} r="4" fill="var(--color-panel-2)" stroke="var(--color-celeste)" strokeWidth="2" />
      )}
      <text x={x(hoyDia) + 4} y={M.t + 7} fontSize="8" fontWeight="700" fill="var(--color-amarillo)" letterSpacing="0.08em">HOY</text>
      <text x={M.l + 2} y={y(total) - 3} fontSize="8" fill="var(--color-texto-3)">meta {numero(total)}</text>
      {meses.map(([d, l]) => (
        <text key={d} x={x(d) + 2} y={H - 4} fontSize="8" fill="var(--color-texto-3)">{l}</text>
      ))}
    </svg>
  );
}

/**
 * AVISAR AL VECINO: a cuántos se les puede cerrar el pedido con la foto del
 * arreglo. Es la cuenta que la Dirección pidió el 1/10: no cuántos baches se
 * hicieron, sino a cuántas personas se les puede mostrar. Lo que frena no es
 * el trabajo: la mayoría de los pedidos entró por planilla, sin teléfono.
 */
function AvisarAlVecino({ a, puedeNavegar }: { a: AvisosCierre; puedeNavegar: boolean }) {
  const hoyMismo = a.listosConFotoYContacto;
  const alConfirmar = a.candidatosConFotoYContacto;
  return (
    <section className="rounded-2xl border border-borde px-4 py-3">
      <Rotulo>Avisar al vecino, con la foto del arreglo</Rotulo>
      <p className="num text-sm text-texto-2">
        <b className="text-texto">{numero(hoyMismo)}</b> {hoyMismo === 1 ? "pedido listo" : "pedidos listos"} para avisar hoy ·{" "}
        <b className="text-texto">{numero(alConfirmar)}</b> más en cuanto se confirmen
      </p>
      <p className="num mt-1 text-[11px] leading-snug text-texto-3">
        De los {numero(a.listos)} resueltos que esperan el cierre, {numero(a.listosSinContacto)} no traen teléfono ni mail: entraron por el
        Concejo, la S.A.T. o planillas, y no hay a quién avisarle.
        {a.listosConContactoSinFoto > 0 && <> {numero(a.listosConContactoSinFoto)} tienen contacto pero no foto.</>}
      </p>
      <p className="num mt-1 text-[11px] text-texto-3">
        Ya avisados: <b className="text-texto-2">{numero(a.cerrados)}</b>
        {a.cerrados > 0 && <>, {numero(a.cerradosConFoto)} con la foto en el mensaje</>}.
      </p>
      {puedeNavegar && (
        <p className="mt-1.5 flex flex-wrap gap-x-3 text-xs font-semibold">
          <Link href="/cierres" className="text-celeste">Ir a Cierres →</Link>
          <Link href="/mapa?vista=brecha" className="text-celeste">Confirmar desde el mapa →</Link>
        </p>
      )}
    </section>
  );
}

/** DÓNDE SE AVANZÓ MÁS: los barrios con más trabajo en la ventana. Tocar uno recorta la pantalla a ese barrio. */
function DondeSeAvanzo({
  datos,
  alElegirTerritorio,
}: {
  datos: DatosAvance;
  alElegirTerritorio: (t: TerritorioRef | null) => void;
}) {
  const filas = datos.topBarrios;
  if (filas.length === 0) return null;
  const max = Math.max(1, ...filas.map((f) => f.n));
  return (
    <section>
      <Rotulo>
        Dónde se avanzó más · {datos.territorio?.tipo === "distrito" ? `barrios de ${datos.territorio.nombre}` : "barrios"} · tocá uno para verlo
      </Rotulo>
      <ul className="space-y-1">
        {filas.map((b, i) => (
          <li key={b.id}>
            <button
              type="button"
              onClick={() => alElegirTerritorio({ tipo: "barrio", id: b.id })}
              className="grid w-full grid-cols-[1.2rem_minmax(0,7.5rem)_1fr_auto] items-center gap-2 rounded-lg px-1.5 py-1 text-left text-xs transition hover:bg-panel-2"
            >
              <span className="num text-[10px] font-bold text-texto-3">{i + 1}</span>
              <span className="truncate font-semibold text-texto-2">{b.nombre}</span>
              <span className="h-1.5 overflow-hidden rounded-full bg-panel-3">
                <span className="block h-full rounded-full bg-amarillo" style={{ width: `${Math.max(3, Math.round((b.n / max) * 100))}%` }} />
              </span>
              <span className="num text-right text-texto-2">
                {numero(b.n)} {b.n === 1 ? "bache" : "baches"}
                {b.m2 > 0 && <span className="block text-[10px] text-texto-3">{numero(b.m2)} m²</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Quién produjo en la ventana. Es también la leyenda del mapa: pasar el cursor resalta, tocar aísla. */
function QuienProdujo({
  datos,
  empresaSel,
  alElegir,
  alResaltar,
  color,
}: {
  datos: DatosAvance;
  empresaSel: string | null;
  alElegir: (e: string) => void;
  alResaltar: (e: string | null) => void;
  color: (e: string) => string;
}) {
  const filas = datos.porEmpresa;
  if (filas.length === 0) return null;
  const usaM2 = filas.some((f) => f.m2 > 0);
  const max = Math.max(1, ...filas.map((f) => (usaM2 ? f.m2 : f.n)));
  return (
    <section>
      <Rotulo>Quién produjo · pasá el cursor para resaltar, tocá para ver sola</Rotulo>
      <ul className="space-y-1" onMouseLeave={() => alResaltar(null)}>
        {filas.map((f) => {
          const v = usaM2 ? f.m2 : f.n;
          const activa = empresaSel === f.empresa;
          const apagada = empresaSel != null && !activa;
          /* La frescura: cuántos días hace que la empresa no carga nada. Más de
             una semana se marca en ámbar; es la primera pregunta de Bacheo. */
          const hace = f.ultimo ? diasEntre(f.ultimo, datos.hoy) : null;
          const frescura = hace == null ? null : hace <= 0 ? "cargó hoy" : hace === 1 ? "cargó ayer" : `último dato hace ${numero(hace)} d`;
          return (
            <li key={f.empresa}>
              <button
                type="button"
                onClick={() => alElegir(f.empresa)}
                onMouseEnter={() => alResaltar(f.empresa)}
                onFocus={() => alResaltar(f.empresa)}
                onBlur={() => alResaltar(null)}
                aria-pressed={activa}
                className={`grid w-full grid-cols-[12px_minmax(0,6.5rem)_1fr_auto] items-center gap-2 rounded-lg px-1.5 py-1 text-left text-xs transition hover:bg-panel-2 ${
                  apagada ? "opacity-45" : ""
                } ${activa ? "bg-panel-2" : ""}`}
              >
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ background: color(f.empresa) }}
                  aria-hidden="true"
                />
                <span className="min-w-0">
                  <span className={`block truncate ${activa ? "font-bold" : "font-semibold text-texto-2"}`}>{f.empresa}</span>
                  {frescura && (
                    <span className={`block truncate text-[10px] ${hace != null && hace > 7 ? "text-amarillo" : "text-texto-3"}`}>
                      {frescura}
                    </span>
                  )}
                </span>
                <span className="h-1.5 overflow-hidden rounded-full bg-panel-3">
                  <span
                    className="block h-full rounded-full"
                    style={{ width: `${Math.max(2, Math.round((v / max) * 100))}%`, background: color(f.empresa) }}
                  />
                </span>
                <span className="num text-right text-texto-2">
                  {f.m2 > 0 ? `${numero(f.m2)} m²` : "sin m²"}
                  <span className="block text-[10px] text-texto-3">{numero(f.n)} {f.n === 1 ? "bache" : "baches"}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function OrdenesActivas({
  ordenes,
  puedeNavegar,
  alResaltar,
  color,
}: {
  ordenes: DatosAvance["ordenes"];
  puedeNavegar: boolean;
  alResaltar: (id: number | null) => void;
  color: (e: string) => string;
}) {
  if (ordenes.length === 0) return null;
  const visibles = ordenes.slice(0, 8);
  return (
    <section>
      <Rotulo>Órdenes activas · {numero(ordenes.length)} · pasá el cursor para ubicarla</Rotulo>
      <ul className="space-y-1" onMouseLeave={() => alResaltar(null)}>
        {visibles.map((o) => {
          const contenido = (
            <>
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: color(o.empresa) }}
                aria-hidden="true"
              />
              <span className="num shrink-0 font-bold">{o.numero}</span>
              <span className="min-w-0 flex-1 truncate text-texto-2">{o.empresa}</span>
              <span className="num shrink-0 text-texto-2" title="baches hechos / baches de la orden">
                {numero(o.hechos)}/{numero(o.items)}
              </span>
              <span className="num shrink-0 text-[10px] text-texto-3">{o.ultimo ? fechaCorta(o.ultimo) : "sin reporte"}</span>
            </>
          );
          const clase = "flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-xs transition hover:bg-panel-2";
          return (
            <li key={o.id} onMouseEnter={() => alResaltar(o.id)}>
              {puedeNavegar ? (
                <Link href={`/ordenes/${o.id}`} className={clase} onFocus={() => alResaltar(o.id)} onBlur={() => alResaltar(null)}>
                  {contenido}
                </Link>
              ) : (
                <div className={clase}>{contenido}</div>
              )}
            </li>
          );
        })}
      </ul>
      {ordenes.length > visibles.length && puedeNavegar && (
        <Link href="/ordenes" className="mt-1.5 inline-block px-1.5 text-xs font-semibold text-celeste">
          y {numero(ordenes.length - visibles.length)} más en Órdenes →
        </Link>
      )}
    </section>
  );
}

/* ── El feed: una frase por movimiento, con su hora y su lugar ─────────── */

const COLOR_TIPO: Record<EventoAvance["tipo"], string> = {
  hecho: "var(--color-hecho)",
  propuesto: "var(--color-celeste)",
  validado: "var(--color-celeste)",
  descartado: "var(--color-texto-3)",
  orden: "var(--color-azul)",
  verificado: "var(--color-hecho)",
  vecino: "var(--color-amarillo)",
  carga: "var(--color-celeste)",
  corregido: "var(--color-texto-3)",
  sync: "var(--color-texto-3)",
};

function Movimiento({
  e,
  alEnfocar,
  color,
}: {
  e: EventoAvance;
  alEnfocar: (lugar: Lugar) => void;
  color: (empresa: string) => string;
}) {
  const ir = e.lon != null && e.lat != null ? () => alEnfocar({ lon: e.lon!, lat: e.lat!, id: null }) : undefined;
  const tono = e.empresa ? color(e.empresa) : COLOR_TIPO[e.tipo];
  const cuerpo = (
    <>
      <span className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: tono }} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block leading-snug text-texto">{e.frase}</span>
        <span className="num block truncate text-[10px] text-texto-3">
          {hace(e.en)}
          {e.lugar ? ` · ${e.lugar}` : ""}
        </span>
      </span>
      {ir && <MapPin size={12} className="mt-1 shrink-0 text-texto-3" aria-hidden="true" />}
    </>
  );
  const clase = "flex w-full items-start gap-2 rounded-lg px-1.5 py-1 text-left text-[13px]";
  return (
    <li>
      {ir ? (
        <button type="button" onClick={ir} title="Ver en el mapa" className={`${clase} transition hover:bg-panel-2`}>
          {cuerpo}
        </button>
      ) : (
        <div className={clase}>{cuerpo}</div>
      )}
    </li>
  );
}

const hace = (iso: string) => {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (!Number.isFinite(min) || min < 0) return "";
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  if (min < 60 * 24) return `hace ${Math.round(min / 60)} h`;
  return `hace ${Math.round(min / 1440)} d`;
};
