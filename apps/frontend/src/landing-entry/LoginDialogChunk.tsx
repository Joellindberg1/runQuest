// Inloggningsdialogens chunk i lean ingången. Dialogen ritas med skalets överlagerlager (`.rq-scrim`, `.rq-modal`, `.rq-modal__close`), som i fullappen kommer
// ur app-shell.css via routes.tsx. Lean ingången laddar inte det lagret i första besöket (landing.html länkar bara det en utloggad besökare behöver),
// så det följer med dialogen: filen hämtas när besökaren visar avsikt mot Sign in, och är samma fil som fullappen länkar, alltså redan varm efter överlämningen.
// Skulle lagret en dag få en egen fil (mindre än hela skalet) är det den här importen som byts.
import '@/app-shell/app-shell.css';

export { LoginDialog } from '@/features/auth/components/LoginDialog';
