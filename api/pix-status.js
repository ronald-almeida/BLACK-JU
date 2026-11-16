import { getPaymentStatus } from '../lib/payment.js';
import { readPost, secure, sendError } from '../lib/http.js';

export default async function handler(request, response) {
  secure(response); response.setHeader('Allow', 'POST');
  try {
    const { token } = readPost(request);
    return response.status(200).json(await getPaymentStatus(token));
  } catch (error) { return sendError(response, error); }
}
