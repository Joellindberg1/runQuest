import type { BrowserContext, TestInfo } from '@playwright/test';

// Samlar CSP-överträdelser (`securitypolicyviolation`) från varje sida och ram i ett test. Det finns ingen report-uri (den skulle kräva Sentrys DSN-nyckel), så
// proven är enda stället överträdelser syns. Skarp CSP (`disposition: 'enforce'`) fäller provet; i Report-Only-läget (`'report'`) skrivs de ut tydligt men fäller inte.

export interface CspViolation {
  /** `enforce` = webbläsaren blockerade; `report` = bara rapporterat (Content-Security-Policy-Report-Only). */
  disposition: string;
  /** Direktivet som sattes på spel, till exempel `script-src-elem`. */
  directive: string;
  blockedUri: string;
  documentUri: string;
  sourceFile: string;
  line: number;
  /** Webbläsarens utdrag (högst 40 tecken) av det som blockerades. */
  sample: string;
}

export interface CspViolationLog {
  all: () => CspViolation[];
}

const BINDING = '__rqCspViolation';

/** En rad per överträdelse som går att läsa i ett felmeddelande eller en logg. Rena funktioner, ingen webbläsare. */
export function describeViolation(violation: CspViolation): string {
  const where = violation.sourceFile ? ` (${violation.sourceFile}:${violation.line})` : '';
  const sample = violation.sample ? ` "${violation.sample}"` : '';
  return `[${violation.disposition}] ${violation.directive} blocked ${violation.blockedUri || 'inline'}${sample} on ${violation.documentUri}${where}`;
}

/** Delar upp i de som blockerade något och de som bara rapporterades. */
export function splitByDisposition(violations: CspViolation[]): { enforced: CspViolation[]; reported: CspViolation[] } {
  return {
    enforced: violations.filter((violation) => violation.disposition === 'enforce'),
    reported: violations.filter((violation) => violation.disposition !== 'enforce'),
  };
}

/** Lyssnar i varje dokument och ram från första byte. Anropas före första navigeringen. */
export async function collectCspViolations(context: BrowserContext): Promise<CspViolationLog> {
  const seen: CspViolation[] = [];
  await context.exposeFunction(BINDING, (violation: CspViolation) => {
    seen.push(violation);
  });
  await context.addInitScript((binding: string) => {
    document.addEventListener('securitypolicyviolation', (event) => {
      const report = (window as unknown as Record<string, unknown>)[binding];
      if (typeof report !== 'function') return;
      void report({
        disposition: event.disposition,
        directive: event.effectiveDirective,
        blockedUri: event.blockedURI,
        documentUri: event.documentURI,
        sourceFile: event.sourceFile,
        line: event.lineNumber,
        sample: event.sample,
      });
    });
  }, BINDING);
  return { all: () => seen };
}

/** Skriver ut de rapporterade (Report-Only) överträdelserna och lägger dem som anteckning på provet; returnerar de som blockerades. */
export function reportViolations(log: CspViolationLog, testInfo: TestInfo): CspViolation[] {
  const { enforced, reported } = splitByDisposition(log.all());
  if (reported.length > 0) {
    const lines = reported.map(describeViolation);
    console.warn(`CSP report-only: ${reported.length} violation(s) in "${testInfo.title}"\n  ${lines.join('\n  ')}`);
    testInfo.annotations.push({ type: 'csp-report-only', description: lines.join('\n') });
  }
  return enforced;
}
