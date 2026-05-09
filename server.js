const path = require('path');
require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const fetch      = require('node-fetch');
const crypto     = require('crypto');

const app = express();

// ── MIDDLEWARE ──
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static(__dirname));

// ── IN-MEMORY STORE (thay bằng DB khi production) ──
const keys    = new Map(); // key -> { days, used, createdAt }
const usedReq = new Set(); // request_id đã xử lý (chống duplicate)
const ipUsage = new Map(); // ip -> { count, resetAt }

// ── RATE LIMITER ──
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 phút
  max: 20,
  message: { ok: false, error: 'Quá nhiều request, thử lại sau 1 phút.' }
});
const bypassLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { ok: false, error: 'Quá nhiều lần bypass, thử lại sau 1 phút.' }
});

// ── HELPERS ──
function makeKey() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const seg = () => Array.from({ length: 4 }, () =>
    chars[Math.floor(Math.random() * chars.length)]).join('');
  return `BYPASSX-${seg()}-${seg()}-${seg()}`;
}

function validateUrl(url) {
  try {
    const u = new URL(url);
    return ['http:', 'https:'].includes(u.protocol);
  } catch { return false; }
}

// ── ROUTES ──
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'bypass.html'));
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// Bypass link
app.post('/api/bypass', bypassLimiter, async (req, res) => {
  const { url } = req.body;

  // validate
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ ok: false, error: 'Thiếu URL.' });
  }
  if (!validateUrl(url)) {
    return res.status(400).json({ ok: false, error: 'URL không hợp lệ.' });
  }
  if (url.length > 2048) {
    return res.status(400).json({ ok: false, error: 'URL quá dài.' });
  }

  // thử lần lượt các API bypass
  const apis = [
    `https://bypass.vip/bypass?url=${encodeURIComponent(url)}`,
    `https://api.bypass.vip/?url=${encodeURIComponent(url)}`,
    `https://bypass.city/api/bypass?url=${encodeURIComponent(url)}`,
  ];

  for (const apiUrl of apis) {
    try {
      const r = await fetch(apiUrl, {
        timeout: 12000,
        headers: { 'User-Agent': 'BypassX/1.0' }
      });
      if (!r.ok) continue;
      const data = await r.json();
      const result = data.destination || data.result || data.url || data.bypassed;
      if (result && validateUrl(result)) {
        return res.json({ ok: true, result });
      }
    } catch {}
  }

  return res.status(502).json({ ok: false, error: 'Không bypass được link này. Thử lại hoặc link không được hỗ trợ.' });
});

// Nạp thẻ cào
app.post('/api/charge', limiter, async (req, res) => {
  const { telco, code, serial, amount, pkg } = req.body;

  // validate input
  if (!telco || !code || !serial || !amount || !pkg) {
    return res.status(400).json({ ok: false, error: 'Thiếu thông tin nạp thẻ.' });
  }
  const validTelcos = ['VIETTEL', 'VINAPHONE', 'MOBIFONE'];
  if (!validTelcos.includes(telco)) {
    return res.status(400).json({ ok: false, error: 'Nhà mạng không hợp lệ.' });
  }
  const validAmounts = [20000, 50000, 100000, 200000, 500000, 1000000];
  if (!validAmounts.includes(Number(amount))) {
    return res.status(400).json({ ok: false, error: 'Mệnh giá không hợp lệ.' });
  }
  const validPkgs = { '7': 20000, '30': 50000, '365': 500000, '36500': 2000000 };
  if (!validPkgs[pkg]) {
    return res.status(400).json({ ok: false, error: 'Gói không hợp lệ.' });
  }
  if (Number(amount) < validPkgs[pkg]) {
    return res.status(400).json({
      ok: false,
      error: `Mệnh giá thẻ thấp hơn giá gói. Cần tối thiểu ${validPkgs[pkg].toLocaleString('vi-VN')}đ.`
    });
  }
  // sanitize code/serial
  const codeClean   = String(code).replace(/[^0-9]/g, '').slice(0, 20);
  const serialClean = String(serial).replace(/[^0-9]/g, '').slice(0, 20);
  if (codeClean.length < 9) {
    return res.status(400).json({ ok: false, error: 'Mã thẻ không hợp lệ.' });
  }

  const reqId = 'bx_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');

  // chống duplicate
  if (usedReq.has(codeClean + serialClean)) {
    return res.status(400).json({ ok: false, error: 'Thẻ này đã được nạp.' });
  }

  try {
    const r = await fetch('https://trumthe.vn/chargingws/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        telco,
        code:       codeClean,
        serial:     serialClean,
        amount:     Number(amount),
        request_id: reqId,
        partner_id:  process.env.PARTNER_ID,
        partner_key: process.env.PARTNER_KEY,
      }),
      timeout: 15000,
    });

    if (!r.ok) {
      return res.status(502).json({ ok: false, error: 'Lỗi kết nối server nạp thẻ.' });
    }

    const data = await r.json();

    if (data.status === 1) {
      // thành công — generate key
      usedReq.add(codeClean + serialClean);
      const vipKey = makeKey();
      keys.set(vipKey, {
        days:      Number(pkg),
        used:      false,
        createdAt: Date.now(),
        reqId,
      });
      return res.json({
        ok:     true,
        key:    vipKey,
        days:   Number(pkg),
        amount: data.amount || Number(amount),
      });
    } else if (data.status === 3) {
      // pending
      return res.json({ ok: true, pending: true, reqId });
    } else {
      return res.status(400).json({
        ok:    false,
        error: data.message || `Thẻ không hợp lệ hoặc đã dùng (lỗi ${data.status}).`
      });
    }
  } catch (e) {
    return res.status(502).json({ ok: false, error: 'Không kết nối được server nạp thẻ.' });
  }
});

// Kiểm tra thẻ pending
app.get('/api/charge/check', limiter, async (req, res) => {
  const { reqId, pkg } = req.query;
  if (!reqId) return res.status(400).json({ ok: false, error: 'Thiếu reqId.' });

  try {
    const r = await fetch(
      `https://trumthe.vn/chargingws/v2/check?request_id=${reqId}&partner_id=${process.env.PARTNER_ID}&partner_key=${process.env.PARTNER_KEY}`
    );
    const data = await r.json();
    if (data.status === 1) {
      const vipKey = makeKey();
      keys.set(vipKey, { days: Number(pkg || 7), used: false, createdAt: Date.now(), reqId });
      return res.json({ ok: true, key: vipKey, days: Number(pkg || 7) });
    }
    return res.json({ ok: false, pending: data.status === 3 });
  } catch {
    return res.status(502).json({ ok: false, error: 'Lỗi kiểm tra trạng thái.' });
  }
});

// Validate key
app.post('/api/key/validate', limiter, (req, res) => {
  const { key } = req.body;
  if (!key || typeof key !== 'string') {
    return res.status(400).json({ ok: false, error: 'Thiếu key.' });
  }
  const keyClean = key.trim().toUpperCase();

  // demo keys
  const demoKeys = ['BYPASSX-VIP1-2024-DEMO', 'BYPASSX-TEST-ABCD-1234'];
  if (demoKeys.includes(keyClean)) {
    return res.json({ ok: true, days: 7 });
  }

  const entry = keys.get(keyClean);
  if (!entry) {
    return res.status(400).json({ ok: false, error: 'Key không tồn tại hoặc đã hết hạn.' });
  }
  if (entry.used) {
    return res.status(400).json({ ok: false, error: 'Key này đã được kích hoạt rồi.' });
  }
  // mark used
  entry.used = true;
  return res.json({ ok: true, days: entry.days });
});

// ── START ──
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`BypassX backend running on http://localhost:${PORT}`);
});
