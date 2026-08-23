#!/usr/bin/env node
/**
 * HTML-injection gate for every HTML-rendering surface in the repo: the
 * web/ dashboards, the extension popup (popup-modules/), the content-script
 * UI (content/), and the root-level popup/report pages.
 *
 * History: every XSS this project has shipped went through the same door —
 * a template literal assigned to innerHTML with an interpolation nobody
 * escaped (v8's onclick="viewFile('${esc(path)}')", the image data_uri, the
 * navigateTo path). The rewrites fixed them by discipline: interpolations must
 * go through escHtml()/escAttr() or be provably inert. Discipline does not
 * survive live-deployed rewrites, so this script makes the rule mechanical.
 *
 * For every in-scope .js file and every inline <script> in in-scope .html it
 * parses the source with @babel/parser (already a devDependency) and finds the
 * HTML sinks:
 *
 *   el.innerHTML = X      el.outerHTML = X      el.innerHTML += X
 *   el.insertAdjacentHTML(pos, X)               document.write/writeln(X)
 *
 * X must be a SAFE expression:
 *   - string/number/boolean/null literals
 *   - template literals whose every ${...} is safe
 *   - escHtml(...) / escAttr(...) calls
 *   - Number(...), Math.*(...) (numeric results cannot carry markup)
 *   - ternaries / && / || / + / ?? built from safe parts
 *     (for `a && b` only b can render: a falsy prints as ''/false/0/null)
 *   - a const/let identifier that is never reassigned and whose initializer
 *     is safe (this is what lets `const goal = escHtml(...)` interpolate)
 *   - list.map(fn).join(sep) where every return in fn is safe
 *
 * Anything else fails the gate with file:line. If a value is genuinely safe
 * for a reason the checker cannot see, build the node through the DOM
 * (createElement/textContent) instead of innerHTML — that is the project rule
 * anyway.
 *
 * Exit code 0 = all sinks safe, 1 = violation or parse failure.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { parse } = require('@babel/parser');
const { parseHTML } = require('linkedom');

// Optional argv dir overrides exist for the test suite's fixtures. With no
// args, every directory that renders HTML is in scope: the web/ dashboards,
// the extension popup + content-script UI, and the root-level report pages.
const REPO = path.join(__dirname, '..');
const DEFAULT_SCOPES = [
  path.join(REPO, 'web'),
  path.join(REPO, 'popup-modules'),
  path.join(REPO, 'content'),
  // Root-level extension pages (report-view.js, report-print.js, popup-full.js
  // and their HTML) — listed as files because the repo root also holds dirs
  // that must NOT be scanned (node_modules, dist, tests).
  ...fs.readdirSync(REPO)
    .filter((f) => /^(popup.*|report-.*)\.(js|html)$/.test(f))
    .map((f) => path.join(REPO, f)),
];
const SCOPES = process.argv.length > 2
  ? process.argv.slice(2).map((p) => path.resolve(p))
  : DEFAULT_SCOPES;

// Escaping/sanitizing wrappers whose output is trusted in an HTML context.
// escHtml/escAttr are the web/ dashboard helpers (lib/dash-escape.js);
// escapeHtml is the popup + report-page equivalent; sanitizeHtml (popup) and
// sanitizeReportHtml (lib/report-sanitize.js) are the DOM-based sanitizers for
// marked output. Their behavior is pinned by their own jest suites.
// _safeEsc (popup-modules/client-knowledge.js) and _esc
// (popup-modules/telemetry-panel.js) are file-local escapers with the full
// five-character escape set, verified 2026-08-23; they are named here because
// the checker cannot prove `String(s).replace(...)` escape bodies.
// renderMarkdown (content/quick-assist.js) and _escapeHtml
// (popup-modules/recent-chats.js) are likewise verified: renderMarkdown
// escapes its input FIRST and only then adds its own fixed markup.
const SAFE_ESCAPES = new Set(['escHtml', 'escAttr', 'escapeHtml', 'sanitizeHtml', 'sanitizeReportHtml', '_safeEsc', '_esc', '_escapeHtml', 'renderMarkdown']);
const SINK_PROPS = new Set(['innerHTML', 'outerHTML']);

let failures = 0;
let sinksChecked = 0;

function walkDir(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkDir(full));
    else out.push(full);
  }
  return out;
}

// Generic AST walker (no @babel/traverse dependency).
function walkAst(node, visit) {
  if (!node || typeof node.type !== 'string') return;
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue;
    const child = node[key];
    if (Array.isArray(child)) child.forEach((c) => walkAst(c, visit));
    else if (child && typeof child.type === 'string') walkAst(child, visit);
  }
}

function analyze(code, label) {
  let ast;
  try {
    ast = parse(code, { sourceType: 'unambiguous', errorRecovery: false });
  } catch (e) {
    failures += 1;
    console.error(`  FAIL: ${label} — parse error: ${e.message}`);
    return;
  }

  // Pass 1: build real lexical scopes (function-granularity — let/const from
  // sibling blocks of ONE function merge, which can only ADD conservatism).
  // Every AST node is annotated with its enclosing scope, so resolution later
  // sees exactly the bindings that code could see: two functions may reuse a
  // name without contaminating each other, and a parameter SHADOWS any outer
  // same-named binding instead of falling through to it (the file-global map
  // this replaces had both defects — the first forced renames, the second was
  // quietly unsound).
  //
  // An identifier's value is always one of its declarator inits or assignment
  // RHSs, so it is safe iff ALL of them are (`+=` concatenates, which
  // preserves safety when both halves are safe). Parameters, destructuring
  // targets, and function-expression self-names bind OPAQUE: caller-supplied,
  // never provable.
  const OPAQUE = { type: '__opaque__' };

  function makeScope(parent) {
    return { parent, decls: new Map(), fns: new Map(), assigns: new Map(), tainted: new Set() };
  }
  const rootScope = makeScope(null);

  function addDecl(scope, name, init) {
    const prev = scope.decls.get(name);
    if (prev) prev.inits.push(init);
    else scope.decls.set(name, { inits: [init] });
  }

  function declarePatternOpaque(scope, pat) {
    if (!pat) return;
    if (pat.type === 'Identifier') addDecl(scope, pat.name, OPAQUE);
    else if (pat.type === 'ObjectPattern') pat.properties.forEach((p) => declarePatternOpaque(scope, p.value || p.argument));
    else if (pat.type === 'ArrayPattern') pat.elements.forEach((e) => declarePatternOpaque(scope, e));
    else if (pat.type === 'AssignmentPattern') declarePatternOpaque(scope, pat.left);
    else if (pat.type === 'RestElement') declarePatternOpaque(scope, pat.argument);
  }

  function collect(node, scope) {
    if (!node || typeof node.type !== 'string') return;
    Object.defineProperty(node, '__scope', { value: scope, enumerable: false, configurable: true });
    let childScope = scope;
    switch (node.type) {
      case 'FunctionDeclaration':
        if (node.id) {
          const prev = scope.fns.get(node.id.name);
          if (prev) prev.push(node);
          else scope.fns.set(node.id.name, [node]);
        }
        childScope = makeScope(scope);
        node.params.forEach((p) => declarePatternOpaque(childScope, p));
        break;
      case 'FunctionExpression':
        childScope = makeScope(scope);
        if (node.id) addDecl(childScope, node.id.name, OPAQUE);
        node.params.forEach((p) => declarePatternOpaque(childScope, p));
        break;
      case 'ArrowFunctionExpression':
        childScope = makeScope(scope);
        node.params.forEach((p) => declarePatternOpaque(childScope, p));
        break;
      case 'CatchClause':
        childScope = makeScope(scope);
        if (node.param) declarePatternOpaque(childScope, node.param);
        break;
      case 'VariableDeclarator':
        if (node.id && node.id.type === 'Identifier') addDecl(scope, node.id.name, node.init || null);
        else declarePatternOpaque(scope, node.id);
        break;
    }
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue;
      const child = node[key];
      if (Array.isArray(child)) child.forEach((c) => collect(c, childScope));
      else if (child && typeof child.type === 'string') collect(child, childScope);
    }
  }
  collect(ast, rootScope);

  // The scope holding a name's declaration, seen from `scope`.
  function bindingScope(scope, name) {
    for (let s = scope; s; s = s.parent) {
      if (s.decls.has(name) || s.fns.has(name)) return s;
    }
    return null;
  }

  // Pass 2: writes, bucketed onto the scope that owns the binding (falling
  // back to the root for undeclared / cross-file names).
  walkAst(ast, (n) => {
    if (n.type === 'AssignmentExpression' && n.left.type === 'Identifier') {
      const target = bindingScope(n.__scope || rootScope, n.left.name) || rootScope;
      if (n.operator === '=' || n.operator === '+=') {
        const prev = target.assigns.get(n.left.name);
        if (prev) prev.push(n.right);
        else target.assigns.set(n.left.name, [n.right]);
      } else {
        target.tainted.add(n.left.name);
      }
    }
    // UpdateExpression (++/--) produces numbers; numbers cannot carry markup.
  });

  // Everything the resolver needs to know about `name` as seen from `scope`:
  // its declarators, function declarations, writes, and taint — all from the
  // single scope that owns the binding.
  function resolve(scope, name) {
    const s = bindingScope(scope || rootScope, name);
    if (!s) return null;
    return {
      d: s.decls.get(name) || null,
      f: s.fns.get(name) || null,
      writes: s.assigns.get(name) || null,
      tainted: s.tainted.has(name),
    };
  }

  function returnsOf(fn) {
    // Arrow with expression body returns that expression.
    if (fn.body && fn.body.type !== 'BlockStatement') return [fn.body];
    const rets = [];
    walkAst(fn.body, (n) => {
      if (n.type === 'ReturnStatement' && n.argument) rets.push(n.argument);
    });
    return rets;
  }

  // `const _esc = escapeHtml` style aliases count as the escape they point to.
  function isEscapeName(name, scope, hops = 0) {
    if (SAFE_ESCAPES.has(name)) return true;
    if (hops > 3) return false;
    const r = resolve(scope, name);
    if (!r || r.tainted || r.writes || !r.d || r.d.inits.length !== 1) return false;
    const init = r.d.inits[0];
    return !!init && init.type === 'Identifier'
      && isEscapeName(init.name, init.__scope || scope, hops + 1);
  }

  function isSafe(node, depth) {
    if (!node) return true;
    if (depth > 48) return false;
    switch (node.type) {
      case 'StringLiteral':
      case 'NumericLiteral':
      case 'BooleanLiteral':
      case 'NullLiteral':
        return true;
      case 'TemplateLiteral':
        return node.expressions.every((e) => isSafe(e, depth + 1));
      case 'ArrayExpression':
        return node.elements.every((e) => e && e.type !== 'SpreadElement' && isSafe(e, depth + 1));
      case 'ParenthesizedExpression':
        return isSafe(node.expression, depth + 1);
      case 'ConditionalExpression':
        return isSafe(node.consequent, depth + 1) && isSafe(node.alternate, depth + 1);
      case 'LogicalExpression':
        // `a && b`: only b renders as markup — falsy a prints '', false, 0, null.
        if (node.operator === '&&') return isSafe(node.right, depth + 1);
        return isSafe(node.left, depth + 1) && isSafe(node.right, depth + 1);
      case 'BinaryExpression':
        // Only `+` can concatenate strings; every other binary operator
        // yields a number or boolean, which cannot carry markup.
        if (node.operator !== '+') return true;
        return isSafe(node.left, depth + 1) && isSafe(node.right, depth + 1);
      case 'UnaryExpression':
        return ['+', '-', '~', '!', 'void', 'typeof'].includes(node.operator);
      case 'Identifier': {
        if (node.name === 'undefined') return true;
        const r = resolve(node.__scope, node.name);
        if (!r || r.tainted || !r.d) return false;
        // A declarator with no init (`let x;`) holds undefined until assigned —
        // renders as the string "undefined", which is inert — so only actual
        // expressions need proving.
        if (!r.d.inits.every((init) => init === null || isSafe(init, depth + 1))) return false;
        return !r.writes || r.writes.every((rhs) => isSafe(rhs, depth + 1));
      }
      case 'MemberExpression': {
        // .length is a number whatever the receiver is.
        if (!node.computed && node.property.type === 'Identifier' && node.property.name === 'length') {
          return true;
        }
        // A lookup on a const object literal whose every property value is
        // safe (icon maps, color maps): FEED_COLORS[category] can only ever
        // yield one of the map's values or undefined.
        if (node.object.type !== 'Identifier') return false;
        const r = resolve(node.object.__scope, node.object.name);
        if (!r || r.tainted || r.writes || !r.d || r.d.inits.length === 0) return false;
        // A name redeclared by sibling blocks in one function merges here;
        // fine as long as every initializer is a literal table with safe values.
        return r.d.inits.every((init) => {
          if (!init) return false;
          if (init.type === 'ObjectExpression') {
            return init.properties.every((p) =>
              p.type === 'ObjectProperty' && !p.computed && isSafe(p.value, depth + 1));
          }
          if (init.type === 'ArrayExpression') return isSafe(init, depth + 1);
          return false;
        });
      }
      case 'CallExpression': {
        const callee = node.callee;
        if (callee.type === 'ArrowFunctionExpression' || callee.type === 'FunctionExpression') {
          // IIFE: renders whatever it returns.
          return returnsOf(callee).every((r) => isSafe(r, depth + 1));
        }
        if (callee.type === 'Identifier') {
          if (isEscapeName(callee.name, callee.__scope)) return true;
          if (callee.name === 'Number') return true;
          // Output alphabet is %-encoded: no quotes, <, >, &, =, or spaces
          // survive, so the result cannot form markup or attributes.
          if (callee.name === 'encodeURIComponent') return true;
          // A call to a same-file function is safe when every return in that
          // function is itself safe — this is what lets icon/badge helpers
          // that return fixed SVG strings interpolate without a whitelist.
          const r = resolve(callee.__scope, callee.name);
          if (r && !r.tainted && !r.writes) {
            if (r.f && r.f.length === 1 && !r.d) {
              return returnsOf(r.f[0]).every((ret) => isSafe(ret, depth + 1));
            }
            // const fn = () => ... / function expressions bound to a const.
            if (r.d && !r.f && r.d.inits.length === 1 && r.d.inits[0]
                && (r.d.inits[0].type === 'ArrowFunctionExpression' || r.d.inits[0].type === 'FunctionExpression')) {
              return returnsOf(r.d.inits[0]).every((ret) => isSafe(ret, depth + 1));
            }
          }
          return false;
        }
        if (callee.type === 'MemberExpression' && !callee.computed) {
          const prop = callee.property.name;
          // Math.round(...) etc — numbers cannot carry markup.
          if (callee.object.type === 'Identifier' && callee.object.name === 'Math') return true;
          // Number/date formatters produce digit-and-punctuation text with no
          // markup characters, whatever the receiver holds.
          if (['toFixed', 'toISOString', 'toLocaleTimeString', 'toLocaleDateString', 'toLocaleString'].includes(prop)) {
            return true;
          }
          // String methods on a safe base stay safe as long as any argument
          // that becomes part of the RESULT is itself safe. Slicing an escaped
          // string can at worst split an entity into inert text.
          if (['substring', 'slice', 'trim', 'trimStart', 'trimEnd', 'toLowerCase', 'toUpperCase', 'repeat', 'normalize'].includes(prop)) {
            return isSafe(callee.object, depth + 1);
          }
          if (['replace', 'replaceAll', 'padStart', 'padEnd'].includes(prop)) {
            // arg[1] is the replacement / pad string; arg[0] (the pattern /
            // target length) never reaches the output.
            return isSafe(callee.object, depth + 1) && isSafe(node.arguments[1], depth + 1);
          }
          if (prop === 'concat') {
            return isSafe(callee.object, depth + 1)
              && node.arguments.every((a) => isSafe(a, depth + 1));
          }
          // Array pipelines compose: .map(fn) yields safe elements when every
          // return in fn is safe (whatever it maps over — elements only feed
          // fn, whose returns are what render); .filter keeps a safe base
          // safe; .join renders base elements plus the separator.
          if (prop === 'map') {
            const fn = node.arguments[0];
            return !!fn
              && (fn.type === 'ArrowFunctionExpression' || fn.type === 'FunctionExpression')
              && returnsOf(fn).every((r) => isSafe(r, depth + 1));
          }
          if (prop === 'filter' || prop === 'reverse' || prop === 'sort' || prop === 'flat') {
            return isSafe(callee.object, depth + 1);
          }
          if (prop === 'join') {
            return isSafe(callee.object, depth + 1) && isSafe(node.arguments[0], depth + 1);
          }
        }
        return false;
      }
      default:
        return false;
    }
  }

  // Walk into the value the way isSafe does and collect the smallest unsafe
  // subexpressions, so the failure names the exact interpolation to fix.
  function unsafeParts(node, depth, out) {
    if (!node || depth > 48 || out.length >= 8) return out;
    if (isSafe(node, depth)) return out;
    const kids = [];
    switch (node.type) {
      case 'TemplateLiteral': kids.push(...node.expressions); break;
      case 'ConditionalExpression': kids.push(node.consequent, node.alternate); break;
      case 'LogicalExpression': case 'BinaryExpression': kids.push(node.left, node.right); break;
      case 'Identifier': {
        const r = resolve(node.__scope, node.name);
        if (r && r.d) kids.push(...r.d.inits.filter((i) => i && i !== OPAQUE));
        if (r && r.writes) kids.push(...r.writes);
        break;
      }
      case 'CallExpression': {
        const callee = node.callee;
        let fn = null;
        if (callee.type === 'Identifier') {
          const r = resolve(callee.__scope, callee.name);
          if (r && r.f && r.f.length === 1) fn = r.f[0];
          if (!fn && r && r.d && r.d.inits.length === 1 && r.d.inits[0]
              && (r.d.inits[0].type === 'ArrowFunctionExpression' || r.d.inits[0].type === 'FunctionExpression')) fn = r.d.inits[0];
        } else if (callee.type === 'ArrowFunctionExpression' || callee.type === 'FunctionExpression') fn = callee;
        else if (callee.type === 'MemberExpression' && !callee.computed && callee.property.name === 'map') fn = node.arguments[0];
        else if (callee.type === 'MemberExpression') kids.push(callee.object, ...node.arguments);
        if (fn) kids.push(...returnsOf(fn));
        break;
      }
      default:
        out.push(node);
        return out;
    }
    const before = out.length;
    for (const k of kids) unsafeParts(k, depth + 1, out);
    if (out.length === before) out.push(node); // opaque: no smaller culprit found
    return out;
  }

  function report(node, what, valueNode) {
    const line = node.loc ? node.loc.start.line : '?';
    failures += 1;
    console.error(`  FAIL: ${label}:${line} — ${what} receives an expression the checker cannot prove inert.`);
    const parts = unsafeParts(valueNode || node, 0, []);
    for (const p of parts.slice(0, 6)) {
      const pl = p.loc ? p.loc.start.line : '?';
      const kind = p.type === 'Identifier' ? `identifier '${p.name}'` : p.type;
      console.error(`        unproven at line ${pl}: ${kind}`);
    }
    console.error('        Wrap interpolations in escHtml()/escAttr(), or build the node via createElement/textContent.');
  }

  walkAst(ast, (n) => {
    if (n.type === 'AssignmentExpression'
        && n.left.type === 'MemberExpression'
        && !n.left.computed
        && n.left.property.type === 'Identifier'
        && SINK_PROPS.has(n.left.property.name)) {
      sinksChecked += 1;
      if (!isSafe(n.right, 0)) report(n, n.left.property.name + ' assignment', n.right);
    } else if (n.type === 'CallExpression'
        && n.callee.type === 'MemberExpression'
        && !n.callee.computed
        && n.callee.property.type === 'Identifier') {
      const prop = n.callee.property.name;
      if (prop === 'insertAdjacentHTML') {
        sinksChecked += 1;
        if (!isSafe(n.arguments[1], 0)) report(n, 'insertAdjacentHTML', n.arguments[1]);
      } else if ((prop === 'write' || prop === 'writeln')
          && n.callee.object.type === 'Identifier'
          && n.callee.object.name === 'document') {
        sinksChecked += 1;
        if (!n.arguments.every((a) => isSafe(a, 0))) report(n, 'document.' + prop);
      }
    }
  });
}

console.log('Checking HTML sinks for unescaped interpolation...');
const files = [];
for (const scope of SCOPES) {
  const stat = fs.statSync(scope);
  if (stat.isDirectory()) files.push(...walkDir(scope));
  else files.push(scope);
}

for (const file of files.filter((f) => f.endsWith('.js') && !f.endsWith('.min.js'))) {
  analyze(fs.readFileSync(file, 'utf8'), path.relative(REPO, file));
}

for (const file of files.filter((f) => f.endsWith('.html'))) {
  const rel = path.relative(REPO, file);
  const { document } = parseHTML(fs.readFileSync(file, 'utf8'));
  let i = 0;
  for (const script of document.querySelectorAll('script')) {
    if (script.getAttribute('src')) continue;
    const code = script.textContent || '';
    if (!code.trim()) continue;
    i += 1;
    analyze(code, `${rel} inline script #${i}`);
  }
}

console.log(`\n${sinksChecked} HTML sink${sinksChecked === 1 ? '' : 's'} checked, ${failures} unsafe.`);
process.exit(failures > 0 ? 1 : 0);
