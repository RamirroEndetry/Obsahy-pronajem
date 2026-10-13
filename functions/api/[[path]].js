// API pro Obsahy pronájmů — Cloudflare Pages Functions + D1.
// Uživatelé a otisky PINů jsou v tajné proměnné USERS (viz README), nikdy v repozitáři.

const SESSION_DAYS = 30;
const MAX_FAILS = 5;
const LOCK_MS = 5 * 60 * 1000;
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const MAX_FILE_BYTES = 200000;

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
const fail = (status, message) => json({ error: message }, status);

async function sha256hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
function randomId(bytes = 32) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map((x) => x.toString(16).padStart(2, "0")).join("");
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function users(env) {
  try { return JSON.parse(env.USERS || "{}"); } catch { return {}; }
}
function publicUser(id, u) {
  return { id, name: u.name, login: u.login, color: u.color, admin: !!u.admin };
}

function getCookie(req, name) {
  const m = (req.headers.get("cookie") || "").match(new RegExp("(?:^|;\\s*)" + name + "=([^;]+)"));
  return m ? decodeURIComponent(m[1]) : null;
}
function sessionCookie(token, maxAge) {
  return `sid=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

async function currentUser(req, env) {
  const token = getCookie(req, "sid");
  if (!token) return null;
  const row = await env.DB.prepare("SELECT user_id, expires_at FROM sessions WHERE token_hash = ?")
    .bind(await sha256hex(token)).first();
  if (!row || row.expires_at < Date.now()) return null;
  const u = users(env)[row.user_id];
  if (!u) return null;
  const perm = u.admin ? null : await env.DB.prepare("SELECT can_upload FROM permissions WHERE user_id = ?").bind(row.user_id).first();
  return { id: row.user_id, ...u, canUpload: !!u.admin || !!(perm && perm.can_upload) };
}
function meInfo(me) {
  return { ...publicUser(me.id, me), canUpload: !!me.canUpload };
}

/* ---------- auth ---------- */
async function login(req, env) {
  const body = await req.json().catch(() => ({}));
  const id = String(body.user || "");
  const pin = String(body.pin || "");
  const u = users(env)[id];
  const key = `${id}|${req.headers.get("cf-connecting-ip") || "local"}`;
  const now = Date.now();

  const att = await env.DB.prepare("SELECT count, locked_until FROM login_attempts WHERE key = ?").bind(key).first();
  if (att && att.locked_until > now) {
    return fail(429, `Příliš mnoho pokusů. Zkuste to za ${Math.ceil((att.locked_until - now) / 1000)} s.`);
  }

  const ok = !!u && /^\d{4,8}$/.test(pin) &&
    safeEqual(await sha256hex(`${env.PIN_PEPPER || ""}:${id}:${pin}`), String(u.pinHash || ""));
  if (!ok) {
    const count = (att ? att.count : 0) + 1;
    const locked = count >= MAX_FAILS ? now + LOCK_MS : 0;
    await env.DB.prepare(
      "INSERT INTO login_attempts (key, count, locked_until) VALUES (?, ?, ?) " +
      "ON CONFLICT(key) DO UPDATE SET count = excluded.count, locked_until = excluded.locked_until",
    ).bind(key, locked ? 0 : count, locked).run();
    return fail(401, locked ? "Příliš mnoho pokusů. Zkuste to za 5 minut." : "Nesprávný PIN.");
  }

  const token = randomId();
  const maxAge = SESSION_DAYS * 86400;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM login_attempts WHERE key = ?").bind(key),
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now),
    env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
      .bind(await sha256hex(token), id, now + maxAge * 1000),
  ]);
  return json(publicUser(id, u), 200, { "set-cookie": sessionCookie(token, maxAge) });
}

async function logout(req, env) {
  const token = getCookie(req, "sid");
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256hex(token)).run();
  return json({ ok: true }, 200, { "set-cookie": sessionCookie("", 0) });
}

/* ---------- rentals ---------- */
const clean = (v, max = 2000) => String(v ?? "").slice(0, max).trim();
const cleanDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : "");
const bump = (env) => env.DB.prepare("UPDATE meta SET v = v + 1 WHERE k = 'version'");

async function version(env) {
  const row = await env.DB.prepare("SELECT v FROM meta WHERE k = 'version'").first();
  return row ? row.v : 0;
}

async function listRentals(env) {
  const [rs, its, fs, ns, ver] = await env.DB.batch([
    env.DB.prepare("SELECT * FROM rentals"),
    env.DB.prepare("SELECT * FROM items ORDER BY created_at"),
    env.DB.prepare("SELECT id, rental_id, name, size, created_by, created_at FROM files ORDER BY created_at"),
    env.DB.prepare("SELECT * FROM notes ORDER BY created_at"),
    env.DB.prepare("SELECT v FROM meta WHERE k = 'version'"),
  ]);
  const byRental = new Map();
  for (const it of its.results) {
    if (!byRental.has(it.rental_id)) byRental.set(it.rental_id, []);
    byRental.get(it.rental_id).push({ id: it.id, url: it.url, label: it.label, by: it.created_by, at: it.created_at });
  }
  const notesByRental = new Map();
  for (const n of ns.results) {
    if (!notesByRental.has(n.rental_id)) notesByRental.set(n.rental_id, []);
    notesByRental.get(n.rental_id).push({ id: n.id, text: n.text, by: n.created_by, at: n.created_at });
  }
  const filesByRental = new Map();
  for (const f of fs.results) {
    if (!filesByRental.has(f.rental_id)) filesByRental.set(f.rental_id, []);
    filesByRental.get(f.rental_id).push({ id: f.id, name: f.name, size: f.size, by: f.created_by, at: f.created_at });
  }
  return {
    version: ver.results[0] ? ver.results[0].v : 0,
    rentals: rs.results.map((r) => ({
      id: r.id, nexId: r.id, reported: r.reported, customer: r.customer, contact: r.contact,
      event: r.event, eventDate: r.event_date, address: r.address, note: r.note,
      items: byRental.get(r.id) || [],
      files: filesByRental.get(r.id) || [],
      teamNotes: notesByRental.get(r.id) || [],
      confirmed: r.confirmed_at ? { by: r.confirmed_by, at: r.confirmed_at } : null,
      selfUpload: r.self_upload ? { by: r.self_by, at: r.self_at } : null,
      createdBy: r.created_by, createdAt: r.created_at,
    })),
  };
}

function rentalFields(row) {
  return [
    cleanDate(row.reported), clean(row.customer, 300), clean(row.contact, 1000),
    clean(row.event, 300), cleanDate(row.eventDate), clean(row.address, 500),
  ];
}

async function rentals(req, env, me, parts) {
  const method = req.method;
  const now = Date.now();
  const adminOnly = () => (me.admin ? null : fail(403, "Tohle může jen admin."));
  const uploaderOnly = () => (me.canUpload ? null : fail(403, "Nahrávání obsahu vám admin zatím nepovolil."));
  // Nahrávající uživatel smí mazat jen to, co sám přidal; admin cokoli.
  const canRemove = async (table, rowId) => {
    if (me.admin) return null;
    if (!me.canUpload) return fail(403, "Nahrávání obsahu vám admin zatím nepovolil.");
    const row = await env.DB.prepare(`SELECT created_by FROM ${table} WHERE id = ?`).bind(rowId).first();
    return row && row.created_by === me.id ? null : fail(403, "Smazat můžete jen obsah, který jste nahrál(a) vy.");
  };

  // GET /api/rentals[?v=N]
  if (parts.length === 0 && method === "GET") {
    const known = new URL(req.url).searchParams.get("v");
    if (known !== null) {
      const v = await version(env);
      if (String(v) === known) return json({ version: v, unchanged: true });
    }
    return json(await listRentals(env));
  }

  // POST /api/rentals/import  { rows: [...] }
  if (parts.length === 1 && parts[0] === "import" && method === "POST") {
    const denied = adminOnly(); if (denied) return denied;
    const body = await req.json().catch(() => ({}));
    const rows = Array.isArray(body.rows) ? body.rows.slice(0, 500) : [];
    const valid = rows.filter((r) => ID_RE.test(String(r.nexId || "")));
    if (!valid.length) return fail(400, "Nenašel jsem žádné platné pronájmy.");
    const existing = new Set((await env.DB.prepare("SELECT id FROM rentals").all()).results.map((r) => r.id));
    const stmts = valid.map((r) => env.DB.prepare(
      "INSERT INTO rentals (id, reported, customer, contact, event, event_date, address, created_by, created_at, updated_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET reported = excluded.reported, " +
      "customer = excluded.customer, contact = excluded.contact, event = excluded.event, " +
      "event_date = excluded.event_date, address = excluded.address, updated_at = excluded.updated_at",
    ).bind(String(r.nexId), ...rentalFields(r), me.id, now, now));
    await env.DB.batch([...stmts, bump(env)]);
    const created = valid.filter((r) => !existing.has(String(r.nexId))).length;
    return json({ created, updated: valid.length - created, ...(await listRentals(env)) });
  }

  // POST /api/rentals  (ruční přidání)
  if (parts.length === 0 && method === "POST") {
    const denied = adminOnly(); if (denied) return denied;
    const r = await req.json().catch(() => ({}));
    const id = String(r.nexId || "");
    if (!ID_RE.test(id)) return fail(400, "ID může obsahovat jen písmena, čísla, - a _.");
    if (await env.DB.prepare("SELECT 1 FROM rentals WHERE id = ?").bind(id).first()) return fail(409, `Pronájem ${id} už existuje.`);
    const self = r.selfUpload ? 1 : 0;
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO rentals (id, reported, customer, contact, event, event_date, address, created_by, created_at, updated_at, " +
        "self_upload, self_by, self_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(id, ...rentalFields(r), me.id, now, now, self, self ? me.id : null, self ? now : null),
      bump(env),
    ]);
    return json(await listRentals(env), 201);
  }

  const id = parts[0];
  if (!ID_RE.test(id || "")) return fail(404, "Neznámý pronájem.");
  const rental = await env.DB.prepare("SELECT id, confirmed_by FROM rentals WHERE id = ?").bind(id).first();
  if (!rental) return fail(404, "Pronájem neexistuje.");
  const touch = env.DB.prepare("UPDATE rentals SET updated_at = ? WHERE id = ?").bind(now, id);

  // DELETE /api/rentals/:id
  if (parts.length === 1 && method === "DELETE") {
    const denied = adminOnly(); if (denied) return denied;
    await env.DB.batch([
      env.DB.prepare("DELETE FROM items WHERE rental_id = ?").bind(id),
      env.DB.prepare("DELETE FROM files WHERE rental_id = ?").bind(id),
      env.DB.prepare("DELETE FROM notes WHERE rental_id = ?").bind(id),
      env.DB.prepare("DELETE FROM rentals WHERE id = ?").bind(id),
      bump(env),
    ]);
    return json(await listRentals(env));
  }

  // PATCH /api/rentals/:id  { note?, selfUpload? }
  if (parts.length === 1 && method === "PATCH") {
    const denied = adminOnly(); if (denied) return denied;
    const body = await req.json().catch(() => ({}));
    const stmts = [];
    if ("note" in body) {
      stmts.push(env.DB.prepare("UPDATE rentals SET note = ?, updated_at = ? WHERE id = ?").bind(clean(body.note, 4000), now, id));
    }
    if ("selfUpload" in body) {
      stmts.push(body.selfUpload
        ? env.DB.prepare("UPDATE rentals SET self_upload = 1, self_by = ?, self_at = ?, updated_at = ? WHERE id = ?").bind(me.id, now, now, id)
        : env.DB.prepare("UPDATE rentals SET self_upload = 0, self_by = NULL, self_at = NULL, updated_at = ? WHERE id = ?").bind(now, id));
    }
    if (!stmts.length) return fail(400, "Není co změnit.");
    await env.DB.batch([...stmts, bump(env)]);
    return json(await listRentals(env));
  }

  // POST /api/rentals/:id/items  { url, label }  nebo  { items: [{ url, label }, ...] }
  if (parts.length === 2 && parts[1] === "items" && method === "POST") {
    const denied = uploaderOnly(); if (denied) return denied;
    const body = await req.json().catch(() => ({}));
    const list = Array.isArray(body.items) ? body.items.slice(0, 100) : [body];
    const stmts = [];
    for (const [i, it] of list.entries()) {
      let url;
      try { url = new URL(clean(it.url, 2000)); } catch { return fail(400, "Tohle nevypadá jako platný odkaz."); }
      if (url.protocol !== "https:" && url.protocol !== "http:") return fail(400, "Odkaz musí začínat http:// nebo https://.");
      stmts.push(env.DB.prepare("INSERT INTO items (id, rental_id, url, label, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(randomId(8), id, url.href, clean(it.label, 200), me.id, now + i));
    }
    if (!stmts.length) return fail(400, "Žádný odkaz k uložení.");
    await env.DB.batch([...stmts, touch, bump(env)]);
    return json(await listRentals(env), 201);
  }

  // POST /api/rentals/:id/files  { name, content }  — malý textový soubor
  if (parts.length === 2 && parts[1] === "files" && method === "POST") {
    const denied = uploaderOnly(); if (denied) return denied;
    const body = await req.json().catch(() => ({}));
    const name = clean(body.name, 120).replace(/[\\/:*?"<>|\r\n]+/g, "_") || "soubor.txt";
    if (!/\.txt$/i.test(name)) return fail(400, "Nahrát jde jen textový soubor .txt.");
    const content = String(body.content ?? "");
    const size = new TextEncoder().encode(content).length;
    if (size > MAX_FILE_BYTES) return fail(413, `Soubor je moc velký (max ${MAX_FILE_BYTES / 1000} kB).`);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO files (id, rental_id, name, content, size, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(randomId(8), id, name, content, size, me.id, now),
      touch, bump(env),
    ]);
    return json(await listRentals(env), 201);
  }

  // DELETE /api/rentals/:id/files/:fileId
  if (parts.length === 3 && parts[1] === "files" && method === "DELETE") {
    const denied = await canRemove("files", parts[2]); if (denied) return denied;
    await env.DB.batch([
      env.DB.prepare("DELETE FROM files WHERE id = ? AND rental_id = ?").bind(parts[2], id),
      touch, bump(env),
    ]);
    return json(await listRentals(env));
  }

  // DELETE /api/rentals/:id/items/:itemId
  if (parts.length === 3 && parts[1] === "items" && method === "DELETE") {
    const denied = await canRemove("items", parts[2]); if (denied) return denied;
    await env.DB.batch([
      env.DB.prepare("DELETE FROM items WHERE id = ? AND rental_id = ?").bind(parts[2], id),
      touch, bump(env),
    ]);
    return json(await listRentals(env));
  }

  // POST /api/rentals/:id/notes  { text } — poznámku týmu smí přidat každý přihlášený
  if (parts.length === 2 && parts[1] === "notes" && method === "POST") {
    const body = await req.json().catch(() => ({}));
    const text = clean(body.text, 1000);
    if (!text) return fail(400, "Poznámka je prázdná.");
    await env.DB.batch([
      env.DB.prepare("INSERT INTO notes (id, rental_id, text, created_by, created_at) VALUES (?, ?, ?, ?, ?)")
        .bind(randomId(8), id, text, me.id, now),
      touch, bump(env),
    ]);
    return json(await listRentals(env), 201);
  }

  // DELETE /api/rentals/:id/notes/:noteId — autor nebo admin
  if (parts.length === 3 && parts[1] === "notes" && method === "DELETE") {
    if (!me.admin) {
      const row = await env.DB.prepare("SELECT created_by FROM notes WHERE id = ? AND rental_id = ?").bind(parts[2], id).first();
      if (!row || row.created_by !== me.id) return fail(403, "Smazat můžete jen svou poznámku.");
    }
    await env.DB.batch([
      env.DB.prepare("DELETE FROM notes WHERE id = ? AND rental_id = ?").bind(parts[2], id),
      touch, bump(env),
    ]);
    return json(await listRentals(env));
  }

  // POST /api/rentals/:id/confirm — smí každý přihlášený
  if (parts.length === 2 && parts[1] === "confirm" && method === "POST") {
    await env.DB.batch([
      env.DB.prepare("UPDATE rentals SET confirmed_by = ?, confirmed_at = ?, updated_at = ? WHERE id = ?").bind(me.id, now, now, id),
      bump(env),
    ]);
    return json(await listRentals(env));
  }

  // DELETE /api/rentals/:id/confirm — admin, nebo kdo potvrdil
  if (parts.length === 2 && parts[1] === "confirm" && method === "DELETE") {
    if (!me.admin && rental.confirmed_by !== me.id) return fail(403, "Potvrzení může vrátit jen admin nebo ten, kdo ho udělal.");
    await env.DB.batch([
      env.DB.prepare("UPDATE rentals SET confirmed_by = NULL, confirmed_at = NULL, updated_at = ? WHERE id = ?").bind(now, id),
      bump(env),
    ]);
    return json(await listRentals(env));
  }

  return fail(404, "Neznámá adresa.");
}

/* ---------- team (oprávnění uživatelů) ---------- */
async function teamList(env) {
  const rows = (await env.DB.prepare("SELECT user_id, can_upload, updated_by, updated_at FROM permissions").all()).results;
  const byId = new Map(rows.map((r) => [r.user_id, r]));
  return Object.entries(users(env)).map(([id, u]) => {
    const p = byId.get(id);
    return {
      ...publicUser(id, u),
      canUpload: !!u.admin || !!(p && p.can_upload),
      changedBy: p ? p.updated_by : null, changedAt: p ? p.updated_at : null,
    };
  });
}

async function team(req, env, me, parts) {
  if (!me.admin) return fail(403, "Tohle může jen admin.");
  // GET /api/team
  if (parts.length === 0 && req.method === "GET") return json(await teamList(env));
  // PUT /api/team/:userId  { canUpload }
  if (parts.length === 1 && req.method === "PUT") {
    const u = users(env)[parts[0]];
    if (!u) return fail(404, "Neznámý uživatel.");
    if (u.admin) return fail(400, "Admin má všechna práva automaticky.");
    const body = await req.json().catch(() => ({}));
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO permissions (user_id, can_upload, updated_by, updated_at) VALUES (?, ?, ?, ?) " +
        "ON CONFLICT(user_id) DO UPDATE SET can_upload = excluded.can_upload, updated_by = excluded.updated_by, updated_at = excluded.updated_at",
      ).bind(parts[0], body.canUpload ? 1 : 0, me.id, now),
      bump(env),
    ]);
    return json(await teamList(env));
  }
  return fail(404, "Neznámá adresa.");
}

/* ---------- files ---------- */
// GET /api/files/:id[?inline=1] — stažení (nebo zobrazení) textového souboru
async function downloadFile(req, env, fileId) {
  const f = await env.DB.prepare("SELECT name, content FROM files WHERE id = ?").bind(fileId).first();
  if (!f) return fail(404, "Soubor neexistuje.");
  const inline = new URL(req.url).searchParams.get("inline") === "1";
  const ascii = f.name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  return new Response(f.content, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "content-disposition": `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'",
      "cache-control": "no-store",
    },
  });
}

/* ---------- router ---------- */
export async function onRequest({ request: req, env, params }) {
  const parts = Array.isArray(params.path) ? params.path : params.path ? [params.path] : [];
  const route = parts.join("/");
  const method = req.method;
  try {
    if (!env.DB) return fail(500, "Chybí databáze (vazba DB v nastavení Cloudflare).");
    if (method !== "GET" && method !== "HEAD") {
      const origin = req.headers.get("origin");
      if (origin && new URL(origin).host !== new URL(req.url).host) return fail(403, "Nepovolený původ požadavku.");
      if (method !== "DELETE" && !(req.headers.get("content-type") || "").includes("application/json")) return fail(415, "Očekávám JSON.");
    }
    if (route === "users" && method === "GET") return json(Object.entries(users(env)).map(([id, u]) => publicUser(id, u)));
    if (route === "login" && method === "POST") return await login(req, env);
    if (route === "logout" && method === "POST") return await logout(req, env);

    const me = await currentUser(req, env);
    if (!me) return fail(401, "Nejste přihlášen(a).");
    if (route === "me" && method === "GET") return json(meInfo(me));
    if (parts[0] === "team") return await team(req, env, me, parts.slice(1));
    if (parts[0] === "rentals") return await rentals(req, env, me, parts.slice(1));
    if (parts[0] === "files" && parts.length === 2 && method === "GET") return await downloadFile(req, env, parts[1]);
    return fail(404, "Neznámá adresa.");
  } catch (e) {
    return fail(500, "Chyba serveru: " + (e && e.message ? e.message : String(e)));
  }
}
