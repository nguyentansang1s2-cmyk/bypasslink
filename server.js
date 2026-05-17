require('dotenv').config();
const express = require('express');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const path = require('path');

const app = express();
app.use(express.json());

app.use(function(req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.static(path.join(__dirname)));

var keys = new Map();
var usedReq = new Set();

function makeKey() {
  var c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  function seg() {
    var r = '';
    for (var i = 0; i < 4; i++) r += c[Math.floor(Math.random() * c.length)];
    return r;
  }
  return 'BYPASSX-' + seg() + '-' + seg() + '-' + seg();
}

function fetchJSON(url, opts) {
  opts = opts || {};
  return new Promise(function(resolve, reject) {
    var lib = url.startsWith('https') ? https : http;
    var parsed = new URL(url);
    var reqOpts = {
      hostname: parsed.hostname,
      port: parsed.port || (url.startsWith('https') ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' }
    };
    var req = lib.request(reqOpts, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        try { resolve({ ok: res.statusCode < 300, data: JSON.parse(data) }); }
        catch(e) { resolve({ ok: false, data: {} }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(opts.timeout || 12000, function() { req.destroy(); reject(new Error('timeout')); });
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

app.get('/', function(req, res) {
  res.sendFile(path.join(__dirname, 'bypass.html'));
});

app.get('/api/health', function(req, res) {
  res.json({ ok: true });
});

app.post('/api/bypass', async function(req, res) {
  var url = req.body.url;
  if (!url) return res.status(400).json({ ok: false, error: 'Thieu URL.' });
  var enc = encodeURIComponent(url);
  var apis = [
    'https://bypass.vip/bypass?url=' + enc,
    'https://api.bypass.vip/?url=' + enc,
    'https://bypass.city/api/bypass?url=' + enc,
    'https://bypass.bot/api?url=' + enc,
    'https://bypassed.cc/api/bypass?url=' + enc,
    'https://bypass.pm/bypass?url=' + enc,
    'https://bypass.pm/bypass2?url=' + enc,
  ];
  for (var i = 0; i < apis.length; i++) {
    try {
      var r = await fetchJSON(apis[i]);
      if (!r.ok) continue;
      var d = r.data;
      var result = d.destination || d.result || d.url || d.bypassed || d.link;
      if (result && result.startsWith('http')) return res.json({ ok: true, result: result });
    } catch(e) {}
  }
  return res.status(502).json({ ok: false, error: 'Khong bypass duoc link nay.' });
});

app.post('/api/charge', async function(req, res) {
  var telco = req.body.telco;
  var code = req.body.code;
  var serial = req.body.serial;
  var amount = req.body.amount;
  var pkg = req.body.pkg;
  if (!telco || !code || !serial || !amount || !pkg)
    return res.status(400).json({ ok: false, error: 'Thieu thong tin.' });
  if (usedReq.has(code + serial))
    return res.status(400).json({ ok: false, error: 'The da nap.' });
  var reqId = 'bx_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
  try {
    var body = JSON.stringify({
      telco: telco, code: code, serial: serial,
      amount: Number(amount), request_id: reqId,
      partner_id: process.env.PARTNER_ID,
      partner_key: process.env.PARTNER_KEY
    });
    var r = await fetchJSON('https://trumthe.vn/chargingws/v2', { method: 'POST', body: body, timeout: 15000 });
    var d = r.data;
    if (d.status === 1) {
      usedReq.add(code + serial);
      var vipKey = makeKey();
      keys.set(vipKey, { days: Number(pkg), used: false });
      return res.json({ ok: true, key: vipKey, days: Number(pkg), amount: d.amount || Number(amount) });
    }
    if (d.status === 3) return res.json({ ok: true, pending: true, reqId: reqId });
    return res.status(400).json({ ok: false, error: d.message || 'The khong hop le.' });
  } catch(e) {
    return res.status(502).json({ ok: false, error: 'Loi ket noi.' });
  }
});

app.get('/api/charge/check', async function(req, res) {
  var reqId = req.query.reqId;
  var pkg = req.query.pkg;
  try {
    var url = 'https://trumthe.vn/chargingws/v2/check?request_id=' + reqId + '&partner_id=' + process.env.PARTNER_ID + '&partner_key=' + process.env.PARTNER_KEY;
    var r = await fetchJSON(url);
    var d = r.data;
    if (d.status === 1) {
      var vipKey = makeKey();
      keys.set(vipKey, { days: Number(pkg || 7), used: false });
      return res.json({ ok: true, key: vipKey, days: Number(pkg || 7) });
    }
    return res.json({ ok: false, pending: d.status === 3 });
  } catch(e) {
    return res.status(502).json({ ok: false, error: 'Loi kiem tra.' });
  }
});

app.post('/api/key/validate', function(req, res) {
  var key = req.body.key;
  if (!key) return res.status(400).json({ ok: false, error: 'Thieu key.' });
  var k = key.trim().toUpperCase();
  var demo = ['BYPASSX-VIP1-2024-DEMO', 'BYPASSX-TEST-ABCD-1234'];
  if (demo.indexOf(k) !== -1) return res.json({ ok: true, days: 7 });
  var entry = keys.get(k);
  if (!entry) return res.status(400).json({ ok: false, error: 'Key khong ton tai.' });
  if (entry.used) return res.status(400).json({ ok: false, error: 'Key da dung.' });
  entry.used = true;
  return res.json({ ok: true, days: entry.days });
});

var PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
  console.log('Server running on port ' + PORT);
});
