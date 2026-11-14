/**
 * Minimal in-memory stand-in for the Supabase JS client, just wide enough to
 * exercise the handlers in /api.
 *
 * The sandbox this project is developed in cannot reach *.supabase.co, so the
 * credit, payment and auth logic would otherwise ship untested. This fake
 * implements the exact query shapes the handlers use:
 *
 *   .from(t).select(cols).eq(a,b).order(c,{ascending}).limit(n).maybeSingle()/single()
 *   .from(t).insert(obj | obj[]).select(cols).single()
 *   .from(t).update(patch).eq(a,b).neq(gte)(c,d).select(cols)
 *   .from(t).upsert(obj)
 *   .from(t).delete().eq(a,b)
 *   .rpc('spend_credits' | 'grant_credits', args)
 *   .auth.getUser(token)
 */

function matches(row, filters) {
  return filters.every(({ op, col, value }) => {
    if (op === 'eq') return row[col] === value;
    if (op === 'neq') return row[col] !== value;
    if (op === 'gte') return Number(row[col]) >= Number(value);
    return true;
  });
}

export function createFakeSupabase(seed = {}) {
  const db = {
    profiles: [],
    credit_transactions: [],
    roasts: [],
    payment_transactions: [],
    byok_keys: [],
    global_settings: [{ id: 1, openai_key: null, elevenlabs_key: null }],
    ...structuredClone(seed),
  };

  const users = new Map(); // token -> user
  let nextId = 1;
  const calls = [];

  function table(name) {
    if (!db[name]) db[name] = [];

    const state = { filters: [], _insert: null, _update: null, _upsert: null, _delete: false, _order: null, _limit: null, _select: '*' };

    const api = {
      select(cols) { state._select = cols || '*'; return api; },
      insert(row) { state._insert = row; return api; },
      update(patch) { state._update = patch; return api; },
      upsert(row) { state._upsert = row; return api; },
      delete() { state._delete = true; return api; },
      eq(col, value) { state.filters.push({ op: 'eq', col, value }); return api; },
      neq(col, value) { state.filters.push({ op: 'neq', col, value }); return api; },
      gte(col, value) { state.filters.push({ op: 'gte', col, value }); return api; },
      order(col, opts = {}) { state._order = { col, ascending: opts.ascending !== false }; return api; },
      limit(n) { state._limit = n; return api; },

      async maybeSingle() {
        const res = await api._run();
        if (res.error) return { data: null, error: res.error };
        const rows = Array.isArray(res.data) ? res.data : [];
        return { data: rows[0] ?? null, error: null };
      },
      async single() {
        const res = await api._run();
        if (res.error) return { data: null, error: res.error };
        const rows = Array.isArray(res.data) ? res.data : [];
        if (rows.length !== 1) {
          return { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned' } };
        }
        return { data: rows[0], error: null };
      },
      then(resolve, reject) { return api._run().then(resolve, reject); },

      async _run() {
        calls.push({ table: name, state: { ...state } });
        const rows = db[name];

        if (state._insert) {
          const incoming = Array.isArray(state._insert) ? state._insert : [state._insert];
          const created = incoming.map((r) => ({ id: nextId++, created_at: new Date().toISOString(), ...r }));

          // Enforce the unique index on payment_transactions.stripe_session_id
          for (const row of created) {
            if (name === 'payment_transactions' && row.stripe_session_id) {
              const clash = rows.some((x) => x.stripe_session_id === row.stripe_session_id);
              if (clash) return { data: null, error: { message: 'duplicate key value violates unique constraint' } };
            }
            if (name === 'profiles' && rows.some((x) => x.user_id === row.user_id)) {
              return { data: null, error: { message: 'duplicate key value violates unique constraint' } };
            }
          }

          rows.push(...created);
          return { data: created, error: null };
        }

        if (state._upsert) {
          const incoming = state._upsert;
          const keys = name === 'profiles' ? 'user_id' : 'id';
          const existing = rows.find((r) => r[keys] === incoming[keys]);
          if (existing) Object.assign(existing, incoming);
          else rows.push({ id: nextId++, created_at: new Date().toISOString(), ...incoming });
          return { data: [existing || incoming], error: null };
        }

        let selected = rows.filter((r) => matches(r, state.filters));

        if (state._update) {
          selected.forEach((r) => Object.assign(r, state._update));
          return { data: selected, error: null };
        }

        if (state._delete) {
          db[name] = rows.filter((r) => !selected.includes(r));
          return { data: selected, error: null };
        }

        if (state._order) {
          const { col, ascending } = state._order;
          selected = [...selected].sort((a, b) => {
            const av = a[col], bv = b[col];
            if (av === bv) return 0;
            return (av > bv ? 1 : -1) * (ascending ? 1 : -1);
          });
        }
        if (state._limit) selected = selected.slice(0, state._limit);

        return { data: selected, error: null };
      },
    };

    return api;
  }

  const client = {
    from: table,
    _db: db,
    _calls: calls,

    async rpc(fn, args) {
      calls.push({ rpc: fn, args });
      const balanceOf = (userId) => {
        const p = db.profiles.find((r) => r.user_id === userId);
        return p ? p.credits : null;
      };

      if (fn === 'spend_credits') {
        const p = db.profiles.find((r) => r.user_id === args.p_user_id);
        if (!p || p.credits < args.p_amount) {
          return { data: null, error: { message: 'insufficient_credits', code: 'P0001' } };
        }
        p.credits -= args.p_amount;
        db.credit_transactions.push({
          id: nextId++,
          user_id: args.p_user_id,
          amount: -args.p_amount,
          type: 'roast',
          description: args.p_description || null,
          created_at: new Date().toISOString(),
        });
        return { data: p.credits, error: null };
      }

      if (fn === 'grant_credits') {
        let p = db.profiles.find((r) => r.user_id === args.p_user_id);
        if (!p) {
          p = { id: nextId++, user_id: args.p_user_id, credits: 0, subscription_tier: null };
          db.profiles.push(p);
        }
        p.credits += args.p_amount;
        db.credit_transactions.push({
          id: nextId++,
          user_id: args.p_user_id,
          amount: args.p_amount,
          type: args.p_type,
          description: args.p_description || null,
          created_at: new Date().toISOString(),
        });
        return { data: p.credits, error: null };
      }

      return { data: null, error: { message: `unknown function ${fn}` } };
    },

    auth: {
      async getUser(token) {
        const user = users.get(token);
        if (!user) return { data: { user: null }, error: { message: 'invalid claim' } };
        return { data: { user }, error: null };
      },
    },
  };

  return {
    client,
    db,
    /** Register a session token for an already-known user. */
    addUser(token, { id, email }) {
      users.set(token, { id, email });
      return { id, email };
    },
    balanceOf(userId) {
      const p = db.profiles.find((r) => r.user_id === userId);
      return p ? p.credits : null;
    },
  };
}

/** Collects the express-ish response so assertions can inspect it. */
export function fakeRes() {
  const res = {
    statusCode: 200,
    body: undefined,
    headers: {},
    status(code) { res.statusCode = code; return res; },
    json(body) { res.body = body; return res; },
    setHeader(k, v) { res.headers[k] = v; return res; },
    end() { return res; },
  };
  return res;
}

export function fakeReq({ method = 'GET', body, token, headers = {} } = {}) {
  return {
    method,
    body,
    query: {},
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  };
}
