require('dotenv').config();
const express = require('express');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const path = require('path');

const app = express();
app.use(express.json());

// CORS
app.use(function (req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// static files
app.use(express.static(__dirname));

const keys = new Map();
const usedReq = new Set();

function makeKey() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  function seg() {
    let result = '';
    for (let i = 0; i < 4; i++) {
      result += chars[Math.floor(Math.random() * chars.length)];
    }
    return result;
  }

  return `BYPASSX-${seg()}-${seg()}-${seg()}`;
}

function fetchJSON(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const parsed = new URL(url);

    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (url.startsWith('https') ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: opts.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0'
        }
      },
      (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            resolve({
              ok: res.statusCode < 300,
              data: JSON.parse(data)
            });
          } catch {
            resolve({
              ok: false,
              data: {}
            });
          }
        });
      }
    );

    req.on('error', reject);

    req.setTimeout(opts.timeout || 12000, () => {
      req.destroy();
      reject(new Error('timeout'));
    });

    if (opts.body) req.write(opts.body);
    req.end();
  });
}

// Trang chủ
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'bypass.html'));
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

// Validate key
app.post('/api/key/validate', (req, res) => {
  const { key } = req.body;

  if (!key) {
    return res.status(400).json({
      ok: false,
      error: 'Thiếu key'
    });
  }

  const k = key.trim().toUpperCase();

  const demoKeys = [
    'BYPASSX-VIP1-2024-DEMO',
    'BYPASSX-TEST-ABCD-1234'
  ];

  if (demoKeys.includes(k)) {
    return res.json({
      ok: true,
      days: 7
    });
  }

  const entry = keys.get(k);

  if (!entry) {
    return res.status(400).json({
      ok: false,
      error: 'Key không tồn tại'
    });
  }

  if (entry.used) {
    return res.status(400).json({
      ok: false,
      error: 'Key đã dùng'
    });
  }

  entry.used = true;

  return res.json({
    ok: true,
    days: entry.days
  });
});

// Tạo key test
app.get('/api/testkey', (req, res) => {
  const key = makeKey();
  keys.set(key, {
    days: 30,
    used: false
  });

  res.json({
    ok: true,
    key
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
});