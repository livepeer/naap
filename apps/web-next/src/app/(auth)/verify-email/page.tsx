import type { Metadata } from 'next';
import VerifyEmailContent from './verify-email-content';

export const metadata: Metadata = {
  title: 'Verify Email',
};

export default function VerifyEmailPage() {
  return <VerifyEmailContent />;
}
