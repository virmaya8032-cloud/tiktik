// Outgoing email, used only for password-reset links. Off unless configured:
//   SMTP_URL   e.g. smtps://user:app-password@smtp.gmail.com:465  (needs: npm install nodemailer)
//   MAIL_FROM  sender shown to the recipient (default "TikTik <no-reply@localhost>")
//   MAIL_LOG=1 development only: print messages to the server console instead of sending them
// Returns null when email is off, otherwise { send({ to, subject, text }) }.
export function createMailer(env = process.env) {
  const from = env.MAIL_FROM || 'TikTik <no-reply@localhost>';
  if (env.SMTP_URL) {
    let transport;
    return {
      async send({ to, subject, text }) {
        if (!transport) {
          let nodemailer;
          try {
            nodemailer = (await import('nodemailer')).default;
          } catch {
            throw new Error('SMTP_URL is set but nodemailer is not installed. Run: npm install nodemailer');
          }
          transport = nodemailer.createTransport(env.SMTP_URL);
        }
        await transport.sendMail({ from, to, subject, text });
      },
    };
  }
  if (env.MAIL_LOG === '1') {
    return {
      async send({ to, subject, text }) {
        console.log(`[mail] to=${to} subject=${subject}\n${text}`);
      },
    };
  }
  return null;
}
