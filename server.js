import express from 'express';
import multer from 'multer';
import initSqlJs from 'sql.js';
import { randomUUID, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const data = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
fs.mkdirSync(path.join(data, 'pdfs'), { recursive: true });
const SQL = await initSqlJs();
const dbFile = path.join(data, 'library.sqlite');
const db = new SQL.Database(fs.existsSync(dbFile) ? fs.readFileSync(dbFile) : undefined);
db.run(`CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS papers (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, status TEXT NOT NULL, title TEXT NOT NULL, filename TEXT NOT NULL, notes TEXT DEFAULT '', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS annotations (id TEXT PRIMARY KEY, paper_id TEXT NOT NULL, page INTEGER NOT NULL, quote TEXT NOT NULL, comment TEXT NOT NULL, color TEXT NOT NULL, rects TEXT NOT NULL, created_at TEXT NOT NULL);`);
function save() { const tmp = dbFile + '.tmp'; fs.writeFileSync(tmp, db.export()); fs.renameSync(tmp, dbFile); }
function rows(sql, params = []) { const stmt = db.prepare(sql); try { stmt.bind(params); const out = []; while (stmt.step()) out.push(stmt.getAsObject()); return out; } finally { stmt.free(); } }
const one = (sql, params) => rows(sql, params)[0];
if (!one('SELECT id FROM projects LIMIT 1')) { db.run('INSERT INTO projects VALUES (?, ?)', [randomUUID(), 'General']); save(); }
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
const password = process.env.APP_PASSWORD;
if (!password && process.env.NODE_ENV === 'production') throw new Error('Set APP_PASSWORD before starting in production.');
const salt = randomBytes(32);
const passwordHash = password ? scryptSync(password, salt, 64) : null;
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cache-Control', 'no-store');
  if (!passwordHash) return next();
  const decoded = Buffer.from((req.headers.authorization || '').replace(/^Basic /, ''), 'base64').toString();
  const supplied = decoded.slice(decoded.indexOf(':') + 1);
  if (!timingSafeEqual(scryptSync(supplied, salt, 64), passwordHash)) return res.set('WWW-Authenticate', 'Basic realm="MyPapers", charset="UTF-8"').status(401).send('Sign in to your library.');
  next();
});
app.use('/api', (req, res, next) => {
  if (!['GET', 'HEAD'].includes(req.method)) {
    const origin = req.headers.origin;
    if (req.headers['sec-fetch-site'] === 'cross-site' || (origin && new URL(origin).host !== req.headers.host)) return res.status(403).json({ error: 'Cross-site requests are not allowed.' });
  }
  next();
});
const validText = (v, max = 200) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const fail = (res, message, status = 400) => res.status(status).json({ error: message });
app.get('/api/library', (req, res) => res.json({ projects: rows('SELECT * FROM projects ORDER BY name COLLATE NOCASE'), papers: rows('SELECT id, project_id, status, title, created_at FROM papers ORDER BY created_at DESC') }));
app.post('/api/projects', (req, res) => { if (!validText(req.body.name)) return fail(res, 'Enter a project name (up to 200 characters).'); const project = { id: randomUUID(), name: req.body.name.trim() }; db.run('INSERT INTO projects VALUES (?, ?)', [project.id, project.name]); save(); res.status(201).json(project); });
app.patch('/api/projects/:id', (req, res) => { if (!validText(req.body.name)) return fail(res, 'Enter a project name.'); if (!one('SELECT id FROM projects WHERE id=?', [req.params.id])) return fail(res, 'Project not found.', 404); db.run('UPDATE projects SET name=? WHERE id=?', [req.body.name.trim(), req.params.id]); save(); res.json({ ok: true }); });
app.delete('/api/projects/:id', (req, res) => { if (one('SELECT id FROM papers WHERE project_id=?', [req.params.id])) return fail(res, 'Move or delete the papers before deleting this project.'); db.run('DELETE FROM projects WHERE id=?', [req.params.id]); save(); res.json({ ok: true }); });
const upload = multer({ dest: path.join(data, 'pdfs'), limits: { fileSize: 100 * 1024 * 1024, files: 1 } });
app.post('/api/papers', upload.single('file'), (req, res) => {
  const file = req.file;
  if (!file) return fail(res, 'Choose a PDF.');
  const reject = message => { fs.unlinkSync(file.path); return fail(res, message); };
  if (!one('SELECT id FROM projects WHERE id=?', [req.body.project_id || ''])) return reject('Choose a valid project.');
  const header = Buffer.alloc(5); const fd = fs.openSync(file.path, 'r'); try { fs.readSync(fd, header, 0, 5, 0); } finally { fs.closeSync(fd); }
  if (header.toString() !== '%PDF-') return reject('This file is not a PDF.');
  const id = randomUUID();
  db.run('INSERT INTO papers (id, project_id, status, title, filename, created_at) VALUES (?, ?, ?, ?, ?, ?)', [id, req.body.project_id, req.body.status === 'read' ? 'read' : 'queue', file.originalname.replace(/\.pdf$/i, '').slice(0, 200), file.filename, new Date().toISOString()]); save(); res.status(201).json({ id });
});
app.param('paperId', (req, res, next, id) => { req.paper = one('SELECT * FROM papers WHERE id=?', [id]); if (!req.paper) return fail(res, 'Paper not found.', 404); next(); });
app.get('/api/papers/:paperId', (req, res) => res.json({ ...req.paper, filename: undefined, annotations: rows('SELECT * FROM annotations WHERE paper_id=? ORDER BY page, created_at', [req.paper.id]).map(a => ({ ...a, rects: JSON.parse(a.rects) })) }));
app.get('/api/papers/:paperId/pdf', (req, res) => { res.type('application/pdf'); res.set('Content-Disposition', `inline; filename="paper.pdf"`); res.sendFile(path.join(data, 'pdfs', req.paper.filename)); });
app.patch('/api/papers/:paperId', (req, res) => {
  const p = { ...req.paper, ...req.body };
  if (!validText(p.title) || !['read', 'queue'].includes(p.status) || typeof p.notes !== 'string' || p.notes.length > 500000 || !one('SELECT id FROM projects WHERE id=?', [p.project_id])) return fail(res, 'Invalid paper details.');
  db.run('UPDATE papers SET title=?, project_id=?, status=?, notes=? WHERE id=?', [p.title.trim(), p.project_id, p.status, p.notes, req.paper.id]); save(); res.json({ ok: true });
});
app.delete('/api/papers/:paperId', (req, res) => { db.run('DELETE FROM annotations WHERE paper_id=?', [req.paper.id]); db.run('DELETE FROM papers WHERE id=?', [req.paper.id]); save(); fs.rmSync(path.join(data, 'pdfs', req.paper.filename), { force: true }); res.json({ ok: true }); });
app.post('/api/papers/:paperId/annotations', (req, res) => {
  const { page, quote = '', comment = '', color = 'yellow', rects = [] } = req.body;
  if (!Number.isInteger(page) || page < 1 || typeof quote !== 'string' || quote.length > 30000 || typeof comment !== 'string' || comment.length > 30000 || !['yellow', 'green', 'pink'].includes(color) || !Array.isArray(rects) || rects.length > 1000 || !rects.every(r => ['x', 'y', 'width', 'height'].every(k => typeof r[k] === 'number' && Number.isFinite(r[k]) && r[k] >= 0 && r[k] <= 1))) return fail(res, 'Invalid annotation.');
  const a = { id: randomUUID(), paper_id: req.paper.id, page, quote, comment, color, rects, created_at: new Date().toISOString() };
  db.run('INSERT INTO annotations VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [a.id, a.paper_id, page, quote, comment, color, JSON.stringify(rects), a.created_at]); save(); res.status(201).json(a);
});
app.patch('/api/papers/:paperId/annotations/:id', (req, res) => { if (typeof req.body.comment !== 'string' || req.body.comment.length > 30000) return fail(res, 'Invalid comment.'); db.run('UPDATE annotations SET comment=? WHERE id=? AND paper_id=?', [req.body.comment, req.params.id, req.paper.id]); save(); res.json({ ok: true }); });
app.delete('/api/papers/:paperId/annotations/:id', (req, res) => { db.run('DELETE FROM annotations WHERE id=? AND paper_id=?', [req.params.id, req.paper.id]); save(); res.json({ ok: true }); });
app.use('/pdfjs', express.static(path.join(root, 'node_modules/pdfjs-dist')));
app.use(express.static(path.join(root, 'public')));
app.use((err, req, res, next) => { console.error(err.message); res.status(err instanceof multer.MulterError ? 400 : 500).json({ error: err instanceof multer.MulterError ? 'Upload failed. PDFs must be smaller than 100 MB.' : 'Something went wrong. Please try again.' }); });
const port = Number(process.env.PORT || 3000);
app.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`MyPapers ready at http://${process.env.HOST || '127.0.0.1'}:${port}${password ? '' : ' (local development, no password)'}`));
