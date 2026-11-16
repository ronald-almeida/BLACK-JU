export default function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'GET') return response.status(405).json({ error: 'Método não permitido.' });
  const configured = Boolean(process.env.FIREBOT_API_KEY?.trim().startsWith('fire_sk_live_'));
  return response.status(configured ? 200 : 503).json({ provider: 'Firebot', configured });
}
