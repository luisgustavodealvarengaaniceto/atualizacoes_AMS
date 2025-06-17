require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const XLSX = require('xlsx');
const { enviarEmailComExcel } = require('./email');
const cron = require('node-cron');
dayjs.extend(utc);
dayjs.extend(timezone);

const app = express();
app.use(cors());
app.use(express.json());

const API_URL = 'http://fota-api.jimicloud.com';
const APP_KEY = 'Jimiiotbrasil';
const SECRET = '23dd6cca658b4ec298aeb7beb4972fd4';

// Função para obter o token
async function getToken() {
  const response = await axios.post(`${API_URL}/token`, {
    appKey: APP_KEY,
    secret: SECRET
  });
  return response.data.data.token;
}

// Função para buscar status dos dispositivos
async function queryDeviceStatus(token, imeiList) {
  const response = await axios.post(
    `${API_URL}/queryDeviceStatus`,
    { imeiList },
    { headers: { Authorization: token } }
  );
  return response.data.data;
}

// Utilitário para extrair versão
function extractVersion(device) {
  if (device.version && device.version !== 'null') {
    return device.version;
  }
  if (device.selfCheckParam) {
    const match = device.selfCheckParam.match(/VERSION:([^;]+)/);
    if (match) return match[1];
  }
  return '';
}

// Verifica se o dispositivo esteve online nas últimas 24 horas
function isOnlineUltimas24h(lastime) {
  if (!lastime) return false;
  // lastime vem como string ISO, mas GMT+8 (China)
  // Ajusta para GMT-3 (Brasília)
  const dataChina = dayjs.tz(lastime, 'Asia/Shanghai');
  const dataBrasilia = dataChina.tz('America/Sao_Paulo');
  const agora = dayjs().tz('America/Sao_Paulo');
  return agora.diff(dataBrasilia, 'hour') <= 24;
}

// Endpoint principal para consulta
app.post('/api/consultar', async (req, res) => {
  try {
    const imeis = req.body.imeis;
    const versaoAtual = req.body.versaoAtual || '';
    console.log('Recebido para consulta:', imeis.length, 'IMEIs');
    if (!Array.isArray(imeis) || imeis.length === 0) {
      console.log('Erro: IMEIs inválidos:', imeis);
      return res.status(400).json({ error: 'IMEIs inválidos.' });
    }
    const token = await getToken();
    console.log('Token obtido:', token);
    const results = [];
    for (let i = 0; i < imeis.length; i += 100) {
      const lote = imeis.slice(i, i + 100);
      console.log(`Consultando lote ${i/100 + 1}:`, lote);
      try {
        const data = await queryDeviceStatus(token, lote);
        console.log(`Retorno do lote ${i/100 + 1}:`, data);
        for (const device of data) {
          results.push({
            imei: device.imei,
            version: extractVersion(device),
            lastime: device.lastime || device.lastTime || '',
            online24h: isOnlineUltimas24h(device.lastime || device.lastTime || ''),
            atualizado: versaoAtual ? (extractVersion(device) === versaoAtual ? 'Sim' : 'Não') : '',
            mode: device.mode, // Adicionado
            selfCheckParam: device.selfCheckParam // Adicionado
          });
        }
      } catch (loteErr) {
        console.error(`Erro ao consultar lote ${i/100 + 1}:`, loteErr);
        results.push(...lote.map(imei => ({ imei, version: 'ERRO' })));
      }
    }
    res.json({ results });
  } catch (err) {
    console.error('Erro geral na consulta:', err);
    res.status(500).json({ error: err.message });
  }
});

// Endpoint para exportar Excel
app.post('/api/exportar', (req, res) => {
  const { results } = req.body;
  const dataHora = dayjs().tz('America/Sao_Paulo').format('DD/MM/YYYY HH:mm:ss');
  const exportData = results.map(r => ({
    'IMEI': r.imei,
    'Versão': r.version,
    'Atualizado?': r.atualizado || (r.version === (r.versaoAtual || '') ? 'Sim' : 'Não'),
    'Última vez online (GMT-3 Brasília)': r.lastime ? dayjs(r.lastime).tz('America/Sao_Paulo').format('DD/MM/YYYY HH:mm:ss') : '-',
    'Online nas últimas 24h?': r.online24h ? 'Sim' : 'Não'
  }));
  const ws = XLSX.utils.json_to_sheet([]);
  XLSX.utils.sheet_add_aoa(ws, [[`Relatório gerado em: ${dataHora} (GMT-3 Brasília)`]], {origin: 'A1'});
  XLSX.utils.sheet_add_aoa(ws, [Object.keys(exportData[0])], {origin: 'A2'});
  XLSX.utils.sheet_add_json(ws, exportData, {origin: 'A3', skipHeader: true});
  ws['!cols'] = [
    { wch: 18 },
    { wch: 12 },
    { wch: 12 },
    { wch: 32 },
    { wch: 22 }
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Resultados');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const nomeArquivo = `resultados_${dayjs().tz('America/Sao_Paulo').format('YYYYMMDD_HHmmss')}.xlsx`;
  res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

let monitorando = false;
let monitorConfig = { imeis: [], versaoAtual: '', ultimoRelatorio: [], email: '', intervalo: 60, horariosFixos: '' };
let monitorJob = null;

// Ativar monitoramento
app.post('/api/monitorar', (req, res) => {
  const { imeis, versaoAtual, email, intervalo, horariosFixos } = req.body;
  if (!Array.isArray(imeis) || imeis.length === 0 || !versaoAtual) {
    return res.status(400).json({ error: 'IMEIs e versão obrigatórios.' });
  }
  monitorando = true;
  monitorConfig = { imeis, versaoAtual, email: email || '', intervalo: intervalo || 60, horariosFixos: horariosFixos || '', ultimoRelatorio: [] };
  if (monitorJob) monitorJob.stop();
  let cronExp = '';
  if (monitorConfig.horariosFixos && monitorConfig.horariosFixos.trim() !== '') {
    // Exemplo: horariosFixos = '08:00,18:00'
    const horarios = monitorConfig.horariosFixos.split(',').map(h => h.trim()).filter(Boolean);
    // Gera expressão cron para cada horário
    // Exemplo: ['08:00', '18:00'] => ['0 8 * * *', '0 18 * * *']
    cronExp = horarios.map(h => {
      const [hora, min] = h.split(':');
      return `${parseInt(min, 10)} ${parseInt(hora, 10)} * * *`;
    });
    console.log('Agendando monitoramento para os horários fixos:', horarios, 'Expressões cron:', cronExp);
    monitorJob = require('node-cron').schedule(cronExp.join(','), async () => {
      console.log('Monitoramento automático executado (horário fixo):', new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }));
      await executarMonitoramento();
    });
  } else {
    cronExp = `*/${monitorConfig.intervalo} * * * *`;
    console.log('Agendando monitoramento para cada', monitorConfig.intervalo, 'minutos. Expressão cron:', cronExp);
    monitorJob = require('node-cron').schedule(cronExp, async () => {
      console.log('Monitoramento automático executado (intervalo):', new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }));
      await executarMonitoramento();
    });
  }
  res.json({ monitorando: true });
});

// Desativar monitoramento
app.post('/api/parar-monitoramento', (req, res) => {
  monitorando = false;
  if (monitorJob) monitorJob.stop();
  monitorJob = null;
  res.json({ monitorando: false });
});

// Status do monitoramento
app.get('/api/status-monitoramento', (req, res) => {
  res.json({ monitorando, ...monitorConfig });
});

async function executarMonitoramento() {
  if (!monitorando) return;
  try {
    console.log('Iniciando execução do monitoramento:', new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }));
    const token = await getToken();
    const results = [];
    for (let i = 0; i < monitorConfig.imeis.length; i += 100) {
      const lote = monitorConfig.imeis.slice(i, i + 100);
      const data = await queryDeviceStatus(token, lote);
      for (const device of data) {
        results.push({
          imei: device.imei,
          version: extractVersion(device),
          lastime: device.lastime || device.lastTime || '',
          online24h: isOnlineUltimas24h(device.lastime || device.lastTime || ''),
          atualizado: monitorConfig.versaoAtual ? (extractVersion(device) === monitorConfig.versaoAtual ? 'Sim' : 'Não') : '',
        });
      }
    }
    // Verifica alterações de firmware
    let alteracao = false;
    if (monitorConfig.ultimoRelatorio.length > 0) {
      for (const r of results) {
        const anterior = monitorConfig.ultimoRelatorio.find(x => x.imei === r.imei);
        if (anterior && anterior.version !== r.version) {
          alteracao = true;
          break;
        }
      }
    }
    // Gera Excel
    const dataHora = dayjs().tz('America/Sao_Paulo').format('DD/MM/YYYY HH:mm:ss');
    const exportData = results.map(r => ({
      'IMEI': r.imei,
      'Versão': r.version,
      'Atualizado?': r.atualizado,
      'Última vez online (GMT-3 Brasília)': r.lastime ? dayjs(r.lastime).tz('America/Sao_Paulo').format('DD/MM/YYYY HH:mm:ss') : '-',
      'Online nas últimas 24h?': r.online24h ? 'Sim' : 'Não'
    }));
    const ws = XLSX.utils.json_to_sheet([]);
    XLSX.utils.sheet_add_aoa(ws, [[`Relatório gerado em: ${dataHora} (GMT-3 Brasília)`]], {origin: 'A1'});
    XLSX.utils.sheet_add_aoa(ws, [Object.keys(exportData[0])], {origin: 'A2'});
    XLSX.utils.sheet_add_json(ws, exportData, {origin: 'A3', skipHeader: true});
    ws['!cols'] = [
      { wch: 18 },
      { wch: 12 },
      { wch: 12 },
      { wch: 32 },
      { wch: 22 }
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Resultados');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    // Envia e-mail para todos os destinatários
    const destinatarios = monitorConfig.email.split(',').map(e => e.trim()).filter(e => e);
    const assunto = alteracao ? 'Alteração de firmware detectada' : 'Nenhuma alteração de firmware';
    const texto = alteracao ? `Houve alteração de firmware em pelo menos um equipamento. Horário de referência: ${dataHora} (GMT-3 Brasília)` : `Nenhuma alteração de firmware detectada. Horário de referência: ${dataHora} (GMT-3 Brasília)`;
    for (const dest of destinatarios) {
      await enviarEmailComExcel(dest, assunto, texto, buffer);
      console.log('E-mail enviado para:', dest);
    }
    monitorConfig.ultimoRelatorio = results;
    if (!alteracao) {
      console.log('Monitoramento executado, mas nenhuma alteração de firmware detectada. Nenhum e-mail enviado.');
    }
  } catch (err) {
    console.error('Erro no monitoramento:', err);
  }
}

// Novo endpoint para envio manual de e-mail
app.post('/api/enviar-email', async (req, res) => {
  try {
    console.log('Recebida requisição para /api/enviar-email');
    const { destinatario, assunto, texto, results } = req.body;
    console.log('Dados recebidos:', { destinatario, assunto, texto, resultsLength: Array.isArray(results) ? results.length : 'results não é array' });
    if (!destinatario || !assunto || !texto || !Array.isArray(results)) {
      console.log('Parâmetros obrigatórios ausentes ou inválidos');
      return res.status(400).json({ error: 'Parâmetros obrigatórios ausentes.' });
    }
    const ws = XLSX.utils.json_to_sheet(results);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Resultados');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    console.log('Buffer do Excel gerado, tamanho:', buffer.length);
    console.log('Chamando enviarEmailComExcel...');
    await enviarEmailComExcel(destinatario, assunto, texto, buffer);
    console.log('E-mail enviado com sucesso!');
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao enviar e-mail manual:', err);
    res.status(500).json({ error: 'Erro ao enviar e-mail.', detalhe: err.message });
  }
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Servidor backend rodando na porta ${PORT}`);
});
