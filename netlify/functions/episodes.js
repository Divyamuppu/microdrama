// Netlify Function: GET/PUT /api/episodes → Neon Postgres
const { neon } = require('@neondatabase/serverless');
const ROW_ID = 'microdrama';
let ready = null;

function getSql() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set in Netlify environment variables');
  return neon(process.env.DATABASE_URL);
}

async function setup(sql) {
  if (!ready) {
    ready = (async () => {
      await sql`create table if not exists trackers (id text primary key, episodes jsonb not null default '[]'::jsonb, updated_at timestamptz default now())`;
      await sql`insert into trackers (id, episodes) values (${ROW_ID}, '[]'::jsonb) on conflict (id) do nothing`;
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  try {
    const sql = getSql();
    await setup(sql);
    if (event.httpMethod === 'GET') {
      const rows = await sql`select episodes from trackers where id = ${ROW_ID}`;
      return json(200, rows[0] ? rows[0].episodes : []);
    }
    if (event.httpMethod === 'PUT') {
      const eps = JSON.parse(event.body || '[]');
      if (!Array.isArray(eps)) return json(400, { error: 'expected an array' });
      await sql`insert into trackers (id, episodes, updated_at) values (${ROW_ID}, ${JSON.stringify(eps)}::jsonb, now())
                on conflict (id) do update set episodes = excluded.episodes, updated_at = now()`;
      return json(200, { ok: true });
    }
    return json(405, { error: 'method not allowed' });
  } catch (e) {
    console.error(e);
    return json(500, { error: e.message });
  }
};
