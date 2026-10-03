import { readingShortcut, swipeDirection, filterAnnotations } from './reading-controls.js';
import { closePdfSession } from './pdf-session.js';
let pdfjs;
let readingMode = false, ownsFullscreen = false;
function setReadingMode(enabled) {
  readingMode = enabled;
  document.body.classList.toggle('reading-mode', enabled);
  $('#fullscreen').textContent = enabled ? 'Exit full screen' : 'Full screen';
  $('#fullscreen').setAttribute('aria-pressed', String(enabled));
  if (state.pdf && !state.zoom) renderPage().catch(e => toast(e.message));
}
async function exitReadingMode() {
  setReadingMode(false);
  if (ownsFullscreen && document.fullscreenElement) await document.exitFullscreen();
  ownsFullscreen = false;
}
const $ = s => document.querySelector(s);
const state = { projects: [], papers: [], project: null, filter: 'all', paper: null, pdf: null, pdfTask: null, page: 1, zoom: null, selection: null, render: 0, open: 0 };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let toastTimer, noteTimer, savingNotes = null, noteVersion = 0, pendingNotes = null;
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').hidden = true, 4500); }
async function api(url, options = {}) {
  if (options.body && !(options.body instanceof FormData)) { options.headers = { 'Content-Type': 'application/json', ...options.headers }; options.body = JSON.stringify(options.body); }
  const response = await fetch('/api' + url, options);
  if (!response.ok) { const result = await response.json().catch(() => ({})); throw new Error(result.error || `Request failed (${response.status}).`); }
  return response.json();
}
function action(fn) { return (...args) => Promise.resolve().then(() => fn(...args)).catch(e => toast(e.message)); }
function dialog(title, fields, submit = 'Save') {
  return new Promise(resolve => {
    $('#dialog-title').textContent = title; $('#dialog-fields').innerHTML = fields; $('#dialog-submit').textContent = submit;
    const d = $('#form-dialog'); let result = null;
    $('#dialog-form').onsubmit = e => { e.preventDefault(); result = Object.fromEntries(new FormData(e.target)); d.close(); };
    $('#dialog-cancel').onclick = () => d.close();
    d.onclose = () => resolve(result); d.showModal();
    d.querySelector('input,textarea,select')?.focus();
  });
}
async function refresh() { Object.assign(state, await api('/library')); renderLibrary(); }
function renderLibrary() {
  $('#total-count').textContent = state.papers.length;
  $('#all-papers').classList.toggle('active', !state.project);
  $('#folders').innerHTML = state.projects.map(p => `<div class="project"><div class="project-head"><span aria-hidden="true">▱</span><span class="project-name">${esc(p.name)}</span><button class="project-menu" data-project-menu="${p.id}" aria-label="Edit ${esc(p.name)}">···</button></div>${['queue', 'read'].map(status => `<button class="folder ${state.project === p.id && state.filter === status ? 'active' : ''}" data-project="${p.id}" data-status="${status}"><span>${status === 'queue' ? '◷ &nbsp; Queue' : '✓ &nbsp; Read'}</span><span class="count">${state.papers.filter(a => a.project_id === p.id && a.status === status).length}</span></button>`).join('')}</div>`).join('');
  $('#folders').querySelectorAll('.folder').forEach(el => {
    el.onclick = action(() => showLibrary(el.dataset.project, el.dataset.status));
    el.ondragover = e => { e.preventDefault(); el.classList.add('drag-over'); };
    el.ondragleave = () => el.classList.remove('drag-over');
    el.ondrop = action(async e => { e.preventDefault(); el.classList.remove('drag-over'); const id = e.dataTransfer.getData('application/x-mypapers'); if (id) { await api(`/papers/${id}`, { method: 'PATCH', body: { project_id: el.dataset.project, status: el.dataset.status } }); if (state.paper?.id === id) { state.paper.project_id = el.dataset.project; state.paper.status = el.dataset.status; $('#paper-status').value = state.paper.status; } await refresh(); toast('Paper moved.'); } else if (e.dataTransfer.files.length) await uploadFiles(e.dataTransfer.files, el.dataset.project, el.dataset.status); });
  });
  $('#folders').querySelectorAll('[data-project-menu]').forEach(el => el.onclick = action(() => editProject(el.dataset.projectMenu)));
  const project = state.projects.find(p => p.id === state.project);
  $('#library-title').textContent = project ? project.name : 'Your reading room.';
  $('#library-subtitle').textContent = project ? `${state.filter === 'read' ? 'Read, reflected on, and ready to revisit.' : 'Ideas waiting to be explored.'}` : 'Keep the papers. Make the connections.';
  if (!state.paper) $('#breadcrumb').textContent = `Library / ${project?.name || 'All papers'}${project ? ' / ' + (state.filter === 'read' ? 'Read' : 'Queue') : ''}`;
  const term = $('#search').value.toLowerCase();
  const papers = state.papers.filter(p => (!state.project || p.project_id === state.project) && (state.filter === 'all' || p.status === state.filter) && p.title.toLowerCase().includes(term));
  $('#empty').hidden = state.papers.length !== 0;
  $('#paper-list').innerHTML = papers.map(p => `<article class="paper-row" draggable="true" data-paper="${p.id}"><span class="pdf-icon">PDF</span><div class="paper-info"><button class="paper-open" data-open="${p.id}">${esc(p.title)}</button><small>${esc(state.projects.find(project => project.id === p.project_id)?.name || '')} &nbsp; · &nbsp; ${new Date(p.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</small></div><span class="status-chip ${p.status}">${p.status === 'read' ? '✓ Read' : '◷ In queue'}</span><button class="row-move" data-move="${p.id}" aria-label="Move ${esc(p.title)}">↗</button></article>`).join('') || (state.papers.length ? '<p class="no-results">No papers here yet. Drop a PDF into a folder, or add one above.</p>' : '');
  $('#paper-list').querySelectorAll('[data-open]').forEach(el => el.onclick = action(() => openPaper(el.dataset.open)));
  $('#paper-list').querySelectorAll('[data-move]').forEach(el => el.onclick = action(() => movePaper(el.dataset.move)));
  $('#paper-list').querySelectorAll('[draggable]').forEach(el => {
    el.ondragstart = e => { e.dataTransfer.setData('application/x-mypapers', el.dataset.paper); e.dataTransfer.effectAllowed = 'move'; };
    // A pointer handle also supports touch and browsers that do not start native HTML drags.
    const handle = el.querySelector('.pdf-icon');
    handle.title = 'Drag to a project folder';
    handle.onpointerdown = e => {
      if (e.button !== 0) return;
      e.preventDefault(); handle.setPointerCapture(e.pointerId);
      const start = { x: e.clientX, y: e.clientY }; let target = null;
      const clear = () => { target?.classList.remove('drag-over'); el.classList.remove('dragging'); handle.onpointermove = handle.onpointerup = handle.onpointercancel = null; };
      handle.onpointermove = move => {
        if (Math.hypot(move.clientX - start.x, move.clientY - start.y) < 6) return;
        el.classList.add('dragging'); target?.classList.remove('drag-over');
        target = document.elementFromPoint(move.clientX, move.clientY)?.closest('.folder'); target?.classList.add('drag-over');
      };
      handle.onpointerup = action(async up => {
        const folder = target; clear(); if (handle.hasPointerCapture(up.pointerId)) handle.releasePointerCapture(up.pointerId);
        if (!folder) return;
        await api(`/papers/${el.dataset.paper}`, { method: 'PATCH', body: { project_id: folder.dataset.project, status: folder.dataset.status } });
        await refresh(); toast('Paper moved.');
      });
      handle.onpointercancel = clear;
    };
  });
  document.querySelectorAll('[data-filter]').forEach(el => el.classList.toggle('selected', el.dataset.filter === state.filter));
  $('#library-stats').textContent = `${papers.length} paper${papers.length === 1 ? '' : 's'} · ${state.papers.filter(p => p.status === 'read').length} read · ${state.papers.filter(p => p.status === 'queue').length} in queue`;
}
async function showLibrary(project = null, filter = 'all') {
  await exitReadingMode();
  await flushNotes(); ++state.open; ++state.render; state.paper = null; state.selection = null;
  await closePdfSession(state);
  document.body.classList.remove('paper-open');
  state.project = project; state.filter = filter;
  $('#workspace').hidden = true; $('#library').hidden = false; $('#library-button').hidden = true; renderLibrary();
}
function projectOptions(selected) { return state.projects.map(p => `<option value="${p.id}" ${p.id === selected ? 'selected' : ''}>${esc(p.name)}</option>`).join(''); }
async function editProject(id) {
  const p = state.projects.find(p => p.id === id);
  const result = await dialog('Edit project', `<label>Name<input name="name" value="${esc(p.name)}" required maxlength="200"></label><label>Action<select name="action"><option value="rename">Rename project</option><option value="delete">Delete empty project</option></select></label>`);
  if (!result) return;
  await api(`/projects/${id}`, { method: result.action === 'delete' ? 'DELETE' : 'PATCH', ...(result.action === 'delete' ? {} : { body: { name: result.name } }) });
  if (result.action === 'delete' && state.project === id) state.project = null;
  await refresh();
}
async function movePaper(id) {
  const p = state.papers.find(p => p.id === id);
  const result = await dialog('Move paper', `<label>Project<select name="project_id">${projectOptions(p.project_id)}</select></label><label>Folder<select name="status"><option value="queue" ${p.status === 'queue' ? 'selected' : ''}>Queue</option><option value="read" ${p.status === 'read' ? 'selected' : ''}>Read</option></select></label>`, 'Move paper');
  if (!result) return; await api(`/papers/${id}`, { method: 'PATCH', body: result });
  if (state.paper?.id === id) { Object.assign(state.paper, result); $('#paper-status').value = result.status; }
  await refresh(); toast('Paper moved.');
}
async function chooseUpload() {
  if (!state.projects.length) { toast('Create a project first.'); return; }
  const result = await dialog('Add papers', `<label>Project<select name="project_id">${projectOptions(state.project || state.projects[0].id)}</select></label><label>Folder<select name="status"><option value="queue">Queue</option><option value="read" ${state.filter === 'read' ? 'selected' : ''}>Read</option></select></label>`, 'Choose PDFs');
  if (!result) return;
  $('#file-input').onchange = action(async e => { await uploadFiles(e.target.files, result.project_id, result.status); e.target.value = ''; });
  $('#file-input').click();
}
async function uploadFiles(files, project, status) {
  let count = 0; const errors = [];
  for (const file of [...files]) { const form = new FormData(); form.append('file', file); form.append('project_id', project); form.append('status', status); toast(`Uploading ${file.name}…`); try { await api('/papers', { method: 'POST', body: form }); count++; } catch (e) { errors.push(`${file.name}: ${e.message}`); } }
  await refresh(); toast(errors.length ? `${count} uploaded. ${errors.join(' ')}` : `${count} paper${count === 1 ? '' : 's'} added to your library.`);
}
async function openPaper(id) {
  await flushNotes(); const token = ++state.open; ++state.render;
  await closePdfSession(state);
  const paper = await api(`/papers/${id}`); if (token !== state.open) return;
  state.paper = paper; state.page = 1; state.zoom = null; state.selection = null;
  document.body.classList.add('paper-open');
  document.body.classList.remove('mobile-tools-open');
  $('#annotation-search').value = '';
  if (window.matchMedia('(max-width: 760px)').matches) {
    $('#notes-panel').hidden = true; $('#comments-panel').hidden = true;
    $('#toggle-notes').setAttribute('aria-pressed', 'false'); $('#mobile-notes').setAttribute('aria-pressed', 'false');
    $('#toggle-comments').setAttribute('aria-pressed', 'false'); $('#mobile-comments').setAttribute('aria-pressed', 'false');
    $('#mobile-tools').setAttribute('aria-pressed', 'false');
  }
  $('#library').hidden = true; $('#workspace').hidden = false; $('#library-button').hidden = false;
  $('#paper-title').textContent = paper.title; $('#paper-status').value = paper.status;
  $('#breadcrumb').textContent = `Library / ${state.projects.find(p => p.id === paper.project_id)?.name || 'Paper'}`;
  $('#notes').value = paper.notes; $('#save-state').textContent = 'Saved'; updateWordCount(); renderAnnotations(); renderBookmarks();
  $('#download').href = `/api/papers/${id}/pdf`; $('#download').download = `${paper.title}.pdf`; $('#open-pdf').href = `/api/papers/${id}/pdf`;
  $('#pdf-page').hidden = true; $('#pdf-status').textContent = 'Opening your paper…';
  try {
    pdfjs ||= await import('/pdfjs/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/build/pdf.worker.mjs';
    if (token !== state.open) return;
    const task = pdfjs.getDocument({ url: `/api/papers/${id}/pdf`, cMapUrl: '/pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: '/pdfjs/standard_fonts/', wasmUrl: '/pdfjs/wasm/', isEvalSupported: false });
    state.pdfTask = task;
    const pdf = await task.promise;
    if (token !== state.open) { await task.destroy(); return; }
    state.pdf = pdf; $('#page-count').textContent = `/ ${pdf.numPages}`; $('#page-number').max = pdf.numPages;
    await renderPage();
  } catch (e) { if (token === state.open) $('#pdf-status').textContent = `Unable to display this PDF: ${e.message}. You can still download the original.`; }
}
async function renderPage() {
  if (!state.pdf) return;
  const token = ++state.render, pdf = state.pdf, number = state.page; state.selection = null;
  const page = await pdf.getPage(number); if (token !== state.render) return;
  const base = page.getViewport({ scale: 1 });
  const scrollStyle = getComputedStyle($('#pdf-scroll'));
  const padding = parseFloat(scrollStyle.paddingLeft) + parseFloat(scrollStyle.paddingRight);
  const scale = state.zoom || Math.max(.25, ($('#pdf-scroll').clientWidth - padding - 2) / base.width);
  const viewport = page.getViewport({ scale });
  // Render offscreen so changing pages quickly never reuses an active canvas.
  const canvas = document.createElement('canvas'); canvas.id = 'pdf-canvas';
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(viewport.width * ratio); canvas.height = Math.floor(viewport.height * ratio); canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
  await page.render({ canvasContext: canvas.getContext('2d'), viewport, transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0] }).promise;
  if (token !== state.render) return;
  const layer = document.createElement('div'); layer.id = 'text-layer'; layer.className = 'textLayer';
  const container = $('#pdf-page'); container.hidden = false; container.style.width = `${viewport.width}px`; container.style.height = `${viewport.height}px`; container.style.setProperty('--scale-factor', scale); container.style.setProperty('--total-scale-factor', scale);
  $('#pdf-canvas').replaceWith(canvas); $('#text-layer').replaceWith(layer);
  await new pdfjs.TextLayer({ textContentSource: await page.getTextContent(), container: layer, viewport }).render();
  if (token !== state.render) return;
  $('#pdf-status').textContent = ''; $('#page-number').value = number; $('#prev-page').disabled = number === 1; $('#next-page').disabled = number === pdf.numPages;
  $('#zoom-fit').textContent = state.zoom ? `${Math.round(scale * 100)}%` : 'Fit';
  renderHighlights();
  renderBookmarks();
}
function renderBookmarks() {
  const pages = state.paper?.bookmarks || [];
  const saved = pages.includes(state.page);
  $('#bookmark-page').textContent = saved ? '★' : '☆';
  $('#bookmark-page').setAttribute('aria-pressed', String(saved));
  $('#bookmark-page').setAttribute('aria-label', saved ? `Remove bookmark from page ${state.page}` : `Bookmark page ${state.page}`);
  $('#bookmark-page').title = saved ? 'Remove page bookmark' : 'Bookmark this page';
  $('#bookmark-list').innerHTML = `<option value="">Bookmarks (${pages.length})</option>` + pages.map(page => `<option value="${page}">Page ${page}</option>`).join('');
  $('#bookmark-list').disabled = !pages.length;
}
$('#bookmark-page').onclick = action(async () => {
  if (!state.paper || !state.pdf || $('#bookmark-page').disabled) return;
  const paper = state.paper, page = state.page, saved = paper.bookmarks.includes(page);
  $('#bookmark-page').disabled = true;
  try {
    await api(`/papers/${paper.id}/bookmarks/${page}`, { method: saved ? 'DELETE' : 'PUT' });
    paper.bookmarks = saved ? paper.bookmarks.filter(p => p !== page) : [...new Set([...paper.bookmarks, page])].sort((a, b) => a - b);
    if (state.paper === paper) renderBookmarks();
    toast(saved ? 'Bookmark removed.' : `Page ${page} bookmarked.`);
  } finally { $('#bookmark-page').disabled = false; }
});
$('#bookmark-list').onchange = action(async () => {
  const page = Number($('#bookmark-list').value);
  if (!state.pdf || !page) return;
  if (page > state.pdf.numPages) { renderBookmarks(); toast('This bookmark is outside the PDF page range.'); return; }
  state.page = page; await renderPage(); $('#pdf-scroll').scrollTop = 0;
});
function captureSelection() {
  const sel = window.getSelection(); if (!sel || sel.isCollapsed || !sel.rangeCount || !state.paper) return;
  const range = sel.getRangeAt(0), layer = $('#text-layer');
  if (!layer.contains(range.startContainer) || !layer.contains(range.endContainer)) return;
  const quote = sel.toString().trim(); if (!quote) return;
  const box = $('#pdf-page').getBoundingClientRect();
  const clamp = n => Math.max(0, Math.min(1, n));
  const rects = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0).map(r => ({ x: clamp((r.left - box.left) / box.width), y: clamp((r.top - box.top) / box.height), width: clamp(r.width / box.width), height: clamp(r.height / box.height) }));
  state.selection = { page: state.page, quote, rects };
}
async function addAnnotation(withComment, pageOnly = false) {
  if (!state.paper || !state.pdf) return;
  const selection = pageOnly ? { page: state.page, quote: '', rects: [] } : state.selection;
  if (!selection) { toast('Select a passage in the PDF first.'); return; }
  const id = state.paper.id; let comment = '';
  if (withComment) { const result = await dialog(pageOnly ? 'Note on this page' : 'A thought on this passage', `${selection.quote ? `<blockquote>${esc(selection.quote)}</blockquote>` : ''}<label>Comment<textarea name="comment" maxlength="30000" placeholder="What would you like to remember?" required></textarea></label>`, 'Save comment'); if (!result) return; comment = result.comment; }
  const a = await api(`/papers/${id}/annotations`, { method: 'POST', body: { ...selection, comment, color: $('#highlight-color').value } });
  if (state.paper?.id === id) { state.paper.annotations.push(a); renderAnnotations(); renderHighlights(); state.selection = null; window.getSelection()?.removeAllRanges(); }
  toast(withComment ? 'Comment saved.' : 'Highlight saved.');
}
function renderHighlights() { $('#highlights').innerHTML = (state.paper?.annotations || []).filter(a => a.page === state.page).flatMap(a => a.rects.map(r => `<span class="highlight-rect ${a.color}" style="left:${r.x * 100}%;top:${r.y * 100}%;width:${r.width * 100}%;height:${r.height * 100}%"></span>`)).join(''); }
function annotationText(a) { return `Page ${a.page}${a.quote ? '\n> ' + a.quote.replace(/\n/g, '\n> ') : ''}${a.comment ? '\n\n' + a.comment : ''}`; }
async function copy(text) { try { await navigator.clipboard.writeText(text); toast('Copied to clipboard.'); } catch { await dialog('Copy this text', `<label>Select and copy<textarea readonly>${esc(text)}</textarea></label>`, 'Done'); } }
function renderAnnotations() {
  const annotations = filterAnnotations(state.paper.annotations, $('#annotation-search').value).sort((a, b) => a.page - b.page || a.created_at.localeCompare(b.created_at));
  $('#annotation-count').textContent = $('#annotation-search').value ? `${annotations.length}/${state.paper.annotations.length}` : annotations.length;
  $('#annotations').innerHTML = annotations.length ? annotations.map(a => `<article class="annotation-card ${a.color}" data-annotation="${a.id}"><button class="page-link" data-page="${a.page}">PAGE ${a.page} ↗</button>${a.quote ? `<blockquote>${esc(a.quote)}</blockquote>` : ''}${a.comment ? `<p>${esc(a.comment)}</p>` : ''}<div class="annotation-actions"><button data-copy="${a.id}">Copy</button><button data-edit="${a.id}">${a.comment ? 'Edit' : 'Add comment'}</button><button data-delete="${a.id}">Delete</button></div></article>`).join('') : '<div class="annotations-empty">Leave a trail of thoughts.<br><br>Select a passage to highlight it or attach a comment. Your passages and comments will appear here, ready to copy.</div>';
  if (!annotations.length && $('#annotation-search').value) $('#annotations').innerHTML = '<p class="annotations-empty">No matching annotations.</p>';
  $('#annotations').querySelectorAll('[data-page]').forEach(el => el.onclick = action(async () => { state.page = Number(el.dataset.page); if (window.matchMedia('(max-width: 760px)').matches) $('#comments-panel').hidden = true; await renderPage(); const a = state.paper.annotations.find(a => a.id === el.closest('[data-annotation]').dataset.annotation); const rect = a?.rects[0]; $('#pdf-scroll').scrollTo({ top: rect ? rect.y * $('#pdf-page').offsetHeight : 0, behavior: 'smooth' }); }));
  $('#annotations').querySelectorAll('[data-copy]').forEach(el => el.onclick = action(() => copy(annotationText(annotations.find(a => a.id === el.dataset.copy)))));
  $('#annotations').querySelectorAll('[data-edit]').forEach(el => el.onclick = action(async () => { const a = annotations.find(a => a.id === el.dataset.edit), id = state.paper.id; const result = await dialog('Edit comment', `<label>Comment<textarea name="comment" maxlength="30000">${esc(a.comment)}</textarea></label>`); if (!result) return; await api(`/papers/${id}/annotations/${a.id}`, { method: 'PATCH', body: result }); a.comment = result.comment; if (state.paper?.id === id) renderAnnotations(); }));
  $('#annotations').querySelectorAll('[data-delete]').forEach(el => el.onclick = action(async () => { const id = state.paper.id; await api(`/papers/${id}/annotations/${el.dataset.delete}`, { method: 'DELETE' }); if (state.paper?.id === id) { state.paper.annotations = state.paper.annotations.filter(a => a.id !== el.dataset.delete); renderAnnotations(); renderHighlights(); } }));
}
function updateWordCount() { const n = $('#notes').value.trim().split(/\s+/).filter(Boolean).length; $('#word-count').textContent = `${n} word${n === 1 ? '' : 's'}`; }
async function flushNotes() {
  clearTimeout(noteTimer);
  if (savingNotes) { await savingNotes; if (pendingNotes) return flushNotes(); return; }
  if (!pendingNotes) return;
  savingNotes = (async () => {
    while (pendingNotes) {
      const draft = pendingNotes; pendingNotes = null;
      try { await api(`/papers/${draft.id}`, { method: 'PATCH', body: { notes: draft.notes } }); if (state.paper?.id === draft.id && draft.version === noteVersion) $('#save-state').textContent = 'Saved'; }
      catch (error) { if (!pendingNotes || pendingNotes.version < draft.version) pendingNotes = draft; if (state.paper?.id === draft.id) $('#save-state').textContent = 'Not saved · retrying'; noteTimer = setTimeout(() => flushNotes().catch(() => {}), 4000); throw error; }
    }
  })();
  try { await savingNotes; } finally { savingNotes = null; }
}
$('#notes').oninput = () => { if (!state.paper) return; state.paper.notes = $('#notes').value; pendingNotes = { id: state.paper.id, notes: state.paper.notes, version: ++noteVersion }; $('#save-state').textContent = 'Saving…'; updateWordCount(); clearTimeout(noteTimer); noteTimer = setTimeout(() => flushNotes().catch(e => toast(e.message)), 650); };
window.addEventListener('beforeunload', e => { if (pendingNotes || $('#save-state').textContent !== 'Saved') { e.preventDefault(); e.returnValue = ''; } });
$('#add-project').onclick = action(async () => { const result = await dialog('A new project', '<label>Name<input name="name" placeholder="e.g. Machine learning" required maxlength="200"></label>', 'Create project'); if (!result) return; await api('/projects', { method: 'POST', body: result }); await refresh(); });
$('#all-papers').onclick = action(() => showLibrary()); $('#library-button').onclick = action(() => showLibrary(state.project, state.filter));
document.querySelectorAll('[data-filter]').forEach(el => el.onclick = () => { state.filter = el.dataset.filter; renderLibrary(); });
$('#search').oninput = renderLibrary;
['upload', 'upload-main', 'upload-empty'].forEach(id => $('#' + id).onclick = action(chooseUpload));
$('#library').ondragover = e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); };
$('#library').ondrop = action(async e => { if (!e.dataTransfer.files.length) return; e.preventDefault(); if (!state.projects.length) { toast('Create a project first.'); return; } await uploadFiles(e.dataTransfer.files, state.project || state.projects[0].id, state.filter === 'read' ? 'read' : 'queue'); });
document.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
document.addEventListener('drop', e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
$('#paper-status').onchange = action(async () => { await api(`/papers/${state.paper.id}`, { method: 'PATCH', body: { status: $('#paper-status').value } }); state.paper.status = $('#paper-status').value; await refresh(); });
$('#rename-paper').onclick = action(async () => { const result = await dialog('Rename paper', `<label>Title<input name="title" value="${esc(state.paper.title)}" maxlength="200" required></label>`); if (!result) return; await api(`/papers/${state.paper.id}`, { method: 'PATCH', body: result }); state.paper.title = result.title; $('#paper-title').textContent = result.title; await refresh(); });
$('#move-paper').onclick = action(() => movePaper(state.paper.id));
$('#delete-paper').onclick = action(async () => { const result = await dialog('Delete this paper?', '<p>This removes the PDF, notes, and annotations from your library.</p>', 'Delete paper'); if (!result) return; await flushNotes(); await api(`/papers/${state.paper.id}`, { method: 'DELETE' }); await showLibrary(); await refresh(); toast('Paper deleted.'); });
for (const name of ['notes', 'comments']) $('#' + 'toggle-' + name).onclick = action(async () => { const panel = $('#' + name + '-panel'); panel.hidden = !panel.hidden; $('#toggle-' + name).setAttribute('aria-pressed', !panel.hidden); if (!state.zoom) await renderPage(); });
$('#prev-page').onclick = action(async () => { if (state.page > 1) { --state.page; await renderPage(); $('#pdf-scroll').scrollTop = 0; } });
$('#next-page').onclick = action(async () => { if (state.pdf && state.page < state.pdf.numPages) { ++state.page; await renderPage(); $('#pdf-scroll').scrollTop = 0; } });
$('#page-number').onchange = action(async () => { if (!state.pdf) return; state.page = Math.max(1, Math.min(state.pdf.numPages, Math.floor(Number($('#page-number').value)) || 1)); await renderPage(); $('#pdf-scroll').scrollTop = 0; });
for (const [id, factor] of [['zoom-in', 1.2], ['zoom-out', 1 / 1.2]]) $('#' + id).onclick = action(async () => { if (!state.pdf) return; const page = await state.pdf.getPage(state.page); const fit = ($('#pdf-scroll').clientWidth - 36) / page.getViewport({ scale: 1 }).width; state.zoom = Math.max(.25, Math.min(3, (state.zoom || fit) * factor)); await renderPage(); });
$('#zoom-fit').onclick = action(async () => { state.zoom = null; await renderPage(); });
$('#annotation-search').oninput = () => { if (state.paper) renderAnnotations(); };
function applyTheme(dark) {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelectorAll('[data-theme-toggle]').forEach(button => {
    button.textContent = dark ? 'Light mode' : 'Dark mode'; button.setAttribute('aria-pressed', String(dark));
  });
  try { localStorage.setItem('mypapers-theme', dark ? 'dark' : 'light'); } catch {}
}
let savedTheme; try { savedTheme = localStorage.getItem('mypapers-theme'); } catch {}
applyTheme(savedTheme ? savedTheme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches);
document.querySelectorAll('[data-theme-toggle]').forEach(button => button.onclick = () => applyTheme(document.documentElement.dataset.theme !== 'dark'));
$('#mobile-library').onclick = action(() => showLibrary(state.project, state.filter));
for (const name of ['notes', 'comments']) $('#mobile-' + name).onclick = action(async () => {
  const panel = $('#' + name + '-panel'); panel.hidden = !panel.hidden;
  $('#mobile-' + name).setAttribute('aria-pressed', String(!panel.hidden));
  $('#toggle-' + name).setAttribute('aria-pressed', String(!panel.hidden));
  if (!panel.hidden) { const other = name === 'notes' ? 'comments' : 'notes'; $('#' + other + '-panel').hidden = true; $('#mobile-' + other).setAttribute('aria-pressed', 'false'); }
});
$('#mobile-tools').onclick = () => {
  const enabled = document.body.classList.toggle('mobile-tools-open');
  $('#mobile-tools').setAttribute('aria-pressed', String(enabled));
};
let swipeStart;
$('#pdf-scroll').addEventListener('touchstart', event => {
  if (event.touches.length !== 1) { swipeStart = null; return; }
  const touch = event.touches[0]; swipeStart = { x: touch.clientX, y: touch.clientY, time: performance.now() };
}, { passive: true });
$('#pdf-scroll').addEventListener('touchmove', event => { if (event.touches.length !== 1) swipeStart = null; }, { passive: true });
$('#pdf-scroll').addEventListener('touchcancel', () => swipeStart = null, { passive: true });
$('#pdf-scroll').addEventListener('touchend', event => {
  if (!swipeStart || !state.pdf || !window.matchMedia('(max-width: 760px)').matches) return;
  const start = swipeStart; swipeStart = null; const touch = event.changedTouches[0]; if (!touch) return;
  const scroll = $('#pdf-scroll');
  const direction = swipeDirection({ dx: touch.clientX - start.x, dy: touch.clientY - start.y, duration: performance.now() - start.time, multipleTouches: event.touches.length > 0, selectionActive: !window.getSelection()?.isCollapsed, horizontallyScrollable: scroll.scrollWidth > scroll.clientWidth + 3 });
  if (direction) { const button = $(direction === 'next' ? '#next-page' : '#prev-page'); if (!button.disabled) button.click(); }
}, { passive: true });
$('#fullscreen').onclick = action(async () => {
  if (readingMode) return exitReadingMode();
  setReadingMode(true);
  if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
    try { await document.documentElement.requestFullscreen(); ownsFullscreen = true; }
    catch { toast('Reading mode is on. Your browser did not allow full screen; press Escape to return.'); }
  }
});
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && ownsFullscreen) { ownsFullscreen = false; setReadingMode(false); }
});
document.addEventListener('keydown', event => {
  const shortcut = readingShortcut(event, { reading: Boolean(state.pdf && state.paper), dialogOpen: $('#form-dialog').open, selectionActive: !window.getSelection()?.isCollapsed });
  if (!shortcut || (shortcut === 'exit' && !readingMode)) return;
  event.preventDefault();
  if (shortcut === 'exit') { exitReadingMode().catch(e => toast(e.message)); return; }
  const button = $({ next: '#next-page', previous: '#prev-page', 'zoom-in': '#zoom-in', 'zoom-out': '#zoom-out' }[shortcut]);
  if (!button.disabled) button.click();
});
document.addEventListener('mouseup', captureSelection); document.addEventListener('keyup', captureSelection);
$('#highlight').onclick = action(() => addAnnotation(false)); $('#comment').onclick = action(() => addAnnotation(true)); $('#page-comment').onclick = action(() => addAnnotation(true, true));
$('#copy-notes').onclick = action(() => copy(state.paper.notes)); $('#copy-comments').onclick = action(() => copy(`# ${state.paper.title}\n\n` + [...state.paper.annotations].sort((a, b) => a.page - b.page).map(annotationText).join('\n\n---\n\n')));
let resizeTimer; window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (state.pdf && !state.zoom) renderPage().catch(e => toast(e.message)); }, 200); });
refresh().catch(e => toast(`Could not load your library. ${e.message}`));
