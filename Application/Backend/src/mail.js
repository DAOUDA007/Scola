// Envoi d'e-mails (codes d'activation des établissements, alertes à l'administration).
// Configuration par variables d'environnement : SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS,
// SMTP_FROM (ex. Gmail : smtp.gmail.com, 465, adresse, mot de passe d'application).
// Sans configuration, rien n'est envoyé : l'administration transmet le code elle-même.
let transporter = null;

function configured() { return !!process.env.SMTP_HOST; }

function getTransporter() {
  if (!transporter) {
    const nodemailer = require('nodemailer');
    const port = Number(process.env.SMTP_PORT) || 465;
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST, port, secure: port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  }
  return transporter;
}

async function send({ to, subject, text, html }) {
  if (!configured()) return { sent: false, reason: 'SMTP non configuré' };
  try {
    await getTransporter().sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject, text, html });
    return { sent: true };
  } catch (e) {
    console.error('[mail] envoi impossible :', e.message);
    return { sent: false, reason: e.message };
  }
}

module.exports = { send, configured };
