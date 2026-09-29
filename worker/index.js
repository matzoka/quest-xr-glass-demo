/**
 * Cloudflare Worker for quest-xr-glass-demo
 *
 * Gates the taxi analytics feature behind a secret key.
 * - Validates key via query param (?key=...), sets HttpOnly cookie
 * - Strips taxi UI elements from HTML when not authenticated
 * - Returns 403 for direct taxi room asset access when not authenticated
 */

const COOKIE_NAME = "taxi_auth";
const COOKIE_MAX_AGE = 86400 * 7; // 7 days

/**
 * Constant-time string comparison to prevent timing attacks
 */
function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) {
    // Still do some work to avoid length-based timing
    let dummy = 0;
    for (let i = 0; i < b.length; i++) dummy |= b.charCodeAt(i);
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Generate a simple HMAC-like signature for the cookie
 */
async function signCookie(timestamp, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(String(timestamp))
  );
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

/**
 * Verify the cookie signature
 */
async function verifyCookie(cookieValue, secret) {
  if (!cookieValue || !secret) return false;
  const parts = cookieValue.split(".");
  if (parts.length !== 2) return false;
  const [timestamp, signature] = parts;
  const ts = parseInt(timestamp, 10);
  if (isNaN(ts)) return false;
  // Check expiration (7 days)
  if (Date.now() - ts > COOKIE_MAX_AGE * 1000) return false;
  const expected = await signCookie(timestamp, secret);
  return timingSafeEqual(signature, expected);
}

/**
 * Create a signed cookie value
 */
async function createCookieValue(secret) {
  const timestamp = Date.now();
  const signature = await signCookie(timestamp, secret);
  return `${timestamp}.${signature}`;
}

/**
 * Parse cookies from request
 */
function parseCookies(request) {
  const cookieHeader = request.headers.get("Cookie") || "";
  const cookies = {};
  for (const pair of cookieHeader.split(";")) {
    const [key, ...rest] = pair.trim().split("=");
    if (key) cookies[key] = rest.join("=");
  }
  return cookies;
}

/**
 * HTMLRewriter handler to remove taxi analytics elements
 */
class TaxiElementRemover {
  element(element) {
    element.remove();
  }
}

/**
 * HTMLRewriter handler to inject a script flag for taxi auth status
 */
class TaxiAuthFlagInjector {
  constructor(isAllowed) {
    this.isAllowed = isAllowed;
  }

  element(element) {
    const flag = this.isAllowed ? "true" : "false";
    element.prepend(
      `<script>window.__TAXI_ALLOWED__=${flag};</script>`,
      { html: true }
    );
  }
}

/**
 * Check if request path is for taxi analytics room assets
 */
function isTaxiRoomPath(pathname) {
  // Currently the taxi room is part of the main app, but if there were
  // dedicated routes/assets, we'd block them here.
  // For now, we only gate access at the HTML/JS level.
  return false;
}

/**
 * LLM relay (same-origin POST /api/llm) for OpenCode endpoints, which send
 * no CORS headers. Only available with a valid taxi cookie. Upstream is
 * restricted to an allowlist (no open proxy).
 */
const LLM_RELAY_PATH = "/api/llm";
const LLM_ALLOWED_ENDPOINTS = [
  "https://opencode.ai/zen/go/v1/chat/completions",
  "https://opencode.ai/zen/v1/chat/completions",
];
const LLM_DEFAULT_ENDPOINT = LLM_ALLOWED_ENDPOINTS[0];
const LLM_MAX_BODY_BYTES = 256 * 1024;
const LLM_TIMEOUT_MS = 60000;
const LLM_USER_AGENT = "quest-xr-taxi-assistant/1.0";

function jsonResponse(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function normalizeLlmEndpoint(raw) {
  if (!raw) return LLM_DEFAULT_ENDPOINT;
  let e = String(raw).trim().replace(/\/+$/, "");
  if (/\/v1$/.test(e)) e += "/chat/completions";
  return LLM_ALLOWED_ENDPOINTS.includes(e) ? e : null;
}

async function handleLlmRelay(request, env, taxiAllowed) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
  }
  if (!taxiAllowed) return jsonResponse(401, { error: { message: "Unauthorized" } });

  const upstream = normalizeLlmEndpoint(request.headers.get("X-LLM-Endpoint"));
  if (!upstream) return jsonResponse(400, { error: { message: "Endpoint not allowed" } });

  const declared = parseInt(request.headers.get("Content-Length") || "0", 10);
  if (declared > LLM_MAX_BODY_BYTES) return jsonResponse(413, { error: { message: "Payload too large" } });
  const body = await request.arrayBuffer();
  if (body.byteLength > LLM_MAX_BODY_BYTES) return jsonResponse(413, { error: { message: "Payload too large" } });
  if (body.byteLength === 0) return jsonResponse(400, { error: { message: "Empty body" } });

  let apiKey = env.OPENCODE_API_KEY || "";
  if (!apiKey) {
    const m = /^Bearer\s+(.+)$/i.exec(request.headers.get("Authorization") || "");
    apiKey = m ? m[1].trim() : "";
  }
  if (!apiKey) return jsonResponse(401, { error: { message: "No API key configured" } });

  const session = (request.headers.get("X-Opencode-Session") || "").slice(0, 128) || crypto.randomUUID();

  let upstreamRes;
  try {
    upstreamRes = await fetch(upstream, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "User-Agent": LLM_USER_AGENT,
        "x-opencode-session": session,
      },
      body,
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    });
  } catch (e) {
    const timeout = e && (e.name === "TimeoutError" || e.name === "AbortError");
    return jsonResponse(timeout ? 504 : 502, { error: { message: timeout ? "Upstream timeout" : "Upstream fetch failed" } });
  }

  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    headers: {
      "Content-Type": upstreamRes.headers.get("Content-Type") || "application/json",
      "Cache-Control": "no-store",
    },
  });
}

/**
 * Main request handler
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const secret = env.TAXI_APP_KEY;

    // Handle logout
    if (url.searchParams.get("key") === "logout" || pathname === "/logout") {
      const redirectUrl = new URL(url);
      redirectUrl.searchParams.delete("key");
      if (pathname === "/logout") {
        redirectUrl.pathname = "/quest-mr/";
      }
      return new Response(null, {
        status: 302,
        headers: {
          Location: redirectUrl.toString(),
          "Set-Cookie": `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`,
        },
      });
    }

    // Handle key in query param
    const keyParam = url.searchParams.get("key");
    if (keyParam && secret) {
      if (timingSafeEqual(keyParam, secret)) {
        // Valid key - set cookie and redirect without key in URL
        const cookieValue = await createCookieValue(secret);
        const redirectUrl = new URL(url);
        redirectUrl.searchParams.delete("key");
        return new Response(null, {
          status: 302,
          headers: {
            Location: redirectUrl.toString(),
            "Set-Cookie": `${COOKIE_NAME}=${cookieValue}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=Strict`,
          },
        });
      }
      // Invalid key - redirect without the key param (don't reveal it's wrong via different behavior)
      const redirectUrl = new URL(url);
      redirectUrl.searchParams.delete("key");
      return new Response(null, {
        status: 302,
        headers: { Location: redirectUrl.toString() },
      });
    }

    // Check existing cookie
    const cookies = parseCookies(request);
    const isAuthenticated = secret
      ? await verifyCookie(cookies[COOKIE_NAME], secret)
      : false;

    // If no secret is configured, taxi features are disabled entirely
    const taxiAllowed = isAuthenticated && !!secret;

    // Same-origin LLM relay (requires taxi cookie)
    if (pathname === LLM_RELAY_PATH) {
      return handleLlmRelay(request, env, taxiAllowed);
    }

    // Block direct access to taxi room assets if not authenticated
    if (isTaxiRoomPath(pathname) && !taxiAllowed) {
      return new Response("Forbidden", { status: 403 });
    }

    // Fetch the asset from static assets
    const response = await env.ASSETS.fetch(request);

    // Only transform HTML responses
    const contentType = response.headers.get("Content-Type") || "";
    if (!contentType.includes("text/html")) {
      return response;
    }

    // Apply HTMLRewriter to strip/inject taxi elements based on auth
    let rewriter = new HTMLRewriter().on("head", new TaxiAuthFlagInjector(taxiAllowed));

    if (!taxiAllowed) {
      // Remove taxi button and related elements
      rewriter = rewriter
        .on("#taxiAnalyticsButton", new TaxiElementRemover())
        .on("#taxiChatPanel", new TaxiElementRemover())
        .on("#taxiSettingsModal", new TaxiElementRemover());
    }

    return rewriter.transform(response);
  },
};
