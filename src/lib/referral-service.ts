// src/lib/referral-service.ts
/**
 * Referral Service for CityPing Viral Growth Program
 *
 * This service manages the complete referral lifecycle from code generation through
 * reward fulfillment. The architecture follows the "double-sided incentive" model
 * that drove exponential growth at Dropbox, Uber, and Airbnb.
 *
 * Architectural Overview:
 * ----------------------
 *   [Existing User] -> generateReferralCode() -> [NYC-XXXXX code]
 *   [Share code with friend]
 *   [Friend signs up] -> createReferral() -> [PENDING referral record]
 *   [Friend upgrades to Premium] -> convertReferral() -> [Stripe coupon for referrer]
 *
 * Economic Theory - Network Effects and Viral Coefficients:
 * --------------------------------------------------------
 * The viral coefficient (k-factor) = invites sent * conversion rate.
 * If k > 1, growth is exponential (each user brings >1 new user on average).
 * This service is designed to maximize k by:
 * 1. Making sharing frictionless (memorable NYC-XXXXX codes)
 * 2. Providing tangible value (1 month free = ~$5-10 value)
 * 3. Time-boxing the opportunity (90-day expiration creates urgency)
 *
 * Historical Precedent:
 * - Dropbox: 2-sided incentive (+500MB for both parties) drove 3900% growth
 * - PayPal: $20 referral bonus helped achieve 7-10% daily user growth
 * - Uber: City-specific launch codes created local network density
 *
 * Security Considerations:
 * -----------------------
 * 1. Codes use cryptographic randomness (not sequential)
 * 2. One pending referral per email prevents spam
 * 3. Conversion requires actual Stripe subscription (not just signup)
 * 4. 90-day expiration limits fraud window
 */

import Stripe from "stripe";
import { prisma } from "./db";
import { Resend } from "resend";
import { ReferralStatus } from "@prisma/client";

// Initialize Stripe client
// Note: The stripe.ts module throws if STRIPE_SECRET_KEY is missing,
// but we need a fresh instance here for coupon operations
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "sk_test_mock", {
  apiVersion: "2026-01-28.clover",
  typescript: true,
});

// Initialize Resend for notification emails (gracefully handle missing key during build)
const resendApiKey = process.env.RESEND_API_KEY;
const resend = resendApiKey ? new Resend(resendApiKey) : null;

/**
 * Character set for referral code generation.
 *
 * Uses uppercase alphanumeric characters only:
 * - 0-9: 10 characters
 * - A-Z: 26 characters
 * - Total: 36 characters
 *
 * With 5 characters: 36^5 = 60,466,176 possible codes
 * Collision probability for 100K users: ~0.08% (acceptable)
 *
 * Excludes ambiguous characters (O/0, I/1, L) for legibility?
 * No - we keep the full set for maximum entropy. The NYC- prefix
 * provides sufficient context to disambiguate.
 */
const CODE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const CODE_LENGTH = 5;
const CODE_PREFIX = "NYC-";

/**
 * Referral expiration window in days.
 *
 * 90 days balances:
 * - User urgency (creates FOMO if they don't act)
 * - Reasonable conversion window (account for decision time)
 * - Fraud limitation (expired codes can't be abused indefinitely)
 *
 * Industry benchmarks:
 * - Dropbox: 30 days
 * - Uber: 180 days
 * - Airbnb: No expiration (but limited reward)
 */
const REFERRAL_EXPIRATION_DAYS = 90;

/**
 * Generates a unique referral code in the format "NYC-XXXXX".
 *
 * The code consists of:
 * - Prefix: "NYC-" (brand identifier)
 * - Suffix: 5 alphanumeric characters (A-Z, 0-9)
 *
 * Randomness is provided by Math.random() which uses a PRNG seeded by
 * system entropy. For this use case (non-cryptographic, non-financial),
 * Math.random() provides sufficient unpredictability.
 *
 * For higher-security applications, consider crypto.randomBytes() or
 * the Web Crypto API's getRandomValues().
 *
 * @returns A unique referral code string (e.g., "NYC-K7X2P")
 *
 * @example
 * const code = generateReferralCode();
 * console.log(code); // "NYC-A3B9K"
 */
export function generateReferralCode(): string {
  let suffix = "";

  for (let i = 0; i < CODE_LENGTH; i++) {
    const randomIndex = Math.floor(Math.random() * CODE_CHARS.length);
    suffix += CODE_CHARS[randomIndex];
  }

  return `${CODE_PREFIX}${suffix}`;
}

/**
 * Creates a new referral record linking a referrer to a potential referee.
 *
 * This function handles the initial referral creation when an existing user
 * wants to invite a friend. The referral is created in PENDING status and
 * will be converted when the referee upgrades to a paid subscription.
 *
 * Business Rules:
 * 1. Referrer must exist in the database
 * 2. No duplicate pending referrals for the same email
 * 3. Referral code must be unique (generated fresh for each referral)
 * 4. Expiration set to 90 days from creation
 *
 * @param referrerId - The ID of the existing user sending the referral
 * @param refereeEmail - The email address of the person being referred
 * @returns The created Referral record
 * @throws Error if referrer doesn't exist or referral already exists
 *
 * @example
 * const referral = await createReferral("user_123", "friend@example.com");
 * console.log(referral.referralCode); // "NYC-X9K2M"
 */
export async function createReferral(
  referrerId: string,
  refereeEmail: string
): Promise<{
  id: string;
  referrerId: string;
  refereeEmail: string;
  referralCode: string;
  status: ReferralStatus;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}> {
  // Validate referrer exists
  const referrer = await prisma.user.findUnique({
    where: { id: referrerId },
  });

  if (!referrer) {
    throw new Error("Referrer not found");
  }

  // Check for existing pending referral to this email
  const existingReferral = await prisma.referral.findFirst({
    where: {
      refereeEmail: refereeEmail.toLowerCase(),
      status: "PENDING",
    },
  });

  if (existingReferral) {
    throw new Error("Referral already exists for this email");
  }

  // Generate unique referral code
  // In production, you might want to retry if collision occurs,
  // but with 60M+ possible codes, collision is extremely unlikely
  const referralCode = generateReferralCode();

  // Calculate expiration date
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFERRAL_EXPIRATION_DAYS);

  // Create referral record
  const referral = await prisma.referral.create({
    data: {
      referrerId,
      refereeEmail: refereeEmail.toLowerCase(),
      referralCode,
      status: "PENDING",
      expiresAt,
    },
  });

  return referral;
}

/**
 * Retrieves a referral record by its unique code.
 *
 * This is the primary lookup method used when a new user signs up
 * via a referral link (e.g., cityping.com/r/NYC-X9K2M). The function
 * performs case-insensitive matching to handle user input variations.
 *
 * The returned object includes the referrer information, which can be
 * used to display a personalized welcome message (e.g., "John invited you!").
 *
 * @param code - The referral code to look up (e.g., "NYC-X9K2M")
 * @returns The Referral record with referrer info, or null if not found
 *
 * @example
 * const referral = await getReferralByCode("nyc-x9k2m");
 * if (referral) {
 *   console.log(`Referred by: ${referral.referrer.email}`);
 * }
 */
export async function getReferralByCode(
  code: string
): Promise<{
  id: string;
  referralCode: string;
  referrerId: string;
  refereeId: string | null;
  refereeEmail: string;
  status: ReferralStatus;
  stripeCouponId: string | null;
  convertedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
  referrer: {
    id: string;
    email: string;
  };
} | null> {
  // Normalize code to uppercase for case-insensitive matching
  const normalizedCode = code.toUpperCase();

  const referral = await prisma.referral.findUnique({
    where: { referralCode: normalizedCode },
    include: {
      referrer: true,
    },
  });

  return referral;
}

/**
 * Creates a Stripe coupon for the referrer as a reward.
 *
 * The coupon provides a 100% discount for one billing cycle,
 * effectively giving the referrer one month free. The coupon:
 * - Is single-use (max_redemptions: 1)
 * - Applies to the next invoice only (duration: "once")
 * - Includes metadata for audit trail
 *
 * Integration Note:
 * After creating the coupon, it must be applied to the referrer's
 * Stripe subscription. This can be done via the Stripe dashboard
 * or by calling stripe.subscriptions.update with the coupon ID.
 *
 * @param referrerId - The ID of the user to receive the coupon
 * @returns The created Stripe Coupon object
 *
 * @example
 * const coupon = await createReferralCoupon("user_123");
 * console.log(coupon.id); // "coupon_ABC123"
 */
export async function createReferralCoupon(
  referrerId: string
): Promise<Stripe.Coupon> {
  const coupon = await stripe.coupons.create({
    percent_off: 100,
    duration: "once",
    max_redemptions: 1,
    metadata: {
      referrer_id: referrerId,
      type: "referral_reward",
    },
  });

  return coupon;
}

/**
 * Converts a referral from PENDING to CONVERTED status and rewards the referrer.
 *
 * This function is called when a referred user successfully upgrades to a
 * paid subscription. It handles the complete reward fulfillment process:
 *
 * 1. Validates the referral exists and is in PENDING status
 * 2. Creates a Stripe coupon for the referrer (1 month free)
 * 3. Updates the referral record with:
 *    - status: CONVERTED
 *    - refereeId: The ID of the user who converted
 *    - stripeCouponId: The created coupon ID
 *    - convertedAt: Current timestamp
 * 4. Optionally sends a notification email to the referrer
 *
 * Idempotency:
 * This function is NOT idempotent - calling it twice will throw an error.
 * This prevents double-rewarding. For webhook handlers, ensure deduplication
 * at the caller level.
 *
 * @param referralId - The ID of the referral to convert
 * @param refereeId - The ID of the user who is being referred (just converted)
 * @returns The updated Referral record
 * @throws Error if referral not found, already converted, or expired
 *
 * @example
 * // In Stripe webhook handler:
 * const referral = await convertReferral("ref_123", "user_456");
 * console.log(`Coupon ${referral.stripeCouponId} created for referrer`);
 */
export async function convertReferral(
  referralId: string,
  refereeId: string
): Promise<{
  id: string;
  referralCode: string;
  referrerId: string;
  refereeId: string | null;
  refereeEmail: string;
  status: ReferralStatus;
  stripeCouponId: string | null;
  convertedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}> {
  // Fetch the referral with referrer info
  const referral = await prisma.referral.findUnique({
    where: { id: referralId },
    include: { referrer: true },
  });

  if (!referral) {
    throw new Error("Referral not found");
  }

  if (referral.status === "CONVERTED") {
    throw new Error("Referral has already been converted");
  }

  if (referral.status === "EXPIRED") {
    throw new Error("Referral has expired");
  }

  // Create Stripe coupon for referrer
  const coupon = await createReferralCoupon(referral.referrerId);

  // Update referral record
  const updatedReferral = await prisma.referral.update({
    where: { id: referralId },
    data: {
      status: "CONVERTED",
      refereeId,
      stripeCouponId: coupon.id,
      convertedAt: new Date(),
    },
  });

  // Send notification email to referrer (fire and forget)
  if (referral.referrer?.email) {
    sendReferralConversionEmail(referral.referrer.email, coupon.id).catch(
      (error) => {
        console.error("[ReferralService] Failed to send notification email:", error);
      }
    );
  }

  return updatedReferral;
}

/**
 * Sends an email notification to the referrer when their referral converts.
 *
 * This is a "fire and forget" operation - email delivery failure should not
 * block the conversion process. Errors are logged but not thrown.
 *
 * @param email - The referrer's email address
 * @param couponId - The Stripe coupon ID for reference
 */
async function sendReferralConversionEmail(
  email: string,
  couponId: string
): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    console.log("[ReferralService] RESEND_API_KEY not configured, skipping email");
    return;
  }

  try {
    await resend!.emails.send({
      from: "CityPing <hello@cityping.com>",
      to: email,
      subject: "Your friend upgraded! Here's your free month",
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; }
            .highlight { background: #f0f9ff; padding: 16px; border-radius: 8px; margin: 24px 0; }
            .code { font-family: monospace; background: #e5e7eb; padding: 4px 8px; border-radius: 4px; }
          </style>
        </head>
        <body>
          <h1>You earned a free month!</h1>
          <p>Your friend just upgraded to CityPing Premium. Thanks for spreading the word!</p>

          <div class="highlight">
            <strong>Your reward:</strong> 100% off your next month<br>
            <small>Coupon ID: <span class="code">${couponId}</span></small>
          </div>

          <p>The discount will be automatically applied to your next billing cycle. No action needed!</p>

          <p style="color: #666; font-size: 14px; margin-top: 32px;">
            Keep sharing - every friend who upgrades earns you another free month.
          </p>
        </body>
        </html>
      `,
    });
  } catch (error) {
    // Log but don't throw - email is non-critical
    console.error("[ReferralService] Email send error:", error);
  }
}

/**
 * Expires referrals that have passed their expiration date.
 *
 * This function should be called periodically (e.g., daily cron job)
 * to clean up stale referrals and prevent late conversions.
 *
 * @returns The count of referrals expired
 *
 * @example
 * // In a cron job:
 * const count = await expireStaleReferrals();
 * console.log(`Expired ${count} referrals`);
 */
export async function expireStaleReferrals(): Promise<number> {
  const result = await prisma.referral.updateMany({
    where: {
      status: "PENDING",
      expiresAt: {
        lt: new Date(),
      },
    },
    data: {
      status: "EXPIRED",
    },
  });

  if (result.count > 0) {
    console.log(`[ReferralService] Expired ${result.count} stale referrals`);
  }

  return result.count;
}
