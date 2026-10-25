const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const crypto = require('node:crypto');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = fs.existsSync(path.join(__dirname, 'public')) ? path.join(__dirname, 'public') : __dirname;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const MAX_IMAGE_BYTES = 100 * 1024 * 1024;
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.heic': 'image/heic',
  '.bmp': 'image/bmp'
};

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  response.end(body);
}

function storageKeyFor(contentType) {
  const extension = ({
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/avif': 'avif',
    'image/heic': 'heic',
    'image/bmp': 'bmp',
    'image/svg+xml': 'svg'
  })[contentType] || 'bin';
  return `${Date.now()}-${crypto.randomBytes(9).toString('hex')}.${extension}`;
}

async function stageRequest(request) {
  const tempPath = path.join(os.tmpdir(), `qrforge-${crypto.randomBytes(10).toString('hex')}.upload`);
  let received = 0;
  const limiter = new Transform({
    transform(chunk, encoding, callback) {
      received += chunk.length;
      if (received > MAX_IMAGE_BYTES) {
        callback(new Error('IMAGE_TOO_LARGE'));
        request.destroy();
        return;
      }
      callback(null, chunk);
    }
  });
  try {
    await pipeline(request, limiter, fs.createWriteStream(tempPath));
    return { tempPath, size: received };
  } catch (error) {
    await fsp.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function saveLocalImage(staged, contentType) {
  const fileName = storageKeyFor(contentType);
  const targetPath = path.join(UPLOAD_DIR, fileName);
  await fsp.copyFile(staged.tempPath, targetPath);
  return { path: `/uploads/${fileName}`, contentType };
}

async function uploadImage(request, response) {
  const contentType = String(request.headers['content-type'] || '').split(';')[0].toLowerCase();
  const contentLength = Number(request.headers['content-length'] || 0);
  if (!contentType.startsWith('image/')) {
    request.resume();
    sendJson(response, 415, { error: 'Only image uploads are supported.' });
    return;
  }
  if (contentLength > MAX_IMAGE_BYTES) {
    request.resume();
    sendJson(response, 413, { error: 'That image is larger than the 100 MB upload limit.' });
    return;
  }

  let staged;
  try {
    staged = await stageRequest(request);

    if (!process.env.MANUS_API_URL || !process.env.MANUS_API_KEY) {
      const localFile = await saveLocalImage(staged, contentType);
      sendJson(response, 201, {
        path: localFile.path,
        contentType,
        message: 'Original image saved locally.'
      });
      return;
    }

    const key = `qrforge/images/${storageKeyFor(contentType)}`;
    const presignUrl = `${process.env.MANUS_API_URL}/v1/storage/presign/put?path=${encodeURIComponent(key)}`;
    const presignResponse = await fetch(presignUrl, {
      headers: { Authorization: `Bearer ${process.env.MANUS_API_KEY}` }
    });
    const presign = await presignResponse.json();
    if (!presignResponse.ok || !presign.url) {
      sendJson(response, 502, { error: presign.error || 'Could not prepare image storage.' });
      return;
    }

    const uploadResponse = await fetch(presign.url, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(staged.size)
      },
      body: fs.createReadStream(staged.tempPath),
      duplex: 'half'
    });
    if (!uploadResponse.ok) {
      sendJson(response, 502, { error: 'The original image could not be saved.' });
      return;
    }
    sendJson(response, 201, {
      path: `/manus-storage/${key}`,
      contentType,
      message: 'Original image saved.'
    });
  } catch (error) {
    const tooLarge = error?.message === 'IMAGE_TOO_LARGE';
    if (!response.writableEnded) {
      sendJson(response, tooLarge ? 413 : 502, { error: tooLarge ? 'That image is larger than the 100 MB upload limit.' : 'The original image could not be saved.' });
    }
  } finally {
    if (staged?.tempPath) await fsp.rm(staged.tempPath, { force: true }).catch(() => {});
  }
}

function staticFileFor(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\//, '');
  if (!relative || relative.includes('..') || relative.includes('\\')) return null;
  const filePath = path.join(PUBLIC_DIR, relative);
  return filePath.startsWith(PUBLIC_DIR) ? filePath : null;
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  if (request.method === 'GET' && requestUrl.pathname === '/api/health') {
    sendJson(response, 200, { ok: true, service: 'qrforge' });
    return;
  }
  if (request.method === 'POST' && requestUrl.pathname === '/api/images') {
    await uploadImage(request, response);
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendJson(response, 405, { error: 'Method not allowed.' });
    return;
  }
  const filePath = staticFileFor(requestUrl.pathname);
  if (!filePath) {
    sendJson(response, 404, { error: 'Not found.' });
    return;
  }
  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      sendJson(response, 404, { error: 'Not found.' });
      return;
    }
    response.writeHead(200, {
      'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stats.size,
      'Cache-Control': 'no-cache'
    });
    if (request.method === 'HEAD') response.end();
    else fs.createReadStream(filePath).pipe(response);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`QR Forge listening on 0.0.0.0:${PORT}`);
});
