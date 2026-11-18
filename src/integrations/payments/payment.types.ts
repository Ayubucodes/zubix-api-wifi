/** Provider-independent payment contract. Business logic depends only on this interface. */

export type ProviderCode = "MOCK" | "CLICKPESA" | "SELCOM";

export type ProviderStatus = "PENDING" | "PROCESSING" | "SUCCESS" | "FAILED";

export interface InitiatePaymentRequest {
  /** Internal payment reference. Sent to the provider as the order reference. */
  reference: string;
  amountTzs: number;
  /** Normalized Tanzanian number, digits only, e.g. 255712345678. */
  phoneNumber: string;
}

export interface InitiatePaymentResult {
  providerTransactionId: string;
  status: ProviderStatus;
}

/** Provider webhook after authentication and parsing. Amounts are whole TZS. */
export interface NormalizedWebhook {
  providerTransactionId: string;
  reference: string;
  status: ProviderStatus;
  amountTzs?: number;
  currency?: string;
  failureReason?: string;
}

export interface PaymentProvider {
  readonly code: ProviderCode;
  initiatePayment(request: InitiatePaymentRequest): Promise<InitiatePaymentResult>;
  /** Returns true only if the webhook body carries a valid signature for this provider. */
  verifyWebhook(body: Record<string, unknown>): boolean;
  /** Returns null if the body is not a recognized payment event. */
  parseWebhook(body: Record<string, unknown>): NormalizedWebhook | null;
}
