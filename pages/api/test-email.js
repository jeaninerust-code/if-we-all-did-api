import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
  try {
    const response = await resend.emails.send({
      from: "If We All Did <begin@updates.ifwealldid.org>",
      to: ["jeanine.rust@gmail.com"],
      subject: "Smoke test: If We All Did",
      html: `
        <p>This is a test email.</p>
        <p>If you received this, email sending works.</p>
      `,
    });

    res.status(200).json({ success: true, response });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: error.message });
  }
}
