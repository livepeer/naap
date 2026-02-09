'use client';

import { useEffect, useState, useCallback } from 'react';
import { useEvents } from '@/contexts';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';

interface NotificationData {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

const icons = {
  success: CheckCircle,
  error: AlertCircle,
  info: Info,
  warning: AlertTriangle,
};

const colors = {
  success: 'bg-green-500/10 border-green-500/20 text-green-500',
  error: 'bg-red-500/10 border-red-500/20 text-red-500',
  info: 'bg-blue-500/10 border-blue-500/20 text-blue-500',
  warning: 'bg-yellow-500/10 border-yellow-500/20 text-yellow-500',
};

export function NotificationToast() {
  const eventBus = useEvents();
  const [notifications, setNotifications] = useState<NotificationData[]>([]);

  const addNotification = useCallback((data: NotificationData) => {
    setNotifications(prev => {
      // Deduplicate by id
      if (prev.some(n => n.id === data.id)) {
        return prev;
      }
      // Limit to 5 notifications
      const next = [...prev, data];
      if (next.length > 5) {
        next.shift();
      }
      return next;
    });
  }, []);

  const removeNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  useEffect(() => {
    const showHandler = eventBus.on('notification:show', (data: NotificationData) => {
      addNotification(data);
    });

    const dismissHandler = eventBus.on('notification:dismiss', (data: { id: string }) => {
      removeNotification(data.id);
    });

    return () => {
      showHandler();
      dismissHandler();
    };
  }, [eventBus, addNotification, removeNotification]);

  if (notifications.length === 0) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {notifications.map(notification => {
        const Icon = icons[notification.type];
        return (
          <div
            key={notification.id}
            className={`flex items-start gap-3 p-4 rounded-lg border shadow-lg backdrop-blur-sm min-w-[320px] max-w-[420px] animate-in slide-in-from-right-5 ${colors[notification.type]}`}
          >
            <Icon className="h-5 w-5 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">{notification.message}</p>
              {notification.action && (
                <button
                  onClick={notification.action.onClick}
                  className="mt-2 text-sm font-medium underline hover:no-underline"
                >
                  {notification.action.label}
                </button>
              )}
            </div>
            <button
              onClick={() => removeNotification(notification.id)}
              className="shrink-0 p-1 rounded hover:bg-white/10 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
