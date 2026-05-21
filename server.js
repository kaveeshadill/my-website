const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const CONFIG_PATH = path.join(ROOT, 'config.json');

// Local admin login details - change these if you want
const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = '20070801';
const sessions = new Set();

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(ROOT));

function readConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return {};
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function writeConfig(data) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2));
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return Object.fromEntries(header.split(';').filter(Boolean).map(part => {
    const [key, ...value] = part.trim().split('=');
    return [key, decodeURIComponent(value.join('='))];
  }));
}

function requireAdmin(req, res, next) {
  const token = parseCookies(req).admin_token;
  if (!token || !sessions.has(token)) {
    return res.status(401).json({ ok: false, message: 'Login required' });
  }
  next();
}

function safeDeleteFile(fileName) {
  const cleanName = path.basename(fileName);
  const target = path.join(ROOT, cleanName);
  if (!target.startsWith(ROOT) || !fs.existsSync(target)) return false;
  fs.unlinkSync(target);
  return true;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const type = req.body.type;
    if (type === 'song') {
      const songsDir = path.join(ROOT, 'songs');
      if (!fs.existsSync(songsDir)) fs.mkdirSync(songsDir);
      cb(null, songsDir);
    } else {
      cb(null, ROOT);
    }
  },
  filename: (req, file, cb) => {
    const type = req.body.type;
    const number = String(req.body.number || '').replace(/[^0-9]/g, '');
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';

    if (type === 'gallery') return cb(null, `photo${number || 1}${ext}`);
    if (type === 'song') return cb(null, `song${number || 1}.mp3`);
    if (type === 'background') return cb(null, 'background.jpg');
    if (type === 'profile') return cb(null, 'IMG_4533.jpg');
    return cb(null, file.originalname);
  }
});
const upload = multer({ storage });

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    const token = crypto.randomBytes(24).toString('hex');
    sessions.add(token);
    res.setHeader('Set-Cookie', `admin_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`);
    return res.json({ ok: true });
  }
  res.status(401).json({ ok: false, message: 'Wrong username or password' });
});

app.post('/api/logout', (req, res) => {
  const token = parseCookies(req).admin_token;
  if (token) sessions.delete(token);
  res.setHeader('Set-Cookie', 'admin_token=; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/auth-check', requireAdmin, (req, res) => res.json({ ok: true }));
app.get('/api/config', (req, res) => res.json(readConfig()));

app.post('/api/config', requireAdmin, (req, res) => {
  writeConfig(req.body || {});
  res.json({ ok: true, message: 'Saved successfully' });
});

app.get('/api/photos', requireAdmin, (req, res) => {
  const imageExt = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
  const photos = fs.readdirSync(ROOT)
    .filter(name => /^photo\d+\.(jpg|jpeg|png|webp|gif)$/i.test(name) || name === 'IMG_4533.jpg' || name === 'background.jpg')
    .filter(name => imageExt.has(path.extname(name).toLowerCase()))
    .map(name => {
      const stat = fs.statSync(path.join(ROOT, name));
      return { name, url: `/${name}?v=${stat.mtimeMs}`, size: stat.size, modified: stat.mtime };
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  res.json({ ok: true, photos });
});

app.delete('/api/photos/:name', requireAdmin, (req, res) => {
  const name = path.basename(req.params.name || '');
  if (!/^photo\d+\.(jpg|jpeg|png|webp|gif)$/i.test(name)) {
    return res.status(400).json({ ok: false, message: 'Only gallery photos can be deleted' });
  }
  const deleted = safeDeleteFile(name);
  res.json({ ok: deleted, message: deleted ? 'Photo deleted' : 'Photo not found' });
});

app.post('/api/upload', requireAdmin, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, message: 'No file uploaded' });
  res.json({ ok: true, filename: req.file.filename });
});

app.listen(PORT, () => {
  console.log(`\nLocal website: http://localhost:${PORT}/index.html`);
  console.log(`Admin panel:    http://localhost:${PORT}/admin.html`);
  console.log(`Login: username=${ADMIN_USERNAME} password=${ADMIN_PASSWORD}\n`);
});
