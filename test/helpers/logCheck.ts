import ts from 'typescript';

/**
 * AST check for server logging. A log argument may only be a value that cannot
 * carry a whole error, object, request, response or identifier:
 * string/number literals, templates of safe parts, `.name` / `.status` / `.code`
 * / `.length` reads, `Number(...)`, conditionals of safe branches, and
 * (JSON.stringify of) object literals whose values are all safe.
 * Nothing else: no bare identifiers, no `.message` / `.stack`, no spread.
 */

const SAFE_PROPS = new Set(['status', 'code', 'length', 'upstreamStatus']);
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

function isConsole(node: ts.Node): boolean {
  return ts.isIdentifier(node) && node.text === 'console';
}

function isWrapperCallee(c: ts.Expression): boolean {
  if (ts.isIdentifier(c)) return WRAPPER_NAME.test(c.text);
  if (ts.isPropertyAccessExpression(c)) {
    if (WRAPPER_NAME.test(c.name.text)) return true;
    return ts.isIdentifier(c.expression) && c.expression.text === 'logger';
  }
  return false;
}

export function findLogViolations(source: string, fileName = 'x.ts'): string[] {
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
      if (isConsoleCall || isWrapperCallee(c)) {
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
