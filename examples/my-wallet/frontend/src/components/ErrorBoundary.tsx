import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallbackMessage?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="bg-bg-secondary border border-white/10 rounded-xl p-6 text-center">
          <p className="text-sm text-text-primary font-medium mb-1">
            {this.props.fallbackMessage || 'Something went wrong'}
          </p>
          <p className="text-xs text-text-muted mb-4 font-mono break-all">
            {this.state.error?.message}
          </p>
          <button
            onClick={this.handleReset}
            className="px-4 py-1.5 text-xs font-medium rounded-md bg-accent-blue text-white hover:opacity-90 transition-opacity"
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
