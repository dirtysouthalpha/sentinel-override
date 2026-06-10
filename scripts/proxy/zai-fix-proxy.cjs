// ZAI API Compatibility Proxy v3
// v3: Fixed OAuth Bearer auth + auto token refresh + content block id patching
//
// Fixes:
// 1. OAuth tokens (sk-ant-oat01-...) sent as Authorization: Bearer instead of x-api-key
// 2. Auto-refreshes OAuth tokens 30 minutes before expiry
// 3. Patches missing 'id' fields on content blocks (ZAI server-side fix)
//
// Run: node zai-fix-proxy.cjs
// Then set ANTHROPIC_BASE_URL=http://localhost:18321/api/anthropic

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const LISTEN_PORT = 18321;
const UPSTREAM = "https://api.anthropic.com";
const CREDENTIALS_PATH = path.join(
  process.env.USERPROFILE || "C:\\Users\\Administrator",
  ".claude",
  ".credentials.json"
);
const SETTINGS_PATH = path.join(
  process.env.USERPROFILE || "C:\\Users\\Administrator",
  ".claude",
  "settings.json"
);
const REFRESH_MARGIN_MS = 30 * 60 * 1000; // Refresh 30 minutes before expiry

let requestCounter = 0;
let cachedCredentials = null;
let lastCredentialRead = 0;
const CREDENTIAL_READ_INTERVAL = 30000; // Re-read credentials file every 30s

// ===== TOKEN MANAGEMENT =====

function readCredentials() {
  const now = Date.now();
  if (cachedCredentials && now - lastCredentialRead < CREDENTIAL_READ_INTERVAL) {
    return cachedCredentials;
  }
  try {
    const raw = fs.readFileSync(CREDENTIALS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed.claudeAiOauth) {
      cachedCredentials = parsed.claudeAiOauth;
      lastCredentialRead = now;
      return cachedCredentials;
    }
  } catch (err) {
    console.error("[auth] Failed to read credentials:", err.message);
  }
  return null;
}

function writeCredentials(oauthData) {
  try {
    let existing = {};
    try {
      existing = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf8"));
    } catch {}
    existing.claudeAiOauth = { ...existing.claudeAiOauth, ...oauthData };
    fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(existing, null, 2));
    cachedCredentials = existing.claudeAiOauth;
    lastCredentialRead = Date.now();
    console.log("[auth] Credentials file updated");
  } catch (err) {
    console.error("[auth] Failed to write credentials:", err.message);
  }
}

async function refreshOAuthToken() {
  const creds = readCredentials();
  if (!creds || !creds.refreshToken) {
    console.error("[auth] No refresh token available");
    return null;
  }

  console.log("[auth] Refreshing OAuth token...");

  // Claude Code OAuth refresh — POST to Anthropic's token endpoint
  const refreshPayload = JSON.stringify({
    grant_type: "refresh_token",
    refresh_token: creds.refreshToken,
    client_id: "claude-code",
  });

  return new Promise((resolve) => {
    const req = https.request(
      "https://api.anthropic.com/v1/oauth/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(refreshPayload),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString());
            if (body.access_token && body.refresh_token) {
              const newCreds = {
                accessToken: body.access_token,
                refreshToken: body.refresh_token,
                expiresAt: body.expires_at || Date.now() + (body.expires_in || 3600) * 1000,
                scopes: body.scopes || creds.scopes,
                subscriptionType: body.subscription_type || creds.subscriptionType,
                rateLimitTier: body.rate_limit_tier || creds.rateLimitTier,
              };
              writeCredentials(newCreds);
              console.log("[auth] Token refreshed successfully. New expiry:", new Date(newCreds.expiresAt).toISOString());
              resolve(newCreds.accessToken);
            } else if (body.error) {
              console.error("[auth] Refresh failed:", body.error, body.error_description || "");
              resolve(null);
            } else {
              console.error("[auth] Unexpected refresh response:", JSON.stringify(body).substring(0, 200));
              resolve(null);
            }
          } catch (err) {
            console.error("[auth] Failed to parse refresh response:", err.message);
            resolve(null);
          }
        });
      }
    );
    req.on("error", (err) => {
      console.error("[auth] Refresh request failed:", err.message);
      resolve(null);
    });
    req.end(refreshPayload);
  });
}

async function getValidToken() {
  const creds = readCredentials();
  if (!creds) return null;

  const now = Date.now();
  const expiresAt = creds.expiresAt || 0;

  // If token expires within REFRESH_MARGIN_MS, try to refresh
  if (expiresAt - now < REFRESH_MARGIN_MS) {
    console.log(`[auth] Token expires in ${Math.round((expiresAt - now) / 60000)} minutes, refreshing...`);
    const newToken = await refreshOAuthToken();
    if (newToken) return newToken;
    // If refresh failed but token hasn't expired yet, use it anyway
    if (expiresAt > now) {
      console.log("[auth] Refresh failed, using existing token (still valid)");
      return creds.accessToken;
    }
    console.error("[auth] Token expired and refresh failed!");
    return null;
  }

  return creds.accessToken;
}

// ===== AUTH HEADER FIX =====

function fixAuthHeaders(headers) {
  // Claude Code sends OAuth tokens via x-api-key header
  // Anthropic requires OAuth tokens as Authorization: Bearer
  const apiKey = headers["x-api-key"];
  if (apiKey && typeof apiKey === "string" && apiKey.startsWith("sk-ant-oat")) {
    // This is an OAuth access token — convert to Bearer
    delete headers["x-api-key"];
    headers["authorization"] = `Bearer ${apiKey}`;
  }
  return headers;
}

// ===== CONTENT BLOCK PATCHING (unchanged from v2) =====

function patchRequestMessages(reqJson) {
  if (!Array.isArray(reqJson.messages)) return reqJson;
  reqJson.messages = reqJson.messages.map((msg) => {
    if (msg.role === "user" && Array.isArray(msg.content)) {
      msg.content = msg.content.map((block, i) => {
        if (block && typeof block === "object") {
          if (block.type === "tool_result" && !block.id) {
            block.id = `tr_${Date.now()}_${requestCounter}_${i}`;
          }
          if (Array.isArray(block.content)) {
            block.content = block.content.map((nested, j) => {
              if (nested && typeof nested === "object" && !nested.id) {
                nested.id = `nc_${Date.now()}_${requestCounter}_${i}_${j}`;
              }
              return nested;
            });
          }
          if (!block.id) {
            block.id = `ub_${Date.now()}_${requestCounter}_${i}`;
          }
        }
        return block;
      });
    }
    return msg;
  });
  return reqJson;
}

function patchSSEEvent(event) {
  if (!event || typeof event !== "object") return event;
  if (event.type === "content_block_start" && event.content_block) {
    const cb = event.content_block;
    if (!cb.id) {
      cb.id = `${cb.type || "cb"}_${Date.now()}_${event.index || 0}`;
    }
  }
  if (event.type === "message_start" && event.message) {
    patchMessage(event.message);
  }
  return event;
}

function patchMessage(msg) {
  if (!msg || typeof msg !== "object") return msg;
  if (Array.isArray(msg.content)) {
    msg.content = msg.content.map((block, i) => {
      if (!block || typeof block !== "object") return block;
      if (!block.id) {
        block.id = `${block.type || "blk"}_${Date.now()}_${i}`;
      }
      return block;
    });
  }
  return msg;
}

// ===== MAIN PROXY SERVER =====

const server = http.createServer((req, res) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    });
    return res.end();
  }

  // Health check
  if (req.url === "/healthz") {
    const creds = readCredentials();
    const tokenStatus = creds
      ? `expires ${new Date(creds.expiresAt).toISOString()}`
      : "NO CREDENTIALS";
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(
      JSON.stringify({
        ok: true,
        proxy: "zai-fix-v3",
        upstream: UPSTREAM,
        auth: tokenStatus,
        uptime: process.uptime(),
      })
    );
  }

  // Collect request body
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", async () => {
    const rawBody = Buffer.concat(chunks);

    // ===== PATCH OUTGOING REQUEST =====
    let patchedBody = rawBody;
    try {
      const reqJson = JSON.parse(rawBody.toString());
      patchRequestMessages(reqJson);
      patchedBody = Buffer.from(JSON.stringify(reqJson));
      requestCounter++;
    } catch {
      // Not JSON — pass through
    }

    // ===== STRIP /api/anthropic PREFIX =====
    // ANTHROPIC_BASE_URL=http://127.0.0.1:18321/api/anthropic causes requests
    // to come in as /api/anthropic/v1/messages — strip the prefix before forwarding
    let forwardPath = req.url;
    if (forwardPath.startsWith("/api/anthropic")) {
      forwardPath = forwardPath.slice("/api/anthropic".length) || "/";
    }

    const upstreamUrl = new URL(forwardPath, UPSTREAM);
    const upstreamHeaders = { ...req.headers };
    delete upstreamHeaders.host;
    upstreamHeaders["content-length"] = patchedBody.length;

    // ===== FIX AUTH HEADERS =====
    // Convert x-api-key OAuth tokens to Authorization: Bearer
    // If the incoming token is stale/invalid, inject the fresh token from credentials
    const apiKey = upstreamHeaders["x-api-key"];
    const creds = readCredentials();
    if (creds && creds.accessToken) {
      // Always use the fresh token from credentials.json
      delete upstreamHeaders["x-api-key"];
      upstreamHeaders["authorization"] = `Bearer ${creds.accessToken}`;
    } else if (apiKey && typeof apiKey === "string" && apiKey.startsWith("sk-ant-oat")) {
      fixAuthHeaders(upstreamHeaders);
    }

    const upstreamReq = https.request(
      upstreamUrl,
      { method: req.method, headers: upstreamHeaders },
      (upstreamRes) => {
        // If we get 401, log it clearly
        if (upstreamRes.statusCode === 401) {
          console.error("[proxy] 401 Unauthorized from upstream — token may be invalid");
        }

        const isStreaming =
          upstreamRes.headers["content-type"]?.includes("text/event-stream") ||
          upstreamRes.headers["content-type"]?.includes("text/stream");

        if (isStreaming) {
          const resHeaders = { ...upstreamRes.headers };
          res.writeHead(upstreamRes.statusCode, resHeaders);

          let buffer = "";
          upstreamRes.on("data", (chunk) => {
            buffer += chunk.toString();
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              if (line.startsWith("data: ")) {
                const data = line.slice(6).trim();
                if (data === "[DONE]") {
                  res.write(line + "\n\n");
                  continue;
                }
                try {
                  const parsed = JSON.parse(data);
                  const patched = patchSSEEvent(parsed);
                  res.write("data: " + JSON.stringify(patched) + "\n\n");
                } catch {
                  res.write(line + "\n\n");
                }
              } else {
                res.write(line + "\n");
              }
            }
          });

          upstreamRes.on("end", () => {
            if (buffer.trim()) res.write(buffer + "\n");
            res.end();
          });
        } else {
          const respChunks = [];
          upstreamRes.on("data", (c) => respChunks.push(c));
          upstreamRes.on("end", () => {
            const respBody = Buffer.concat(respChunks);
            let patched = respBody;
            try {
              const parsed = JSON.parse(respBody.toString());
              patched = Buffer.from(JSON.stringify(patchMessage(parsed)));
            } catch {}

            const h = { ...upstreamRes.headers };
            h["content-length"] = patched.length;
            delete h["transfer-encoding"];
            res.writeHead(upstreamRes.statusCode, h);
            res.end(patched);
          });
        }
      }
    );

    upstreamReq.on("error", (err) => {
      console.error("[proxy] upstream error:", err.message);
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "upstream_error", message: err.message }));
    });

    upstreamReq.end(patchedBody);
  });
});

// ===== TOKEN REFRESH BACKGROUND JOB =====
// Check every 10 minutes and refresh if within 30 min of expiry
setInterval(async () => {
  try {
    const creds = readCredentials();
    if (!creds) return;
    const now = Date.now();
    const expiresAt = creds.expiresAt || 0;
    const remaining = expiresAt - now;

    if (remaining < REFRESH_MARGIN_MS) {
      console.log(`[auth-scheduler] Token expires in ${Math.round(remaining / 60000)} min — auto-refreshing...`);
      const newToken = await refreshOAuthToken();
      if (newToken) {
        console.log("[auth-scheduler] Auto-refresh successful");
      } else {
        console.error("[auth-scheduler] Auto-refresh FAILED — will retry next cycle");
      }
    }
  } catch (err) {
    console.error("[auth-scheduler] Error:", err.message);
  }
}, 10 * 60 * 1000); // Every 10 minutes

// ===== STARTUP =====
server.listen(LISTEN_PORT, "127.0.0.1", () => {
  const creds = readCredentials();
  const tokenInfo = creds
    ? `token expires ${new Date(creds.expiresAt).toISOString()}`
    : "NO CREDENTIALS FILE";
  console.log(`[zai-fix-proxy v3] Listening on http://127.0.0.1:${LISTEN_PORT}`);
  console.log(`[zai-fix-proxy v3] Upstream: ${UPSTREAM}`);
  console.log(`[zai-fix-proxy v3] Auth: ${tokenInfo}`);
  console.log(`[zai-fix-proxy v3] Features: OAuth Bearer conversion + auto-refresh + content block id patching`);
  console.log(`[zai-fix-proxy v3] Auto-refresh: checks every 10min, refreshes 30min before expiry`);
});
