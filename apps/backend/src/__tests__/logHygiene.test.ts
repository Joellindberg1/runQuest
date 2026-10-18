/**
 * Loggrader och HTTP-svar bär aldrig ett rått felmeddelande, ett helt felobjekt eller ett namn/e-postadress.
 *
 * Sentry gör varje `logger.error` till en händelse där strängargument blir `log_detail`, och ett PostgREST-fel kan bära radvärden i
 * sitt meddelande (`duplicate key ... users_email_key`, en e-postadress, en titel). Konventionen: `errorCode(error)` i loggtexten
 * (utils/errorCode.ts), id i stället för namn, och ett generiskt `{ error: '...' }` i svaret (ADR 007).
 *
 * Vakten läser källfilerna som syntaxträd och fäller:
 *  - ett anrop till `logger.error|warn|info|debug` vars argument innehåller `.message`, `.details`, `.hint`, `.stack`, `.email`,
 *    `.username`, `.name` på en person eller grupp (user.name, group.name), en variabel `name`/`email`, eller ett felobjekt (en variabel
 *    som heter error/err/e/..Error, en catch-variabel eller en `.error`-egenskap) som inte går genom `errorCode(...)` eller läses som
 *    `.code`/`.status`. Namn på titel- och händelsemallar är konfiguration och får loggas;
 *  - ett anrop till `.json(...)` vars argument innehåller `.message`, `.details`, `.hint` eller `.stack` från ett fel.
 *
 * Ingår inte: meddelandet i ett kastat `new Error(\`...${error.message}\`)` i tjänsterna. Det loggas aldrig (alla fångstställen loggar
 * `errorCode(...)`), och att ändra dem rör sex testfiler som kontrollerar texten; det är en uppföljning.
 *
 * Skripten i `src/scripts` skriver med console till operatörens terminal och ingår inte (inget av det når loggaggregatorn eller Sentry).
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const SRC = fileURLToPath(new URL('..', import.meta.url));

const LOGGER_METHODS = new Set(['error', 'warn', 'info', 'debug']);
/** Alltid förbjudna i en loggrad. `.name` räknas bara på en person eller grupp (se PERSON_OR_GROUP): en titelmall eller en händelsemall har namn som är konfiguration. */
const LOGGER_FORBIDDEN_PROPERTIES = new Set(['message', 'details', 'hint', 'stack', 'email', 'username']);
const PERSON_OR_GROUP = /^(user|users|u|me|member|members|owner|athlete|group|profile|author|newUser|winner|loser|challenger|opponent|runner|\w+User|\w+Member)$/;
/** Variabler som bär en persons namn eller e-post. */
const PERSONAL_IDENTIFIERS = new Set(['name', 'email', 'username', 'userName', 'displayName']);
const RESPONSE_FORBIDDEN_PROPERTIES = new Set(['message', 'details', 'hint', 'stack']);
const ERRORISH = /^(e|err|error|exception|cause)$|(Err|Error)$/;
/** Funktioner som gör ett fel till en kort kod eller ett namn (utils/errorCode.ts och de små hjälparna i Strava-filerna). */
const SAFE_WRAPPERS = new Set(['errorCode', 'errorName', 'shortCode']);
/** Läsningar av ett felobjekt som är säkra: `error.code`, `error.status`. */
const SAFE_ERROR_PROPERTIES = new Set(['code', 'status']);

/**
 * Filer som får vänta, med motivering. RUN-311 (ej mergad) skriver om routes/strava.ts; dess loggrader bär fortfarande användarnamn
 * (`req.user!.name`, `user.users.name`) och `error.name`. Raden tas bort här när RUN-311 är mergad och raderna är rättade.
 */
const EXEMPT_FILES: Record<string, string> = {
  'routes/strava.ts': 'RUN-311 rewrites this file; its log lines still carry user names',
};

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry === '__tests__' || entry === 'scripts' || entry === 'test-utils') continue;
      out.push(...sourceFiles(path));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts') && !entry.endsWith('.d.ts')) {
      out.push(path);
    }
  }
  return out;
}

function isLoggerCall(node: ts.CallExpression): boolean {
  const callee = node.expression;
  return ts.isPropertyAccessExpression(callee)
    && ts.isIdentifier(callee.expression)
    && callee.expression.text === 'logger'
    && LOGGER_METHODS.has(callee.name.text);
}

function isJsonCall(node: ts.CallExpression): boolean {
  const callee = node.expression;
  return ts.isPropertyAccessExpression(callee) && callee.name.text === 'json';
}

function catchVariables(file: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isCatchClause(node) && node.variableDeclaration && ts.isIdentifier(node.variableDeclaration.name)) {
      names.add(node.variableDeclaration.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return names;
}

/** Sista namnet i ett uttryck: `req.user!` ger `user`, `user.users` ger `users`, `group` ger `group`. */
function lastNameOf(expression: ts.Expression): string {
  let e: ts.Expression = expression;
  while (ts.isNonNullExpression(e) || ts.isParenthesizedExpression(e) || ts.isAsExpression(e)) e = e.expression;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  if (ts.isIdentifier(e)) return e.text;
  return '';
}

/** Är identifieraren en säker användning av ett felobjekt (kod eller status, `errorCode(...)`, ett villkor)? */
function isSafeErrorUse(node: ts.Node): boolean {
  const parent = node.parent;
  if (ts.isCallExpression(parent) && ts.isIdentifier(parent.expression) && SAFE_WRAPPERS.has(parent.expression.text)) return true;
  if (ts.isPropertyAccessExpression(parent) && parent.expression === node && SAFE_ERROR_PROPERTIES.has(parent.name.text)) return true;
  if (ts.isConditionalExpression(parent) && parent.condition === node) return true;
  if (ts.isPrefixUnaryExpression(parent)) return true;
  if (ts.isBinaryExpression(parent) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.InstanceOfKeyword, ts.SyntaxKind.AmpersandAmpersandToken].includes(parent.operatorToken.kind) && parent.left === node) return true;
  // `errorCode(byName.error ?? byEmail.error)`, `errorCode(x!)`, `errorCode((e))`: säkert om hela uttrycket ligger i ett säkert anrop.
  if (ts.isNonNullExpression(parent) || ts.isParenthesizedExpression(parent)) return isSafeErrorUse(parent);
  if (ts.isBinaryExpression(parent) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(parent.operatorToken.kind)) return isSafeErrorUse(parent);
  if (ts.isConditionalExpression(parent) && parent.condition !== node) return isSafeErrorUse(parent);
  return false;
}

function violationsIn(file: ts.SourceFile, text: string): string[] {
  const catchNames = catchVariables(file);
  const found: string[] = [];
  const where = (node: ts.Node): string => `${file.getLineAndCharacterOfPosition(node.getStart()).line + 1}: ${text.slice(node.getStart(), node.getEnd()).replace(/\s+/g, ' ').slice(0, 110)}`;

  const inspectLogger = (arg: ts.Node): void => {
    // Parametrar till funktioner inuti argumentet (`entries.map((e) => e.type)`) är inte felvariabler.
    const shadowed = new Set<string>();
    const collectParameters = (node: ts.Node): void => {
      if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
        for (const p of node.parameters) if (ts.isIdentifier(p.name)) shadowed.add(p.name.text);
      }
      ts.forEachChild(node, collectParameters);
    };
    collectParameters(arg);
    const isErrorName = (name: string): boolean => !shadowed.has(name) && (ERRORISH.test(name) || catchNames.has(name));

    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAccessExpression(node)) {
        const property = node.name.text;
        if (LOGGER_FORBIDDEN_PROPERTIES.has(property) || (property === 'name' && PERSON_OR_GROUP.test(lastNameOf(node.expression)))) {
          found.push(`logger: .${property} in ${where(node)}`);
        } else if (ERRORISH.test(property) && !isSafeErrorUse(node)) found.push(`logger: error object .${property} in ${where(node)}`);
      } else if (ts.isShorthandPropertyAssignment(node)) {
        if (isErrorName(node.name.text) || PERSONAL_IDENTIFIERS.has(node.name.text)) found.push(`logger: error object or name { ${node.name.text} } in ${where(node)}`);
      } else if (ts.isIdentifier(node)) {
        const parent = node.parent;
        const isKeyOrMember = (ts.isPropertyAssignment(parent) && parent.name === node)
          || (ts.isPropertyAccessExpression(parent) && parent.name === node)
          || ts.isShorthandPropertyAssignment(parent);
        if (!isKeyOrMember && PERSONAL_IDENTIFIERS.has(node.text) && !shadowed.has(node.text)) found.push(`logger: name or e-mail ${node.text} in ${where(node)}`);
        else if (!isKeyOrMember && isErrorName(node.text) && !isSafeErrorUse(node)) found.push(`logger: error object ${node.text} in ${where(node)}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(arg);
  };

  const inspectResponse = (arg: ts.Node): void => {
    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAccessExpression(node) && RESPONSE_FORBIDDEN_PROPERTIES.has(node.name.text) && ts.isIdentifier(node.expression) && (ERRORISH.test(node.expression.text) || catchNames.has(node.expression.text))) {
        found.push(`response: ${node.name.text} of an error in ${where(node)}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(arg);
  };

  const walk = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      if (isLoggerCall(node)) node.arguments.forEach(inspectLogger);
      else if (isJsonCall(node)) node.arguments.forEach(inspectResponse);
    }
    ts.forEachChild(node, walk);
  };
  walk(file);
  return found;
}

function scan(source: string, name = 'sample.ts'): string[] {
  return violationsIn(ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true), source);
}

describe('the log hygiene guard itself', () => {
  it.each([
    ["logger.error('x:', error.message)"],
    ["logger.error('x:', error)"],
    ["try {} catch (boom) { logger.error('x', boom); }"],
    ["logger.error('x', { error, userId })"],
    ["logger.error('x', { error: updateError })"],
    ["logger.warn(`x ${res.error}`)"],
    ["logger.info(`Login successful for user: ${user.name}`)"],
    ["logger.info(`Creating user: ${name} ${email}`, user.email)"],
    ["logger.error('x', err instanceof Error ? err.message : 'y')"],
    ["res.status(500).json({ error: 'x', message: error instanceof Error ? error.message : 'Unknown error' })"],
    ["res.status(500).json({ details: err.message })"],
    ["logger.info(`group ${group.name}`)"],
    ["logger.info(`Looking up ${req.user!.name}`)"],
    ["logger.error('x', { error: error ?? 'user not found', userId })"],
    ["logger.error(`x ${err}`)"],
  ])('flags %s', (source) => {
    expect(scan(source).length).toBeGreaterThan(0);
  });

  it.each([
    ["logger.error(`x (${errorCode(error)})`)"],
    ["logger.error(`x (${error ? errorCode(error) : 'no row'})`)"],
    ["logger.error(`x (${error.code ?? 'no code'})`)"],
    ["logger.error('x', { code: error.code ?? null, userId })"],
    ["logger.error('x', new CriticalAlert('token_write'))"],
    ["logger.info(`User ${userId} did ${count} things`)"],
    ["logger.error(`x (${errorCode(byName.error ?? byEmail.error)})`)"],
    ["logger.error('x', { types: entries.map((e) => e.type) })"],
    ["logger.info(`Daily roll: \"${picked.name}\" selected`)"],
    ["logger.info(`Checking title ${title.name}`)"],
    ["res.status(500).json({ error: 'Failed to fetch titles' })"],
    ["res.json({ success: true, message: 'Password changed successfully' })"],
  ])('lets %s through', (source) => {
    expect(scan(source)).toEqual([]);
  });
});

describe('log hygiene in apps/backend/src', () => {
  const files = sourceFiles(SRC).map((path) => ({ path, rel: relative(SRC, path).split(sep).join('/') }));

  it('scans the source tree', () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((f) => f.rel === 'middleware/admin.ts')).toBe(true);
  });

  it('keeps the exemptions pointing at files that exist', () => {
    for (const rel of Object.keys(EXEMPT_FILES)) expect(files.some((f) => f.rel === rel), rel).toBe(true);
  });

  it('logs no raw error message, error object, name or e-mail and returns no error message', () => {
    const violations: string[] = [];
    for (const { path, rel } of files) {
      if (rel in EXEMPT_FILES) continue;
      const text = readFileSync(path, 'utf8');
      for (const v of violationsIn(ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true), text)) violations.push(`${rel}:${v}`);
    }
    expect(violations).toEqual([]);
  });
});
