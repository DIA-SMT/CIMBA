"use client";

/**
 * EL MEJOR FIX DEL GPS, no el primero.
 *
 * Los seis lugares del sistema que leían el GPS hacían un solo
 * `getCurrentPosition` y se quedaban con lo que viniera. El primer fix de un
 * teléfono —recién sacado del bolsillo, bajo los árboles de una vereda de
 * Tucumán, entre edificios— suele venir con 30 a 80 metros de error, y a los
 * tres segundos ya está en 5 a 10. El sistema se quedaba con el malo, y el
 * capataz veía el pin en la vereda de enfrente o a media cuadra.
 *
 * Acá se escucha durante unos segundos con `watchPosition` y se guarda el
 * mejor (menor `accuracy`). Se corta antes si ya es excelente (≤ 8 m) o cuando
 * se cumple el tiempo. Si en todo ese tiempo no hubo un fix razonable
 * (> 150 m: el teléfono está adivinando por antena), se rechaza con un mensaje
 * que dice qué hacer en vez de aceptar un punto que no sirve.
 */

export interface FixGps {
  lat: number;
  lon: number;
  /** Radio de error en metros que informa el teléfono. */
  precisionM: number;
  /** Cuántas lecturas se descartaron para llegar a esta. */
  lecturas: number;
}

export class ErrorGps extends Error {
  codigo: "sin_soporte" | "sin_permiso" | "sin_fix" | "imprecisa";
  constructor(codigo: ErrorGps["codigo"], mensaje: string) {
    super(mensaje);
    this.name = "ErrorGps";
    this.codigo = codigo;
  }
}

/** Hasta dónde vale la pena esperar mejor precisión, y cuándo ya es excelente. */
const ESPERA_MS = 8_000;
const EXCELENTE_M = 8;
/** Por encima de esto el teléfono está adivinando por antena, no por satélite. */
const INSERVIBLE_M = 150;

export function mejorPosicion(opciones: { esperaMs?: number } = {}): Promise<FixGps> {
  const esperaMs = opciones.esperaMs ?? ESPERA_MS;
  return new Promise((resolver, rechazar) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      rechazar(new ErrorGps("sin_soporte", "Este teléfono no expone el GPS al navegador."));
      return;
    }
    let mejor: FixGps | null = null;
    let lecturas = 0;
    let terminado = false;

    const terminar = () => {
      if (terminado) return;
      terminado = true;
      navigator.geolocation.clearWatch(reloj);
      clearTimeout(temporizador);
      if (!mejor) {
        rechazar(
          new ErrorGps(
            "sin_fix",
            "No se pudo leer el GPS. Fijate que la ubicación del teléfono esté prendida y salí a cielo abierto un momento.",
          ),
        );
        return;
      }
      if (mejor.precisionM > INSERVIBLE_M) {
        rechazar(
          new ErrorGps(
            "imprecisa",
            `El GPS solo llegó a ±${Math.round(mejor.precisionM)} m: está ubicando por antena. Esperá un momento al aire libre o buscá la dirección.`,
          ),
        );
        return;
      }
      resolver({ ...mejor, lecturas });
    };

    const reloj = navigator.geolocation.watchPosition(
      (pos) => {
        lecturas++;
        const { latitude, longitude, accuracy } = pos.coords;
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
        const precisionM = Number.isFinite(accuracy) ? accuracy : 9999;
        if (!mejor || precisionM < mejor.precisionM) {
          mejor = { lat: latitude, lon: longitude, precisionM, lecturas };
        }
        if (mejor.precisionM <= EXCELENTE_M) terminar();
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          terminado = true;
          navigator.geolocation.clearWatch(reloj);
          clearTimeout(temporizador);
          rechazar(
            new ErrorGps(
              "sin_permiso",
              "El navegador no tiene permiso para usar el GPS. Habilitalo desde el candado de la barra de direcciones.",
            ),
          );
          return;
        }
        // Timeout o posición no disponible: si ya hay algo, se usa lo mejor
        // que haya; si no, el temporizador termina y dice que no hubo fix.
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: esperaMs },
    );
    const temporizador = setTimeout(terminar, esperaMs);
  });
}

/** "±6 m" / "±45 m (aproximada)": para decirle al capataz qué tan bueno fue. */
export function describirPrecision(precisionM: number): { texto: string; buena: boolean } {
  const m = Math.round(precisionM);
  if (m <= 12) return { texto: `±${m} m`, buena: true };
  if (m <= 40) return { texto: `±${m} m · aceptable, afiná el pin si hace falta`, buena: true };
  return { texto: `±${m} m · aproximada: movelo hasta el bache`, buena: false };
}
