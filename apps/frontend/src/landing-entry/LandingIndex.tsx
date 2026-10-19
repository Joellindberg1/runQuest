import { Suspense, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/providers/authContext';
import LandingPage from '@/pages/LandingPage';
import { paths } from '@/paths';
import { AppHandoff } from './AppHandoff';
import { LazyLoginDialog, prefetchLoginDialog } from './loginDialog';
import { signedInTarget } from './signedInTarget';

const SIGN_IN_LINK = `a[href="${paths.login}"]`;
// Pekare, tangentbord och beröring: det första tecknet på att besökaren vill logga in. Fångas på dokumentet så att landningsfeaturen slipper veta om dialogen.
const INTENT_EVENTS = ['pointerover', 'focusin', 'touchstart'] as const;

/** Förhämtar inloggningsdialogen första gången besökaren visar avsikt mot Sign in-länken, och lyssnar sedan inte mer. */
function usePrefetchLoginDialogOnIntent() {
  useEffect(() => {
    const onIntent = (event: Event) => {
      if (!(event.target instanceof Element) || event.target.closest(SIGN_IN_LINK) === null) return;
      for (const type of INTENT_EVENTS) document.removeEventListener(type, onIntent, true);
      prefetchLoginDialog();
    };
    for (const type of INTENT_EVENTS) document.addEventListener(type, onIntent, { capture: true, passive: true });
    return () => {
      for (const type of INTENT_EVENTS) document.removeEventListener(type, onIntent, true);
    };
  }, []);
}

/** Skriver om en filadress (`/landing.html`) till `/` utan omladdning; fråga och fragment behålls. Gör inget för en inloggad besökare, som lämnar sidan. */
function useCanonicalAddress(enabled: boolean) {
  const navigate = useNavigate();
  const { search, hash } = useLocation();
  const { user } = useAuth();
  const signedIn = user !== null;
  useEffect(() => {
    if (enabled && !signedIn) navigate({ pathname: paths.landing, search, hash }, { replace: true });
  }, [enabled, signedIn, navigate, search, hash]);
}

/**
 * `/` och `/login` i lean ingången (ADR 006, addendum 2026-10-19, punkt 8): samma sida som fullappens `pages/Index`, med inloggningsdialogen lazy. Båda
 * routerna renderar detta element på samma plats, så landningen ommonteras inte när dialogen öppnas eller stängs.
 *
 * En inloggad besökare (lyckad inloggning, eller en session som återställs) går inte via `<Navigate>`: den renderar null i en commit innan
 * navigeringen sker, och containern vore tom. I stället ersätter överlämningen landningen direkt med appens laddningsvy.
 */
export function LandingIndex({ loginOpen = false, canonicalizeAddress = false }: { loginOpen?: boolean; canonicalizeAddress?: boolean }) {
  const { user } = useAuth();
  const { search } = useLocation();
  usePrefetchLoginDialogOnIntent();
  useCanonicalAddress(canonicalizeAddress);

  if (user) return <AppHandoff to={signedInTarget(loginOpen, search)} />;
  return (
    <>
      <LandingPage />
      {loginOpen && (
        <Suspense fallback={null}>
          <LazyLoginDialog />
        </Suspense>
      )}
    </>
  );
}
