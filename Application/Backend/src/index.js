const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const express = require('express');
const { Server } = require('socket.io');
const { UPLOADS } = require('./db');
const auth = require('./auth');
const api = require('./api');
const realtime = require('./realtime');

const PORT = Number(process.env.PORT) || 3000;
// Interface des élèves : Application/Frontend.
const PUBLIC = process.env.FRONTEND_DIR || path.join(__dirname, '..', '..', 'Frontend');
// Partie administration (dossier Admin/ à la racine du projet) : API + interface.
const ADMIN_DIR = process.env.ADMIN_DIR || path.join(__dirname, '..', '..', '..', 'Admin');
const admin = require(path.join(ADMIN_DIR, 'Backend', 'admin.js'));
const ADMIN_PUBLIC = path.join(ADMIN_DIR, 'Frontend');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=(self), display-capture=(self)');
  next();
});

// Fichiers partagés : noms aléatoires non devinables.
app.use('/media', express.static(UPLOADS, {
  maxAge: '30d', immutable: true, index: false,
  setHeaders: (res, file) => {
    if (/\.(html?|svg|xml|js)$/i.test(file)) res.setHeader('Content-Disposition', 'attachment');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'");
  },
}));
app.get('/vendor/jsQR.js', (req, res) => res.sendFile(require.resolve('jsqr/dist/jsQR.js')));

// L'API d'administration doit être montée avant l'API élèves (qui exige un jeton élève).
app.use('/api/admin', admin.router);
app.use('/api', auth.router);
app.use('/api', api.router);
app.use('/api', (req, res) => res.status(404).json({ error: 'Route inconnue.' }));

// Espace d'administration (/admin), servi depuis Admin/Frontend.
app.use('/admin', express.static(ADMIN_PUBLIC, { index: 'index.html', maxAge: 0 }));
app.use(express.static(PUBLIC, { index: 'index.html', maxAge: 0 }));
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/media/')) return next();
  if (req.path === '/admin' || req.path.startsWith('/admin/')) return res.sendFile(path.join(ADMIN_PUBLIC, 'index.html'));
  res.sendFile(path.join(PUBLIC, 'index.html'));
});

app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Fichier trop volumineux (100 Mo maximum).' });
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Erreur interne du serveur.' : err.message });
});

let server;
if (process.env.SSL_KEY && process.env.SSL_CERT) {
  server = https.createServer({ key: fs.readFileSync(process.env.SSL_KEY), cert: fs.readFileSync(process.env.SSL_CERT) }, app);
} else {
  server = http.createServer(app);
}

const io = new Server(server, { maxHttpBufferSize: 1e6, pingInterval: 20000 });
realtime(io);

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Le port ${PORT} est déjà utilisé (Scola tourne peut-être déjà : ouvrez http://localhost:${PORT}).`);
    console.error(`  Arrêtez l'autre serveur, ou choisissez un autre port : $env:PORT=3001; npm start (PowerShell)\n`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, () => {
  const proto = server instanceof https.Server ? 'https' : 'http';
  console.log(`\n  Scola est lancé : ${proto}://localhost:${PORT}\n`);
  if (!process.env.SMS_PROVIDER) console.log('  (Mode démo : les codes de connexion s\'affichent ici et dans l\'application.)\n');
});
