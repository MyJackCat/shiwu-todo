import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactElement } from 'react';
import Editor from './components/Editor';
import {
  BellIcon,
  CalendarIcon,
  CheckCircleIcon,
  GearIcon,
  InboxIcon,
  Logo,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
} from './components/Icons';
import Login from './components/Login';
import Settings from './components/Settings';
import TaskItem from './components/TaskItem';
import Toasts from './components/Toasts';
import Widget from './components/Widget';
import { ensureNotificationPermission, isWidgetMode, permissionState } from './lib/notify';
import { addTask, boot, pull, toggleTask } from './lib/sync';
import { getState, useStore } from './lib/store';
import { fmtFullDate } from './lib/time';
import type { Task, TaskKind } from './lib/types';
import { counts, filterTasks, groupTasks, syncLabel, type View } from './lib/views';

const NAV: Array<{ key: View; label: string; icon: (props: { size?: number }) => ReactElement }> = [
  { key: 'today', label: '今天', icon: CalendarIcon },
  { key: 'all', label: '全部', icon: InboxIcon },
  { key: 'reminders', label: '提醒', icon: BellIcon },
  { key: 'done', label: '已完成', icon: CheckCircleIcon },
];

const TITLES: Record<View, string> = {
  today: '今天',
  all: '全部待办',
  reminders: '提醒',
  done: '已完成',
};

const EMPTY: Record<View, { title: string; text: string }> = {
  today: { title: '今天清空啦', text: '添加一条事务，或新建一个定时提醒。' },
  all: { title: '还没有待办', text: '把想做的事记下来，手机和电脑会自动同步。' },
  reminders: { title: '没有提醒', text: '新建定时提醒后，到点会在电脑和手机上通知你。' },
  done: { title: '还没有完成的事', text: '完成一条待办后，会出现在这里。' },
};

export default function App() {
  const state = useStore();
  useEffect(() => {
    void boot();
  }, []);

  if (isWidgetMode()) return <Widget />;
  if (!state.ready) {
    return (
      <div className="splash">
        <Logo size={42} />
      </div>
    );
  }
  if (!state.user) return <Login />;
  return <Shell />;
}

function Shell() {
  const state = useStore();
  const [view, setView] = useState<View>('today');
  const [query, setQuery] = useState('');
  const [editor, setEditor] = useState<{ task?: Task; kind?: TaskKind } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [perm, setPerm] = useState(permissionState());
  const handledQuery = useRef(false);

  const cnt = useMemo(() => counts(state.tasks), [state.tasks]);
  const list = useMemo(() => filterTasks(state.tasks, view, query), [state.tasks, view, query]);
  const groups = useMemo(() => groupTasks(list, view), [list, view]);

  useEffect(() => {
    const update = () => setPerm(permissionState());
    window.addEventListener('focus', update);
    return () => window.removeEventListener('focus', update);
  }, []);

  useEffect(() => {
    const bridge = window.desktop;
    if (!bridge?.onOpenTask) return;
    return bridge.onOpenTask((taskId) => {
      const task = getState().tasks[taskId];
      if (task) setEditor({ task });
      else setView('all');
    });
  }, []);

  useEffect(() => {
    const off = window.desktop?.onReminderComplete?.((taskId) => {
      const task = getState().tasks[taskId];
      if (task && task.status === 'pending') void toggleTask(task);
    });
    return off;
  }, []);

  useEffect(() => {
    const off = window.desktop?.onNewTask?.((kind) => setEditor({ kind }));
    return off;
  }, []);

  useEffect(() => {
    if (handledQuery.current) return;
    const params = new URLSearchParams(location.search);
    const id = params.get('task');
    const newKind = params.get('new');
    if (id && state.tasks[id]) {
      handledQuery.current = true;
      setEditor({ task: state.tasks[id] });
      history.replaceState(null, '', location.pathname);
      return;
    }
    if (newKind === 'task' || newKind === 'reminder') {
      handledQuery.current = true;
      setEditor({ kind: newKind });
      history.replaceState(null, '', location.pathname);
    }
  }, [state.tasks]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'n' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        setEditor({ kind: 'task' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const navItems = NAV.map((item) => ({
    ...item,
    count:
      item.key === 'today'
        ? cnt.today
        : item.key === 'all'
          ? cnt.all
          : item.key === 'reminders'
            ? cnt.reminders
            : cnt.done,
  }));

  const empty = EMPTY[view];

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <Logo size={34} />
          <div className="brand-text">
            <strong>事务待办</strong>
            <span>{state.user?.name}</span>
          </div>
        </div>

        <nav className="nav">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                className={`nav-item ${view === item.key ? 'active' : ''}`}
                onClick={() => setView(item.key)}
              >
                <Icon size={18} />
                <span>{item.label}</span>
                {item.count > 0 && <em>{item.count}</em>}
              </button>
            );
          })}
        </nav>

        <div className="side-foot">
          <button className="sync-row" onClick={() => void pull()} title="立即同步">
            <span className={`dot-status ${state.online ? 'ok' : 'bad'}`} />
            {syncLabel()}
            <RefreshIcon size={13} />
          </button>
          <button className="side-btn" onClick={() => setSettingsOpen(true)}>
            <GearIcon size={17} />
            设置
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="title-block">
            <h1>{TITLES[view]}</h1>
            <p>
              {fmtFullDate()} · {cnt.all} 件待办
            </p>
          </div>
          <div className="top-actions">
            <div className="search">
              <SearchIcon size={16} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索待办…"
                aria-label="搜索"
              />
            </div>
            <button className="primary-btn add-btn" onClick={() => setEditor({ kind: 'task' })}>
              <PlusIcon size={16} />
              <span>新建</span>
            </button>
          </div>
        </header>

        {perm === 'default' && (
          <div className="banner">
            <BellIcon size={20} />
            <div>
              <strong>开启到点提醒</strong>
              <span>允许通知后，到时间会在电脑和手机上提醒你。</span>
            </div>
            <button
              className="ghost-btn"
              onClick={async () => {
                await ensureNotificationPermission();
                setPerm(permissionState());
              }}
            >
              开启
            </button>
          </div>
        )}

        <QuickAdd onReminder={() => setEditor({ kind: 'reminder' })} />

        <div className="list">
          {groups.length === 0 ? (
            <div className="empty">
              <div className="empty-art">
                <CheckCircleIcon size={42} />
              </div>
              <strong>{empty.title}</strong>
              <p>{empty.text}</p>
            </div>
          ) : (
            groups.map((section) => (
              <section className="group" key={section.title}>
                <h2>
                  {section.title}
                  <span>{section.items.length}</span>
                </h2>
                {section.items.map((task) => (
                  <TaskItem key={task.id} task={task} onEdit={(item) => setEditor({ task: item })} />
                ))}
              </section>
            ))
          )}
        </div>
      </main>

      <nav className="mobile-nav">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              className={`mobile-nav-item ${view === item.key ? 'active' : ''}`}
              onClick={() => setView(item.key)}
            >
              <Icon size={20} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {editor && (
        <Editor
          task={editor.task}
          initialKind={editor.kind}
          onClose={() => setEditor(null)}
        />
      )}
      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
      <Toasts />
    </div>
  );
}

function QuickAdd({ onReminder }: { onReminder: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;
    setBusy(true);
    setText('');
    try {
      await addTask({ title: value });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="quick-add" onSubmit={submit}>
      <PlusIcon size={18} />
      <input
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="添加一条事务，回车保存…"
        disabled={busy}
      />
      <button type="button" className="icon-btn" onClick={onReminder} title="新建定时提醒">
        <BellIcon size={17} />
      </button>
    </form>
  );
}
