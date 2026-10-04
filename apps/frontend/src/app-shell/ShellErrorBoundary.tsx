import { Component, type ErrorInfo, type ReactNode } from 'react';
import '@/shared/components/error-state.css';

interface ShellErrorBoundaryProps {
  children: ReactNode;
  /** Overlay (desktop-Runner card): felkortet ritas i en modal ovanpå bakgrundssidan och får en Close i stället för Reload. */
  onClose?: () => void;
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
    const { onClose } = this.props;
    const card = (
      <section role="alert" className="rq-card rq-card--edge rq-error">
        <h2 className="rq-error__title">Something broke</h2>
        <p className="rq-error__text">
          {onClose ? 'This card hit an unexpected error. Your data is safe — close it and try again.' : 'This page hit an unexpected error. Your data is safe — reload to try again.'}
        </p>
        <button type="button" className="rq-btn rq-btn--secondary rq-btn--compact" onClick={onClose ?? (() => window.location.reload())}>
          {onClose ? 'Close' : 'Reload'}
        </button>
      </section>
    );
    if (!onClose) return card;
    return (
      <>
        <div className="rq-scrim" />
        <div className="rq-modal">{card}</div>
      </>
    );
  }
}
