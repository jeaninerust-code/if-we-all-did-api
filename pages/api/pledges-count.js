import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { campaign = "pilot_v1" } = req.query;

  try {
    const client = await pool.connect();
    try {
      const query = `
        SELECT COUNT(*)::int AS count
        FROM pledges
        WHERE pledge_campaign = $1
      `;
      const values = [campaign];
      const result = await client.query(query, values);
      const { count } = result.rows[0];

      res.status(200).json({ count });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Error getting pledge count:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}
