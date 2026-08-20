import { jwtVerify } from "jose";
import { NextResponse, type NextRequest } from "next/server";

const PUBLICAS = ["/acceso", "/api/auth", "/dev/sso", "/marca", "/_next", "/favicon"];

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
  if (pathname.startsWith("/api/sync")) return NextResponse.next();

  const token = req.cookies.get("cimba_sesion")?.value;
  if (token) {
    try {
      const secreto = new TextEncoder().encode(process.env.CIMBA_JWT_SECRET ?? "");
      await jwtVerify(token, secreto, { issuer: "cimba" });
      return NextResponse.next();
    } catch {
      /* sesión inválida → acceso */
    }
  }

  const url = req.nextUrl.clone();
  url.pathname = "/acceso";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
