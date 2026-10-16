import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;

  if (pathname === "/") {
    // If Supabase could not use our redirect address it sends the sign-in code to the home page.
    // Pass it on to the handler that finishes the sign-in.
    const code = searchParams.get("code");
    if (code) {
      const url = request.nextUrl.clone();
      url.pathname = "/auth/callback";
      url.search = `?code=${encodeURIComponent(code)}`;
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  return updateSession(request);
}

export const config = {
  matcher: ["/", "/khata/:path*", "/login"],
};
