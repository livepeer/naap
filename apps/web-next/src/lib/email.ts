/**
 * Email sending via Resend
 * Used for verification and password reset emails.
 */

import { Resend } from 'resend';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM =
  process.env.EMAIL_FROM || 'NaaP Platform <onboarding@resend.dev>';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

function getResendClient(): Resend | null {
  if (!RESEND_API_KEY) return null;
  return new Resend(RESEND_API_KEY);
}

/**
 * Livepeer community–friendly verification email template
 */
function buildVerificationEmailHtml(params: {
  verifyUrl: string;
  displayName?: string;
}): string {
  const { verifyUrl, displayName } = params;
  const greeting = displayName ? `Hi ${displayName}` : 'Hi there';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify your email - NaaP</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f4f6f8; line-height: 1.6;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f4f6f8; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 520px; background: #ffffff; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); overflow: hidden;">
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #0a0f1a 0%, #1a2744 100%); padding: 32px 40px; text-align: center;">
              <h1 style="margin: 0; font-size: 24px; font-weight: 600; color: #ffffff; letter-spacing: -0.5px;">NaaP Platform</h1>
              <p style="margin: 8px 0 0; font-size: 14px; color: rgba(255,255,255,0.8);">by Livepeer Community</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding: 40px;">
              <p style="margin: 0 0 16px; font-size: 16px; color: #1f2937;">${greeting},</p>
              <p style="margin: 0 0 24px; font-size: 16px; color: #4b5563;">
                Welcome to NaaP — the platform for managing decentralized video and AI infrastructure. 
                You're one step away from joining the Livepeer community.
              </p>
              <p style="margin: 0 0 24px; font-size: 16px; color: #4b5563;">
                Please verify your email address by clicking the button below:
              </p>
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin: 0 auto;">
                <tr>
                  <td style="border-radius: 8px; background: linear-gradient(135deg, #00a55f 0%, #00d26a 100%);">
                    <a href="${verifyUrl}" style="display: inline-block; padding: 14px 32px; font-size: 16px; font-weight: 600; color: #ffffff; text-decoration: none;">Verify Email Address</a>
                  </td>
                </tr>
              </table>
              <p style="margin: 24px 0 0; font-size: 14px; color: #6b7280;">
                This link expires in 24 hours. If you didn't create an account, you can safely ignore this email.
              </p>
              <p style="margin: 16px 0 0; font-size: 13px; color: #9ca3af;">
                If the button doesn't work, copy and paste this link into your browser:<br>
                <a href="${verifyUrl}" style="color: #00a55f; word-break: break-all;">${verifyUrl}</a>
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding: 24px 40px; background: #f9fafb; border-top: 1px solid #e5e7eb; text-align: center;">
              <p style="margin: 0; font-size: 12px; color: #9ca3af;">
                Built by the Livepeer community · <a href="${APP_URL}" style="color: #00a55f; text-decoration: none;">NaaP Platform</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Password reset email template
 */
function buildPasswordResetEmailHtml(params: { resetUrl: string }): string {
  const { resetUrl } = params;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset your password - NaaP</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f4f6f8; line-height: 1.6;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f4f6f8; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 520px; background: #ffffff; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); overflow: hidden;">
          <tr>
            <td style="background: linear-gradient(135deg, #0a0f1a 0%, #1a2744 100%); padding: 32px 40px; text-align: center;">
              <h1 style="margin: 0; font-size: 24px; font-weight: 600; color: #ffffff;">NaaP Platform</h1>
              <p style="margin: 8px 0 0; font-size: 14px; color: rgba(255,255,255,0.8);">by Livepeer Community</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 40px;">
              <p style="margin: 0 0 16px; font-size: 16px; color: #1f2937;">Hi there,</p>
              <p style="margin: 0 0 24px; font-size: 16px; color: #4b5563;">
                We received a request to reset your NaaP account password. 
                Click the button below to choose a new password:
              </p>
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin: 0 auto;">
                <tr>
                  <td style="border-radius: 8px; background: linear-gradient(135deg, #00a55f 0%, #00d26a 100%);">
                    <a href="${resetUrl}" style="display: inline-block; padding: 14px 32px; font-size: 16px; font-weight: 600; color: #ffffff; text-decoration: none;">Reset Password</a>
                  </td>
                </tr>
              </table>
              <p style="margin: 24px 0 0; font-size: 14px; color: #6b7280;">
                This link expires in 1 hour. If you didn't request a password reset, you can safely ignore this email.
              </p>
              <p style="margin: 16px 0 0; font-size: 13px; color: #9ca3af;">
                If the button doesn't work, copy and paste this link into your browser:<br>
                <a href="${resetUrl}" style="color: #00a55f; word-break: break-all;">${resetUrl}</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 24px 40px; background: #f9fafb; border-top: 1px solid #e5e7eb; text-align: center;">
              <p style="margin: 0; font-size: 12px; color: #9ca3af;">
                Built by the Livepeer community · <a href="${APP_URL}" style="color: #00a55f; text-decoration: none;">NaaP Platform</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Send verification email (registration)
 */
export async function sendVerificationEmail(
  to: string,
  verifyUrl: string,
  displayName?: string
): Promise<{ success: boolean; error?: string }> {
  const client = getResendClient();

  if (!client) {
    if (process.env.NODE_ENV !== 'production') {
      console.log('[EMAIL] (no RESEND_API_KEY) Verification URL:', verifyUrl);
    }
    return { success: true };
  }

  const html = buildVerificationEmailHtml({ verifyUrl, displayName });

  try {
    await client.emails.send({
      from: EMAIL_FROM,
      to,
      subject: 'Verify your email — welcome to NaaP',
      html,
    });
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[EMAIL] Failed to send verification:', message);
    return { success: false, error: message };
  }
}

/**
 * Send password reset email
 */
export async function sendPasswordResetEmail(
  to: string,
  resetUrl: string
): Promise<{ success: boolean; error?: string }> {
  const client = getResendClient();

  if (!client) {
    if (process.env.NODE_ENV !== 'production') {
      console.log('[EMAIL] (no RESEND_API_KEY) Reset URL:', resetUrl);
    }
    return { success: true };
  }

  const html = buildPasswordResetEmailHtml({ resetUrl });

  try {
    await client.emails.send({
      from: EMAIL_FROM,
      to,
      subject: 'Reset your NaaP password',
      html,
    });
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[EMAIL] Failed to send password reset:', message);
    return { success: false, error: message };
  }
}
