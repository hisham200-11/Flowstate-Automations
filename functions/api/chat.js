/**
 * FlowState Automations - Cloudflare Pages Function
 * Endpoint: POST /api/chat
 *
 * Powered by Groq (llama-3.3-70b-versatile)
 * Persists message & lead logs to Cloudflare D1
 * Dispatches instant email alerts via Resend to flowstateautom8t@gmail.com
 */

const DEFAULT_NOTIFICATION_EMAIL = 'flowstateautom8t@gmail.com';
const DEFAULT_GROQ_MODEL = 'llama-3.3-70b-versatile';

// Whitelisted chat models known to work reliably on Groq
const TRUSTED_CHAT_MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'llama3-70b-8192',
  'llama3-8b-8192',
  'mixtral-8x7b-32768',
  'gemma2-9b-it'
];

const SYSTEM_PROMPT = `You are the interactive live assistant for FlowState Automations (founded by Hisham).
Your job is to be living proof of our core claim: sub-2-second, intelligent, conversational automation that turns website visitors & social media inquirers into paying clients.

CORE IDENTITY & TONE:
- Sharp, confident, friendly, and helpful. You sound like a knowledgeable consultant, NOT a boring robot.
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
Only emit the LEAD_CAPTURED tag when the visitor has explicitly provided BOTH:
1. Their Name (or first name)
2. A real contact method (Email address, Phone number, or WhatsApp number).

- If they give a name without contact info, warmly ask for their best WhatsApp, phone, or email.
- If they give an email/phone without a name, ask what name to address the demo to.
- When BOTH Name AND real Contact are present, warmly confirm (e.g. "Got it, [Name]! I've sent your details to Hisham. He'll have your custom demo preview ready shortly.") and append this exact tag on a new line at the very bottom:
LEAD_CAPTURED:{"name":"[Visitor Name]","contact":"[Phone/Email/WhatsApp]","business":"[Business Name or Unknown]","interest":"[Chatbot / Custom Software / General]","summary":"[1-sentence summary]"}

CRITICAL: Do NOT mention or print the LEAD_CAPTURED tag in your visible message text. Only append it at the very bottom on its own line. Do NOT output <think> tags.`;

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

    const selectedModel = env.GROQ_MODEL || DEFAULT_GROQ_MODEL;

    // Prepare message payload for Groq OpenAI-compatible endpoint
    const makePayload = (modelName) => ({
      model: modelName,
      messages: [
        {
          role: 'system',
          content: SYSTEM_PROMPT + '\nCRITICAL: Do NOT output <think> tags or internal reasoning steps. Output ONLY the direct final conversational reply to the visitor.'
        },
        ...messages.map((m) => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: String(m.content || ''),
        })),
      ],
      temperature: 0.6,
      max_tokens: 450,
      top_p: 0.9,
    });

    const startTime = Date.now();
    let groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(makePayload(selectedModel)),
    });

    // If initial model request fails with 404 or 400, dynamically find another trusted model
    if (!groqResponse.ok) {
      const initialErr = await groqResponse.text();
      console.warn(`Initial model ${selectedModel} failed (${groqResponse.status}): ${initialErr}`);

      try {
        const modelsRes = await fetch('https://api.groq.com/openai/v1/models', {
          headers: { 'Authorization': `Bearer ${apiKey}` },
        });

        if (modelsRes.ok) {
          const modelsData = await modelsRes.json();
          const availableIds = (modelsData.data || []).map((m) => m.id);

          // Find the first trusted chat model that is available
          const dynamicModel = TRUSTED_CHAT_MODELS.find((m) => availableIds.includes(m)) || 'llama-3.1-8b-instant';

          if (dynamicModel && dynamicModel !== selectedModel) {
            console.log(`Retrying with trusted chat model: ${dynamicModel}`);
            groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(makePayload(dynamicModel)),
            });
          }
        }
      } catch (err) {
        console.error('Dynamic model lookup error:', err);
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
    let rawReply = groqData.choices?.[0]?.message?.content || "Thanks for your message! How else can FlowState help your business today?";
    const responseTimeMs = Date.now() - startTime;

    // Clean internal thinking tags (from DeepSeek R1 or reasoning models)
    rawReply = rawReply.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    rawReply = rawReply.replace(/^<think>[\s\S]*$/gi, '').trim();

    // Detect and extract LEAD_CAPTURED tag
    let cleanReply = rawReply;
    let leadCaptured = false;
    let leadData = null;

    const leadRegex = /LEAD_CAPTURED:\s*(\{.*\})/s;
    const match = rawReply.match(leadRegex);

    if (match && match[1]) {
      try {
        const parsed = JSON.parse(match[1].trim());
        cleanReply = rawReply.replace(leadRegex, '').trim();

        // Strict validation: BOTH a valid name AND real contact info required
        const nameVal = String(parsed.name || '').trim();
        const contactVal = String(parsed.contact || '').trim();

        const isInvalidName = !nameVal || ['unknown', 'none', 'n/a', 'anonymous', 'visitor'].includes(nameVal.toLowerCase());
        const isInvalidContact = !contactVal || contactVal.length < 5 || ['unknown', 'none', 'n/a'].includes(contactVal.toLowerCase());

        if (!isInvalidName && !isInvalidContact) {
          leadData = parsed;
          leadCaptured = true;
        } else {
          console.log('Ignored incomplete lead tag:', parsed);
        }
      } catch (err) {
        console.warn('Failed to parse lead captured JSON:', err);
      }
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
