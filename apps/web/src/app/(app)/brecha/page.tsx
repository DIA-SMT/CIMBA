import Link from "next/link";
import { leerSesion } from "@/lib/auth";
import { estadisticasBrecha } from "@/lib/consultas";
import { ETIQUETA_FUENTE, ETIQUETA_TIPO, fechaCorta, numero } from "@/lib/formato";
import type { FuenteDemanda, TipoProblema } from "@cimba/domain";
import { Panel, TituloPagina } from "@/components/ui";
import { VerEnMapa } from "@/components/mapa/ver-en-mapa";
import { BotonCotejo } from "./boton-cotejo";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Paleta funcional validada sobre superficie oscura (misma del mapa). */
const C = { pedido: "#3987e5", hecho: "#199e70", alerta: "#d95926" } as const;

export default async function PaginaBrecha() {
  const sesion = (await leerSesion())!;
  const b = await estadisticasBrecha(sesion);
  const puedeCotejar = ["admin", "atencion_ciudadana", "planificacion", "supervision"].includes(
    sesion.rol_cimba,
  );

  const atendidoDeAlgunModo = b.yaResueltasProbable + b.enCola;
  const pctBrecha = b.totalAbiertas > 0 ? Math.round((100 * b.brechaReal) / b.totalAbiertas) : 0;
  const pctSinPedido = b.trabajoTotal > 0 ? Math.round((100 * b.trabajoSinPedido) / b.trabajoTotal) : 0;

  return (
    <div className="mx-auto max-w-6xl p-6">
      <TituloPagina
        titulo="Brecha: lo pedido vs. lo hecho"
        sub="La medición central de CIMBA. Cada pedido abierto se cruza contra el territorio en un radio de 40 m."
        extra={
          <Link
            href="/mapa?vista=brecha"
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
          aria-label={`Sin atención ${b.brechaReal}, en cola ${b.enCola}, ya resueltos probables ${b.yaResueltasProbable}, reincidencias ${b.reincidencias}`}>
          <Segmento n={b.brechaReal} total={b.totalAbiertas} color={C.alerta} href="/mapa?vista=brecha&brecha=sin_atencion" />
          <Segmento n={b.enCola} total={b.totalAbiertas} color={C.pedido} href="/mapa?vista=brecha&brecha=en_cola" />
          <Segmento n={b.yaResueltasProbable} total={b.totalAbiertas} color={C.hecho} href="/mapa?vista=brecha&brecha=posible_resuelta" />
          <Segmento n={b.reincidencias} total={b.totalAbiertas} color="#f4dc00" href="/mapa?vista=brecha&brecha=posible_resuelta" />
        </div>
        <div className="mt-3 grid gap-2 text-[13px] sm:grid-cols-4">
          <Leyenda color={C.alerta} n={b.brechaReal} titulo="Sin atención (brecha real)"
            detalle="Nadie los tocó: no hay reparación ni trabajo en curso cerca." href="/mapa?vista=brecha&brecha=sin_atencion" />
          <Leyenda color={C.pedido} n={b.enCola} titulo="En cola"
            detalle="Hay un incidente abierto cerca: están en proceso." href="/mapa?vista=brecha&brecha=en_cola" />
          <Leyenda color={C.hecho} n={b.yaResueltasProbable} titulo="Probablemente ya resueltos"
            detalle="Hay una reparación posterior al pedido a menos de 40 m: falta cerrar el circuito, no falta obra." href="/mapa?vista=brecha&brecha=posible_resuelta" />
          <Leyenda color="#f4dc00" n={b.reincidencias} titulo="Reincidencias"
            detalle="Se reparó ANTES del pedido y volvieron a reclamar: el problema volvió." href="/mapa?vista=brecha&brecha=posible_resuelta" />
        </div>
      </Panel>

      {/* Los dos números que duelen */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        <Link href="/mapa?vista=brecha&brecha=sin_atencion" className="block">
        <Panel className="h-full p-5 transition hover:border-encurso/50">
          <div className="num text-3xl font-extrabold" style={{ color: C.alerta }}>
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
            Se trabaja mucho ({numero(b.m2Total)} m²), pero no siempre donde está la demanda: la brecha es de
            dirección, no solo de volumen. <span className="text-celeste">Ver las intervenciones →</span>
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
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: C.pedido }} /> Pedidos ingresados
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: C.hecho }} /> Trabajos finalizados
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
                <Link key={f.fuente} href={`/mapa?vista=brecha&fuente=${f.fuente}`} className="block rounded-md px-1 py-0.5 transition hover:bg-panel-2" title="Ver esta fuente en el mapa">
                  <div className="mb-1 flex items-baseline justify-between text-[13px]">
                    <span>{ETIQUETA_FUENTE[f.fuente as FuenteDemanda] ?? f.fuente}</span>
                    <span className="num text-xs text-texto-2">
                      {numero(f.atendidas)} / {numero(f.abiertas)} · <b className="text-texto">{pct}%</b>
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-panel-3">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: C.hecho }} />
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
                <Link key={t.tipo} href={`/mapa?vista=brecha&tipo=${t.tipo}`} className="block rounded-md px-1 py-0.5 transition hover:bg-panel-2" title="Ver este tipo en el mapa">
                  <div className="mb-1 flex items-baseline justify-between text-[13px]">
                    <span>{ETIQUETA_TIPO[t.tipo as TipoProblema] ?? t.tipo}</span>
                    <span className="num text-xs text-texto-2">
                      {numero(t.sinNadaCerca)} sin nada cerca · <b className="text-texto">{pct}%</b>
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-panel-3">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: C.alerta }} />
                  </div>
                </Link>
              );
            })}
          </div>
        </Panel>
      </div>

      {/* Top deuda */}
      <h2 className="mt-8 mb-3 text-sm font-bold tracking-wide uppercase">
        La deuda más concentrada <span className="font-normal text-texto-3">— direcciones con más pedidos y ninguna respuesta cerca</span>
      </h2>
      <Panel className="divide-y divide-borde/60">
        {b.topDeuda.map((d) => (
          <div key={d.direccion} className="flex items-center gap-3 px-4 py-2.5 text-sm">
            <span className="num w-8 shrink-0 text-center text-lg font-extrabold" style={{ color: C.alerta }}>
              {d.pedidos}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate" title={d.direccion}>{d.direccion}</p>
              <p className="text-[11px] text-texto-3">
                {d.fuentes.map((f) => ETIQUETA_FUENTE[f as FuenteDemanda] ?? f).join(" · ")}
                {d.desde && <> · el más viejo: {fechaCorta(d.desde)}</>}
              </p>
            </div>
            <VerEnMapa lat={d.lat} lon={d.lon} etiqueta={d.direccion} color={C.alerta} />
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

function Segmento({ n, total, color, href }: { n: number; total: number; color: string; href: string }) {
  if (n <= 0 || total <= 0) return null;
  return (
    <Link
      href={href}
      className="flex h-full items-center justify-center overflow-hidden transition hover:brightness-125"
      style={{ width: `${(100 * n) / total}%`, background: color, marginRight: 2 }}
      title={`${numero(n)} — clic para verlos en el mapa`}
    >
      {(100 * n) / total > 7 && (
        <span className="num text-[11px] font-bold text-[#070a10]">{numero(n)}</span>
      )}
    </Link>
  );
}

function Leyenda({ color, n, titulo, detalle, href }: { color: string; n: number; titulo: string; detalle: string; href: string }) {
  return (
    <Link href={href} className="flex items-start gap-2 rounded-md p-1 transition hover:bg-panel-2" title="Ver en el mapa">
      <span className="mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
      <div>
        <span className="num font-bold">{numero(n)}</span> <span className="font-semibold">{titulo}</span>
        <p className="text-[11px] leading-snug text-texto-3">{detalle}</p>
      </div>
    </Link>
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
              <rect x={x} y={alto - hp} width={16} height={hp} rx={3} fill={C.pedido} />
              <rect x={x + 19} y={alto - hh} width={16} height={hh} rx={3} fill={C.hecho} />
              <text x={x + 18} y={alto + 14} textAnchor="middle" fontSize={9} fill="#5c6b84">
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
