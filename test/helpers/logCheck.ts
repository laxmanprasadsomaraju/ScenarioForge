import ts from 'typescript';

/**
 * AST check for server logging. A log argument may only be a value that cannot
 * carry a whole error, object, request, response or identifier:
 * string/number literals, templates of safe parts, `.name` / `.status` / `.code`
 * / `.length` reads, `Number(...)`, conditionals of safe branches, and
 * (JSON.stringify of) object literals whose values are all safe.
 * Nothing else: no bare identifiers, no `.message` / `.stack`, no spread.
 */

/** `.length` is a number on anything. */
const SAFE_PROPS = new Set(['length']);
/** `.status` / `.code` / `.upstreamStatus` only on an error or response, never on `user.code`. */
const STATUS_PROPS = new Set(['status', 'code', 'upstreamStatus']);
const ERROR_OR_RESPONSE = /^(e|err|error|cause|reason|res|resp|response)$/;
/** `.name` is safe only on an error-like identifier; `user.name` is a display name. */
const ERROR_LIKE = /^(e|err|error|cause|reason)$/;
const CONSOLE_METHODS = /^(log|info|warn|error|debug|trace|dir|table|assert)$/;
const WRAPPER_NAME = /^(log\w*|logger|warn|report\w*|trace|debug)$/i;

function isSafe(node: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node))
    return isSafe(node.expression);
  if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return isSafe(node.expression);
  if (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isNumericLiteral(node)
  )
    return true;
  if (
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword ||
    node.kind === ts.SyntaxKind.NullKeyword
  )
    return true;
  if (ts.isTemplateExpression(node)) return node.templateSpans.every((s) => isSafe(s.expression));
  if (ts.isPropertyAccessExpression(node)) {
    if (node.name.text === 'name') {
      const o = node.expression;
      return ts.isIdentifier(o) && ERROR_LIKE.test(o.text);
    }
    if (STATUS_PROPS.has(node.name.text)) return isErrorOrResponse(node.expression);
    return SAFE_PROPS.has(node.name.text);
  }
  if (ts.isConditionalExpression(node)) return isSafe(node.whenTrue) && isSafe(node.whenFalse);
  if (ts.isBinaryExpression(node)) {
    const k = node.operatorToken.kind;
    if (k === ts.SyntaxKind.QuestionQuestionToken || k === ts.SyntaxKind.BarBarToken)
      return isSafe(node.left) && isSafe(node.right);
    return false;
  }
  if (ts.isCallExpression(node)) {
    const c = node.expression;
    if (ts.isIdentifier(c) && c.text === 'Number' && node.arguments.length === 1) return true;
    if (
      ts.isPropertyAccessExpression(c) &&
      ts.isIdentifier(c.expression) &&
      c.expression.text === 'JSON' &&
      c.name.text === 'stringify'
    )
      return node.arguments.length === 1 && isSafe(node.arguments[0]!);
    return false;
  }
  if (ts.isObjectLiteralExpression(node))
    return node.properties.every(
      (p) =>
        ts.isPropertyAssignment(p) && !ts.isComputedPropertyName(p.name) && isSafe(p.initializer),
    );
  return false;
}

/** `error`, `s.error`, `this.response`, `result?.error`: last name segment is error/response-like. */
function isErrorOrResponse(node: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node))
    return isErrorOrResponse(node.expression);
  if (ts.isIdentifier(node)) return ERROR_OR_RESPONSE.test(node.text);
  if (ts.isPropertyAccessExpression(node)) return ERROR_OR_RESPONSE.test(node.name.text);
  return false;
}

function isConsole(node: ts.Node): boolean {
  return ts.isIdentifier(node) && node.text === 'console';
}

function isWrapperCallee(c: ts.Expression, extra: ReadonlySet<string>): boolean {
  if (ts.isIdentifier(c)) return WRAPPER_NAME.test(c.text) || extra.has(c.text);
  if (ts.isPropertyAccessExpression(c)) {
    if (WRAPPER_NAME.test(c.name.text) || extra.has(c.name.text)) return true;
    return ts.isIdentifier(c.expression) && c.expression.text === 'logger';
  }
  return false;
}

/** True when `node` passes one of `params` (or something read from it) straight through. */
function forwardsParam(node: ts.Expression, params: ReadonlySet<string>): boolean {
  if (ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node))
    return forwardsParam(node.expression, params);
  if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node))
    return forwardsParam(node.expression, params);
  if (ts.isSpreadElement(node)) return forwardsParam(node.expression, params);
  if (ts.isIdentifier(node)) return params.has(node.text);
  if (ts.isPropertyAccessExpression(node)) {
    if (node.name.text === 'length') return false;
    return forwardsParam(node.expression, params);
  }
  if (ts.isElementAccessExpression(node)) return forwardsParam(node.expression, params);
  if (ts.isTemplateExpression(node))
    return node.templateSpans.some((t) => forwardsParam(t.expression, params));
  if (ts.isBinaryExpression(node))
    return forwardsParam(node.left, params) || forwardsParam(node.right, params);
  if (ts.isConditionalExpression(node))
    return forwardsParam(node.whenTrue, params) || forwardsParam(node.whenFalse, params);
  if (ts.isCallExpression(node)) {
    if (ts.isIdentifier(node.expression) && node.expression.text === 'Number') return false;
    return node.arguments.some((a) => forwardsParam(a, params));
  }
  if (ts.isObjectLiteralExpression(node))
    return node.properties.some((p) =>
      ts.isShorthandPropertyAssignment(p)
        ? params.has(p.name.text)
        : ts.isPropertyAssignment(p)
          ? forwardsParam(p.initializer, params)
          : ts.isSpreadAssignment(p) && forwardsParam(p.expression, params),
    );
  return false;
}

/**
 * Names of functions (declarations, `const f = () =>`, methods, object members)
 * that merely forward a parameter to `console.*`. A call to such a function is
 * a log call even when its name does not look like one.
 */
export function findForwarders(source: string, fileName = 'x.ts'): Set<string> {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const names = new Set<string>();
  const check = (name: string | undefined, fn: ts.FunctionLikeDeclaration) => {
    if (!name || !fn.body) return;
    const params = new Set<string>();
    for (const p of fn.parameters) if (ts.isIdentifier(p.name)) params.add(p.name.text);
    if (params.size === 0) return;
    const walk = (n: ts.Node): void => {
      if (ts.isCallExpression(n)) {
        const c = n.expression;
        if (
          (ts.isPropertyAccessExpression(c) && isConsole(c.expression)) ||
          isWrapperCallee(c, new Set())
        ) {
          if (n.arguments.some((a) => forwardsParam(a, params))) names.add(name);
        }
      }
      ts.forEachChild(n, walk);
    };
    walk(fn.body);
  };
  const visit = (n: ts.Node): void => {
    if (ts.isFunctionDeclaration(n)) check(n.name?.text, n);
    else if (ts.isMethodDeclaration(n) && ts.isIdentifier(n.name)) check(n.name.text, n);
    else if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.initializer &&
      (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))
    )
      check(n.name.text, n.initializer);
    else if (
      ts.isPropertyAssignment(n) &&
      ts.isIdentifier(n.name) &&
      (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))
    )
      check(n.name.text, n.initializer);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return names;
}

export function findLogViolations(
  source: string,
  fileName = 'x.ts',
  extraWrappers: ReadonlySet<string> = new Set(),
): string[] {
  const extra = new Set([...extraWrappers, ...findForwarders(source, fileName)]);
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const at = (n: ts.Node, why: string) => {
    const { line } = sf.getLineAndCharacterOfPosition(n.getStart(sf));
    out.push(`${fileName}:${line + 1} ${why}`);
  };
  const visit = (node: ts.Node): void => {
    // Any reference to `console` that is not `console.<method>(...)` is an alias.
    if (isConsole(node)) {
      const p = node.parent;
      const isCallTarget =
        p &&
        ts.isPropertyAccessExpression(p) &&
        p.expression === node &&
        CONSOLE_METHODS.test(p.name.text) &&
        p.parent &&
        ts.isCallExpression(p.parent) &&
        p.parent.expression === p;
      if (!isCallTarget) at(node, 'console used other than as a direct call');
    }
    if (ts.isCallExpression(node)) {
      const c = node.expression;
      const isConsoleCall = ts.isPropertyAccessExpression(c) && isConsole(c.expression);
      if (isConsoleCall || isWrapperCallee(c, extra)) {
        for (const arg of node.arguments) {
          if (!isSafe(arg)) at(arg, `unsafe log argument: ${arg.getText(sf).slice(0, 60)}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}
