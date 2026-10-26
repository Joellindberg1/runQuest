// I Express 5 är `req.body` odefinierad när förfrågan saknar kropp (inget Content-Length) eller har en innehållstyp som express.json() inte läser (text/plain, formulär).
// En rutt som läser fälten med `const { a, b } = req.body` kastar då och svarar 500 (och Sentry får en serverfel-händelse) för vad som är klientens fel.
// Med en tom kropp som utgångsläge går samma förfrågan till rutten, som validerar sina fält och svarar 400 `invalid_request`; rutter som inte behöver någon kropp
// (synk, omräkning) och rutter där kroppen är valfri beter sig som förut. Lösningen ligger här, på ett ställe, i stället för en kontroll i varje rutt.
import type { NextFunction, Request, Response } from 'express';

/** Monteras direkt efter express.json(). Rör inte en kropp som en parser redan läst (objekt, array, Buffer från express.raw). */
export function defaultEmptyBody(req: Request, _res: Response, next: NextFunction): void {
  if (req.body === undefined) req.body = {};
  next();
}
