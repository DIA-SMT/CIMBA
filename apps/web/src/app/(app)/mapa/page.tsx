import { leerSesion } from "@/lib/auth";
import { DESTINOS_RESOLUCION, obtenerKpis, type DestinoResolucion } from "@/lib/consultas";
import { iaDisponible } from "@/lib/ia";
import { MapaCimba, type InicialMapa } from "@/components/mapa/mapa-cimba";

export const dynamic = "force-dynamic";

/**
 * `?destino=` en sus tres formas, todas normalizadas a la misma lista:
 *   ausente        → sin filtro (el mapa abre con su default: solo bacheo)
 *   "todos"        → las tres colas — es lo que cuenta /brecha, y sin esto el
 *                    operador hace clic en "1.845 sin atención" y ve 1.063
 *   "bacheo,sat"   → esa combinación (el formato que emite "Copiar link")
 * Se valida contra la lista cerrada del enum: los tokens que no son destino se
 * descartan, y si no queda ninguno válido el parámetro se ignora entero — un
 * typo en la URL no puede dejar el mapa sin un solo punto.
 */
function destinosDe(valor: string | undefined): DestinoResolucion[] | undefined {
  const bruto = valor?.trim().toLowerCase();
  if (!bruto) return undefined;
  if (bruto === "todos") return [...DESTINOS_RESOLUCION];
  const pedidos = new Set(bruto.split(",").map((t) => t.trim()));
  // Se recorre la lista canónica y no lo que vino: así el orden es siempre el
  // mismo y los duplicados (?destino=sat,sat) se caen solos.
  const validos = DESTINOS_RESOLUCION.filter((d) => pedidos.has(d));
  return validos.length > 0 ? validos : undefined;
}

export default async function PaginaMapa({
  searchParams,
}: {
  searchParams: Promise<{
    lat?: string; lon?: string; z?: string;
    clat?: string; clon?: string; cz?: string;
    vista?: string; brecha?: string; modoBrecha?: string; fuente?: string; tipo?: string;
    destino?: string;
    dias?: string; calor?: string; hex?: string; sat?: string; top?: string;
    zlat?: string; zlon?: string; zr?: string;
    buscar?: string; distrito?: string;
  }>;
}) {
  const sesion = (await leerSesion())!;
  const kpis = await obtenerKpis(sesion);

  // Deep-link desde cualquier lista: /mapa?lat=&lon=&z= abre centrado y marcado.
  const sp = await searchParams;
  const lat = Number(sp.lat);
  const lon = Number(sp.lon);
  const foco =
    Number.isFinite(lat) && Number.isFinite(lon)
      ? { lat, lon, zoom: Math.min(19.5, Math.max(11, Number(sp.z) || 16.5)) }
      : null;

  // Cámara de una vista compartida (Exportar → Copiar link): sin marcador,
  // a diferencia de foco arriba, que es "centrame en este punto puntual".
  const clat = Number(sp.clat);
  const clon = Number(sp.clon);
  const camara =
    !foco && Number.isFinite(clat) && Number.isFinite(clon)
      ? { lat: clat, lon: clon, zoom: Math.min(19.5, Math.max(1, Number(sp.cz) || 12.6)) }
      : undefined;

  // calor es tri-estado: "1"/"0" explícitos pisan el default de la vista;
  // ausente (link viejo) deja que cada vista use el suyo.
  const calor = sp.calor === "1" ? true : sp.calor === "0" ? false : undefined;

  const destinos = destinosDe(sp.destino);

  const inicial: InicialMapa = {
    // Claves nuevas (hoy/brecha/historial) + las viejas por compatibilidad de
    // links guardados: el mapa las normaliza al entrar.
    vista: ["hoy", "historial", "operativo", "historico", "analisis", "brecha", "completo"].includes(sp.vista ?? "")
      ? (sp.vista as "hoy" | "historial" | "operativo" | "historico" | "analisis" | "brecha" | "completo")
      : undefined,
    // Los cuatro pasos del semáforo: 'en_obra' es el que se separó de 'en_cola'
    // (la cuadrilla ya arrancó). Los links viejos con brecha=en_cola siguen
    // siendo válidos, solo muestran menos puntos que antes.
    brecha: ["sin_atencion", "en_cola", "en_obra", "posible_resuelta"].includes(sp.brecha ?? "")
      ? sp.brecha
      : undefined,
    modoBrecha: sp.modoBrecha === "antiguedad" ? ("antiguedad" as const) : undefined,
    fuente: sp.fuente,
    tipo: sp.tipo,
    // Qué colas abre el mapa. Viaja como la lista ya normalizada y separada
    // por comas: el mapa la parsea igual que la que emite "Copiar link de esta
    // vista". Mandar solo el primero cuando hay varios silenciaría justo el
    // caso de /brecha (las tres colas) y el operador vería menos de lo que
    // acaba de clickear.
    destino: destinos?.join(","),
    dias: sp.dias && [30, 90, 180].includes(Number(sp.dias)) ? Number(sp.dias) : undefined,
    calor,
    hex: sp.hex === "1" || undefined,
    sat: sp.sat === "1" || undefined,
    top: sp.top === "1" || undefined,
    camara,
    // Migue (u otro link) puede mandar una acción en lenguaje natural:
    // /mapa?buscar=baches sin atender en Belgrano
    buscar: sp.buscar?.trim().slice(0, 200) || undefined,
    // Aislar un distrito (desde el ranking de /brecha). Los IDs reales son
    // 1..20 pero se valida el rango, no la lista, para no romper si cambian.
    distrito:
      Number.isInteger(Number(sp.distrito)) && Number(sp.distrito) > 0 && Number(sp.distrito) <= 99
        ? Number(sp.distrito)
        : undefined,
    zona:
      sp.zlat && sp.zlon && sp.zr && Number.isFinite(Number(sp.zlat)) && Number.isFinite(Number(sp.zlon))
        ? {
            lat: Number(sp.zlat),
            lon: Number(sp.zlon),
            radio: Math.min(2000, Math.max(60, Number(sp.zr) || 250)),
          }
        : undefined,
  };

  return (
    <MapaCimba
      kpisIniciales={kpis}
      rol={sesion.rol_cimba}
      iaHabilitada={iaDisponible()}
      foco={foco}
      inicial={inicial}
    />
  );
}
