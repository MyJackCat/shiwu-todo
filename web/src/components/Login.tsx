import { useState, type FormEvent } from 'react';
import { getApiBase, setApiBase } from '../lib/api';
import { login, register } from '../lib/sync';
import { GearIcon, Logo } from './Icons';

export default function Login() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showServer, setShowServer] = useState(false);
  const [server, setServer] = useState(getApiBase());

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      setApiBase(server);
      if (mode === 'login') await login(email.trim(), password);
      else await register(email.trim(), password, name.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <Logo size={46} />
          <div>
            <h1>事务待办</h1>
            <p>手机、电脑与桌面小组件，实时同步</p>
          </div>
        </div>

        <div className="segmented auth-tabs">
          <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>
            登录
          </button>
          <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>
            创建账号
          </button>
        </div>

        <form onSubmit={submit} className="auth-form">
          {mode === 'register' && (
            <label className="field">
              <span>昵称</span>
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="怎么称呼你" />
            </label>
          )}
          <label className="field">
            <span>邮箱</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              autoComplete="username"
              required
            />
          </label>
          <label className="field">
            <span>密码</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={mode === 'register' ? '至少 6 位' : '输入密码'}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              required
            />
          </label>

          {error && <p className="form-error">{error}</p>}

          <button className="primary-btn auth-submit" type="submit" disabled={busy}>
            {busy ? '请稍候…' : mode === 'login' ? '登录' : '创建并登录'}
          </button>
        </form>

        <button type="button" className="link-btn auth-server-toggle" onClick={() => setShowServer((value) => !value)}>
          <GearIcon size={15} />
          {showServer ? '收起服务器设置' : '服务器地址'}
        </button>
        {showServer && (
          <div className="server-box">
            <input value={server} onChange={(event) => setServer(event.target.value)} placeholder="http://192.168.1.10:8787" />
            <p className="hint">手机、电脑填同一个地址就能同步。电脑端默认是本机 8787 端口。</p>
          </div>
        )}
      </div>
      <p className="auth-foot">数据保存在你自己的服务器上</p>
    </div>
  );
}
