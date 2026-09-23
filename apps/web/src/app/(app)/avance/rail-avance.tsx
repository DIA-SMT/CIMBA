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

      {/* Lo que falta, en neutro y con el mismo número que el mapa */}
      <section className="rounded-2xl border border-dashed border-borde-2 px-4 py-3">
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
        {puedeNavegar && (
          <Link href="/mapa?vista=brecha" className="mt-1.5 inline-block text-xs font-semibold text-celeste">
            Ver la brecha en el mapa →
          </Link>
        )}
      </section>

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
