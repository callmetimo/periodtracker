// Period Tracker — Google Cloud OAuth configuration.
//
// To set up your own copy:
//   1. Create a Google Cloud project.
//   2. Enable the "Google Sheets API" and "Google Drive API".
//   3. Configure the OAuth consent screen — add the `drive.file` scope only.
//   4. Create an OAuth 2.0 Client ID (Web application) and add this app's
//      URL (e.g. https://you.github.io/periodtracker and http://localhost:8000)
//      under "Authorized JavaScript origins".
//   5. Paste the generated Client ID below.
//
// This value is committed as plain text deliberately — it's a public OAuth
// *client* ID (not a secret), safe to expose for this browser-only, no-backend
// app. deploy.yml uploads this repo to GitHub Pages as-is with no build/templating
// step, so there is nothing that substitutes this value per-environment.
const CONFIG = {
  GOOGLE_CLIENT_ID: '26582473811-rj49d1h9njv8fr6j74m92t63amulg2tb.apps.googleusercontent.com',
  // Non-sensitive scope: the app can only see/edit files it creates itself,
  // never the user's other Drive files or Sheets.
  GOOGLE_SCOPE: 'https://www.googleapis.com/auth/drive.file',
};

