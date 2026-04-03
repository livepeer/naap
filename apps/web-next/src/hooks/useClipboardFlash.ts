'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export function useClipboardFlash() {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copyClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flashCopied = useCallback((id: string) => {
    if (copyClearRef.current) clearTimeout(copyClearRef.current);
    setCopiedId(id);
    copyClearRef.current = setTimeout(() => {
      setCopiedId(null);
      copyClearRef.current = null;
    }, 2000);
  }, []);

  useEffect(
    () => () => {
      if (copyClearRef.current) clearTimeout(copyClearRef.current);
    },
    [],
  );

  const copyToClipboard = useCallback(
    async (id: string, text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        flashCopied(id);
      } catch {
        /* clipboard may be denied */
      }
    },
    [flashCopied],
  );

  return { copiedId, copyToClipboard, flashCopied };
}
