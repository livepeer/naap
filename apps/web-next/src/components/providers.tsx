'use client';

import { type ReactNode } from 'react';
import { AuthProvider } from '@/contexts/auth-context';
import { ShellProvider } from '@/contexts/shell-context';
import { PluginProvider } from '@/contexts/plugin-context';
import { NotificationToast } from '@/components/ui/notification-toast';
import { ThemeInitializer } from '@/components/theme-initializer';
import { BackgroundPluginLoader } from '@/components/plugin/BackgroundPluginLoader';

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return (
    <AuthProvider>
      <ShellProvider>
        <PluginProvider>
          <ThemeInitializer />
          <BackgroundPluginLoader />
          {children}
          <NotificationToast />
        </PluginProvider>
      </ShellProvider>
    </AuthProvider>
  );
}
