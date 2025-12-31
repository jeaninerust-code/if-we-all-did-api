import { Resend } from "resend";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const resend = new Resend(process.env.RESEND_API_KEY);

// Optional safety: protect this endpoint with a secret
const CRON_SECRET = process.env.CRON_SECRET;

function isAuthorized(req) {
  if (!CRON_SECRET) return true; // allow if you haven't set one yet
  return req.headers["x-cron-secret"] === CRON_SECRET || req.query.secret === CRON_SECRET;
}

function renderBeginEmail({ displayName, intro, bullets, ctaLabel, pledgeUrl }) {
  const safeBullets = Array.isArray(bullets) ? bullets : [];
  const bulletHtml = safeBullets.map((b) => `<li>${escapeHtml(b)}</li>`).join("");

  return `
    <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; line-height:1.5; color:#111;">
      <h2 style="margin:0 0 12px 0;">We begin together</h2>

      <p style="margin:0 0 12px 0;"><strong>${escapeHtml(displayName || "This pledge")}</strong></p>

      <p style="margin:0 0 14px 0;">${escapeHtml(intro || "We reached the goal. For the next 30 days, we begin together.")}</p>

      ${safeBullets.length ? `<ul style="margin:0 0 16px 18px; padding:0;">${bulletHtml}</ul>` : ""}

      <p style="margin:0 0 18px 0;">
        <a href="${pledgeUrl}" style="display:inline-block; background:#111; color:#fff; text-decoration:none; padding:10px 14px; border-radius:8px;">
          ${escapeHtml(ctaLabel || "View the pledge")}
        </a>
      </p>

      <p style="margin:0; color:#444; font-size: 13px;">
        You’re receiving this because you joined the pledge on If We All Did.
      </p>
    </div>
  `;
}

function escapeHtml(str) {
  return String(str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export default async function handler(req, res) {
  if (!isAuthorized(req)) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }

  const client = await pool.connect();
  const summary = { checked: 0, triggered: 0, emailsSent: 0, campaigns: [] };

  try {
    // 1) Find campaigns that have reached threshold AND haven't been triggered yet
    const ready = await client.query(
      `
        SELECT
          c.campaign,
          c.threshold,
          c.display_name,
          c.pledge_path,
          c.begin_subject,
          c.begin_intro,
          c.begin_bullets,
          c.begin_cta_label
        FROM campaigns c
        WHERE c.status = 'collecting'
          AND (
            SELECT COUNT(*)::int
            FROM pledges p
            WHERE p.pledge_campaign = c.campaign
          ) >= c.threshold
      `
    );

    summary.checked = ready.rows.length;

    for (const row of ready.rows) {
      const campaign = row.campaign;

      // 2) Atomically flip status to 'triggered' so we don't double-send
      const updated = await client.query(
        `
        UPDATE campaigns
        SET status = 'triggered', triggered_at = NOW()
        WHERE campaign = $1 AND status = 'collecting'
        RETURNING campaign
        `,
        [campaign]
      );

      // If another run already triggered it, skip
      if (updated.rowCount === 0) continue;

      summary.triggered += 1;

      // 3) Fetch unnotified pledge emails for this campaign
      const pledgeRows = await client.query(
        `
        SELECT id, email
        FROM pledges
        WHERE pledge_campaign = $1 AND notified_at IS NULL AND email IS NOT NULL
        `,
        [campaign]
      );

      const baseUrl = process.env.PUBLIC_BASE_URL || "https://ifwealldid.org"; // set this in Vercel env
      const pledgeUrl = `${baseUrl}${row.pledge_path || ""}`;

      // 4) Send one email per person
      let sentForCampaign = 0;

      for (const p of pledgeRows.rows) {
        const html = renderBeginEmail({
          displayName: row.display_name,
          intro: row.begin_intro,
          bullets: row.begin_bullets,
          ctaLabel: row.begin_cta_label,
          pledgeUrl,
        });

        const sendResult = await resend.emails.send({
          from: "If We All Did <begin@updates.ifwealldid.org>",
          to: [p.email],
          subject: row.begin_subject || "We begin together",
          html,
        });

        // If Resend returns an error object, throw to avoid partial state updates
        if (sendResult?.error) {
          throw new Error(`Resend error for ${p.email}: ${sendResult.error.message || "Unknown error"}`);
        }

        sentForCampaign += 1;

        // Mark this pledge as notified
        await client.query(
          `UPDATE pledges SET notified_at = NOW() WHERE id = $1`,
          [p.id]
        );
      }

      // 5) Mark campaign as notified
      await client.query(
        `
        UPDATE campaigns
        SET status = 'notified', notified_at = NOW()
        WHERE campaign = $1
        `,
        [campaign]
      );

      summary.emailsSent += sentForCampaign;
      summary.campaigns.push({ campaign, emailsSent: sentForCampaign });
    }

    return res.status(200).json({ success: true, summary });
  } catch (err) {
    console.error("Trigger error:", err);
    return res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
}
