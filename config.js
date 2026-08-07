// Period Tracker — Google Cloud OAuth configuration.
//
// Fill this in after creating your Google Cloud project (see README.md):
//   1. Create a Google Cloud project.
//   2. Enable the "Google Sheets API" and "Google Drive API".
//   3. Configure the OAuth consent screen — add the `drive.file` scope only.
//   4. Create an OAuth 2.0 Client ID (Web application) and add this app's
//      URL (e.g. https://you.github.io/periodtracker and http://localhost:8000)
//      under "Authorized JavaScript origins".
//   5. Paste the generated Client ID below.
const CONFIG = {
  // ___GOOGLE_CLIENT_ID___ is replaced at build time by GitHub Actions.
  GOOGLE_CLIENT_ID: '26582473811-rj49d1h9njv8fr6j74m92t63amulg2tb.apps.googleusercontent.com',
  // Non-sensitive scope: the app can only see/edit files it creates itself,
  // never the user's other Drive files or Sheets.
  GOOGLE_SCOPE: 'https://www.googleapis.com/auth/drive.file',
};

// Fallback for local development (localhost, local IPs, etc.) so it runs out-of-the-box everywhere except the production domain.
if (location.hostname !== 'callmetimo.github.io') {
  CONFIG.GOOGLE_CLIENT_ID = '26582473811-rj49d1h9njv8fr6j74m92t63amulg2tb.apps.googleusercontent.com';
}

