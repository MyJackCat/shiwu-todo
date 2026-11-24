import { useEffect } from 'react';
import { dismissToast, useStore } from '../lib/store';
import { toggleTask } from '../lib/sync';
import { BellIcon, CheckIcon, XIcon } from './Icons';
import type { Toast } from '../lib/types';

function ToastItem({ toast }: { toast: Toast }) {
  const { tasks } = useStore();
  const task = toast.taskId ? tasks[toast.taskId] : undefined;

  useEffect(() => {
    const timer = window.setTimeout(() => dismissToast(toast.key), 45_000);
    return () => window.clearTimeout(timer);
  }, [toast.key]);

  return (
    <div className="toast" role="status">
      <div className="toast-icon">
        <BellIcon size={18} />
      </div>
      <div className="toast-body">
        <strong>{toast.title}</strong>
        {toast.body && <span>{toast.body}</span>}
      </div>
      <div className="toast-actions">
        {task && task.status === 'pending' && (
          <button
            className="toast-done"
            onClick={() => {
              void toggleTask(task);
              dismissToast(toast.key);
            }}
          >
            <CheckIcon size={13} />
            完成
          </button>
        )}
        <button className="icon-btn" onClick={() => dismissToast(toast.key)} aria-label="关闭提醒">
          <XIcon size={14} />
        </button>
      </div>
    </div>
  );
}

export default function Toasts() {
  const { toasts } = useStore();
  if (toasts.length === 0) return null;
  return (
    <div className="toasts">
      {toasts.map((toast) => (
        <ToastItem key={toast.key} toast={toast} />
      ))}
    </div>
  );
}
