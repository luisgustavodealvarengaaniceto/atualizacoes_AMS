import { useState, useEffect, useRef } from 'react'
import './App.css'

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
    // Adiciona status de atualização
    const exportData = results.map(r => ({
      ...r,
      atualizado: r.version === versaoAtual ? 'Sim' : 'Não'
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

  // Cálculo para gráfico
  const total = results.length
  const atualizados = results.filter(r => r.version === versaoAtual).length
  const naoAtualizados = total - atualizados

  // Função para extrair porcentagem da bateria de selfCheckParam
  function getBatteryPercent(selfCheckParam) {
    if (!selfCheckParam) return null;
    // Procura por vBat=xxxxmV(XX%)
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

  // Exibe o mode sem tratamento
  function parseMode(modeStr) {
    return modeStr || '-';
  }

  return (
    <div className="container">
      <h1>Consulta de Versão dos Equipamentos 3S</h1>
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
              </tr>
            </thead>
            <tbody>
              {results.map((r, idx) => {
                const percent = getBatteryPercent(r.selfCheckParam);
                const modeDebug = parseMode(r.mode);
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
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ marginTop: 32 }}>
            <h3>Status de Atualização</h3>
            <svg width="320" height="180">
              <rect x="10" y="40" width="120" height="30" fill="#4caf50" />
              <text x="15" y="60" fill="#fff">Atualizados: {atualizados}</text>
              <rect x="10" y="90" width="120" height="30" fill="#f44336" />
              <text x="15" y="110" fill="#fff">Não Atualizados: {naoAtualizados}</text>
            </svg>
            <div style={{ marginTop: 8 }}>
              <b>Total:</b> {total}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
