const region = () => document.querySelector('.toast-region');
export function showToast(message, type = 'info', duration = 3600) {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
  const text = document.createElement('span');
  text.textContent = message;
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.setAttribute('aria-label', 'Fechar notificação');
  dismiss.textContent = '×';
  toast.append(text, dismiss);
  region()?.append(toast);
  const close = () => { toast.classList.add('is-leaving'); window.setTimeout(() => toast.remove(), 180); };
  dismiss.addEventListener('click', close);
  if (duration) window.setTimeout(close, duration);
}
