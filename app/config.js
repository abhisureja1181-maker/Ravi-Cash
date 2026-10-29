/* Runtime configuration.
 *   mode: 'demo'   -> self-contained demo that runs inside the browser (sample data, nothing is sent anywhere)
 *   mode: 'server' -> use the Ravi Cash server (npm start). The server serves its own /config.js, so you do
 *                     not need to edit this file when you host the app with it.
 * To host the web files elsewhere and keep the server on another address set:
 *   window.RW_CONFIG = { mode: 'server', apiUrl: 'https://cash.example.com/api' };   (and CORS_ORIGIN on the server)
 */
window.RW_CONFIG = { mode: 'demo' };
