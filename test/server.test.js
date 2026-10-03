import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { samplePdf } from './fixtures.js';

async function launch(data, env = {}) {
  const proc = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: '0', HOST: '127.0.0.1', DATA_DIR: data, APP_PASSWORD: '', NODE_ENV: 'test', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { proc.kill(); reject(new Error('Server did not start: ' + output)); }, 10000);
    proc.stdout.on('data', chunk => { output += chunk; const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/); if (match) { clearTimeout(timer); resolve(match[0]); } });
    proc.stderr.on('data', chunk => output += chunk);
    proc.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${output}`)); });
  });
  return { url, async stop() { if (proc.exitCode !== null) return; const done = once(proc, 'exit'); proc.kill(); await done; } };
}
const json = body => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
test('library workflow persists files, moves, notes and annotations across a restart', async () => {
  const data = await mkdtemp(path.join(tmpdir(), 'mypapers-test-')); let server;
  try {
    server = await launch(data);
    const request = (route, options) => fetch(server.url + '/api' + route, options);
    const library = await (await request('/library')).json(); const project = library.projects[0].id;
    let response = await request('/projects', { method: 'POST', ...json({ name: 'Research' }) }); assert.equal(response.status, 201); const other = (await response.json()).id;
    const form = new FormData(); form.append('file', new Blob([samplePdf()], { type: 'application/pdf' }), 'Study.pdf'); form.append('project_id', project); form.append('status', 'queue');
    response = await request('/papers', { method: 'POST', body: form }); assert.equal(response.status, 201); const id = (await response.json()).id;
    response = await request(`/papers/${id}/pdf`); assert.equal(response.headers.get('content-type'), 'application/pdf'); assert.deepEqual(Buffer.from(await response.arrayBuffer()), samplePdf());
    response = await request(`/papers/${id}`, { method: 'PATCH', ...json({ project_id: other, status: 'read', notes: 'A connection worth revisiting.' }) }); assert.equal(response.status, 200);
    const annotation = { page: 1, quote: 'Reading becomes useful', comment: 'Connect this to the next paper.', color: 'green', rects: [{ x: .1, y: .2, width: .3, height: .02 }] };
    response = await request(`/papers/${id}/annotations`, { method: 'POST', ...json(annotation) }); assert.equal(response.status, 201); const aid = (await response.json()).id;
    for (const page of [2, 1, 2]) assert.equal((await request(`/papers/${id}/bookmarks/${page}`, { method: 'PUT' })).status, 200);
    assert.equal((await request(`/papers/${id}/bookmarks/0`, { method: 'PUT' })).status, 400);
    assert.equal((await request(`/papers/${id}/bookmarks/1.5`, { method: 'PUT' })).status, 400);
    await server.stop(); server = await launch(data);
    const saved = await (await request(`/papers/${id}`)).json(); assert.equal(saved.notes, 'A connection worth revisiting.'); assert.equal(saved.project_id, other); assert.equal(saved.status, 'read'); assert.equal(saved.annotations[0].quote, annotation.quote); assert.deepEqual(saved.annotations[0].rects, annotation.rects);
    assert.deepEqual(saved.bookmarks, [1, 2]);
    assert.equal((await request(`/papers/${id}/bookmarks/1`, { method: 'DELETE' })).status, 200);
    assert.deepEqual((await (await request(`/papers/${id}`)).json()).bookmarks, [2]);
    response = await request(`/projects/${other}`, { method: 'DELETE' }); assert.equal(response.status, 400);
    response = await request(`/papers/${id}/annotations/${aid}`, { method: 'PATCH', ...json({ comment: 'Revised thought.' }) }); assert.equal(response.status, 200);
    assert.equal((await (await request(`/papers/${id}`)).json()).annotations[0].comment, 'Revised thought.');
    await request(`/papers/${id}/annotations/${aid}`, { method: 'DELETE' }); assert.equal((await (await request(`/papers/${id}`)).json()).annotations.length, 0);
    await request(`/papers/${id}`, { method: 'DELETE' }); assert.equal((await request(`/papers/${id}`)).status, 404); assert.equal((await readdir(path.join(data, 'pdfs'))).length, 0);
    response = await request(`/projects/${other}`, { method: 'DELETE' }); assert.equal(response.status, 200);
  } finally { await server?.stop(); await rm(data, { recursive: true, force: true }); }
});
test('invalid uploads and cross-site changes are rejected without leaving files', async () => {
  const data = await mkdtemp(path.join(tmpdir(), 'mypapers-test-')); let server;
  try {
    server = await launch(data);
    const library = await (await fetch(server.url + '/api/library')).json();
    const form = new FormData(); form.append('file', new Blob(['not a PDF']), 'fake.pdf'); form.append('project_id', library.projects[0].id);
    assert.equal((await fetch(server.url + '/api/papers', { method: 'POST', body: form })).status, 400);
    assert.equal((await readdir(path.join(data, 'pdfs'))).length, 0);
    assert.equal((await fetch(server.url + '/api/projects', { method: 'POST', ...json({ name: '' }) })).status, 400);
    assert.equal((await fetch(server.url + '/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://untrusted.example' }, body: JSON.stringify({ name: 'Injected' }) })).status, 403);
  } finally { await server?.stop(); await rm(data, { recursive: true, force: true }); }
});
test('production access requires the configured password for files and APIs', async () => {
  const data = await mkdtemp(path.join(tmpdir(), 'mypapers-test-')); let server;
  try {
    server = await launch(data, { APP_PASSWORD: 'test-only-password', NODE_ENV: 'production' });
    for (const route of ['/', '/api/library', '/app.js']) assert.equal((await fetch(server.url + route)).status, 401);
    const auth = 'Basic ' + Buffer.from('reader:test-only-password').toString('base64');
    assert.equal((await fetch(server.url + '/api/library', { headers: { Authorization: auth } })).status, 200);
  } finally { await server?.stop(); await rm(data, { recursive: true, force: true }); }
});
