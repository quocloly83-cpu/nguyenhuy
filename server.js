const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_PASSWORD || 'nguyentanhuyvip10thanhngannek';
const SESSION_SECRET = process.env.SESSION_SECRET || 'ath_super_secret_huy_fanta_2026_ui_upgrade';

const FACEBOOK_URL = process.env.FACEBOOK_URL || 'https://www.facebook.com/share/1JHonUUaCA/?mibextid=wwXIfr';
const ZALO_URL = process.env.ZALO_URL || 'https://zalo.me/0818249250';
const TIKTOK_URL = process.env.TIKTOK_URL || 'https://www.tiktok.com/@huyftsupport?_r=1&_t=ZS-94olc9q74ba';

const FF_ANDROID_PACKAGE = process.env.FF_ANDROID_PACKAGE || 'com.dts.freefireth';
const FFMAX_ANDROID_PACKAGE = process.env.FFMAX_ANDROID_PACKAGE || 'com.dts.freefiremax';
const FF_IOS_SCHEME = process.env.FF_IOS_SCHEME || 'freefire://';
const FFMAX_IOS_SCHEME = process.env.FFMAX_IOS_SCHEME || 'freefiremax://';
const FF_IOS_APPID = process.env.FF_IOS_APPID || '1300146617';
const FFMAX_IOS_APPID = process.env.FFMAX_IOS_APPID || '1480516829';
const FF_WEB_URL = process.env.FF_WEB_URL || 'https://ff.garena.com/vn/';
const FFMAX_WEB_URL = process.env.FFMAX_WEB_URL || 'https://ff.garena.com/vn/';

const LOGO_PATH = path.join(__dirname, 'logo.png');
const LOCAL_STORE_PATH = path.join(__dirname, 'keys.json');
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_REPO = process.env.GITHUB_REPO || '';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const GITHUB_DATA_PATH = process.env.GITHUB_DATA_PATH || 'keys.json';

const rateMap = new Map();
let keysCache = null;
let githubShaCache = null;
let writeQueue = Promise.resolve();

function isGitHubStorageEnabled() {
  return Boolean(GITHUB_TOKEN && GITHUB_REPO && GITHUB_DATA_PATH);
}

function sanitizeStore(obj) {
  return obj && typeof obj === 'object' ? obj : {};
}

function loadLocalStore() {
  try {
    if (!fs.existsSync(LOCAL_STORE_PATH)) return {};
    const raw = fs.readFileSync(LOCAL_STORE_PATH, 'utf8');
    return sanitizeStore(JSON.parse(raw || '{}'));
  } catch {
    return {};
  }
}

function saveLocalStore(data) {
  fs.writeFileSync(LOCAL_STORE_PATH, JSON.stringify(data, null, 2), 'utf8');
}

async function githubRequest(method, body) {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${encodeURIComponent(GITHUB_DATA_PATH).replace(/%2F/g, '/')}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'hft-panel-render'
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (res.status === 404) return { notFound: true };
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.message || `GitHub API lỗi ${res.status}`);
  }
  return json;
}

async function loadGitHubStore(force = false) {
  if (!isGitHubStorageEnabled()) {
    const local = loadLocalStore();
    keysCache = local;
    return local;
  }
  if (keysCache && !force) return keysCache;

  const json = await githubRequest('GET');
  if (json.notFound) {
    const empty = {};
    await saveGitHubStore(empty, 'init empty key store');
    keysCache = empty;
    return empty;
  }

  const raw = Buffer.from(json.content || '', 'base64').toString('utf8') || '{}';
  const parsed = sanitizeStore(JSON.parse(raw));
  githubShaCache = json.sha || null;
  keysCache = parsed;
  return parsed;
}

async function saveGitHubStore(data, message = 'update key store') {
  if (!isGitHubStorageEnabled()) {
    keysCache = sanitizeStore(data);
    saveLocalStore(keysCache);
    return keysCache;
  }

  const store = sanitizeStore(data);
  const content = Buffer.from(JSON.stringify(store, null, 2), 'utf8').toString('base64');
  if (!githubShaCache) {
    const current = await githubRequest('GET');
    if (!current.notFound) githubShaCache = current.sha || null;
  }

  const payload = {
    message,
    content,
    branch: GITHUB_BRANCH
  };
  if (githubShaCache) payload.sha = githubShaCache;

  const json = await githubRequest('PUT', payload);
  githubShaCache = json.content?.sha || json.commit?.sha || githubShaCache;
  keysCache = store;
  return store;
}

function queuedWrite(mutator, message) {
  writeQueue = writeQueue.then(async () => {
    const current = await loadGitHubStore(true);
    const working = JSON.parse(JSON.stringify(current));
    const next = await mutator(working);
    return saveGitHubStore(next || working, message);
  });
  return writeQueue;
}

function normalizeKeyItem(item) {
  if (!item || typeof item !== 'object') return null;
  if (!Array.isArray(item.devices)) item.devices = [];
  if (item.device && !item.devices.includes(item.device)) item.devices.push(item.device);

  if (typeof item.usesLeft !== 'number') {
    if (typeof item.uses === 'number') item.usesLeft = Number(item.uses || 0);
    else item.usesLeft = 0;
  }

  if (typeof item.totalDevices !== 'number') {
    item.totalDevices = Math.max(item.devices.length, item.devices.length + Number(item.usesLeft || 0));
  }

  item.usesLeft = Math.max(0, Number(item.usesLeft || 0));
  item.totalDevices = Math.max(item.devices.length, Number(item.totalDevices || 0));
  item.expireAt = Number(item.expireAt || 0);
  item.createdAt = Number(item.createdAt || Date.now());
  delete item.device;
  delete item.uses;
  return item;
}

function signText(text) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(text).digest('hex');
}

function createSessionToken(key, device, expireAt) {
  const issuedAt = Date.now();
  const payload = `${key}|${device}|${expireAt}|${issuedAt}`;
  const sig = signText(payload);
  return Buffer.from(`${payload}|${sig}`, 'utf8').toString('base64url');
}

function verifySessionToken(token) {
  try {
    const raw = Buffer.from(token, 'base64url').toString('utf8');
    const parts = raw.split('|');
    if (parts.length !== 5) return null;
    const [key, device, expireAt, issuedAt, sig] = parts;
    const payload = `${key}|${device}|${expireAt}|${issuedAt}`;
    if (signText(payload) !== sig) return null;
    return { key, device, expireAt: Number(expireAt), issuedAt: Number(issuedAt) };
  } catch {
    return null;
  }
}

function formatVNTime(ms) {
  return new Date(ms).toLocaleString('vi-VN');
}

function renderLogo(size, radius) {
  const r = radius || Math.round(size * 0.28);
  if (fs.existsSync(LOGO_PATH)) {
    return `<img src="/logo.png" alt="HFT Logo" style="width:${size}px;height:${size}px;object-fit:cover;display:block;border-radius:${r}px">`;
  }
  return `<div style="width:${size}px;height:${size}px;border-radius:${r}px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#8c52ff,#ff70c7);font-size:${Math.round(size * 0.42)}px;color:#fff">⚡</div>`;
}

function iconFacebook() {
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path fill="#1877F2" d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073c0 6.023 4.388 11.015 10.125 11.927v-8.437H7.078v-3.49h3.047V9.41c0-3.017 1.792-4.684 4.533-4.684 1.313 0 2.686.235 2.686.235v2.963H15.83c-1.49 0-1.955.931-1.955 1.886v2.263h3.328l-.532 3.49h-2.796V24C19.612 23.088 24 18.096 24 12.073Z"/><path fill="#fff" d="M16.671 15.563l.532-3.49h-3.328V9.81c0-.955.465-1.886 1.955-1.886h1.514V4.96s-1.373-.235-2.686-.235c-2.741 0-4.533 1.667-4.533 4.684v2.664H7.078v3.49h3.047V24h3.75v-8.437h2.796Z"/></svg>`;
}

function iconZalo() {
  return `<svg width="20" height="20" viewBox="0 0 64 64" fill="none" aria-hidden="true"><rect x="4" y="4" width="56" height="56" rx="18" fill="#0068FF"/><path d="M17 22h30.5c1.7 0 2.58 2.03 1.42 3.27L28.1 46h18.4c1.9 0 2.73 2.39 1.23 3.56L46 51H17.5c-1.72 0-2.6-2.08-1.38-3.31L36.9 27H17c-1.66 0-2.5-2-1.34-3.2l.03-.03C16.05 22.3 16.5 22 17 22Z" fill="white"/></svg>`;
}

function baseStyles() {
  return `
  <style>
    *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
    html{-webkit-text-size-adjust:100%;touch-action:manipulation}
    :root{
      --line:rgba(255,255,255,.09);
      --violet:#a765ff;
      --violet2:#d391ff;
      --purple:#7f56ff;
      --pink:#ff74d6;
      --gold:#ffd56d;
      --gold2:#ffba31;
      --muted:#cfc6dd;
      --ok:#9cffb6;
      --err:#ff7aa2;
      --bg:#07050c;
    }
    body{
      margin:0;min-height:100vh;font-family:Arial,sans-serif;color:#fff;overflow:hidden;
      background:
        radial-gradient(circle at 18% 14%, rgba(167,101,255,.23), transparent 24%),
        radial-gradient(circle at 84% 16%, rgba(255,116,214,.16), transparent 22%),
        radial-gradient(circle at 50% 110%, rgba(255,197,61,.12), transparent 28%),
        linear-gradient(160deg,#030206,#0b0711,#09050d);
    }
    body::before{
      content:"";position:fixed;inset:-20%;pointer-events:none;opacity:.18;
      background:
        radial-gradient(circle at 40% 40%, rgba(255,255,255,.05) 0 1px, transparent 1px),
        radial-gradient(circle at 70% 30%, rgba(255,255,255,.03) 0 1px, transparent 1px);
      background-size:22px 22px,30px 30px;animation:drift 24s linear infinite;
    }
    body::after{
      content:"";position:fixed;inset:0;pointer-events:none;opacity:.22;
      background:linear-gradient(transparent, rgba(255,255,255,.03), transparent);
      background-size:100% 4px;animation:scan 10s linear infinite;
    }
    @keyframes drift{from{transform:translateY(0)}to{transform:translateY(90px)}}
    @keyframes scan{from{transform:translateY(-100%)}to{transform:translateY(100%)}}
    @keyframes cardGlow{0%,100%{box-shadow:0 0 24px rgba(167,101,255,.14),0 0 58px rgba(255,213,109,.07)}50%{box-shadow:0 0 34px rgba(167,101,255,.22),0 0 74px rgba(255,213,109,.11)}}
    @keyframes pulseText{0%,100%{text-shadow:0 0 14px rgba(255,213,109,.22)}50%{text-shadow:0 0 24px rgba(167,101,255,.28)}}
    @keyframes logoFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
    @keyframes ringSpin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
    @keyframes neonBar{0%{background-position:0% 50%}100%{background-position:200% 50%}}
    @keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
    .wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:22px}
    .card{
      width:min(94vw,560px);border-radius:28px;padding:20px;background:rgba(14,10,20,.86);
      border:1px solid rgba(255,213,109,.15);backdrop-filter:blur(18px);animation:cardGlow 5s ease-in-out infinite;
      position:relative;overflow:hidden;
    }
    .card::before{content:"";position:absolute;inset:0;background:linear-gradient(135deg,rgba(255,213,109,.05),transparent 35%,rgba(167,101,255,.07));pointer-events:none}
    .top{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:14px}
    .brand{display:flex;align-items:center;gap:14px}
    .logoBox{position:relative;width:74px;height:74px;display:grid;place-items:center;animation:logoFloat 3.3s ease-in-out infinite}
    .logoBox::before,.loadingLogo::before{content:"";position:absolute;inset:-8px;border-radius:28px;border:1px solid rgba(255,213,109,.22);box-shadow:0 0 24px rgba(167,101,255,.18)}
    .logoBox::after,.loadingLogo::after{content:"";position:absolute;inset:-14px;border-radius:32px;border:1px dashed rgba(255,213,109,.18);animation:ringSpin 14s linear infinite}
    .title{margin:0;font-size:24px;letter-spacing:.3px;background:linear-gradient(90deg,var(--gold),#fff2bf,var(--violet2));-webkit-background-clip:text;background-clip:text;color:transparent;animation:pulseText 3.2s ease-in-out infinite}
    .sub{color:#ddd0ee;font-size:13px;margin-top:4px}
    .credit{display:inline-flex;margin-top:8px;padding:6px 10px;border-radius:999px;background:rgba(255,213,109,.08);border:1px solid rgba(255,213,109,.16);color:#ffe6a4;font-size:11px}
    .content{animation:fadeUp .6s ease}
    .input,.smallInput{width:100%;height:52px;border-radius:15px;padding:0 14px;background:rgba(255,255,255,.05);border:1px solid var(--line);color:#fff;font-size:15px;outline:none;transition:.2s}
    .input:focus,.smallInput:focus{border-color:rgba(255,213,109,.34);box-shadow:0 0 0 3px rgba(167,101,255,.14)}
    .btn,.socialBtn,.smallBtn,.tab,.gameBtn{border:none;color:#fff;cursor:pointer;font-weight:700;border-radius:15px;transition:.22s ease;text-decoration:none}
    .btn,.gameBtn{width:100%;min-height:52px;display:flex;align-items:center;justify-content:center;gap:8px;margin-top:12px;background:linear-gradient(90deg,var(--gold2),var(--gold),var(--violet2),var(--pink));background-size:200% 100%;animation:neonBar 7s linear infinite;color:#120915;box-shadow:0 10px 28px rgba(255,186,49,.18)}
    .btn:hover,.gameBtn:hover,.socialBtn:hover,.smallBtn:hover,.tab:hover{transform:translateY(-1px)}
    .smallBtn{padding:9px 12px;background:rgba(255,255,255,.07);border:1px solid var(--line)}
    .topLine{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px}
    .pill{display:inline-flex;align-items:center;padding:8px 12px;border-radius:999px;color:#ffe7aa;background:rgba(255,213,109,.1);border:1px solid rgba(255,213,109,.14);font-size:12px}
    .noticeBox,.tile,.liveFx{margin-top:12px;padding:14px;border-radius:18px;background:rgba(255,255,255,.045);border:1px solid var(--line)}
    .noticeBox{line-height:1.65;color:#f3ebff}
    .tabs{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
    .tab{padding:11px 13px;background:rgba(255,255,255,.05);border:1px solid var(--line);font-size:12px}
    .tab.active{background:linear-gradient(90deg,var(--violet),var(--pink));color:#fff}
    .tabPane{display:none;margin-top:12px}
    .tabPane.active{display:block;animation:fadeUp .25s ease}
    .row{display:flex;align-items:center;justify-content:space-between;gap:16px}
    .name{margin:0 0 5px;font-weight:700;color:#fff4c8}
    .desc{margin:0;color:#d4c9e5;font-size:12px;line-height:1.5}
    .switch{position:relative;display:inline-block;width:58px;height:32px;flex:0 0 auto}
    .switch input{display:none}
    .slider{position:absolute;cursor:pointer;inset:0;background:rgba(255,255,255,.1);transition:.25s;border-radius:999px;border:1px solid var(--line)}
    .slider:before{content:"";position:absolute;height:24px;width:24px;left:4px;top:3px;background:#fff;border-radius:50%;transition:.25s;box-shadow:0 4px 14px rgba(0,0,0,.24)}
    .switch input:checked + .slider{background:linear-gradient(90deg,var(--violet),var(--pink));box-shadow:0 0 18px rgba(167,101,255,.25)}
    .switch input:checked + .slider:before{transform:translateX(26px)}
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}
    .socialBtn{display:flex;align-items:center;justify-content:center;gap:8px;min-height:52px;background:rgba(255,255,255,.07);border:1px solid var(--line)}
    .socialBtn.gameStyle{background:linear-gradient(135deg,rgba(255,213,109,.14),rgba(167,101,255,.18));border-color:rgba(255,213,109,.18)}
    .footer{margin-top:10px;color:#d3cae3;font-size:12px;line-height:1.6}
    .sliderWrap{margin-top:10px}
    .rangeLabel{display:flex;justify-content:space-between;font-size:12px;color:#eadffd;margin-bottom:8px}
    input[type=range]{width:100%;accent-color:#b77cff}
    .msg{min-height:24px;margin-top:10px;font-size:13px;color:#d3cae3}
    .msg.ok{color:var(--ok)} .msg.err{color:var(--err)}
    .toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%) translateY(20px);min-width:220px;max-width:92vw;padding:12px 16px;border-radius:14px;background:rgba(10,7,15,.92);border:1px solid var(--line);color:#fff;text-align:center;z-index:120;opacity:0;pointer-events:none;transition:.28s}
    .toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
    .toast.ok{border-color:rgba(156,255,182,.35)} .toast.err{border-color:rgba(255,122,162,.35)}
    .loadingLayer{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:radial-gradient(circle at center,rgba(18,12,28,.94),rgba(4,2,8,.98));z-index:999;transition:.65s ease}
    .loadingLayer.hide{opacity:0;visibility:hidden}
    .loadingLogo{position:relative;width:170px;height:170px;display:grid;place-items:center;animation:logoFloat 2.8s ease-in-out infinite}
    .loadingText{margin-top:18px;font-size:28px;font-weight:800;letter-spacing:.5px;background:linear-gradient(90deg,var(--gold),var(--violet2),#fff0b7);-webkit-background-clip:text;background-clip:text;color:transparent;animation:pulseText 2.6s ease-in-out infinite}
    .loadingSub{margin-top:8px;color:#ddd0ee;font-size:12px;letter-spacing:.2px}
    .loadingBar{width:min(280px,72vw);height:8px;border-radius:999px;margin-top:20px;background:rgba(255,255,255,.08);overflow:hidden;border:1px solid rgba(255,255,255,.07)}
    .loadingBar>span{display:block;height:100%;width:55%;background:linear-gradient(90deg,var(--gold2),var(--gold),var(--violet2),var(--pink));background-size:200% 100%;animation:neonBar 2.1s linear infinite}
    .liveFx{min-height:50px;display:flex;align-items:center;overflow:hidden}
    .fxLine{display:inline-block;color:#f1e8ff;animation:fadeUp .28s ease}
    .hidden{display:none!important}
    .homeWrap{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:22px}
    .homeCard{width:min(94vw,560px);padding:24px;border-radius:26px;background:rgba(14,10,20,.84);border:1px solid rgba(255,213,109,.15);backdrop-filter:blur(18px);animation:cardGlow 5s ease-in-out infinite}
    .homeBtns{display:grid;grid-template-columns:1fr;gap:12px;margin-top:18px}
    .homeBtn{display:flex;align-items:center;justify-content:center;min-height:54px;border-radius:16px;text-decoration:none;color:#fff;background:linear-gradient(90deg,var(--violet),var(--pink));font-weight:700;border:1px solid rgba(255,255,255,.08)}
    @media (max-width:640px){.grid2{grid-template-columns:1fr}.card{padding:16px}.title{font-size:22px}.top{align-items:flex-start}.brand{align-items:flex-start}}
  </style>`;
}

function renderHomeHtml() {
  return `<!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HFT Panel</title>${baseStyles()}</head><body><div class="homeWrap"><div class="homeCard"><div class="brand"><div class="logoBox">${renderLogo(74, 20)}</div><div><h1 class="title">HFT VIP Panel</h1><div class="sub">Update giữ key ổn định, giao diện vàng tím, loading đẹp</div></div></div><div class="homeBtns"><a class="homeBtn" href="/panel">Mở Panel</a><a class="homeBtn" href="/admin">Mở Admin</a></div></div></div></body></html>`;
}

function renderPanelHtml() {
  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
  <title>HFT VIP Panel</title>
  ${baseStyles()}
</head>
<body>
  <div class="loadingLayer" id="loadingLayer">
    <div class="loadingLogo">${renderLogo(170, 28)}</div>
    <div class="loadingText">HFT VIP</div>
    <div class="loadingSub">Loading secure panel...</div>
    <div class="loadingBar"><span></span></div>
  </div>

  <div class="wrap">
    <div class="card">
      <div class="top">
        <div class="brand">
          <div class="logoBox">${renderLogo(72, 20)}</div>
          <div>
            <h1 class="title">HFT VIP Panel</h1>
            <div class="sub">Form login gọn hơn, hiệu ứng nhẹ và mượt</div>
            <div class="credit">CRE HUY FANTA</div>
          </div>
        </div>
      </div>

      <div class="content">
        <div id="loginView">
          <input id="keyInput" class="input" placeholder="Nhập key của bạn">
          <button class="btn" onclick="dangNhap()">Đăng nhập</button>
          <div class="grid2">
            <a class="socialBtn" href="${ZALO_URL}" target="_blank" rel="noopener noreferrer">${iconZalo()} <span>Zalo</span></a>
            <a class="socialBtn" href="${FACEBOOK_URL}" target="_blank" rel="noopener noreferrer">${iconFacebook()} <span>Facebook</span></a>
          </div>
          <div id="msg" class="msg"></div>
        </div>

        <div id="panelView" class="hidden">
          <div class="topLine">
            <div class="pill">✨ VIP ACTIVE</div>
            <button class="smallBtn" onclick="dangXuat()">Thoát</button>
          </div>

          <div class="noticeBox" id="keyNotice">Key đang hoạt động.</div>

          <div class="grid2" style="margin-top:12px">
            <button class="gameBtn" onclick="openGame('ff')">🎮 Vào Free Fire</button>
            <button class="gameBtn" onclick="openGame('ffmax')">🔥 Vào FF MAX</button>
          </div>

          <div class="tabs">
            <button class="tab active" data-tab="tab1">Main</button>
            <button class="tab" data-tab="tab2">Optimize</button>
            <button class="tab" data-tab="tab3">Game Boost</button>
            <button class="tab" data-tab="tab4">Social</button>
            <button class="tab" data-tab="tab5">Tools</button>
            <button class="tab" data-tab="tab6">TikTok</button>
          </div>

          <div id="tab1" class="tabPane active">
            <div class="tile"><div class="row"><div><p class="name">AimTrickHead</p><p class="desc">Tác dụng phản ngồi ngay sau khi bật</p></div><label class="switch"><input type="checkbox" id="f2" onchange="toggleFx(this,'AimTrickHead')"><span class="slider"></span></label></div></div>
            <div class="tile"><div class="row"><div><p class="name">Bám Đầu</p><p class="desc">Tác dụng phản ngồi ngay sau khi bật</p></div><label class="switch"><input type="checkbox" id="f3" onchange="toggleFx(this,'Bám Đầu')"><span class="slider"></span></label></div></div>
            <div class="tile"><div class="row"><div><p class="name">Nhẹ Tâm</p><p class="desc">Tác dụng phản ngồi ngay sau khi bật</p></div><label class="switch"><input type="checkbox" id="f4" onchange="toggleFx(this,'Nhẹ Tâm')"><span class="slider"></span></label></div></div>
          </div>

          <div id="tab2" class="tabPane">
            <div class="tile"><div class="row"><div><p class="name">Tối Ưu Mạnh</p><p class="desc">Tác dụng phản ngồi ngay sau khi bật</p></div><label class="switch"><input type="checkbox" id="f5" onchange="toggleFx(this,'Tối Ưu Mạnh')"><span class="slider"></span></label></div></div>
            <div class="tile"><div class="row"><div><p class="name">Buff Nhạy x Nhẹ Tâm</p><p class="desc">Tác dụng phản ngồi ngay sau khi bật</p></div><label class="switch"><input type="checkbox" id="f6" onchange="toggleFx(this,'Buff Nhạy x Nhẹ Tâm')"><span class="slider"></span></label></div></div>
            <div class="tile"><p class="name">Sensi Control</p><p class="desc">Tác dụng phản ngồi ngay sau khi bật</p><div class="sliderWrap"><div class="rangeLabel"><span>Level</span><span id="sensiValue">60</span></div><input type="range" min="1" max="120" value="60" id="sensiRange" oninput="updateSensi(this.value)"></div></div>
          </div>

          <div id="tab3" class="tabPane">
            <div class="tile"><div class="row"><div><p class="name">Nhẹ Tâm + Fix Rung</p><p class="desc">Tác dụng phản ngồi ngay sau khi bật</p></div><label class="switch"><input type="checkbox" id="f1" onchange="toggleFx(this,'Nhẹ Tâm + Fix Rung')"><span class="slider"></span></label></div></div>
            <div class="tile"><div class="row"><div><p class="name">Game Boost</p><p class="desc">Tối ưu phản hồi và độ mượt ngay sau khi bật</p></div><label class="switch"><input type="checkbox" id="f7" onchange="toggleFx(this,'Game Boost')"><span class="slider"></span></label></div></div>
          </div>

          <div id="tab4" class="tabPane">
            <div class="grid2">
              <a class="socialBtn" href="${ZALO_URL}" target="_blank" rel="noopener noreferrer">${iconZalo()} <span>Liên hệ Zalo</span></a>
              <a class="socialBtn" href="${FACEBOOK_URL}" target="_blank" rel="noopener noreferrer">${iconFacebook()} <span>Facebook</span></a>
            </div>
            <div class="footer">Mua key hoặc hỗ trợ trực tiếp qua các nút trên.</div>
          </div>

          <div id="tab5" class="tabPane">
            <div class="grid2">
              <button class="socialBtn gameStyle" onclick="openGame('ff')">🎮 Mở Free Fire</button>
              <button class="socialBtn gameStyle" onclick="openGame('ffmax')">🔥 Mở FF MAX</button>
            </div>
            <div class="footer">Bấm là mở game luôn, không cần bật hết chức năng. Nếu máy chưa có game thì sẽ mở trang cài.</div>
          </div>

          <div id="tab6" class="tabPane">
            <div class="grid2">
              <a class="socialBtn" href="${TIKTOK_URL}" target="_blank" rel="noopener noreferrer">🎵 <span>TikTok</span></a>
              <a class="socialBtn" href="${ZALO_URL}" target="_blank" rel="noopener noreferrer">${iconZalo()} <span>Liên hệ Admin</span></a>
            </div>
            <div class="footer">Kênh TikTok share key trải nghiệm. Muốn key vĩnh viễn thì liên hệ admin.</div>
          </div>

          <div class="liveFx" id="liveFxBox"><span class="fxLine">⚡ Chờ kích hoạt module...</span></div>
        </div>
      </div>
    </div>
  </div>

  <div id="toast" class="toast"></div>

  <script>
    const msg = document.getElementById('msg');
    const loginView = document.getElementById('loginView');
    const panelView = document.getElementById('panelView');
    const toast = document.getElementById('toast');
    const liveFxBox = document.getElementById('liveFxBox');
    const sensiValue = document.getElementById('sensiValue');
    const loadingLayer = document.getElementById('loadingLayer');
    const keyNotice = document.getElementById('keyNotice');
    const FF = ${JSON.stringify({ androidPackage: FF_ANDROID_PACKAGE, iosScheme: FF_IOS_SCHEME, iosAppId: FF_IOS_APPID, webUrl: FF_WEB_URL })};
    const FFMAX = ${JSON.stringify({ androidPackage: FFMAX_ANDROID_PACKAGE, iosScheme: FFMAX_IOS_SCHEME, iosAppId: FFMAX_IOS_APPID, webUrl: FFMAX_WEB_URL })};
    let fxTimer = null;

    function hideLoading(){ setTimeout(()=>loadingLayer.classList.add('hide'), 1900); }
    function showToast(text,type){ toast.className = 'toast show ' + (type||''); toast.textContent = text||''; setTimeout(()=>toast.className='toast',2200); }
    function getDevice(){ let id = localStorage.getItem('ath_device'); if(!id){ id = 'web-' + Math.random().toString(36).slice(2,12); localStorage.setItem('ath_device', id); } return id; }
    function setMsg(text,type){ msg.textContent = text||''; msg.className = 'msg ' + (type||''); }
    function saveSession(data){ localStorage.setItem('ath_session', data.token || ''); localStorage.setItem('ath_key', data.key || ''); }
    function getSession(){ return localStorage.getItem('ath_session'); }
    function getSavedKey(){ return localStorage.getItem('ath_key') || ''; }
    function clearSession(){ localStorage.removeItem('ath_session'); localStorage.removeItem('ath_key'); }
    function msToViDuration(ms){ if(ms<=0) return '0 phút'; const totalMinutes=Math.floor(ms/60000); const days=Math.floor(totalMinutes/(60*24)); const hours=Math.floor((totalMinutes%(60*24))/60); const minutes=totalMinutes%60; const parts=[]; if(days) parts.push(days+' ngày'); if(hours) parts.push(hours+' giờ'); if(minutes||parts.length===0) parts.push(minutes+' phút'); return parts.slice(0,3).join(' '); }
    function buildNotice(data){ const keyText=data.key||getSavedKey()||'Đang hoạt động'; const remainText=msToViDuration((data.expireAt||0)-Date.now()); keyNotice.innerHTML='<b>Key:</b> '+keyText+'<br><b>Hiệu lực còn:</b> '+remainText+'<br><b>Hết hạn lúc:</b> '+(data.expireText||'--'); }
    function startFxFeed(){ clearInterval(fxTimer); const lines=['⚡ Secure sync loading...','⚡ Visual preset active...','⚡ Premium panel online...','⚡ Smooth touch online...','⚡ HFT theme synced...','⚡ Mobile profile ready...']; let i=0; fxTimer=setInterval(()=>{ liveFxBox.innerHTML='<span class="fxLine">'+lines[i % lines.length]+'</span>'; i++; },1200); }
    function moPanel(data){ loginView.classList.add('hidden'); panelView.classList.remove('hidden'); buildNotice(data); taiTrangThai(); startFxFeed(); }
    function dangXuat(){ clearSession(); clearInterval(fxTimer); panelView.classList.add('hidden'); loginView.classList.remove('hidden'); document.getElementById('keyInput').value=''; setMsg('',''); showToast('Đã thoát','err'); }
    async function dangNhap(){ const key=document.getElementById('keyInput').value.trim(); if(!key){ setMsg('Vui lòng nhập key.','err'); return; } setMsg('Đang kiểm tra key...'); try{ const res=await fetch('/api/check',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key,device:getDevice()})}); const data=await res.json(); if(!data.ok){ setMsg(data.msg||'Đăng nhập thất bại.','err'); return; } saveSession({token:data.token,key}); data.key=key; setMsg('Đăng nhập thành công.','ok'); showToast('Đăng nhập thành công','ok'); moPanel(data); }catch{ setMsg('Không thể kết nối tới máy chủ.','err'); } }
    function toggleFx(el,label){ luuTrangThai(); if(el.checked){ liveFxBox.innerHTML='<span class="fxLine">⚡ '+label+' -> ACTIVE...</span>'; showToast(label+' đã bật','ok'); } else { liveFxBox.innerHTML='<span class="fxLine">⚡ '+label+' -> OFF</span>'; showToast(label+' đã tắt','err'); } }
    function updateSensi(val){ sensiValue.textContent = val; localStorage.setItem('ath_sensi', String(val)); liveFxBox.innerHTML='<span class="fxLine">⚡ Sensi tuned -> '+val+'</span>'; }
    function luuTrangThai(){ const state={}; ['f1','f2','f3','f4','f5','f6','f7'].forEach(id=>{ const el=document.getElementById(id); state[id]=!!(el&&el.checked); }); localStorage.setItem('ath_state', JSON.stringify(state)); }
    function taiTrangThai(){ try{ const state=JSON.parse(localStorage.getItem('ath_state')||'{}'); ['f1','f2','f3','f4','f5','f6','f7'].forEach(id=>{ const el=document.getElementById(id); if(el) el.checked=!!state[id]; }); const savedSensi=localStorage.getItem('ath_sensi')||'60'; const sensiRange=document.getElementById('sensiRange'); if(sensiRange) sensiRange.value=savedSensi; sensiValue.textContent=savedSensi; }catch{} }
    function isAndroid(){ return /Android/i.test(navigator.userAgent); }
    function isIOS(){ return /iPhone|iPad|iPod/i.test(navigator.userAgent); }
    function fallback(url){ setTimeout(()=>{ window.location.href = url; }, 1200); }
    function openGame(kind){ const cfg = kind === 'ffmax' ? FFMAX : FF; if(isAndroid()){ try{ window.location.href = 'intent://#Intent;package=' + cfg.androidPackage + ';end'; fallback(cfg.webUrl); }catch{ window.location.href = cfg.webUrl; } return; } if(isIOS()){ window.location.href = cfg.iosScheme; fallback('https://apps.apple.com/app/id' + cfg.iosAppId); return; } window.location.href = cfg.webUrl; }
    document.querySelectorAll('.tab').forEach(btn=>btn.addEventListener('click',()=>{ document.querySelectorAll('.tab').forEach(b=>b.classList.remove('active')); document.querySelectorAll('.tabPane').forEach(p=>p.classList.remove('active')); btn.classList.add('active'); const pane=document.getElementById(btn.dataset.tab); if(pane) pane.classList.add('active'); }));
    window.addEventListener('load', async ()=>{ hideLoading(); const token=getSession(); if(!token) return; try{ const res=await fetch('/api/status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,device:getDevice()})}); const data=await res.json(); if(data.ok){ data.key=getSavedKey(); moPanel(data); } else { clearSession(); } }catch{} });
  </script>
</body>
</html>`;
}

function renderAdminHtml() {
  return `<!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><title>Admin</title>${baseStyles()}</head><body><div class="wrap"><div class="card" style="width:min(94vw,760px)"><div class="brand"><div class="logoBox">${renderLogo(72, 20)}</div><div><h1 class="title">Admin Tạo Key</h1><div class="sub">Giữ logic tạo key cũ, chỉ đổi lưu trữ để tránh mất key</div></div></div><div class="noticeBox" style="margin-top:16px"><input id="adminKey" class="input" type="password" placeholder="Admin Key"><input id="customKey" class="input" placeholder="Key muốn tạo (để trống = tự random)" style="margin-top:10px"><div class="grid2"><input id="uses" class="smallInput" type="number" value="50" placeholder="Số thiết bị tối đa"><input id="days" class="smallInput" type="number" value="30" placeholder="Số ngày sử dụng"></div><button class="btn" onclick="taoKey()">Tạo Key</button><button class="smallBtn" style="width:100%;margin-top:10px;min-height:48px" onclick="taiDanhSach()">Tải danh sách key</button><div id="result" class="msg" style="margin-top:14px"></div><div id="list"></div></div></div></div><script>
async function taoKey(){ const adminKey=document.getElementById('adminKey').value.trim(); const customKey=document.getElementById('customKey').value.trim(); const uses=Number(document.getElementById('uses').value||50); const days=Number(document.getElementById('days').value||30); const result=document.getElementById('result'); result.innerHTML='Đang tạo key...'; try{ const res=await fetch('/api/create?admin='+encodeURIComponent(adminKey),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:customKey,uses,days})}); const data=await res.json(); if(!data.ok){ result.innerHTML='<span style="color:#ff7aa2">⛔ '+(data.error||'Tạo key thất bại')+'</span>'; return; } result.innerHTML='<div style="margin-top:12px;color:#9cffb6">✅ Tạo thành công</div><div>🔑 Key: <b>'+data.key+'</b></div><div>📱 Số thiết bị tối đa: '+data.totalDevices+'</div><div>⏳ Hết hạn: '+data.expireText+'</div>'; taiDanhSach(); }catch{ result.innerHTML='<span style="color:#ff7aa2">❌ Lỗi mạng</span>'; } }
async function taiDanhSach(){ const adminKey=document.getElementById('adminKey').value.trim(); const box=document.getElementById('list'); box.innerHTML='<div class="msg">Đang tải...</div>'; try{ const res=await fetch('/api/list?admin='+encodeURIComponent(adminKey)); const data=await res.json(); if(!data.ok){ box.innerHTML='<span style="color:#ff7aa2">⛔ '+(data.error||'Không tải được')+'</span>'; return; } const entries=data.items||[]; if(!entries.length){ box.innerHTML='<div class="msg">Chưa có key nào.</div>'; return; } let html=''; for(const v of entries){ html += '<div class="tile"><div><b>Key:</b> '+v.key+'</div><div><b>Lượt thiết bị còn:</b> '+v.usesLeft+'</div><div><b>Đã dùng:</b> '+v.usedDevices+' / '+v.totalDevices+'</div><div><b>Hết hạn:</b> '+new Date(v.expireAt).toLocaleString('vi-VN')+'</div><button class="smallBtn" style="width:100%;margin-top:10px;background:#5f1634" onclick="xoaKey(\''+v.key+'\')">Xóa key</button></div>'; } box.innerHTML=html; }catch{ box.innerHTML='<span style="color:#ff7aa2">❌ Lỗi mạng</span>'; } }
async function xoaKey(key){ const adminKey=document.getElementById('adminKey').value.trim(); await fetch('/api/delete?admin='+encodeURIComponent(adminKey),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key})}); taiDanhSach(); }
</script></body></html>`;
}

app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  next();
});

app.use((req, res, next) => {
  const ip = ((req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim()) || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const windowMs = 15000;
  const limit = 90;
  if (!rateMap.has(ip)) rateMap.set(ip, []);
  const arr = rateMap.get(ip).filter((t) => now - t < windowMs);
  arr.push(now);
  rateMap.set(ip, arr);
  if (arr.length > limit) return res.status(429).json({ ok: false, msg: 'Thao tác quá nhanh' });
  next();
});

function isAdmin(req) {
  return req.query.admin === ADMIN_KEY;
}

function genKey() {
  const a = Math.random().toString(36).slice(2, 6).toUpperCase();
  const b = Math.random().toString(36).slice(2, 6).toUpperCase();
  return 'ATH-' + a + '-' + b;
}

app.get('/healthz', (req, res) => res.send('ok'));
app.get('/', (req, res) => res.send(renderHomeHtml()));
app.get('/panel', (req, res) => res.send(renderPanelHtml()));
app.get('/admin', (req, res) => res.send(renderAdminHtml()));

app.post('/api/create', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'Sai admin key' });
  const customKey = String(req.body.key || '').trim();
  const totalDevices = Math.max(1, Number(req.body.uses || 50));
  const days = Math.max(1, Number(req.body.days || 30));
  const key = customKey || genKey();
  const expireAt = Date.now() + days * 24 * 60 * 60 * 1000;

  try {
    await queuedWrite((store) => {
      store[key] = { usesLeft: totalDevices, totalDevices, devices: [], expireAt, createdAt: Date.now() };
      return store;
    }, `create key ${key}`);

    return res.json({ ok: true, key, uses: totalDevices, totalDevices, expireAt, expireText: formatVNTime(expireAt), storage: isGitHubStorageEnabled() ? 'github' : 'local' });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Không thể tạo key' });
  }
});

app.post('/api/check', async (req, res) => {
  const key = String(req.body.key || '').trim();
  const device = String(req.body.device || '').trim();
  if (!key || !device) return res.json({ ok: false, msg: 'Thiếu key hoặc thiết bị' });

  try {
    let responsePayload = null;
    await queuedWrite((store) => {
      const item = normalizeKeyItem(store[key]);
      if (!item) {
        responsePayload = { ok: false, msg: 'Key không tồn tại' };
        return store;
      }
      if (Date.now() >= item.expireAt) {
        responsePayload = { ok: false, msg: 'Key đã hết hạn' };
        return store;
      }
      const alreadyUsed = item.devices.includes(device);
      if (!alreadyUsed) {
        if (item.usesLeft <= 0) {
          responsePayload = { ok: false, msg: 'Key đã hết lượt thiết bị' };
          return store;
        }
        item.devices.push(device);
        item.usesLeft -= 1;
      }
      store[key] = item;
      responsePayload = {
        ok: true,
        msg: 'Đăng nhập thành công',
        key,
        token: createSessionToken(key, device, item.expireAt),
        expireAt: item.expireAt,
        expireText: formatVNTime(item.expireAt),
        usesLeft: item.usesLeft,
        usedDevices: item.devices.length,
        totalDevices: item.totalDevices
      };
      return store;
    }, `check key ${key}`);
    return res.json(responsePayload || { ok: false, msg: 'Không thể xác thực key' });
  } catch (error) {
    return res.status(500).json({ ok: false, msg: error.message || 'Lỗi máy chủ' });
  }
});

app.post('/api/status', async (req, res) => {
  const token = String(req.body.token || '').trim();
  const device = String(req.body.device || '').trim();
  if (!token || !device) return res.json({ ok: false, msg: 'Thiếu phiên đăng nhập' });
  const parsed = verifySessionToken(token);
  if (!parsed) return res.json({ ok: false, msg: 'Phiên không hợp lệ' });
  if (parsed.device !== device) return res.json({ ok: false, msg: 'Phiên không đúng thiết bị' });

  try {
    const store = await loadGitHubStore(true);
    const item = normalizeKeyItem(store[parsed.key]);
    if (!item) return res.json({ ok: false, msg: 'Key không tồn tại' });
    if (Date.now() >= item.expireAt) return res.json({ ok: false, msg: 'Key đã hết hạn' });
    if (!item.devices.includes(device)) return res.json({ ok: false, msg: 'Thiết bị chưa được cấp quyền cho key này' });
    return res.json({ ok: true, key: parsed.key, expireAt: item.expireAt, expireText: formatVNTime(item.expireAt), usesLeft: item.usesLeft, usedDevices: item.devices.length, totalDevices: item.totalDevices });
  } catch (error) {
    return res.status(500).json({ ok: false, msg: error.message || 'Lỗi máy chủ' });
  }
});

app.get('/api/list', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'Sai admin key' });
  try {
    const store = await loadGitHubStore(true);
    const items = Object.entries(store).map(([key, raw]) => {
      const value = normalizeKeyItem(raw);
      return { key, usesLeft: value.usesLeft, usedDevices: value.devices.length, totalDevices: value.totalDevices, expireAt: value.expireAt, expireText: formatVNTime(value.expireAt) };
    });
    return res.json({ ok: true, items });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Không tải được danh sách key' });
  }
});

app.post('/api/delete', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'Sai admin key' });
  const key = String(req.body.key || '').trim();
  try {
    let deleted = false;
    await queuedWrite((store) => {
      if (store[key]) {
        delete store[key];
        deleted = true;
      }
      return store;
    }, `delete key ${key}`);
    return res.json(deleted ? { ok: true, msg: 'Đã xóa key' } : { ok: false, error: 'Không tìm thấy key' });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Không thể xóa key' });
  }
});

(async () => {
  try {
    const store = await loadGitHubStore(true);
    const normalized = {};
    for (const [k, v] of Object.entries(store)) {
      const item = normalizeKeyItem(v);
      if (item) normalized[k] = item;
    }
    await saveGitHubStore(normalized, 'normalize key store');
  } catch (error) {
    console.error('Storage init warning:', error.message);
  }

  app.listen(PORT, () => {
    console.log('Server chạy tại port ' + PORT);
    console.log('Storage mode:', isGitHubStorageEnabled() ? 'GitHub' : 'Local');
  });
})();
