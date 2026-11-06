const session = require("express-session");

const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000;
const PRUNE_INTERVAL_MS = 15 * 60 * 1000;

class SupabaseRestSessionStore extends session.Store {
  constructor(options = {}) {
    super();

    const rawUrl = options.supabaseUrl || process.env.SUPABASE_URL;
    const serviceRoleKey =
      options.serviceRoleKey || process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!rawUrl || !serviceRoleKey) {
      throw new Error(
        "Supabase session store requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
      );
    }

    const parsedUrl = new URL(rawUrl);
    if (parsedUrl.protocol !== "https:") {
      throw new Error("Supabase session store requires an HTTPS project URL.");
    }

    this.endpoint = new URL("/rest/v1/mira_express_sessions", parsedUrl).toString();
    this.serviceRoleKey = serviceRoleKey;
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.lastPruneAt = 0;

    if (typeof this.fetchImpl !== "function") {
      throw new Error("This Node.js runtime does not provide fetch().");
    }
  }

  #queryUrl(params = {}) {
    const url = new URL(this.endpoint);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  }

  async #request(method, params, body, prefer) {
    const headers = {
      apikey: this.serviceRoleKey,
      Authorization: "Bearer " + this.serviceRoleKey,
      Accept: "application/json"
    };

    if (body !== undefined && body !== null) {
      headers["Content-Type"] = "application/json";
    }
    if (prefer) headers.Prefer = prefer;

    const response = await this.fetchImpl(
      this.#queryUrl(params),
      {
        method,
        headers,
        ...(body === undefined || body === null
          ? {}
          : { body: JSON.stringify(body) })
      }
    );

    if (!response || response.ok !== true) {
      const status = response && Number.isInteger(response.status)
        ? response.status
        : "unknown";
      throw new Error("Supabase session store request failed (HTTP " + status + ").");
    }

    return response;
  }

  #expiresAt(sess) {
    const cookie = sess && sess.cookie ? sess.cookie : {};
    if (cookie.expires) {
      const parsed = new Date(cookie.expires);
      if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
    }

    const maxAge = Number(cookie.maxAge);
    const ttl = Number.isFinite(maxAge) && maxAge > 0
      ? maxAge
      : DEFAULT_TTL_MS;

    return new Date(Date.now() + ttl).toISOString();
  }

  #run(operation, callback) {
    Promise.resolve()
      .then(operation)
      .then(value => callback && callback(null, value))
      .catch(error => callback && callback(error));
  }

  #maybePruneExpired() {
    if (Date.now() - this.lastPruneAt < PRUNE_INTERVAL_MS) return;
    this.lastPruneAt = Date.now();

    this.#request(
      "DELETE",
      { expire: "lt." + new Date().toISOString() },
      null,
      "return=minimal"
    ).catch(() => {
      // Cleanup is best-effort; session writes themselves remain authoritative.
      this.lastPruneAt = 0;
    });
  }

  get(sid, callback) {
    this.#run(async () => {
      const response = await this.#request(
        "GET",
        {
          sid: "eq." + sid,
          select: "sid,sess,expire",
          limit: "1"
        }
      );

      const rows = await response.json();
      const row = Array.isArray(rows) ? rows[0] : null;
      if (!row) return null;

      const expiry = new Date(row.expire).getTime();
      if (!Number.isFinite(expiry) || expiry <= Date.now()) {
        await this.#request(
          "DELETE",
          { sid: "eq." + sid },
          null,
          "return=minimal"
        );
        return null;
      }

      return row.sess && typeof row.sess === "object" ? row.sess : null;
    }, callback);
  }

  set(sid, sess, callback) {
    this.#run(async () => {
      await this.#request(
        "POST",
        { on_conflict: "sid" },
        {
          sid,
          sess,
          expire: this.#expiresAt(sess)
        },
        "resolution=merge-duplicates,return=minimal"
      );

      this.#maybePruneExpired();
    }, callback);
  }

  touch(sid, sess, callback) {
    this.#run(async () => {
      await this.#request(
        "PATCH",
        { sid: "eq." + sid },
        { expire: this.#expiresAt(sess) },
        "return=minimal"
      );
    }, callback);
  }

  destroy(sid, callback) {
    this.#run(async () => {
      await this.#request(
        "DELETE",
        { sid: "eq." + sid },
        null,
        "return=minimal"
      );
    }, callback);
  }
}

module.exports = { SupabaseRestSessionStore };
