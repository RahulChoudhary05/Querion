import { Component, type ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button } from './ui';

/** Graceful error recovery: a crash in one area shows a retry card instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode; label?: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error(error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="m-4 flex flex-col items-start gap-3 rounded-2xl border border-bad/30 bg-bad/5 p-5">
        <div className="font-medium">Something went wrong{this.props.label ? ` in ${this.props.label}` : ''}.</div>
        <p className="font-mono text-xs text-muted">{this.state.error.message}</p>
        <p className="text-sm text-muted">Your code is autosaved — retrying is safe.</p>
        <Button size="sm" icon={<RotateCcw className="size-3.5" />} onClick={() => this.setState({ error: null })}>
          Try again
        </Button>
      </div>
    );
  }
}
