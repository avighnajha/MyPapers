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

export function filterAnnotations(annotations, query) {
  const term = query.trim().toLowerCase();
  return annotations.filter(a => !term || `${a.quote}\n${a.comment}\npage ${a.page}`.toLowerCase().includes(term));
}

export function swipeDirection({ dx, dy, duration, multipleTouches, selectionActive, horizontallyScrollable }) {
  if (multipleTouches || selectionActive || horizontallyScrollable || duration > 650 || Math.abs(dx) < 65 || Math.abs(dx) < Math.abs(dy) * 1.5) return null;
  return dx < 0 ? 'next' : 'previous';
}
