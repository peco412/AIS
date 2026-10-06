// Scoped keyboard handling for dialogs; cleanup on close and restore focus.
export function manageDialog(panel, cancel, initial = null) {
  const previous = document.activeElement;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.tabIndex = -1;
  const controls = () => [...panel.querySelectorAll('a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(el => el.getClientRects().length && !el.closest('[hidden]'));
  const keydown = e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); }
    if (e.key === 'Tab') {
      const list = controls();
      if (!list.length) { e.preventDefault(); panel.focus(); return; }
      const first = list[0], last = list.at(-1);
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  panel.addEventListener('keydown', keydown);
  (initial || controls()[0] || panel).focus();
  return () => {
    panel.removeEventListener('keydown', keydown);
    if (previous?.isConnected) previous.focus();
  };
}
