// Serves index.html + app.js and stores episodes in Neon Postgres.
// Run: npm install  →  npm start  →  http://localhost:3000
const http = require('http');
const fs = require('fs');
const path = require('path');
const { neon } = require('@neondatabase/serverless');

if (!process.env.DATABASE_URL) { console.error('Missing DATABASE_URL in .env'); process.exit(1); }
const sql = neon(process.env.DATABASE_URL);
const PORT = process.env.PORT || 3000;
const ROW_ID = 'microdrama';
const FILES = { '/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js' };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

async function setup() {
  await sql`create table if not exists trackers (id text primary key, episodes jsonb not null default '[]'::jsonb, updated_at timestamptz default now())`;
  await sql`insert into trackers (id, episodes) values (${ROW_ID}, '[]'::jsonb) on conflict (id) do nothing`;
}

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  try {
    if (url === '/api/episodes' && req.method === 'GET') {
      const rows = await sql`select episodes from trackers where id = ${ROW_ID}`;
      return send(res, 200, JSON.stringify(rows[0] ? rows[0].episodes : []));
    }
    if (url === '/api/episodes' && req.method === 'PUT') {
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 5e6) return send(res, 413, '{"error":"too large"}'); }
      const eps = JSON.parse(body);
      if (!Array.isArray(eps)) return send(res, 400, '{"error":"expected an array"}');
      await sql`insert into trackers (id, episodes, updated_at) values (${ROW_ID}, ${JSON.stringify(eps)}::jsonb, now())
                on conflict (id) do update set episodes = excluded.episodes, updated_at = now()`;
      return send(res, 200, '{"ok":true}');
    }
    const file = FILES[url];
    if (file && req.method === 'GET') {
      return send(res, 200, fs.readFileSync(path.join(__dirname, file)), TYPES[path.extname(file)]);
    }
    send(res, 404, 'Not found', 'text/plain');
  } catch (e) {
    console.error(e);
    send(res, 500, '{"error":"server error"}');
  }
});

setup().then(() => server.listen(PORT, () => console.log(`Tracker running at http://localhost:${PORT}`)))
  .catch((e) => { console.error('Could not connect to Neon:', e.message); process.exit(1); });
