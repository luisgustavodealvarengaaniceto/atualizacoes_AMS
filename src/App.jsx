import { useState, useEffect, useRef, useMemo } from 'react'
import './App.css'
import * as XLSX from 'xlsx';

// Função para extrair porcentagem da bateria de selfCheckParam
function getBatteryPercent(selfCheckParam) {
  if (!selfCheckParam) return null;
  const match = selfCheckParam.match(/vBat=\d+mV\((\d+)%\)/);
  return match ? parseInt(match[1], 10) : null;
}

// Componente visual de bateria estilo Flutter
function BatteryIcon({ percent, segmentHeight = 12, segmentWidth = 28 }) {
  const level = percent == null ? 0 : Math.ceil((percent / 100) * 5);
  let color = '#f44336';
  if (percent >= 50) color = '#4caf50';
  else if (percent >= 20) color = '#ffeb3b';
  const borderColor = '#fff';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginRight: 4 }}>
      <div style={{
        width: segmentWidth * 0.5,
        height: segmentHeight * 0.6,
        background: level >= 5 ? color : 'transparent',
        borderTop: `1px solid ${borderColor}`,
        borderRight: `1px solid ${borderColor}`,
        borderLeft: `1px solid ${borderColor}`
      }} />
      <div style={{
        width: segmentWidth,
        height: segmentHeight,
        background: level >= 4 ? color : 'transparent',
        borderRadius: '5px 5px 0 0',
        border: `1px solid ${borderColor}`
      }} />
      <div style={{
        width: segmentWidth,
        height: segmentHeight,
        background: level >= 3 ? color : 'transparent',
        borderBottom: `1px solid ${borderColor}`,
        borderRight: `1px solid ${borderColor}`,
        borderLeft: `1px solid ${borderColor}`
      }} />
      <div style={{
        width: segmentWidth,
        height: segmentHeight,
        background: level >= 2 ? color : 'transparent',
        borderRight: `1px solid ${borderColor}`,
        borderLeft: `1px solid ${borderColor}`
      }} />
      <div style={{
        width: segmentWidth,
        height: segmentHeight,
        background: level >= 1 ? color : 'transparent',
        borderRadius: '0 0 5px 5px',
        border: `1px solid ${borderColor}`
      }} />
    </div>
  );
}

function App() {
  const [imeisText, setImeisText] = useState('')
  const [versaoAtual, setVersaoAtual] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [monitorando, setMonitorando] = useState(false)
  const [monitorStatus, setMonitorStatus] = useState('')
  const monitorandoRef = useRef(false)
  const [emailDestinatario, setEmailDestinatario] = useState('')
  const [emailStatus, setEmailStatus] = useState('')
  const [intervaloMinutos, setIntervaloMinutos] = useState(60)
  const [emailsDestinatarios, setEmailsDestinatarios] = useState('')
  const [tipoAgendamento, setTipoAgendamento] = useState('intervalo')
  const [horariosFixos, setHorariosFixos] = useState('')
  const [status3SMap, setStatus3SMap] = useState({});

  // Checa status do monitoramento ao carregar
  useEffect(() => {
    fetch('http://localhost:3001/api/status-monitoramento')
      .then(r => r.json())
      .then(data => setMonitorando(!!data.monitorando))
  }, [])

  // Função para processar o texto e retornar array de IMEIs únicos
  function parseImeis(text) {
    return Array.from(new Set(
      text
        .replace(/\s+/g, ',')
        .split(',')
        .map(i => i.trim())
        .filter(i => i.length > 0)
    ))
  }

  async function consultar() {
    setError('')
    setResults([])
    const imeis = parseImeis(imeisText)
    if (imeis.length === 0) {
      setError('Insira ao menos um IMEI.')
      return
    }
    setLoading(true)
    try {
      const response = await fetch('http://localhost:3001/api/consultar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imeis })
      })
      const data = await response.json()
      if (data.results) setResults(data.results)
      else setError(data.error || 'Erro desconhecido')
    } catch (e) {
      setError('Erro ao consultar backend.')
    }
    setLoading(false)
  }

  async function exportarExcel() {
    if (results.length === 0 || !versaoAtual) return
    // Adiciona status de atualização e STATUS 3S
    const exportData = results.map(r => ({
      ...r,
      atualizado: r.version === versaoAtual ? 'Sim' : 'Não',
      status3S: status3SMap[r.imei] || '-'
    }))
    const response = await fetch('http://localhost:3001/api/exportar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ results: exportData })
    })
    const blob = await response.blob()
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'resultados.xlsx'
    a.click()
    window.URL.revokeObjectURL(url)
  }

  async function ativarMonitoramento() {
    setMonitorStatus('')
    const imeis = parseImeis(imeisText)
    if (imeis.length === 0 || !versaoAtual) {
      setMonitorStatus('Preencha IMEIs e versão atual para monitorar.')
      return
    }
    const body = {
      imeis,
      versaoAtual,
      email: emailsDestinatarios,
      intervalo: tipoAgendamento === 'intervalo' ? intervaloMinutos : undefined,
      horariosFixos: tipoAgendamento === 'horarios' ? horariosFixos : undefined
    }
    const resp = await fetch('http://localhost:3001/api/monitorar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    if (resp.ok) {
      setMonitorando(true)
      setMonitorStatus('Monitoramento ativado!')
    } else {
      setMonitorStatus('Erro ao ativar monitoramento.')
    }
  }

  async function desativarMonitoramento() {
    setMonitorStatus('')
    const resp = await fetch('http://localhost:3001/api/parar-monitoramento', { method: 'POST' })
    if (resp.ok) {
      setMonitorando(false)
      setMonitorStatus('Monitoramento desativado.')
    } else {
      setMonitorStatus('Erro ao desativar monitoramento.')
    }
  }

  async function enviarEmailManual() {
    setEmailStatus('')
    if (!emailDestinatario || results.length === 0) {
      setEmailStatus('Preencha o destinatário e gere resultados antes de enviar.')
      return
    }
    try {
      const assunto = 'Relatório manual';
      const texto = 'Segue em anexo o relatório sobre a atualização dos equipamentos da 3S.';
      const resp = await fetch('http://localhost:3001/api/enviar-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destinatario: emailDestinatario, assunto, texto, results })
      })
      if (resp.ok) setEmailStatus('E-mail enviado com sucesso!')
      else setEmailStatus('Erro ao enviar e-mail.')
    } catch {
      setEmailStatus('Erro ao enviar e-mail.')
    }
  }

  // Indicadores para visão tática
  const total = results.length;
  const atualizados = results.filter(r => r.version === versaoAtual).length;
  const naoAtualizados = total - atualizados;
  const online24h = results.filter(r => r.online24h).length;
  const bateriaDistribuicao = useMemo(() => {
    // Faixas: 0-19, 20-39, 40-59, 60-79, 80-100
    const faixas = [0, 0, 0, 0, 0];
    results.forEach(r => {
      const p = getBatteryPercent(r.selfCheckParam);
      if (p === null) return;
      if (p < 20) faixas[0]++;
      else if (p < 40) faixas[1]++;
      else if (p < 60) faixas[2]++;
      else if (p < 80) faixas[3]++;
      else faixas[4]++;
    });
    return faixas;
  }, [results]);
  const mediaBateria = results.length > 0 ? Math.round(results.map(r => getBatteryPercent(r.selfCheckParam) || 0).reduce((a, b) => a + b, 0) / results.length) : 0;

  // Função para gerar cores para pizza
  const pizzaColors = ['#f44336', '#ff9800', '#ffeb3b', '#8bc34a', '#2196f3'];
  const pizzaLabels = ['0-19%', '20-39%', '40-59%', '60-79%', '80-100%'];
  function getPieSegments(data) {
    const sum = data.reduce((a, b) => a + b, 0);
    let acc = 0;
    return data.map((val, i) => {
      const start = acc / sum;
      acc += val;
      const end = acc / sum;
      return { start, end, color: pizzaColors[i], label: pizzaLabels[i], value: val };
    });
  }
  function describeArc(cx, cy, r, start, end) {
    const startAngle = 2 * Math.PI * start - Math.PI / 2;
    const endAngle = 2 * Math.PI * end - Math.PI / 2;
    const x1 = cx + r * Math.cos(startAngle);
    const y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle);
    const y2 = cy + r * Math.sin(endAngle);
    const largeArc = end - start > 0.5 ? 1 : 0;
    return `M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${largeArc} 1 ${x2},${y2} Z`;
  }

  // Função para gráfico de pizza profissional (com borda, sombra e legenda)
  function PieChart({ segments, cx, cy, r, legend, centerLabel, centerValue }) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <svg width={cx * 2} height={cy * 2} style={{ filter: 'drop-shadow(0 2px 8px #0008)' }}>
          <circle cx={cx} cy={cy} r={r} fill="#222" />
          {segments.map((seg, i) => (
            seg.value > 0 && (
              <path key={i} d={describeArc(cx, cy, r, seg.start, seg.end)} fill={seg.color} stroke="#fff" strokeWidth="2" />
            )
          ))}
          {/* Números em cada fatia */}
          {segments.map((seg, i) => {
            if (seg.value === 0) return null;
            const angle = 2 * Math.PI * (seg.start + (seg.end - seg.start) / 2) - Math.PI / 2;
            const x = cx + (r - 25) * Math.cos(angle);
            const y = cy + (r - 25) * Math.sin(angle);
            return (
              <text key={i} x={x} y={y} fill="#222" fontSize="16" textAnchor="middle" dominantBaseline="middle" fontWeight="bold">{seg.value}</text>
            );
          })}
          {/* Label central */}
          {centerLabel && (
            <text x={cx} y={cy - 8} fill="#fff" fontSize="16" textAnchor="middle">{centerLabel}</text>
          )}
          {centerValue && (
            <text x={cx} y={cy + 16} fill="#fff" fontSize="22" textAnchor="middle" fontWeight="bold">{centerValue}</text>
          )}
        </svg>
        {legend && (
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
            {segments.map((seg, i) => seg.value > 0 && (
              <span key={i} style={{ color: seg.color, fontSize: 13, background: '#111', borderRadius: 4, padding: '2px 8px', border: `1px solid ${seg.color}` }}>{seg.label}</span>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Dados para gráficos de pizza
  const statusAtualizacaoSegments = [
    { value: atualizados, color: '#4caf50', label: 'Atualizados', start: 0, end: total ? atualizados/total : 0 },
    { value: naoAtualizados, color: '#f44336', label: 'Não Atualizados', start: total ? atualizados/total : 0, end: 1 }
  ];
  const onlineSegments = [
    { value: online24h, color: '#2196f3', label: 'Online 24h', start: 0, end: total ? online24h/total : 0 },
    { value: total - online24h, color: '#888', label: 'Offline', start: total ? online24h/total : 0, end: 1 }
  ];
  const bateriaSegments = getPieSegments(bateriaDistribuicao);

  // Função para exibir o mode sem tratamento
  function parseMode(modeStr) {
    return modeStr || '-';
  }

  // Função para processar upload do Excel
  function handleExcelUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const data = new Uint8Array(evt.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const sheet = workbook.Sheets['Não atualizado'];
      if (!sheet) return alert('Aba "Não atualizado" não encontrada!');
      const json = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      if (!json.length) return alert('Planilha vazia!');
      // Procura colunas
      const header = json[0];
      const imeiIdx = header.findIndex(h => h && h.toString().toUpperCase().includes('IMEI'));
      const statusIdx = header.findIndex(h => h && h.toString().toUpperCase().includes('STATUS 3S'));
      if (imeiIdx === -1 || statusIdx === -1) return alert('Colunas IMEI ou STATUS 3S não encontradas!');
      const map = {};
      for (let i = 1; i < json.length; i++) {
        const row = json[i];
        const imei = row[imeiIdx]?.toString().trim();
        const status = row[statusIdx]?.toString().trim();
        if (imei && status) map[imei] = status;
      }
      setStatus3SMap(map);
      alert('Status 3S importado com sucesso!');
    };
    reader.readAsArrayBuffer(file);
  }

  return (
    <div className="container">
      {/* Visão Tática só aparece se houver dados */}
      {results.length > 0 && (
        <div style={{ background: '#222', color: '#fff', padding: 20, borderRadius: 8, marginBottom: 24 }}>
          <h2 style={{ marginTop: 0, textAlign: 'center' }}>Visão Tática</h2>
          <div style={{ display: 'flex', gap: 48, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center' }}>
            {/* Pizza de Status de Atualização */}
            <div style={{ textAlign: 'center' }}>
              <b>Status de Atualização</b>
              <PieChart segments={statusAtualizacaoSegments} cx={80} cy={80} r={65} legend centerLabel="Atualizados" centerValue={atualizados + '/' + total} />
            </div>
            {/* Pizza de Online 24h */}
            <div style={{ textAlign: 'center' }}>
              <b>Online 24h</b>
              <PieChart segments={onlineSegments} cx={80} cy={80} r={65} legend centerLabel="Online" centerValue={online24h + '/' + total} />
            </div>
            {/* Pizza de Distribuição da Bateria */}
            <div style={{ textAlign: 'center' }}>
              <b>Distribuição da Bateria</b>
              <PieChart segments={bateriaSegments} cx={90} cy={90} r={75} legend />
            </div>
            {/* Média da Bateria */}
            <div style={{ textAlign: 'center' }}>
              <b>Média da Bateria</b>
              <div style={{ display: 'flex', alignItems: 'center', fontSize: 24, marginTop: 8, justifyContent: 'center' }}>
                <BatteryIcon percent={mediaBateria} />
                <span style={{ marginLeft: 8 }}>{mediaBateria > 0 ? mediaBateria + '%' : '-'}</span>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Visão Operacional */}
      <h2 style={{ marginTop: 0 }}>Visão Operacional</h2>
      <textarea
        rows={6}
        placeholder="Cole os IMEIs aqui, um por linha ou separados por vírgula"
        value={imeisText}
        onChange={e => setImeisText(e.target.value)}
        style={{ width: '100%', marginBottom: 12 }}
      />
      <input
        type="text"
        placeholder="Digite a versão atual (obrigatório para exportar)"
        value={versaoAtual}
        onChange={e => setVersaoAtual(e.target.value)}
        style={{ width: '100%', marginBottom: 12, padding: 8 }}
      />
      <input
        type="email"
        placeholder="E-mail do destinatário para envio manual"
        value={emailDestinatario}
        onChange={e => setEmailDestinatario(e.target.value)}
        style={{ width: '100%', marginBottom: 12, padding: 8 }}
      />
      <div style={{ marginBottom: 12 }}>
        <label>
          <input type="radio" name="tipoAgendamento" value="intervalo" checked={tipoAgendamento === 'intervalo'} onChange={() => setTipoAgendamento('intervalo')} /> Intervalo em minutos
        </label>
        <label style={{ marginLeft: 16 }}>
          <input type="radio" name="tipoAgendamento" value="horarios" checked={tipoAgendamento === 'horarios'} onChange={() => setTipoAgendamento('horarios')} /> Horários fixos do dia
        </label>
      </div>
      {tipoAgendamento === 'intervalo' ? (
        <input
          type="number"
          min={1}
          placeholder="Intervalo do envio automático (minutos)"
          value={intervaloMinutos}
          onChange={e => setIntervaloMinutos(Number(e.target.value))}
          style={{ width: '100%', marginBottom: 12, padding: 8 }}
        />
      ) : (
        <input
          type="text"
          placeholder="Horários fixos (ex: 08:00,18:00)"
          value={horariosFixos}
          onChange={e => setHorariosFixos(e.target.value)}
          style={{ width: '100%', marginBottom: 12, padding: 8 }}
        />
      )}
      <input
        type="text"
        placeholder="E-mails destinatários (separados por vírgula)"
        value={emailsDestinatarios}
        onChange={e => setEmailsDestinatarios(e.target.value)}
        style={{ width: '100%', marginBottom: 12, padding: 8 }}
      />
      <div>
        <button onClick={consultar} disabled={loading} style={{ marginRight: 8 }}>
          {loading ? 'Consultando...' : 'Consultar'}
        </button>
        <button onClick={exportarExcel} disabled={results.length === 0 || !versaoAtual}>
          Exportar Excel
        </button>
      </div>
      <div style={{ marginBottom: 16 }}>
        {monitorando ? (
          <button onClick={desativarMonitoramento} style={{ background: '#f44336', color: '#fff', marginRight: 8 }}>
            Parar Monitoramento
          </button>
        ) : (
          <button onClick={ativarMonitoramento} style={{ background: '#4caf50', color: '#fff', marginRight: 8 }}>
            Ativar Monitoramento
          </button>
        )}
        {monitorStatus && <span style={{ marginLeft: 8 }}>{monitorStatus}</span>}
      </div>
      <button onClick={enviarEmailManual} disabled={results.length === 0 || !emailDestinatario} style={{ marginBottom: 8 }}>
        Enviar E-mail Manual
      </button>
      {emailStatus && <div style={{ color: emailStatus.includes('sucesso') ? 'green' : 'red', marginBottom: 8 }}>{emailStatus}</div>}
      {error && <div style={{ color: 'red', marginTop: 12 }}>{error}</div>}
      {results.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ border: '1px solid #ccc', padding: 8 }}>IMEI</th>
                <th style={{ border: '1px solid #ccc', padding: 8 }}>Versão</th>
                <th style={{ border: '1px solid #ccc', padding: 8 }}>Atualizado?</th>
                <th style={{ border: '1px solid #ccc', padding: 8 }}>Última vez online</th>
                <th style={{ border: '1px solid #ccc', padding: 8 }}>Online nas últimas 24h?</th>
                <th style={{ border: '1px solid #ccc', padding: 8 }}>MODE</th>
                <th style={{ border: '1px solid #ccc', padding: 8 }}>Bateria</th>
                <th style={{ border: '1px solid #ccc', padding: 8 }}>STATUS 3S</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, idx) => {
                const percent = getBatteryPercent(r.selfCheckParam);
                const modeDebug = parseMode(r.mode);
                const status3S = status3SMap[r.imei] || '-';
                return (
                  <tr key={r.imei + idx}>
                    <td style={{ border: '1px solid #ccc', padding: 8 }}>{r.imei}</td>
                    <td style={{ border: '1px solid #ccc', padding: 8 }}>{r.version}</td>
                    <td style={{ border: '1px solid #ccc', padding: 8 }}>{versaoAtual && r.version === versaoAtual ? 'Sim' : 'Não'}</td>
                    <td style={{ border: '1px solid #ccc', padding: 8 }}>{r.lastime ? new Date(r.lastime).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) + ' (GMT-3 Brasília)' : '-'}</td>
                    <td style={{ border: '1px solid #ccc', padding: 8 }}>{r.online24h ? 'Sim' : 'Não'}</td>
                    <td style={{ border: '1px solid #ccc', padding: 8 }}>{modeDebug}</td>
                    <td style={{ border: '1px solid #ccc', padding: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center' }}>
                        <BatteryIcon percent={percent} />
                        {percent !== null ? percent + '%' : '-'}
                      </div>
                    </td>
                    <td style={{ border: '1px solid #ccc', padding: 8 }}>{status3S}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {/* Botão de upload do Excel para STATUS 3S */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ background: '#1976d2', color: '#fff', padding: '8px 16px', borderRadius: 4, cursor: 'pointer' }}>
          Importar STATUS 3S (Excel)
          <input type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={handleExcelUpload} />
        </label>
      </div>
    </div>
  )
}

export default App
