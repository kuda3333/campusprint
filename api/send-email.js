// Vercel Serverless Function — /api/send-email.js
// Handles email notifications for both Glam Studio and CampusPrint
// Deploy this file to your project root under /api/send-email.js

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    return res.status(500).json({ error: 'Email service not configured' });
  }

  const { type, data } = req.body;

  try {
    let operatorEmail, customerEmail, operatorSubject, customerSubject,
        operatorBody, customerBody;

    if (type === 'salon_booking') {
      // ── GLAM STUDIO EMAILS ──────────────────────────────
      operatorSubject = `New Booking ${data.ref} — ${data.service}`;
      customerSubject = `Your Glam Studio Booking is Confirmed — ${data.ref}`;

      operatorBody = `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:20px">
          <h2 style="color:#1a1209">New Booking Received</h2>
          <div style="background:#f5e9c8;border-radius:8px;padding:16px;text-align:center;margin-bottom:20px">
            <p style="font-size:11px;color:#b8860b;margin:0;text-transform:uppercase;letter-spacing:0.1em">Booking Reference</p>
            <p style="font-size:28px;font-weight:600;color:#1a1209;margin:4px 0;letter-spacing:2px">${data.ref}</p>
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <tr><td style="padding:8px 0;color:#8a7d6e;border-bottom:1px solid #e8dfd0">Service</td><td style="padding:8px 0;font-weight:500;text-align:right;border-bottom:1px solid #e8dfd0">${data.service}</td></tr>
            <tr><td style="padding:8px 0;color:#8a7d6e;border-bottom:1px solid #e8dfd0">Date & Time</td><td style="padding:8px 0;font-weight:500;text-align:right;border-bottom:1px solid #e8dfd0">${data.datetime}</td></tr>
            <tr><td style="padding:8px 0;color:#8a7d6e;border-bottom:1px solid #e8dfd0">Duration</td><td style="padding:8px 0;font-weight:500;text-align:right;border-bottom:1px solid #e8dfd0">${data.duration} mins</td></tr>
            <tr><td style="padding:8px 0;color:#8a7d6e;border-bottom:1px solid #e8dfd0">Customer</td><td style="padding:8px 0;font-weight:500;text-align:right;border-bottom:1px solid #e8dfd0">${data.name}</td></tr>
            <tr><td style="padding:8px 0;color:#8a7d6e;border-bottom:1px solid #e8dfd0">Phone</td><td style="padding:8px 0;font-weight:500;text-align:right;border-bottom:1px solid #e8dfd0">${data.phone}</td></tr>
            <tr><td style="padding:8px 0;color:#8a7d6e;border-bottom:1px solid #e8dfd0">Payment</td><td style="padding:8px 0;font-weight:500;text-align:right;border-bottom:1px solid #e8dfd0">${data.paymentMethod} — ${data.paymentRef}</td></tr>
            <tr><td style="padding:8px 0;color:#8a7d6e;border-bottom:1px solid #e8dfd0">Status</td><td style="padding:8px 0;font-weight:500;text-align:right;border-bottom:1px solid #e8dfd0">${data.paymentStatus}</td></tr>
            <tr><td style="padding:8px 0;color:#8a7d6e">Total</td><td style="padding:8px 0;font-weight:700;text-align:right;color:#b8860b">$${data.price}</td></tr>
          </table>
          ${data.notes && data.notes !== 'None' ? `<p style="margin-top:16px;font-size:13px;color:#8a7d6e">Notes: <span style="color:#1a1209">${data.notes}</span></p>` : ''}
          <p style="margin-top:20px;font-size:11px;color:#aaa">Glam Studio · Harare CBD</p>
        </div>`;

      customerBody = `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:20px">
          <h2 style="color:#1a1209">You're booked at Glam Studio! ✦</h2>
          <p style="color:#8a7d6e;font-size:14px">Hi ${data.name}, your appointment is confirmed. Here are your details:</p>
          <div style="background:#f5e9c8;border-radius:8px;padding:16px;text-align:center;margin:20px 0">
            <p style="font-size:11px;color:#b8860b;margin:0;text-transform:uppercase;letter-spacing:0.1em">Booking Reference</p>
            <p style="font-size:28px;font-weight:600;color:#1a1209;margin:4px 0;letter-spacing:2px">${data.ref}</p>
            <p style="font-size:12px;color:#8a7d6e;margin:0">Show this when you arrive</p>
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <tr><td style="padding:8px 0;color:#8a7d6e;border-bottom:1px solid #e8dfd0">Service</td><td style="padding:8px 0;font-weight:500;text-align:right;border-bottom:1px solid #e8dfd0">${data.service}</td></tr>
            <tr><td style="padding:8px 0;color:#8a7d6e;border-bottom:1px solid #e8dfd0">Date & Time</td><td style="padding:8px 0;font-weight:500;text-align:right;border-bottom:1px solid #e8dfd0">${data.datetime}</td></tr>
            <tr><td style="padding:8px 0;color:#8a7d6e;border-bottom:1px solid #e8dfd0">Duration</td><td style="padding:8px 0;font-weight:500;text-align:right;border-bottom:1px solid #e8dfd0">${data.duration} mins</td></tr>
            <tr><td style="padding:8px 0;color:#8a7d6e">Total</td><td style="padding:8px 0;font-weight:700;text-align:right;color:#b8860b">$${data.price}</td></tr>
          </table>
          <p style="margin-top:20px;font-size:13px;color:#8a7d6e">Please arrive 5 minutes early. If you need to reschedule, contact us on WhatsApp: <strong>+263 77 896 1269</strong></p>
          <p style="margin-top:20px;font-size:11px;color:#aaa">Glam Studio · Harare CBD · Appointments required</p>
        </div>`;

      operatorEmail = 'kdzvairo4@outlook.com';
      customerEmail = data.email || null;

    } else if (type === 'print_job') {
      // ── CAMPUSPRINT EMAILS ──────────────────────────────
      operatorSubject = `New Print Job ${data.jobNum} — ${data.location}`;
      customerSubject = `Your CampusPrint Job is Confirmed — ${data.jobNum}`;

      operatorBody = `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:20px;background:#f5f2eb">
          <div style="background:#0e0e0e;border-radius:12px;padding:20px;margin-bottom:16px">
            <h2 style="color:#2d9e5f;margin:0 0 4px;font-size:20px">Campus<span style="color:#fff">Print</span></h2>
            <p style="color:#999;font-size:11px;margin:0;font-family:monospace">New print job received</p>
          </div>
          <div style="background:#e8f5ee;border:1px dashed #1a6b3c;border-radius:8px;padding:16px;text-align:center;margin-bottom:16px">
            <p style="font-size:11px;color:#1a6b3c;margin:0;text-transform:uppercase;letter-spacing:0.1em">Job Number</p>
            <p style="font-size:28px;font-weight:800;color:#1a6b3c;margin:4px 0;letter-spacing:2px;font-family:monospace">${data.jobNum}</p>
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:13px;background:#fff;border-radius:8px;overflow:hidden">
            <tr><td style="padding:8px 12px;color:#6b6b6b;border-bottom:1px solid #ddd9cf;font-family:monospace;font-size:11px">KIOSK</td><td style="padding:8px 12px;font-weight:600;text-align:right;border-bottom:1px solid #ddd9cf">${data.location}</td></tr>
            <tr><td style="padding:8px 12px;color:#6b6b6b;border-bottom:1px solid #ddd9cf;font-family:monospace;font-size:11px">STUDENT ID</td><td style="padding:8px 12px;font-weight:600;text-align:right;border-bottom:1px solid #ddd9cf">${data.studentId}</td></tr>
            <tr><td style="padding:8px 12px;color:#6b6b6b;border-bottom:1px solid #ddd9cf;font-family:monospace;font-size:11px">FILE</td><td style="padding:8px 12px;font-weight:600;text-align:right;border-bottom:1px solid #ddd9cf">${data.fileName}</td></tr>
            <tr><td style="padding:8px 12px;color:#6b6b6b;border-bottom:1px solid #ddd9cf;font-family:monospace;font-size:11px">COPIES</td><td style="padding:8px 12px;font-weight:600;text-align:right;border-bottom:1px solid #ddd9cf">${data.copies} copies · ${data.paper} · ${data.sides}</td></tr>
            <tr><td style="padding:8px 12px;color:#6b6b6b;border-bottom:1px solid #ddd9cf;font-family:monospace;font-size:11px">PAYMENT</td><td style="padding:8px 12px;font-weight:600;text-align:right;border-bottom:1px solid #ddd9cf">${data.payment} — ${data.amount}</td></tr>
            <tr><td style="padding:8px 12px;color:#6b6b6b;border-bottom:1px solid #ddd9cf;font-family:monospace;font-size:11px">COLLECT BY</td><td style="padding:8px 12px;font-weight:600;text-align:right;border-bottom:1px solid #ddd9cf">${data.collectBy}</td></tr>
            <tr><td style="padding:8px 12px;color:#6b6b6b;font-family:monospace;font-size:11px">CONTACT</td><td style="padding:8px 12px;font-weight:600;text-align:right">${data.email} · ${data.phone}</td></tr>
          </table>
          <p style="margin-top:16px;font-size:11px;color:#aaa;font-family:monospace">CampusPrint · Campus kiosk printing</p>
        </div>`;

      customerBody = `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:20px">
          <div style="background:#0e0e0e;border-radius:12px;padding:20px;margin-bottom:16px">
            <h2 style="color:#2d9e5f;margin:0 0 4px;font-size:20px">Campus<span style="color:#fff">Print</span></h2>
            <p style="color:#999;font-size:11px;margin:0;font-family:monospace">Your print job is confirmed</p>
          </div>
          <div style="background:#e8f5ee;border:1px dashed #1a6b3c;border-radius:8px;padding:16px;text-align:center;margin-bottom:16px">
            <p style="font-size:11px;color:#1a6b3c;margin:0;text-transform:uppercase;letter-spacing:0.1em">Job Number</p>
            <p style="font-size:28px;font-weight:800;color:#1a6b3c;margin:4px 0;letter-spacing:2px;font-family:monospace">${data.jobNum}</p>
            <p style="font-size:12px;color:#6b6b6b;margin:0">Show this at the kiosk to collect your prints</p>
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:13px;background:#fff;border-radius:8px;overflow:hidden">
            <tr><td style="padding:8px 12px;color:#6b6b6b;border-bottom:1px solid #ddd9cf;font-size:11px">Kiosk</td><td style="padding:8px 12px;font-weight:600;text-align:right;border-bottom:1px solid #ddd9cf">${data.location}</td></tr>
            <tr><td style="padding:8px 12px;color:#6b6b6b;border-bottom:1px solid #ddd9cf;font-size:11px">File</td><td style="padding:8px 12px;font-weight:600;text-align:right;border-bottom:1px solid #ddd9cf">${data.fileName}</td></tr>
            <tr><td style="padding:8px 12px;color:#6b6b6b;border-bottom:1px solid #ddd9cf;font-size:11px">Copies</td><td style="padding:8px 12px;font-weight:600;text-align:right;border-bottom:1px solid #ddd9cf">${data.copies} × ${data.paper} · ${data.sides}</td></tr>
            <tr><td style="padding:8px 12px;color:#6b6b6b;border-bottom:1px solid #ddd9cf;font-size:11px">Amount Paid</td><td style="padding:8px 12px;font-weight:700;text-align:right;border-bottom:1px solid #ddd9cf;color:#1a6b3c">${data.amount}</td></tr>
            <tr><td style="padding:8px 12px;color:#6b6b6b;font-size:11px">Collect By</td><td style="padding:8px 12px;font-weight:600;text-align:right">${data.collectBy}</td></tr>
          </table>
          <p style="margin-top:16px;font-size:13px;color:#6b6b6b">Collect your prints within <strong>2 hours</strong>. If you have any issues contact us immediately.</p>
          <p style="margin-top:16px;font-size:11px;color:#aaa;font-family:monospace">CampusPrint · Campus kiosk printing</p>
        </div>`;

      operatorEmail = 'kdzvairo4@outlook.com';
      customerEmail = data.email || null;
    } else {
      return res.status(400).json({ error: 'Unknown email type' });
    }

    // Send operator notification
    const operatorRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'onboarding@resend.dev',
        to: [operatorEmail],
        subject: operatorSubject,
        html: operatorBody
      })
    });

    // Send customer confirmation if email provided
    if (customerEmail && customerEmail !== '—') {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'onboarding@resend.dev',
          to: [customerEmail],
          subject: customerSubject,
          html: customerBody
        })
      });
    }

    const result = await operatorRes.json();
    return res.status(200).json({ success: true, id: result.id });

  } catch (e) {
    console.error('Email error:', e);
    return res.status(500).json({ error: e.message });
  }
}
