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
 *    som heter error/err/e/..Error, en catch-variabel eller en `.error`-egenskap) som inte går genom `errorCode(...)`. Koden läses
 *    ALDRIG direkt (`error.code`, `error.code ?? 'unknown'`): supabase-js ger `code: ''` vid nätverksfel, så en direkt läsning ger
 *    "(code )" eller "(unknown)", medan `errorCode(...)` ger orsakens kod. Bara `.status` får läsas rakt. Namn på titel- och
 *    händelsemallar är konfiguration och får loggas;
 *  - en handskriven kodreserv var som helst: `x.code ?? 'literal'` eller `x.code || 'literal'`;
 *  - `.toString()` på ett fel (loggrad, svar, kastat fel);
 *  - ett anrop till `.json(...)` vars argument innehåller `.message`, `.details`, `.hint` eller `.stack` från ett fel;
 *  - ett kastat fel (`new Error(...)`, `new TypeError(...)`) eller en samlad felrad (`failures.push(...)`) som bär databasens text:
 *    `${error.message}`, `${error}`, `JSON.stringify(error)` eller `String(error)`. Ett kastat fel har ett fast meddelande (vad som
 *    misslyckades plus id) och databasens kod i `code` (`errorWithCode(...)` i utils/errorCode.ts); texten får inte ligga i
 *    meddelandet, för då hänger skyddet på att varje fångställe kommer ihåg att logga koden.
 *
 *    Gäller också `Object.assign(new Error(..), { code })` och samlare som heter failures/errors/errs/issues/problems/failed*.
 *
 * Vad vakten INTE fångar (ett syntaxträd följer inte data): en mellanvariabel (`const text = error.message; logger.error(text)`),
 * en samlare med ett annat namn, ett rått `throw error` av ett databasfel (felet kastas då som ett objekt med text, men ingen
 * sträng byggs av det), och text som byggs i en hjälpfunktion som får felet som argument. Där hjälper bara granskning.
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
const CONSOLE_METHODS = new Set(['error', 'warn', 'info', 'debug', 'log']);
/** Den enda filen som får skriva till console och som äger loggern. */
const LOGGER_FILE = 'utils/logger.ts';
/** Alltid förbjudna i en loggrad. `.name` räknas bara på en person eller grupp (se PERSON_OR_GROUP): en titelmall eller en händelsemall har namn som är konfiguration. */
const LOGGER_FORBIDDEN_PROPERTIES = new Set(['message', 'details', 'hint', 'stack', 'email', 'username']);
const PERSON_OR_GROUP = /^(user|users|u|me|member|members|owner|athlete|group|profile|author|newUser|winner|loser|challenger|opponent|runner|\w+User|\w+Member)$/;
/** Variabler som bär en persons namn eller e-post. */
const PERSONAL_IDENTIFIERS = new Set(['name', 'email', 'username', 'userName', 'displayName']);
const RESPONSE_FORBIDDEN_PROPERTIES = new Set(['message', 'details', 'hint', 'stack', 'toString']);
const ERRORISH = /^(e|err|error|exception|cause)$|(Err|Error)$/;
/** Funktioner som gör ett fel till en kort kod eller ett namn (utils/errorCode.ts och de små hjälparna i Strava-filerna). */
const SAFE_WRAPPERS = new Set(['errorCode', 'errorName', 'shortCode']);
/** Egna felklasser som tar ett databasfel som argument men bara behåller dess kod (`errorCode(source)`), aldrig texten eller objektet. */
const SAFE_ERROR_CLASSES = new Set(['BadgeReadError', 'MembershipError']);
/** Läsningar av ett felobjekt som är säkra: `error.code`, `error.status`. */
const SAFE_ERROR_PROPERTIES = new Set(['code', 'status']);

/** Filer som får vänta, med motivering. Tom: inga undantag. Varje rad här kräver en motivering och en ticket som tar bort den. */
const EXEMPT_FILES: Record<string, string> = {};

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

/** `logger.error(...)` och `console.error(...)`: samma regler, console når Railway-loggen lika väl. */
function isLoggerCall(node: ts.CallExpression): boolean {
  const callee = node.expression;
  return ts.isPropertyAccessExpression(callee)
    && ts.isIdentifier(callee.expression)
    && ((callee.expression.text === 'logger' && LOGGER_METHODS.has(callee.name.text))
      || (callee.expression.text === 'console' && CONSOLE_METHODS.has(callee.name.text)));
}

/** `res.json(...)` och `res.send(...)`. */
function isResponseCall(node: ts.CallExpression): boolean {
  const callee = node.expression;
  return ts.isPropertyAccessExpression(callee) && (callee.name.text === 'json' || callee.name.text === 'send');
}

/** `new Error(..)`, `new TypeError(..)`, `new WebhookHealthReadError(..)`: a constructor named ...Error. */
function isErrorConstructor(node: ts.NewExpression): boolean {
  return ts.isIdentifier(node.expression) && /Error$/.test(node.expression.text) && !SAFE_ERROR_CLASSES.has(node.expression.text);
}

/** Tar bort parentes, `as`, `!` (och `<T>x`) runt ett uttryck: `(error as Error)` blir `error`. */
function unwrap(expression: ts.Expression): ts.Expression {
  let e = expression;
  while (ts.isNonNullExpression(e) || ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isTypeAssertionExpression(e) || ts.isSatisfiesExpression(e)) e = e.expression;
  return e;
}

/**
 * Är `logger` (utom i sin egen fil) något annat än `logger.<metod>(...)`? `const log = logger`, `const { error } = logger`,
 * `.forEach(logger.error)`, `logger['error'](...)` och `foo(logger)` går förbi anropsmönstret som resten av vakten läser.
 */
function loggerAliases(file: ts.SourceFile): ts.Node[] {
  const found: ts.Node[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === 'logger') {
      const parent = node.parent;
      const isImport = ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent);
      const isMemberName = (ts.isPropertyAccessExpression(parent) && parent.name === node) || (ts.isPropertyAssignment(parent) && parent.name === node);
      const isPlainCall = ts.isPropertyAccessExpression(parent) && parent.expression === node
        && ts.isCallExpression(parent.parent) && parent.parent.expression === parent && LOGGER_METHODS.has(parent.name.text);
      if (!isImport && !isMemberName && !isPlainCall) found.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
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
  const e = unwrap(expression);
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  if (ts.isIdentifier(e)) return e.text;
  return '';
}

/** `Object.assign(new Error(..), { code: .. })`: koden på ett kastat fel. */
function isObjectAssignOnError(node: ts.CallExpression): boolean {
  const callee = node.expression;
  const first = node.arguments[0] ? unwrap(node.arguments[0]) : undefined;
  return ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === 'Object' && callee.name.text === 'assign'
    && first !== undefined && ts.isNewExpression(first) && ts.isIdentifier(first.expression) && /Error$/.test(first.expression.text);
}

/** `failures.push(..)`, `payoutFailures.push(..)`, `postClaimErrors.push(..)`: rader som sedan sätts ihop till ett kastat meddelande. */
function isFailureCollector(node: ts.CallExpression): boolean {
  const callee = node.expression;
  return ts.isPropertyAccessExpression(callee) && callee.name.text === 'push'
    && /(failures?|errors?|errs?|issues?|problems?|failed\w*)$/i.test(lastNameOf(callee.expression));
}

/** Är identifieraren en säker användning av ett felobjekt (kod eller status, `errorCode(...)`, ett villkor)? */
function isSafeErrorUse(node: ts.Node, allowCode = false): boolean {
  const parent = node.parent;
  if (ts.isCallExpression(parent) && ts.isIdentifier(parent.expression) && SAFE_WRAPPERS.has(parent.expression.text)) return true;
  if (ts.isPropertyAccessExpression(parent) && parent.expression === node && SAFE_ERROR_PROPERTIES.has(parent.name.text) && (allowCode || parent.name.text !== 'code')) return true;
  if (ts.isConditionalExpression(parent) && parent.condition === node) return true;
  if (ts.isPrefixUnaryExpression(parent)) return true;
  if (ts.isBinaryExpression(parent) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.InstanceOfKeyword, ts.SyntaxKind.AmpersandAmpersandToken].includes(parent.operatorToken.kind) && parent.left === node) return true;
  // `errorCode(byName.error ?? byEmail.error)`, `errorCode(x!)`, `errorCode((e))`: säkert om hela uttrycket ligger i ett säkert anrop.
  if (ts.isNonNullExpression(parent) || ts.isParenthesizedExpression(parent)) return isSafeErrorUse(parent, allowCode);
  if (ts.isBinaryExpression(parent) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(parent.operatorToken.kind)) return isSafeErrorUse(parent, allowCode);
  if (ts.isConditionalExpression(parent) && parent.condition !== node) return isSafeErrorUse(parent, allowCode);
  return false;
}

function violationsIn(file: ts.SourceFile, text: string, rel: string): string[] {
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
        const base = unwrap(node.expression);
        const baseIsError = (ts.isIdentifier(base) && isErrorName(base.text)) || (ts.isPropertyAccessExpression(base) && ERRORISH.test(base.name.text));
        if (LOGGER_FORBIDDEN_PROPERTIES.has(property) || (property === 'name' && PERSON_OR_GROUP.test(lastNameOf(node.expression))) || (property === 'toString' && baseIsError)) {
          found.push(`logger: .${property} in ${where(node)}`);
        } else if (ERRORISH.test(property) && !isSafeErrorUse(node)) found.push(`logger: error object .${property} in ${where(node)}`);
      } else if (ts.isShorthandPropertyAssignment(node)) {
        if (isErrorName(node.name.text) || PERSONAL_IDENTIFIERS.has(node.name.text)) found.push(`logger: error object or name { ${node.name.text} } in ${where(node)}`);
      } else if (ts.isIdentifier(node)) {
        const parent = node.parent;
        const isKeyOrMember = (ts.isPropertyAssignment(parent) && parent.name === node)
          || (ts.isPropertyAccessExpression(parent) && parent.name === node)
          || ts.isShorthandPropertyAssignment(parent)
          || ts.isTypeReferenceNode(parent); // typnamnet i "satisfies ApiError" är inget felvärde
        if (!isKeyOrMember && PERSONAL_IDENTIFIERS.has(node.text) && !shadowed.has(node.text)) found.push(`logger: name or e-mail ${node.text} in ${where(node)}`);
        else if (!isKeyOrMember && isErrorName(node.text) && !isSafeErrorUse(node)) found.push(`logger: error object ${node.text} in ${where(node)}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(arg);
  };

  /** Ett svar bär varken felets text (`.message`, `.details`, ..) eller felobjektet självt (`res.json(error)`, `String(error)`, `${error}`). */
  const inspectResponse = (arg: ts.Node): void => {
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
        const base = unwrap(node.expression);
        if (RESPONSE_FORBIDDEN_PROPERTIES.has(node.name.text) && ts.isIdentifier(base) && isErrorName(base.text)) {
          found.push(`response: ${node.name.text} of an error in ${where(node)}`);
        }
      } else if (ts.isShorthandPropertyAssignment(node)) {
        if (isErrorName(node.name.text)) found.push(`response: error object { ${node.name.text} } in ${where(node)}`);
      } else if (ts.isIdentifier(node)) {
        const parent = node.parent;
        const isKeyOrMember = (ts.isPropertyAssignment(parent) && parent.name === node)
          || (ts.isPropertyAccessExpression(parent) && parent.name === node)
          || ts.isShorthandPropertyAssignment(parent)
          || ts.isTypeReferenceNode(parent); // typnamnet i "satisfies ApiError" är inget felvärde
        if (!isKeyOrMember && isErrorName(node.text) && !isSafeErrorUse(node, true)) found.push(`response: error object ${node.text} in ${where(node)}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(arg);
  };

  /** Ett kastat fel eller en samlad felrad bär aldrig felets text eller felobjektet i sin sträng. */
  const inspectThrown = (arg: ts.Node, what: string): void => {
    const shadowed = new Set<string>();
    const collectParameters = (node: ts.Node): void => {
      if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
        for (const p of node.parameters) if (ts.isIdentifier(p.name)) shadowed.add(p.name.text);
      }
      ts.forEachChild(node, collectParameters);
    };
    collectParameters(arg);
    const isErrorName = (name: string): boolean => !shadowed.has(name) && name !== 'Error' && (ERRORISH.test(name) || catchNames.has(name));
    /** `error`, `usedError`, `res.error`, `failedUpdates[0].error!`. */
    const isErrorExpression = (expression: ts.Expression): boolean => {
      const base = unwrap(expression);
      if (ts.isIdentifier(base)) return isErrorName(base.text);
      return ts.isPropertyAccessExpression(base) && ERRORISH.test(base.name.text);
    };

    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAccessExpression(node)) {
        if (RESPONSE_FORBIDDEN_PROPERTIES.has(node.name.text) && isErrorExpression(node.expression)) {
          found.push(`${what}: .${node.name.text} of an error in ${where(node)}`);
        }
      } else if (ts.isIdentifier(node)) {
        const parent = node.parent;
        const isKeyOrMember = (ts.isPropertyAssignment(parent) && parent.name === node)
          || (ts.isPropertyAccessExpression(parent) && parent.name === node)
          || ts.isShorthandPropertyAssignment(parent)
          || ts.isTypeReferenceNode(parent)
          || (ts.isPropertyAccessExpression(parent) && parent.expression === node && RESPONSE_FORBIDDEN_PROPERTIES.has(parent.name.text)); // `error.message` is reported by the property branch above
        if (!isKeyOrMember && isErrorName(node.text) && !isSafeErrorUse(node)) found.push(`${what}: error object ${node.text} in ${where(node)}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(arg);
  };

  const walk = (node: ts.Node): void => {
    // `error.code ?? 'unknown'`, `error?.code || 'no code'`: en handskriven errorCode. supabase-js ger `code: ''` vid nätverksfel (inte
    // undefined), så `??` släpper igenom den tomma koden och loggen visar "(code )". Vägen är errorCode(error) i utils/errorCode.ts.
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(node.operatorToken.kind)) {
      const left = unwrap(node.left);
      const right = unwrap(node.right);
      if (ts.isPropertyAccessExpression(left) && left.name.text === 'code' && (ts.isStringLiteral(right) || ts.isNoSubstitutionTemplateLiteral(right))) {
        found.push(`hand-written code fallback (use errorCode) in ${where(node)}`);
      }
    }
    if (ts.isCallExpression(node)) {
      if (isLoggerCall(node)) node.arguments.forEach(inspectLogger);
      else if (isResponseCall(node)) node.arguments.forEach(inspectResponse);
      else if (isFailureCollector(node)) node.arguments.forEach((arg) => inspectThrown(arg, 'collected failure'));
      else if (isObjectAssignOnError(node)) node.arguments.slice(1).forEach((arg) => inspectThrown(arg, 'thrown error code'));
    } else if (ts.isNewExpression(node) && isErrorConstructor(node)) {
      node.arguments?.forEach((arg) => inspectThrown(arg, 'thrown error'));
    }
    ts.forEachChild(node, walk);
  };
  if (rel !== LOGGER_FILE) {
    walk(file);
    for (const alias of loggerAliases(file)) found.push(`logger: alias or non-call use of logger in ${where(alias.parent ?? alias)}`);
  }
  return found;
}

function scan(source: string, name = 'sample.ts'): string[] {
  return violationsIn(ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true), source, name);
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
    // Svar: parentes, as, ! och ?. ger samma träff som en rak läsning
    ["res.status(500).json({ error: (error as Error).message })"],
    ["res.status(500).json({ error: error?.message })"],
    ["res.status(500).json({ error: (err as any)!.message })"],
    ["res.status(500).json({ error: (error as { details: string }).details })"],
    // Svar: send, hela felobjektet, String(error) och mallsträng
    ["res.status(500).send(error.message)"],
    ["res.status(500).send(error)"],
    ["res.json(error)"],
    ["res.status(500).json({ error: String(error) })"],
    // satisfies döljer inget: en läcka i ett typat svar fälls lika
    ["res.status(500).json({ error: error.message } satisfies ApiError)"],
    ["res.status(500).json({ error: String(error) } satisfies ApiError)"],
    ["logger.error('x', error as ApiError)"],
    ["res.status(500).json({ error: `Failed: ${error}` })"],
    ["try {} catch (boom) { res.status(500).json({ boom }); }"],
    // console i src går lika illa till Railway-loggen
    ["console.error('x', error)"],
    ["console.warn(error.message)"],
    ["console.log(`Login for ${user.name}`)"],
    // alias och destrukturering av logger går förbi anropsmönstret
    ["const log = logger; log.error('x', error);"],
    ["const { error: logError } = logger;"],
    ["const { error } = logger;"],
    ["const write = logger.error;"],
    ["[1].forEach(logger.error);"],
    ["logger['error']('x', err);"],
    ["doSomething(logger);"],
    // kastade fel och samlade felrader bär inte databasens text
    ["throw new Error(`Failed to fetch runs (user ${userId}): ${error.message}`)"],
    ["if (usedError) throw new Error(`Failed: ${usedError.message}`)"],
    ["throw new Error(`Failed to recalculate titles: ${error}`)"],
    ["throw new Error(error.message)"],
    ["try {} catch (e) { throw new Error(`x: ${e instanceof Error ? e.message : String(e)}`); }"],
    ["throw new Error(`x: ${failedUpdates[0].error!.message}`)"],
    ["throw new Error(`read failed: ${JSON.stringify(error ?? 'user not found')}`)"],
    ["throw new TypeError(`x ${res.error.details}`)"],
    ["failures.push(`increment_event_xp failed: ${xpErr.message}`)"],
    ["postClaimErrors.push(`reset failed: ${res.error.message}`)"],
    // koden läses med errorCode(...), aldrig direkt: supabase-js ger code '' vid nätverksfel, och `??` släpper igenom den
    ["logger.error(`x (${error.code ?? 'no code'})`)"],
    ["logger.error(`x (code ${countError?.code ?? 'unknown'})`)"],
    ["logger.error('x', { code: error.code ?? null, userId })"],
    ["logger.error(`x (${error.code})`)"],
    ["logger.error(`x (${result.error.code})`)"],
    ["const code = error.code ?? 'unknown';"],
    ["const code = String((result.reason as { code?: unknown } | null)?.code ?? 'unknown');"],
    ["if (result.error) throw new WebhookHealthReadError(result.error.code ?? 'unknown');"],
    ["throw Object.assign(new Error('x'), { code: error.code })"],
    ["failures.push(`x ${error.code}`)"],
    // toString och samlarnamn
    ["logger.error(`x ${err.toString()}`)"],
    ["throw new Error(`x ${error.toString()}`)"],
    ["res.status(500).json({ error: error.toString() })"],
    ["issues.push(`x ${error.message}`)"],
    ["errs.push(`x ${error}`)"],
    ["problems.push(`x ${e.message}`)"],
  ])('flags %s', (source) => {
    expect(scan(source).length).toBeGreaterThan(0);
  });

  it.each([
    ["logger.error(`x (${errorCode(error)})`)"],
    ["logger.error(`x (${error ? errorCode(error) : 'no row'})`)"],
    ["logger.error('x', new CriticalAlert('token_write'))"],
    ["logger.info(`User ${userId} did ${count} things`)"],
    ["logger.error(`x (${errorCode(byName.error ?? byEmail.error)})`)"],
    ["logger.error('x', { types: entries.map((e) => e.type) })"],
    ["logger.info(`Daily roll: \"${picked.name}\" selected`)"],
    ["logger.info(`Checking title ${title.name}`)"],
    ["res.status(500).json({ error: 'Failed to fetch titles' })"],
    // Ett typnamn som slutar på Error är ingen felvariabel: svaren typas mot ApiError m.fl. i shared
    ["res.status(400).json({ error: 'x' } satisfies ApiError)"],
    ["res.status(500).json({ success: false, error: 'x' } satisfies ApiFailure)"],
    ["res.status(500).json({ error: 'x', written: true } satisfies WrittenApiError)"],
    ["const body: ApiError = { error: 'x' }; res.status(400).json(body)"],
    ["res.json({ success: true, message: 'Password changed successfully' })"],
    ["res.status(400).json({ error: page.error })"],
    ["res.status(500).json({ error: errorCode(error) })"],
    ["res.status(500).json({ code: error.code })"],
    ["res.status(500).send('Internal server error')"],
    ["console.log('plain text')"],
    ["throw Object.assign(new Error(`Failed to fetch runs (user ${userId})`), { code: errorCode(error) })"],
    ["throw new Error(`${failed} of ${total} auto-declines failed`)"],
    ["throw new Error('Missing Supabase environment variables')"],
    ["failures.push(`increment_event_xp failed for event ${event.id} (${errorCode(xpErr)})`)"],
    ["logger.error(`x (${errorCode(error)})`, { code: errorCode(res.error) })"],
    ["const code = errorCode(error);"],
    ["if (sealing.code === 'x') logger.error(`x (${sealing.code})`)"],
    ["throw Object.assign(new Error('x'), { code: errorCode(error) })"],
    ["failures.push(`x ${errorCode(error)}`)"],
    ["rows.push(`row ${item.message}`)"],
    ["import { logger } from '../utils/logger.js'; logger.info('x');"],
    ["export default function f(logger2: unknown) { return logger2; }"],
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
      for (const v of violationsIn(ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true), text, rel)) violations.push(`${rel}:${v}`);
    }
    expect(violations).toEqual([]);
  });
});
