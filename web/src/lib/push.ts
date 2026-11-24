import { api, getApiBase, getToken, isAndroidApp, isElectron } from './api';

const PUSH_FLAG = 'shiwu.push.enabled';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const existing = await navigator.serviceWorker.getRegistration();
    if (existing) return existing;
    await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}

export function pushSupported(): boolean {
  return (
    !isElectron() &&
    !isAndroidApp() &&
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    window.isSecureContext
  );
}

export function pushFlagOn(): boolean {
  return localStorage.getItem(PUSH_FLAG) === '1';
}

export async function enablePush(): Promise<string> {
  if (isElectron() || isAndroidApp()) return '桌面端和安卓端使用系统通知，无需浏览器推送';
  if (!pushSupported()) {
    throw new Error('当前页面不支持后台推送。手机浏览器推送需要 HTTPS 访问（可用 Tailscale 或 Cloudflare Tunnel）');
  }
  if (!getToken()) throw new Error('请先登录');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('通知权限未开启');

  const registration = await getRegistration();
  if (!registration) throw new Error('Service Worker 未就绪，请刷新页面重试');

  const { publicKey } = await api.pushKey();
  if (!publicKey) throw new Error('服务器没有返回推送公钥');

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as unknown as BufferSource,
    });
  }
  await api.subscribePush(subscription.toJSON());
  localStorage.setItem(PUSH_FLAG, '1');
  return '已开启后台推送，锁屏也能收到提醒';
}

export async function disablePush(): Promise<void> {
  const registration = await navigator.serviceWorker?.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) {
    const endpoint = subscription.endpoint;
    try {
      await api.unsubscribePush(endpoint);
    } catch {
      // 服务器不可达时也移除本地订阅
    }
    await subscription.unsubscribe();
  }
  localStorage.removeItem(PUSH_FLAG);
}

export async function pushDiagnostics(): Promise<string> {
  if (isElectron()) return '桌面端使用 Electron 系统通知';
  if (isAndroidApp()) return '安卓端使用原生闹钟通知';
  if (!window.isSecureContext) return '当前是 HTTP，浏览器后台推送不可用（App 内提醒仍正常）';
  if (!pushSupported()) return '当前浏览器不支持推送';
  const registration = await navigator.serviceWorker?.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) return '已订阅后台推送';
  return '未订阅后台推送';
}

export function apiBaseLabel(): string {
  return getApiBase();
}
