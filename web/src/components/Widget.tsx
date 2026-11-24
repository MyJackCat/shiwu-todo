import { useEffect, useRef, useState, type FormEvent, type PointerEvent } from 'react';
import { getToken } from '../lib/api';
import { addTask, logout, pull, toggleTask } from '../lib/sync';
import { useStore } from '../lib/store';
import { fmtClock, fmtFullDate, fmtRange, isOverdue } from '../lib/time';
import { nextReminder, syncLabel, todayTasks } from '../lib/views';
import {
  BellIcon,
  CheckIcon,
  ChevronDownIcon,
  ExternalIcon,
  Logo,
  PlusIcon,
  RefreshIcon,
  XIcon,
} from './Icons';

const COLLAPSE_KEY = 'shiwu.widget.collapsed';
const IGNORE_DRAG = 'button, input, textarea, select, a, .w-list, .w-add';

function openMain(taskId?: string) {
  if (window.desktop?.openMain) {
    window.desktop.openMain(taskId);
    return;
  }
  location.href = location.pathname;
}

function openNewReminder() {
  if (window.desktop?.openMain) {
    window.desktop.openMain(undefined, 'reminder');
    return;
  }
  location.href = `${location.pathname}?new=reminder`;
}

function initialCollapsed(): boolean {
  const stored = localStorage.getItem(COLLAPSE_KEY);
  if (stored != null) return stored === '1';
  return new URLSearchParams(location.search).get('collapsed') === '1';
}

function GripIcon() {
  return (
    <svg className="w-grip" width="9" height="15" viewBox="0 0 9 15" fill="currentColor" aria-hidden="true">
      <circle cx="2" cy="2.5" r="1.15" />
      <circle cx="7" cy="2.5" r="1.15" />
      <circle cx="2" cy="7.5" r="1.15" />
      <circle cx="7" cy="7.5" r="1.15" />
      <circle cx="2" cy="12.5" r="1.15" />
      <circle cx="7" cy="12.5" r="1.15" />
    </svg>
  );
}

function PetMascot() {
  return (
    <svg viewBox="0 0 120 120" className="pet-svg" aria-hidden="true">
      <defs>
        <linearGradient id="pet-body-gradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7c78ff" />
          <stop offset="1" stopColor="#4740c9" />
        </linearGradient>
      </defs>
      <ellipse cx="60" cy="111" rx="30" ry="5" fill="rgba(0,0,0,.17)" />
      <rect x="16" y="10" width="88" height="88" rx="30" fill="url(#pet-body-gradient)" />
      <circle cx="45" cy="48" r="7.5" fill="#fff" />
      <circle cx="75" cy="48" r="7.5" fill="#fff" />
      <circle cx="47" cy="49" r="3.2" fill="#2b2a44" />
      <circle cx="77" cy="49" r="3.2" fill="#2b2a44" />
      <path d="M49 64 Q60 73 71 64" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" />
      <circle cx="32" cy="62" r="5" fill="#ffb4c8" opacity=".65" />
      <circle cx="88" cy="62" r="5" fill="#ffb4c8" opacity=".65" />
      <circle cx="88" cy="82" r="14" fill="#fff" />
      <path
        d="M82 82 l4 4 8-9"
        fill="none"
        stroke="#5450e0"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 整个卡片可拖动；没有移动的点击会触发 onTap（用于桌宠点击展开）。 */
function useWindowDrag(onTap: (() => void) | undefined) {
  const active = useRef(false);
  const dragging = useRef(false);
  const moved = useRef(false);
  const start = useRef({ x: 0, y: 0 });
  const frame = useRef<number | null>(null);
  const point = useRef<{ x: number; y: number } | null>(null);
  const tapRef = useRef(onTap);
  tapRef.current = onTap;

  useEffect(
    () => () => {
      if (frame.current != null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  function begin(event: PointerEvent<HTMLDivElement>) {
    const target = event.target as Element;
    if (target.closest(IGNORE_DRAG)) return;
    active.current = true;
    dragging.current = false;
    moved.current = false;
    start.current = { x: event.screenX, y: event.screenY };
    point.current = null;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // 某些环境不支持指针捕获
    }
    event.preventDefault();
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    if (!active.current) return;
    const dx = event.screenX - start.current.x;
    const dy = event.screenY - start.current.y;
    if (!moved.current && Math.hypot(dx, dy) > 4) {
      moved.current = true;
      if (window.desktop?.beginWindowDrag) {
        dragging.current = true;
        window.desktop.beginWindowDrag(start.current.x, start.current.y);
      }
    }
    if (!dragging.current) return;
    point.current = { x: event.screenX, y: event.screenY };
    if (frame.current != null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const current = point.current;
      if (current) window.desktop?.dragWindowTo(current.x, current.y);
    });
  }

  function finish(event: PointerEvent<HTMLDivElement>, allowTap: boolean) {
    if (!active.current) return;
    active.current = false;
    const finalPoint = point.current;
    if (dragging.current) {
      if (frame.current != null) {
        cancelAnimationFrame(frame.current);
        frame.current = null;
      }
      if (finalPoint) window.desktop?.dragWindowTo(finalPoint.x, finalPoint.y);
      window.desktop?.endWindowDrag();
    }
    dragging.current = false;
    point.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // 忽略
    }
    if (allowTap && !moved.current) tapRef.current?.();
  }

  return {
    onPointerDown: begin,
    onPointerMove: move,
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => finish(event, true),
    onPointerCancel: (event: PointerEvent<HTMLDivElement>) => finish(event, false),
  };
}

export default function Widget() {
  const state = useStore();
  const [quick, setQuick] = useState('');
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  const items = todayTasks(state.tasks);
  const next = nextReminder(state.tasks);
  const visible = items.slice(0, 9);
  const isDesktop = !!window.desktop?.isElectron;
  const dragProps = useWindowDrag(collapsed ? () => setCollapsed(false) : undefined);

  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    window.desktop?.setWidgetCollapsed?.(collapsed);
  }, [collapsed]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = quick.trim();
    if (!text) return;
    setBusy(true);
    setQuick('');
    try {
      await addTask({ title: text });
    } finally {
      setBusy(false);
    }
  }

  function closeWidget() {
    window.desktop?.closeWidget?.();
  }

  if (collapsed) {
    const petText = !state.user
      ? getToken()
        ? '正在同步…'
        : '请先登录'
      : items.length === 0
        ? '今天清空啦'
        : `${items.length} 件待办`;
    return (
      <div
        className="pet-shell"
        {...dragProps}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setCollapsed(false);
          }
        }}
      >
        <div className="pet-stage">
          {isDesktop && (
            <button className="pet-close" onClick={closeWidget} title="关闭小组件" aria-label="关闭小组件">
              <XIcon size={13} />
            </button>
          )}
          <div className="pet-bubble">{petText}</div>
          <div className="pet-figure">
            <PetMascot />
          </div>
          <div className="pet-hint">点我展开</div>
        </div>
      </div>
    );
  }

  if (!state.user) {
    if (getToken()) {
      return (
        <div className="widget-shell" {...dragProps}>
          <div className="widget">
            <div className="w-login">
              <span className="w-grip w-grip-center" title="按住拖动">
                <GripIcon />
              </span>
              <Logo size={34} />
              <strong>事务待办</strong>
              <p>正在同步账号数据…</p>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="widget-shell" {...dragProps}>
        <div className="widget">
          <div className="w-login">
            <span className="w-grip w-grip-center" title="按住拖动">
              <GripIcon />
            </span>
            <Logo size={34} />
            <strong>事务待办</strong>
            <p>先登录，桌面小组件才会显示待办</p>
            <button className="primary-btn" onClick={() => openMain()}>
              打开主窗口
            </button>
            <button className="link-btn" onClick={() => logout()}>
              切换账号
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="widget-shell" {...dragProps}>
      <div className="widget">
        <div className="w-head">
          <span className="w-grip" title="按住拖动">
            <GripIcon />
          </span>
          <div className="w-title-block">
            <strong>今天</strong>
            <span>{fmtFullDate()}</span>
          </div>
          <div className="w-actions">
            <button className="w-pill" onClick={openNewReminder} title="新建定时提醒">
              <BellIcon size={12} />
              提醒
            </button>
            <button className="w-icon" onClick={() => void pull()} title="刷新">
              <RefreshIcon size={15} />
            </button>
            <button className="w-icon" onClick={() => openMain()} title="打开主窗口">
              <ExternalIcon size={15} />
            </button>
            {isDesktop && (
              <button className="w-icon w-collapse" onClick={() => setCollapsed(true)} title="收起为桌宠">
                <ChevronDownIcon size={15} />
              </button>
            )}
            {isDesktop && (
              <button className="w-icon w-close" onClick={closeWidget} title="关闭小组件">
                <XIcon size={14} />
              </button>
            )}
          </div>
        </div>

        <div className="w-list">
          {visible.length === 0 && <div className="w-empty">今天没有待办，享受当下</div>}
          {visible.map((task) => {
            const overdue = isOverdue(task);
            return (
              <div className={`w-task ${task.status === 'done' ? 'done' : ''}`} key={task.id}>
                <button
                  className={`w-check ${task.status === 'done' ? 'checked' : ''}`}
                  onClick={() => void toggleTask(task)}
                  aria-label="完成"
                >
                  {task.status === 'done' && <CheckIcon size={11} />}
                </button>
                <button className="w-main" onClick={() => openMain(task.id)}>
                  <span className="w-title">{task.title}</span>
                  {task.kind === 'reminder' && task.remindAt && (
                    <span className={`w-meta ${overdue ? 'danger' : ''}`}>{fmtRange(task)}</span>
                  )}
                </button>
              </div>
            );
          })}
          {items.length > visible.length && (
            <button className="w-more" onClick={() => openMain()}>
              还有 {items.length - visible.length} 项
            </button>
          )}
        </div>

        <form className="w-add" onSubmit={submit}>
          <PlusIcon size={15} />
          <input
            value={quick}
            onChange={(event) => setQuick(event.target.value)}
            placeholder="添加一条事务…"
            disabled={busy}
          />
          {quick ? (
            <button type="submit" className="w-send">
              添加
            </button>
          ) : (
            <span className="w-send disabled">添加</span>
          )}
        </form>

        <div className="w-foot">
          {next?.remindAt ? (
            <span>下次提醒 · {fmtClock(next.remindAt)}</span>
          ) : (
            <span>{syncLabel()}</span>
          )}
          <span className={`dot-status ${state.online ? 'ok' : 'bad'}`} />
        </div>
      </div>
    </div>
  );
}
