type TelegramWebApp = {
  initData?: string;
  ready?: () => void;
  expand?: () => void;
  openTelegramLink?: (url: string) => void;
};

function webApp(): TelegramWebApp | undefined {
  const telegram = (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } })
    .Telegram;
  return telegram?.WebApp;
}

export function notifyTelegramReady(): void {
  const app = webApp();
  app?.ready?.();
  app?.expand?.();
}

export function readTelegramInitData(): string | undefined {
  const initData = webApp()?.initData;
  return initData && initData.length > 0 ? initData : undefined;
}

export function openTelegramLink(url: string): void {
  const app = webApp();
  if (app?.openTelegramLink) {
    app.openTelegramLink(url);
    return;
  }
  window.open(url, "_blank", "noopener");
}
