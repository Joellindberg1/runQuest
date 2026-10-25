import type { ReactNode } from 'react';
import { StaticRouter } from 'react-router-dom';
import { paths } from '@/paths';

/** Routern vid bygget: förrenderingen gäller exakt `/`. Klientens motsvarighet är AppBrowserRouter (hydrateLanding). */
export function ServerRouter({ children }: { children: ReactNode }) {
  return <StaticRouter location={paths.landing}>{children}</StaticRouter>;
}
