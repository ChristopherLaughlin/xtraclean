// Minimal static file server for previewing docs/preview.html
const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const PORT = parseInt(process.argv[2] || '8123', 10);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  // Save endpoint: the screenshot page POSTs rendered PNGs here so we can write
  // real asset files to disk (used only locally for building store assets).
  if (req.method === 'POST' && p === '/__save') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const { name, dataUrl } = JSON.parse(body);
        const b64 = dataUrl.split(',')[1];
        const dir = path.join(ROOT, 'dist', 'store-assets');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, path.basename(name)), Buffer.from(b64, 'base64'));
        res.writeHead(200); res.end('ok');
      } catch (e) { res.writeHead(500); res.end(String(e)); }
    });
    return;
  }
  if (p === '/') p = '/docs/preview.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => console.log('serving ' + ROOT + ' on http://localhost:' + PORT));
