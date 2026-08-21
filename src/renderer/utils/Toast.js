/**
 * Non-blocking UI Toast notification system for Orion PWA.
 */
class ToastNotification {
  constructor() {
    this.container = null;
    this.activeToasts = new Set();
  }

  privateInit() {
    if (!this.container) {
      this.container = document.getElementById('toast-container');
      if (!this.container) {
        this.container = document.createElement('div');
        this.container.id = 'toast-container';
        this.container.className = 'toast-container';
        document.body.appendChild(this.container);
      }
    }
  }

  /**
   * Shows a toast message on screen.
   * @param {string} message - Text message to display
   * @param {'error' | 'info' | 'success' | 'warning'} [type='error'] - Type of toast
   * @param {number} [duration=4000] - Duration in ms
   */
  show(message, type = 'error', duration = 4000) {
    if (!message) return;
    this.privateInit();

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    let iconClass = 'fa-solid fa-circle-exclamation';
    if (type === 'success') iconClass = 'fa-solid fa-circle-check';
    else if (type === 'info') iconClass = 'fa-solid fa-circle-info';
    else if (type === 'warning') iconClass = 'fa-solid fa-triangle-exclamation';

    toast.innerHTML = `
      <div class="toast-icon"><i class="${iconClass}"></i></div>
      <div class="toast-message">${this.escapeHtml(message)}</div>
      <button class="toast-close" aria-label="Close">&times;</button>
    `;

    const removeToast = () => {
      if (toast.classList.contains('toast-exit')) return;
      toast.classList.add('toast-exit');
      setTimeout(() => {
        toast.remove();
        this.activeToasts.delete(toast);
      }, 300);
    };

    toast.querySelector('.toast-close')?.addEventListener('click', (e) => {
      e.stopPropagation();
      removeToast();
    });

    toast.addEventListener('click', removeToast);

    this.container.appendChild(toast);
    this.activeToasts.add(toast);

    // Trigger enter animation
    requestAnimationFrame(() => {
      toast.classList.add('toast-visible');
    });

    if (duration > 0) {
      setTimeout(removeToast, duration);
    }
  }

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}

export const Toast = new ToastNotification();
