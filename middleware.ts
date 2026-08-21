import { NextRequest, NextResponse } from "next/server";

function unauthorized() {
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Secure Area"' },
  });
}

export function middleware(request: NextRequest) {
  // ローカル開発では Basic 認証を適用しない（本番相当の確認は NODE_ENV=production でビルド・起動して行う）
  if (process.env.NODE_ENV !== "production") {
    return NextResponse.next();
  }

  const user = process.env.BASIC_AUTH_USER;
  const password = process.env.BASIC_AUTH_PASSWORD;

  const authHeader = request.headers.get("authorization");

  if (authHeader?.startsWith("Basic ")) {
    try {
      const encoded = authHeader.slice("Basic ".length);
      const decoded = atob(encoded);
      const separatorIndex = decoded.indexOf(":");

      if (separatorIndex !== -1) {
        const inputUser = decoded.slice(0, separatorIndex);
        const inputPassword = decoded.slice(separatorIndex + 1);

        if (inputUser === user && inputPassword === password) {
          return NextResponse.next();
        }
      }
    } catch {
      // Base64 デコードに失敗した場合は未認証として扱う
    }
  }

  return unauthorized();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
