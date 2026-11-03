import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { isSessionGone, isRetryable } from "./authError";

const read = (p: string) => readFileSync(join(__dirname, p), "utf8");
const mw = read("../middleware.ts");
const auth = read("../services/auth.ts");
const sp = read("../components/SessionProvider.tsx");
const shell = read("../components/AppShell.tsx");

describe("telling a dead session from a failed call", () => {
  it("a missing session is signed out, not reconnecting", () => {
    const e = { name: "AuthSessionMissingError", message: "Auth session missing!", status: 400 };
    expect(isSessionGone(e)).toBe(true);
    expect(isRetryable(e)).toBe(false);
  });

  it.each([
    "Invalid Refresh Token: Refresh Token Not Found",
    "refresh_token_not_found",
    "JWT expired",
    "User from sub claim in JWT does not exist",
  ])("%s means signed out", (message) => {
    expect(isSessionGone({ message })).toBe(true);
  });

  it.each([400, 401, 403])("status %i means signed out", (status) => {
    expect(isSessionGone({ status })).toBe(true);
  });

  it("a network drop is retryable, NOT signed out", () => {
    for (const e of [
      { name: "AuthRetryableFetchError", message: "Failed to fetch" },
      { name: "TypeError", message: "NetworkError when attempting to fetch" },
      { message: "request timeout" },
      { status: 503, message: "Service Unavailable" },
      { status: 500, message: "Internal Server Error" },
    ]) {
      expect(isSessionGone(e), JSON.stringify(e)).toBe(false);
      expect(isRetryable(e), JSON.stringify(e)).toBe(true);
    }
  });

  it("no error is neither", () => {
    expect(isSessionGone(null)).toBe(false);
    expect(isRetryable(undefined)).toBe(false);
  });
});

describe("Log out always lands on /login", () => {
  it("suppresses the banner before signing out", () => {
    expect(shell).toContain("beginSignOut();");
    expect(shell.indexOf("beginSignOut();")).toBeLessThan(shell.indexOf("await signOut();"));
  });

  it("hard-navigates, so no React state survives", () => {
    expect(shell).toContain('window.location.assign("/login")');
    expect(shell).not.toContain('await signOut(); router.replace("/login")');
  });

  it("signOut never throws, so a network problem cannot trap anyone", () => {
    expect(auth).toContain("export async function signOut(): Promise<void>");
    expect(auth).toContain("} catch {");
  });

  it("SIGNED_OUT clears state directly, without a profile fetch", () => {
    expect(sp).toContain('if (event === "SIGNED_OUT") {');
    const block = sp.slice(sp.indexOf('if (event === "SIGNED_OUT")'),
                           sp.indexOf("refresh();", sp.indexOf('if (event === "SIGNED_OUT")')));
    expect(block).toContain("setProfile(null)");
    expect(block).toContain("setReconnecting(false)");
    expect(block).not.toContain("loadProfile");
  });

  it("no banner can appear once Log out is clicked", () => {
    expect(sp).toContain("signingOut.current = true;");
    expect(sp).toContain('r.status === "error" && !signingOut.current');
    expect(sp).toContain("if (!reconnecting || signingOut.current) return;");
  });
});

describe("loadProfile classifies correctly", () => {
  it("an auth error is no-session", () => {
    expect(auth).toContain("if (isSessionGone(authError)) return { status: \"no-session\" };");
  });

  it("anything else stays an error, so the page does not move", () => {
    expect(auth).toContain('return { status: "error", message: authError.message };');
  });
});

describe("the middleware no longer hangs after a sign-out", () => {
  it("an auth error redirects instead of passing through", () => {
    expect(mw).toContain("if (isSessionGone(userError)) return redirectToLogin(req, res, true);");
  });

  it("a retryable error still passes through", () => {
    expect(mw).toContain("return withRefreshedCookies(res, NextResponse.next());");
    expect(mw.indexOf("isSessionGone(userError)"))
      .toBeLessThan(mw.indexOf("return withRefreshedCookies(res, NextResponse.next());"));
  });

  it("it clears the sb- cookies on a dead session", () => {
    expect(mw).toContain("function clearAuthCookies(");
    expect(mw).toContain('c.name.startsWith("sb-")');
    expect(mw).toContain("clearAuthCookies(req, redirect);");
  });

  it("a dead session does NOT carry the old cookies forward", () => {
    const block = mw.slice(mw.indexOf("if (sessionGone) {"), mw.indexOf("return res ? withRefreshedCookies"));
    expect(block).toContain("clearAuthCookies");
    expect(block).toContain("return redirect;");
  });
});

describe("the no-auto-logout work is intact", () => {
  it("refreshed cookies still ride every ordinary redirect", () => {
    expect(mw).toContain("function withRefreshedCookies(");
    expect(mw).toContain("from.cookies.getAll().forEach((c) => to.cookies.set(c));");
  });

  it("a failed profile read still keeps the user in place", () => {
    const start = sp.indexOf('r.status === "error"');
    expect(sp.slice(start, sp.indexOf("} else {", start))).not.toContain("setProfile(null)");
  });

  it("TOKEN_REFRESHED and INITIAL_SESSION are still ignored", () => {
    expect(sp).toContain('if (event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION") return;');
  });

  it("AppShell still redirects only on a genuine no-session", () => {
    expect(shell).toContain('if (!loading && !profile && !reconnecting) router.replace("/login");');
  });

  it("/login sits outside the shell, so the banner cannot show there", () => {
    expect(read("../app/login/page.tsx")).not.toContain("AppShell");
  });
});
