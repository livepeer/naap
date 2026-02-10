declare module 'unzipper' {
  import { Writable } from 'stream';
  export function Extract(opts: { path: string }): Writable;
}
