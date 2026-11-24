import { useEffect, useState, type FormEvent } from 'react';
import { getApiBase, isAndroidApp, isElectron, setApiBase } from '../lib/api';
import { useStore } from '../lib/store';
import { flush, logout, pull } from '../lib/sync';
import { ensureNotificationPermission, permissionState, testNotification } from '../lib/notify';
import { disablePush, enablePush, pushDiagnostics, pushFlagOn } from '../lib/push';
import { fmtClock } from '../lib/time';
import { BellIcon, Logo, XIcon } from './Icons';

interface Props {
  onClose: () => void;
}

export default function Settings({ onClose }: Props) {
  const state = useStore();
  const [server, setServer] = useState(getApiBase());
  const [perm, setPerm] = useState(permissionState());
  const [pushOn, setPushOn] = useState(pushFlagOn());
  const [pushNote, setPushNote] = useState('检查中…');
  const [pushBusy, setPushBusy] = useState(false);
  const [widgetVisible, setWidgetVisible] = useState(true);
  const [widgetTop, setWidgetTop] = useState(true);
  const [autoStart, setAutoStart] = useState(false);
  const electron = isElectron();
  const android = isAndroidApp();

  useEffect(() => {
    void pushDiagnostics().then(setPushNote);
    if (electron) {
      void window.desktop?.getAutoStart().then(setAutoStart);
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [electron, onClose]);

  function saveServer(event: FormEvent) {
    event.preventDefault();
    setApiBase(server);
    location.reload();
  }

  async function togglePush() {
    setPushBusy(true);
    try {
      if (pushOn) {
        await disablePush();
        setPushNote('已关闭后台推送');
      } else {
        setPushNote(await enablePush());
      }
      setPushOn(pushFlagOn());
    } catch (err) {
      setPushNote(err instanceof Error ? err.message : '操作失败');
      setPushOn(pushFlagOn());
    } finally {
      setPushBusy(false);
    }
  }

  async function toggleAutoStart(next: boolean) {
    const result = await window.desktop?.setAutoStart(next);
    setAutoStart(result ?? next);
  }

  function toggleWidget(next: boolean) {
    setWidgetVisible(next);
    window.desktop?.toggleWidget(next);
  }

  function toggleWidgetTop(next: boolean) {
    setWidgetTop(next);
    window.desktop?.setWidgetOnTop(next);
  }

  return (
    <div
      className="overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="settings">
        <div className="editor-head">
          <h2>设置</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            <XIcon size={18} />
          </button>
        </div>

        <section className="settings-section">
          <h3>账号与服务器</h3>
          <div className="account-row">
            <div className="avatar">{(state.user?.name || state.user?.email || '?').slice(0, 1).toUpperCase()}</div>
            <div>
              <strong>{state.user?.name}</strong>
              <span>{state.user?.email}</span>
            </div>
          </div>
          <form className="server-form" onSubmit={saveServer}>
            <input value={server} onChange={(event) => setServer(event.target.value)} />
            <button type="submit" className="ghost-btn">
              保存并重载
            </button>
          </form>
          <p className="hint">
            手机、电脑指向同一个服务器即可同步。切换地址后会重新登录。
          </p>
        </section>

        <section className="settings-section">
          <h3>到点提醒</h3>
          <div className="setting-row">
            <div>
              <strong>系统通知</strong>
              <span>
                {perm === 'granted'
                  ? '已允许，到点会弹出系统通知'
                  : perm === 'denied'
                    ? '已被浏览器/系统禁止，请在系统设置中允许'
                    : '尚未允许通知'}
              </span>
            </div>
            {perm !== 'granted' && perm !== 'unsupported' && (
              <button
                className="ghost-btn"
                onClick={async () => {
                  await ensureNotificationPermission();
                  setPerm(permissionState());
                }}
              >
                开启
              </button>
            )}
          </div>
          <div className="setting-row">
            <div>
              <strong>测试通知</strong>
              <span>发一条通知，检查系统是否会提醒</span>
            </div>
            <button className="ghost-btn" onClick={testNotification}>
              发送测试
            </button>
          </div>

          {!electron && !android && (
            <div className="setting-row">
              <div>
                <strong>浏览器后台推送</strong>
                <span>{pushNote}</span>
              </div>
              <button className="ghost-btn" onClick={togglePush} disabled={pushBusy}>
                {pushOn ? '关闭' : '开启'}
              </button>
            </div>
          )}
          {android && (
            <p className="hint">
              安卓端使用原生闹钟提醒。若一直收不到，请在系统设置里允许「事务待办」通知，并允许精确闹钟、关闭电池优化。
            </p>
          )}
        </section>

        {electron && (
          <section className="settings-section">
            <h3>桌面小组件</h3>
            <div className="setting-row">
              <div>
                <strong>显示桌面小组件</strong>
                <span>常驻桌面的小卡片，可勾选完成待办</span>
              </div>
              <label className="switch">
                <input type="checkbox" checked={widgetVisible} onChange={(event) => toggleWidget(event.target.checked)} />
                <span />
              </label>
            </div>
            <div className="setting-row">
              <div>
                <strong>小组件置顶</strong>
                <span>保持在其他窗口上方</span>
              </div>
              <label className="switch">
                <input type="checkbox" checked={widgetTop} onChange={(event) => toggleWidgetTop(event.target.checked)} />
                <span />
              </label>
            </div>
            <div className="setting-row">
              <div>
                <strong>开机自启</strong>
                <span>登录 Windows 后自动运行事务待办</span>
              </div>
              <label className="switch">
                <input type="checkbox" checked={autoStart} onChange={(event) => void toggleAutoStart(event.target.checked)} />
                <span />
              </label>
            </div>
          </section>
        )}

        <section className="settings-section">
          <h3>同步</h3>
          <div className="setting-row">
            <div>
              <strong>{state.outboxCount > 0 ? `有 ${state.outboxCount} 项待同步` : '已同步'}</strong>
              <span>{state.lastSyncAt ? `上次同步 ${fmtClock(state.lastSyncAt)}` : '还没有同步过'}</span>
            </div>
            <button
              className="ghost-btn"
              onClick={() => {
                void flush();
                void pull();
              }}
            >
              立即同步
            </button>
          </div>
          <button
            className="text-btn danger logout-btn"
            onClick={() => {
              if (window.confirm('退出登录？本机缓存会被清除，服务器数据不受影响。')) {
                logout();
                onClose();
              }
            }}
          >
            退出登录
          </button>
        </section>

        <section className="settings-section about">
          <Logo size={22} />
          <div>
            <strong>事务待办 1.0</strong>
            <span>Node + SQLite 自托管同步服务 · PWA / Electron / Android</span>
          </div>
        </section>
      </div>
    </div>
  );
}
