export {};

interface DesktopBridge {
  isElectron: true;
  platform: string;
  notify(payload: { title: string; body: string; taskId?: string }): void;
  toggleWidget(show?: boolean): void;
  setWidgetOnTop(flag: boolean): void;
  openMain(taskId?: string, newKind?: 'task' | 'reminder'): void;
  beginWindowDrag(x: number, y: number): void;
  dragWindowTo(x: number, y: number): void;
  endWindowDrag(): void;
  setWidgetCollapsed(collapsed: boolean): void;
  closeWidget(): void;
  getAutoStart(): Promise<boolean>;
  setAutoStart(flag: boolean): Promise<boolean>;
  onOpenTask(handler: (taskId: string) => void): () => void;
  onNewTask(handler: (kind: 'task' | 'reminder') => void): () => void;
  onReminderComplete(handler: (taskId: string) => void): () => void;
}

interface TodoNativeBridge {
  setSession(baseUrl: string, token: string, userJson: string): void;
  pushSnapshot(json: string): void;
  requestNotificationPermission(): void;
  getServerUrl(): string;
  clearSession(): void;
  toast(message: string): void;
}

declare global {
  interface Window {
    desktop?: DesktopBridge;
    TodoNative?: TodoNativeBridge;
  }
}
