# Inter Proxy

Servidor proxy para API do Banco Inter com suporte a mTLS.

## Por que é necessário?

A API do Banco Inter em produção **requer mTLS** (certificado SSL mútuo). Supabase Edge Functions não suporta isso nativamente, então este proxy faz a ponte.

## Deploy no Render.com (Grátis)

1. Acesse https://render.com e faça login
2. Clique em "New" → "Web Service"
3. Conecte seu repositório GitHub ou use "Deploy from URL"
4. Configure as variáveis de ambiente:
   - `INTER_CERTIFICATE_BASE64` - Seu certificado em Base64
   - `INTER_KEY_BASE64` - Sua chave em Base64
   - `PROXY_SECRET` - Uma senha segura para proteger o proxy

## Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/health` | Health check |
| POST | `/oauth/token` | Obter token OAuth |
| GET | `/banking/saldo` | Consultar saldo |
| PUT | `/pix/cob/:txid` | Criar cobrança PIX |
| GET | `/pix/cob/:txid` | Consultar cobrança PIX |

## Headers Obrigatórios

- `X-Proxy-Secret`: Senha do proxy (PROXY_SECRET)
- `Authorization`: Bearer token do Inter (quando aplicável)

## Exemplo de uso

```bash
# Obter token
curl -X POST https://seu-proxy.onrender.com/oauth/token \
  -H "X-Proxy-Secret: sua-senha" \
  -H "Content-Type: application/json" \
  -d '{"client_id": "xxx", "client_secret": "yyy"}'
```
