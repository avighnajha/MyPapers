import assert from 'node:assert/strict';
import test from 'node:test';
import { selectionBounds, highlightPath } from '../public/annotation-visuals.js';
test('equation crop includes superscripts, fractions and subscripts with page-safe padding', () => {
  assert.deepEqual(selectionBounds([{x:.1,y:.2,width:.3,height:.1},{x:.2,y:.1,width:.1,height:.4}], .02), {x:.08,y:.08,width:.34,height:.44});
  assert.deepEqual(selectionBounds([{x:0,y:0,width:1,height:1}], .02), {x:0,y:0,width:1,height:1});
  assert.equal(selectionBounds([]), null);
});
test('highlight geometry retains separate lines in one nonzero fill', () => {
  assert.equal(highlightPath([{x:.1,y:.2,width:.3,height:.1},{x:.1,y:.4,width:.2,height:.1}]), 'M10 20h30v10h-30Z M10 40h20v10h-20Z');
});
