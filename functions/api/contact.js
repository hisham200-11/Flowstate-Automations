/**
 * FlowState Automations - Cloudflare Pages Function
 * Endpoint: POST /api/contact
 *
 * Handles website direct contact / blueprint request submissions
 * and dispatches instant HTML email notifications to flowstateautom8t@gmail.com via Resend API.
 */

const DEFAULT_NOTIFICATION_EMAIL = 'flowstateautom8t@gmail.com';

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

export async function onRequestPost(context) {
  const { request, env, waitUntil } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  try {
    const body = await request.json();
    const {
      name = '',
      contact = '',
      businessScale = 'Not specified',
      notes = '',
      pageUrl = ''
    } = body;

    const cleanName = String(name || '').trim();
    const cleanContact = String(contact || '').trim();
    const cleanNotes = String(notes || '').trim();
    const cleanScale = String(businessScale || 'Not specified').trim();

    // Basic anti-spam & validation
    if (!isValidLeadName(cleanName)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Please provide a valid full name.' }),
        { status: 400, headers: corsHeaders }
      );
    }

    if (!isValidLeadContact(cleanContact)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Please provide a valid email address or phone number.' }),
        { status: 400, headers: corsHeaders }
      );
    }

    const leadData = {
      name: cleanName,
      contact: cleanContact,
      businessScale: cleanScale,
      notes: cleanNotes || 'No additional notes provided.',
      pageUrl: pageUrl || request.headers.get('Referer') || 'FlowState Website',
      timestamp: new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' }) + ' (PHT)'
    };

    // Dispatch email via Resend if API key is configured
    const resendKey = (env && env.RESEND_API_KEY) || (typeof RESEND_API_KEY !== 'undefined' ? RESEND_API_KEY : '');
    const targetEmail = (env && env.NOTIFICATION_EMAIL) || DEFAULT_NOTIFICATION_EMAIL;

    if (resendKey) {
      const emailPromise = sendContactNotificationEmail(resendKey, targetEmail, leadData);
      if (waitUntil) {
        waitUntil(emailPromise);
      } else {
        await emailPromise;
      }
    } else {
      console.warn('RESEND_API_KEY is not configured in Cloudflare environment variables. Lead logged to console:', leadData);
    }

    // Optional D1 logging if database binding exists
    if (env && env.DB && waitUntil) {
      waitUntil(logInquiryToD1(env.DB, leadData));
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Inquiry received successfully! Our solutions team will reach out within 24 hours.'
      }),
      { status: 200, headers: corsHeaders }
    );
  } catch (err) {
    console.error('Contact endpoint error:', err);
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Unable to process your inquiry right now. Please email us directly at flowstateautom8t@gmail.com'
      }),
      { status: 500, headers: corsHeaders }
    );
  }
}

/**
 * Dispatches a formatted HTML email alert to the founder
 */
async function sendContactNotificationEmail(apiKey, toEmail, lead) {
  try {
    const isPhone = /^(\+?[0-9\s\-]+)$/.test(lead.contact);
    const contactLink = isPhone 
      ? `<a href="tel:${escapeHtml(lead.contact)}" style="color: #2563eb; text-decoration: none; font-weight: 700;">${escapeHtml(lead.contact)}</a>`
      : `<a href="mailto:${escapeHtml(lead.contact)}" style="color: #2563eb; text-decoration: none; font-weight: 700;">${escapeHtml(lead.contact)}</a>`;

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #0f172a; line-height: 1.6; background-color: #f8fafc; margin: 0; padding: 24px; }
          .card { background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; padding: 28px; max-width: 600px; margin: 0 auto; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
          .header { border-bottom: 2px solid #0f172a; padding-bottom: 16px; margin-bottom: 20px; }
          .badge { display: inline-block; background: #f1f5f9; color: #0f172a; font-size: 11px; font-weight: 800; padding: 4px 10px; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.8px; border: 1px solid #cbd5e1; }
          h2 { margin: 12px 0 4px 0; color: #0f172a; font-size: 22px; font-weight: 800; }
          .lead-table { width: 100%; border-collapse: collapse; margin: 20px 0; background: #f8fafc; border-radius: 8px; overflow: hidden; border: 1px solid #e2e8f0; }
          .lead-table td { padding: 12px 16px; font-size: 14px; border-bottom: 1px solid #e2e8f0; }
          .lead-table td.label { font-weight: 600; color: #64748b; width: 140px; }
          .lead-table td.val { font-weight: 600; color: #0f172a; }
          .notes-box { background: #0f172a; color: #f8fafc; padding: 18px; border-radius: 8px; font-size: 14px; line-height: 1.6; margin-top: 16px; word-break: break-word; }
          .footer { margin-top: 24px; font-size: 12px; color: #94a3b8; text-align: center; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="header">
            <span class="badge">Direct Website Inquiry</span>
            <h2>New Proposal Request</h2>
            <p style="margin: 0; color: #64748b; font-size: 14px;">A prospect just submitted the consultation / blueprint request form on your website.</p>
          </div>

          <table class="lead-table">
            <tr>
              <td class="label">👤 Full Name</td>
              <td class="val">${escapeHtml(lead.name)}</td>
            </tr>
            <tr>
              <td class="label">📞 Contact</td>
              <td class="val">${contactLink}</td>
            </tr>
            <tr>
              <td class="label">🏢 Inquiry Scale</td>
              <td class="val">${escapeHtml(lead.businessScale)}</td>
            </tr>
            <tr>
              <td class="label">⏱️ Time (PHT)</td>
              <td class="val">${escapeHtml(lead.timestamp)}</td>
            </tr>
            <tr>
              <td class="label">🌐 Source Page</td>
              <td class="val">${escapeHtml(lead.pageUrl)}</td>
            </tr>
          </table>

          <h3 style="font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; margin: 20px 0 8px 0; color: #475569;">📝 Project Notes & Bottlenecks:</h3>
          <div class="notes-box">
            ${escapeHtml(lead.notes).replace(/\n/g, '<br>')}
          </div>

          <div class="footer">
            FlowState Automations • Lead Dispatcher • Delivered via Resend
          </div>
        </div>
      </body>
      </html>
    `;

    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'FlowState Inquiries <onboarding@resend.dev>',
        to: [toEmail],
        subject: `🔥 New Website Inquiry: ${lead.name} (${lead.businessScale || 'Direct Consultation'})`,
        html: htmlContent,
      }),
    });

    if (!resendResponse.ok) {
      const errBody = await resendResponse.text();
      console.error('Resend contact email dispatch failed:', resendResponse.status, errBody);
    }
  } catch (err) {
    console.error('Failed to send contact notification email via Resend:', err);
  }
}

/**
 * Optional D1 Logger for inquiries
 */
async function logInquiryToD1(db, lead) {
  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS contact_inquiries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        contact TEXT,
        business_scale TEXT,
        notes TEXT,
        page_url TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();

    await db.prepare(`
      INSERT INTO contact_inquiries (name, contact, business_scale, notes, page_url)
      VALUES (?, ?, ?, ?, ?)
    `).bind(
      lead.name,
      lead.contact,
      lead.businessScale,
      lead.notes,
      lead.pageUrl
    ).run();
  } catch (err) {
    console.warn('D1 contact inquiry log error:', err);
  }
}

function isValidLeadName(name) {
  if (!name || typeof name !== 'string') return false;
  const clean = name.trim();
  if (clean.length < 2 || clean.length > 50) return false;
  
  const trollList = [
    'null', 'unknown', 'none', 'n/a', 'anonymous', 'visitor', 'test', 'asdf',
    'admin', 'user', 'mind your own business', 'batman', 'your mom', 'nobody', 'no one'
  ];
  if (trollList.some((t) => clean.toLowerCase().includes(t))) return false;
  return /^[a-zA-Z\u00C0-\u024F\s\.\-']{2,50}$/.test(clean);
}

function isValidLeadContact(contact) {
  if (!contact || typeof contact !== 'string') return false;
  const clean = contact.trim().replace(/[\s\-\(\)]/g, '');
  if (clean.length < 7 || clean.length > 50) return false;
  
  if (/^(\d)\1+$/.test(clean)) return false;
  if (clean === '1234567890' || clean === '0123456789' || clean === '9876543210') return false;
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  if (emailRegex.test(clean)) return true;
  
  const phoneRegex = /^(\+?[1-9]\d{7,14}|09\d{9})$/;
  return phoneRegex.test(clean);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
