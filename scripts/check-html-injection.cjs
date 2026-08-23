#!/usr/bin/env node
/**
 * HTML-injection gate for the web/ dashboards.
 *
 * History: every XSS this project has shipped went through the same door —
 * a template literal assigned to innerHTML with an interpolation nobody
 * escaped (v8's onclick="viewFile('${esc(path)}')", the image data_uri, the
 * navigateTo path). The rewrites fixed them by discipline: interpolations must
 * go through escHtml()/escAttr() or be provably inert. Discipline does not
 * survive live-deployed rewrites, so this script makes the rule mechanical.
 *
 * For every web/**;/*.js file and every inline <script> in web/**;/*.html it
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

// Optional argv dir override exists for the test suite's fixtures.
const WEB_DIR = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(__dirname, '..', 'web');
const SAFE_ESCAPES = new Set(['escHtml', 'escAttr']);
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

  // Pass 1: declaration map + reassignment taint. The map is file-global, not
  // scope-aware; when a name is declared more than once (distinct scopes), the
  // identifier is treated safe only if EVERY initializer is safe.
  const decls = new Map(); // name -> { inits: [node...] }
  const reassigned = new Set();
  walkAst(ast, (n) => {
    if (n.type === 'VariableDeclarator' && n.id && n.id.type === 'Identifier') {
      const prev = decls.get(n.id.name);
      if (prev) prev.inits.push(n.init || null);
      else decls.set(n.id.name, { inits: [n.init || null] });
    } else if (n.type === 'AssignmentExpression' && n.left.type === 'Identifier') {
      reassigned.add(n.left.name);
    } else if (n.type === 'UpdateExpression' && n.argument.type === 'Identifier') {
      reassigned.add(n.argument.name);
    }
  });

  function returnsOf(fn) {
    // Arrow with expression body returns that expression.
    if (fn.body && fn.body.type !== 'BlockStatement') return [fn.body];
    const rets = [];
    walkAst(fn.body, (n) => {
      if (n.type === 'ReturnStatement' && n.argument) rets.push(n.argument);
    });
    return rets;
  }

  function isSafe(node, depth) {
    if (!node) return true;
    if (depth > 12) return false;
    switch (node.type) {
      case 'StringLiteral':
      case 'NumericLiteral':
      case 'BooleanLiteral':
      case 'NullLiteral':
        return true;
      case 'TemplateLiteral':
        return node.expressions.every((e) => isSafe(e, depth + 1));
      case 'ParenthesizedExpression':
        return isSafe(node.expression, depth + 1);
      case 'ConditionalExpression':
        return isSafe(node.consequent, depth + 1) && isSafe(node.alternate, depth + 1);
      case 'LogicalExpression':
        // `a && b`: only b renders as markup — falsy a prints '', false, 0, null.
        if (node.operator === '&&') return isSafe(node.right, depth + 1);
        return isSafe(node.left, depth + 1) && isSafe(node.right, depth + 1);
      case 'BinaryExpression':
        return node.operator === '+'
          && isSafe(node.left, depth + 1) && isSafe(node.right, depth + 1);
      case 'UnaryExpression':
        return ['+', '-', '~', '!', 'void', 'typeof'].includes(node.operator);
      case 'Identifier': {
        if (node.name === 'undefined') return true;
        if (reassigned.has(node.name)) return false;
        const d = decls.get(node.name);
        if (!d) return false;
        return d.inits.every((init) => init && isSafe(init, depth + 1));
      }
      case 'CallExpression': {
        const callee = node.callee;
        if (callee.type === 'Identifier') {
          if (SAFE_ESCAPES.has(callee.name)) return true;
          if (callee.name === 'Number') return true;
          return false;
        }
        if (callee.type === 'MemberExpression' && !callee.computed) {
          const prop = callee.property.name;
          // Math.round(...) etc — numbers cannot carry markup.
          if (callee.object.type === 'Identifier' && callee.object.name === 'Math') return true;
          // list.map(fn).join(sep): safe iff every return in fn is safe.
          if (prop === 'join'
              && callee.object.type === 'CallExpression'
              && callee.object.callee.type === 'MemberExpression'
              && !callee.object.callee.computed
              && callee.object.callee.property.name === 'map') {
            const fn = callee.object.arguments[0];
            if (fn && (fn.type === 'ArrowFunctionExpression' || fn.type === 'FunctionExpression')) {
              return returnsOf(fn).every((r) => isSafe(r, depth + 1));
            }
            return false;
          }
          // Chained string ops on a safe base keep safety only for escapes-
          // preserving methods; be conservative: allow .join on safe arrays only
          // via the map rule above, nothing else.
        }
        return false;
      }
      default:
        return false;
    }
  }

  function report(node, what) {
    const line = node.loc ? node.loc.start.line : '?';
    failures += 1;
    console.error(`  FAIL: ${label}:${line} — ${what} receives an expression the checker cannot prove inert.`);
    console.error('        Wrap interpolations in escHtml()/escAttr(), or build the node via createElement/textContent.');
  }

  walkAst(ast, (n) => {
    if (n.type === 'AssignmentExpression'
        && n.left.type === 'MemberExpression'
        && !n.left.computed
        && n.left.property.type === 'Identifier'
        && SINK_PROPS.has(n.left.property.name)) {
      sinksChecked += 1;
      if (!isSafe(n.right, 0)) report(n, n.left.property.name + ' assignment');
    } else if (n.type === 'CallExpression'
        && n.callee.type === 'MemberExpression'
        && !n.callee.computed
        && n.callee.property.type === 'Identifier') {
      const prop = n.callee.property.name;
      if (prop === 'insertAdjacentHTML') {
        sinksChecked += 1;
        if (!isSafe(n.arguments[1], 0)) report(n, 'insertAdjacentHTML');
      } else if ((prop === 'write' || prop === 'writeln')
          && n.callee.object.type === 'Identifier'
          && n.callee.object.name === 'document') {
        sinksChecked += 1;
        if (!n.arguments.every((a) => isSafe(a, 0))) report(n, 'document.' + prop);
      }
    }
  });
}

console.log('Checking web/ HTML sinks for unescaped interpolation...');
const files = walkDir(WEB_DIR);

for (const file of files.filter((f) => f.endsWith('.js'))) {
  analyze(fs.readFileSync(file, 'utf8'), path.relative(WEB_DIR, file));
}

for (const file of files.filter((f) => f.endsWith('.html'))) {
  const rel = path.relative(WEB_DIR, file);
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
