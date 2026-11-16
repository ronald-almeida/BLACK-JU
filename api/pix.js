import { createPayment } from '../lib/payment.js';
import { readPost, secure, sendError, storeUrl } from '../lib/http.js';

export default async function handler(request, response) {
  secure(response); response.setHeader('Allow', 'POST');
  try {
    const { productId, customer } = readPost(request);
    return response.status(200).json(await createPayment(productId, customer, storeUrl(request)));
  } catch (error) { return sendError(response, error); }
}
