// Reserved integration boundary. Paper Harbor deliberately does not collect or process payment.
export async function futurePaymentAdapter() {
  throw new Error('Payment processing is intentionally unimplemented in this local demo.');
}
