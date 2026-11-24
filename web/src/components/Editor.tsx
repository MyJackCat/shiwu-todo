import { useEffect, useRef, useState, type FormEvent } from 'react';
import { addTask, removeTask, saveTask } from '../lib/sync';
import { defaultReminderTime, fromInputValue, toInputValue } from '../lib/time';
import { REPEAT_LABELS, type Repeat, type Task, type TaskKind } from '../lib/types';
import { XIcon } from './Icons';

interface Props {
  task?: Task;
  initialKind?: TaskKind;
  onClose: () => void;
}

const ADVANCE_OPTIONS = [0, 5, 10, 15, 30, 60];

export default function Editor({ task, initialKind, onClose }: Props) {
  const [title, setTitle] = useState(task?.title ?? '');
  const [notes, setNotes] = useState(task?.notes ?? '');
  const [kind, setKind] = useState<TaskKind>(task?.kind ?? initialKind ?? 'task');
  const [start, setStart] = useState(
    toInputValue(task?.remindAt ?? (initialKind === 'reminder' ? defaultReminderTime() : null)),
  );
  const [end, setEnd] = useState(toInputValue(task?.endAt ?? null));
  const [repeat, setRepeat] = useState<Repeat>(task?.repeat ?? 'none');
  const [advance, setAdvance] = useState(task?.advanceMinutes ?? 0);
  const [priority, setPriority] = useState(task?.priority ?? 0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  const chooseKind = (next: TaskKind) => {
    setKind(next);
    if (next === 'reminder' && !start) setStart(toInputValue(defaultReminderTime()));
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = title.trim();
    if (!text) {
      setError('请输入标题');
      return;
    }
    const remindAt = kind === 'reminder' ? fromInputValue(start) : null;
    if (kind === 'reminder' && !remindAt) {
      setError('请选择提醒时间');
      return;
    }
    const endAt = kind === 'reminder' ? fromInputValue(end) : null;
    if (remindAt && endAt && endAt < remindAt) {
      setError('结束时间不能早于开始时间');
      return;
    }
    setBusy(true);
    try {
      const payload = {
        title: text,
        notes,
        kind,
        priority,
        remindAt,
        endAt,
        repeat: kind === 'reminder' ? repeat : ('none' as Repeat),
        advanceMinutes: kind === 'reminder' ? advance : 0,
      };
      if (task) await saveTask(task.id, payload);
      else await addTask(payload);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
      setBusy(false);
    }
  }

  async function remove() {
    if (!task) return;
    if (!window.confirm(`删除「${task.title}」？`)) return;
    await removeTask(task.id);
    onClose();
  }

  return (
    <div
      className="overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form className="editor" onSubmit={submit}>
        <div className="editor-head">
          <h2>{task ? '编辑待办' : '新建待办'}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            <XIcon size={18} />
          </button>
        </div>

        <div className="segmented kind-switch">
          <button type="button" className={kind === 'task' ? 'active' : ''} onClick={() => chooseKind('task')}>
            事务待办
          </button>
          <button type="button" className={kind === 'reminder' ? 'active' : ''} onClick={() => chooseKind('reminder')}>
            定时提醒
          </button>
        </div>

        <input
          ref={titleRef}
          className="title-input"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="要做什么？"
          maxLength={200}
        />

        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="备注（可选）"
          rows={2}
          maxLength={5000}
        />

        {kind === 'reminder' && (
          <div className="reminder-fields">
            <div className="field-grid">
              <label className="field">
                <span>提醒时间</span>
                <input type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} />
              </label>
              <label className="field">
                <span>结束时间（可选）</span>
                <input type="datetime-local" value={end} onChange={(event) => setEnd(event.target.value)} />
              </label>
              <label className="field">
                <span>重复</span>
                <select value={repeat} onChange={(event) => setRepeat(event.target.value as Repeat)}>
                  {Object.entries(REPEAT_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>提前提醒</span>
                <select value={advance} onChange={(event) => setAdvance(Number(event.target.value))}>
                  {ADVANCE_OPTIONS.map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {minutes === 0 ? '准时' : `提前 ${minutes} 分钟`}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="hint">
              到点后电脑和手机会弹出提醒；重复提醒点完成后会自动排到下一次。
            </p>
          </div>
        )}

        <div className="field priority-field">
          <span>优先级</span>
          <div className="segmented small">
            {[
              { value: 0, label: '无' },
              { value: 1, label: '低' },
              { value: 2, label: '中' },
              { value: 3, label: '高' },
            ].map((option) => (
              <button
                type="button"
                key={option.value}
                className={priority === option.value ? 'active' : ''}
                onClick={() => setPriority(option.value)}
              >
                {option.value > 0 && <span className={`dot p${option.value}`} />}
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="form-error">{error}</p>}

        <div className="editor-foot">
          {task ? (
            <button type="button" className="text-btn danger" onClick={remove}>
              删除
            </button>
          ) : (
            <span />
          )}
          <div className="foot-right">
            <button type="button" className="ghost-btn" onClick={onClose}>
              取消
            </button>
            <button type="submit" className="primary-btn" disabled={busy}>
              {task ? '保存' : '添加'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
