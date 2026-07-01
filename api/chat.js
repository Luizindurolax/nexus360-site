/**
 * api/chat.js — Assistente virtual do site Nexus360 (Vercel Serverless Function)
 * ================================================================================
 * Recebe as mensagens do widget de chat e responde usando a API gratuita do
 * Google Gemini. A chave fica só aqui no servidor (variável de ambiente),
 * nunca no navegador.
 *
 * Configurar em Vercel → Project (nexus360-site) → Settings → Environment Variables:
 *   GEMINI_API_KEY   — sua chave gratuita do Google AI Studio (aistudio.google.com/apikey)
 *   GEMINI_MODEL     — opcional, padrão "gemini-2.5-flash" (modelo do free tier)
 *
 * Free tier do Gemini (Flash): ~1.500 requisições/dia, 15 req/min — de sobra
 * para um chat de suporte de site. Sem cartão de crédito.
 */

const SYSTEM_PROMPT = `Você é o assistente virtual do site do Nexus360, um dashboard de vendas, estoque e produtos
integrado ao Bling ERP, sincronizado via Supabase e instalável como PWA no celular.

Recursos do produto:
- Dashboard em tempo real (receita, pedidos, ticket médio, estoque crítico)
- Integração automática com o Bling (pedidos, compras, produtos, lojas)
- Controle de estoque com alertas de ruptura e sugestão de compra
- Gestão de vendas por canal, cliente e período
- Ranking de vendedores (receita, pedidos, ticket médio)
- Performance de compras por SKU (custo, cobertura, sugestão de compra)
- App instalável (PWA), com login e PIN de acesso
- Dados protegidos no Supabase com políticas de RLS

Planos (valores de exemplo, sempre confirmar que podem mudar):
- Starter: R$ 149/mês — 1 loja, dashboard e produtos, sync diária, 1 usuário
- Pro (mais popular): R$ 349/mês — até 5 lojas, vendedores e compras, alertas de estoque, até 10 usuários
- Enterprise: sob consulta — lojas e usuários ilimitados, suporte prioritário, integrações customizadas

Regras de resposta:
- Responda sempre em português do Brasil, de forma curta, direta, simpática e sem enrolação.
- Se não souber uma informação específica (preço exato negociado, prazo, etc.), seja honesto e direcione
  para contato humano: luizhenriquefrancisconi@gmail.com
- Se perguntarem algo totalmente fora do escopo do Nexus360, redirecione educadamente de volta ao produto.
- Nunca invente recursos que não estão listados acima.
- Respostas de no máximo 3-4 frases, a não ser que o usuário peça mais detalhe.`;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_KEY) {
    return res.status(500).json({ error: 'GEMINI_API_KEY não configurada no Vercel.' });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return res.status(400).json({ error: 'JSON inválido' });
  }

  const incoming = Array.isArray(body.messages) ? body.messages : [];
  const messages = incoming
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-12)
    .map(m => ({ role: m.role, content: m.content.slice(0, 1500) }));

  if (!messages.length) {
    return res.status(400).json({ error: 'Nenhuma mensagem enviada' });
  }

  // Gemini usa role "model" em vez de "assistant"
  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`;

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        generationConfig: { maxOutputTokens: 350, temperature: 0.4 },
      }),
    });

    if (!r.ok) {
      const errText = await r.text();
      console.error('[chat] Gemini error:', r.status, errText);
      return res.status(502).json({ error: 'Falha ao consultar a IA' });
    }

    const data = await r.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
      || 'Desculpe, não consegui responder agora.';
    return res.status(200).json({ reply });
  } catch (err) {
    console.error('[chat] ERRO:', err);
    return res.status(500).json({ error: err.message });
  }
};

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 20000) reject(new Error('Body muito grande'));
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch (err) { reject(new Error('JSON inválido')); }
    });
    req.on('error', reject);
  });
}
