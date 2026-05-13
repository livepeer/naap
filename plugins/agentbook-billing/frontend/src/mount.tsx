import { createRoot, type Root } from 'react-dom/client';
import { App } from './App';

interface ShellContext {
  route: string;
  user?: { id: string; email: string };
}

const roots = new WeakMap<Element, Root>();

export function mount(container: HTMLElement, ctx: ShellContext): () => void {
  let root = roots.get(container);
  if (!root) {
    root = createRoot(container);
    roots.set(container, root);
  }
  root.render(<App route={ctx.route} user={ctx.user} />);
  return () => { root?.unmount(); roots.delete(container); };
}
