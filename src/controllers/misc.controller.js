const { Resend } = require('resend');

exports.requestDemo = async (req, res, next) => {
  try {
    const { name, email, phone, company, requirement, offering } = req.body || {};

    const to = process.env.TO_EMAIL || 'chike@plangenie.com';
    const from = process.env.RESEND_FROM || 'Plan Genie <no-reply@plangenie.com>';
    const resend = new Resend(process.env.RESEND_API_KEY);

    const subject = `New Demo Request${offering ? ` – ${offering}` : ''}`;
    const html = `
      <h2>New Demo Request</h2>
      <p><strong>Name:</strong> ${name || ''}</p>
      <p><strong>Email:</strong> ${email || ''}</p>
      <p><strong>Phone:</strong> ${phone || ''}</p>
      <p><strong>Company:</strong> ${company || ''}</p>
      <p><strong>Offering:</strong> ${offering || ''}</p>
      <p><strong>Requirement:</strong></p>
      <p style="white-space:pre-line">${requirement || ''}</p>
    `;
    const text = `New Demo Request\n\nName: ${name || ''}\nEmail: ${email || ''}\nPhone: ${phone || ''}\nCompany: ${company || ''}\nOffering: ${offering || ''}\n\nRequirement:\n${requirement || ''}`;

    const result = await resend.emails.send({
      from,
      to,
      subject,
      html,
      text,
      reply_to: email || undefined,
    });

    if (result && result.error) {
      return res.status(500).json({ ok: false, error: result.error.message || 'Resend error' });
    }

    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
};

