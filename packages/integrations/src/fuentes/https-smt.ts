import { request } from "node:https";
import { rootCertificates } from "node:tls";

/**
 * Cliente HTTPS para los backends municipales de smt.gob.ar.
 *
 * Por qué no alcanza `fetch`: el servidor de Atención Ciudadana presenta su
 * certificado wildcard *.smt.gob.ar (Sectigo, válido) pero NO envía el
 * certificado intermedio de la cadena. curl lo tolera; Node/undici lo rechaza
 * con "unable to verify the first certificate", y el barrido de reclamos veía
 * todos los ids como inexistentes.
 *
 * La solución NO es desactivar la verificación TLS — eso abriría la conexión a
 * un intermediario. Se le suma a las CA del sistema el intermedio que el
 * servidor omite (descargado del propio AIA del certificado y verificado con
 * `openssl verify`), y se sigue validando todo lo demás.
 *
 * El arreglo de fondo es del lado del servidor: que DITEC agregue el intermedio
 * a su configuración de TLS. Cuando lo hagan, este módulo sigue funcionando
 * igual y se puede volver a `fetch` sin cambiar nada más.
 *
 * El intermedio de abajo vence en 2036. Para regenerarlo (o si el municipio
 * cambia de emisor), la URL sale del propio certificado del servidor:
 *   openssl s_client -connect estadisticas.smt.gob.ar:8084 -servername estadisticas.smt.gob.ar \
 *     | openssl x509 -noout -text | grep -A2 "Authority Information Access"
 * y se verifica que complete la cadena con:
 *   openssl verify -untrusted <intermedio.pem> <cert-del-servidor.pem>
 */
const INTERMEDIO_SECTIGO = `-----BEGIN CERTIFICATE-----
MIIGTDCCBDSgAwIBAgIQOXpmzCdWNi4NqofKbqvjsTANBgkqhkiG9w0BAQwFADBf
MQswCQYDVQQGEwJHQjEYMBYGA1UEChMPU2VjdGlnbyBMaW1pdGVkMTYwNAYDVQQD
Ey1TZWN0aWdvIFB1YmxpYyBTZXJ2ZXIgQXV0aGVudGljYXRpb24gUm9vdCBSNDYw
HhcNMjEwMzIyMDAwMDAwWhcNMzYwMzIxMjM1OTU5WjBgMQswCQYDVQQGEwJHQjEY
MBYGA1UEChMPU2VjdGlnbyBMaW1pdGVkMTcwNQYDVQQDEy5TZWN0aWdvIFB1Ymxp
YyBTZXJ2ZXIgQXV0aGVudGljYXRpb24gQ0EgRFYgUjM2MIIBojANBgkqhkiG9w0B
AQEFAAOCAY8AMIIBigKCAYEAljZf2HIz7+SPUPQCQObZYcrxLTHYdf1ZtMRe7Yeq
RPSwygz16qJ9cAWtWNTcuICc++p8Dct7zNGxCpqmEtqifO7NvuB5dEVexXn9RFFH
12Hm+NtPRQgXIFjx6MSJcNWuVO3XGE57L1mHlcQYj+g4hny90aFh2SCZCDEVkAja
EMMfYPKuCjHuuF+bzHFb/9gV8P9+ekcHENF2nR1efGWSKwnfG5RawlkaQDpRtZTm
M64TIsv/r7cyFO4nSjs1jLdXYdz5q3a4L0NoabZfbdxVb+CUEHfB0bpulZQtH1Rv
38e/lIdP7OTTIlZh6OYL6NhxP8So0/sht/4J9mqIGxRFc0/pC8suja+wcIUna0HB
pXKfXTKpzgis+zmXDL06ASJf5E4A2/m+Hp6b84sfPAwQ766rI65mh50S0Di9E3Pn
2WcaJc+PILsBmYpgtmgWTR9eV9otfKRUBfzHUHcVgarub/XluEpRlTtZudU5xbFN
xx/DgMrXLUAPaI60fZ6wA+PTAgMBAAGjggGBMIIBfTAfBgNVHSMEGDAWgBRWc1hk
lfmSGrASKgRieaFAFYghSTAdBgNVHQ4EFgQUaMASFhgOr872h6YyV6NGUV3LBycw
DgYDVR0PAQH/BAQDAgGGMBIGA1UdEwEB/wQIMAYBAf8CAQAwHQYDVR0lBBYwFAYI
KwYBBQUHAwEGCCsGAQUFBwMCMBsGA1UdIAQUMBIwBgYEVR0gADAIBgZngQwBAgEw
VAYDVR0fBE0wSzBJoEegRYZDaHR0cDovL2NybC5zZWN0aWdvLmNvbS9TZWN0aWdv
UHVibGljU2VydmVyQXV0aGVudGljYXRpb25Sb290UjQ2LmNybDCBhAYIKwYBBQUH
AQEEeDB2ME8GCCsGAQUFBzAChkNodHRwOi8vY3J0LnNlY3RpZ28uY29tL1NlY3Rp
Z29QdWJsaWNTZXJ2ZXJBdXRoZW50aWNhdGlvblJvb3RSNDYucDdjMCMGCCsGAQUF
BzABhhdodHRwOi8vb2NzcC5zZWN0aWdvLmNvbTANBgkqhkiG9w0BAQwFAAOCAgEA
YtOC9Fy+TqECFw40IospI92kLGgoSZGPOSQXMBqmsGWZUQ7rux7cj1du6d9rD6C8
ze1B2eQjkrGkIL/OF1s7vSmgYVafsRoZd/IHUrkoQvX8FZwUsmPu7amgBfaY3g+d
q1x0jNGKb6I6Bzdl6LgMD9qxp+3i7GQOnd9J8LFSietY6Z4jUBzVoOoz8iAU84OF
h2HhAuiPw1ai0VnY38RTI+8kepGWVfGxfBWzwH9uIjeooIeaosVFvE8cmYUB4TSH
5dUyD0jHct2+8ceKEtIoFU/FfHq/mDaVnvcDCZXtIgitdMFQdMZaVehmObyhRdDD
4NQCs0gaI9AAgFj4L9QtkARzhQLNyRf87Kln+YU0lgCGr9HLg3rGO8q+Y4ppLsOd
unQZ6ZxPNGIfOApbPVf5hCe58EZwiWdHIMn9lPP6+F404y8NNugbQixBber+x536
WrZhFZLjEkhp7fFXf9r32rNPfb74X/U90Bdy4lzp3+X1ukh1BuMxA/EEhDoTOS3l
7ABvc7BYSQubQ2490OcdkIzUh3ZwDrakMVrbaTxUM2p24N6dB+ns2zptWCva6jzW
r8IWKIMxzxLPv5Kt3ePKcUdvkBU/smqujSczTzzSjIoR5QqQA6lN1ZRSnuHIWCvh
JEltkYnTAH41QJ6SAWO66GrrUESwN/cgZzL4JLEqz1Y=
-----END CERTIFICATE-----`;

const CA = [...rootCertificates, INTERMEDIO_SECTIGO];

/** POST con cuerpo JSON, respuesta JSON. Rechaza si el TLS no valida. */
export function postJsonSmt<T>(url: URL, cuerpo: unknown, timeoutMs = 20_000): Promise<T> {
  const datos = JSON.stringify(cuerpo);
  return new Promise<T>((resolver, rechazar) => {
    const req = request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: "POST",
        ca: CA,
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "content-length": Buffer.byteLength(datos),
        },
        timeout: timeoutMs,
      },
      (res) => {
        const trozos: Buffer[] = [];
        res.on("data", (t: Buffer) => trozos.push(t));
        res.on("end", () => {
          const texto = Buffer.concat(trozos).toString("utf8");
          if (res.statusCode === 404) return resolver(null as T);
          if (!res.statusCode || res.statusCode >= 400) {
            return rechazar(new Error(`${url.host} respondió ${res.statusCode}`));
          }
          try {
            resolver(JSON.parse(texto) as T);
          } catch {
            rechazar(new Error(`respuesta no-JSON de ${url.pathname}: ${texto.slice(0, 80)}`));
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error(`timeout de ${timeoutMs} ms`)));
    req.on("error", rechazar);
    req.write(datos);
    req.end();
  });
}
