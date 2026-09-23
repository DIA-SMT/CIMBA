import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_SESION, DURACION_SESION_S, RENOVAR_DESPUES_DE_S } from "@/lib/sesion-duracion";

/**
 * LA SESIÓN QUE SE RENUEVA SOLA. Si el token tiene más de una hora, se re-emite
 * con los mismos datos por siete días más y viaja en la respuesta. Mientras la
 * persona use CIMBA, no vence; vence tras siete días sin abrirla. Ver
 * lib/sesion-duracion.ts para la historia (Leo, 23/9).
 */
async function renovar(res: NextResponse, payload: JWTPayload, secreto: Uint8Array): Promise<NextResponse> {
  const ahora = Math.floor(Date.now() / 1000);
  if (typeof payload.iat === "number" && ahora - payload.iat < RENOVAR_DESPUES_DE_S) return res;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { iat, exp, iss, nbf, jti, ...datos } = payload;
  const token = await new SignJWT(datos)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer("cimba")
    .setExpirationTime(`${DURACION_SESION_S}s`)
    .sign(secreto);
  res.cookies.set(COOKIE_SESION, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: DURACION_SESION_S,
    path: "/",
  });
  return res;
}

/**
 * El manifest y los íconos van acá y no detrás de la sesión: el navegador los
 * pide para decidir si la app es instalable, y a veces sin mandar la cookie.
 * Detrás del login, el manifest respondía un redirect a /acceso y Chrome
 * concluía que CIMBA no era instalable — sin decir por qué. No hay nada
 * sensible en ellos: el nombre de la app y un dibujo.
 */
const PUBLICAS = [
  "/acceso",
  "/api/auth",
  "/dev/sso",
  "/marca",
  "/icono",
  "/manifest.webmanifest",
  "/_next",
  "/favicon",
  "/sw.js",
  // Avance para afuera: la página y sus datos. Solo responden algo si la
  // Dirección prendió AVANCE_PUBLICO; sin la llave dan 404 igual que hoy.
  "/publico",
  "/api/publico",
];

/**
 * Lo ÚNICO que puede tocar el rol empresa (usuario EXTERNO: contratistas).
 * Allowlist y no denylist a propósito: los endpoints históricos (/api/exportar,
 * /api/geodata, /api/migue…) se gatean con "hay sesión" porque nacieron cuando
 * toda sesión era personal municipal — con perseguirlos uno por uno, el
 * próximo endpoint nuevo repite el agujero. Como la RLS no se aplica (la app
 * corre como dueño de las tablas), este corte central es el perímetro real.
 */
const PREFIJOS_EMPRESA = [
  "/empresa",
  // Su propia clave. Sin esto, una contratista con clave temporal entraba en
  // un bucle: el middleware la mandaba a /clave por el flag ct y esta misma
  // allowlist la rebotaba de /clave a /empresa, para siempre.
  "/clave",
  // Bajar SU trabajo. La ruta ya resuelve la empresa desde la sesión, nunca
  // desde la URL: lo que exporta es lo suyo o nada.
  "/api/empresa",
  "/api/geocodificar",
  "/data",
  "/iconos",
  "/manifest",
];

export async function middleware(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;

  // Entrada desde Ciudad Digital: ?auth=<token> en cualquier ruta → callback
  if (searchParams.has("auth")) {
    const url = req.nextUrl.clone();
    url.pathname = "/api/auth/callback";
    return NextResponse.redirect(url);
  }

  if (PUBLICAS.some((p) => pathname.startsWith(p))) return NextResponse.next();

  // Cron: se autentica con CRON_SECRET, no con sesión
  if (pathname.startsWith("/api/sync") || pathname.startsWith("/api/cron")) return NextResponse.next();

  const token = req.cookies.get(COOKIE_SESION)?.value;
  if (token) {
    try {
      const secreto = new TextEncoder().encode(process.env.CIMBA_JWT_SECRET ?? "");
      const { payload } = await jwtVerify(token, secreto, { issuer: "cimba" });

      /**
       * Clave temporal sin cambiar: SOLO /clave (la página y sus server
       * actions postean ahí mismo) y /api/auth, para poder salir. Al cambiarla
       * la cookie se re-emite sin el flag y esto deja de aplicar.
       *
       * El /api entero estaba exceptuado y era un agujero: con la clave
       * inicial —la que se reparte por WhatsApp y puede estar en cualquier
       * lado— se llegaba igual a los endpoints. El cambio obligatorio no es
       * obligatorio si hay una puerta al costado.
       */
      if (
        payload.ct === true &&
        !pathname.startsWith("/clave") &&
        !pathname.startsWith("/api/auth")
      ) {
        if (pathname.startsWith("/api")) {
          return NextResponse.json({ error: "cambiá tu clave antes de seguir" }, { status: 403 });
        }
        const url = req.nextUrl.clone();
        url.pathname = "/clave";
        url.search = "";
        return NextResponse.redirect(url);
      }

      if (payload.rol_cimba === "empresa" && !PREFIJOS_EMPRESA.some((p) => pathname.startsWith(p))) {
        if (pathname.startsWith("/api")) {
          return NextResponse.json({ error: "sin permiso" }, { status: 403 });
        }
        const url = req.nextUrl.clone();
        url.pathname = "/empresa";
        url.search = "";
        return NextResponse.redirect(url);
      }
      return renovar(NextResponse.next(), payload, secreto);
    } catch {
      /* sesión inválida o vencida → acceso */
    }
  }

  /**
   * SIN SESIÓN. Los datos (/api) y las acciones del servidor contestan 401 en
   * vez de redirigir: una redirección a la página de acceso le llegaba al
   * código como un HTML incomprensible y el formulario de Campo mostraba un
   * error genérico. Con el 401, el cliente sabe que es la sesión y lo dice.
   *
   * Las páginas sí van al acceso, pero con ?volver= para que después de entrar
   * la persona vuelva exactamente adonde estaba —Campo, la orden, la ficha—,
   * y no a la portada.
   */
  if (pathname.startsWith("/api") || req.headers.has("next-action")) {
    return NextResponse.json({ error: "sesion_vencida" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/acceso";
  url.search = "";
  if (pathname !== "/" && req.method === "GET") {
    url.searchParams.set("volver", `${pathname}${req.nextUrl.search}`);
  }
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
