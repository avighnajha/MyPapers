# MyPapers

A quiet, self-hosted reading room for your papers. A single Node process serves a vanilla HTML/CSS/JavaScript app, PDF.js, and a small SQLite library. No frontend build step, cloud account, external fonts, or separate database server.

## What it does

- Organize papers into projects, each with **Queue** and **Read** folders.
- Upload multiple PDFs, drop files onto a folder, and drag library papers between folders. The **Move** button also works with a keyboard or touch.
- Read PDFs with selectable text, page navigation, zoom, download, and opening the original for printing.
- Choose **Full screen** for a focused PDF reader with personal notes on the right and annotation tools available; the annotations list is hidden. **Escape** or **Exit full screen** returns to the normal workspace and restores your panel settings. Browsers that cannot enter native fullscreen still use the focused layout.
- Use **Left/Right arrows** or **Page Up/Page Down** to turn pages, and **+ / −** to zoom. Shortcuts leave typing fields, comment dialogs, and selected PDF text alone.
- Highlight passages in three colors, attach comments, or leave a page note.
- Review annotations with their quoted passages and page numbers; jump to a passage, edit a comment, or copy one/all annotations.
- Write plain-text notes beside the paper. Notes save automatically; the status shows when saving succeeds or needs a retry.
- Rename papers and projects, search paper titles, and hide either side panel for more reading space.
- Search annotation quotes, comments, and page numbers. The top dark-mode toggle remembers your preference in each browser.
- On phones, compact controls sit at the top and the PDF takes the rest of the screen. Notes are hidden by default; tap **Notes** to open or close them. Tap **Annotate** for highlights/comments. Swipe left for the next page or right for the previous page when fitted to the screen; zoomed pages retain horizontal panning. Pinch zoom, vertical scrolling, and text selection do not trigger page turns.

Files, notes, and annotations live on the server, so every browser visiting your instance sees the same library. Reload to see changes from another browser. This is a personal, single-user app, not a collaborative editor: concurrent edits use the last saved version.

## Run locally

Use **Node 24 LTS** (minimum Node 22.13).

```sh
npm ci
npm start
```

Open <http://127.0.0.1:3000>. Development binds to localhost and does not require a password. Local files live in `data/`, which is excluded from Git.

Configuration: `PORT` (3000), `HOST` (127.0.0.1), `DATA_DIR` (`./data`), and `APP_PASSWORD`. For a native Node launch, set these in your shell or service configuration; Node does not automatically load `.env`. Any username is accepted by the browser's sign-in prompt; the password must match `APP_PASSWORD`.

## Deploy on a VPS

Install Docker with Compose, clone this repository, then:

```sh
cp .env.example .env
# Edit .env and set a long, unique APP_PASSWORD.
docker compose up -d --build
```

The application requires a password in production. Docker exposes port 3000 **only on the VPS loopback interface**. Put an HTTPS reverse proxy in front of it. For example, a host-installed Caddy server can use:

```caddyfile
papers.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Point your domain's DNS to the VPS and allow ports 80/443 for Caddy. Preserve the original `Host` header (Caddy does this by default). Use HTTPS because the app uses browser HTTP Basic authentication. Do not publicly expose a passwordless development server.

Then visit your domain from any device, sign in, and upload your papers. The named Docker volume keeps your library across container upgrades. Do not use `docker compose down -v` unless you intend to erase it.

To update:

```sh
git pull
docker compose up -d --build
```

### Backup and restore

Back up the **entire data directory**: `library.sqlite` and `pdfs/` belong together. Stop the app while copying for a consistent snapshot. One simple Docker backup:

```sh
docker compose stop mypapers
docker compose cp mypapers:/app/data ./mypapers-backup
docker compose start mypapers
```

To restore, stop the app and copy the backed-up directory contents back into `/app/data` in the container (or replace `DATA_DIR` for a native deployment), ensuring the `node` user can write it. Start the app again. Keep backups private: they contain your PDFs and notes.

## Scope and storage

- PDFs are limited to 100 MB each. Scanned PDFs can be read and given page notes, but need an existing text layer for text selection; OCR is not included.
- Annotations are stored alongside the original PDF in the library database. Download returns the untouched original; embedding annotations into an exported PDF, freehand drawing, signatures, forms, and PDF editing are not included.
- PDF text is rendered one page at a time to limit memory use. Phone side panels open over the reader; fullscreen hides the annotations list while keeping annotation tools available.
- SQLite runs through `sql.js` without native build tools. Metadata is held in memory and saved with an atomic file replacement after each change. Run **one application process** per data directory. This suits a personal library; it is not intended for a large multi-user service.
- Uses system fonts and serves all assets locally. Your library is not sent to third-party services.

## Validation

```sh
npm test
npm audit
```

The integration tests use a temporary library and test uploads, persistence across restarts, paper moves, notes, annotations, validation, and access protection. They do not touch your actual library.
