import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { name, email, city, country, pledge_campaign = "pilot_v1" } = req.body || {};

  if (!name || !email) {
    return res.status(400).json({ error: "Name and email are required" });
  }

  try {
    const client = await pool.connect();
    try {
      const query = `
        INSERT INTO pledges (name, email, city, country, pledge_campaign)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, created_at
      `;
      const values = [name, email, city || null, country || null, pledge_campaign];
      const result = await client.query(query, values);
      const row = result.rows[0];

      res.status(201).json({
        id: row.id,
        created_at: row.created_at,
      });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Error inserting pledge:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}
