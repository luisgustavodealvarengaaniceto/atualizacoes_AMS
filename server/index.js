// Backend Express básico para autenticação e consulta de IMEIs
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(bodyParser.json());

// Rotas serão implementadas aqui
app.get('/', (req, res) => {
  res.send('API AMS Backend rodando!');
});

app.listen(PORT, () => {
  console.log(`Servidor backend rodando na porta ${PORT}`);
});
