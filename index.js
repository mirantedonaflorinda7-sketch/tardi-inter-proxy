const express = require('express');
const https = require('https');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const INTER_API_URL = 'cdpj.partners.bancointer.com.br';
// INTEGRAÇÃO DIRETA: usar SEMPRE matls-clients (mTLS obrigatório)
// NUNCA usar api.cora.com.br (isso é API de parceiro)
const CORA_API_STAGE = 'matls-clients.api.stage.cora.com.br';
const CORA_API_PROD = 'matls-clients.api.cora.com.br';

// Certificado e chave em Base64 (vem das env vars)
// Inter
const INTER_CERTIFICATE_BASE64 = process.env.INTER_CERTIFICATE_BASE64;
const INTER_KEY_BASE64 = process.env.INTER_KEY_BASE64;
// Cora
const CORA_CERT_BASE64 = process.env.CORA_CERT_BASE64;
const CORA_KEY_BASE64 = process.env.CORA_KEY_BASE64;

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

// Fazer requisição com mTLS para Cora
function makeCoraRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const cert = decodeBase64(CORA_CERT_BASE64);
    const key = decodeBase64(CORA_KEY_BASE64);

    const requestOptions = {
      hostname: options.hostname || CORA_API_PROD,
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
    inter: {
      hasCert: !!INTER_CERTIFICATE_BASE64,
      hasKey: !!INTER_KEY_BASE64,
    },
    cora: {
      hasCert: !!CORA_CERT_BASE64,
      hasKey: !!CORA_KEY_BASE64,
    }
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

// Emitir boleto
app.post('/banking/boleto', authenticate, async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const body = JSON.stringify(req.body);

    const response = await makeInterRequest({
      path: '/cobranca/v3/cobrancas',
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, body);

    res.status(response.statusCode).send(response.body);
  } catch (error) {
    console.error('Boleto error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Consultar boletos
app.get('/banking/boletos', authenticate, async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const { dataInicial, dataFinal, situacao } = req.query;

    let path = `/cobranca/v3/cobrancas?dataInicial=${dataInicial}&dataFinal=${dataFinal}`;
    if (situacao) path += `&situacao=${situacao}`;

    const response = await makeInterRequest({
      path,
      method: 'GET',
      headers: {
        'Authorization': authHeader,
      },
    });

    res.status(response.statusCode).send(response.body);
  } catch (error) {
    console.error('Boletos list error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Consultar boleto específico
app.get('/banking/boleto/:codigoSolicitacao', authenticate, async (req, res) => {
  try {
    const { codigoSolicitacao } = req.params;
    const authHeader = req.headers['authorization'];

    const response = await makeInterRequest({
      path: `/cobranca/v3/cobrancas/${codigoSolicitacao}`,
      method: 'GET',
      headers: {
        'Authorization': authHeader,
      },
    });

    res.status(response.statusCode).send(response.body);
  } catch (error) {
    console.error('Boleto detail error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Cancelar boleto
app.post('/banking/boleto/:codigoSolicitacao/cancelar', authenticate, async (req, res) => {
  try {
    const { codigoSolicitacao } = req.params;
    const authHeader = req.headers['authorization'];
    const body = JSON.stringify(req.body);

    const response = await makeInterRequest({
      path: `/cobranca/v3/cobrancas/${codigoSolicitacao}/cancelar`,
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, body);

    res.status(response.statusCode).send(response.body);
  } catch (error) {
    console.error('Boleto cancel error:', error.message);
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

// Proxy genérico para outras rotas Inter
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

// =============================================
// CORA ROUTES
// =============================================

// Cora OAuth Token
app.post('/cora/oauth/token', authenticate, async (req, res) => {
  try {
    const { client_id, environment, scope } = req.body;
    const host = environment === 'production' ? CORA_API_PROD : CORA_API_STAGE;
    
    // Incluir scope se fornecido (ex: 'account' para saldo/extrato)
    let body = `grant_type=client_credentials&client_id=${client_id}`;
    if (scope) {
      body += `&scope=${encodeURIComponent(scope)}`;
    }

    console.log('Cora token request:', { host, scope, bodyLength: body.length });

    const response = await makeCoraRequest({
      hostname: host,
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    }, body);

    console.log('Cora token response:', response.statusCode);
    res.status(response.statusCode).send(response.body);
  } catch (error) {
    console.error('Cora token error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Cora - Emitir boleto
app.post('/cora/invoices', authenticate, async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const environment = req.headers['x-environment'] || 'production';
    const host = environment === 'production' ? CORA_API_PROD : CORA_API_STAGE;
    const body = JSON.stringify(req.body);

    const response = await makeCoraRequest({
      hostname: host,
      path: '/invoices',
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, body);

    res.status(response.statusCode).send(response.body);
  } catch (error) {
    console.error('Cora invoice create error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Cora - Listar boletos
app.get('/cora/invoices', authenticate, async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const environment = req.headers['x-environment'] || 'production';
    const host = environment === 'production' ? CORA_API_PROD : CORA_API_STAGE;
    
    const queryParams = new URLSearchParams(req.query).toString();
    const path = queryParams ? `/invoices?${queryParams}` : '/invoices';

    const response = await makeCoraRequest({
      hostname: host,
      path,
      method: 'GET',
      headers: {
        'Authorization': authHeader,
      },
    });

    res.status(response.statusCode).send(response.body);
  } catch (error) {
    console.error('Cora invoice list error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Cora - Consultar boleto específico
app.get('/cora/invoices/:invoiceId', authenticate, async (req, res) => {
  try {
    const { invoiceId } = req.params;
    const authHeader = req.headers['authorization'];
    const environment = req.headers['x-environment'] || 'production';
    const host = environment === 'production' ? CORA_API_PROD : CORA_API_STAGE;

    const response = await makeCoraRequest({
      hostname: host,
      path: `/invoices/${invoiceId}`,
      method: 'GET',
      headers: {
        'Authorization': authHeader,
      },
    });

    res.status(response.statusCode).send(response.body);
  } catch (error) {
    console.error('Cora invoice detail error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Cora - Consultar saldo
app.get('/cora/balance/:businessId', authenticate, async (req, res) => {
  try {
    const { businessId } = req.params;
    const authHeader = req.headers['authorization'];
    const environment = req.headers['x-environment'] || 'production';
    const host = environment === 'production' ? CORA_API_PROD : CORA_API_STAGE;

    const response = await makeCoraRequest({
      hostname: host,
      path: `/businesses/${businessId}/balance`,
      method: 'GET',
      headers: {
        'Authorization': authHeader,
      },
    });

    res.status(response.statusCode).send(response.body);
  } catch (error) {
    console.error('Cora balance error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Cora - Consultar extrato
app.get('/cora/statements/:businessId', authenticate, async (req, res) => {
  try {
    const { businessId } = req.params;
    const authHeader = req.headers['authorization'];
    const environment = req.headers['x-environment'] || 'production';
    const host = environment === 'production' ? CORA_API_PROD : CORA_API_STAGE;
    
    const queryParams = new URLSearchParams(req.query).toString();
    const path = queryParams 
      ? `/businesses/${businessId}/statements?${queryParams}` 
      : `/businesses/${businessId}/statements`;

    const response = await makeCoraRequest({
      hostname: host,
      path,
      method: 'GET',
      headers: {
        'Authorization': authHeader,
      },
    });

    res.status(response.statusCode).send(response.body);
  } catch (error) {
    console.error('Cora statement error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Cora - Cancelar boleto
app.delete('/cora/invoices/:invoiceId', authenticate, async (req, res) => {
  try {
    const { invoiceId } = req.params;
    const authHeader = req.headers['authorization'];
    const environment = req.headers['x-environment'] || 'production';
    const host = environment === 'production' ? CORA_API_PROD : CORA_API_STAGE;

    const response = await makeCoraRequest({
      hostname: host,
      path: `/invoices/${invoiceId}`,
      method: 'DELETE',
      headers: {
        'Authorization': authHeader,
      },
    });

    res.status(response.statusCode).send(response.body);
  } catch (error) {
    console.error('Cora invoice cancel error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Cora - Consultar extrato (Integração Direta: mTLS + /bank-statement/statement)
app.get('/cora/statements', authenticate, async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const environment = req.headers['x-environment'] || 'production';
    // Integração Direta: usar SEMPRE matls-clients.api.cora.com.br
    const host = environment === 'production' ? CORA_API_PROD : CORA_API_STAGE;

    const queryParams = new URLSearchParams(req.query).toString();
    const path = queryParams ? `/bank-statement/statement?${queryParams}` : '/bank-statement/statement';

    console.log('Cora statements request to:', { environment, host, path });

    const response = await makeCoraRequest({
      hostname: host,
      path,
      method: 'GET',
      headers: {
        'Authorization': authHeader,
        'Accept': 'application/json',
      },
    });

    console.log('Cora statements response:', response.statusCode, response.body.substring(0, 200));
    res.status(response.statusCode).send(response.body);
  } catch (error) {
    console.error('Cora statement error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Cora - Consultar saldo (Integração Direta: mTLS + /third-party/account/balance)
app.get('/cora/balance', authenticate, async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const environment = req.headers['x-environment'] || 'production';
    // Integração Direta: usar SEMPRE matls-clients.api.cora.com.br
    const host = environment === 'production' ? CORA_API_PROD : CORA_API_STAGE;
    const path = '/third-party/account/balance';

    console.log('Cora balance request to:', { environment, host, path });

    const response = await makeCoraRequest({
      hostname: host,
      path: path,
      method: 'GET',
      headers: {
        'Authorization': authHeader,
        'Accept': 'application/json',
      },
    });

    console.log('Cora balance response:', response.statusCode, response.body.substring(0, 300));
    res.status(response.statusCode).send(response.body);
  } catch (error) {
    console.error('Cora balance error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Cora - Dados da conta (Integração Direta: mTLS + /third-party/account/)
app.get('/cora/account', authenticate, async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const environment = req.headers['x-environment'] || 'production';
    // Integração Direta: usar SEMPRE matls-clients.api.cora.com.br
    const host = environment === 'production' ? CORA_API_PROD : CORA_API_STAGE;
    const path = '/third-party/account/';

    console.log('Cora account request to:', { environment, host, path });

    const response = await makeCoraRequest({
      hostname: host,
      path,
      method: 'GET',
      headers: {
        'Authorization': authHeader,
        'Accept': 'application/json',
      },
    });

    console.log('Cora account response:', response.statusCode, response.body.substring(0, 200));
    res.status(response.statusCode).send(response.body);
  } catch (error) {
    console.error('Cora account error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Cora - Criar cobrança PIX (receber)
app.post('/cora/pix/charge', authenticate, async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const environment = req.headers['x-environment'] || 'production';
    const host = environment === 'production' ? CORA_API_PROD : CORA_API_STAGE;
    const body = JSON.stringify(req.body);

    console.log('Cora PIX charge request:', req.body);

    const response = await makeCoraRequest({
      hostname: host,
      path: '/pix/qrcodes',
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, body);

    console.log('Cora PIX charge response:', response.statusCode, response.body.substring(0, 300));
    res.status(response.statusCode).send(response.body);
  } catch (error) {
    console.error('Cora PIX charge error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Cora - Enviar PIX (transferência) - Integração Direta usa /transfers/pix
app.post('/cora/pix/transfer', authenticate, async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const environment = req.headers['x-environment'] || 'production';
    const host = environment === 'production' ? CORA_API_PROD : CORA_API_STAGE;
    
    // Transformar body para formato esperado pela API Cora
    const { pixKey, amount, description } = req.body;
    const transferBody = JSON.stringify({
      amount: amount,
      key: pixKey,
      description: description || 'Transferência PIX',
    });

    console.log('Cora PIX transfer request:', { pixKey, amount, description });

    const response = await makeCoraRequest({
      hostname: host,
      path: '/transfers/pix',
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(transferBody),
      },
    }, transferBody);

    console.log('Cora PIX transfer response:', response.statusCode, response.body.substring(0, 300));
    res.status(response.statusCode).send(response.body);
  } catch (error) {
    console.error('Cora PIX transfer error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Cora - Iniciar transferência (POST /third-party/transfers/initiate)
app.post('/cora/transfers/initiate', authenticate, async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const environment = req.headers['x-environment'] || 'production';
    const host = environment === 'production' ? CORA_API_PROD : CORA_API_STAGE;
    const body = JSON.stringify(req.body);

    console.log('Cora transfer initiate request:', { host, body: body.substring(0, 300) });

    const response = await makeCoraRequest({
      hostname: host,
      path: '/third-party/transfers/initiate',
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, body);

    console.log('Cora transfer initiate response:', response.statusCode, response.body.substring(0, 500));
    res.status(response.statusCode).send(response.body);
  } catch (error) {
    console.error('Cora transfer initiate error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Cora - Listar chaves PIX
app.get('/cora/pix/keys', authenticate, async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const environment = req.headers['x-environment'] || 'production';
    const host = environment === 'production' ? CORA_API_PROD : CORA_API_STAGE;

    const response = await makeCoraRequest({
      hostname: host,
      path: '/pix/keys',
      method: 'GET',
      headers: {
        'Authorization': authHeader,
        'Accept': 'application/json',
      },
    });

    console.log('Cora PIX keys response:', response.statusCode, response.body.substring(0, 200));
    res.status(response.statusCode).send(response.body);
  } catch (error) {
    console.error('Cora PIX keys error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Cora - Proxy genérico
app.all('/cora/proxy/*', authenticate, async (req, res) => {
  try {
    const path = req.params[0];
    const authHeader = req.headers['authorization'];
    const environment = req.headers['x-environment'] || 'production';
    const host = environment === 'production' ? CORA_API_PROD : CORA_API_STAGE;
    const body = req.method !== 'GET' ? JSON.stringify(req.body) : null;

    console.log('Cora proxy request:', { method: req.method, path: '/' + path, host, body: body?.substring(0, 200) });

    const headers = {
      'Authorization': authHeader,
    };

    if (body) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(body);
    }

    const response = await makeCoraRequest({
      hostname: host,
      path: '/' + path,
      method: req.method,
      headers,
    }, body);

    console.log('Cora proxy response:', response.statusCode, response.body?.substring(0, 500));
    res.status(response.statusCode).send(response.body);
  } catch (error) {
    console.error('Cora proxy error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Multi-Bank Proxy running on port ${PORT}`);
  console.log(`Inter: cert=${!!INTER_CERTIFICATE_BASE64}, key=${!!INTER_KEY_BASE64}`);
  console.log(`Cora: cert=${!!CORA_CERT_BASE64}, key=${!!CORA_KEY_BASE64}`);
});
