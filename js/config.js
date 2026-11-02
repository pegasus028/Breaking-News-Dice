/* Paste the Apps Script web app URL (ending /exec) between the quotes.
   Leave it empty to run in Demo mode (everything stays in this browser). */
window.BND_API_URL = 'https://script.google.com/macros/s/AKfycbwE1ENtOGLqBetc8cwYh9XQwd1LUHpKhciR6OIA4_Eku_gcwLdP9cUaRwB-0ZcFySgW/exec';

/* Add ?demo to any page (e.g. demo.html) to try the game in this browser without touching the live Sheet. */
if (/[?&]demo\b/.test(location.search)) window.BND_API_URL = '';
