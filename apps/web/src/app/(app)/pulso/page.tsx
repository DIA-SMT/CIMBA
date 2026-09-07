import Link from "next/link";
import { leerSesion } from "@/lib/auth";
import { datosPulso } from "@/lib/pulso";
import { numero } from "@/lib/formato";
import { Panel, TituloPagina } from "@/components/ui";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * EL PULSO: el parte diario, en pantalla. El push de las 7:00 trae acá; la
 * página calcula los mismos números EN VIVO (si la mirás a las 15, habla de
 * ayer igual, pero la deuda y los vencimientos son los del momento).
 * No tiene botón en el menú a propósito: llega solo, todas las mañanas.
 */
export default async function PaginaPulso() {
  await leerSesion(); // (app) ya garantiza sesión interna; el guard es del layout
  const p = await datosPulso();
  const deltaDeuda = p.deuda.sinAtencionBacheo - p.deuda.hace7dias;

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <TituloPagina
        titulo={`El pulso — parte del ${p.fechaAyer}`}
        sub="El resumen que el sistema arma solo todas las mañanas a las 7:00 y manda por push y email (se configura en Órdenes → Gestión → Avisos)."
      />

      {/* AYER */}
      <Panel className="mb-4 p-5">
        <p className="mb-3 text-[10px] font-bold tracking-[0.14em] text-texto-3 uppercase">Ayer ({p.fechaAyer})</p>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="num text-3xl font-extrabold text-celeste">{numero(p.entradas.total)}</p>
            <p className="mt-0.5 text-[11px] font-semibold tracking-wider text-texto-3 uppercase">Pedidos nuevos</p>
            <p className="mt-1 text-[11px] text-texto-2">
              🛠️ {numero(p.entradas.bacheo)} · 💧 {numero(p.entradas.sat)} · 🚜 {numero(p.entradas.ingenieria)}
            </p>
          </div>
          <div>
            <p className="num text-3xl font-extrabold" style={{ color: "var(--color-hecho)" }}>
              {numero(p.reparados.baches)}
            </p>
            <p className="mt-0.5 text-[11px] font-semibold tracking-wider text-texto-3 uppercase">Baches tapados</p>
            <p className="num mt-1 text-[11px] text-texto-2">{numero(p.reparados.m2)} m²</p>
          </div>
          <div>
            <p className="num text-3xl font-extrabold">{numero(p.cerradas)}</p>
            <p className="mt-0.5 text-[11px] font-semibold tracking-wider text-texto-3 uppercase">Vecinos respondidos</p>
            <p className="mt-1 text-[11px] text-texto-2">reclamos cerrados</p>
          </div>
        </div>
        {p.reparados.ejecutores.length > 0 && (
          <p className="mt-3 text-center text-xs text-texto-2">
            {p.reparados.ejecutores.map((e, i) => (
              <span key={e.ejecutor}>
                {i > 0 && " · "}
                <b>{e.ejecutor}</b> {numero(e.baches)}
              </span>
            ))}
          </p>
        )}
        {p.barriosCalientes.length > 0 && (
          <p className="mt-2 text-center text-xs text-texto-3">
            La demanda nueva de bacheo se concentró en{" "}
            {p.barriosCalientes.map((b, i) => (
              <span key={b.barrio}>
                {i > 0 && ", "}
                <b className="text-texto-2">{b.barrio}</b> ({numero(b.pedidos)})
              </span>
            ))}
          </p>
        )}
      </Panel>

      {/* HOY */}
      <Panel className="mb-4 p-5">
        <p className="mb-3 text-[10px] font-bold tracking-[0.14em] text-texto-3 uppercase">Hoy</p>
        <div className="space-y-2.5 text-sm">
          <p>
            Deuda de bacheo sin atención:{" "}
            <Link href="/mapa?vista=brecha&brecha=sin_atencion" className="num font-bold text-celeste hover:underline">
              {numero(p.deuda.sinAtencionBacheo)}
            </Link>{" "}
            pedidos —{" "}
            {deltaDeuda <= 0 ? (
              <b style={{ color: "var(--color-hecho)" }}>baja</b>
            ) : (
              <b style={{ color: "var(--color-sin-atencion)" }}>sube</b>
            )}{" "}
            <span className="text-texto-3">(hace 7 días: {numero(p.deuda.hace7dias)})</span>
          </p>
          <p>
            {p.ordenes.vencenHoy.length > 0 ? (
              <>
                Vencen <b className="text-encurso">HOY</b>:{" "}
                {p.ordenes.vencenHoy.map((o, i) => (
                  <span key={o.numero}>
                    {i > 0 && ", "}
                    <Link href="/ordenes" className="font-semibold text-celeste hover:underline">
                      {o.numero}
                    </Link>{" "}
                    ({o.empresa})
                  </span>
                ))}
              </>
            ) : (
              <span className="text-texto-2">No vence ninguna orden hoy.</span>
            )}
            {p.ordenes.vencidasActivas > 0 && (
              <span className="text-texto-2">
                {" "}
                · siguen abiertas <b className="num">{numero(p.ordenes.vencidasActivas)}</b> ya vencidas
              </span>
            )}
          </p>
          {p.cierresPendientes > 0 && (
            <p>
              <Link href="/cierres" className="num font-bold text-celeste hover:underline">
                {numero(p.cierresPendientes)}
              </Link>{" "}
              reclamos con el trabajo YA hecho esperan la respuesta al vecino.
            </p>
          )}
        </div>
      </Panel>

      {/* La anomalía del día */}
      {p.anomalia && (
        <Panel className="mb-4 border-encurso/50 p-5">
          <p className="mb-1 text-[10px] font-bold tracking-[0.14em] text-encurso uppercase">Anomalía del día</p>
          <p className="text-sm">
            <b>{p.anomalia.barrio}</b> tuvo <b className="num">{numero(p.anomalia.ayer)}</b> pedidos ayer contra
            un promedio de <span className="num">{p.anomalia.promedio}</span> por día en el mes.{" "}
            <Link
              href={`/mapa?buscar=${encodeURIComponent(`pedidos en ${p.anomalia.barrio}`)}`}
              className="font-semibold text-celeste hover:underline"
            >
              Verlo en el mapa →
            </Link>
          </p>
        </Panel>
      )}

      <p className="text-center text-[11px] leading-relaxed text-texto-3">
        Los números de «ayer» son del día calendario de Tucumán; la deuda y los vencimientos son de este
        momento. Nada de esta página lleva datos personales de vecinos.
      </p>
    </div>
  );
}
