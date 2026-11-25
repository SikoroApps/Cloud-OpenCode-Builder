# GitHub OAuth setup guide for Phase 4.2

This guide is for a beginner performing the **manual** GitHub OAuth setup. It does not change any
Phase 2 or Phase 3 code.

Keep all credentials on your machine or your backend host. **Do not paste client secrets, tokens,
encryption keys or passwords into chat, issues, screenshots, public repositories or logs.**

OAuth is not working merely because configuration values exist. It is live-verified only after a
real browser authorization succeeds and the backend reports `connected: true`.

---

## 1. Decide which GitHub account owns the OAuth App

Prefer an organization-owned OAuth App if you have owner permission:

- Organization: `SikoroApps` → **Settings** → **Developer settings** → **OAuth Apps** → **New OAuth App**.

If you do not have organization owner permission, create a personal one for the first live test:

- Personal: profile photo → **Settings** → **Developer settings** → **OAuth Apps** → **New OAuth App**.

A personal app initially sees repositories that your personal account can access. An organization app
is the better long-term choice for `SikoroApps`.

---

## 2. Create the OAuth App in GitHub

On the **Register a new OAuth application** page, fill in:

| Field | What to enter |
| --- | --- |
| Application name | `Cloud OpenCode Builder` or `Cloud OpenCode Builder (Dev)` |
| Homepage URL | `https://<CLOUD_BACKEND_DOMAIN>` |
| Application description | Optional, for example `Cloud Android app builder with server-side GitHub integration` |
| Authorization callback URL | `https://<CLOUD_BACKEND_DOMAIN>/api/github/oauth/callback` |

Click **Register application**.

### Exact callback URL format

```text
https://<CLOUD_BACKEND_DOMAIN>/api/github/oauth/callback
```

Example:

```text
https://builder.example.com/api/github/oauth/callback
```

Rules:

- Must be `https://`, not `http://` for a deployed backend.
- No trailing slash after `callback`.
- No query string.
- Must match `GITHUB_OAUTH_REDIRECT_URI` exactly in the backend configuration.

After registration:

1. Copy the **Client ID**. It is a public identifier, but still keep it in backend configuration only.
2. Click **Generate a new client secret**.
3. Copy the secret immediately. GitHub shows it only once.
4. Store it directly in your backend secret store. Do not paste it anywhere else.

If you lose the secret, generate a new one and update the backend. The old secret stops working.

---

## 3. Generate the 32-byte encryption key

The backend encrypts GitHub OAuth tokens at rest with AES-256-GCM. It needs a base64-encoded
32-byte key.

On a machine with OpenSSL:

```bash
openssl rand -base64 32
```

Without OpenSSL, using Node.js 22:

```bash
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64') + '\n')"
```

Store the generated value directly as `GITHUB_TOKEN_ENCRYPTION_KEY`. Do not paste it into chat.

Important:

- Generate this key **once** and keep it stable.
- If you rotate it, existing encrypted tokens become unreadable and users must reconnect.
- The value may contain `+`, `/` and `=`. Store the whole value as one secret string.

---

## 4. Where each credential must be configured

All OAuth and backend runtime values go in the **cloud backend runtime environment**, not in the
Android app and not in the public repository.

| Value | Comes from | Configure it in | Notes |
| --- | --- | --- | --- |
| `GITHUB_CLIENT_ID` | OAuth App page | Backend environment / secret manager | Public identifier, but still server-side only |
| `GITHUB_CLIENT_SECRET` | **Generate a new client secret** | Backend secret manager only | Shown once; never commit or log |
| `GITHUB_OAUTH_REDIRECT_URI` | Same string as GitHub callback URL | Backend environment | Must match exactly |
| `GITHUB_TOKEN_ENCRYPTION_KEY` | Generated in step 3 | Backend secret manager | Base64 of 32 bytes |
| `CLOUD_BASE_URL` | Your deployed HTTPS backend root | Backend environment and Android build config | Example: `https://builder.example.com` |
| `GITHUB_APP_CALLBACK_URL` | Optional | Backend environment | Defaults to `cloudopencode://github/callback`; do not change unless the Android deep-link config matches |
| `OPENCODE_API_KEY` or `OPENROUTER_API_KEY` | Your AI provider | Backend secret manager | Needed for live AI file planning in Batch 4.3 |

Signing secrets (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
`ANDROID_KEY_PASSWORD`) are **not** OAuth credentials. They belong in the selected generated app
repository’s protected GitHub Actions secrets, not in this builder repository or the Android app.

---

## 5. Configure the cloud backend environment

Set these in the platform that runs the backend process (for example, a PaaS secret panel, a
protected `.env` file referenced by Docker Compose, or a `0600` systemd `EnvironmentFile`):

```dotenv
GITHUB_CLIENT_ID=<client-id-from-github>
GITHUB_CLIENT_SECRET=<client-secret-from-github>
GITHUB_OAUTH_REDIRECT_URI=https://<CLOUD_BACKEND_DOMAIN>/api/github/oauth/callback
GITHUB_TOKEN_ENCRYPTION_KEY=<base64-of-32-random-bytes>
CLOUD_BASE_URL=https://<CLOUD_BACKEND_DOMAIN>
GITHUB_APP_CALLBACK_URL=cloudopencode://github/callback
OPENCODE_API_KEY=<optional-live-ai-key>
```

The repository already ignores `.env` and `.env.*` files. Never remove those ignore rules.

Restart the backend after changing environment values. The backend reads configuration at process
startup through `cloud/src/config.ts`.

---

## 6. Safe verification commands

These commands print **presence, booleans, names and blocker codes only**. They do not print secret
values. Do not run shell tracing (`set -x`) while using them.

### 6.1 Check which variables are set

From the backend directory:

```bash
cd cloud
node -e 'const names=["GITHUB_CLIENT_ID","GITHUB_CLIENT_SECRET","GITHUB_OAUTH_REDIRECT_URI","GITHUB_TOKEN_ENCRYPTION_KEY","CLOUD_BASE_URL","OPENCODE_API_KEY","OPENROUTER_API_KEY"];for(const n of names) console.log(`${n}=${process.env[n] ? "SET" : "UNSET"}`)'
```

Expected: the five OAuth/backend values show `SET`. AI keys depend on your provider choice.

### 6.2 Run the masked readiness checker

```bash
cd cloud
npm run check:config
```

Expected for a ready backend:

- `githubOAuth.configured: true`
- `redirectUriHttps: true`
- `encryptionKeyValid: true`
- `cloudBackend.baseUrlHttps: true`
- `readyForLiveOAuth: true`
- no GitHub-related blockers

This output still does **not** mean OAuth is authorized. It only means configuration is valid.

### 6.3 Check GitHub Actions secret names, never values

For the selected app repository:

```bash
gh secret list --repo <OWNER>/<APP_REPO>
```

This lists names only. It cannot display secret values and is not where OAuth credentials go.

### 6.4 Check live backend status without printing tokens

This uses a temporary test user session in memory and prints only status booleans and blocker codes.

```bash
cd cloud
cat > /tmp/cloud-oauth-verify.mjs <<'EOF'
const base = (process.env.CLOUD_BASE_URL || "").replace(/\/+$/, "");
const email = process.env.CLOUD_TEST_EMAIL || "";
const password = process.env.CLOUD_TEST_PASSWORD || "";
if (!base || !email || !password) {
  console.log("verification=SKIPPED missing test inputs");
  process.exit(0);
}
const login = await fetch(`${base}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password }),
});
if (!login.ok) {
  console.log("verification=SKIPPED login failed");
  process.exit(0);
}
const { token } = await login.json();
const headers = { Authorization: `Bearer ${token}` };
const status = await (await fetch(`${base}/api/github/status`, { headers })).json();
const readiness = await (await fetch(`${base}/api/config/readiness`, { headers })).json();
console.log(JSON.stringify({
  configured: status.configured,
  connected: status.connected,
  login: status.login || null,
  readyForLiveOAuth: readiness.readiness.readyForLiveOAuth,
  blockers: readiness.readiness.blockers,
}, null, 2));
EOF

read -rp "Cloud test email: " CLOUD_TEST_EMAIL
read -rsp "Cloud test password: " CLOUD_TEST_PASSWORD; echo
CLOUD_TEST_EMAIL="$CLOUD_TEST_EMAIL" CLOUD_TEST_PASSWORD="$CLOUD_TEST_PASSWORD" node /tmp/cloud-oauth-verify.mjs
unset CLOUD_TEST_EMAIL CLOUD_TEST_PASSWORD
rm -f /tmp/cloud-oauth-verify.mjs
```

Expected before browser authorization:

```json
{
  "configured": true,
  "connected": false,
  "login": null,
  "readyForLiveOAuth": true,
  "blockers": []
}
```

`configured: true` with `connected: false` means the app is ready for the browser step, not that
OAuth has succeeded.

### 6.5 Confirm a stored token record exists without printing it

After a successful browser authorization, from the backend directory:

```bash
cd cloud
node --input-type=module -e 'import { DatabaseSync } from "node:sqlite"; const db = new DatabaseSync(process.env.CLOUD_DB_PATH || "cloud-opencode-backend.sqlite"); console.log(db.prepare("SELECT COUNT(*) AS rows, COALESCE(MIN(LENGTH(token_ciphertext)),0) AS minCiphertextLength FROM github_connections").get());'
```

This prints only a row count and minimum ciphertext length. It does not print ciphertext, IV, tag,
token, client secret or encryption key.

---

## 7. Perform the real browser authorization

Only now perform the live step:

1. Sign in to GitHub in a normal browser as the user who should own the token.
2. In the Cloud OpenCode app, start GitHub connection. The backend calls
   `GET /api/github/oauth/start` and returns an authorize URL.
3. Open that authorize URL in the browser.
4. Confirm the requesting app name and that the requested scopes are only:
   `public_repo` and `workflow`.
5. Click **Authorize**.
6. GitHub redirects back to the backend callback. The backend exchanges the one-time code
   server-side, verifies that both `public_repo` and `workflow` were actually granted, encrypts the
   token and redirects to the app callback with a safe status. A reduced-scope token is revoked and
   rejected with `insufficient_scopes`.
7. Run the status check in section 6.4 again.

OAuth is live-verified only when:

- the browser authorization was actually completed, and
- `connected: true` is returned by `GET /api/github/status`, and
- `login` shows the expected GitHub account.

Do not paste the callback URL, authorization code, token or any credential into chat.

## 8. If something fails

| Symptom | Meaning | What to check |
| --- | --- | --- |
| `configured: false` | Backend did not load OAuth configuration | Variables set in the backend runtime? Backend restarted? |
| `redirect_uri_mismatch` | Callback strings differ | GitHub callback must equal `GITHUB_OAUTH_REDIRECT_URI` exactly |
| `bad_verification_code` | Authorization code was reused or expired | Start a new OAuth flow; do not reuse callback URLs |
| `connected: false` after callback | Authorization did not complete or token was not stored | Check backend logs for safe error codes only; never print tokens |
| `403` on repository operations | Token scopes/access insufficient | Confirm `public_repo` and `workflow` were granted and the account can access the repo |

If you need help, describe the **safe error code** and which step failed. Never share secret values.
