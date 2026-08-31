// Thin authenticated client for the Krayin REST API (krayin/rest-api package).
// Auth: POST {base}/api/v1/login with {email, password, device_name} -> Sanctum
// bearer token, or provide KRAYIN_TOKEN directly and skip login entirely.

export class KrayinClient {
  constructor({ baseUrl, email, password, token, fetchImpl } = {}) {
    this.baseUrl = (baseUrl || process.env.KRAYIN_URL || "").replace(/\/+$/, "");
    this.email = email ?? process.env.KRAYIN_EMAIL;
    this.password = password ?? process.env.KRAYIN_PASSWORD;
    this.token = token ?? process.env.KRAYIN_TOKEN ?? null;
    this.fetch = fetchImpl || globalThis.fetch;
    if (!this.baseUrl) throw new Error("KRAYIN_URL is required (e.g. http://localhost:8000)");
  }

  api(path) {
    return `${this.baseUrl}/api/v1/${path.replace(/^\/+/, "")}`;
  }

  async login() {
    const res = await this.fetch(this.api("login"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ email: this.email, password: this.password, device_name: "krayin-mcp" }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Krayin login failed (${res.status}): ${JSON.stringify(body)}`);
    // Krayin returns the token under data.token or token depending on version.
    this.token = body?.data?.token ?? body?.token ?? body?.access_token;
    if (!this.token) throw new Error(`Krayin login succeeded but no token in response: ${JSON.stringify(body)}`);
    return this.token;
  }

  async request(method, path, body) {
    if (!this.token) await this.login();
    const doFetch = () =>
      this.fetch(this.api(path), {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });

    let res = await doFetch();
    if (res.status === 401 && this.email && this.password) {
      // token expired or revoked: re-login once
      await this.login();
      res = await doFetch();
    }
    const text = await res.text();
    let parsed;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }
    if (!res.ok) {
      const err = new Error(`Krayin API ${method} /${path} -> ${res.status}: ${text.slice(0, 500)}`);
      err.status = res.status;
      err.body = parsed;
      throw err;
    }
    return parsed;
  }

  get(path) { return this.request("GET", path); }
  post(path, body) { return this.request("POST", path, body); }
  put(path, body) { return this.request("PUT", path, body); }
  delete(path) { return this.request("DELETE", path); }
}
