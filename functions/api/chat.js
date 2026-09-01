/**
 * FlowState Automations - Cloudflare Pages Function
 * Endpoint: POST /api/chat
 *
 * Aligned with chatbot-webhook architecture:
 * - Groq JSON Object Mode (response_format: { type: 'json_object' })
 * - Model: openai/gpt-oss-120b with fallback to llama-3.3-70b-versatile
 * - Cloudflare D1 Logging
 * - Resend Email Notifications to flowstateautom8t@gmail.com
 */

const DEFAULT_NOTIFICATION_EMAIL = 'flowstateautom8t@gmail.com';
const PRIMARY_MODEL = 'openai/gpt-oss-120b';
const FALLBACK_MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'];

const SYSTEM_PROMPT = `You are the interactive live assistant for FlowState Automations (founded by Hisham).
Your job is to be living proof of our core claim: sub-2-second, intelligent, conversational automation that turns website visitors & social media inquirers into paying clients.

CORE IDENTITY & TONE:
- Sharp, confident, friendly, and helpful. You sound like a knowledgeable consultant, NOT a robot.
- Crisp and concise: 2 to 4 sentences maximum per reply. Keep conversations snappy and interactive.
- Language Matching: Automatically detect and match the visitor's language. If they speak English, reply in crisp English. If they speak Tagalog or Taglish, reply in natural, authentic conversational Taglish/Filipino.

WHAT FLOWSTATE AUTOMATIONS BUILDS:
1. Instant Social Media Chat Responders (Facebook Messenger, Instagram DM, WhatsApp):
   - Answers pricing, services, and FAQ questions in under 2 seconds, 24/7/365.
   - Captures lead names, phone numbers, and requirements straight into Google Sheets or CRMs.
   - Auto-books appointments and consultations directly on team calendars.
2. Custom Software & Workflow Automation:
   - Internal business dashboards, lead discovery scrapers, API integrations, and database tooling.
3. Risk-Free Guarantee:
   - We build a free, live interactive prototype demo for their specific business before any upfront commitment.

CONVERSATION FLOW & OBJECTIVES:
1. Acknowledge their question immediately with enthusiasm and proof of speed.
2. Explain how our automation solves their problem (e.g. for Facebook ads: replying instantly in Messenger, collecting phone numbers to Google Sheets, and booking appointments 24/7).
3. Ask for their business niche or current setup.
4. Address pricing honestly: "Pricing is tiered based on monthly conversation volume, but we always start with a free, risk-free live prototype so you can test it on your actual page first."
5. Guide them toward sharing BOTH their Name and Contact Info (Email, WhatsApp, or Phone number) so Hisham can build their custom live demo.

STRICT LEAD CAPTURE RULE:
- Only set "is_lead_captured" to true when the visitor has provided BOTH a valid Name AND real Contact Info (Email, Phone number, or WhatsApp).
- If they give only a name, ask for their email/phone to send the live demo.
- If they give only an email/phone, ask what name to address the demo to.
- When BOTH are present, set "is_lead_captured": true and warmly confirm that Hisham will prepare their demo.

OUTPUT FORMAT:
You MUST ALWAYS respond with a valid JSON object matching this exact schema:
{
  "reply_text": "Your 2-4 sentence conversational reply to the visitor",
  "visitor_name": "Visitor name if provided, else null",
  "visitor_contact": "Phone/Email/WhatsApp if provided, else null",
  "business_name": "Business name if mentioned, else null",
  "interest": "Chatbot / Custom Software / General",
  "summary": "1-sentence summary of inquiry",
  "is_lead_captured": true or false
}`;

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
    const { messages = [], sessionId = 'anon-' + Date.now(), pageUrl = '' } = body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Messages array is required.' }),
        { status: 400, headers: corsHeaders }
      );
    }

    const latestUserMessage = messages[messages.length - 1]?.content || '';

    // Asynchronously log incoming user message to D1
    if (env.DB && waitUntil) {
      waitUntil(
        logMessageToD1(env.DB, sessionId, 'user', latestUserMessage, pageUrl)
      );
    }

    // Determine Groq API Key
    const apiKey = env.GROQ_API_KEY || (typeof GROQ_API_KEY !== 'undefined' ? GROQ_API_KEY : '');
    if (!apiKey) {
      return new Response(
        JSON.stringify({
          reply: "I'm currently running in preview mode. To activate my live Groq engine, please set the GROQ_API_KEY in your Cloudflare Pages dashboard!",
          leadCaptured: false,
        }),
        { status: 200, headers: corsHeaders }
      );
    }

    const targetModel = env.GROQ_MODEL || PRIMARY_MODEL;

    // Build payload with JSON Object mode
    const makePayload = (modelName) => ({
      model: modelName,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...messages.map((m) => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: String(m.content || ''),
        })),
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7,
      max_tokens: 1024,
    });

    const startTime = Date.now();
    let groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(makePayload(targetModel)),
    });

    // Fallback through trusted models if initial model fails
    if (!groqResponse.ok) {
      const initialErr = await groqResponse.text();
      console.warn(`Primary model ${targetModel} failed (${groqResponse.status}): ${initialErr}`);

      for (const fallbackModel of FALLBACK_MODELS) {
        if (fallbackModel === targetModel) continue;
        console.log(`Retrying with fallback model: ${fallbackModel}`);

        groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(makePayload(fallbackModel)),
        });

        if (groqResponse.ok) break;
      }
    }

    if (!groqResponse.ok) {
      const errorText = await groqResponse.text();
      console.error('Groq API Final Error:', groqResponse.status, errorText);

      if (env.DB && waitUntil) {
        waitUntil(
          logErrorToD1(
            env.DB,
            sessionId,
            `Groq API ${groqResponse.status}: ${errorText} [Key: ${apiKey.slice(0, 8)}...${apiKey.slice(-4)}]`
          )
        );
      }

      return new Response(
        JSON.stringify({
          reply: "I apologize, my neural link hit a slight blip. Feel free to reach Hisham directly at flowstateautom8t@gmail.com or try asking again!",
          leadCaptured: false,
        }),
        { status: 200, headers: corsHeaders }
      );
    }

    const groqData = await groqResponse.json();
    const rawContent = groqData.choices?.[0]?.message?.content || '{}';
    const responseTimeMs = Date.now() - startTime;

    let parsedResult = {};
    try {
      parsedResult = JSON.parse(rawContent);
    } catch (e) {
      console.warn('Failed to parse JSON response, using raw content:', rawContent);
      parsedResult = { reply_text: rawContent };
    }

    const cleanReply = parsedResult.reply_text || "Thanks for your inquiry! How can FlowState help your business today?";

    // Validate lead details
    let leadCaptured = false;
    let leadData = null;

    const nameVal = String(parsedResult.visitor_name || '').trim();
    const contactVal = String(parsedResult.visitor_contact || '').trim();

    const isInvalidName = !nameVal || ['null', 'unknown', 'none', 'n/a', 'anonymous', 'visitor'].includes(nameVal.toLowerCase());
    const isInvalidContact = !contactVal || contactVal.length < 5 || ['null', 'unknown', 'none', 'n/a'].includes(contactVal.toLowerCase());

    if (parsedResult.is_lead_captured && !isInvalidName && !isInvalidContact) {
      leadCaptured = true;
      leadData = {
        name: nameVal,
        contact: contactVal,
        business: parsedResult.business_name || 'Not specified',
        interest: parsedResult.interest || 'Chatbot',
        summary: parsedResult.summary || 'Lead captured via website chat.',
      };
    }

    // Background asynchronous actions (D1 logging + Resend email dispatch)
    if (waitUntil) {
      const backgroundTasks = [];

      // 1. Log assistant reply in D1
      if (env.DB) {
        backgroundTasks.push(
          logMessageToD1(env.DB, sessionId, 'assistant', cleanReply, pageUrl)
        );
      }

      // 2. Process strictly validated lead
      if (leadCaptured && leadData) {
        if (env.DB) {
          backgroundTasks.push(saveLeadToD1(env.DB, sessionId, leadData));
        }

        // Send email alert via Resend
        const resendKey = env.RESEND_API_KEY || (typeof RESEND_API_KEY !== 'undefined' ? RESEND_API_KEY : '');
        const targetEmail = env.NOTIFICATION_EMAIL || DEFAULT_NOTIFICATION_EMAIL;

        if (resendKey) {
          backgroundTasks.push(
            sendLeadAlertEmail(resendKey, targetEmail, leadData, messages, cleanReply, sessionId)
          );
        } else {
          console.warn('RESEND_API_KEY not configured. Skipping email alert dispatch.');
        }
      }

      waitUntil(Promise.allSettled(backgroundTasks));
    }

    return new Response(
      JSON.stringify({
        reply: cleanReply,
        leadCaptured,
        responseTimeMs,
      }),
      { status: 200, headers: corsHeaders }
    );
  } catch (error) {
    console.error('Chat function unhandled error:', error);
    return new Response(
      JSON.stringify({
        reply: "Oops, something went wrong on our end. Please reach out to flowstateautom8t@gmail.com directly!",
        error: error.message,
      }),
      { status: 500, headers: corsHeaders }
    );
  }
}

/**
 * Save chat turn to Cloudflare D1
 */
async function logMessageToD1(db, sessionId, role, content, pageUrl) {
  try {
    await db
      .prepare(
        'INSERT INTO chat_messages (session_id, role, content, page_url) VALUES (?, ?, ?, ?)'
      )
      .bind(sessionId, role, content, pageUrl || '')
      .run();
  } catch (err) {
    console.error('Failed to log message to D1:', err);
  }
}

/**
 * Save lead capture to Cloudflare D1
 */
async function saveLeadToD1(db, sessionId, leadData) {
  try {
    await db
      .prepare(
        'INSERT INTO leads (session_id, name, contact, business_name, interest, summary, raw_json) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .bind(
        sessionId,
        leadData.name || 'Unknown',
        leadData.contact || '',
        leadData.business || 'Unknown',
        leadData.interest || 'Chatbot',
        leadData.summary || '',
        JSON.stringify(leadData)
      )
      .run();
  } catch (err) {
    console.error('Failed to save lead to D1:', err);
  }
}

/**
 * Log error event to Cloudflare D1
 */
async function logErrorToD1(db, sessionId, errorMessage, stack = '') {
  try {
    await db
      .prepare(
        'INSERT INTO chat_errors (session_id, error_message, stack) VALUES (?, ?, ?)'
      )
      .bind(sessionId, errorMessage, stack)
      .run();
  } catch (err) {
    console.error('Failed to log error to D1:', err);
  }
}

/**
 * Dispatches an instant HTML email alert to the founder via Resend API
 */
async function sendLeadAlertEmail(apiKey, toEmail, leadData, conversationHistory, latestReply, sessionId) {
  try {
    const formattedChat = conversationHistory
      .map((m) => `<b>${m.role === 'user' ? '👤 Visitor' : '🤖 FlowState AI'}:</b> ${escapeHtml(m.content)}`)
      .join('<br><br>');

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #0f172a; line-height: 1.6; background-color: #f8fafc; margin: 0; padding: 24px; }
          .card { background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; padding: 28px; max-width: 600px; margin: 0 auto; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
          .header { border-bottom: 2px solid #2563eb; padding-bottom: 16px; margin-bottom: 20px; }
          .badge { display: inline-block; background: #dbeafe; color: #1e40af; font-size: 12px; font-weight: 700; padding: 4px 10px; border-radius: 20px; text-transform: uppercase; letter-spacing: 0.5px; }
          h2 { margin: 12px 0 4px 0; color: #0f172a; font-size: 22px; }
          .lead-table { width: 100%; border-collapse: collapse; margin: 20px 0; background: #f8fafc; border-radius: 8px; overflow: hidden; border: 1px solid #e2e8f0; }
          .lead-table td { padding: 12px 16px; font-size: 14px; border-bottom: 1px solid #e2e8f0; }
          .lead-table td.label { font-weight: 600; color: #64748b; width: 140px; }
          .lead-table td.val { font-weight: 600; color: #0f172a; }
          .lead-table td.contact-val { color: #2563eb; font-size: 16px; }
          .chat-box { background: #0f172a; color: #f1f5f9; padding: 18px; border-radius: 8px; font-size: 13px; line-height: 1.6; margin-top: 16px; max-height: 320px; overflow-y: auto; }
          .footer { margin-top: 24px; font-size: 12px; color: #94a3b8; text-align: center; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="header">
            <span class="badge">🔥 New Website Lead</span>
            <h2>FlowState Live Chat Alert</h2>
            <p style="margin: 0; color: #64748b; font-size: 14px;">A new prospect just requested information through your website chatbot!</p>
          </div>

          <table class="lead-table">
            <tr>
              <td class="label">👤 Name</td>
              <td class="val">${escapeHtml(leadData.name || 'Not provided')}</td>
            </tr>
            <tr>
              <td class="label">📞 Contact</td>
              <td class="val contact-val"><strong>${escapeHtml(leadData.contact || 'Not provided')}</strong></td>
            </tr>
            <tr>
              <td class="label">🏢 Business</td>
              <td class="val">${escapeHtml(leadData.business || 'Not specified')}</td>
            </tr>
            <tr>
              <td class="label">🎯 Interest</td>
              <td class="val">${escapeHtml(leadData.interest || 'Instant Chatbot / Automation')}</td>
            </tr>
            <tr>
              <td class="label">📝 Summary</td>
              <td class="val">${escapeHtml(leadData.summary || 'Lead captured during chat session.')}</td>
            </tr>
          </table>

          <h3 style="font-size: 15px; margin: 20px 0 8px 0; color: #334155;">💬 Conversation Transcript:</h3>
          <div class="chat-box">
            ${formattedChat}
            <br><br><b>🤖 FlowState AI:</b> ${escapeHtml(latestReply)}
          </div>

          <div class="footer">
            Session ID: ${sessionId} • FlowState Automations Bot • Delivered via Resend
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
        from: 'FlowState Leads <onboarding@resend.dev>',
        to: [toEmail],
        subject: `🔥 New Lead Captured: ${leadData.name || 'Visitor'} (${leadData.contact || 'Website'})`,
        html: htmlContent,
      }),
    });

    if (!resendResponse.ok) {
      const errBody = await resendResponse.text();
      console.error('Resend dispatch failed:', resendResponse.status, errBody);
    }
  } catch (err) {
    console.error('Failed to send Resend email:', err);
  }
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
