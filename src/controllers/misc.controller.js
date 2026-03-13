const { Resend } = require('resend');

exports.requestDemo = async (req, res, next) => {
  try {
    const { name, email, phone, company, requirement, offering } = req.body || {};

    const to = process.env.TO_EMAIL || 'chike@plangenie.com';
    const from = process.env.RESEND_FROM || 'Plan Genie <no-reply@plangenie.com>';
    const resend = new Resend(process.env.RESEND_API_KEY);

    const subject = `New Demo Request${offering ? ` – ${offering}` : ''}`;
    const html = `
      <div style="text-align:center;margin-bottom:16px">
        <img src="https://logos.plangenie.com/logo.png" alt="PlanGenie" style="height:24px;max-width:180px;object-fit:contain" />
      </div>
      <h2 style="margin:8px 0 16px 0;color:#1D4374">New Demo Request</h2>
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

exports.bookCall = async (req, res, next) => {
  try {
  const { name, email, time, note, reason } = req.body || {};
    const to = process.env.TO_EMAIL || 'chike@plangenie.com';
    const from = process.env.RESEND_FROM || 'Plan Genie <no-reply@plangenie.com>';
    const resend = new Resend(process.env.RESEND_API_KEY);
    const subject = 'Talk with Us – Call booking request';
    const html = `
      <div style="text-align:center;margin-bottom:16px">
        <img src="https://logos.plangenie.com/logo.png" alt="PlanGenie" style="height:24px;max-width:180px;object-fit:contain" />
      </div>
      <h2 style="margin:8px 0 16px 0;color:#1D4374">Call Booking</h2>
      <p><strong>Name:</strong> ${name || ''}</p>
      <p><strong>Email:</strong> ${email || ''}</p>
      <p><strong>Reason:</strong> ${reason || ''}</p>
      <p><strong>Preferred time:</strong> ${time || ''}</p>
      <p><strong>Notes:</strong></p>
      <p style="white-space:pre-line">${note || ''}</p>
    `;
    const text = `Call Booking\n\nName: ${name || ''}\nEmail: ${email || ''}\nReason: ${reason || ''}\nPreferred time: ${time || ''}\n\nNotes:\n${note || ''}`;
    const result = await resend.emails.send({ from, to, subject, html, text, reply_to: email || undefined });
    if (result && result.error) {
      return res.status(500).json({ ok: false, error: result.error.message || 'Resend error' });
    }
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
};
