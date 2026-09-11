"use client";

import { Camera, Check } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import type { TipoIntervencion } from "@cimba/domain";
import { reportarTrabajoLibre } from "@/lib/acciones-carga-libre";
import { comprimirFoto, pesoCorto } from "@/lib/comprimir-foto";
import { Panel } from "@/components/ui";
import { SelectorUbicacion, type UbicacionElegida } from "../selector-ubicacion";

/**
 * CARGAR UN TRABAJO QUE NO ESTABA EN NINGUNA ORDEN.
 *
 * Mismo formulario que el de la orden — dirección, medidas, modalidad, fotos —
 * menos el item que no existe y más el aviso de qué pasa después. La
 * diferencia no es de campos, es de contrato: acá la empresa declara trabajo
 * que nadie le encargó, así que el texto lo dice sin vueltas en vez de
 * dejarlo implícito.
 */

const OPCIONES_INTERVENCION: Array<{ valor: TipoIntervencion; etiqueta: string }> = [
  { valor: "bacheo", etiqueta: "Bacheo" },
  { valor: "pano_hormigon", etiqueta: "Cambio de paño de hormigón" },
  { valor: "carpeta", etiqueta: "Carpeta (repavimentación)" },
  { valor: "enripiado", etiqueta: "Enripiado" },
];

const OPCIONES_OBRA: Array<{ valor: string; etiqueta: string }> = [
  { valor: "planificado", etiqueta: "Planificado" },
  { valor: "provisorio", etiqueta: "Provisorio (urgencia)" },
  { valor: "extendido", etiqueta: "Extendido (+4 m²)" },
  { valor: "sobre_adoquin", etiqueta: "Sobre adoquín" },
];

/** El teclado del teléfono mete coma decimal: se normaliza antes de parsear. */
const aNumero = (s: string) => Number(s.trim().replace(",", "."));

/** Lo que se repite toda la jornada, guardado en el teléfono. Clave propia
 *  (no la de una orden) porque acá no hay orden: ver memoria-carga.ts. */
const CLAVE_MEMORIA = "cimba:carga-libre";

export function FormularioLibre({ empresaId }: { empresaId: number | null }) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<number | null>(null);

  const [direccionTexto, setDireccionTexto] = useState("");
  const [ubicacion, setUbicacion] = useState<UbicacionElegida | null>(null);

  const [tipoTrabajo, setTipoTrabajo] = useState<"bache" | "carpeta">("bache");
  const [ancho, setAncho] = useState("");
  const [largo, setLargo] = useState("");
  const [espesor, setEspesor] = useState("");
  const [tipoIntervencion, setTipoIntervencion] = useState<TipoIntervencion>("bacheo");
  const [tipoObra, setTipoObra] = useState<string | null>(null);
  const [obs, setObs] = useState("");
  const [capataz, setCapataz] = useState("");
  const [ticket, setTicket] = useState("");

  const refDespues = useRef<HTMLInputElement>(null);
  const refAntes = useRef<HTMLInputElement>(null);
  const [fotoDespues, setFotoDespues] = useState<File | null>(null);
  const [fotoAntes, setFotoAntes] = useState<File | null>(null);
  const [previewDespues, setPreviewDespues] = useState<string | null>(null);
  const [previewAntes, setPreviewAntes] = useState<string | null>(null);
  const [preparandoFotos, setPreparandoFotos] = useState(0);
  const [ahorroFoto, setAhorroFoto] = useState<string | null>(null);

  // Lo repetido de la jornada vuelve puesto; lo que cambia (dirección, medidas,
  // fotos) siempre arranca vacío.
  useEffect(() => {
    try {
      const crudo = localStorage.getItem(CLAVE_MEMORIA);
      if (!crudo) return;
      const m = JSON.parse(crudo) as { espesor?: string; capataz?: string; tipoObra?: string | null };
      if (m.espesor) setEspesor(m.espesor);
      if (m.capataz) setCapataz(m.capataz);
      if (m.tipoObra !== undefined) setTipoObra(m.tipoObra);
    } catch {
      /* almacenamiento bloqueado: se carga sin memoria */
    }
  }, []);

  const elegirFoto = async (
    archivo: File | undefined,
    setFoto: (f: File | null) => void,
    setPreview: (u: string | null) => void,
    previewAnterior: string | null,
  ) => {
    if (previewAnterior) URL.revokeObjectURL(previewAnterior);
    if (!archivo) {
      setFoto(null);
      setPreview(null);
      return;
    }
    setPreparandoFotos((n) => n + 1);
    try {
      const { archivo: listo, antes, despues } = await comprimirFoto(archivo);
      setFoto(listo);
      setPreview(URL.createObjectURL(listo));
      if (despues < antes) setAhorroFoto(`${pesoCorto(antes)} → ${pesoCorto(despues)}`);
    } finally {
      setPreparandoFotos((n) => n - 1);
    }
  };

  const anchoN = aNumero(ancho);
  const largoN = aNumero(largo);
  const espesorN = aNumero(espesor);
  const superficie = anchoN > 0 && largoN > 0 ? anchoN * largoN : null;
  const volumen = superficie != null && espesorN > 0 ? (superficie * espesorN) / 100 : null;
  /**
   * Arriba de 50 m² el protocolo deja de considerarlo bacheo. Avisarlo acá
   * evita que un 20 × 30 tipeado de más se descubra recién en certificación,
   * que es cuando ya hay que discutirlo con la empresa.
   */
  const demasiadoGrande = superficie != null && superficie >= 50;

  const enviar = () => {
    setError(null);
    if (direccionTexto.trim().length < 4) {
      setError("Cargá la dirección del trabajo (podés dictarla).");
      return;
    }
    if (!ubicacion) {
      setError("Falta el punto en el mapa: buscá la dirección o usá tu GPS y confirmá el pin.");
      return;
    }
    if (!(anchoN > 0) || !(largoN > 0) || !(espesorN > 0)) {
      setError("Cargá el ancho, el largo y el espesor.");
      return;
    }
    if (!fotoDespues) {
      setError("Falta la foto del trabajo terminado (es obligatoria).");
      return;
    }

    const fd = new FormData();
    fd.set("direccion", direccionTexto.trim());
    fd.set("lat", String(ubicacion.lat));
    fd.set("lon", String(ubicacion.lon));
    fd.set("anchoM", String(anchoN));
    fd.set("largoM", String(largoN));
    fd.set("espesorCm", String(espesorN));
    fd.set("tipoTrabajo", tipoTrabajo);
    fd.set("tipoIntervencion", tipoIntervencion);
    if (tipoObra) fd.set("tipoObra", tipoObra);
    if (obs.trim()) fd.set("observaciones", obs.trim());
    if (capataz.trim()) fd.set("capataz", capataz.trim());
    if (ticket.trim()) fd.set("ticket147", ticket.trim());
    if (empresaId != null) fd.set("empresaId", String(empresaId));
    fd.set("foto", fotoDespues);
    if (fotoAntes) fd.set("fotoAntes", fotoAntes);

    startTransition(async () => {
      try {
        const r = await reportarTrabajoLibre(fd);
        try {
          localStorage.setItem(
            CLAVE_MEMORIA,
            JSON.stringify({ espesor, capataz: capataz.trim() || undefined, tipoObra }),
          );
        } catch {
          /* ídem */
        }
        // Reset de lo que cambia entre baches; lo repetido queda puesto para
        // el siguiente, que es el caso normal: se cargan varios seguidos.
        setHecho(r.incidenteId);
        setDireccionTexto("");
        setUbicacion(null);
        setAncho("");
        setLargo("");
        setObs("");
        setTicket("");
        void elegirFoto(undefined, setFotoDespues, setPreviewDespues, previewDespues);
        void elegirFoto(undefined, setFotoAntes, setPreviewAntes, previewAntes);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo cargar: probá de nuevo.");
      }
    });
  };

  return (
    <div className="space-y-4">
      {hecho != null && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-resuelto/40 bg-resuelto/10 px-4 py-3">
          <Check size={18} className="shrink-0 text-resuelto" />
          <p className="min-w-0 flex-1 text-sm font-semibold text-resuelto">
            Cargado. Ya está en el mapa y cuenta como trabajo hecho.
          </p>
          <Link href={`/empresa`} className="shrink-0 text-sm font-semibold text-celeste hover:underline">
            volver a mis órdenes
          </Link>
        </div>
      )}

      <Panel className="space-y-4 p-4">
        <div>
          <p className="mb-1.5 text-xs font-semibold tracking-wider text-texto-3 uppercase">
            ¿Dónde fue?
          </p>
          <SelectorUbicacion
            direccionTexto={direccionTexto}
            alCambiarDireccion={setDireccionTexto}
            ubicacion={ubicacion}
            alElegir={setUbicacion}
          />
        </div>

        <div>
          <p className="mb-1.5 text-xs font-semibold tracking-wider text-texto-3 uppercase">
            ¿Qué se hizo?
          </p>
          <div className="mb-2 grid grid-cols-2 gap-2">
            {(
              [
                { valor: "bache", etiqueta: "Bache" },
                { valor: "carpeta", etiqueta: "Carpeta (paño entero)" },
              ] as const
            ).map((op) => (
              <button
                key={op.valor}
                type="button"
                onClick={() => {
                  setTipoTrabajo(op.valor);
                  setTipoIntervencion(op.valor === "carpeta" ? "carpeta" : "bacheo");
                }}
                className={`min-h-14 rounded-xl border-2 px-3 py-2.5 text-sm leading-snug font-bold transition active:scale-[0.99] ${
                  tipoTrabajo === op.valor
                    ? "border-azul bg-azul/15 text-celeste"
                    : "border-borde-2 bg-panel-2 text-texto-2 hover:border-celeste/60"
                }`}
              >
                {op.etiqueta}
              </button>
            ))}
          </div>
          <select
            value={tipoIntervencion}
            onChange={(e) => setTipoIntervencion(e.target.value as TipoIntervencion)}
            className="w-full rounded-xl border border-borde-2 bg-panel-2 px-3 py-3 text-base"
          >
            {OPCIONES_INTERVENCION.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.etiqueta}
              </option>
            ))}
          </select>
        </div>

        <div>
          <p className="mb-1.5 text-xs font-semibold tracking-wider text-texto-3 uppercase">
            Medidas reales
          </p>
          <div className="grid grid-cols-3 gap-2">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-texto-2">Ancho (m)</span>
              <input
                type="number"
                inputMode="decimal"
                step={0.1}
                min={0}
                value={ancho}
                onChange={(e) => setAncho(e.target.value)}
                className="num w-full rounded-xl border border-borde-2 bg-panel-2 px-3 py-3.5 text-lg"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-texto-2">Largo (m)</span>
              <input
                type="number"
                inputMode="decimal"
                step={0.1}
                min={0}
                value={largo}
                onChange={(e) => setLargo(e.target.value)}
                className="num w-full rounded-xl border border-borde-2 bg-panel-2 px-3 py-3.5 text-lg"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-texto-2">Espesor (cm)</span>
              <input
                type="number"
                inputMode="decimal"
                step={0.1}
                min={0}
                value={espesor}
                onChange={(e) => setEspesor(e.target.value)}
                className="num w-full rounded-xl border border-borde-2 bg-panel-2 px-3 py-3.5 text-lg"
              />
            </label>
          </div>
          {superficie != null && (
            <p className="num mt-1.5 text-sm text-texto-2">
              {superficie.toFixed(2).replace(".", ",")} m²
              {volumen != null && <> · {volumen.toFixed(2).replace(".", ",")} m³ de mezcla</>}
            </p>
          )}
          {demasiadoGrande && (
            <p className="mt-1.5 rounded-lg border border-amarillo/40 bg-amarillo/10 px-3 py-2 text-[12px] leading-snug">
              <b className="text-amarillo">Ojo con la medida:</b> {superficie?.toFixed(0)} m² ya no es un
              bache — arriba de 50 m² el protocolo lo trata como obra y se certifica distinto. Si te
              equivocaste de coma, corregilo ahora.
            </p>
          )}
        </div>

        <div>
          <p className="mb-1.5 text-xs font-semibold tracking-wider text-texto-3 uppercase">
            Modalidad
          </p>
          <div className="grid grid-cols-2 gap-2">
            {OPCIONES_OBRA.map((o) => (
              <button
                key={o.valor}
                type="button"
                onClick={() => setTipoObra(tipoObra === o.valor ? null : o.valor)}
                className={`min-h-12 rounded-xl border-2 px-3 py-2 text-sm font-semibold transition active:scale-[0.99] ${
                  tipoObra === o.valor
                    ? "border-azul bg-azul/15 text-celeste"
                    : "border-borde-2 bg-panel-2 text-texto-2 hover:border-celeste/60"
                }`}
              >
                {o.etiqueta}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-xs font-semibold tracking-wider text-texto-3 uppercase">Fotos</p>
          <div className="grid grid-cols-2 gap-2">
            <input
              ref={refDespues}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) =>
                void elegirFoto(e.target.files?.[0], setFotoDespues, setPreviewDespues, previewDespues)
              }
            />
            <input
              ref={refAntes}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) =>
                void elegirFoto(e.target.files?.[0], setFotoAntes, setPreviewAntes, previewAntes)
              }
            />
            <button
              type="button"
              onClick={() => refDespues.current?.click()}
              className={`relative h-28 overflow-hidden rounded-xl border-2 transition ${
                fotoDespues ? "border-resuelto/60" : "border-dashed border-borde-2 hover:border-celeste/60"
              }`}
            >
              {previewDespues ? (
                <>
                  <img
                    src={previewDespues}
                    alt="Foto del trabajo terminado"
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                  <span className="absolute inset-x-0 bottom-0 bg-black/60 py-0.5 text-center text-[10px] font-bold text-white">
                    DESPUÉS ✓ — tocá para cambiar
                  </span>
                </>
              ) : (
                <span className="flex h-full flex-col items-center justify-center gap-1 text-sm font-bold">
                  <Camera size={22} className="text-resuelto" />
                  Cómo quedó
                  <span className="text-[10px] font-medium text-texto-3">obligatoria</span>
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => refAntes.current?.click()}
              className={`relative h-28 overflow-hidden rounded-xl border-2 transition ${
                fotoAntes ? "border-celeste/60" : "border-dashed border-borde-2 hover:border-celeste/60"
              }`}
            >
              {previewAntes ? (
                <>
                  <img
                    src={previewAntes}
                    alt="Foto del antes"
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                  <span className="absolute inset-x-0 bottom-0 bg-black/60 py-0.5 text-center text-[10px] font-bold text-white">
                    ANTES ✓ — tocá para cambiar
                  </span>
                </>
              ) : (
                <span className="flex h-full flex-col items-center justify-center gap-1 text-sm font-bold">
                  <Camera size={22} className="text-celeste" />
                  Cómo estaba
                  <span className="text-[10px] font-medium text-texto-3">opcional</span>
                </span>
              )}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-texto-2">Capataz</span>
            <input
              value={capataz}
              onChange={(e) => setCapataz(e.target.value)}
              placeholder="Tu nombre"
              className="w-full rounded-xl border border-borde-2 bg-panel-2 px-3 py-3 text-base placeholder:text-texto-3"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-texto-2">N° de ticket 147</span>
            <input
              value={ticket}
              onChange={(e) => setTicket(e.target.value)}
              inputMode="numeric"
              placeholder="si lo tenés"
              className="num w-full rounded-xl border border-borde-2 bg-panel-2 px-3 py-3 text-base placeholder:font-sans placeholder:text-texto-3"
            />
          </label>
        </div>

        <textarea
          value={obs}
          onChange={(e) => setObs(e.target.value)}
          rows={2}
          placeholder="Observaciones (opcional): por qué se hizo, quién lo pidió…"
          className="w-full rounded-xl border border-borde-2 bg-panel-2 px-3 py-3 text-base placeholder:text-texto-3"
        />

        {error && <p className="text-sm font-medium text-peligro">{error}</p>}

        <button
          type="button"
          onClick={enviar}
          disabled={pendiente || preparandoFotos > 0}
          className="w-full rounded-xl bg-resuelto px-4 py-4 text-base font-bold text-white transition active:scale-[0.99] disabled:opacity-50"
        >
          {preparandoFotos > 0
            ? "Preparando la foto…"
            : pendiente
              ? "Subiendo…"
              : "CARGAR ESTE TRABAJO"}
        </button>
        {ahorroFoto && (
          <p className="num text-center text-[11px] text-texto-3">
            Foto achicada para que suba rápido: {ahorroFoto}
          </p>
        )}
      </Panel>
    </div>
  );
}
