'use strict';
/**
 * Client URL extraction — base constants and the call sites built from them.
 *
 * WHY THIS EXISTS
 * ---------------
 * Both 2026-08-04 dashboard defects were in the BASE, not the path:
 *
 *   1. `const BRAIN_API = location.origin + '/__brain'`
 *      On a file:// page `location.origin` is the STRING "null", so the base
 *      became "null/__brain" — `new URL()` throws TypeError on it and every
 *      panel died. The paths were all perfectly correct.
 *
 *   2. The "fix": `const BRAIN_API = 'http://localhost:8001'`
 *      Parses cleanly under every protocol, so a URL-validity check waves it
 *      through. It is still broken: a browser reaching the dashboard over the
 *      Cloudflare Tunnel has no route to the server's localhost. The invariant
 *      it violates is SAME-ORIGIN — a base must address the origin that served
 *      the page, or the page cannot be reached from anywhere but the server.
 *
 * So a base is checked three ways (see check-contract.cjs):
 *   (b1) it resolves to a parseable absolute http(s) URL under http:, https:
 *        AND file: — where location.origin is "null";
 *   (b2) under http:/https: it is same-origin;
 *   (c)  any path prefix it introduces (like /__brain) is declared by a server.
 *
 * Extraction uses @babel/parser rather than regex because a base's initializer
 * is an arbitrary expression (the live one is a conditional over
 * location.protocol) and it has to be evaluated, not pattern-matched.
 */

const fs = require('fs');
const parser = require('@babel/parser');
const vm = require('vm');

/**
 * Pull the inline <script> text out of an HTML page, keeping line numbers.
 *
 * Everything outside a script body is blanked to spaces, newlines kept. That
 * costs nothing and means every line number this module reports is the real
 * line in the .html file — a failure message pointing at "line 55" of a 5700-
 * line page is worse than no line number at all, because it is believed.
 */
function inlineScript(html) {
  const out = html.split('');
  const keep = new Array(html.length).fill(false);
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    if (/\bsrc\s*=/i.test(m[1])) continue;
    const bodyStart = m.index + m[0].indexOf('>', m[0].indexOf('<script') ) + 1;
    const bodyEnd = bodyStart + m[2].length;
    for (let i = bodyStart; i < bodyEnd; i++) keep[i] = true;
  }
  for (let i = 0; i < out.length; i++) {
    if (!keep[i] && out[i] !== '\n') out[i] = ' ';
  }
  return out.join('');
}

function parse(code) {
  return parser.parse(code, {
    sourceType: 'script',
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
    errorRecovery: true,
    plugins: ['optionalChaining', 'nullishCoalescingOperator'],
  });
}

/** Walk every node in a babel AST, depth-first. */
function walk(node, visit, parent = null) {
  if (!node || typeof node.type !== 'string') return;
  visit(node, parent);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments' || key === 'innerComments') continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const c of child) if (c && typeof c.type === 'string') walk(c, visit, node);
    } else if (child && typeof child.type === 'string') {
      walk(child, visit, node);
    }
  }
}

/**
 * Find top-level URL base constants.
 *
 * A declaration counts as a base if its initializer mentions `location` or is a
 * string literal that looks like an absolute URL, and it is not obviously
 * something else (a storage key, a number). Names are also matched against a
 * conventional shape (*API*, *_URL, *_BASE, *ORIGIN*) so an unrelated
 * `location.href` read is not mistaken for a base.
 */
function findBases(code) {
  const ast = parse(code);
  const bases = [];
  const NAME_RE = /(API|URL|BASE|ORIGIN|ENDPOINT|HOST)/;

  for (const stmt of ast.program.body) {
    if (stmt.type !== 'VariableDeclaration') continue;
    for (const d of stmt.declarations) {
      if (d.id.type !== 'Identifier' || !d.init) continue;
      const name = d.id.name;
      const src = code.slice(d.init.start, d.init.end);
      const mentionsLocation = /\blocation\s*\./.test(src);
      const looksAbsolute = /^['"`](https?:)?\/\//.test(src.trim());
      const derivesFromKnownBase = bases.some((b) => new RegExp(`\\b${b.name}\\b`).test(src));
      if (!NAME_RE.test(name)) continue;
      if (!mentionsLocation && !looksAbsolute && !derivesFromKnownBase) continue;
      bases.push({
        name,
        expr: src,
        line: code.slice(0, d.init.start).split('\n').length,
        kind: stmt.kind,
        start: d.init.start,
        end: d.init.end,
      });
    }
  }
  return bases;
}

/**
 * The three environments a base must survive.
 *
 * `file` is the one that matters and the one nobody simulates: the spec says
 * an opaque origin serialises to the ASCII STRING "null", so `location.origin`
 * is truthy, string-concatenates happily, and produces "null/__brain".
 */
const ENVIRONMENTS = {
  http: {
    label: 'http:',
    location: {
      protocol: 'http:',
      origin: 'http://homeserver:8091',
      host: 'homeserver:8091',
      hostname: 'homeserver',
      port: '8091',
      href: 'http://homeserver:8091/prime/dashboard-prime.html',
      pathname: '/prime/dashboard-prime.html',
      search: '',
      hash: '',
    },
  },
  https: {
    label: 'https:',
    location: {
      protocol: 'https:',
      origin: 'https://prime.dirtysouthalpha.com',
      host: 'prime.dirtysouthalpha.com',
      hostname: 'prime.dirtysouthalpha.com',
      port: '',
      href: 'https://prime.dirtysouthalpha.com/',
      pathname: '/',
      search: '',
      hash: '',
    },
  },
  file: {
    label: 'file:',
    location: {
      protocol: 'file:',
      // The string "null", NOT the null value. This is the whole point.
      origin: 'null',
      host: '',
      hostname: '',
      port: '',
      href: 'file:///C:/AgentLink/sentinel-override/web/dashboard-prime.html',
      pathname: '/C:/AgentLink/sentinel-override/web/dashboard-prime.html',
      search: '',
      hash: '',
    },
  },
};

/**
 * Evaluate every base in declaration order inside one sandbox per environment,
 * so a base derived from an earlier base (`BRAIN_API = API + '/__brain'`)
 * resolves the way it does in the browser.
 *
 * @returns {object} { [envName]: { [baseName]: {value} | {error} } }
 */
function resolveBases(bases, envNames = Object.keys(ENVIRONMENTS)) {
  const out = {};
  for (const envName of envNames) {
    const env = ENVIRONMENTS[envName];
    const sandbox = {
      location: { ...env.location },
      window: {},
      document: {},
      globalThis: {},
      URL,
      console: { log() {}, warn() {}, error() {} },
    };
    sandbox.window.location = sandbox.location;
    sandbox.globalThis.location = sandbox.location;
    const context = vm.createContext(sandbox);
    out[envName] = {};
    for (const b of bases) {
      try {
        const value = vm.runInContext(`(${b.expr})`, context, { timeout: 1000 });
        // Re-expose for later bases that reference this one.
        vm.runInContext(`var ${b.name} = ${JSON.stringify(value)};`, context);
        out[envName][b.name] = { value };
      } catch (e) {
        out[envName][b.name] = { error: `${e.name}: ${e.message}` };
      }
    }
  }
  return out;
}

/**
 * Find every call site built by concatenating a base with a path.
 *
 * Handles the four shapes the dashboards actually use:
 *   BASE + '/literal'                     -> path '/literal'
 *   `${BASE}/literal`                     -> path '/literal'
 *   BASE + obj.endpoint                   -> indirect; resolved from every
 *                                            object-literal `endpoint:` value
 *                                            in the file (the ACTUATORS table)
 *   BASE + param, inside a helper         -> indirect; resolved from every
 *                                            call of that helper
 *
 * That last one is not decoration. dashboard-prime.html wraps a third of its
 * brain calls in local helpers — `const grab = async (url, fn) => apiJson(BRAIN_API + url)`
 * — and a scanner that only understands literal concatenation sees NONE of
 * those paths. Missing them silently is the same failure this whole test
 * exists to prevent: a check that looks in one place, finds nothing, and
 * reports success.
 *
 * A trailing '/' before a dynamic part ('/api/conversations/' + id) is recorded
 * as a `:param` segment rather than a literal, because that is what it is.
 */
function findCallSites(code, baseNames, opts = {}) {
  const ast = parse(code);
  const sites = [];
  const indirectProps = new Set();
  const indirectParams = [];
  const baseSet = new Set(baseNames);
  const skipRanges = opts.skipRanges || [];

  const lineOf = (n) => code.slice(0, n.start).split('\n').length;
  const inSkipped = (n) => skipRanges.some(([a, b]) => n.start >= a && n.end <= b);

  // Parent map — needed to walk outward from `BASE + url` to the function that
  // owns `url`, and from there to the function's own name.
  const parents = new Map();
  walk(ast, (node, parent) => {
    if (parent) parents.set(node, parent);
  });

  /** Nearest enclosing function that declares `name` as a parameter. */
  function owningFunction(node, name) {
    let cur = parents.get(node);
    while (cur) {
      if (
        cur.type === 'FunctionDeclaration' ||
        cur.type === 'FunctionExpression' ||
        cur.type === 'ArrowFunctionExpression'
      ) {
        const idx = cur.params.findIndex((p) => p.type === 'Identifier' && p.name === name);
        if (idx >= 0) return { fn: cur, index: idx };
      }
      cur = parents.get(cur);
    }
    return null;
  }

  /** The name a function is reachable by: `function f()` or `const f = () => {}`. */
  function functionName(fn) {
    if (fn.id && fn.id.type === 'Identifier') return fn.id.name;
    const p = parents.get(fn);
    if (p && p.type === 'VariableDeclarator' && p.id.type === 'Identifier') return p.id.name;
    if (p && p.type === 'ObjectProperty' && p.key.type === 'Identifier') return p.key.name;
    return null;
  }

  walk(ast, (node) => {
    if (inSkipped(node)) return;
    // BASE + <something>
    if (node.type === 'BinaryExpression' && node.operator === '+' &&
        node.left.type === 'Identifier' && baseSet.has(node.left.name)) {
      const base = node.left.name;
      const right = node.right;
      if (right.type === 'StringLiteral') {
        sites.push({ base, path: right.value, dynamic: false, line: lineOf(node) });
      } else if (right.type === 'TemplateLiteral' && right.quasis.length) {
        sites.push({ base, path: right.quasis[0].value.cooked, dynamic: right.expressions.length > 0, line: lineOf(node) });
      } else if (right.type === 'BinaryExpression' && right.operator === '+' && right.left.type === 'StringLiteral') {
        // BASE + '/api/conversations/' + id
        sites.push({ base, path: right.left.value, dynamic: true, line: lineOf(node) });
      } else if (right.type === 'MemberExpression' && right.property.type === 'Identifier') {
        indirectProps.add(right.property.name);
        sites.push({ base, path: null, indirectProp: right.property.name, line: lineOf(node) });
      } else if (right.type === 'Identifier') {
        // BASE + url, where `url` is a parameter of the enclosing helper.
        const owner = owningFunction(node, right.name);
        const fname = owner && functionName(owner.fn);
        if (owner && fname) {
          indirectParams.push({ base, fname, index: owner.index, param: right.name, line: lineOf(node) });
          sites.push({ base, path: null, indirectParam: { fname, index: owner.index }, line: lineOf(node) });
        } else {
          sites.push({ base, path: null, unresolved: `${base} + ${right.name}`, line: lineOf(node) });
        }
      } else {
        sites.push({ base, path: null, unresolved: code.slice(right.start, right.end).slice(0, 60), line: lineOf(node) });
      }
    }
    // `${BASE}/literal`
    if (node.type === 'TemplateLiteral') {
      for (let i = 0; i < node.expressions.length; i++) {
        const ex = node.expressions[i];
        if (ex.type !== 'Identifier' || !baseSet.has(ex.name)) continue;
        const after = node.quasis[i + 1];
        if (!after) continue;
        const raw = after.value.cooked || '';
        if (!raw.startsWith('/')) continue;
        sites.push({ base: ex.name, path: raw, dynamic: i + 1 < node.expressions.length, line: lineOf(node) });
      }
    }
  });

  // Resolve indirect sites (BASE + a.endpoint) from object-literal tables.
  const propValues = Object.create(null);
  if (indirectProps.size) {
    walk(ast, (node) => {
      if (node.type !== 'ObjectProperty' || node.computed) return;
      const key = node.key.type === 'Identifier' ? node.key.name : node.key.value;
      if (!indirectProps.has(key)) return;
      if (node.value.type !== 'StringLiteral' || !node.value.value.startsWith('/')) return;
      (propValues[key] ||= []).push({ value: node.value.value, line: lineOf(node) });
    });
  }

  // Resolve helper-threaded sites (BASE + url inside `grab(url, fn)`) by
  // collecting the literal passed at that argument position by every caller.
  const argValues = Object.create(null);
  if (indirectParams.length) {
    const wanted = new Map();
    for (const ip of indirectParams) wanted.set(`${ip.fname} ${ip.index}`, true);
    walk(ast, (node) => {
      if (node.type !== 'CallExpression') return;
      const callee = node.callee;
      const name =
        callee.type === 'Identifier' ? callee.name
          : callee.type === 'MemberExpression' && callee.property.type === 'Identifier' ? callee.property.name
            : null;
      if (!name) return;
      for (let i = 0; i < node.arguments.length; i++) {
        if (!wanted.has(`${name} ${i}`)) continue;
        const a = node.arguments[i];
        if (a.type === 'StringLiteral' && a.value.startsWith('/')) {
          (argValues[`${name} ${i}`] ||= []).push({ value: a.value, line: lineOf(a), dynamic: false });
        } else if (a.type === 'TemplateLiteral' && a.quasis.length && (a.quasis[0].value.cooked || '').startsWith('/')) {
          (argValues[`${name} ${i}`] ||= []).push({ value: a.quasis[0].value.cooked, line: lineOf(a), dynamic: a.expressions.length > 0 });
        }
      }
    });
  }

  const expanded = [];
  for (const s of sites) {
    if (s.indirectProp) {
      const vals = propValues[s.indirectProp] || [];
      if (!vals.length) {
        expanded.push({ ...s, unresolved: `${s.base} + <?>.${s.indirectProp}` });
        continue;
      }
      for (const v of vals) {
        expanded.push({ base: s.base, path: v.value, dynamic: false, line: v.line, via: `${s.base} + x.${s.indirectProp} (table entry)` });
      }
      continue;
    }
    if (s.indirectParam) {
      const key = `${s.indirectParam.fname} ${s.indirectParam.index}`;
      const vals = argValues[key] || [];
      if (!vals.length) {
        expanded.push({ ...s, unresolved: `${s.base} + <arg ${s.indirectParam.index} of ${s.indirectParam.fname}()>` });
        continue;
      }
      for (const v of vals) {
        expanded.push({
          base: s.base,
          path: v.value,
          dynamic: v.dynamic,
          line: v.line,
          via: `${s.indirectParam.fname}() arg ${s.indirectParam.index}`,
        });
      }
      continue;
    }
    expanded.push(s);
  }
  return expanded;
}

/** Split a concatenated client path into { path, hadQuery, trailingSlash }. */
function splitPath(raw, dynamic) {
  let p = raw;
  const qi = p.indexOf('?');
  const hadQuery = qi >= 0;
  if (hadQuery) p = p.slice(0, qi);
  let trailingSlash = false;
  if (p.length > 1 && p.endsWith('/')) {
    trailingSlash = true;
    // `'/api/conversations/' + id` addresses `/api/conversations/{id}`.
    if (dynamic) p = p + ':param';
    else p = p.slice(0, -1);
  }
  return { path: p || '/', hadQuery, trailingSlash };
}

function loadClientCode(file) {
  const text = fs.readFileSync(file, 'utf8');
  return file.endsWith('.html') ? inlineScript(text) : text;
}

module.exports = {
  inlineScript,
  findBases,
  findCallSites,
  resolveBases,
  splitPath,
  loadClientCode,
  ENVIRONMENTS,
  walk,
  parse,
};
