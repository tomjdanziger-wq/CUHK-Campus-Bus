/**
 * api/sightings.js — rider reports of which bus is where.
 *
 *   GET  /api/sightings           recent reports, newest first
 *   POST /api/sightings           { stop: "wu-yee-sun-down", route: "4" }
 *
 * WHY NO ACCOUNTS
 *   A report is worth something only if people bother to make one, and a
 *   sign-up screen is the surest way to make sure they do not. So there is no
 *   login, no user id, and nothing about the reporter is stored. Abuse is
 *   kept down the other ways: only real stop/route combinations are accepted,
 *   one report per phone per cooldown, and every report expires on its own.
 *
 * STORAGE
 *   Upstash Redis over its REST API — plain fetch, no npm packages, so the
 *   project still has no build step. Add it from the Vercel dashboard
 *   (Storage → Upstash / Redis → connect to this project); that sets the
 *   environment variables read below. Until then this endpoint answers 503
 *   and the app says tracking is not switched on.
 *
 *   Reports live in one sorted set scored by time. Old ones are trimmed on
 *   every write, so the set never holds more than a few hours.
 */

'use strict';

const crypto = require('crypto');
const path = require('path');

// The same data file the app uses, so the server accepts exactly the stops
// and routes the app offers. Shapes are not needed here.
require(path.join(__dirname, '..', 'data', 'places.generated.js'));
require(path.join(__dirname, '..', 'data', 'routes.generated.js'));
require(path.join(__dirname, '..', 'data', 'shuttle-data.js'));

const DATA = globalThis.SHUTTLE_DATA;
const CFG = DATA.config.tracking;
const KEY = 'sightings';

// Which routes call at which stop.
const SERVES = {};
DATA.routes.forEach((r) => {
  r.stops.forEach((s) => { (SERVES[s] = SERVES[s] || new Set()).add(r.id); });
});

function redisConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}

async function redis(cfg, commands) {
  const res = await fetch(cfg.url + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + cfg.token, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error('redis ' + res.status);
  const out = await res.json();
  out.forEach((r) => { if (r.error) throw new Error('redis ' + r.error); });
  return out.map((r) => r.result);
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const text = Buffer.concat(chunks).toString('utf8');
  if (text.length > 2000) throw new Error('too large');
  return JSON.parse(text || '{}');
}

function hash(text) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 24);
}

/**
 * Two short-lived, one-way throttle keys. Nothing here is stored raw, and both
 * expire within minutes.
 *
 * Per phone, because the whole campus Wi-Fi can reach us from a handful of
 * addresses — throttling by address alone would let one report block
 * everyone in the building. The phone sends a random id it made up itself
 * (not an account, and not linked to anything). Per address as well, with a
 * much looser cap, so rotating that id does not make spamming free.
 */
function throttleKeys(req) {
  const ip = String(req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || '')
    .split(',')[0].trim();
  const device = String(req.headers['x-device'] || '').slice(0, 64);
  const hour = Math.floor(Date.now() / 3600000);
  return {
    device: 'rl:d:' + hash(ip + '|' + device + '|' + hour),
    address: 'rl:a:' + hash(ip + '|' + hour),
  };
}

module.exports = async function handler(req, res) {
  const cfg = redisConfig();
  if (!cfg) return send(res, 503, { error: 'not-configured' });

  const now = Date.now();

  try {
    if (req.method === 'GET') {
      const since = now - CFG.showMinutes * 60000;
      const [members] = await redis(cfg, [['ZRANGE', KEY, String(since), '+inf', 'BYSCORE']]);
      const sightings = (members || [])
        .map((m) => { try { return JSON.parse(m); } catch (e) { return null; } })
        .filter(Boolean)
        .reverse();
      return send(res, 200, { now, sightings });
    }

    if (req.method === 'POST') {
      let body;
      try { body = await readBody(req); } catch (e) { return send(res, 400, { error: 'bad-body' }); }

      const stop = String(body.stop || '');
      const route = String(body.route || '');
      if (!SERVES[stop] || !SERVES[stop].has(route)) {
        return send(res, 400, { error: 'unknown-stop-or-route' });
      }

      const keys = throttleKeys(req);
      const [allowed, fromAddress] = await redis(cfg, [
        ['SET', keys.device, '1', 'NX', 'EX', String(CFG.cooldownSeconds)],
        ['INCR', keys.address],
        ['EXPIRE', keys.address, '600', 'NX'],
      ]);
      if (allowed !== 'OK') return send(res, 429, { error: 'too-soon', retryAfter: CFG.cooldownSeconds });
      if (fromAddress > CFG.maxPerAddressPer10Min) return send(res, 429, { error: 'too-many' });

      const sighting = { id: crypto.randomBytes(6).toString('hex'), stop, route, t: now };
      await redis(cfg, [
        ['ZADD', KEY, String(now), JSON.stringify(sighting)],
        ['ZREMRANGEBYSCORE', KEY, '-inf', String(now - CFG.keepMinutes * 60000)],
      ]);
      return send(res, 201, { now, sighting });
    }

    res.setHeader('Allow', 'GET, POST');
    return send(res, 405, { error: 'method' });
  } catch (err) {
    console.error(err);
    return send(res, 502, { error: 'storage' });
  }
};
