-- ═══════════════════════════════════════════════════════════════════
-- Virgo AI — Sicherheits-/Betriebs-Schema (bitte einmal im Supabase-SQL-Editor ausführen)
-- ═══════════════════════════════════════════════════════════════════
-- Ohne diese Migration funktionieren:
--   • atomarer Credit-Abzug (chat, generate-image, tools/tts, film)
--   • Rate-Limiting (alle Endpoints)
--   • Stripe-Webhook-Idempotenz
-- Die Code-Helper fallen bei fehlender Migration auf einen best-effort
-- In-Memory-Modus zurück (nur Rate-Limit) bzw. antworten mit 500 (Credits).
-- ═══════════════════════════════════════════════════════════════════

-- ── 1) ATOMARER CREDIT-ABZUG ──────────────────────────────────────
-- Zieht `p_amount` Credits von `p_user_id` ab, wenn genügend vorhanden.
-- Race-free: das UPDATE nutzt eine atomare Zeilen-Sperre.
-- Rückgabe: (success bool, credits int)  → credits = neuer Stand oder aktueller.
create or replace function deduct_credits(p_user_id uuid, p_amount int)
returns table(success boolean, credits int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new int;
begin
  if p_amount is null or p_amount <= 0 then
    return query select false, coalesce((select u.credits from users u where u.id = p_user_id), 0);
    return;
  end if;

  update users
     set credits = credits - p_amount
   where id = p_user_id
     and credits >= p_amount
   returning credits into v_new;

  if not found then
    return query select false, coalesce((select u.credits from users u where u.id = p_user_id), 0);
  else
    return query select true, v_new;
  end if;
end;
$$;

revoke all on function deduct_credits(uuid, int) from public;
grant execute on function deduct_credits(uuid, int) to service_role;

-- ── 2) RATE-LIMIT-STORE ───────────────────────────────────────────
create table if not exists rate_limits (
  key           text primary key,
  window_start  timestamptz not null default now(),
  count         int         not null default 0
);

-- Sliding-Fixed-Window: pro Key wird bei Ablauf des Fensters neu gestartet.
-- Rückgabe: (allowed bool, remaining int)
create or replace function rl_check(p_key text, p_window_seconds int, p_max int)
returns table(allowed boolean, remaining int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start timestamptz;
  v_count int;
begin
  insert into rate_limits(key, window_start, count)
       values (p_key, now(), 1)
  on conflict (key) do update
     set window_start = case
           when now() - rate_limits.window_start > make_interval(secs => p_window_seconds)
             then now()
           else rate_limits.window_start
         end,
         count = case
           when now() - rate_limits.window_start > make_interval(secs => p_window_seconds)
             then 1
           else rate_limits.count + 1
         end
  returning rate_limits.window_start, rate_limits.count into v_start, v_count;

  return query select (v_count <= p_max), greatest(0, p_max - v_count);
end;
$$;

revoke all on function rl_check(text, int, int) from public;
grant execute on function rl_check(text, int, int) to service_role;

-- Optional: alte Buckets aufräumen (>24h). Cron oder manuell.
create or replace function rl_gc()
returns void language sql security definer as $$
  delete from rate_limits where window_start < now() - interval '24 hours';
$$;

-- ── 3) STRIPE-WEBHOOK-IDEMPOTENZ ──────────────────────────────────
-- Verhindert doppelte Verarbeitung, wenn Stripe ein Event erneut sendet.
create table if not exists webhook_events (
  event_id     text primary key,
  received_at  timestamptz not null default now(),
  type         text
);

-- ═══════════════════════════════════════════════════════════════════
-- Fertig. Danach in Vercel neu deployen — die Endpoints greifen automatisch.
-- ═══════════════════════════════════════════════════════════════════
