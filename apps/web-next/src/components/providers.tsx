'use client';

import { type ReactNode } from 'react';
import { AuthProvider } from '@/contexts/auth-context';
import { ShellProvider } from '@/contexts/shell-context';
import { PluginProvider } from '@/contexts/plugin-context';
import { Web3Provider } from '@/providers/Web3Provider';
import { NotificationToast } from '@/components/ui/notification-toast';
import { ThemeInitializer } from '@/components/theme-initializer';

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return (
    <Web3Provider>
      <AuthProvider>
        <ShellProvider>
          <PluginProvider>
            <ThemeInitializer />
            {children}
            <NotificationToast />
          </PluginProvider>
        </ShellProvider>
      </AuthProvider>
    </Web3Provider>
  );
}
