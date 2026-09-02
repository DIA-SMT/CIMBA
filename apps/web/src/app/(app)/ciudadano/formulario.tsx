"use client";

import { FileUp, LocateFixed, Mic, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { TIPOS_PROBLEMA } from "@cimba/domain";
import { crearDemandaCiudadano } from "@/lib/acciones";
import { leerArchivoComoCapa, type CapaPuntos } from "@/lib/capa-archivo";
import { useDictadoVoz } from "@/lib/dictado";
import { ETIQUETA_TIPO, numero } from "@/lib/formato";
import { MapaSelector } from "@/components/mapa/mapa-selector";
import { CargaRapida, type CargaInterpretada } from "@/components/carga-rapida";
import { Panel } from "@/components/ui";

/** Distritos operativos de la ciudad (referencia editable; queda en metadata). */
const DISTRITOS = ["Distrito Norte", "Distrito Sur", "Distrito Este", "Distrito Oeste", "Centro"];

/**
 * Carga del pedido de un vecino que reclama en persona o por teléfono. El que
 * tipea es el personal, muchas veces con el vecino delante o al teléfono: por
 * eso dirección y descripción se pueden DICTAR con el micrófono en vez de
 * tipearse.
 */
export function FormularioCiudadano() {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [punto, setPunto] = useState<{ lat: number; lon: number } | null>(null);
  const [desdeGps, setDesdeGps] = useState(false);
  const [buscandoGps, setBuscandoGps] = useState(false);
  const [tipo, setTipo] = useState("bache");
  const [direccion, setDireccion] = useState("");
  const [buscandoDireccion, setBuscandoDireccion] = useState(false);
  const [descripcion, setDescripcion] = useState("");
  const [solicitante, setSolicitante] = useState("");
  const [area, setArea] = useState("");
  const [distrito, setDistrito] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creado, setCreado] = useState<number | null>(null);
  const [capa, setCapa] = useState<CapaPuntos | null>(null);
  const [nombreCapa, setNombreCapa] = useState<string | null>(null);
  const [errorCapa, setErrorCapa] = useState<string | null>(null);
  const inputArchivo = useRef<HTMLInputElement>(null);

  // La dirección se dictó completa: se reemplaza. La descripción se va
  // dictando de a frases mientras el vecino habla: se acumula.
  const dictadoDireccion = useDictadoVoz((frase) => setDireccion(frase));
  const dictadoDescripcion = useDictadoVoz((frase) =>
    setDescripcion((previa) => (previa ? `${previa} ${frase}` : frase)),
  );

  const georevRef = useRef(0);
  const resolverDireccion = async (lat: number, lon: number) => {
    setBuscandoDireccion(true);
    const pedido = ++georevRef.current;
    try {
      const res = await fetch(`/api/georreversa?lat=${lat}&lon=${lon}`);
      const data = (await res.json()) as { direccion: string | null };
      if (pedido === georevRef.current && data.direccion) setDireccion(data.direccion);
    } catch {
      // sin dirección automática: se escribe (o dicta) a mano
    } finally {
      if (pedido === georevRef.current) setBuscandoDireccion(false);
    }
  };

  const elegirPunto = (lat: number, lon: number, gps = false) => {
    setPunto({ lat, lon });
    setDesdeGps(gps);
    void resolverDireccion(lat, lon);
  };

  const usarGps = () => {
    if (!navigator.geolocation) {
      setError("Este navegador no permite usar la ubicación.");
      return;
    }
    setError(null);
    setBuscandoGps(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBuscandoGps(false);
        elegirPunto(pos.coords.latitude, pos.coords.longitude, true);
      },
      () => {
        setBuscandoGps(false);
        setError("No se pudo obtener tu ubicación: permitila en el navegador o marcá en el mapa.");
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const cargarArchivo = async (archivo: File | undefined) => {
    if (!archivo) return;
    setErrorCapa(null);
    try {
      const fc = await leerArchivoComoCapa(archivo);
      if (fc.features.length === 0) throw new Error("El archivo no tiene puntos con coordenadas válidas.");
      setCapa(fc);
      setNombreCapa(archivo.name);
    } catch (e) {
      setCapa(null);
      setNombreCapa(null);
      setErrorCapa(e instanceof Error ? e.message : "No se pudo leer el archivo.");
    } finally {
      if (inputArchivo.current) inputArchivo.current.value = "";
    }
  };

  const enviar = () => {
    if (!punto) {
      setError("Marcá la ubicación en el mapa (o usá el GPS si estás en el lugar)");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const r = await crearDemandaCiudadano({
          lat: punto.lat,
          lon: punto.lon,
          tipo,
          descripcion,
          direccion,
          solicitante,
          area,
          distrito: distrito || undefined,
          desdeGps,
        });
        setCreado(r.id ?? null);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo registrar el pedido");
      }
    });
  };

  if (creado) {
    return (
      <Panel className="p-6 text-center">
        <p className="text-lg font-bold text-resuelto">Pedido registrado ✓</p>
        <p className="mt-1 text-sm text-texto-2">
          Quedó como demanda <span className="num font-bold">#{creado}</span> con fuente Carga manual
          {distrito && (
            <>
              {" "}({distrito})
            </>
          )}
          . Atención Ciudadana la verá en la bandeja para vincularla.
        </p>
        <button
          onClick={() => {
            setCreado(null);
            setPunto(null);
            setDesdeGps(false);
            setDireccion("");
            setDescripcion("");
            setSolicitante("");
          }}
          className="mt-4 rounded-lg bg-azul px-4 py-2 text-sm font-semibold text-white"
        >
          Cargar otro pedido
        </button>
      </Panel>
    );
  }

  const aplicarCarga = (r: CargaInterpretada) => {
    if (r.tipo) setTipo(r.tipo);
    if (r.direccion) setDireccion(r.direccion);
    if (r.descripcion) setDescripcion(r.descripcion);
    if (r.punto) {
      setPunto(r.punto);
      setDesdeGps(false);
    }
  };

  return (
    <div className="space-y-4">
      <CargaRapida alAplicar={aplicarCarga} />

      <div>
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
          <label className="block text-xs font-semibold tracking-wider text-texto-3 uppercase">
            Ubicación — clic en el mapa (o GPS si estás en el lugar)
          </label>
          <div className="flex items-center gap-2">
            {nombreCapa && capa ? (
              <span className="flex items-center gap-1.5 rounded-lg border border-celeste/40 bg-celeste/10 px-2.5 py-1 text-[11px] text-celeste">
                {nombreCapa} · <span className="num font-bold">{numero(capa.features.length)}</span> elementos
                <button
                  onClick={() => {
                    setCapa(null);
                    setNombreCapa(null);
                  }}
                  title="Quitar la capa cargada"
                  className="hover:text-texto"
                >
                  <X size={12} />
                </button>
              </span>
            ) : (
              <button
                onClick={() => inputArchivo.current?.click()}
                title="Superponer un archivo de puntos como referencia: GeoJSON, CSV, Excel o GeoPackage de QGIS (.gpkg)"
                className="flex items-center gap-1.5 rounded-lg border border-borde-2 px-2.5 py-1 text-[11px] font-semibold text-texto-2 transition hover:border-celeste hover:text-celeste"
              >
                <FileUp size={12} /> Cargar capa
              </button>
            )}
            <input
              ref={inputArchivo}
              type="file"
              accept=".geojson,.json,.csv,.tsv,.txt,.xlsx,.xls,.gpkg"
              className="hidden"
              onChange={(e) => void cargarArchivo(e.target.files?.[0])}
            />
            <button
              onClick={usarGps}
              disabled={buscandoGps}
              title="Usar tu ubicación actual: solo sirve si estás parado frente al problema"
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-bold transition ${desdeGps ? "border border-resuelto/50 bg-resuelto/10 text-resuelto" : "bg-azul text-white hover:brightness-110"} disabled:opacity-50`}
            >
              <LocateFixed size={12} className={buscandoGps ? "animate-spin" : ""} />
              {buscandoGps ? "Ubicando…" : desdeGps ? "Ubicado por GPS ✓" : "Usar mi ubicación"}
            </button>
          </div>
        </div>
        {errorCapa && <p className="mb-1.5 text-xs text-peligro">{errorCapa}</p>}
        <MapaSelector punto={punto} alElegir={(lat, lon) => elegirPunto(lat, lon, false)} capa={capa} />
        {punto && (
          <p className="num mt-1 text-[11px] text-texto-3">
            {punto.lat.toFixed(6)}, {punto.lon.toFixed(6)} {desdeGps && <span className="text-resuelto">· GPS</span>}
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-semibold tracking-wider text-texto-3 uppercase">
            Dirección {buscandoDireccion && <span className="text-celeste">· buscando…</span>}
            {dictadoDireccion.escuchando && <span className="text-peligro"> · escuchando…</span>}
          </label>
          <div className="flex gap-2">
            <input
              value={direccion}
              onChange={(e) => setDireccion(e.target.value)}
              placeholder="Ej: Av. Mate de Luna 2400"
              className="w-full min-w-0 rounded-lg border border-borde-2 bg-panel-2 px-3 py-2.5 text-sm placeholder:text-texto-3"
            />
            {dictadoDireccion.hayVoz && (
              <BotonMicrofono
                escuchando={dictadoDireccion.escuchando}
                alternar={dictadoDireccion.alternar}
                titulo="Dictar la dirección"
              />
            )}
          </div>
          {dictadoDireccion.error && (
            <p className="mt-1 text-xs text-peligro">{dictadoDireccion.error}</p>
          )}
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold tracking-wider text-texto-3 uppercase">Tipo de problema</label>
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} className="w-full rounded-lg border border-borde-2 bg-panel-2 px-3 py-2.5 text-sm">
            {TIPOS_PROBLEMA.map((t) => (
              <option key={t} value={t}>{ETIQUETA_TIPO[t]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold tracking-wider text-texto-3 uppercase">Vecino que pide</label>
          <input
            value={solicitante}
            onChange={(e) => setSolicitante(e.target.value)}
            placeholder="Nombre y apellido del vecino"
            className="w-full rounded-lg border border-borde-2 bg-panel-2 px-3 py-2.5 text-sm placeholder:text-texto-3"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold tracking-wider text-texto-3 uppercase">Área que lo atiende</label>
          <input
            value={area}
            onChange={(e) => setArea(e.target.value)}
            placeholder="Ej: Dirección de Bacheo, mesa de entradas"
            className="w-full rounded-lg border border-borde-2 bg-panel-2 px-3 py-2.5 text-sm placeholder:text-texto-3"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold tracking-wider text-texto-3 uppercase">Distrito (si se sabe)</label>
          <select
            value={distrito}
            onChange={(e) => setDistrito(e.target.value)}
            className="w-full rounded-lg border border-borde-2 bg-panel-2 px-3 py-2.5 text-sm"
          >
            <option value="">Sin especificar</option>
            {DISTRITOS.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-semibold tracking-wider text-texto-3 uppercase">
          Descripción
          {dictadoDescripcion.escuchando && <span className="text-peligro"> · escuchando…</span>}
        </label>
        <div className="flex items-stretch gap-2">
          <textarea
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            rows={3}
            placeholder={
              dictadoDescripcion.hayVoz
                ? "Qué cuenta el vecino y dónde exactamente… (podés dictarlo con el micrófono)"
                : "Qué cuenta el vecino y dónde exactamente…"
            }
            className="w-full min-w-0 rounded-lg border border-borde-2 bg-panel-2 px-3 py-2.5 text-sm placeholder:text-texto-3"
          />
          {dictadoDescripcion.hayVoz && (
            <BotonMicrofono
              escuchando={dictadoDescripcion.escuchando}
              alternar={dictadoDescripcion.alternar}
              titulo="Dictar la descripción (se agrega a lo ya escrito)"
              alto
            />
          )}
        </div>
        {dictadoDescripcion.error && (
          <p className="mt-1 text-xs text-peligro">{dictadoDescripcion.error}</p>
        )}
      </div>

      {error && <p className="text-sm text-peligro">{error}</p>}

      <button
        onClick={enviar}
        disabled={pendiente || !punto || direccion.length < 3 || descripcion.length < 5 || solicitante.length < 3 || area.length < 2}
        className="rounded-lg bg-azul px-6 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
      >
        {pendiente ? "Enviando…" : "Registrar pedido"}
      </button>
    </div>
  );
}

/**
 * Botón de micrófono grande (target de 44px+): el que carga suele estar con
 * el teléfono en una mano y el vecino hablando; tiene que poder tocarlo sin
 * mirar.
 */
function BotonMicrofono({
  escuchando,
  alternar,
  titulo,
  alto = false,
}: {
  escuchando: boolean;
  alternar: () => void;
  titulo: string;
  alto?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={alternar}
      title={escuchando ? "Dejar de escuchar" : titulo}
      className={`flex w-12 shrink-0 items-center justify-center rounded-lg border transition ${alto ? "" : "h-12"} ${
        escuchando
          ? "animate-pulse border-peligro/50 bg-peligro/15 text-peligro"
          : "border-borde-2 bg-panel-2 text-texto-2 hover:border-celeste hover:text-celeste"
      }`}
    >
      <Mic size={20} />
    </button>
  );
}
