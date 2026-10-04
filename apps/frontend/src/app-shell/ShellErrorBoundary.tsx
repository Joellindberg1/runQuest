import { Component, type ErrorInfo, type ReactNode } from 'react';
import '@/shared/components/error-state.css';

interface ShellErrorBoundaryProps {
  children: ReactNode;
}

interface ShellErrorBoundaryState {
  failed: boolean;
}

/**
 * Fångar renderingsfel i det routade innehållet så att ett trasigt panelflöde aldrig ger helvit skärm: skalet (bottenbar/sidnav)
 * står kvar och sidans plats visar ett felkort (regel 9) med Reload. Klasskomponent — React har ingen hook för detta.
 * ShellOutlet ger den `key={pathname}`, så en ny sida börjar om utan fel.
 */
export class ShellErrorBoundary extends Component<ShellErrorBoundaryProps, ShellErrorBoundaryState> {
  state: ShellErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ShellErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Shell content crashed:', error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <section role="alert" className="rq-card rq-card--edge rq-error">
        <h2 className="rq-error__title">Something broke</h2>
        <p className="rq-error__text">This page hit an unexpected error. Your data is safe — reload to try again.</p>
        <button type="button" className="rq-btn rq-btn--secondary rq-btn--compact" onClick={() => window.location.reload()}>
          Reload
        </button>
      </section>
    );
  }
}
