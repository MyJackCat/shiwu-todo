import { fmtRange, isOverdue } from '../lib/time';
import { removeTask, toggleTask } from '../lib/sync';
import { REPEAT_LABELS, type Task } from '../lib/types';
import { CheckIcon, ClockIcon, RepeatIcon, TrashIcon, BellIcon } from './Icons';

interface Props {
  task: Task;
  onEdit: (task: Task) => void;
}

export default function TaskItem({ task, onEdit }: Props) {
  const done = task.status === 'done';
  const overdue = isOverdue(task);
  const showRepeat = task.kind === 'reminder' && task.repeat !== 'none';

  return (
    <div className={`task ${done ? 'is-done' : ''} ${overdue ? 'is-overdue' : ''}`}>
      <button
        className={`check ${done ? 'checked' : ''}`}
        onClick={(event) => {
          event.stopPropagation();
          void toggleTask(task);
        }}
        aria-label={done ? '标记为未完成' : '标记为完成'}
        title={done ? '标记为未完成' : '完成'}
      >
        {done && <CheckIcon size={14} />}
      </button>

      <div className="task-main" onClick={() => onEdit(task)} role="button" tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onEdit(task);
        }}
      >
        <div className="task-title-row">
          <span className="task-title">{task.title}</span>
          {task.priority > 0 && <span className={`prio p${task.priority}`} title="优先级" />}
        </div>
        {(task.kind === 'reminder' || task.notes) && (
          <div className="task-meta">
            {task.kind === 'reminder' && task.remindAt && (
              <span className={`meta-item ${overdue ? 'danger' : ''}`}>
                {task.advanceMinutes > 0 ? <BellIcon size={13} /> : <ClockIcon size={13} />}
                {fmtRange(task)}
                {task.advanceMinutes > 0 ? ` · 提前${task.advanceMinutes}分` : ''}
              </span>
            )}
            {showRepeat && (
              <span className="meta-item">
                <RepeatIcon size={13} />
                {REPEAT_LABELS[task.repeat]}
              </span>
            )}
            {overdue && <span className="meta-item danger">已逾期</span>}
            {task.notes && <span className="meta-notes">{task.notes}</span>}
          </div>
        )}
      </div>

      <button
        className="icon-btn task-delete"
        onClick={(event) => {
          event.stopPropagation();
          if (window.confirm(`删除「${task.title}」？`)) void removeTask(task.id);
        }}
        aria-label="删除"
        title="删除"
      >
        <TrashIcon size={16} />
      </button>
    </div>
  );
}
