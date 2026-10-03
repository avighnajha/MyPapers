import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readingShortcut } from '../public/reading-controls.js';
const context = { reading: true, dialogOpen: false, selectionActive: false };
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
