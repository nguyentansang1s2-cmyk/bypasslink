require(‘dotenv’).config();
const express = require(‘express’);
const fetch = require(‘node-fetch’);
const crypto = require(‘crypto’);
const path = require(‘path’);

const app = express();
app.use(express.json());
app.use((req, res, next) => {
res.header(‘Access-Control-Allow-Origin’, ‘*’);
res.header(‘Access-Control-Allow-Headers’, ‘Content-Type’);
res.header(‘Access-Control-Allow-Methods’, ‘GET,POST,OPTIONS’);
if (req.method === ‘OPTIONS’) return res.sendStatus(200);
next();
});
app.use(express.static(path.join(__dirname)));

const keys = new Map();
const usedReq = new Set();

function makeKey() {
const c = ‘ABCDEFGHJKLMNPQRSTUVWXYZ23456789’;
const s = () => Array.from({length:4}, () => c[Math.floor(Math.random()*c.length)]).join(’’);
return `BYPASSX-${s()}-${s()}-${s()}`;
}

app.get(’/’, (req, res) => {
res.sendFile(path.join(__dirname, ‘bypass.html’));
});

app.get(’/api/health’, (req, res) => res.json({ ok: true }));

app.post(’/api/bypass’, async (req, res) => {
const { url } = req.body;
if (!url) return res.status(400).json({ ok: false, error: ‘Thiếu URL.’ });
const enc = encodeURIComponent(url);
const apis = [
`https://bypass.vip/bypass?url=${enc}`,
`https://api.bypass.vip/?url=${enc}`,
`https://bypass.city/api/bypass?url=${enc}`,
`https://bypass.bot/api?url=${enc}`,
`https://bypassed.cc/api/bypass?url=${enc}`,
];
for (const a of apis) {
try {
const r = await fetch(a, { timeout: 12000 });
if (!r.ok) continue;
const d = await r.json();
const result = d.destination || d.result || d.url || d.bypassed || d.link;
if (result && result.startsWith(‘http’)) return res.json({ ok: true, result });
} catch {}
}
res.status(502).json({ ok: false, error: ‘Không bypass được link này.’ });
});

app.post(’/api/charge’, async (req, res) => {
const { telco, code, serial, amount, pkg } = req.body;
if (!telco || !code || !serial || !amount || !pkg)
return res.status(400).json({ ok: false, error: ‘Thiếu thông tin.’ });
if (usedReq.has(code + serial))
return res.status(400).json({ ok: false, error: ‘Thẻ đã nạp.’ });
const reqId = ‘bx_’ + Date.now() + ‘_’ + crypto.randomBytes(4).toString(‘hex’);
try {
const r = await fetch(‘https://trumthe.vn/chargingws/v2’, {
method: ‘POST’,
headers: { ‘Content-Type’: ‘application/json’ },
body: JSON.stringify({ telco, code, serial, amount: Number(amount), request_id: reqId, partner_id: process.env.PARTNER_ID, partner_key: process.env.PARTNER_KEY }),
timeout: 15000,
});
const d = await r.json();
if (d.status === 1) {
usedReq.add(code + serial);
const vipKey = makeKey();
keys.set(vipKey, { days: Number(pkg), used: false });
return res.json({ ok: true, key: vipKey, days: Number(pkg), amount: d.amount || Number(amount) });
} else if (d.status === 3) {
return res.json({ ok: true, pending: true, reqId });
}
return res.status(400).json({ ok: false, error: d.message || ‘Thẻ không hợp lệ.’ });
} catch { return res.status(502).json({ ok: false, error: ‘Lỗi kết nối.’ }); }
});

app.get(’/api/charge/check’, async (req, res) => {
const { reqId, pkg } = req.query;
try {
const r = await fetch(`https://trumthe.vn/chargingws/v2/check?request_id=${reqId}&partner_id=${process.env.PARTNER_ID}&partner_key=${process.env.PARTNER_KEY}`);
const d = await r.json();
if (d.status === 1) {
const vipKey = makeKey();
keys.set(vipKey, { days: Number(pkg||7), used: false });
return res.json({ ok: true, key: vipKey, days: Number(pkg||7) });
}
return res.json({ ok: false, pending: d.status === 3 });
} catch { return res.status(502).json({ ok: false, error: ‘Lỗi kiểm tra.’ }); }
});

app.post(’/api/key/validate’, (req, res) => {
const { key } = req.body;
if (!key) return res.status(400).json({ ok: false, error: ‘Thiếu key.’ });
const k = key.trim().toUpperCase();
if ([‘BYPASSX-VIP1-2024-DEMO’,‘BYPASSX-TEST-ABCD-1234’].includes(k)) return res.json({ ok: true, days: 7 });
const entry = keys.get(k);
if (!entry) return res.status(400).json({ ok: false, error: ‘Key không tồn tại.’ });
if (entry.used) return res.status(400).json({ ok: false, error: ‘Key đã dùng.’ });
entry.used = true;
return res.json({ ok: true, days: entry.days });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));