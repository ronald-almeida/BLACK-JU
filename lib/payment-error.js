export class PaymentError extends Error {
  constructor(message, status = 502, retryable = false) {
    super(message);
    this.status = status;
    this.retryable = retryable;
  }
}
