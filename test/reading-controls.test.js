import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readingShortcut, filterAnnotations, swipeDirection } from '../public/reading-controls.js';
const context = { reading: true, dialogOpen: false, selectionActive: false };
test('annotation search finds quotes, comments and pages without case sensitivity', () => {
  const annotations = [{ quote: 'A useful idea', comment: 'Follow up', page: 1 }, { quote: 'Another passage', comment: 'Connect this', page: 2 }];
  assert.equal(filterAnnotations(annotations, 'USEFUL')[0], annotations[0]);
  assert.equal(filterAnnotations(annotations, 'connect')[0], annotations[1]);
  assert.equal(filterAnnotations(annotations, 'page 2')[0], annotations[1]);
  assert.equal(filterAnnotations(annotations, 'missing').length, 0);
  assert.equal(filterAnnotations(annotations, '  ').length, 2);
});
test('phone swipes turn pages while scrolling, pinch zoom, selection and panning do not', () => {
  const gesture = { dx: -100, dy: 10, duration: 200, multipleTouches: false, selectionActive: false, horizontallyScrollable: false };
  assert.equal(swipeDirection(gesture), 'next');
  assert.equal(swipeDirection({ ...gesture, dx: 100 }), 'previous');
  for (const extra of [{ dy: 120 }, { dx: 20 }, { duration: 1000 }, { multipleTouches: true }, { selectionActive: true }, { horizontallyScrollable: true }]) assert.equal(swipeDirection({ ...gesture, ...extra }), null);
});
const key = (key, extra = {}, ctx = context) => readingShortcut({ key, target: { tagName: 'BODY' }, ...extra }, ctx);
test('reader supports page navigation and zoom shortcuts', () => {
  assert.equal(key('ArrowRight'), 'next'); assert.equal(key('ArrowLeft'), 'previous');
  assert.equal(key('PageDown'), 'next'); assert.equal(key('PageUp'), 'previous');
  assert.equal(key('+'), 'zoom-in'); assert.equal(key('-'), 'zoom-out'); assert.equal(key('Escape'), 'exit');
});
test('typing notes, editing dialogs and selecting PDF text never turn pages', () => {
  for (const tagName of ['TEXTAREA', 'INPUT', 'SELECT']) assert.equal(key('ArrowRight', { target: { tagName } }), null);
  assert.equal(key('ArrowRight', { target: { isContentEditable: true } }), null);
  assert.equal(key('ArrowRight', {}, { ...context, dialogOpen: true }), null);
  assert.equal(key('ArrowRight', {}, { ...context, selectionActive: true }), null);
  assert.equal(key('ArrowRight', { shiftKey: true }), null);
  assert.equal(key('ArrowRight', { altKey: true }), null);
  assert.equal(key('+', { ctrlKey: true }), null);
  assert.equal(key('ArrowRight', {}, { ...context, reading: false }), null);
});
