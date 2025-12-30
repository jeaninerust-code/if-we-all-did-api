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
      SELECT c.campaign, c.threshold
      FROM campaigns c
      WHERE c.status = 'collecting'
        AND (
          SELECT COUNT(*)::int
          FROM pledges p
          WHERE p.campaign = c.campaign
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
        WHERE campaign = $1 AND notified_at IS NULL AND email IS NOT NULL
        `,
        [campaign]
      );

      // 4) Send one email per person
      let sentForCampaign = 0;

      for (const p of pledgeRows.rows) {
        // Keep this minimal; we’ll refine wording later
        const sendResult = await resend.emails.send({
          from: "If We All Did <begin@updates.ifwealldid.org>",
          to: [p.email],
          subject: "We begin",
          html: `
            <p>We reached the goal for <strong>${campaign}</strong>.</p>
            <p>We begin together.</p>
          `,
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
