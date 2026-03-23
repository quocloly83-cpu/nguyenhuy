const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_PASSWORD || "nguyentanhuyvip10thanhngannek";
const SESSION_SECRET =
  process.env.SESSION_SECRET || "ath_super_secret_huy_fanta_2026_ui_upgrade";

const FACEBOOK_URL =
  "https://www.facebook.com/share/1JHonUUaCA/?mibextid=wwXIfr";
const ZALO_URL = "https://zalo.me/0818249250";
const TIKTOK_URL =
  "https://www.tiktok.com/@huyftsupport?_r=1&_t=ZS-94olc9q74ba";

const FF_ANDROID_PACKAGE = process.env.FF_ANDROID_PACKAGE || "com.dts.freefireth";
const FFMAX_ANDROID_PACKAGE = process.env.FFMAX_ANDROID_PACKAGE || "com.dts.freefiremax";
const FF_IOS_SCHEME = process.env.FF_IOS_SCHEME || "freefire://";
const FFMAX_IOS_SCHEME = process.env.FFMAX_IOS_SCHEME || "freefiremax://";
const FF_IOS_APPID = process.env.FF_IOS_APPID || "1300146617";
const FFMAX_IOS_APPID = process.env.FFMAX_IOS_APPID || "1480516829";

const STORE_PATH = path.join(__dirname, process.env.GITHUB_DATA_PATH || "keys.json");
const LOGO_PATH = path.join(__dirname, "logo.png");
const rateMap = new Map();

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
const GITHUB_REPO = process.env.GITHUB_REPO || "";
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";
const GITHUB_DATA_PATH = process.env.GITHUB_DATA_PATH || "keys.json";
const GITHUB_API = GITHUB_REPO
  ? `https://api.github.com/repos/${GITHUB_REPO}/contents/${encodeURIComponent(GITHUB_DATA_PATH).replace(/%2F/g, "/")}`
  : "";

let keys = {};
let githubSha = null;
let storeReady = false;
let storeInitPromise = null;

function usingGitHubStore() {
  return Boolean(GITHUB_TOKEN && GITHUB_REPO && GITHUB_DATA_PATH);
}

function loadStoreLocal() {
  try {
    if (!fs.existsSync(STORE_PATH)) return {};
    const raw = fs.readFileSync(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveStoreLocal() {
  fs.writeFileSync(STORE_PATH, JSON.stringify(keys, null, 2), "utf8");
}

async function githubFetchJson(method, body) {
  const res = await fetch(GITHUB_API, {
    method,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "hft-panel"
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`GitHub API ${res.status}: ${txt.slice(0, 300)}`);
  }

  return res.json();
}

async function loadStoreGitHub() {
  try {
    const data = await githubFetchJson("GET");
    githubSha = data.sha || null;
    const raw = Buffer.from(data.content || "", "base64").toString("utf8") || "{}";
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    if (String(err.message || "").includes("404")) {
      githubSha = null;
      return {};
    }
    throw err;
  }
}

async function saveStoreGitHub() {
  const content = Buffer.from(JSON.stringify(keys, null, 2), "utf8").toString("base64");
  const body = {
    message: `Update keys store ${new Date().toISOString()}`,
    content,
    branch: GITHUB_BRANCH
  };
  if (githubSha) body.sha = githubSha;
  const data = await githubFetchJson("PUT", body);
  githubSha = data.content?.sha || data.commit?.sha || githubSha;
}

function normalizeKeyItem(item) {
  if (!item || typeof item !== "object") return null;

  if (!Array.isArray(item.devices)) item.devices = [];
  if (item.device && !item.devices.includes(item.device)) item.devices.push(item.device);

  if (typeof item.usesLeft !== "number") {
    if (typeof item.uses === "number") item.usesLeft = Number(item.uses || 0);
    else item.usesLeft = 0;
  }

  if (typeof item.totalDevices !== "number") {
    item.totalDevices = Math.max(
      item.devices.length,
      item.devices.length + Number(item.usesLeft || 0)
    );
  }

  item.usesLeft = Math.max(0, Number(item.usesLeft || 0));
  item.totalDevices = Math.max(item.devices.length, Number(item.totalDevices || 0));
  item.expireAt = Number(item.expireAt || 0);
  item.createdAt = Number(item.createdAt || Date.now());

  delete item.device;
  delete item.uses;

  return item;
}

function normalizeStoreObject(obj) {
  const store = obj && typeof obj === "object" ? obj : {};
  Object.keys(store).forEach((k) => {
    const normalized = normalizeKeyItem(store[k]);
    if (normalized) store[k] = normalized;
    else delete store[k];
  });
  return store;
}

async function ensureStoreLoaded(force = false) {
  if (storeReady && !force) return;
  if (storeInitPromise && !force) return storeInitPromise;

  storeInitPromise = (async () => {
    let loaded = {};
    if (usingGitHubStore()) {
      try {
        loaded = await loadStoreGitHub();
      } catch (err) {
        console.error("GitHub store load failed, fallback local:", err.message);
        loaded = loadStoreLocal();
      }
    } else {
      loaded = loadStoreLocal();
    }

    keys = normalizeStoreObject(loaded);
    if (!usingGitHubStore()) {
      try { saveStoreLocal(); } catch {}
    }
    storeReady = true;
  })();

  return storeInitPromise.finally(() => {
    storeInitPromise = null;
  });
}

async function persistStore() {
  keys = normalizeStoreObject(keys);
  if (usingGitHubStore()) {
    try {
      await saveStoreGitHub();
      return;
    } catch (err) {
      console.error("GitHub save failed, fallback local:", err.message);
    }
  }
  saveStoreLocal();
}

app.use(async (req, res, next) => {
  try {
    await ensureStoreLoaded();
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, msg: "Không thể tải dữ liệu key" });
  }
});

app.use((req, res, next) => {
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
  next();
});

app.use((req, res, next) => {
  const ip =
    (req.headers["x-forwarded-for"] || "")
      .toString()
      .split(",")[0]
      .trim() || req.socket.remoteAddress || "unknown";

  const now = Date.now();
  const windowMs = 15000;
  const limit = 100;

  if (!rateMap.has(ip)) rateMap.set(ip, []);
  const arr = rateMap.get(ip).filter((t) => now - t < windowMs);
  arr.push(now);
  rateMap.set(ip, arr);

  if (arr.length > limit) {
    return res.status(429).json({ ok: false, msg: "Thao tác quá nhanh" });
  }

  next();
});

function isAdmin(req) {
  return req.query.admin === ADMIN_KEY;
}

function genKey() {
  const a = Math.random().toString(36).slice(2, 6).toUpperCase();
  const b = Math.random().toString(36).slice(2, 6).toUpperCase();
  return "ATH-" + a + "-" + b;
}

function formatVNTime(ms) {
  return new Date(ms).toLocaleString("vi-VN");
}

function msToViDuration(ms) {
  if (ms <= 0) return "0 phút";
  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (days) parts.push(days + " ngày");
  if (hours) parts.push(hours + " giờ");
  if (minutes || parts.length === 0) parts.push(minutes + " phút");
  return parts.slice(0, 3).join(" ");
}

function signText(text) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(text).digest("hex");
}

function createSessionToken(key, device, expireAt) {
  const issuedAt = Date.now();
  const payload = `${key}|${device}|${expireAt}|${issuedAt}`;
  const sig = signText(payload);
  return Buffer.from(`${payload}|${sig}`, "utf8").toString("base64url");
}

function verifySessionToken(token) {
  try {
    const raw = Buffer.from(token, "base64url").toString("utf8");
    const parts = raw.split("|");
    if (parts.length !== 5) return null;

    const key = parts[0];
    const device = parts[1];
    const expireAt = parts[2];
    const issuedAt = parts[3];
    const sig = parts[4];

    const payload = `${key}|${device}|${expireAt}|${issuedAt}`;
    const check = signText(payload);

    if (sig !== check) return null;

    return {
      key,
      device,
      expireAt: Number(expireAt),
      issuedAt: Number(issuedAt)
    };
  } catch {
    return null;
  }
}

function renderLogo(size, radius) {
  const r = radius || Math.round(size * 0.28);
  if (fs.existsSync(LOGO_PATH)) {
    return `<img src="/logo.png" alt="AimTrickHead Logo" style="width:${size}px;height:${size}px;object-fit:cover;display:block;border-radius:${r}px">`;
  }
  return `<div style="width:${size}px;height:${size}px;border-radius:${r}px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#8c52ff,#ffd56b);font-size:${Math.round(size * 0.4)}px;color:#fff">⚡</div>`;
}

function iconFacebook() {
  return `
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path fill="#1877F2" d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073c0 6.023 4.388 11.015 10.125 11.927v-8.437H7.078v-3.49h3.047V9.41c0-3.017 1.792-4.684 4.533-4.684 1.313 0 2.686.235 2.686.235v2.963H15.83c-1.49 0-1.955.931-1.955 1.886v2.263h3.328l-.532 3.49h-2.796V24C19.612 23.088 24 18.096 24 12.073Z"/>
    <path fill="#fff" d="M16.671 15.563l.532-3.49h-3.328V9.81c0-.955.465-1.886 1.955-1.886h1.514V4.96s-1.373-.235-2.686-.235c-2.741 0-4.533 1.667-4.533 4.684v2.664H7.078v3.49h3.047V24h3.75v-8.437h2.796Z"/>
  </svg>`;
}

function iconZalo() {
  return `
  <svg width="20" height="20" viewBox="0 0 64 64" fill="none" aria-hidden="true">
    <rect x="4" y="4" width="56" height="56" rx="18" fill="#0068FF"/>
    <path d="M17 22h30.5c1.7 0 2.58 2.03 1.42 3.27L28.1 46h18.4c1.9 0 2.73 2.39 1.23 3.56L46 51H17.5c-1.72 0-2.6-2.08-1.38-3.31L36.9 27H17c-1.66 0-2.5-2-1.34-3.2l.03-.03C16.05 22.3 16.5 22 17 22Z" fill="white"/>
  </svg>`;
}

function baseStyles() {
  return `
  <style>
    *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
    html{-webkit-text-size-adjust:100%;touch-action:manipulation}
    :root{
      --line:rgba(255,255,255,.08);
      --violet:#d9b6ff;
      --violet2:#b97dff;
      --pink:#ff7ada;
      --gold:#ffd76f;
      --gold2:#ffb547;
      --muted:#c4b8d8;
      --ok:#8dffb4;
      --err:#ff7aa2;
      --card:rgba(11,9,18,.92);
    }
    body{
      margin:0;min-height:100vh;font-family:Arial,sans-serif;color:#fff;overflow:hidden;
      background:
        radial-gradient(circle at 12% 16%, rgba(185,125,255,.22), transparent 22%),
        radial-gradient(circle at 88% 18%, rgba(255,122,218,.18), transparent 22%),
        radial-gradient(circle at 50% 102%, rgba(255,183,71,.14), transparent 28%),
        linear-gradient(160deg,#040308,#0f0818,#080510);
    }
    body::before{
      content:"";position:fixed;inset:0;pointer-events:none;opacity:.18;
      background:linear-gradient(transparent, rgba(255,255,255,.03), transparent);
      background-size:100% 6px;animation:scan 12s linear infinite;
    }
    body::after{
      content:"";position:fixed;inset:-15%;pointer-events:none;opacity:.15;
      background:radial-gradient(circle, rgba(255,255,255,.045) 1px, transparent 1px);
      background-size:19px 19px;animation:moveDots 28s linear infinite;
    }
    @keyframes scan{from{transform:translateY(-100%)}to{transform:translateY(100%)}}
    @keyframes moveDots{from{transform:translateY(0)}to{transform:translateY(85px)}}
    @keyframes glow{
      0%{box-shadow:0 0 18px rgba(185,125,255,.16),0 0 38px rgba(255,183,71,.04)}
      50%{box-shadow:0 0 28px rgba(185,125,255,.24),0 0 56px rgba(255,183,71,.09)}
      100%{box-shadow:0 0 18px rgba(185,125,255,.16),0 0 38px rgba(255,183,71,.04)}
    }
    @keyframes pulseText{
      0%{text-shadow:0 0 10px rgba(185,125,255,.25)}
      50%{text-shadow:0 0 16px rgba(255,183,71,.25)}
      100%{text-shadow:0 0 10px rgba(185,125,255,.25)}
    }
    @keyframes neonBar{0%{background-position:0% 50%}100%{background-position:200% 50%}}
    @keyframes popIn{0%{opacity:0;transform:translateY(8px) scale(.98)}100%{opacity:1;transform:translateY(0) scale(1)}}
    @keyframes pulseRing{0%{transform:scale(.94);opacity:.26}100%{transform:scale(1.16);opacity:0}}
    .wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:18px;overflow:hidden}
    .card{
      width:min(94vw,535px);max-height:calc(100vh - 34px);overflow:auto;border-radius:30px;
      background:var(--card);border:1px solid rgba(217,182,255,.18);animation:glow 4s infinite;
      backdrop-filter:blur(16px);box-shadow:0 0 26px rgba(185,125,255,.15);overscroll-behavior:contain;
    }
    .card::-webkit-scrollbar{width:0;height:0}
    .top{padding:22px 18px 16px;border-bottom:1px solid var(--line);position:relative;overflow:hidden}
    .top::before{
      content:"";position:absolute;inset:auto -12% -62% auto;width:260px;height:260px;
      background:radial-gradient(circle, rgba(185,125,255,.17), transparent 66%);pointer-events:none
    }
    .top::after{
      content:"";position:absolute;left:-20%;top:-40px;width:140%;height:4px;
      background:linear-gradient(90deg,transparent,var(--violet2),var(--gold),var(--pink),transparent);
      background-size:220% 100%;animation:neonBar 3.4s linear infinite
    }
    .brand{display:flex;align-items:center;gap:14px}
    .logoBox{width:74px;height:74px;border-radius:22px;overflow:hidden;box-shadow:0 0 18px rgba(185,125,255,.34);flex:0 0 74px;background:rgba(255,255,255,.04);position:relative}
    .logoBox::after{content:"";position:absolute;inset:0;border-radius:22px;border:1px solid rgba(255,255,255,.08)}
    .title{margin:0;font-size:clamp(22px,5vw,30px);color:var(--violet);animation:pulseText 3s infinite}
    .sub{margin:6px 0 0;color:var(--muted);font-size:13px}
    .credit{margin-top:10px;color:var(--gold);font-size:12px;font-weight:700;letter-spacing:.5px}
    .content{padding:16px}
    .input{
      width:100%;height:56px;border:none;outline:none;border-radius:16px;padding:0 14px;color:#fff;
      background:rgba(255,255,255,.06);border:1px solid var(--line);font-size:15px;transition:.2s;
    }
    .input:focus{border-color:rgba(255,215,111,.45);box-shadow:0 0 0 4px rgba(255,215,111,.06)}
    .btn,.smallBtn,.tab,.socialBtn,.gameBtn{border:none;color:#fff;cursor:pointer;font-weight:700;border-radius:14px;transition:.2s}
    .btn{
      width:100%;height:54px;margin-top:12px;background:linear-gradient(90deg,#8c52ff,#d18aff,#ffcc6d,#ff7ada);
      background-size:240% 100%;animation:neonBar 4s linear infinite;font-size:15px
    }
    .btn:hover,.gameBtn:hover,.smallBtn:hover,.socialBtn:hover{transform:translateY(-1px)}
    .smallBtn{height:38px;padding:0 12px;background:rgba(255,255,255,.08);border:1px solid var(--line)}
    .msg{min-height:22px;margin-top:12px;text-align:center;font-size:14px}
    .ok{color:var(--ok)} .err{color:var(--err)} .hidden{display:none!important}
    .topLine{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:14px}
    .pill{display:inline-flex;align-items:center;gap:8px;padding:10px 12px;border-radius:999px;background:rgba(255,255,255,.06);border:1px solid var(--line);font-size:12px;color:#f0e6ff}
    .noticeBox{
      margin-top:12px;padding:13px 14px;border-radius:16px;background:linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.03));
      border:1px solid var(--line);font-size:13px;color:#efe7ff;line-height:1.6
    }
    .tabs{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin:16px 0 14px}
    .tab{height:44px;border-radius:14px;border:1px solid var(--line);background:rgba(255,255,255,.05);font-size:12px}
    .tab.active{background:linear-gradient(90deg,#8c52ff,#d18aff,#ffcc6d,#ff7ada);background-size:220% 100%;animation:neonBar 5s linear infinite}
    .tabPane{display:none}.tabPane.active{display:block;animation:popIn .25s ease}
    .tile{
      padding:16px;border-radius:18px;margin-bottom:12px;background:linear-gradient(180deg, rgba(255,255,255,.05), rgba(255,255,255,.03));
      border:1px solid var(--line);position:relative;overflow:hidden;transition:transform .2s ease, box-shadow .2s ease
    }
    .tile:hover{transform:translateY(-2px);box-shadow:0 0 18px rgba(185,125,255,.12)}
    .tile::before{content:"";position:absolute;width:140px;height:140px;right:-40px;bottom:-40px;background:radial-gradient(circle, rgba(185,125,255,.16), transparent 65%)}
    .row{display:flex;align-items:center;justify-content:space-between;gap:12px;position:relative;z-index:1}
    .name{margin:0;font-size:16px}.desc{margin:6px 0 0;color:#c7bed7;font-size:12px;line-height:1.45}
    .switch{position:relative;width:58px;height:32px;flex:0 0 58px}.switch input{display:none}
    .slider{position:absolute;inset:0;border-radius:999px;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.1);transition:.25s;cursor:pointer}
    .slider:before{content:"";position:absolute;width:24px;height:24px;left:4px;top:3px;border-radius:50%;background:#fff;transition:.25s}
    .switch input:checked + .slider{background:linear-gradient(90deg,#8c52ff,#ffcc6d,#ff7ada);box-shadow:0 0 18px rgba(209,138,255,.22)}
    .switch input:checked + .slider:before{transform:translateX(25px)}
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    .socialBtn{display:flex;align-items:center;justify-content:center;gap:10px;height:50px;text-decoration:none;background:rgba(255,255,255,.07);border:1px solid var(--line);font-size:14px}
    .gameGrid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    .gameBtn{
      display:flex;align-items:center;justify-content:center;gap:10px;height:54px;padding:0 12px;text-decoration:none;
      background:linear-gradient(90deg,rgba(140,82,255,.22),rgba(255,215,111,.16));border:1px solid rgba(255,215,111,.18)
    }
    .gameBtn strong{font-size:14px}
    .footer{margin-top:10px;text-align:center;font-size:12px;color:#b9b0c9;line-height:1.6}
    .liveFx{margin-top:10px;padding:10px 12px;border-radius:14px;background:rgba(255,255,255,.05);border:1px solid var(--line);color:#f1e8ff;font-size:12px;min-height:38px}
    .fxLine{display:inline-block;animation:pulseText 1.6s infinite}
    .sliderWrap{margin-top:10px}.rangeLabel{display:flex;align-items:center;justify-content:space-between;font-size:12px;color:#e5dcf5;margin-bottom:8px}
    input[type=range]{width:100%;accent-color:#c86bff}
    .toast{position:fixed;left:50%;bottom:18px;transform:translateX(-50%) translateY(20px);min-width:220px;max-width:92vw;padding:14px 16px;border-radius:16px;background:rgba(12,15,24,.95);border:1px solid var(--line);color:#fff;text-align:center;z-index:120;opacity:0;pointer-events:none;transition:.25s}
    .toast.show{opacity:1;transform:translateX(-50%) translateY(0)} .toast.ok{color:var(--ok)} .toast.err{color:var(--err)}
    .loadingLayer{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;flex-direction:column;background:radial-gradient(circle at center, rgba(185,125,255,.20), transparent 30%),linear-gradient(160deg,#030207,#0b0612,#05040b);transition:opacity .55s ease, visibility .55s ease}
    .loadingLayer.hide{opacity:0;visibility:hidden}
    .loadingLogo{width:170px;height:170px;border-radius:28px;overflow:hidden;box-shadow:0 0 30px rgba(185,125,255,.28),0 0 70px rgba(255,183,71,.12);animation:glow 3s infinite, popIn .7s ease;background:rgba(255,255,255,.03);position:relative}
    .loadingLogo::before{content:"";position:absolute;inset:-10px;border-radius:34px;border:1px solid rgba(255,255,255,.08);animation:pulseRing 2.2s linear infinite}
    .loadingLogo::after{content:"";position:absolute;inset:0;border-radius:28px;border:1px solid rgba(255,255,255,.09)}
    .loadingText{margin-top:18px;font-size:16px;color:var(--violet);font-weight:800;letter-spacing:1px;animation:pulseText 2s infinite}
    .loadingSub{margin-top:8px;color:#cbbddf;font-size:12px}
    .loadingBar{width:min(260px,72vw);height:8px;border-radius:999px;margin-top:16px;background:rgba(255,255,255,.08);overflow:hidden;border:1px solid rgba(255,255,255,.08)}
    .loadingBar > span{display:block;height:100%;width:35%;background:linear-gradient(90deg,#8c52ff,#d18aff,#ffcc6d,#ff7ada);border-radius:999px;animation:neonBar 1.2s linear infinite;background-size:220% 100%}
    @media (max-width:560px){.tabs{grid-template-columns:repeat(3,1fr)}.grid2,.gameGrid{grid-template-columns:1fr}.wrap{padding:12px}.card{width:min(96vw,535px);max-height:calc(100vh - 24px)}}
  </style>`;
}

function renderHomeHtml() {
  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
  <title>AimTrickHead</title>
  <style>
    body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#07090f;color:#fff;font-family:Arial,sans-serif;padding:20px}
    .box{width:min(92vw,430px);padding:24px;border-radius:24px;background:rgba(255,255,255,.04);border:1px solid rgba(180,120,255,.22);box-shadow:0 0 30px rgba(180,120,255,.12);text-align:center}
    h1{margin-top:0;color:#d8b4ff}
    a{display:block;margin:12px 0;padding:14px;border-radius:14px;text-decoration:none;color:#fff;background:linear-gradient(90deg,#8c52ff,#c86bff,#ff70c7)}
  </style>
</head>
<body>
  <div class="box">
    <h1>AimTrickHead</h1>
    <p>Hệ thống đang hoạt động</p>
    <a href="/panel">Vào panel</a>
    <a href="/admin">Admin</a>
  </div>
</body>
</html>`;
}

function renderPanelHtml() {
  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
  <title>AimTrickHead VIP</title>
  ${baseStyles()}
</head>
<body>
  <div class="loadingLayer" id="loadingLayer">
    <div class="loadingLogo">${renderLogo(170, 28)}</div>
    <div class="loadingText">AimTrickHead VIP</div>
    <div class="loadingSub">Loading secure panel...</div>
    <div class="loadingBar"><span></span></div>
  </div>

  <div class="wrap">
    <div class="card">
      <div class="top">
        <div class="brand">
          <div class="logoBox">${renderLogo(74, 22)}</div>
          <div>
            <h1 class="title">AimTrickHead VIP</h1>
            <div class="sub">Form cũ được làm lại gọn hơn, sáng hơn, mượt hơn</div>
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

          <div class="tabs">
            <button class="tab active" data-tab="tab1">Main</button>
            <button class="tab" data-tab="tab2">Optimize</button>
            <button class="tab" data-tab="tab3">Boost</button>
            <button class="tab" data-tab="tab4">Game</button>
            <button class="tab" data-tab="tab5">Social</button>
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
            <div class="tile">
              <p class="name">Sensi Control</p>
              <p class="desc">Tác dụng phản ngồi ngay sau khi bật</p>
              <div class="sliderWrap">
                <div class="rangeLabel"><span>Level</span><span id="sensiValue">60</span></div>
                <input type="range" min="1" max="120" value="60" id="sensiRange" oninput="updateSensi(this.value)">
              </div>
            </div>
          </div>

          <div id="tab3" class="tabPane">
            <div class="tile"><div class="row"><div><p class="name">Nhẹ Tâm + Fix Rung</p><p class="desc">Tác dụng phản ngồi ngay sau khi bật</p></div><label class="switch"><input type="checkbox" id="f1" onchange="toggleFx(this,'Nhẹ Tâm + Fix Rung')"><span class="slider"></span></label></div></div>
            <div class="tile"><div class="row"><div><p class="name">Game Boost</p><p class="desc">Tối ưu phản hồi và độ mượt ngay sau khi bật</p></div><label class="switch"><input type="checkbox" id="f7" onchange="toggleFx(this,'Game Boost')"><span class="slider"></span></label></div></div>
          </div>

          <div id="tab4" class="tabPane">
            <div class="tile">
              <p class="name">Mở game nhanh</p>
              <p class="desc">Nút vào game mở trực tiếp. Không cần bật hết chức năng mới được vào.</p>
              <div class="gameGrid" style="margin-top:12px">
                <button class="gameBtn" onclick="moGame('ff')">🎮 <strong>Free Fire</strong></button>
                <button class="gameBtn" onclick="moGame('ffmax')">🔥 <strong>FF MAX</strong></button>
              </div>
              <div class="footer">Android sẽ gọi app bằng package. iPhone sẽ thử mở app rồi fallback sang App Store nếu cần.</div>
            </div>
          </div>

          <div id="tab5" class="tabPane">
            <div class="grid2">
              <a class="socialBtn" href="${ZALO_URL}" target="_blank" rel="noopener noreferrer">${iconZalo()} <span>Liên hệ Zalo</span></a>
              <a class="socialBtn" href="${FACEBOOK_URL}" target="_blank" rel="noopener noreferrer">${iconFacebook()} <span>Facebook</span></a>
            </div>
            <div class="footer">Mua key hoặc hỗ trợ trực tiếp qua các nút trên.</div>
          </div>

          <div id="tab6" class="tabPane">
            <div class="grid2">
              <a class="socialBtn" href="${TIKTOK_URL}" target="_blank" rel="noopener noreferrer">🎵 <span>TikTok</span></a>
              <a class="socialBtn" href="${ZALO_URL}" target="_blank" rel="noopener noreferrer">${iconZalo()} <span>Liên hệ Admin</span></a>
            </div>
            <div class="footer">
              Kênh tiktok share key trải nghiệm, anh em theo dõi kênh để lấy key sớm nhé.<br>
              Key trải nghiệm tác dụng sẽ ít hơn 1 xíu, anh em muốn mua key vĩnh viễn cứ liên hệ admin.
            </div>
          </div>

          <div class="liveFx" id="liveFxBox"><span class="fxLine">⚡ Chờ kích hoạt module...</span></div>
        </div>
      </div>
    </div>
  </div>

  <div id="toast" class="toast"></div>

  <script>
    const msg = document.getElementById("msg");
    const loginView = document.getElementById("loginView");
    const panelView = document.getElementById("panelView");
    const toast = document.getElementById("toast");
    const liveFxBox = document.getElementById("liveFxBox");
    const sensiValue = document.getElementById("sensiValue");
    const loadingLayer = document.getElementById("loadingLayer");
    const keyNotice = document.getElementById("keyNotice");

    const APPS = {
      ff: {
        androidPackage: ${JSON.stringify(FF_ANDROID_PACKAGE)},
        iosScheme: ${JSON.stringify(FF_IOS_SCHEME)},
        iosStore: ${JSON.stringify(`https://apps.apple.com/vn/app/id${FF_IOS_APPID}`)}
      },
      ffmax: {
        androidPackage: ${JSON.stringify(FFMAX_ANDROID_PACKAGE)},
        iosScheme: ${JSON.stringify(FFMAX_IOS_SCHEME)},
        iosStore: ${JSON.stringify(`https://apps.apple.com/vn/app/id${FFMAX_IOS_APPID}`)}
      }
    };

    let fxTimer = null;

    function hideLoading() {
      setTimeout(function () { loadingLayer.classList.add("hide"); }, 1900);
    }

    function showToast(text, type) {
      toast.className = "toast show " + (type || "");
      toast.textContent = text || "";
      setTimeout(function () { toast.className = "toast"; }, 2200);
    }

    function getDevice() {
      let id = localStorage.getItem("ath_device");
      if (!id) {
        id = "web-" + Math.random().toString(36).slice(2, 12);
        localStorage.setItem("ath_device", id);
      }
      return id;
    }

    function setMsg(text, type) {
      msg.textContent = text || "";
      msg.className = "msg " + (type || "");
    }

    function saveSession(data) {
      localStorage.setItem("ath_session", data.token || "");
      localStorage.setItem("ath_key", data.key || "");
    }

    function getSession() { return localStorage.getItem("ath_session"); }
    function getSavedKey() { return localStorage.getItem("ath_key") || ""; }
    function clearSession() {
      localStorage.removeItem("ath_session");
      localStorage.removeItem("ath_key");
    }

    function buildNotice(data) {
      const keyText = data.key || getSavedKey() || "Đang hoạt động";
      const remainText = msToViDuration((data.expireAt || 0) - Date.now());
      keyNotice.innerHTML =
        '<b>Key:</b> ' + keyText +
        '<br><b>Hiệu lực còn:</b> ' + remainText +
        '<br><b>Hết hạn lúc:</b> ' + (data.expireText || '--');
    }

    function msToViDuration(ms) {
      if (ms <= 0) return "0 phút";
      const totalMinutes = Math.floor(ms / 60000);
      const days = Math.floor(totalMinutes / (60 * 24));
      const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
      const minutes = totalMinutes % 60;
      const parts = [];
      if (days) parts.push(days + " ngày");
      if (hours) parts.push(hours + " giờ");
      if (minutes || parts.length === 0) parts.push(minutes + " phút");
      return parts.slice(0, 3).join(" ");
    }

    function startFxFeed() {
      clearInterval(fxTimer);
      const lines = [
        "⚡ Secure sync loading...",
        "⚡ Rebinding panel states...",
        "⚡ Mobile profile online...",
        "⚡ Visual preset active...",
        "⚡ Optimize stream ready...",
        "⚡ Smooth touch online...",
        "⚡ Loading premium tabs..."
      ];
      let i = 0;
      fxTimer = setInterval(function () {
        liveFxBox.innerHTML = '<span class="fxLine">' + lines[i % lines.length] + '</span>';
        i++;
      }, 1200);
    }

    function moPanel(data) {
      loginView.classList.add("hidden");
      panelView.classList.remove("hidden");
      buildNotice(data);
      taiTrangThai();
      startFxFeed();
    }

    function dangXuat() {
      clearSession();
      clearInterval(fxTimer);
      panelView.classList.add("hidden");
      loginView.classList.remove("hidden");
      document.getElementById("keyInput").value = "";
      setMsg("", "");
      showToast("Đã thoát", "err");
    }

    async function dangNhap() {
      const key = document.getElementById("keyInput").value.trim();
      if (!key) {
        setMsg("Vui lòng nhập key.", "err");
        return;
      }
      setMsg("Đang kiểm tra key...");
      try {
        const res = await fetch("/api/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: key, device: getDevice() })
        });
        const data = await res.json();
        if (!data.ok) {
          setMsg(data.msg || "Đăng nhập thất bại.", "err");
          return;
        }
        saveSession({ token: data.token, key: key });
        data.key = key;
        setMsg("Đăng nhập thành công.", "ok");
        showToast("Đăng nhập thành công", "ok");
        moPanel(data);
      } catch (e) {
        setMsg("Không thể kết nối tới máy chủ.", "err");
      }
    }

    function toggleFx(el, label) {
      luuTrangThai();
      if (el.checked) {
        liveFxBox.innerHTML = '<span class="fxLine">⚡ ' + label + ' -> ACTIVE...</span>';
        showToast(label + ' đã bật', 'ok');
      } else {
        liveFxBox.innerHTML = '<span class="fxLine">⚡ ' + label + ' -> OFF</span>';
        showToast(label + ' đã tắt', 'err');
      }
    }

    function updateSensi(val) {
      sensiValue.textContent = val;
      localStorage.setItem("ath_sensi", String(val));
      liveFxBox.innerHTML = '<span class="fxLine">⚡ Sensi tuned -> ' + val + '</span>';
    }

    function luuTrangThai() {
      const state = {
        f1: document.getElementById("f1") ? document.getElementById("f1").checked : false,
        f2: document.getElementById("f2") ? document.getElementById("f2").checked : false,
        f3: document.getElementById("f3") ? document.getElementById("f3").checked : false,
        f4: document.getElementById("f4") ? document.getElementById("f4").checked : false,
        f5: document.getElementById("f5") ? document.getElementById("f5").checked : false,
        f6: document.getElementById("f6") ? document.getElementById("f6").checked : false,
        f7: document.getElementById("f7") ? document.getElementById("f7").checked : false
      };
      localStorage.setItem("ath_state", JSON.stringify(state));
    }

    function taiTrangThai() {
      try {
        const state = JSON.parse(localStorage.getItem("ath_state") || "{}");
        ["f1","f2","f3","f4","f5","f6","f7"].forEach(function (id) {
          const el = document.getElementById(id);
          if (el) el.checked = !!state[id];
        });
        const savedSensi = localStorage.getItem("ath_sensi") || "60";
        const sensiRange = document.getElementById("sensiRange");
        if (sensiRange) sensiRange.value = savedSensi;
        sensiValue.textContent = savedSensi;
      } catch (e) {}
    }

    function isAndroid() { return /Android/i.test(navigator.userAgent); }
    function isIOS() { return /iPhone|iPad|iPod/i.test(navigator.userAgent); }

    function moGame(type) {
      const conf = APPS[type];
      if (!conf) return;
      if (isAndroid()) {
        window.location.href = 'intent://#Intent;package=' + conf.androidPackage + ';end';
        return;
      }
      if (isIOS()) {
        const start = Date.now();
        window.location.href = conf.iosScheme;
        setTimeout(function () {
          if (Date.now() - start < 1700) {
            window.location.href = conf.iosStore;
          }
        }, 1100);
        return;
      }
      window.open(conf.iosStore, '_blank');
    }

    document.querySelectorAll('.tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.tab').forEach(function (b) { b.classList.remove('active'); });
        document.querySelectorAll('.tabPane').forEach(function (p) { p.classList.remove('active'); });
        btn.classList.add('active');
        const pane = document.getElementById(btn.dataset.tab);
        if (pane) pane.classList.add('active');
      });
    });

    window.addEventListener('load', async function () {
      hideLoading();
      const token = getSession();
      if (!token) return;
      try {
        const res = await fetch('/api/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: token, device: getDevice() })
        });
        const data = await res.json();
        if (data.ok) {
          data.key = getSavedKey();
          moPanel(data);
        } else {
          clearSession();
        }
      } catch (e) {}
    });
  </script>
</body>
</html>`;
}

function renderAdminHtml() {
  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
  <title>Admin</title>
  <style>
    body{margin:0;min-height:100vh;background:#06070b;color:white;font-family:Arial,sans-serif;padding:20px}
    .wrap{max-width:760px;margin:0 auto}
    .box{padding:20px;border-radius:20px;background:rgba(255,255,255,.04);border:1px solid rgba(185,125,255,.22);box-shadow:0 0 30px rgba(185,125,255,.08)}
    input,button{width:100%;height:48px;border:none;border-radius:12px;margin-top:10px;padding:0 12px;box-sizing:border-box}
    input{background:rgba(255,255,255,.06);color:white}
    button{background:linear-gradient(90deg,#8c52ff,#d18aff,#ffcc6d,#ff7ada);color:white;font-weight:700}
    .item{margin-top:10px;padding:12px;border-radius:14px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08)}
    .row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    .note{margin-top:14px;padding:12px;border-radius:14px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);font-size:13px;color:#ddd}
    @media (max-width:640px){.row{grid-template-columns:1fr}}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="box">
      <h1>Admin Tạo Key</h1>
      <input id="adminKey" type="password" placeholder="Admin Key">
      <input id="customKey" placeholder="Key muốn tạo (để trống = tự random)">
      <div class="row">
        <input id="uses" type="number" value="50" placeholder="Số thiết bị tối đa">
        <input id="days" type="number" value="30" placeholder="Số ngày sử dụng">
      </div>
      <button onclick="taoKey()">Tạo Key</button>
      <button onclick="taiDanhSach()">Tải danh sách key</button>
      <div class="note">Form tạo key vẫn giữ kiểu cũ. Phần thay đổi chính là lưu key ổn định hơn khi có GITHUB_TOKEN + GITHUB_REPO.</div>
      <div id="result"></div>
      <div id="list"></div>
    </div>
  </div>

  <script>
    async function taoKey() {
      const adminKey = document.getElementById("adminKey").value.trim();
      const customKey = document.getElementById("customKey").value.trim();
      const uses = Number(document.getElementById("uses").value || 50);
      const days = Number(document.getElementById("days").value || 30);
      const result = document.getElementById("result");
      result.innerHTML = "Đang tạo key...";
      try {
        const res = await fetch("/api/create?admin=" + encodeURIComponent(adminKey), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: customKey, uses: uses, days: days })
        });
        const data = await res.json();
        if (!data.ok) {
          result.innerHTML = '<span style="color:#ff6f93">⛔ ' + (data.error || "Tạo key thất bại") + '</span>';
          return;
        }
        result.innerHTML =
          '<div style="margin-top:12px;color:#8dffb4">✅ Tạo thành công</div>' +
          '<div>🔑 Key: <b>' + data.key + '</b></div>' +
          '<div>📱 Số thiết bị tối đa: ' + data.totalDevices + '</div>' +
          '<div>⏳ Hết hạn: ' + data.expireText + '</div>';
        taiDanhSach();
      } catch (e) {
        result.innerHTML = '<span style="color:#ff6f93">❌ Lỗi mạng</span>';
      }
    }

    async function taiDanhSach() {
      const adminKey = document.getElementById("adminKey").value.trim();
      const box = document.getElementById("list");
      box.innerHTML = "Đang tải...";
      try {
        const res = await fetch("/api/list?admin=" + encodeURIComponent(adminKey));
        const data = await res.json();
        if (!data.ok) {
          box.innerHTML = '<span style="color:#ff6f93">⛔ ' + (data.error || "Không tải được") + '</span>';
          return;
        }
        const entries = data.items || [];
        if (!entries.length) {
          box.innerHTML = "Chưa có key nào.";
          return;
        }
        let html = "";
        for (const v of entries) {
          html +=
            '<div class="item">' +
            '<div><b>Key:</b> ' + v.key + '</div>' +
            '<div><b>Lượt thiết bị còn:</b> ' + v.usesLeft + '</div>' +
            '<div><b>Đã dùng:</b> ' + v.usedDevices + ' / ' + v.totalDevices + '</div>' +
            '<div><b>Hết hạn:</b> ' + new Date(v.expireAt).toLocaleString("vi-VN") + '</div>' +
            '<button style="margin-top:8px;background:#7a1734" onclick="xoaKey(\'' + v.key + '\')">Xóa key</button>' +
            '</div>';
        }
        box.innerHTML = html;
      } catch (e) {
        box.innerHTML = '<span style="color:#ff6f93">❌ Lỗi mạng</span>';
      }
    }

    async function xoaKey(key) {
      const adminKey = document.getElementById("adminKey").value.trim();
      await fetch("/api/delete?admin=" + encodeURIComponent(adminKey), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: key })
      });
      taiDanhSach();
    }
  </script>
</body>
</html>`;
}

app.get("/healthz", (req, res) => {
  res.send("ok");
});

app.get("/", (req, res) => {
  res.send(renderHomeHtml());
});

app.get("/panel", (req, res) => {
  res.send(renderPanelHtml());
});

app.get("/admin", (req, res) => {
  res.send(renderAdminHtml());
});

app.post("/api/create", async (req, res) => {
  if (!isAdmin(req)) {
    return res.status(401).json({ ok: false, error: "Sai admin key" });
  }

  const customKey = String(req.body.key || "").trim();
  const totalDevices = Math.max(1, Number(req.body.uses || 50));
  const days = Math.max(1, Number(req.body.days || 30));
  const key = customKey || genKey();
  const expireAt = Date.now() + days * 24 * 60 * 60 * 1000;

  keys[key] = {
    usesLeft: totalDevices,
    totalDevices: totalDevices,
    devices: [],
    expireAt: expireAt,
    createdAt: Date.now()
  };
  await persistStore();

  return res.json({
    ok: true,
    key: key,
    uses: totalDevices,
    totalDevices: totalDevices,
    expireAt: expireAt,
    expireText: formatVNTime(expireAt)
  });
});

app.post("/api/check", async (req, res) => {
  const key = String(req.body.key || "").trim();
  const device = String(req.body.device || "").trim();

  if (!key || !device) {
    return res.json({ ok: false, msg: "Thiếu key hoặc thiết bị" });
  }

  const item = normalizeKeyItem(keys[key]);
  if (!item) {
    return res.json({ ok: false, msg: "Key không tồn tại" });
  }

  if (Date.now() >= item.expireAt) {
    return res.json({ ok: false, msg: "Key đã hết hạn" });
  }

  const alreadyUsed = item.devices.includes(device);

  if (!alreadyUsed) {
    if (item.usesLeft <= 0) {
      return res.json({ ok: false, msg: "Key đã hết lượt thiết bị" });
    }

    item.devices.push(device);
    item.usesLeft -= 1;
  }

  keys[key] = item;
  await persistStore();

  const token = createSessionToken(key, device, item.expireAt);

  return res.json({
    ok: true,
    msg: "Đăng nhập thành công",
    key: key,
    token: token,
    expireAt: item.expireAt,
    expireText: formatVNTime(item.expireAt),
    usesLeft: item.usesLeft,
    usedDevices: item.devices.length,
    totalDevices: item.totalDevices
  });
});

app.post("/api/status", async (req, res) => {
  const token = String(req.body.token || "").trim();
  const device = String(req.body.device || "").trim();

  if (!token || !device) {
    return res.json({ ok: false, msg: "Thiếu phiên đăng nhập" });
  }

  const parsed = verifySessionToken(token);
  if (!parsed) {
    return res.json({ ok: false, msg: "Phiên không hợp lệ" });
  }

  if (parsed.device !== device) {
    return res.json({ ok: false, msg: "Phiên không đúng thiết bị" });
  }

  const item = normalizeKeyItem(keys[parsed.key]);
  if (!item) {
    return res.json({ ok: false, msg: "Key không tồn tại" });
  }

  if (Date.now() >= item.expireAt) {
    return res.json({ ok: false, msg: "Key đã hết hạn" });
  }

  if (!item.devices.includes(device)) {
    return res.json({ ok: false, msg: "Thiết bị chưa được cấp quyền cho key này" });
  }

  keys[parsed.key] = item;
  await persistStore();

  return res.json({
    ok: true,
    key: parsed.key,
    expireAt: item.expireAt,
    expireText: formatVNTime(item.expireAt),
    usesLeft: item.usesLeft,
    usedDevices: item.devices.length,
    totalDevices: item.totalDevices
  });
});

app.get("/api/list", async (req, res) => {
  if (!isAdmin(req)) {
    return res.status(401).json({ ok: false, error: "Sai admin key" });
  }

  const items = Object.entries(keys).map(([key, raw]) => {
    const value = normalizeKeyItem(raw);
    keys[key] = value;
    return {
      key: key,
      usesLeft: value.usesLeft,
      usedDevices: value.devices.length,
      totalDevices: value.totalDevices,
      expireAt: value.expireAt,
      expireText: formatVNTime(value.expireAt)
    };
  });

  await persistStore();
  return res.json({ ok: true, items: items });
});

app.post("/api/delete", async (req, res) => {
  if (!isAdmin(req)) {
    return res.status(401).json({ ok: false, error: "Sai admin key" });
  }

  const key = String(req.body.key || "").trim();
  if (!keys[key]) {
    return res.json({ ok: false, error: "Không tìm thấy key" });
  }

  delete keys[key];
  await persistStore();
  return res.json({ ok: true, msg: "Đã xóa key" });
});

ensureStoreLoaded()
  .then(() => {
    app.listen(PORT, () => {
      console.log("Server chạy tại port " + PORT);
      console.log("ATH FULL VIP PANEL READY");
      console.log("Store mode:", usingGitHubStore() ? "GitHub" : "Local");
    });
  })
  .catch((err) => {
    console.error("Không thể khởi động server:", err);
    process.exit(1);
  });
