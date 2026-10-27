// Installing the app on a phone (or as a laptop app). Chrome and Android
// offer an install prompt we can show from a button; Safari on iPhone needs
// Share, Add to Home Screen; Firefox and Zen can't install apps at all.

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type Platform = 'ios' | 'android' | 'firefox' | 'other';

export function detectPlatform(ua: string): Platform {
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && /Mobile/.test(ua))) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/Firefox\//.test(ua)) return 'firefox';
  return 'other';
}

class Install {
  /** Set when the browser is ready to show its install prompt. */
  prompt = $state<InstallPrompt | null>(null);
  /** Opened from the home screen rather than a browser tab. */
  standalone = $state(false);

  constructor() {
    if (typeof window === 'undefined') return;
    this.standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.prompt = e as InstallPrompt;
    });
    window.addEventListener('appinstalled', () => {
      this.prompt = null;
      this.standalone = true;
    });
  }

  async install(): Promise<boolean> {
    const p = this.prompt;
    if (!p) return false;
    await p.prompt();
    const { outcome } = await p.userChoice;
    this.prompt = null;
    return outcome === 'accepted';
  }
}

export const install = new Install();
