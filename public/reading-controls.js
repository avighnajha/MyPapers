export function readingShortcut(event, { reading, dialogOpen, selectionActive }) {
  if (!reading || dialogOpen || event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return null;
  if (event.key === 'Escape') return 'exit';
  if (event.target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target?.tagName)) return null;
  if (['ArrowRight', 'ArrowLeft', 'PageDown', 'PageUp'].includes(event.key)) {
    if (event.shiftKey || selectionActive) return null;
    return ['ArrowRight', 'PageDown'].includes(event.key) ? 'next' : 'previous';
  }
  if (['+', '='].includes(event.key)) return 'zoom-in';
  if (event.key === '-') return 'zoom-out';
  return null;
}
