import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { leerSesion } from "@/lib/auth";
import {
  CARGAS_POR_PAGINA,
  cargasParaControlar,
  empresasConCargas,
  type CargaControl,
  type VistaControl,
} from "@/lib/control-cargas";
import { fechaCorta, numero } from "@/lib/formato";
import { formatoToneladas, toneladasDe } from "@/lib/medicion";
import { urlFoto } from "@/lib/fotos";
import { Panel, TituloPagina } from "@/components/ui";
import { GaleriaFotos, type FotoVisor } from "@/components/visor-fotos";
import { ChipMiniMapa } from "@/components/mapa/mini-mapa";
import { AccionesControl } from "./acciones-control";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const VISTAS: Array<{ valor: VistaControl; etiqueta: string }> = [
  { valor: "sin_revisar", etiqueta: "Sin revisar" },
  { valor: "revisados", etiqueta: "Revisados" },
  { valor: "bajas", etiqueta: "Dados de baja" },
  { valor: "todos", etiqueta: "Todos" },
];

/* Sobre la foto, con fondo oscuro fijo: hex y no tokens (ver visor-fotos). */
const COLOR_MOMENTO: Record<string, string> = { antes: "#3987e5", durante: "#d95926", despues: "#199e70" };
const ETIQUETA_MOMENTO: Record<string, string> = { antes: "Antes", durante: "Durante", despues: "Después" };
const ORDEN_MOMENTO: Record<string, number> = { antes: 0, durante: 1, despues: 2 };

/**
 * CONTROL DE LO CARGADO: la mesa del inspector.
 *
 * Cada bache que cargó una empresa y todavía no se certificó, con la foto de
 * antes y la de después lado a lado, las medidas que informó y lo que hace
 * sospechar. Lo que está bien se marca; la medida se corrige ahí mismo; lo
 * duplicado o mal cargado se da de baja, sin borrar nada.
 */
export default async function PaginaControl({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; empresa?: string; orden?: string; pagina?: string; ticket?: string }>;
}) {
  const sesion = (await leerSesion())!;
  if (!["admin", "planificacion", "supervision"].includes(sesion.rol_cimba)) {
    return (
      <div className="mx-auto max-w-2xl p-6 text-center text-sm text-texto-3">
        Esta pantalla es del cuerpo de inspectores y de planificación.
      </div>
    );
  }
  const sp = await searchParams;
  const vista: VistaControl = VISTAS.some((v) => v.valor === sp.vista) ? (sp.vista as VistaControl) : "sin_revisar";
  const empresaId = /^\d{1,9}$/.test(sp.empresa ?? "") ? Number(sp.empresa) : null;
  const ordenId = /^\d{1,12}$/.test(sp.orden ?? "") ? Number(sp.orden) : null;
  const pagina = /^\d{1,4}$/.test(sp.pagina ?? "") ? Math.max(1, Number(sp.pagina)) : 1;
  const ticket = /^\d{1,12}$/.test((sp.ticket ?? "").trim()) ? (sp.ticket ?? "").trim() : null;

  const [resultado, empresas] = await Promise.all([
    cargasParaControlar(sesion, { vista, empresaId, ordenId, pagina, ticket }),
    empresasConCargas(sesion),
  ]);
  const paginas = Math.max(1, Math.ceil(resultado.total / CARGAS_POR_PAGINA));

  /** El link de esta misma pantalla con un filtro cambiado. */
  const enlace = (cambios: Record<string, string | number | null>) => {
    const p = new URLSearchParams();
    const base: Record<string, string | number | null> = {
      vista,
      empresa: empresaId,
      orden: ordenId,
      ticket,
      pagina: null,
      ...cambios,
    };
    for (const [k, v] of Object.entries(base)) if (v != null && v !== "") p.set(k, String(v));
    return `/ordenes/control?${p.toString()}`;
  };

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <Link href="/ordenes" className="mb-4 inline-flex items-center gap-1.5 text-sm text-texto-2 transition hover:text-texto">
        <ArrowLeft size={15} /> Órdenes
      </Link>
      <TituloPagina
        titulo="Control de lo cargado"
        sub="Cada bache que cargó una empresa y todavía no se certificó, con sus fotos y sus medidas. Lo que está bien se marca; lo que no, se corrige o se da de baja."
      />

      <Panel className="mb-4 p-4 text-[13px] leading-relaxed text-texto-2">
        <b className="text-texto">Dar de baja no borra nada.</b> La carga queda anulada con sus fotos y con
        quién la dio de baja y por qué, y deja de certificarse. Si es un <b>duplicado</b>, el bache sigue
        arreglado por la otra carga. Si está <b>mal cargado</b>, el bache vuelve a pendiente en su orden para
        que la empresa lo cargue bien (o a la cola de la ciudad, si la orden ya se cerró). Lo que ya está en
        un acta firmada no aparece acá: está certificado.
      </Panel>

      {/* Filtros: qué mirar y de quién */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {VISTAS.map((v) => (
          <Link
            key={v.valor}
            href={enlace({ vista: v.valor })}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
              vista === v.valor
                ? "border-azul bg-azul text-white"
                : "border-borde-2 text-texto-2 hover:border-celeste/50 hover:text-celeste"
            }`}
          >
            {v.etiqueta} <span className="num opacity-80">· {numero(resultado.conteo[v.valor])}</span>
          </Link>
        ))}
      </div>
      <div className="mb-5 flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-texto-3">Empresa:</span>
        <Link
          href={enlace({ empresa: null })}
          className={`rounded-md px-2 py-1 font-semibold ${empresaId == null ? "bg-celeste/15 text-celeste" : "text-texto-2 hover:text-celeste"}`}
        >
          todas
        </Link>
        {empresas.map((e) => (
          <Link
            key={e.id}
            href={enlace({ empresa: e.id })}
            className={`rounded-md px-2 py-1 font-semibold ${empresaId === e.id ? "bg-celeste/15 text-celeste" : "text-texto-2 hover:text-celeste"}`}
          >
            {e.nombre} <span className="num text-texto-3">{numero(e.n)}</span>
          </Link>
        ))}
        {ordenId != null && (
          <Link href={enlace({ orden: null })} className="ml-2 rounded-md bg-amarillo/10 px-2 py-1 font-semibold text-amarillo">
            solo una orden · quitar ✕
          </Link>
        )}
      </div>

      {/* Por N° de ticket: el del bache (el que ve la empresa en su portal) o el
          del 147. "Es más fácil para el inspector controlar por número de
          ticket" (14/10). Un formulario GET común: anda sin JavaScript y el
          link se puede pasar por WhatsApp. */}
      <form action="/ordenes/control" method="get" className="mb-5 flex flex-wrap items-center gap-2 text-xs">
        <input type="hidden" name="vista" value={vista} />
        {empresaId != null && <input type="hidden" name="empresa" value={empresaId} />}
        {ordenId != null && <input type="hidden" name="orden" value={ordenId} />}
        <input
          name="ticket"
          defaultValue={ticket ?? ""}
          inputMode="numeric"
          placeholder="N° de ticket (del bache o de Atención Ciudadana)"
          className="w-64 rounded-lg border border-borde-2 bg-panel-2 px-3 py-2 text-sm placeholder:text-texto-3"
        />
        <button type="submit" className="rounded-lg bg-azul px-3 py-2 font-semibold text-white transition hover:brightness-110">
          Buscar
        </button>
        {ticket && (
          <Link href={enlace({ ticket: null })} className="rounded-md bg-amarillo/10 px-2 py-1 font-semibold text-amarillo">
            ticket {ticket} · quitar ✕
          </Link>
        )}
      </form>

      {resultado.cargas.length === 0 ? (
        <Panel className="p-8 text-center text-sm text-texto-3">
          {vista === "sin_revisar"
            ? "No queda nada sin revisar con estos filtros."
            : vista === "bajas"
              ? "No hay cargas dadas de baja con estos filtros."
              : "No hay cargas con estos filtros."}
        </Panel>
      ) : (
        <div className="space-y-3">
          {resultado.cargas.map((c) => (
            <TarjetaCarga key={c.itemId} c={c} />
          ))}
        </div>
      )}

      {paginas > 1 && (
        <div className="mt-5 flex items-center justify-center gap-3 text-sm">
          {pagina > 1 && (
            <Link href={enlace({ pagina: pagina - 1 })} className="font-semibold text-celeste hover:underline">
              ← Anteriores
            </Link>
          )}
          <span className="num text-texto-3">
            página {numero(pagina)} de {numero(paginas)}
          </span>
          {pagina < paginas && (
            <Link href={enlace({ pagina: pagina + 1 })} className="font-semibold text-celeste hover:underline">
              Siguientes →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function TarjetaCarga({ c }: { c: CargaControl }) {
  const fotos: FotoVisor[] = [...c.fotos]
    .sort((a, b) => (ORDEN_MOMENTO[a.momento] ?? 9) - (ORDEN_MOMENTO[b.momento] ?? 9))
    .flatMap((f) => {
      const url = urlFoto(f);
      if (!url) return [];
      const momento = ETIQUETA_MOMENTO[f.momento] ?? f.momento;
      return [
        {
          url,
          alt: `Foto ${momento} — ${c.direccion ?? `item ${c.itemId}`}`,
          etiqueta: `${momento.toUpperCase()} · ${c.direccion ?? `Item #${c.itemId}`}`,
          insignia: { texto: momento, color: COLOR_MOMENTO[f.momento] ?? "#ffffff" },
        },
      ];
    });
  const medidas =
    c.anchoM != null && c.largoM != null
      ? `${numero(c.anchoM)} × ${numero(c.largoM)} m`
      : c.superficieM2 != null
        ? `${numero(c.superficieM2)} m²`
        : null;
  const dadoDeBaja = c.estado !== "hecho";

  return (
    <Panel className={`p-4 ${dadoDeBaja ? "opacity-80" : ""}`}>
      <div className="flex flex-col gap-4 md:flex-row">
        {/* Las fotos primero: es lo que se viene a mirar. */}
        <div className="shrink-0">
          {fotos.length > 0 ? (
            <GaleriaFotos fotos={fotos} miniAlto={120} miniAncho={150} className="flex gap-2" />
          ) : (
            <div className="flex h-[120px] w-[150px] items-center justify-center rounded-lg border border-dashed border-borde-2 text-[11px] text-texto-3">
              Sin fotos
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {c.lat != null && c.lon != null && (
              <ChipMiniMapa lat={c.lat} lon={c.lon} etiqueta={c.direccion ?? `Item #${c.itemId}`} />
            )}
            <p className="min-w-0 truncate font-bold">{c.direccion ?? "Sin dirección"}</p>
            <Link href={`/ordenes/${c.ordenId}`} className="num text-xs font-semibold text-celeste hover:underline">
              {c.ordenNumero}
            </Link>
            <span className="num rounded-md bg-panel-3 px-1.5 py-0.5 text-[11px] font-semibold text-texto-2">
              Ticket {c.itemId}
              {c.tickets147 && <> · Atención Ciudadana N° {c.tickets147}</>}
            </span>
          </div>
          <p className="mt-0.5 text-[12px] text-texto-2">
            <b>{c.empresa}</b>
            {c.capataz && <> · capataz {c.capataz}</>}
            {c.reportadoEn && <> · trabajo del {fechaCorta(c.reportadoEn)}</>}
          </p>

          {/* Las medidas como las informó la empresa, y lo que pesan. Con los
              lados, la superficie es la cuenta; sin ellos, es lo que se
              informó directo y no se repite. */}
          <p className="num mt-2 text-sm">
            {medidas ?? "Sin medidas"}
            {c.espesorCm != null && <> · {numero(c.espesorCm)} cm</>}
            {c.anchoM != null && c.largoM != null && c.superficieM2 != null && (
              <>
                {" "}
                → <b>{numero(c.superficieM2)} m²</b>
              </>
            )}
            {c.volumenM3 != null && (
              <span className="text-texto-2"> · {formatoToneladas(toneladasDe(c.volumenM3))}</span>
            )}
            {c.tipoObra && <span className="text-texto-3"> · {c.tipoObra.replace("_", " ")}</span>}
          </p>

          {c.alarmas.length > 0 && !dadoDeBaja && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {c.alarmas.map((a) => (
                <span
                  key={a}
                  className="rounded-md bg-amarillo/10 px-2 py-0.5 text-[11px] font-semibold text-amarillo"
                >
                  {a}
                </span>
              ))}
            </div>
          )}

          {c.baja && (
            <p className="mt-2 rounded-lg border border-peligro/30 bg-peligro/5 px-3 py-2 text-[12px] leading-snug text-texto-2">
              <b className="text-peligro">
                {dadoDeBaja ? "Dada de baja" : "Se había dado de baja y se volvió a cargar"}
              </b>{" "}
              por {c.baja.motivo === "duplicado" ? "duplicado" : "mal cargada"}
              {c.baja.original && <> (el original es de la {c.baja.original.orden ?? "otra orden"})</>}
              {c.baja.detalle && <> — «{c.baja.detalle}»</>} · {c.baja.por}, {fechaCorta(c.baja.en)}
            </p>
          )}

          {c.controlado && !dadoDeBaja && (
            <p className="mt-2 text-[12px] font-semibold" style={{ color: "var(--color-hecho)" }}>
              ✓ Revisada por {c.controlado.por}, {fechaCorta(c.controlado.en)}
            </p>
          )}

          {!dadoDeBaja && (
            <AccionesControl
              itemId={c.itemId}
              controlada={c.controlado != null}
              ordenActiva={c.ordenEstado === "emitida" || c.ordenEstado === "en_ejecucion"}
              medidas={{
                superficieM2: c.superficieM2,
                espesorCm: c.espesorCm,
                anchoM: c.anchoM,
                largoM: c.largoM,
                medicion: c.medicion,
                tipoObra: c.tipoObra,
              }}
              cercanas={c.cercanas.map((x) => ({
                ...x,
                foto: x.foto ? urlFoto({ storagePath: x.foto, urlExterna: null }) : null,
              }))}
            />
          )}
        </div>
      </div>
    </Panel>
  );
}
