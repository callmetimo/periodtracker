// Period Tracker — Google sign-in (Google Identity Services token client).
// No backend: the browser holds a short-lived OAuth access token scoped to
// drive.file (files this app creates) and talks to the Sheets API directly.
//
// ── TWO-PHASE AUTH FOR RETURNING USERS ─────────────────────────────────────
// iOS Safari (PWA) blocks Google's silent sign-in (prompt:'none') because
// Apple's ITP prevents third-party cookies in PWA sandboxes. The old approach
// tried silent auth on every launch and fell back to a "Sign in with Google"
// button after a 4-second timeout — a bad UX for returning users.
//
// New approach for returning users (spreadsheetId cached in localStorage):
//   Phase 1 — Auth.ready resolves immediately using the cached spreadsheet ID.
//             No splash screen shown. The app renders from its localStorage
//             cache (full opex history, current month) instantly.
//   Phase 2 — All Google Sheets API calls block on _tokenReady. This private
//             promise resolves only when the user makes their first physical
//             tap on the screen. index.html registers a one-shot listener that
//             calls Auth.triggerFirstTapSync() on that tap, which triggers an
//             interactive Google token request (iOS allows popups from within
//             a real gesture handler). Once the token arrives, all queued
//             network calls fire simultaneously.
//
// New users (no cached spreadsheetId) still get the classic flow:
//   splash → silent attempt → Sign in with Google button.

const Auth = (() => {
  let tokenClient = null;
  let accessToken = null;
  let tokenExpiresAt = 0;

  // Phase 1: unblocks requireReady() / DataStore calls so the app can render
  // from local cache without a valid token. Resolves immediately for returning
  // users; resolves after full sign-in for new users.
  let readyResolve;
  const ready = new Promise(res => { readyResolve = res; });

  // Phase 2: unblocks getAccessToken() / actual Sheets API calls. Resolves
  // only once a real Google access token has been obtained (on first tap for
  // returning users; immediately after sign-in for new users).
  let tokenReadyResolve;
  const _tokenReady = new Promise(res => { tokenReadyResolve = res; });

  // Whether we are in "deferred token" mode — i.e. Auth.ready has resolved
  // but we are still waiting for the first tap to get a Google token.
  let _deferredMode = false;

  // Two content modes share one full-screen card: a bare "splash" (logo +
  // loading text, no button) shown while we check for an existing session,
  // and the full interactive sign-in prompt shown only when needed.
  const overlay = {
    el: null,
    ensure() {
      if (this.el) return this.el;
      const el = document.createElement('div');
      el.id = 'authOverlay';
      el.innerHTML = `
        <div class="auth-card">
          <h1>Period Tracker</h1>
          <div id="authBody"></div>
        </div>`;
      document.body.appendChild(el);
      this.el = el;
      return el;
    },
    showSplash() {
      this.ensure();
      this.el.querySelector('#authBody').innerHTML = `<p class="auth-status" id="authStatus">Loading…</p>`;
    },
    showSignIn() {
      this.ensure();
      this.el.querySelector('#authBody').innerHTML = `
        <p>Sign in with Google to sync your Period Tracker data securely.
           Your data stays in a private Google Sheet in your own Drive.</p>
        <button id="signInBtn" type="button" style="background-color: var(--primary-color); color: white; border: none; padding: 12px 24px; border-radius: 24px; font-weight: 600; margin: 16px 0;">Sign in with Google</button>
        <p class="auth-status" id="authStatus"></p>`;
      this.el.querySelector('#signInBtn').addEventListener('click', () => signIn());
    },
    setStatus(msg) {
      this.ensure();
      const s = this.el.querySelector('#authStatus');
      if (s) s.textContent = msg || '';
    },
    hide() {
      if (this.el) this.el.remove();
      this.el = null;
    },
  };

  function initTokenClient() {
    if (tokenClient) return tokenClient;
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.GOOGLE_CLIENT_ID,
      scope: CONFIG.GOOGLE_SCOPE,
      callback: () => {}, // overridden per-request below
    });
    return tokenClient;
  }

  // The GIS <script> tag loads async, so it can still be mid-download when
  // DOMContentLoaded fires and Auth.start()/signIn() first touch `google.*`,
  // especially on a slow cold-launch connection. Poll until it's attached
  // instead of assuming script order.
  function waitForGis(timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      if (window.google?.accounts?.oauth2) { resolve(); return; }
      const start = Date.now();
      const iv = setInterval(() => {
        if (window.google?.accounts?.oauth2) {
          clearInterval(iv);
          resolve();
        } else if (Date.now() - start > timeoutMs) {
          clearInterval(iv);
          reject(new Error('Google sign-in script failed to load'));
        }
      }, 100);
    });
  }

  // If the browser blocks the (possibly invisible) popup GIS opens even for
  // prompt:'none'/no-gesture calls, it can log an error and never invoke the
  // token client's callback at all — leaving the caller's promise hanging
  // forever. A bounded timeout is the only way to guarantee this resolves.
  async function requestToken(promptMode, timeoutMs = 6000) {
    await waitForGis();
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('timeout'));
      }, timeoutMs);
      const client = initTokenClient();
      client.callback = (resp) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (resp.error) { reject(new Error(resp.error)); return; }
        accessToken = resp.access_token;
        tokenExpiresAt = Date.now() + (Number(resp.expires_in || 3300) * 1000);
        resolve(accessToken);
      };
      client.requestAccessToken({ prompt: promptMode });
    });
  }

  // Full sign-in flow used for new users and when the overlay sign-in button
  // is tapped. Shows the overlay, opens Google OAuth, then bootstraps the
  // spreadsheet before resolving both ready and _tokenReady.
  async function signIn() {
    overlay.showSignIn();
    const btn = document.getElementById('signInBtn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Connecting...';
    }
    overlay.setStatus('Opening Google sign-in…');
    try {
      // '' lets Google decide: silently reuses an already-granted session for a
      // returning user, or shows the consent screen if this is genuinely new —
      // avoids re-showing consent every time once the user has granted access once.
      await requestToken('');
      overlay.setStatus('Setting up your Period Tracker spreadsheet…');
      await DataStore.bootstrap();
      _deferredMode = false;
      readyResolve();
      tokenReadyResolve();
      overlay.hide();
    } catch (err) {
      console.error('[auth] sign-in failed', err);
      overlay.setStatus('Sign-in failed: ' + err.message + ' — try again.');
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Sign in with Google';
      }
    }
  }

  // Called by index.html's one-shot first-tap listener. This runs inside a
  // real user-gesture handler so iOS Safari allows the Google popup. Obtains
  // a fresh token and resolves _tokenReady, unblocking all queued API calls.
  // If it fails (user genuinely signed out of Google), falls back to the
  // full sign-in overlay so they can complete sign-in manually.
  async function triggerFirstTapSync() {
    if (!_deferredMode) return false; // already have a token or not in deferred mode
    console.log('[auth] first tap — obtaining Google token');
    try {
      // '' avoids re-showing consent for a user who already granted access;
      // Google will resolve without a visible prompt if the session is active.
      await requestToken('');
      _deferredMode = false;
      tokenReadyResolve();
      console.log('[auth] token obtained on first tap');
      return true;
    } catch (err) {
      console.warn('[auth] first-tap token request failed, showing sign-in', err);
      _deferredMode = false;
      // Show the full overlay — signIn() called from the button will resolve
      // _tokenReady (via the same tokenReadyResolve reference in signIn()).
      overlay.showSignIn();
      return false;
    }
  }

  // Called by SheetsClient for every API call. For returning users in deferred
  // mode, this blocks on _tokenReady (waiting for the first tap) instead of
  // attempting a silent request that iOS PWA will always block. After the first
  // tap resolves, behaves normally — refreshing the token when near expiry.
  async function getAccessToken() {
    if (accessToken && Date.now() < tokenExpiresAt - 60000) return accessToken;

    // In deferred mode, patiently wait for the first-tap sync to provide a token.
    if (_deferredMode) {
      await _tokenReady;
      if (accessToken && Date.now() < tokenExpiresAt - 60000) return accessToken;
    }

    // Token expired after first use (normal 1-hour refresh cycle).
    // Silent refresh won't work on iOS PWA, so fall back to the sign-in overlay.
    try {
      await requestToken('none'); // works on desktop; expected to fail on iOS PWA
      return accessToken;
    } catch (err) {
      overlay.showSignIn();
      overlay.setStatus('Your session expired — please sign in again.');
      await signIn(); // re-prompts; DataStore.bootstrap() is a no-op if already set up
      return accessToken;
    }
  }

  async function start() {
    const cachedSpreadsheetId = localStorage.getItem('periodTracker_spreadsheetId');

    if (cachedSpreadsheetId) {
      // ── RETURNING USER PATH ──────────────────────────────────────────────
      // We know the spreadsheet ID. Resolve Auth.ready immediately so the app
      // can render from its localStorage cache without waiting for Google.
      // No splash screen is shown. All Sheets API calls will silently block
      // on _tokenReady until the user's first tap triggers triggerFirstTapSync().
      console.log('[auth] returning user — instant launch, token deferred to first tap');
      _deferredMode = true;
      readyResolve();
    } else {
      // ── NEW USER PATH ────────────────────────────────────────────────────
      // No cached spreadsheet — use the classic flow: splash → silent attempt
      // (fast-fails on iOS PWA) → Sign in with Google button.
      overlay.showSplash();
      try {
        await requestToken('none', 4000); // short timeout; always fails on iOS PWA but worth trying on desktop
        await DataStore.bootstrap();
        _deferredMode = false;
        readyResolve();
        tokenReadyResolve(); // token already in hand
      } catch (err) {
        overlay.showSignIn();
      }
    }
  }

  // Called by index.html once the Home page has had its first paint attempt —
  // hides the splash/sign-in overlay as soon as `ready` resolves (immediately,
  // if it already has). Safe to call more than once or before `ready` resolves.
  function markAppReady() {
    ready.then(() => overlay.hide());
  }

  function signOut() {
    try {
      if (accessToken && google.accounts?.oauth2?.revoke) {
        google.accounts.oauth2.revoke(accessToken, () => {});
      }
    } catch (err) { console.warn('[auth] revoke failed', err); }
    accessToken = null;
    tokenExpiresAt = 0;
    // NOTE: We deliberately keep periodTracker_spreadsheetId in localStorage
    // so the next sign-in reuses the same spreadsheet instead of creating a new one.
    location.reload();
  }

  return { start, signIn, signOut, getAccessToken, triggerFirstTapSync, ready, markAppReady };
})();

// Auth.start() is called by app.js after all scripts are loaded.
