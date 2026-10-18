export function selectionBounds(rects, padding = 0) {
  const valid = rects.filter(r => r.width > 0 && r.height > 0);
  if (!valid.length) return null;
  const x = Math.max(0, Math.min(...valid.map(r => r.x)) - padding);
  const y = Math.max(0, Math.min(...valid.map(r => r.y)) - padding);
  const right = Math.min(1, Math.max(...valid.map(r => r.x + r.width)) + padding);
  const bottom = Math.min(1, Math.max(...valid.map(r => r.y + r.height)) + padding);
  return { x, y, width: right - x, height: bottom - y };
}
// One filled path per color prevents overlapping glyph boxes becoming darker.
export function highlightPath(rects) {
  return rects.filter(r => r.width > 0 && r.height > 0).map(r =>
    `M${r.x * 100} ${r.y * 100}h${r.width * 100}v${r.height * 100}h${-r.width * 100}Z`).join(' ');
}
