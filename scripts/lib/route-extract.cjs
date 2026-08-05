'use strict';
/**
 * Server route extraction — Python (FastAPI + Flask).
 *
 * WHY THIS EXISTS
 * ---------------
 * On 2026-08-04 the dashboard's `BRAIN_API` was repointed from the `/__brain`
 * proxy to `http://localhost:8001` because a grep for `/__brain` in the
 * sentinel-override repo found nothing. The grep was correct and the conclusion
 * was wrong: the route lives in sentinel-desktop's `api/server.py`. Proving a
 * route absent in ONE repo proves nothing about a system whose client and
 * server are in different repos.
 *
 * So this module reads route declarations out of Python source in whatever repo
 * it is pointed at, and `generate-route-manifest.cjs` freezes the union into a
 * committed manifest that CI can check without needing the sibling checkouts.
 *
 * It is deliberately a source scanner, not an importer: importing these servers
 * means installing FastAPI, Flask, torch and a brain database into a Chrome
 * extension's CI job.
 *
 * Recognised declaration forms
 * ----------------------------
 *   FastAPI decorator     @app.get("/x")            @router.api_route("/x/{p:path}")
 *   FastAPI functional    app.get("/x")(handler)    <- sentinel-desktop uses this
 *   FastAPI add_api_route app.add_api_route("/x", h)
 *   FastAPI mount         app.mount("/viz", StaticFiles(...))
 *   Router prefix         router = APIRouter(prefix="/v6")
 *   include_router prefix app.include_router(r, prefix="/x")
 *   Flask decorator       @app.route("/x", methods=["POST"])   @bp.route("/x")
 *   Flask blueprint       Blueprint("n", __name__, url_prefix="/x")
 *                         app.register_blueprint(bp, url_prefix="/x")
 *   Flask static mount    Flask(__name__, static_folder=..., static_url_path=...)
 */

const fs = require('fs');
const path = require('path');

const FASTAPI_METHODS = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options', 'api_route', 'websocket'];

/** Strip a Python string literal's quotes. Handles ' " and f-prefixes. */
function pyStr(raw) {
  const m = /^[a-zA-Z]{0,2}(['"])([\s\S]*?)\1$/.exec(raw.trim());
  return m ? m[2] : null;
}

/**
 * Normalise a declared path into comparable segments.
 *
 * FastAPI `{id}` and Flask `<id>` both become `:param` (matches one segment).
 * FastAPI `{p:path}` and Flask `<path:p>` both become `:splat` (matches the
 * rest, including zero segments) — `/__brain/{path:path}` is why this matters.
 */
function normalisePath(p) {
  let out = p;
  out = out.replace(/\{([A-Za-z_][A-Za-z0-9_]*):path\}/g, ':splat');
  out = out.replace(/\{[^}]*\}/g, ':param');
  out = out.replace(/<path:[A-Za-z_][A-Za-z0-9_]*>/g, ':splat');
  out = out.replace(/<[^>]*>/g, ':param');
  if (!out.startsWith('/')) out = '/' + out;
  // Collapse doubled slashes introduced by prefix concatenation.
  out = out.replace(/\/{2,}/g, '/');
  return out;
}

function joinPrefix(prefix, p) {
  if (!prefix) return p;
  const a = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  const b = p.startsWith('/') ? p : '/' + p;
  return (a + b) || '/';
}

/**
 * Extract every route declared in one Python source string.
 *
 * @param {string} src      file contents
 * @param {string} label    repo-relative label used in failure messages
 * @param {object} [opts]   { extraPrefix } applied on top of any in-file prefix
 * @returns {{routes: Array, mounts: Array, prefixes: object}}
 */
function extractPythonRoutes(src, label, opts = {}) {
  const routes = [];
  const mounts = [];

  // ── Router prefixes declared in this file: `x = APIRouter(prefix="/v6")` ──
  // neuralis' v6_agi.py is the live case: every /tom/* route is really /v6/tom/*.
  const objectPrefix = Object.create(null);
  const apiRouterRe = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*APIRouter\(([^)]*)\)/gm;
  for (const m of src.matchAll(apiRouterRe)) {
    const pm = /prefix\s*=\s*(['"][^'"]*['"])/.exec(m[2]);
    objectPrefix[m[1]] = pm ? pyStr(pm[1]) : '';
  }

  // ── Flask blueprint prefixes: `bp = Blueprint("n", __name__, url_prefix="/x")`
  const blueprintRe = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*Blueprint\(([\s\S]*?)\)\s*$/gm;
  for (const m of src.matchAll(blueprintRe)) {
    const pm = /url_prefix\s*=\s*(['"][^'"]*['"])/.exec(m[2]);
    objectPrefix[m[1]] = pm ? pyStr(pm[1]) : '';
  }

  const basePrefix = opts.extraPrefix || '';
  const prefixFor = (obj) => joinPrefix(basePrefix, objectPrefix[obj] || '') || basePrefix;

  const add = (obj, method, rawPath, line) => {
    const p = pyStr(rawPath);
    if (p === null || !p.startsWith('/')) return;
    const withPrefix = joinPrefix(prefixFor(obj), p);
    const norm = normalisePath(withPrefix);
    const route = {
      method: method.toUpperCase(),
      path: norm,
      raw: withPrefix,
      declaredIn: `${label}:${line}`,
    };
    // A ROOT-LEVEL WILDCARD IS NOT EVIDENCE.
    //
    // sentinel-prime-premium declares `@app.route('/<path:filename>')`, whose
    // handler serves a file if one exists and 404s otherwise. Left unmarked it
    // matches every path ever asked about, which would make check (a) report
    // "route found" for URLs that 404 in production — the test would be
    // strictly worse than nothing, since it would certify the exact defect it
    // was built to catch. The same is true of `/` and of a StaticFiles mount at
    // `/`. Marked here, excluded from matching in check-contract.cjs, and
    // asserted still-present by the test so the hazard cannot silently vanish.
    if (norm === '/:splat' || norm === '/:param' || norm === '/') route.wildcard = true;
    routes.push(route);
  };

  const lineOf = (index) => src.slice(0, index).split('\n').length;

  // ── FastAPI / Flask decorators ──────────────────────────────────────────
  // @app.get("/x")  @router.post("/x")  @app.route("/x", methods=[...])
  const decoratorRe = new RegExp(
    String.raw`@\s*([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*(route|` + FASTAPI_METHODS.join('|') + String.raw`)\s*\(\s*(['"][^'"]*['"])`,
    'g',
  );
  for (const m of src.matchAll(decoratorRe)) {
    const isFlaskRoute = m[2] === 'route';
    if (isFlaskRoute) {
      // Flask carries its verbs in methods=[...]; default is GET.
      const tail = src.slice(m.index, m.index + 400);
      const mm = /methods\s*=\s*\[([^\]]*)\]/.exec(tail);
      const verbs = mm ? [...mm[1].matchAll(/['"]([A-Za-z]+)['"]/g)].map((x) => x[1]) : ['GET'];
      for (const v of verbs) add(m[1], v, m[3], lineOf(m.index));
    } else if (m[2] === 'api_route') {
      const tail = src.slice(m.index, m.index + 400);
      const mm = /methods\s*=\s*\[([^\]]*)\]/.exec(tail);
      const verbs = mm ? [...mm[1].matchAll(/['"]([A-Za-z]+)['"]/g)].map((x) => x[1]) : ['GET'];
      for (const v of verbs) add(m[1], v, m[3], lineOf(m.index));
    } else {
      add(m[1], m[2], m[3], lineOf(m.index));
    }
  }

  // ── FastAPI functional registration: app.get("/x")(handler) ─────────────
  // sentinel-desktop registers ~90 routes this way. A decorator-only scanner
  // sees ZERO of them, which is precisely how "/api/files has no handler"
  // could have been believed.
  const functionalRe = new RegExp(
    String.raw`(?:^|[^@\w.])([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*(` + FASTAPI_METHODS.join('|') + String.raw`)\s*\(\s*(['"][^'"]*['"])\s*\)\s*\(`,
    'gm',
  );
  for (const m of src.matchAll(functionalRe)) {
    if (m[2] === 'api_route') {
      add(m[1], 'GET', m[3], lineOf(m.index));
      continue;
    }
    add(m[1], m[2], m[3], lineOf(m.index));
  }

  // ── app.add_api_route("/x", handler, methods=[...]) ─────────────────────
  const addApiRouteRe = /([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*add_api_route\s*\(\s*([A-Za-z_][A-Za-z0-9_]*|['"][^'"]*['"])/g;
  for (const m of src.matchAll(addApiRouteRe)) {
    const tail = src.slice(m.index, m.index + 400);
    const mm = /methods\s*=\s*\[([^\]]*)\]/.exec(tail);
    const verbs = mm ? [...mm[1].matchAll(/['"]([A-Za-z]+)['"]/g)].map((x) => x[1]) : ['GET'];
    let literal = m[2];
    if (!/^['"]/.test(literal)) {
      // Loop variable — resolve `for _v in ("/a", "/b"):` above the call.
      const before = src.slice(Math.max(0, m.index - 600), m.index);
      const loop = new RegExp(String.raw`for\s+${literal}\s+in\s*\(([^)]*)\)`).exec(before);
      if (!loop) continue;
      for (const s of loop[1].matchAll(/(['"][^'"]*['"])/g)) {
        for (const v of verbs) add(m[1], v, s[1], lineOf(m.index));
      }
      continue;
    }
    for (const v of verbs) add(m[1], v, literal, lineOf(m.index));
  }

  // ── Mounts: app.mount("/prime", StaticFiles(...)) ───────────────────────
  const mountRe = /([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*mount\s*\(\s*(['"][^'"]*['"])/g;
  for (const m of src.matchAll(mountRe)) {
    const p = pyStr(m[2]);
    if (p === null) continue;
    mounts.push({ path: normalisePath(joinPrefix(basePrefix, p)), declaredIn: `${label}:${lineOf(m.index)}` });
  }

  // ── Flask static mount ──────────────────────────────────────────────────
  // Flask(__name__, static_folder=PUBLIC_DIR) with NO static_url_path does NOT
  // serve at "/" — Flask defaults static_url_path to "/" + basename(static_folder).
  // sentinel-prime-premium sets static_folder to `public/`, so its static mount
  // is `/public`, which is why `/assets/js/tv-dashboard.js` 404s.
  const flaskRe = /Flask\(\s*__name__\s*,([\s\S]{0,400}?)\)/g;
  for (const m of src.matchAll(flaskRe)) {
    const args = m[1];
    const sup = /static_url_path\s*=\s*(['"][^'"]*['"])/.exec(args);
    if (sup) {
      const p = pyStr(sup[1]);
      if (p !== null && p !== '') mounts.push({ path: normalisePath(p), declaredIn: `${label}:${lineOf(m.index)} (flask static_url_path)` });
      else if (p === '') mounts.push({ path: '/', declaredIn: `${label}:${lineOf(m.index)} (flask static root)` });
      continue;
    }
    const sf = /static_folder\s*=\s*(?:str\()?\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(args);
    if (sf) {
      // Resolve the folder variable to a basename if it is assigned a Path in-file.
      const assign = new RegExp(String.raw`^\s*${sf[1]}\s*=\s*.*?["'/]([A-Za-z0-9_.-]+)["']?\s*$`, 'm').exec(src);
      const base = assign ? assign[1] : sf[1].toLowerCase();
      mounts.push({
        path: normalisePath('/' + base),
        declaredIn: `${label}:${lineOf(m.index)} (flask default static_url_path from static_folder)`,
      });
    }
  }

  return { routes, mounts, prefixes: objectPrefix };
}

/**
 * `app.include_router(x, prefix="/y")` — returns { varName: prefix } so a caller
 * can re-extract the included module's routes under that prefix.
 */
function extractIncludeRouterPrefixes(src) {
  const out = Object.create(null);
  const re = /include_router\(\s*([A-Za-z_][A-Za-z0-9_.]*)\s*(?:,\s*([^)]*))?\)/g;
  for (const m of src.matchAll(re)) {
    const pm = m[2] ? /(?:url_)?prefix\s*=\s*(['"][^'"]*['"])/.exec(m[2]) : null;
    out[m[1]] = pm ? pyStr(pm[1]) : '';
  }
  return out;
}

/** `app.register_blueprint(bp, url_prefix="/x")` — { bpVar: prefix }. */
function extractBlueprintPrefixes(src) {
  const out = Object.create(null);
  const re = /register_blueprint\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:,\s*([^)]*))?\)/g;
  for (const m of src.matchAll(re)) {
    const pm = m[2] ? /url_prefix\s*=\s*(['"][^'"]*['"])/.exec(m[2]) : null;
    out[m[1]] = pm ? pyStr(pm[1]) : '';
  }
  return out;
}

/**
 * Does `clientPath` match a declared route path (already normalised)?
 * `:param` eats one segment, `:splat` eats the rest (possibly none).
 */
function pathMatches(clientPath, routePath) {
  const c = clientPath.split('/').filter((s, i) => i === 0 || s !== '');
  const r = routePath.split('/').filter((s, i) => i === 0 || s !== '');
  let i = 0;
  for (; i < r.length; i++) {
    if (r[i] === ':splat') return true; // matches remainder including empty
    if (i >= c.length) return false;
    if (r[i] === ':param') {
      if (c[i] === '') return false;
      continue;
    }
    if (r[i] !== c[i]) return false;
  }
  return i === c.length;
}

/** Prefix match, for mounts. `/prime` covers `/prime/dashboard-prime.html`. */
function prefixMatches(clientPath, mountPath) {
  if (mountPath === '/') return true;
  const m = mountPath.endsWith('/') ? mountPath.slice(0, -1) : mountPath;
  return clientPath === m || clientPath.startsWith(m + '/');
}

function readFileIfExists(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

module.exports = {
  extractPythonRoutes,
  extractIncludeRouterPrefixes,
  extractBlueprintPrefixes,
  normalisePath,
  joinPrefix,
  pathMatches,
  prefixMatches,
  readFileIfExists,
  pyStr,
  FASTAPI_METHODS,
  path,
};
