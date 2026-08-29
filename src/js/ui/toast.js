const region = () => document.querySelector('.toast-region');
export function showToast(message, type = 'info', duration = 3600) {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
  toast.innerHTML = `<span>${message}</span><button type="button" aria-label="Fechar notificação">×</button>`;
  region()?.append(toast);
  const close = () => { toast.classList.add('is-leaving'); window.setTimeout(() => toast.remove(), 180); };
  toast.querySelector('button').addEventListener('click', close);
  if (duration) window.setTimeout(close, duration);
}
