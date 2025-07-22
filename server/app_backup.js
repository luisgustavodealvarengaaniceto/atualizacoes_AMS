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
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '20mb' }));

const API_URL = 'http://fota-api.jimicloud.com';
const APP_KEY = 'Jimiiotbrasil';
const SECRET = '23dd6cca658b4ec298aeb7beb4972fd4';

// Função para obter o token
async function getToken() {
  try {
    console.log('Solicitando token da API...');
    const response = await axios.post(`${API_URL}/token`, {
      appKey: APP_KEY,
      secret: SECRET
    });
    
    console.log('Resposta do token - Status:', response.status);
    console.log('Resposta do token - Data:', response.data);
    
    if (response.data && response.data.code === 0 && response.data.data && response.data.data.token) {
      const token = response.data.data.token;
      console.log('Token obtido com sucesso:', token.substring(0, 20) + '...');
      return token;
    } else {
      throw new Error(`Erro ao obter token: ${response.data ? response.data.msg : 'Resposta inválida'}`);
    }
  } catch (error) {
    console.error('Erro na obtenção do token:', error);
    if (error.response) {
      console.error('Status da resposta:', error.response.status);
      console.error('Data da resposta:', error.response.data);
    }
    throw error;
  }
}

// Função para buscar status dos dispositivos
async function queryDeviceStatus(token, imeiList) {
  try {
    console.log(`Consultando ${imeiList.length} IMEIs...`);
    
    const response = await axios.post(
      `${API_URL}/queryDeviceStatus`,
      { imeiList },
      { 
        headers: { 
          'Authorization': token,
          'Content-Type': 'application/json'
        },
        timeout: 60000 // 60 segundos
      }
    );
    
    console.log('Resposta da consulta - Status:', response.status);
    
    if (response.data && response.data.code === 0) {
      const data = response.data.data || [];
      console.log(`Consulta bem-sucedida: ${data.length} resultados retornados`);
      return data;
    } else {
      throw new Error(`Erro na consulta: ${response.data ? response.data.msg : 'Resposta inválida'}`);
    }
  } catch (error) {
    console.error('Erro na consulta de dispositivos:', error.message);
    if (error.response) {
      console.error('Status da resposta:', error.response.status);
      console.error('Data da resposta:', error.response.data);
    }
    throw error;
  }
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
  const dataChina = dayjs.tz(lastime, 'Asia/Shanghai');
  const dataBrasilia = dataChina.tz('America/Sao_Paulo');
  const agora = dayjs().tz('America/Sao_Paulo');
  return agora.diff(dataBrasilia, 'hour') <= 24;
}

// Função para aguardar um tempo em ms
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Endpoint principal para consulta
app.post('/api/consultar', async (req, res) => {
  try {
    const imeis = req.body.imeis;
    const versaoAtual = req.body.versaoAtual || '';
    console.log('\n=== NOVA CONSULTA ===');
    console.log('Recebido para consulta:', imeis.length, 'IMEIs');
    
    if (!Array.isArray(imeis) || imeis.length === 0) {
      console.log('Erro: IMEIs inválidos:', imeis);
      return res.status(400).json({ error: 'IMEIs inválidos.' });
    }

    const token = await getToken();
    
    // Testa com um único IMEI primeiro para validar
    console.log('Testando API com um único IMEI primeiro...');
    try {
      const testResult = await queryDeviceStatus(token, [imeis[0]]);
      console.log('Teste bem-sucedido, resultado:', testResult.length, 'dispositivo(s)');
    } catch (testError) {
      console.error('Teste individual falhou:', testError.message);
      return res.status(500).json({ 
        error: 'API não está respondendo corretamente: ' + testError.message 
      });
    }
    
    const results = [];
    const batchSize = 99;
    const totalLotes = Math.ceil(imeis.length / batchSize);
    
    console.log(`Processando ${imeis.length} IMEIs em ${totalLotes} lotes de até ${batchSize} cada...`);
    
    for (let i = 0; i < imeis.length; i += batchSize) {
      const loteIndex = Math.floor(i / batchSize) + 1;
      const lote = imeis.slice(i, i + batchSize);
      
      console.log(`\nProcessando lote ${loteIndex}/${totalLotes} (${lote.length} IMEIs)...`);
      
      let tentativas = 0;
      const maxTentativas = 3;
      let sucesso = false;
      
      while (tentativas < maxTentativas && !sucesso) {
        try {
          tentativas++;
          console.log(`Tentativa ${tentativas} para lote ${loteIndex}...`);
          
          const data = await queryDeviceStatus(token, lote);
          
          console.log(`Lote ${loteIndex} processado: ${data.length} resultados`);
          
          // Processa os dados retornados
          for (const device of data) {
            results.push({
              imei: device.imei,
              version: extractVersion(device),
              lastime: device.lastime || device.lastTime || '',
              online24h: isOnlineUltimas24h(device.lastime || device.lastTime || ''),
              atualizado: versaoAtual ? (extractVersion(device) === versaoAtual ? 'Sim' : 'Não') : '',
              mode: device.mode || '',
              selfCheckParam: device.selfCheckParam || ''
            });
          }

          // Verifica IMEIs não encontrados
          const imeisRetornados = data.map(d => d.imei);
          const imeisFaltando = lote.filter(imei => !imeisRetornados.includes(imei));
          
          if (imeisFaltando.length > 0) {
            console.log(`Lote ${loteIndex}: ${imeisFaltando.length} IMEIs não encontrados`);
            for (const imei of imeisFaltando) {
              results.push({
                imei,
                version: 'NÃO ENCONTRADO',
                lastime: '',
                online24h: false,
                atualizado: 'Não',
                mode: '',
                selfCheckParam: ''
              });
            }
          }

          sucesso = true;
          
        } catch (loteErr) {
          console.error(`Erro no lote ${loteIndex} (tentativa ${tentativas}):`, loteErr.message);
          
          // Se erro 500 e ainda temos tentativas, tenta com lotes menores
          if (loteErr.message.includes('500') && lote.length > 25 && tentativas === 1) {
            console.log(`Tentando dividir lote ${loteIndex} em sublotes menores...`);
            
            try {
              let subloteSucesso = 0;
              for (let j = 0; j < lote.length; j += 25) {
                const sublote = lote.slice(j, j + 25);
                console.log(`Processando sublote de ${sublote.length} IMEIs...`);
                
                const subData = await queryDeviceStatus(token, sublote);
                
                for (const device of subData) {
                  results.push({
                    imei: device.imei,
                    version: extractVersion(device),
                    lastime: device.lastime || device.lastTime || '',
                    online24h: isOnlineUltimas24h(device.lastime || device.lastTime || ''),
                    atualizado: versaoAtual ? (extractVersion(device) === versaoAtual ? 'Sim' : 'Não') : '',
                    mode: device.mode || '',
                    selfCheckParam: device.selfCheckParam || ''
                  });
                }

                // Verifica IMEIs não encontrados no sublote
                const imeisRetornados = subData.map(d => d.imei);
                const imeisFaltando = sublote.filter(imei => !imeisRetornados.includes(imei));
                
                for (const imei of imeisFaltando) {
                  results.push({
                    imei,
                    version: 'NÃO ENCONTRADO',
                    lastime: '',
                    online24h: false,
                    atualizado: 'Não',
                    mode: '',
                    selfCheckParam: ''
                  });
                }

                subloteSucesso++;
                if (j + 25 < lote.length) {
                  await sleep(2000); // Aguarda entre sublotes
                }
              }
              
              sucesso = true;
              console.log(`Lote ${loteIndex} processado com ${subloteSucesso} sublotes`);
              
            } catch (subloteErr) {
              console.error(`Erro nos sublotes do lote ${loteIndex}:`, subloteErr.message);
            }
          }
          
          if (tentativas >= maxTentativas && !sucesso) {
            console.error(`Lote ${loteIndex} falhou após ${maxTentativas} tentativas`);
            
            // Marca todos os IMEIs do lote como erro
            for (const imei of lote) {
              results.push({
                imei,
                version: 'ERRO',
                lastime: '',
                online24h: false,
                atualizado: 'Não',
                mode: '',
                selfCheckParam: ''
              });
            }
          } else if (!sucesso) {
            console.log(`Aguardando 5 segundos antes da próxima tentativa...`);
            await sleep(5000);
          }
        }
      }

      // Aguarda entre lotes
      if (loteIndex < totalLotes) {
        console.log(`Aguardando 3 segundos antes do próximo lote...`);
        await sleep(3000);
      }
    }

    console.log(`\n=== CONSULTA FINALIZADA ===`);
    console.log(`Total de resultados: ${results.length}`);
    const sucessos = results.filter(r => r.version !== 'ERRO' && r.version !== 'NÃO ENCONTRADO').length;
    const erros = results.filter(r => r.version === 'ERRO').length;
    const naoEncontrados = results.filter(r => r.version === 'NÃO ENCONTRADO').length;
    console.log(`Sucessos: ${sucessos}, Erros: ${erros}, Não encontrados: ${naoEncontrados}`);
    
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
    'Online nas últimas 24h?': r.online24h ? 'Sim' : 'Não',
    'MODE': r.mode || '-',
    'Bateria (%)': (() => {
      if (!r.selfCheckParam) return '-';
      const match = r.selfCheckParam.match(/vBat=\d+mV\((\d+)%\)/);
      return match ? match[1] + '%' : '-';
    })(),
    'STATUS 3S': r.status3S || '-'
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
    const horarios = monitorConfig.horariosFixos.split(',').map(h => h.trim()).filter(Boolean);
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
    const batchSize = 99;
    const totalLotes = Math.ceil(monitorConfig.imeis.length / batchSize);
    
    for (let i = 0; i < monitorConfig.imeis.length; i += batchSize) {
      const loteIndex = Math.floor(i / batchSize) + 1;
      const lote = monitorConfig.imeis.slice(i, i + batchSize);
      
      console.log(`Monitoramento - Processando lote ${loteIndex}/${totalLotes} (${lote.length} IMEIs)...`);
      
      try {
        const data = await queryDeviceStatus(token, lote);
        
        for (const device of data) {
          results.push({
            imei: device.imei,
            version: extractVersion(device),
            lastime: device.lastime || device.lastTime || '',
            online24h: isOnlineUltimas24h(device.lastime || device.lastTime || ''),
            atualizado: monitorConfig.versaoAtual ? (extractVersion(device) === monitorConfig.versaoAtual ? 'Sim' : 'Não') : '',
            mode: device.mode || '',
            selfCheckParam: device.selfCheckParam || ''
          });
        }

        const imeisRetornados = data.map(d => d.imei);
        const imeisFaltando = lote.filter(imei => !imeisRetornados.includes(imei));
        
        for (const imei of imeisFaltando) {
          results.push({
            imei,
            version: 'NÃO ENCONTRADO',
            lastime: '',
            online24h: false,
            atualizado: 'Não',
            mode: '',
            selfCheckParam: ''
          });
        }
        
      } catch (loteErr) {
        console.error(`Erro no monitoramento - lote ${loteIndex}:`, loteErr.message);
        for (const imei of lote) {
          results.push({
            imei,
            version: 'ERRO',
            lastime: '',
            online24h: false,
            atualizado: 'Não',
            mode: '',
            selfCheckParam: ''
          });
        }
      }

      if (loteIndex < totalLotes) {
        await sleep(3000);
      }
    }
    
    console.log(`Monitoramento finalizado. Total de resultados: ${results.length}`);
    
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
    
    // Gera Excel e envia e-mail
    const dataHora = dayjs().tz('America/Sao_Paulo').format('DD/MM/YYYY HH:mm:ss');
    const exportData = results.map(r => ({
      'IMEI': r.imei,
      'Versão': r.version,
      'Atualizado?': r.atualizado,
      'Última vez online (GMT-3 Brasília)': r.lastime ? dayjs(r.lastime).tz('America/Sao_Paulo').format('DD/MM/YYYY HH:mm:ss') : '-',
      'Online nas últimas 24h?': r.online24h ? 'Sim' : 'Não',
      'MODE': r.mode || '-',
      'Bateria (%)': (() => {
        if (!r.selfCheckParam) return '-';
        const match = r.selfCheckParam.match(/vBat=\d+mV\((\d+)%\)/);
        return match ? match[1] + '%' : '-';
      })()
    }));
    
    const ws = XLSX.utils.json_to_sheet([]);
    XLSX.utils.sheet_add_aoa(ws, [[`Relatório gerado em: ${dataHora} (GMT-3 Brasília)`]], {origin: 'A1'});
    XLSX.utils.sheet_add_aoa(ws, [Object.keys(exportData[0])], {origin: 'A2'});
    XLSX.utils.sheet_add_json(ws, exportData, {origin: 'A3', skipHeader: true});
    ws['!cols'] = [{ wch: 18 }, { wch: 12 }, { wch: 12 }, { wch: 32 }, { wch: 22 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Resultados');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    
    const destinatarios = monitorConfig.email.split(',').map(e => e.trim()).filter(e => e);
    const assunto = alteracao ? 'Alteração de firmware detectada' : 'Nenhuma alteração de firmware';
    const texto = alteracao ? `Houve alteração de firmware em pelo menos um equipamento. Horário de referência: ${dataHora} (GMT-3 Brasília)` : `Nenhuma alteração de firmware detectada. Horário de referência: ${dataHora} (GMT-3 Brasília)`;
    
    for (const dest of destinatarios) {
      await enviarEmailComExcel(dest, assunto, texto, buffer);
      console.log('E-mail enviado para:', dest);
    }
    
    monitorConfig.ultimoRelatorio = results;
    if (!alteracao) {
      console.log('Monitoramento executado, mas nenhuma alteração de firmware detectada.');
    }
  } catch (err) {
    console.error('Erro no monitoramento:', err);
  }
}

// Novo endpoint para envio manual de e-mail
app.post('/api/enviar-email', async (req, res) => {
  try {
    const { destinatario, assunto, texto, results } = req.body;
    if (!destinatario || !assunto || !texto || !Array.isArray(results)) {
      return res.status(400).json({ error: 'Parâmetros obrigatórios ausentes.' });
    }
    const ws = XLSX.utils.json_to_sheet(results);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Resultados');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    await enviarEmailComExcel(destinatario, assunto, texto, buffer);
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
