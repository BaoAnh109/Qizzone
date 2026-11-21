import {
  bodyJson,
  cors,
  databaseAdmin,
  failure,
  identity,
  requireProfileAndRole,
  respond,
  structuredLog,
} from '../_shared/server.ts';

const VIETNAM_TZ = 'Asia/Ho_Chi_Minh';
const MAX_ATTEMPTS = 5;
const BREVO_SEND_URL = 'https://api.brevo.com/v3/smtp/email';

function renderTemplate(template: string, payload: Record<string, unknown>): string {
  return template.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key) => {
    const raw = payload[key];
    if (raw === undefined || raw === null) return '';
    return String(raw)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  });
}

function vietnamDayStartIso(now = new Date()): string {
  const vnDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: VIETNAM_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return `${vnDate}T00:00:00+07:00`;
}

function computeNextRetryIso(attemptCount: number): string {
  const delaySec = Math.min(3600, 30 * Math.pow(2, Math.max(0, attemptCount - 1)));
  return new Date(Date.now() + delaySec * 1000).toISOString();
}

function parseSender(rawEmail: string | undefined, rawName: string | undefined): { name: string; email: string } {
  const fallbackName = rawName?.trim() || 'Qizzone';
  const trimmed = rawEmail?.trim() || 'no-reply@qizzone.edu.vn';
  const angleMatch = trimmed.match(/^(.+?)\s*<([^<>\s]+@[^<>\s]+)>$/);
  if (angleMatch) {
    return {
      name: angleMatch[1].replace(/^["']|["']$/g, '').trim() || fallbackName,
      email: angleMatch[2].trim(),
    };
  }
  return { name: fallbackName, email: trimmed };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors(req) });
  if (req.method !== 'POST') return respond(req, { error: 'Method not allowed' }, 405);
  const requestId = req.headers.get('x-correlation-id') || crypto.randomUUID();

  try {
    const cronSecret = Deno.env.get('CRON_SECRET')?.trim();
    const providedCronSecret = req.headers.get('x-cron-secret')?.trim();
    const isInternalCron = Boolean(cronSecret && providedCronSecret && providedCronSecret === cronSecret);

    const db = databaseAdmin();
    if (!isInternalCron) {
      const auth = await identity(req);
      await requireProfileAndRole(db, auth, ['admin']);
    }

    const body = (await bodyJson(req, 4096).catch(() => ({}))) as {
      limit?: unknown;
      dryRun?: unknown;
    };
    const batchLimit =
      typeof body.limit === 'number' && Number.isInteger(body.limit) && body.limit > 0 && body.limit <= 50
        ? body.limit
        : 20;
    const dryRun = body.dryRun === true;

    const brevoApiKey = Deno.env.get('BREVO_API_KEY')?.trim();
    const sender = parseSender(
      Deno.env.get('BREVO_FROM_EMAIL'),
      Deno.env.get('BREVO_FROM_NAME'),
    );
    if (!brevoApiKey && !dryRun) {
      throw new Error('BREVO_NOT_CONFIGURED');
    }

    const dailyCap = Number(Deno.env.get('BREVO_DAILY_LIMIT') || 300);
    const { count: sentTodayCount, error: countErr } = await db
      .from('notification_delivery_logs')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'sent')
      .gte('delivered_at', vietnamDayStartIso());
    if (countErr) throw countErr;

    const remainingDaily = Math.max(0, dailyCap - (sentTodayCount || 0));
    if (remainingDaily === 0) {
      structuredLog('warn', { requestId, event: 'email_daily_cap_reached', dailyCap });
      return respond(req, { processed: 0, sent: 0, skippedQuota: true }, 200, requestId);
    }

    const effectiveLimit = Math.min(batchLimit, remainingDaily);
    const nowIso = new Date().toISOString();
    const { data: candidates, error: fetchErr } = await db
      .from('notification_outbox')
      .select('*')
      .in('status', ['pending', 'retry'])
      .lte('scheduled_at', nowIso)
      .or(`next_attempt_at.is.null,next_attempt_at.lte.${nowIso}`)
      .order('scheduled_at', { ascending: true })
      .limit(effectiveLimit);
    if (fetchErr) throw fetchErr;

    let sent = 0;
    let retried = 0;
    let deadLettered = 0;

    for (const item of candidates || []) {
      const { data: template } = await db
        .from('notification_templates')
        .select('*')
        .eq('code', item.template_code)
        .maybeSingle();

      if (!template) {
        await db
          .from('notification_outbox')
          .update({ status: 'dead_letter', last_error: 'MISSING_TEMPLATE', updated_at: new Date().toISOString() })
          .eq('id', item.id);
        deadLettered++;
        continue;
      }

      const payload = (item.payload || {}) as Record<string, unknown>;
      const subject = renderTemplate(template.subject_template, payload);
      const html = renderTemplate(template.html_template, payload);

      if (dryRun) {
        sent++;
        continue;
      }

      const claimNow = new Date().toISOString();
      const { data: claimed, error: claimErr } = await db
        .from('notification_outbox')
        .update({ status: 'processing', updated_at: claimNow })
        .eq('id', item.id)
        .in('status', ['pending', 'retry'])
        .select('id')
        .maybeSingle();
      if (claimErr) throw claimErr;
      if (!claimed) {
        continue;
      }

      const nextAttempt = Number(item.attempt_count || 0) + 1;
      try {
        const res = await fetch(BREVO_SEND_URL, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'api-key': brevoApiKey!,
          },
          body: JSON.stringify({
            sender,
            to: [{ email: item.recipient_email }],
            subject,
            htmlContent: html,
            headers: {
              'X-Qizzone-Idempotency-Key': item.idempotency_key,
            },
          }),
          signal: AbortSignal.timeout(15_000),
        });

        const resJson = (await res.json().catch(() => ({}))) as {
          messageId?: string;
          message?: string;
          code?: string;
        };
        if (res.ok && resJson.messageId) {
          await Promise.all([
            db
              .from('notification_outbox')
              .update({
                status: 'sent',
                attempt_count: nextAttempt,
                provider_message_id: resJson.messageId,
                last_error: null,
                updated_at: new Date().toISOString(),
              })
              .eq('id', item.id),
            db.from('notification_delivery_logs').insert({
              outbox_id: item.id,
              provider: 'brevo',
              provider_message_id: resJson.messageId,
              status: 'sent',
            }),
          ]);
          sent++;
        } else {
          const isTerminal =
            nextAttempt >= MAX_ATTEMPTS ||
            (res.status >= 400 && res.status < 429 && res.status !== 408);
          const nextStatus = isTerminal ? 'dead_letter' : 'retry';
          const errText = `HTTP_${res.status}:${resJson.code || resJson.message || 'brevo_error'}`.slice(0, 300);
          await Promise.all([
            db
              .from('notification_outbox')
              .update({
                status: nextStatus,
                attempt_count: nextAttempt,
                next_attempt_at: isTerminal ? null : computeNextRetryIso(nextAttempt),
                last_error: errText,
                updated_at: new Date().toISOString(),
              })
              .eq('id', item.id),
            db.from('notification_delivery_logs').insert({
              outbox_id: item.id,
              provider: 'brevo',
              status: nextStatus,
              error_message: errText,
            }),
          ]);
          if (isTerminal) deadLettered++;
          else retried++;
        }
      } catch (sendErr) {
        const isTerminal = nextAttempt >= MAX_ATTEMPTS;
        const nextStatus = isTerminal ? 'dead_letter' : 'retry';
        const errText = sendErr instanceof Error ? sendErr.message.slice(0, 300) : 'SEND_FAILED';
        await db
          .from('notification_outbox')
          .update({
            status: nextStatus,
            attempt_count: nextAttempt,
            next_attempt_at: isTerminal ? null : computeNextRetryIso(nextAttempt),
            last_error: errText,
            updated_at: new Date().toISOString(),
          })
          .eq('id', item.id);
        if (isTerminal) deadLettered++;
        else retried++;
      }
    }

    structuredLog('info', {
      requestId,
      event: 'dispatch_email',
      provider: 'brevo',
      processed: (candidates || []).length,
      sent,
      retried,
      deadLettered,
      dryRun,
    });

    return respond(
      req,
      { processed: (candidates || []).length, sent, retried, deadLettered, dryRun },
      200,
      requestId,
    );
  } catch (error) {
    return failure(req, error, requestId);
  }
});
