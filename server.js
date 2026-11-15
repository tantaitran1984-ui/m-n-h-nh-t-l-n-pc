/**
 * SERVER.JS - NODE.JS BACKEND FOR LOCAL & CLOUD DEPLOYMENT (RENDER.COM, RAILWAY, VERCEL)
 * Uses standard Node.js libraries (0 external npm dependencies needed!)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 8080;
const DATA_DIR = path.join(__dirname, 'assets', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

// Ensure data directory and users file exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(USERS_FILE)) {
  fs.writeFileSync(USERS_FILE, '[]', 'utf8');
}

// In-memory Mirror Sessions & Signals
const mirrorSessions = {}; // code -> { user, created, signalsToPC, signalsToPhone }
const frameRelay = {};     // code -> base64 frame

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (err) {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // ================= API ENDPOINTS =================
  if (pathname.startsWith('/api/')) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    try {
      // 1. Info Endpoint
      if (pathname === '/api/info') {
        res.end(JSON.stringify({
          status: 'online',
          port: PORT,
          environment: process.env.NODE_ENV || 'production'
        }));
        return;
      }

      // 2. Register Endpoint
      if (pathname === '/api/register' && req.method === 'POST') {
        const body = await readBody(req);
        const uName = (body.username || '').trim().toLowerCase();
        const uPass = body.password || '';
        const dName = body.name || uName;

        let users = [];
        try {
          users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8') || '[]');
        } catch (e) {}

        const exists = users.some(u => u.username.toLowerCase() === uName);
        if (exists) {
          res.statusCode = 400;
          res.end(JSON.stringify({ success: false, message: 'Tên tài khoản này đã được sử dụng!' }));
          return;
        }

        const newUser = { username: uName, password: uPass, name: dName };
        users.push(newUser);
        fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');

        res.end(JSON.stringify({ success: true, user: { username: uName, name: dName } }));
        return;
      }

      // 3. Login Endpoint
      if (pathname === '/api/login' && req.method === 'POST') {
        const body = await readBody(req);
        const uName = (body.username || '').trim().toLowerCase();
        const uPass = body.password || '';

        let users = [];
        try {
          users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8') || '[]');
        } catch (e) {}

        const matched = users.find(u => u.username.toLowerCase() === uName && u.password === uPass);
        if (matched) {
          res.end(JSON.stringify({ success: true, user: { username: matched.username, name: matched.name } }));
        } else {
          res.statusCode = 401;
          res.end(JSON.stringify({ success: false, message: 'Tên đăng nhập hoặc mật khẩu không chính xác!' }));
        }
        return;
      }

      // 4. Register Mirror Code
      if (pathname === '/api/mirror/register-code' && req.method === 'POST') {
        const body = await readBody(req);
        const code = (body.code || '').trim();
        mirrorSessions[code] = {
          code: code,
          user: body.username,
          created: Date.now(),
          signalsToPC: [],
          signalsToPhone: []
        };
        res.end(JSON.stringify({ success: true, code: code }));
        return;
      }

      // 5. Check Mirror Code
      if (pathname === '/api/mirror/check-code' && req.method === 'GET') {
        const code = parsedUrl.query.code;
        if (code && mirrorSessions[code]) {
          res.end(JSON.stringify({ success: true, found: true, session: mirrorSessions[code] }));
        } else {
          res.end(JSON.stringify({ success: false, found: false, message: 'Mã không tồn tại hoặc điện thoại chưa sẵn sàng!' }));
        }
        return;
      }

      // 6. Signal Post
      if (pathname === '/api/mirror/signal' && req.method === 'POST') {
        const body = await readBody(req);
        const code = body.code;
        if (code && mirrorSessions[code]) {
          if (body.target === 'pc') {
            mirrorSessions[code].signalsToPC.push(body.payload);
          } else {
            mirrorSessions[code].signalsToPhone.push(body.payload);
          }
          res.end(JSON.stringify({ success: true }));
        } else {
          res.statusCode = 404;
          res.end(JSON.stringify({ success: false, message: 'Phiên kết nối không tồn tại' }));
        }
        return;
      }

      // 7. Signal Get
      if (pathname === '/api/mirror/signal' && req.method === 'GET') {
        const code = parsedUrl.query.code;
        const role = parsedUrl.query.role;
        let items = [];
        if (code && mirrorSessions[code]) {
          if (role === 'pc') {
            items = mirrorSessions[code].signalsToPC.splice(0);
          } else {
            items = mirrorSessions[code].signalsToPhone.splice(0);
          }
        }
        res.end(JSON.stringify(items));
        return;
      }

      // 8. Frame Relay Post
      if (pathname === '/api/mirror/frame' && req.method === 'POST') {
        const body = await readBody(req);
        if (body.code) {
          frameRelay[body.code] = body.frame;
        }
        res.end(JSON.stringify({ success: true }));
        return;
      }

      // 9. Frame Relay Get
      if (pathname === '/api/mirror/frame' && req.method === 'GET') {
        const code = parsedUrl.query.code;
        res.end(JSON.stringify({ frame: (code && frameRelay[code]) ? frameRelay[code] : '' }));
        return;
      }

      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'Endpoint not found' }));
      return;

    } catch (err) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: err.message }));
      return;
    }
  }

  // ================= STATIC FILES SERVING =================
  let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(`<h1>404 Không tìm thấy trang</h1>`);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log('========================================================');
  console.log(`🚀 SCREEN MIRROR PRO SERVER RUNNING ON PORT: ${PORT}`);
  console.log(`🌐 Local URL: http://localhost:${PORT}`);
  console.log('========================================================');
});
