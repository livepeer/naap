/**
 * Smart Document Processing — Understand any financial document.
 */

export interface DocumentAnalysis {
  documentType: 'receipt' | 'invoice' | 'contract' | 'bank_statement' | 'email' | 'unknown';
  confidence: number;
  extractedData: Record<string, unknown>;
  suggestedAction: string;
  actionType: 'record_expense' | 'create_invoice' | 'update_recurring' | 'review' | 'none';
}

export function classifyDocument(text: string): DocumentAnalysis['documentType'] {
  const lower = text.toLowerCase();
  if (lower.includes('invoice') || lower.includes('bill to') || lower.includes('amount due')) return 'invoice';
  if (lower.includes('receipt') || lower.includes('total') || lower.includes('subtotal')) return 'receipt';
  if (lower.includes('agreement') || lower.includes('contract') || lower.includes('retainer')) return 'contract';
  if (lower.includes('statement') || lower.includes('transactions') || lower.includes('balance')) return 'bank_statement';
  if (lower.includes('subscription') || lower.includes('will increase') || lower.includes('renewal')) return 'email';
  return 'unknown';
}

export function suggestAction(docType: DocumentAnalysis['documentType']): { action: string; actionType: DocumentAnalysis['actionType'] } {
  switch (docType) {
    case 'receipt': return { action: 'Record this as an expense', actionType: 'record_expense' };
    case 'invoice': return { action: 'Track this invoice for payment', actionType: 'create_invoice' };
    case 'contract': return { action: 'Set up recurring invoicing based on this contract', actionType: 'create_invoice' };
    case 'email': return { action: 'Update subscription amount or create new recurring expense', actionType: 'update_recurring' };
    case 'bank_statement': return { action: 'Import and reconcile transactions', actionType: 'review' };
    default: return { action: 'Review this document manually', actionType: 'none' };
  }
}
