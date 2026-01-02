const express = require('express');
const https = require('https');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const INTER_API_URL = 'cdpj.partners.bancointer.com.br';

// Certificado e chave em Base64 (vem das env vars)
const INTER_CERTIFICATE_BASE64 = process.env.INTER_CERTIFICATE_BASE64;
const INTER_KEY_BASE64 = process.env.INTER_KEY_BASE64;
const PROXY_SECRET = process.env.PROXY_SECRET || 'default-secret';

// Middleware de autenticação
function authenticate(req, res, next) {
  const authHeader = req.headers['x-proxy-secret'];
  if (authHeader !== PROXY_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Decodificar Base64
function decodeBase64(base64) {
  return Buffer.from(base64, 'base64').toString('utf-8');
}

// Fazer requisição com mTLS
function makeInterRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const cert = decodeBase64(INTER_CERTIFICATE_BASE64);
    const key = decodeBase64(INTER_KEY_BASE64);

    const requestOptions = {
      hostname: INTER_API_URL,
      port: 443,
      path: options.path,
      method: options.method || 'GET',
      headers: options.headers || {},
      cert: cert,
      key: key,
      rejectUnauthorized: true,
    };

    const req = https.request(requestOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data,
        });
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    hasCert: !!INTER_CERTIFICATE_BASE64,
    hasKey: !!INTER_KEY_BASE64 
  });
});

// Obter token OAuth
app.post('/oauth/token', authenticate, async (req, res) => {
  try {
    const { client_id, client_secret, scope } = req.body;

    const params = new URLSearchParams();
    params.append('client_id', client_id);
    params.append('client_secret', client_secret);
    params.append('grant_type', 'client_credentials');
    params.append('scope', scope || 'extrato.read boleto-cobranca.read pix.read pix.write cob.read cob.write');

    const response = await makeInterRequest({
      path: '/oauth/v2/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(params.toString()),
      },
    }, params.toString());

    res.status(response.statusCode).send(response.body);
  } catch (error) {
    console.error('Token error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Obter saldo
app.get('/banking/saldo', authenticate, async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];

    const response = await makeInterRequest({
      path: '/banking/v2/saldo',
      method: 'GET',
      headers: {
        'Authorization': authHeader,
      },
    });

    res.status(response.statusCode).send(response.body);
  } catch (error) {
    console.error('Saldo error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Obter extrato
app.get('/banking/extrato', authenticate, async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const { dataInicio, dataFim } = req.query;

    const response = await makeInterRequest({
      path: `/banking/v2/extrato?dataInicio=${dataInicio}&dataFim=${dataFim}`,
      method: 'GET',
      headers: {
        'Authorization': authHeader,
      },
    });

    res.status(response.statusCode).send(response.body);
  } catch (error) {
    console.error('Extrato error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Criar cobrança PIX
app.put('/pix/cob/:txid', authenticate, async (req, res) => {
  try {
    const { txid } = req.params;
    const authHeader = req.headers['authorization'];
    const body = JSON.stringify(req.body);

    const response = await makeInterRequest({
      path: `/pix/v2/cob/${txid}`,
      method: 'PUT',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, body);

    res.status(response.statusCode).send(response.body);
  } catch (error) {
    console.error('PIX error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Consultar cobrança PIX
app.get('/pix/cob/:txid', authenticate, async (req, res) => {
  try {
    const { txid } = req.params;
    const authHeader = req.headers['authorization'];

    const response = await makeInterRequest({
      path: `/pix/v2/cob/${txid}`,
      method: 'GET',
      headers: {
        'Authorization': authHeader,
      },
    });

    res.status(response.statusCode).send(response.body);
  } catch (error) {
    console.error('PIX query error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Proxy genérico para outras rotas
app.all('/proxy/*', authenticate, async (req, res) => {
  try {
    const path = req.params[0];
    const authHeader = req.headers['authorization'];
    const body = req.method !== 'GET' ? JSON.stringify(req.body) : null;

    const headers = {
      'Authorization': authHeader,
    };

    if (body) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(body);
    }

    const response = await makeInterRequest({
      path: '/' + path,
      method: req.method,
      headers,
    }, body);

    res.status(response.statusCode).send(response.body);
  } catch (error) {
    console.error('Proxy error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Inter Proxy running on port ${PORT}`);
  console.log(`Certificate loaded: ${!!INTER_CERTIFICATE_BASE64}`);
  console.log(`Key loaded: ${!!INTER_KEY_BASE64}`);
});
