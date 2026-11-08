import { Component, type ReactNode } from 'react';

interface Props {
  name: string;
  fallback?: ReactNode;
  children: ReactNode;
}

interface State {
  failed: boolean;
}

/** Keeps one broken GLB (e.g. half-written by the pipeline) from taking down the whole canvas. */
export class AssetBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    console.error(`[viewer] failed to load ${this.props.name}`, error);
  }

  render(): ReactNode {
    return this.state.failed ? (this.props.fallback ?? null) : this.props.children;
  }
}
