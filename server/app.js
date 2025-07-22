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
app.use(express.json({ limit: '20mb' }));

const API_URL = 'http://fota-api.jimicloud.com';
const APP_KEY = 'Jimiiotbrasil';
const SECRET = '23dd6cca658b4ec298aeb7beb4972fd4';

// Configuração do agente HTTP para desabilitar keep-alive (conforme análise)
const httpAgent = new (require('http')).Agent({ keepAlive: false });
const httpsAgent = new (require('https')).Agent({ keepAlive: false });

// Função para delay entre requisições
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Cache do token com controle de TTL
let tokenCache = null;
let tokenExpiry = 0;

// Função para obter o token com renovação automática
async function getToken() {
  const now = Date.now();
  
  // Verifica se token em cache ainda é válido (renova 5 min antes de expirar)
  if (tokenCache && now < (tokenExpiry - 5 * 60 * 1000)) {
    console.log('🔑 [getToken] Usando token em cache (válido por mais', Math.round((tokenExpiry - now) / 60000), 'min)');
    return tokenCache;
  }
  
  console.log('🔑 [getToken] Renovando token...');
  
  try {
    const response = await axios.post(`${API_URL}/token`, {
      appKey: APP_KEY,
      secret: SECRET
    }, {
      httpAgent,
      httpsAgent,
      timeout: 10000
    });
    
    tokenCache = response.data.data.token;
    // Assume TTL de 1 hora (3600s) se não informado
    tokenExpiry = now + (60 * 60 * 1000);
    
    console.log('✅ [getToken] Token renovado com sucesso!');
    console.log(`   • Token: ${tokenCache.substring(0, 20)}...`);
    console.log(`   • Válido até: ${new Date(tokenExpiry).toLocaleString()}`);
    
    return tokenCache;
  } catch (error) {
    console.error('❌ [getToken] Erro ao renovar token:', error.message);
    // Limpa cache em caso de erro
    tokenCache = null;
    tokenExpiry = 0;
    throw error;
  }
}

// Função para buscar status dos dispositivos com melhorias de diagnóstico
async function queryDeviceStatus(token, imeiList) {
  console.log(`🔍 [queryDeviceStatus] Iniciando consulta:`);
  console.log(`   • Token: ${token.substring(0, 20)}...`);
  console.log(`   • Quantidade de IMEIs: ${imeiList.length}`);
  console.log(`   • Primeiros 3 IMEIs: [${imeiList.slice(0, 3).join(', ')}]`);
  
  const payload = { imeiList };
  const payloadSize = JSON.stringify(payload).length;
  console.log(`   • Tamanho do payload: ${payloadSize} bytes`);
  
  // Validação preventiva
  if (imeiList.length > 50) {
    console.log(`⚠️  [queryDeviceStatus] AVISO: ${imeiList.length} IMEIs > limite recomendado (50)`);
  }
  
  try {
    const response = await axios.post(
      `${API_URL}/queryDeviceStatus`,
      payload,
      { 
        headers: { Authorization: token },
        httpAgent,
        httpsAgent,
        timeout: 15000, // Aumentado para 15s
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      }
    );
    
    console.log(`✅ [queryDeviceStatus] Sucesso!`);
    console.log(`   • Status HTTP: ${response.status}`);
    console.log(`   • Code da API: ${response.data.code || 'N/A'}`);
    console.log(`   • Message da API: ${response.data.msg || 'N/A'}`);
    console.log(`   • Dados retornados: ${response.data.data?.length || 0} dispositivos`);
    
    // Log da resposta completa para diagnóstico
    console.log(`   • Resposta completa da API:`, JSON.stringify(response.data, null, 2));
    
    // Valida resposta da API
    if (response.data.code !== 0) {
      console.log(`⚠️  [queryDeviceStatus] Code ≠ 0: ${response.data.code} - ${response.data.msg}`);
      console.log(`   • Possíveis causas para code ≠ 0:`);
      console.log(`     - IMEIs não pertencentes a esta organização/conta`);
      console.log(`     - Token inválido ou expirado`);
      console.log(`     - Permissões insuficientes`);
      console.log(`     - IMEIs não existem no sistema`);
    }
    
    // Análise específica quando retorna 0 dispositivos
    if (!response.data.data || response.data.data.length === 0) {
      console.log(`🔍 [DIAGNÓSTICO - 0 DISPOSITIVOS RETORNADOS]:`);
      console.log(`   • IMEIs consultados: [${imeiList.join(', ')}]`);
      console.log(`   • Possíveis causas:`);
      console.log(`     - IMEIs não cadastrados nesta conta/organização`);
      console.log(`     - IMEIs com formato inválido`);
      console.log(`     - Conta sem permissão para estes dispositivos`);
      console.log(`     - Dispositivos não ativados no sistema Jimi`);
      console.log(`   • Recomendação: Verificar se os IMEIs estão corretos e pertencem à conta`);
    }
    
    return response.data.data;
  } catch (error) {
    console.log(`❌ [queryDeviceStatus] ERRO DETALHADO:`);
    console.log(`   • Status HTTP: ${error.response?.status || 'N/A'}`);
    console.log(`   • Código da API: ${error.response?.data?.code || 'N/A'}`);
    console.log(`   • Mensagem da API: ${error.response?.data?.msg || 'N/A'}`);
    console.log(`   • URL chamada: ${API_URL}/queryDeviceStatus`);
    console.log(`   • Payload size: ${payloadSize} bytes`);
    
    // Headers de resposta para diagnóstico
    if (error.response?.headers) {
      console.log(`   • Content-Type: ${error.response.headers['content-type'] || 'N/A'}`);
      console.log(`   • Content-Length: ${error.response.headers['content-length'] || 'N/A'}`);
    }
    
    // Análise específica do erro 1003
    if (error.response?.data?.code === 1003) {
      console.log(`🚨 [ANÁLISE ERRO 1003 - Internal Server Error]:`);
      console.log(`   • Causa provável: Limite de IMEIs excedido (atual: ${imeiList.length})`);
      console.log(`   • Documentação Jimi mostra exemplos com máximo 2 IMEIs`);
      console.log(`   • Limite real estimado: 20-50 IMEIs por requisição`);
      console.log(`   • Recomendação: Reduzir batch size drasticamente`);
      console.log(`   • Ação: Sistema vai tentar com lotes menores automaticamente`);
    }
    
    // Análise de outros erros HTTP 500
    if (error.response?.status === 500) {
      console.log(`🚨 [ANÁLISE ERRO 500 - Internal Server Error]:`);
      console.log(`   • Servidor Jimi falhou ao processar a requisição`);
      console.log(`   • Possíveis causas:`);
      console.log(`     - Lote de IMEIs muito grande (> 50)`);
      console.log(`     - Token expirado ou inválido`);
      console.log(`     - IMEIs inválidos ou não pertencentes à organização`);
      console.log(`     - Sobrecarga temporária do servidor`);
      console.log(`     - Problema de keep-alive/socket (já desabilitado)`);
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
    for (let i = 0; i < imeis.length; i += 50) {
      const loteIndex = Math.floor(i / 50) + 1;
      const totalLotes = Math.ceil(imeis.length / 50);
      const lote = imeis.slice(i, i + 50);
      
      console.log(`\n📦 ===== LOTE ${loteIndex}/${totalLotes} (LIMITE 50 IMEIs) =====`);
      console.log(`📋 IMEIs neste lote: ${lote.length}`);
      console.log(`🎯 Primeiros 3 IMEIs: [${lote.slice(0, 3).join(', ')}]`);
      console.log(`⏰ Iniciando às ${new Date().toLocaleTimeString()}`);
      console.log(`📊 Progresso: ${i}/${imeis.length} IMEIs processados (${Math.round(i/imeis.length*100)}%)`);
      console.log(`🔧 Baseado na análise: Limite conservador de 50 IMEIs por requisição`);
      try {
        // Renova token se necessário antes de cada lote
        const freshToken = await getToken();
        const data = await queryDeviceStatus(freshToken, lote);
        
        console.log(`✅ Lote ${loteIndex} processado com sucesso! ${data?.length || 0} dispositivos retornados.`);
        
        for (const device of data || []) {
          results.push({
            imei: device.imei,
            version: extractVersion(device),
            lastime: device.lastime || device.lastTime || '',
            online24h: isOnlineUltimas24h(device.lastime || device.lastTime || ''),
            atualizado: versaoAtual ? (extractVersion(device) === versaoAtual ? 'Sim' : 'Não') : '',
            mode: device.mode,
            selfCheckParam: device.selfCheckParam
          });
        }
        
      } catch (loteErr) {
        console.error(`❌ ERRO no lote ${loteIndex}:`, loteErr.message);
        
        // Se for erro 1003, vamos tentar reduzir ainda mais o lote
        if (loteErr.response?.data?.code === 1003 && lote.length > 10) {
          console.log(`🔄 Erro 1003 com ${lote.length} IMEIs. Tentando dividir em sublotes de 10...`);
          
          // Divide o lote atual em sublotes de 10
          for (let j = 0; j < lote.length; j += 10) {
            const sublote = lote.slice(j, j + 10);
            const subloteIndex = Math.floor(j / 10) + 1;
            const totalSublotes = Math.ceil(lote.length / 10);
            
            console.log(`   📦 Sublote ${subloteIndex}/${totalSublotes} (${sublote.length} IMEIs)`);
            
            try {
              await sleep(5000); // Delay entre sublotes
              const freshToken = await getToken();
              const subloteData = await queryDeviceStatus(freshToken, sublote);
              
              for (const device of subloteData || []) {
                results.push({
                  imei: device.imei,
                  version: extractVersion(device),
                  lastime: device.lastime || device.lastTime || '',
                  online24h: isOnlineUltimas24h(device.lastime || device.lastTime || ''),
                  atualizado: versaoAtual ? (extractVersion(device) === versaoAtual ? 'Sim' : 'Não') : '',
                  mode: device.mode,
                  selfCheckParam: device.selfCheckParam
                });
              }
              console.log(`   ✅ Sublote ${subloteIndex} processado com sucesso!`);
              
            } catch (subloteErr) {
              console.error(`   ❌ Erro no sublote ${subloteIndex}:`, subloteErr.message);
              
              // Tentar IMEI por IMEI quando sublote falha
              console.log(`   🔄 Tentando IMEIs individuais no sublote ${subloteIndex}...`);
              const imeisFalharam = [];
              
              for (const imei of sublote) {
                try {
                  await sleep(2000); // Delay entre IMEIs individuais
                  const freshToken = await getToken();
                  const imeiData = await queryDeviceStatus(freshToken, [imei]);
                  
                  if (imeiData && imeiData.length > 0) {
                    const device = imeiData[0];
                    results.push({
                      imei: device.imei,
                      version: extractVersion(device),
                      lastime: device.lastime || device.lastTime || '',
                      online24h: isOnlineUltimas24h(device.lastime || device.lastTime || ''),
                      atualizado: versaoAtual ? (extractVersion(device) === versaoAtual ? 'Sim' : 'Não') : '',
                      mode: device.mode,
                      selfCheckParam: device.selfCheckParam
                    });
                    console.log(`     ✅ IMEI ${imei} consultado individualmente com sucesso!`);
                  } else {
                    console.log(`     ⚠️ IMEI ${imei} retornou 0 dispositivos`);
                    imeisFalharam.push(imei);
                  }
                } catch (imeiErr) {
                  console.error(`     ❌ IMEI ${imei} falhou:`, imeiErr.message);
                  imeisFalharam.push(imei);
                }
              }
              
              if (imeisFalharam.length > 0) {
                console.log(`   🚨 IMEIs que falharam no sublote ${subloteIndex}:`, imeisFalharam);
                // Armazena os IMEIs que falharam para retornar no final
                if (!results.imeisFalharam) results.imeisFalharam = [];
                results.imeisFalharam.push(...imeisFalharam);
              }
            }
          }
        } else if (lote.length <= 10) {
          // Se o lote já é pequeno (≤10), tenta IMEI por IMEI
          console.log(`🔄 Lote pequeno (${lote.length} IMEIs) falhou. Tentando IMEIs individuais...`);
          const imeisFalharam = [];
          
          for (const imei of lote) {
            try {
              await sleep(2000); // Delay entre IMEIs individuais
              const freshToken = await getToken();
              const imeiData = await queryDeviceStatus(freshToken, [imei]);
              
              if (imeiData && imeiData.length > 0) {
                const device = imeiData[0];
                results.push({
                  imei: device.imei,
                  version: extractVersion(device),
                  lastime: device.lastime || device.lastTime || '',
                  online24h: isOnlineUltimas24h(device.lastime || device.lastTime || ''),
                  atualizado: versaoAtual ? (extractVersion(device) === versaoAtual ? 'Sim' : 'Não') : '',
                  mode: device.mode,
                  selfCheckParam: device.selfCheckParam
                });
                console.log(`   ✅ IMEI ${imei} consultado individualmente com sucesso!`);
              } else {
                console.log(`   ⚠️ IMEI ${imei} retornou 0 dispositivos`);
                imeisFalharam.push(imei);
              }
            } catch (imeiErr) {
              console.error(`   ❌ IMEI ${imei} falhou:`, imeiErr.message);
              imeisFalharam.push(imei);
            }
          }
          
          if (imeisFalharam.length > 0) {
            console.log(`🚨 IMEIs que falharam no lote ${loteIndex}:`, imeisFalharam);
            // Armazena os IMEIs que falharam para retornar no final
            if (!results.imeisFalharam) results.imeisFalharam = [];
            results.imeisFalharam.push(...imeisFalharam);
          }
        } else {
          // Outros erros com lotes grandes
          console.log(`💀 Lote ${loteIndex} marcado como ERRO (${lote.length} IMEIs)`);
          results.push(...lote.map(imei => ({ imei, version: 'ERRO' })));
        }
      }
      
      // Delay mais longo entre lotes principais
      if (loteIndex < totalLotes) {
        console.log(`⏳ Aguardando 15 segundos antes do próximo lote (para desafogar API)...`);
        await sleep(15000);
        console.log(`✅ Delay concluído. Iniciando lote ${loteIndex + 1}...`);
      }
    }
    
    // Prepara resposta final com IMEIs que falharam
    const resposta = { results };
    
    // Se houver IMEIs que falharam, adiciona à resposta
    if (results.imeisFalharam && results.imeisFalharam.length > 0) {
      resposta.imeisFalharam = results.imeisFalharam;
      console.log(`\n🚨 ===== RESUMO FINAL =====`);
      console.log(`✅ IMEIs processados com sucesso: ${results.length - results.imeisFalharam.length}`);
      console.log(`❌ IMEIs que falharam: ${results.imeisFalharam.length}`);
      console.log(`📋 Lista de IMEIs que falharam:`);
      results.imeisFalharam.forEach((imei, index) => {
        console.log(`   ${index + 1}. ${imei}`);
      });
      console.log(`========================\n`);
      
      // Remove a propriedade imeisFalharam do array results
      delete results.imeisFalharam;
    } else {
      console.log(`\n🎉 ===== SUCESSO TOTAL =====`);
      console.log(`✅ Todos os ${results.length} IMEIs foram processados com sucesso!`);
      console.log(`❌ Nenhum IMEI falhou na verificação`);
      console.log(`==========================\n`);
    }
    
    res.json(resposta);
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
    for (let i = 0; i < monitorConfig.imeis.length; i += 50) {
      const lote = monitorConfig.imeis.slice(i, i + 50);
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
