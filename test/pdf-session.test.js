import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { closePdfSession } from '../public/pdf-session.js';
import { samplePdf } from './fixtures.js';

test('a real PDF.js 6 document closes through its loading task and can reopen', async () => {
  const state = { pdf: null, pdfTask: getDocument({ data: new Uint8Array(samplePdf()) }) };
  state.pdf = await state.pdfTask.promise;
  assert.equal(state.pdf.numPages, 2);
  await closePdfSession(state);
  assert.equal(state.pdf, null); assert.equal(state.pdfTask, null);
  await closePdfSession(state);
  state.pdfTask = getDocument({ data: new Uint8Array(samplePdf()) });
  state.pdf = await state.pdfTask.promise;
  assert.equal((await state.pdf.getPage(2)).pageNumber, 2);
  await closePdfSession(state);
});
