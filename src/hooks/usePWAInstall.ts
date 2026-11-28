import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

declare global {
  interface Window {
    __showliveDeferredPrompt?: BeforeInstallPromptEvent | null;
  }
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(() =>
    typeof window !== 'undefined' ? window.__showliveDeferredPrompt || null : null
  );
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isInIframe, setIsInIframe] = useState(false);

  useEffect(() => {
    const standaloneMedia = window.matchMedia('(display-mode: standalone)');
    const checkStandalone = () =>
      standaloneMedia.matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;

    setIsInstalled(checkStandalone());

    const ua = window.navigator.userAgent.toLowerCase();
    const isAppleMobile =
      /iphone|ipad|ipod/.test(ua) ||
      (/macintosh/.test(ua) && (window.navigator.maxTouchPoints || 0) > 1);
    setIsIOS(isAppleMobile);

    try {
      setIsInIframe(window.self !== window.top);
    } catch {
      setIsInIframe(true);
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      const promptEvt = e as BeforeInstallPromptEvent;
      window.__showliveDeferredPrompt = promptEvt;
      setDeferredPrompt(promptEvt);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      window.__showliveDeferredPrompt = null;
      setDeferredPrompt(null);
    };

    const handleDisplayModeChange = () => {
      setIsInstalled(checkStandalone());
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    standaloneMedia.addEventListener?.('change', handleDisplayModeChange);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
      standaloneMedia.removeEventListener?.('change', handleDisplayModeChange);
    };
  }, []);

  const install = async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    const promptEvt = deferredPrompt || window.__showliveDeferredPrompt;
    if (!promptEvt) return 'unavailable';
    await promptEvt.prompt();
    const { outcome } = await promptEvt.userChoice;
    if (outcome === 'accepted') {
      setIsInstalled(true);
      window.__showliveDeferredPrompt = null;
      setDeferredPrompt(null);
      return 'accepted';
    }
    return 'dismissed';
  };

  return {
    isInstallable: Boolean(deferredPrompt),
    isInstalled,
    isIOS,
    isInIframe,
    install,
  };
}

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}
