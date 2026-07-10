// Minimal static server for tests (mirrors _diag.mjs; no deps).
import http from 'http';
import fs from 'fs';
import path from 'path';

const root = process.argv[2] || '.';
const port = Number(process.env.PORT || 8799);
const types = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.glb': 'model/gltf-binary', '.json': 'application/json', '.wasm': 'application/wasm',
};
http.createServer((req, res) => {
  let p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (req.url === '/') p = path.join(root, 'index.html');
  fs.readFile(p, (e, d) => {
    if (e) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
    res.end(d);
  });
}).listen(port, () => console.log(`test server on :${port}`));
