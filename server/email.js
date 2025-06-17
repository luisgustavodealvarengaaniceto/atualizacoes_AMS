// ATENÇÃO: Use variáveis de ambiente para as credenciais de e-mail!
// Exemplo: defina EMAIL_USER e EMAIL_PASS no seu ambiente ou .env
const nodemailer = require('nodemailer');

// Configure aqui o serviço de e-mail (exemplo com Gmail)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

async function enviarEmailComExcel(destinatario, assunto, texto, bufferExcel) {
  return transporter.sendMail({
    from: 'arquivosjimi@gmail.com',
    to: destinatario,
    subject: assunto,
    text: texto,
    attachments: [
      {
        filename: 'relatorio.xlsx',
        content: bufferExcel
      }
    ]
  });
}

module.exports = { enviarEmailComExcel };
