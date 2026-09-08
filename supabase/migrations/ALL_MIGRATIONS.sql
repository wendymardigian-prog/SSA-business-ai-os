-- =============================================
-- ZERNFLOW - COMBINED MIGRATIONS
-- Generated from supabase/migrations/*.sql, in order.
-- DO NOT EDIT BY HAND: run `node scripts/build-all-migrations.mjs`
-- Paste this entire file into Supabase SQL Editor
-- https://supabase.com/dashboard/project/_/sql/new
-- =============================================

-- ============================================================
-- MIGRATION 1: INITIAL SCHEMA
-- ============================================================
-- ============================================================
-- WORKSPACES
-- ============================================================
create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  late_api_key_encrypted text,
  global_keywords jsonb default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table workspace_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index idx_workspace_members_user on workspace_members(user_id);

-- ============================================================
-- CHANNELS
-- ============================================================
create table channels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  platform text not null check (platform in ('facebook', 'instagram', 'twitter', 'telegram', 'bluesky', 'reddit')),
  late_account_id text not null,
  username text,
  display_name text,
  profile_picture text,
  webhook_id text,
  webhook_secret text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, late_account_id)
);

create index idx_channels_workspace on channels(workspace_id);

-- ============================================================
-- CONTACTS (CRM)
-- ============================================================
create table contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  display_name text,
  email text,
  avatar_url text,
  is_subscribed boolean not null default true,
  last_interaction_at timestamptz,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_contacts_workspace on contacts(workspace_id);
create index idx_contacts_last_interaction on contacts(workspace_id, last_interaction_at desc);

create table contact_channels (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references contacts(id) on delete cascade,
  channel_id uuid not null references channels(id) on delete cascade,
  platform_sender_id text not null,
  platform_username text,
  created_at timestamptz not null default now(),
  unique (channel_id, platform_sender_id)
);

create index idx_contact_channels_contact on contact_channels(contact_id);

create table tags (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  color text default '#6366f1',
  created_at timestamptz not null default now(),
  unique (workspace_id, name)
);

create table contact_tags (
  contact_id uuid not null references contacts(id) on delete cascade,
  tag_id uuid not null references tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (contact_id, tag_id)
);

create table custom_field_definitions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  slug text not null,
  type text not null default 'text' check (type in ('text', 'number', 'boolean', 'date', 'url', 'email')),
  created_at timestamptz not null default now(),
  unique (workspace_id, slug)
);

create table contact_custom_fields (
  contact_id uuid not null references contacts(id) on delete cascade,
  field_id uuid not null references custom_field_definitions(id) on delete cascade,
  value text not null,
  updated_at timestamptz not null default now(),
  primary key (contact_id, field_id)
);

-- ============================================================
-- FLOWS
-- ============================================================
create table flows (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  description text,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  nodes jsonb not null default '[]'::jsonb,
  edges jsonb not null default '[]'::jsonb,
  viewport jsonb,
  version integer not null default 1,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_flows_workspace on flows(workspace_id);
create index idx_flows_status on flows(workspace_id, status);

create table triggers (
  id uuid primary key default gen_random_uuid(),
  flow_id uuid not null references flows(id) on delete cascade,
  channel_id uuid references channels(id) on delete set null,
  type text not null check (type in ('keyword', 'postback', 'quick_reply', 'welcome', 'default', 'comment_keyword')),
  config jsonb not null default '{}'::jsonb,
  priority integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index idx_triggers_channel_type on triggers(channel_id, type, is_active);
create index idx_triggers_flow on triggers(flow_id);

create table flow_sessions (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references contacts(id) on delete cascade,
  flow_id uuid not null references flows(id) on delete cascade,
  channel_id uuid not null references channels(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'completed', 'expired', 'cancelled')),
  current_node_id text,
  variables jsonb not null default '{}'::jsonb,
  flow_stack jsonb not null default '[]'::jsonb,
  waiting_until timestamptz,
  waiting_for_input boolean not null default false,
  human_takeover_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_flow_sessions_contact_active on flow_sessions(contact_id, channel_id) where status = 'active';

-- ============================================================
-- CONVERSATIONS & MESSAGES
-- ============================================================
create table conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  channel_id uuid not null references channels(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  late_conversation_id text,
  platform text not null,
  status text not null default 'open' check (status in ('open', 'closed', 'snoozed')),
  assigned_to uuid references auth.users(id) on delete set null,
  last_message_at timestamptz,
  last_message_preview text,
  unread_count integer not null default 0,
  is_automation_paused boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel_id, contact_id)
);

create index idx_conversations_workspace on conversations(workspace_id, last_message_at desc);
create index idx_conversations_status on conversations(workspace_id, status);

create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  direction text not null check (direction in ('inbound', 'outbound')),
  text text,
  attachments jsonb,
  quick_reply_payload text,
  postback_payload text,
  callback_data text,
  platform_message_id text,
  sent_by_flow_id uuid references flows(id) on delete set null,
  sent_by_node_id text,
  sent_by_user_id uuid references auth.users(id) on delete set null,
  status text not null default 'sent' check (status in ('pending', 'sent', 'delivered', 'failed')),
  created_at timestamptz not null default now()
);

create index idx_messages_conversation on messages(conversation_id, created_at);

-- ============================================================
-- BROADCASTS
-- ============================================================
create table broadcasts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'sending', 'completed', 'cancelled')),
  message_content jsonb not null default '{}'::jsonb,
  segment_filter jsonb,
  scheduled_for timestamptz,
  total_recipients integer not null default 0,
  sent integer not null default 0,
  delivered integer not null default 0,
  failed integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_broadcasts_workspace on broadcasts(workspace_id);

create table broadcast_recipients (
  id uuid primary key default gen_random_uuid(),
  broadcast_id uuid not null references broadcasts(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  channel_id uuid not null references channels(id) on delete cascade,
  status text not null default 'pending',
  sent_at timestamptz,
  error_message text
);

create index idx_broadcast_recipients_broadcast on broadcast_recipients(broadcast_id, status);

-- ============================================================
-- JOBS & ANALYTICS
-- ============================================================
create table scheduled_jobs (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  run_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed')),
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now()
);

create index idx_scheduled_jobs_pending on scheduled_jobs(run_at) where status = 'pending';

create table analytics_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  flow_id uuid references flows(id) on delete set null,
  contact_id uuid references contacts(id) on delete set null,
  event_type text not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index idx_analytics_workspace on analytics_events(workspace_id, created_at desc);
create index idx_analytics_flow on analytics_events(flow_id, created_at desc);

-- ============================================================
-- ENABLE REALTIME
-- ============================================================
alter publication supabase_realtime add table conversations;
alter publication supabase_realtime add table messages;

-- ============================================================
-- UPDATED_AT TRIGGER
-- ============================================================
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_updated_at before update on workspaces for each row execute function update_updated_at();
create trigger set_updated_at before update on channels for each row execute function update_updated_at();
create trigger set_updated_at before update on contacts for each row execute function update_updated_at();
create trigger set_updated_at before update on flows for each row execute function update_updated_at();
create trigger set_updated_at before update on flow_sessions for each row execute function update_updated_at();
create trigger set_updated_at before update on conversations for each row execute function update_updated_at();
create trigger set_updated_at before update on broadcasts for each row execute function update_updated_at();

-- ============================================================
-- AUTO-CREATE WORKSPACE ON SIGNUP
-- ============================================================
create or replace function handle_new_user()
returns trigger as $$
declare
  ws_id uuid;
  user_name text;
  workspace_slug text;
begin
  user_name := coalesce(
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'name',
    split_part(new.email, '@', 1)
  );
  workspace_slug := lower(regexp_replace(user_name, '[^a-zA-Z0-9]', '-', 'g')) || '-' || substr(new.id::text, 1, 8);

  insert into public.workspaces (name, slug)
  values (user_name || '''s Workspace', workspace_slug)
  returning id into ws_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (ws_id, new.id, 'owner');

  return new;
exception when others then
  raise log 'handle_new_user error: % %', sqlerrm, sqlstate;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ============================================================
-- MIGRATION 2: RLS POLICIES
-- ============================================================
-- ============================================================
-- ROW LEVEL SECURITY POLICIES
-- ============================================================
-- All tables are filtered by workspace_id.
-- Users can only access rows in workspaces they belong to.
-- Service role key bypasses RLS (used in webhook handler).
-- ============================================================

-- Helper function: check if user belongs to workspace
create or replace function is_workspace_member(ws_id uuid)
returns boolean as $$
  select exists (
    select 1 from workspace_members
    where workspace_id = ws_id and user_id = auth.uid()
  );
$$ language sql security definer stable;

-- ============================================================
-- WORKSPACES
-- ============================================================
alter table workspaces enable row level security;

create policy "Users can view their workspaces"
  on workspaces for select
  using (is_workspace_member(id));

create policy "Users can update their workspaces"
  on workspaces for update
  using (is_workspace_member(id));

-- ============================================================
-- WORKSPACE MEMBERS
-- ============================================================
alter table workspace_members enable row level security;

-- SELECT uses direct user_id check to avoid infinite recursion
-- (is_workspace_member queries workspace_members, which would trigger RLS again)
create policy "Members can view their workspace memberships"
  on workspace_members for select
  using (user_id = auth.uid());

create policy "Owners can insert members"
  on workspace_members for insert
  with check (
    exists (
      select 1 from workspace_members wm
      where wm.workspace_id = workspace_members.workspace_id
        and wm.user_id = auth.uid()
        and wm.role = 'owner'
    )
  );

create policy "Owners can update members"
  on workspace_members for update
  using (
    exists (
      select 1 from workspace_members wm
      where wm.workspace_id = workspace_members.workspace_id
        and wm.user_id = auth.uid()
        and wm.role = 'owner'
    )
  );

create policy "Owners can delete members"
  on workspace_members for delete
  using (
    exists (
      select 1 from workspace_members wm
      where wm.workspace_id = workspace_members.workspace_id
        and wm.user_id = auth.uid()
        and wm.role = 'owner'
    )
  );

-- ============================================================
-- CHANNELS
-- ============================================================
alter table channels enable row level security;

create policy "Users can view channels in their workspaces"
  on channels for select
  using (is_workspace_member(workspace_id));

create policy "Users can manage channels in their workspaces"
  on channels for all
  using (is_workspace_member(workspace_id));

-- ============================================================
-- CONTACTS
-- ============================================================
alter table contacts enable row level security;

create policy "Users can view contacts in their workspaces"
  on contacts for select
  using (is_workspace_member(workspace_id));

create policy "Users can manage contacts in their workspaces"
  on contacts for all
  using (is_workspace_member(workspace_id));

-- ============================================================
-- CONTACT CHANNELS
-- ============================================================
alter table contact_channels enable row level security;

create policy "Users can view contact channels via contact"
  on contact_channels for select
  using (
    exists (
      select 1 from contacts c
      where c.id = contact_channels.contact_id
        and is_workspace_member(c.workspace_id)
    )
  );

create policy "Users can manage contact channels"
  on contact_channels for all
  using (
    exists (
      select 1 from contacts c
      where c.id = contact_channels.contact_id
        and is_workspace_member(c.workspace_id)
    )
  );

-- ============================================================
-- TAGS
-- ============================================================
alter table tags enable row level security;

create policy "Users can view tags in their workspaces"
  on tags for select
  using (is_workspace_member(workspace_id));

create policy "Users can manage tags in their workspaces"
  on tags for all
  using (is_workspace_member(workspace_id));

-- ============================================================
-- CONTACT TAGS
-- ============================================================
alter table contact_tags enable row level security;

create policy "Users can view contact tags"
  on contact_tags for select
  using (
    exists (
      select 1 from contacts c
      where c.id = contact_tags.contact_id
        and is_workspace_member(c.workspace_id)
    )
  );

create policy "Users can manage contact tags"
  on contact_tags for all
  using (
    exists (
      select 1 from contacts c
      where c.id = contact_tags.contact_id
        and is_workspace_member(c.workspace_id)
    )
  );

-- ============================================================
-- CUSTOM FIELD DEFINITIONS
-- ============================================================
alter table custom_field_definitions enable row level security;

create policy "Users can view custom fields in their workspaces"
  on custom_field_definitions for select
  using (is_workspace_member(workspace_id));

create policy "Users can manage custom fields in their workspaces"
  on custom_field_definitions for all
  using (is_workspace_member(workspace_id));

-- ============================================================
-- CONTACT CUSTOM FIELDS
-- ============================================================
alter table contact_custom_fields enable row level security;

create policy "Users can view contact custom fields"
  on contact_custom_fields for select
  using (
    exists (
      select 1 from contacts c
      join contact_custom_fields ccf on ccf.contact_id = c.id
      where c.id = contact_custom_fields.contact_id
        and is_workspace_member(c.workspace_id)
    )
  );

create policy "Users can manage contact custom fields"
  on contact_custom_fields for all
  using (
    exists (
      select 1 from contacts c
      where c.id = contact_custom_fields.contact_id
        and is_workspace_member(c.workspace_id)
    )
  );

-- ============================================================
-- FLOWS
-- ============================================================
alter table flows enable row level security;

create policy "Users can view flows in their workspaces"
  on flows for select
  using (is_workspace_member(workspace_id));

create policy "Users can manage flows in their workspaces"
  on flows for all
  using (is_workspace_member(workspace_id));

-- ============================================================
-- TRIGGERS
-- ============================================================
alter table triggers enable row level security;

create policy "Users can view triggers via flow"
  on triggers for select
  using (
    exists (
      select 1 from flows f
      where f.id = triggers.flow_id
        and is_workspace_member(f.workspace_id)
    )
  );

create policy "Users can manage triggers via flow"
  on triggers for all
  using (
    exists (
      select 1 from flows f
      where f.id = triggers.flow_id
        and is_workspace_member(f.workspace_id)
    )
  );

-- ============================================================
-- FLOW SESSIONS
-- ============================================================
alter table flow_sessions enable row level security;

create policy "Users can view flow sessions via flow"
  on flow_sessions for select
  using (
    exists (
      select 1 from flows f
      where f.id = flow_sessions.flow_id
        and is_workspace_member(f.workspace_id)
    )
  );

-- ============================================================
-- CONVERSATIONS
-- ============================================================
alter table conversations enable row level security;

create policy "Users can view conversations in their workspaces"
  on conversations for select
  using (is_workspace_member(workspace_id));

create policy "Users can manage conversations in their workspaces"
  on conversations for all
  using (is_workspace_member(workspace_id));

-- ============================================================
-- MESSAGES
-- ============================================================
alter table messages enable row level security;

create policy "Users can view messages via conversation"
  on messages for select
  using (
    exists (
      select 1 from conversations conv
      where conv.id = messages.conversation_id
        and is_workspace_member(conv.workspace_id)
    )
  );

create policy "Users can insert messages via conversation"
  on messages for insert
  with check (
    exists (
      select 1 from conversations conv
      where conv.id = messages.conversation_id
        and is_workspace_member(conv.workspace_id)
    )
  );

-- ============================================================
-- BROADCASTS
-- ============================================================
alter table broadcasts enable row level security;

create policy "Users can view broadcasts in their workspaces"
  on broadcasts for select
  using (is_workspace_member(workspace_id));

create policy "Users can manage broadcasts in their workspaces"
  on broadcasts for all
  using (is_workspace_member(workspace_id));

-- ============================================================
-- BROADCAST RECIPIENTS
-- ============================================================
alter table broadcast_recipients enable row level security;

create policy "Users can view broadcast recipients"
  on broadcast_recipients for select
  using (
    exists (
      select 1 from broadcasts b
      where b.id = broadcast_recipients.broadcast_id
        and is_workspace_member(b.workspace_id)
    )
  );

-- ============================================================
-- SCHEDULED JOBS (service role only, no user RLS needed)
-- ============================================================
alter table scheduled_jobs enable row level security;

-- ============================================================
-- ANALYTICS EVENTS
-- ============================================================
alter table analytics_events enable row level security;

create policy "Users can view analytics in their workspaces"
  on analytics_events for select
  using (is_workspace_member(workspace_id));

create policy "Users can insert analytics in their workspaces"
  on analytics_events for insert
  with check (is_workspace_member(workspace_id));

-- ============================================================
-- MIGRATION 3: RPC FUNCTIONS
-- ============================================================
-- ============================================================
-- RPC FUNCTIONS
-- ============================================================

-- Increment unread count and update conversation preview
create or replace function increment_unread(conv_id uuid, preview text)
returns void as $$
begin
  update conversations
  set unread_count = unread_count + 1,
      last_message_at = now(),
      last_message_preview = preview,
      status = 'open'
  where id = conv_id;
end;
$$ language plpgsql security definer;

-- Increment broadcast sent counter
create or replace function increment_broadcast_sent(b_id uuid)
returns void as $$
begin
  update broadcasts
  set sent = sent + 1,
      delivered = delivered + 1
  where id = b_id;
end;
$$ language plpgsql security definer;

-- Increment broadcast failed counter
create or replace function increment_broadcast_failed(b_id uuid)
returns void as $$
begin
  update broadcasts
  set failed = failed + 1
  where id = b_id;
end;
$$ language plpgsql security definer;

-- ============================================================
-- MIGRATION 4: COMMENT AUTOMATION
-- ============================================================
-- ============================================================
-- COMMENT AUTOMATION
-- ============================================================

-- Add comment polling cursor to channels
alter table channels
  add column if not exists last_comment_cursor text,
  add column if not exists comment_rules jsonb default '[]'::jsonb;

-- Comment processing log
create table if not exists comment_logs (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  post_id text, -- Late post ID the comment belongs to
  platform_comment_id text not null,
  author_id text,
  author_name text,
  author_username text,
  comment_text text not null,
  matched_trigger_id uuid references triggers(id) on delete set null,
  dm_sent boolean not null default false,
  reply_sent boolean not null default false,
  error text,
  created_at timestamptz not null default now()
);

-- Indexes for efficient lookups
create index if not exists idx_comment_logs_channel_id on comment_logs(channel_id);
create index if not exists idx_comment_logs_workspace_id on comment_logs(workspace_id);
create index if not exists idx_comment_logs_platform_comment_id on comment_logs(platform_comment_id);
create index if not exists idx_comment_logs_created_at on comment_logs(created_at desc);

-- Unique constraint to avoid processing the same comment twice
create unique index if not exists idx_comment_logs_unique_comment
  on comment_logs(channel_id, platform_comment_id);

-- RLS policies for comment_logs
alter table comment_logs enable row level security;

create policy "Users can view comment logs in their workspace"
  on comment_logs for select
  using (
    workspace_id in (
      select workspace_id from workspace_members where user_id = auth.uid()
    )
  );

-- ============================================================
-- MIGRATION 5: SEQUENCES
-- ============================================================
-- Sequences: drip campaigns
CREATE TABLE IF NOT EXISTS sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  steps JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE sequences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sequences_workspace" ON sequences
  FOR ALL USING (
    workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
  );

CREATE TABLE IF NOT EXISTS sequence_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id UUID NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES channels(id),
  current_step_index INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  enrolled_at TIMESTAMPTZ DEFAULT now(),
  next_step_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  UNIQUE(sequence_id, contact_id)
);

ALTER TABLE sequence_enrollments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "enrollments_via_sequence" ON sequence_enrollments
  FOR ALL USING (
    sequence_id IN (
      SELECT id FROM sequences WHERE workspace_id IN (
        SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
      )
    )
  );

-- ============================================================
-- MIGRATION 6: WORKSPACE INVITES
-- ============================================================
-- ============================================================
-- WORKSPACE INVITES
-- ============================================================

CREATE TABLE IF NOT EXISTS workspace_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  invited_by UUID NOT NULL REFERENCES auth.users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT now() + interval '7 days'
);

CREATE INDEX IF NOT EXISTS idx_workspace_invites_workspace ON workspace_invites(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_invites_email ON workspace_invites(email);

ALTER TABLE workspace_invites ENABLE ROW LEVEL SECURITY;

-- Members of the workspace can view invites
CREATE POLICY "workspace_invites_select" ON workspace_invites
  FOR SELECT USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

-- Only workspace owners can create invites
CREATE POLICY "workspace_invites_insert" ON workspace_invites
  FOR INSERT WITH CHECK (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

-- Only workspace owners can delete invites
CREATE POLICY "workspace_invites_delete" ON workspace_invites
  FOR DELETE USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

-- Only workspace owners can update invite status
CREATE POLICY "workspace_invites_update" ON workspace_invites
  FOR UPDATE USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid() AND role = 'owner'
    )
    OR
    -- Allow the invited user to accept their own invite
    email = (SELECT email FROM auth.users WHERE id = auth.uid())
  );

-- ============================================================
-- MIGRATION 7: OPENAI API KEY
-- ============================================================
-- Add OpenAI API key column to workspaces
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS openai_api_key TEXT;

-- ============================================================
-- MIGRATION 8: AI PROVIDER
-- ============================================================
-- Rename openai_api_key to ai_api_key and add ai_provider column
ALTER TABLE workspaces RENAME COLUMN openai_api_key TO ai_api_key;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS ai_provider TEXT NOT NULL DEFAULT 'openai';

-- ============================================================
-- MIGRATION 9: FIX BROADCAST RLS
-- ============================================================
-- Fix broadcast_recipients: add INSERT/UPDATE/DELETE policies
CREATE POLICY "Users can insert broadcast recipients" ON broadcast_recipients
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM broadcasts b
      WHERE b.id = broadcast_recipients.broadcast_id
        AND is_workspace_member(b.workspace_id)
    )
  );

CREATE POLICY "Users can update broadcast recipients" ON broadcast_recipients
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM broadcasts b
      WHERE b.id = broadcast_recipients.broadcast_id
        AND is_workspace_member(b.workspace_id)
    )
  );

-- Fix scheduled_jobs: add full CRUD policies for workspace members
-- Jobs are workspace-agnostic (system-level), so allow authenticated users
CREATE POLICY "Authenticated users can insert jobs" ON scheduled_jobs
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can read jobs" ON scheduled_jobs
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update jobs" ON scheduled_jobs
  FOR UPDATE USING (auth.uid() IS NOT NULL);

-- ============================================================
-- MIGRATION 10: FLOW VERSIONS
-- ============================================================
-- Flow version history: stores a snapshot of nodes/edges on each publish
create table flow_versions (
  id uuid primary key default gen_random_uuid(),
  flow_id uuid not null references flows(id) on delete cascade,
  version integer not null,
  nodes jsonb not null,
  edges jsonb not null,
  viewport jsonb,
  name text not null,
  published_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (flow_id, version)
);

create index idx_flow_versions_flow on flow_versions(flow_id, version desc);

-- RLS
alter table flow_versions enable row level security;

create policy "flow_versions_select" on flow_versions for select
  using (exists (
    select 1 from flows f
    join workspace_members wm on wm.workspace_id = f.workspace_id
    where f.id = flow_versions.flow_id
      and wm.user_id = auth.uid()
  ));

create policy "flow_versions_insert" on flow_versions for insert
  with check (exists (
    select 1 from flows f
    join workspace_members wm on wm.workspace_id = f.workspace_id
    where f.id = flow_versions.flow_id
      and wm.user_id = auth.uid()
  ));

-- ============================================================
-- MIGRATION 11: WORKSPACE WEBHOOK SECRET
-- ============================================================
-- Add workspace-level webhook secret for Zernio HMAC signature verification.
-- Zernio exposes a single webhook per profile/API key, so the secret lives at the
-- workspace level (not per-channel). Used by /api/webhooks/late to verify signatures.
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS webhook_secret TEXT;

-- ============================================================
-- MIGRATION 12: WEBHOOK EVENTS
-- ============================================================
-- Idempotency ledger for inbound Zernio webhook deliveries. Zernio retries a
-- delivery with the same event id whenever our 200 doesn't arrive within its 5s
-- timeout; /api/webhooks/late claims the id here before processing so retries
-- and redeliveries never re-run a flow (which was double-sending DMs).
CREATE TABLE IF NOT EXISTS webhook_events (
  event_id TEXT PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Rows are only needed for the retry window (hours); allow cheap pruning.
CREATE INDEX IF NOT EXISTS webhook_events_received_at_idx ON webhook_events (received_at);

ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- MIGRATION 13: SEQUENCE ENROLLMENTS CHANNEL CASCADE
-- ============================================================
-- sequence_enrollments.channel_id was declared without an ON DELETE action
-- (00005_sequences.sql), so deleting a channel with enrollments failed with a
-- 23503 FK violation. Every other channel FK cascades (or sets null); align
-- this one so channel deletion works.
ALTER TABLE sequence_enrollments
  DROP CONSTRAINT sequence_enrollments_channel_id_fkey,
  ADD CONSTRAINT sequence_enrollments_channel_id_fkey
    FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE;

-- ============================================================
-- MIGRATION 14: SCHEDULED JOBS CLAIMED AT
-- ============================================================
-- The cron claims a job by flipping status to 'processing'. If that UPDATE
-- commits but the response is lost, the job is stranded: the fetch only read
-- 'pending' rows. claimed_at lets the cron reclaim 'processing' jobs whose
-- claim is older than a few minutes.
ALTER TABLE scheduled_jobs ADD COLUMN claimed_at timestamptz;

CREATE INDEX idx_scheduled_jobs_processing ON scheduled_jobs(claimed_at)
  WHERE status = 'processing';

-- ============================================================
-- MIGRATION 15: BACKFILL CLAIMED AT
-- ============================================================
-- 00014 added claimed_at but did not backfill rows already stuck in
-- 'processing', and old-code invocations claim without stamping it. Stamp
-- existing NULL claims so the cron's staleness clock (claimed_at older than
-- 5 minutes) applies to them; genuinely stranded rows become reclaimable
-- shortly after this runs, while a claim still live at migration time gets
-- the full window to finish before being reclaimed.
UPDATE scheduled_jobs
SET claimed_at = now()
WHERE status = 'processing' AND claimed_at IS NULL;

-- ============================================================
-- MIGRATION 16: WHATSAPP CHANNEL PLATFORM
-- ============================================================
-- WhatsApp was advertised on the site, offered in the channel picker and
-- already handled by the flow engine, but 00001's platform check constraint
-- never listed it, so the channel row could not be stored (issue #16).
ALTER TABLE channels DROP CONSTRAINT IF EXISTS channels_platform_check;

ALTER TABLE channels ADD CONSTRAINT channels_platform_check
  CHECK (platform IN ('facebook', 'instagram', 'twitter', 'telegram', 'bluesky', 'reddit', 'whatsapp'));

-- ============================================================
-- MIGRATION 17: VAULT SECRETS
-- ============================================================
-- ============================================================
-- MIGRACION 00017 — SUPABASE VAULT
-- ============================================================
-- Base para guardar API keys de terceros (Zernio, Evolution, Resend,
-- proveedores de IA) encriptadas con AES-256 en vez de en texto plano.
--
-- Aislamiento por workspace: el nombre real del secret en Vault es
-- 'ws:<workspace_id>:<nombre>'. Dos workspaces no pueden pisarse ni leerse
-- entre si porque el prefijo lo pone la funcion, no el llamador.
--
-- Acceso: solo Owner/Admin del workspace, mas service_role (el server usa la
-- service key en webhooks y cron jobs, donde no hay usuario logueado).
-- ============================================================

CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

-- ------------------------------------------------------------
-- Helper de rol: complementa is_workspace_member (migracion 00002).
-- Se usa en estas funciones y en las policies de RLS del bloque siguiente.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_workspace_admin(ws_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = ws_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'admin')
  );
$$;

COMMENT ON FUNCTION public.is_workspace_admin(uuid) IS
  'True si el usuario actual es owner o admin del workspace. Para policies y RPCs privilegiadas.';

-- ------------------------------------------------------------
-- Helpers internos
-- ------------------------------------------------------------

-- Nombre namespaceado. Rechaza nombres que puedan escapar del prefijo.
CREATE OR REPLACE FUNCTION public.vault_secret_key(ws_id uuid, plain_name text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
  IF plain_name IS NULL OR plain_name !~ '^[A-Za-z0-9_.-]{1,100}$' THEN
    RAISE EXCEPTION 'invalid secret name: only letters, digits, dot, dash and underscore (max 100)';
  END IF;
  IF ws_id IS NULL THEN
    RAISE EXCEPTION 'workspace_id is required';
  END IF;
  RETURN 'ws:' || ws_id::text || ':' || plain_name;
END;
$$;

-- Autorizacion comun a las 4 RPCs.
CREATE OR REPLACE FUNCTION public.assert_can_manage_secrets(ws_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
BEGIN
  -- service_role: el server (webhooks, cron) no tiene usuario logueado y
  -- necesita leer las keys para operar. Es una clave server-side, nunca
  -- llega al browser.
  IF auth.role() = 'service_role' THEN
    RETURN;
  END IF;
  IF NOT public.is_workspace_admin(ws_id) THEN
    RAISE EXCEPTION 'forbidden: only workspace owners and admins can manage secrets';
  END IF;
END;
$$;

-- ------------------------------------------------------------
-- store_secret — crea o actualiza. Devuelve el id del secret en Vault.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.store_secret(
  secret_name text,
  secret_value text,
  workspace_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ws  uuid := workspace_id;
  v_key text;
  v_id  uuid;
BEGIN
  PERFORM public.assert_can_manage_secrets(v_ws);

  IF secret_value IS NULL OR length(secret_value) = 0 THEN
    RAISE EXCEPTION 'secret value cannot be empty';
  END IF;

  v_key := public.vault_secret_key(v_ws, secret_name);

  SELECT s.id INTO v_id FROM vault.secrets s WHERE s.name = v_key;

  IF v_id IS NULL THEN
    v_id := vault.create_secret(secret_value, v_key, 'workspace secret');
  ELSE
    PERFORM vault.update_secret(v_id, secret_value, v_key, 'workspace secret');
  END IF;

  RETURN v_id;
END;
$$;

-- ------------------------------------------------------------
-- read_secret — devuelve el valor desencriptado, o NULL si no existe.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.read_secret(
  secret_name text,
  workspace_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_ws    uuid := workspace_id;
  v_key   text;
  v_value text;
BEGIN
  PERFORM public.assert_can_manage_secrets(v_ws);
  v_key := public.vault_secret_key(v_ws, secret_name);

  SELECT s.decrypted_secret INTO v_value
  FROM vault.decrypted_secrets s
  WHERE s.name = v_key;

  RETURN v_value;
END;
$$;

-- ------------------------------------------------------------
-- delete_secret — true si borro algo, false si no existia.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_secret(
  secret_name text,
  workspace_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ws      uuid := workspace_id;
  v_key     text;
  v_deleted integer;
BEGIN
  PERFORM public.assert_can_manage_secrets(v_ws);
  v_key := public.vault_secret_key(v_ws, secret_name);

  DELETE FROM vault.secrets s WHERE s.name = v_key;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN v_deleted > 0;
END;
$$;

-- ------------------------------------------------------------
-- list_secret_names — que hay configurado, sin exponer valores.
-- La pantalla de integraciones (Bloque 2) la usa para pintar estados.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_secret_names(workspace_id uuid)
RETURNS SETOF text
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_ws     uuid := workspace_id;
  v_prefix text;
BEGIN
  PERFORM public.assert_can_manage_secrets(v_ws);
  v_prefix := 'ws:' || v_ws::text || ':';

  RETURN QUERY
    SELECT substring(s.name from length(v_prefix) + 1)
    FROM vault.secrets s
    WHERE s.name LIKE v_prefix || '%'
    ORDER BY 1;
END;
$$;

-- ------------------------------------------------------------
-- Permisos: nadie anonimo, nadie sin loguear.
-- ------------------------------------------------------------
DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.store_secret(text, text, uuid)',
    'public.read_secret(text, uuid)',
    'public.delete_secret(text, uuid)',
    'public.list_secret_names(uuid)',
    'public.assert_can_manage_secrets(uuid)',
    'public.vault_secret_key(uuid, text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', fn);
  END LOOP;

  FOREACH fn IN ARRAY ARRAY[
    'public.store_secret(text, text, uuid)',
    'public.read_secret(text, uuid)',
    'public.delete_secret(text, uuid)',
    'public.list_secret_names(uuid)'
  ] LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', fn);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.is_workspace_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_workspace_admin(uuid) TO authenticated, service_role;

-- ============================================================
-- MIGRATION 18: ROLES AND LEAD SCOPE
-- ============================================================
-- ============================================================
-- MIGRACION 00018 — ROLES Y SCOPE DE LEADS
-- ============================================================
-- Dos cosas:
--
-- 1. Roles. ZernFlow guarda el rol como texto libre y varias policies asumen
--    owner-only. El alcance de Etapa 1 pide Owner/Admin/Member con Admin
--    pudiendo invitar y cambiar roles, y Member sin acceso a configuracion.
--
-- 2. Scope de leads. Un Member solo tiene que ver los contactos y
--    conversaciones donde esta asignado. Los campos setter_id/vendedor_id
--    llegan en el Bloque 3, asi que aca dejamos las funciones y las policies
--    enganchadas: el Bloque 3 solo edita el cuerpo de can_see_contact y
--    can_see_conversation, sin volver a tocar una sola policy.
--
--    El scope arranca APAGADO (workspaces.lead_scope_enabled = false), asi que
--    esta migracion no cambia lo que ve nadie hoy.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Roles validos
-- ------------------------------------------------------------

-- Normalizar antes de restringir: cualquier valor fuera de los tres pasa a
-- 'member', el mas restrictivo.
UPDATE public.workspace_members
SET role = 'member'
WHERE role IS NULL OR role NOT IN ('owner', 'admin', 'member');

ALTER TABLE public.workspace_members DROP CONSTRAINT IF EXISTS workspace_members_role_check;
ALTER TABLE public.workspace_members ADD CONSTRAINT workspace_members_role_check
  CHECK (role IN ('owner', 'admin', 'member'));

-- Las invitaciones solo pueden ofrecer admin o member: a owner se llega
-- creando el workspace, no por invitacion.
UPDATE public.workspace_invites
SET role = 'member'
WHERE role IS NULL OR role NOT IN ('admin', 'member');

ALTER TABLE public.workspace_invites DROP CONSTRAINT IF EXISTS workspace_invites_role_check;
ALTER TABLE public.workspace_invites ADD CONSTRAINT workspace_invites_role_check
  CHECK (role IN ('admin', 'member'));

-- is_workspace_member (migracion 00002) es SECURITY DEFINER pero no fija su
-- search_path y nombra la tabla sin schema. Eso funciona mientras la llame
-- una policy con el search_path de sesion, pero revienta con
-- 'relation "workspace_members" does not exist' apenas la llama una funcion
-- que sí fija search_path = '' — que es lo que hacen las funciones de scope
-- de esta migracion. Se rehace calificando el schema y fijando el search_path,
-- que ademas es la forma correcta para una SECURITY DEFINER.
CREATE OR REPLACE FUNCTION public.is_workspace_member(ws_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = ws_id AND user_id = auth.uid()
  );
$$;

-- Helper de owner (is_workspace_admin ya existe, migracion 00017).
CREATE OR REPLACE FUNCTION public.is_workspace_owner(ws_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = ws_id AND user_id = auth.uid() AND role = 'owner'
  );
$$;

REVOKE ALL ON FUNCTION public.is_workspace_owner(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_workspace_owner(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 2. Flags de scope, a nivel workspace
-- ------------------------------------------------------------

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS lead_scope_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS unassigned_leads_visible_to_members boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.workspaces.lead_scope_enabled IS
  'Cuando esta en true, un Member solo ve contactos y conversaciones donde esta asignado. Se prende en el Bloque 3, cuando existan setter_id y vendedor_id.';
COMMENT ON COLUMN public.workspaces.unassigned_leads_visible_to_members IS
  'Con el scope prendido: si un lead no tiene a nadie asignado, lo ven todos los Members (true) o solo Owner/Admin (false, default).';

-- ------------------------------------------------------------
-- 3. Funciones de scope — el unico lugar que el Bloque 3 tiene que tocar
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_see_contact(c public.contacts)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_scoped              boolean;
  v_unassigned_visible  boolean;
  v_has_assignee        boolean;
BEGIN
  IF NOT public.is_workspace_member(c.workspace_id) THEN
    RETURN false;
  END IF;

  IF public.is_workspace_admin(c.workspace_id) THEN
    RETURN true;
  END IF;

  SELECT w.lead_scope_enabled, w.unassigned_leads_visible_to_members
    INTO v_scoped, v_unassigned_visible
  FROM public.workspaces w
  WHERE w.id = c.workspace_id;

  IF NOT COALESCE(v_scoped, false) THEN
    RETURN true;
  END IF;

  -- Asignado a mi. BLOQUE 3: sumar aca
  --   OR c.setter_id = auth.uid() OR c.vendedor_id = auth.uid()
  IF EXISTS (
    SELECT 1 FROM public.conversations conv
    WHERE conv.contact_id = c.id AND conv.assigned_to = auth.uid()
  ) THEN
    RETURN true;
  END IF;

  -- Sin asignar: lo decide el flag del workspace.
  -- BLOQUE 3: sumar c.setter_id IS NOT NULL OR c.vendedor_id IS NOT NULL
  SELECT EXISTS (
    SELECT 1 FROM public.conversations conv
    WHERE conv.contact_id = c.id AND conv.assigned_to IS NOT NULL
  ) INTO v_has_assignee;

  IF NOT v_has_assignee THEN
    RETURN COALESCE(v_unassigned_visible, false);
  END IF;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.can_see_conversation(conv public.conversations)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_scoped              boolean;
  v_unassigned_visible  boolean;
BEGIN
  IF NOT public.is_workspace_member(conv.workspace_id) THEN
    RETURN false;
  END IF;

  IF public.is_workspace_admin(conv.workspace_id) THEN
    RETURN true;
  END IF;

  SELECT w.lead_scope_enabled, w.unassigned_leads_visible_to_members
    INTO v_scoped, v_unassigned_visible
  FROM public.workspaces w
  WHERE w.id = conv.workspace_id;

  IF NOT COALESCE(v_scoped, false) THEN
    RETURN true;
  END IF;

  IF conv.assigned_to = auth.uid() THEN
    RETURN true;
  END IF;

  -- BLOQUE 3: si el contacto tiene a este usuario como setter o vendedor,
  -- tambien ve la conversacion aunque no sea el agente asignado.
  IF conv.assigned_to IS NULL THEN
    RETURN COALESCE(v_unassigned_visible, false);
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.can_see_contact(public.contacts) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_see_conversation(public.conversations) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_see_contact(public.contacts) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_see_conversation(public.conversations) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 4. Policies de contacts y conversations
-- ------------------------------------------------------------
-- contact_channels, contact_tags y contact_custom_fields NO hace falta
-- tocarlas: sus policies consultan contacts, y una subconsulta dentro de una
-- policy tambien pasa por la RLS de la tabla que consulta. Heredan el scope
-- solas. Lo mismo messages via conversations.

DROP POLICY IF EXISTS "Users can view contacts in their workspaces" ON public.contacts;
DROP POLICY IF EXISTS "Users can manage contacts in their workspaces" ON public.contacts;

DROP POLICY IF EXISTS "contacts_select" ON public.contacts;
CREATE POLICY "contacts_select" ON public.contacts
  FOR SELECT USING (public.can_see_contact(contacts));

DROP POLICY IF EXISTS "contacts_insert" ON public.contacts;
CREATE POLICY "contacts_insert" ON public.contacts
  FOR INSERT WITH CHECK (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "contacts_update" ON public.contacts;
CREATE POLICY "contacts_update" ON public.contacts
  FOR UPDATE USING (public.can_see_contact(contacts))
  WITH CHECK (public.can_see_contact(contacts));

-- Borrar contactos queda para Owner/Admin (alcance 10.2). El borrado logico
-- del Bloque 3 es un UPDATE, asi que va a seguir la policy de update.
DROP POLICY IF EXISTS "contacts_delete" ON public.contacts;
CREATE POLICY "contacts_delete" ON public.contacts
  FOR DELETE USING (public.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "Users can view conversations in their workspaces" ON public.conversations;
DROP POLICY IF EXISTS "Users can manage conversations in their workspaces" ON public.conversations;

DROP POLICY IF EXISTS "conversations_select" ON public.conversations;
CREATE POLICY "conversations_select" ON public.conversations
  FOR SELECT USING (public.can_see_conversation(conversations));

DROP POLICY IF EXISTS "conversations_insert" ON public.conversations;
CREATE POLICY "conversations_insert" ON public.conversations
  FOR INSERT WITH CHECK (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "conversations_update" ON public.conversations;
CREATE POLICY "conversations_update" ON public.conversations
  FOR UPDATE USING (public.can_see_conversation(conversations))
  WITH CHECK (public.can_see_conversation(conversations));

DROP POLICY IF EXISTS "conversations_delete" ON public.conversations;
CREATE POLICY "conversations_delete" ON public.conversations
  FOR DELETE USING (public.is_workspace_admin(workspace_id));

-- ------------------------------------------------------------
-- 5. Configuracion del workspace: fuera del alcance de un Member
-- ------------------------------------------------------------
-- Sin esto, un Member podia editar el workspace y apagar lead_scope_enabled
-- para verlo todo.

DROP POLICY IF EXISTS "Users can update their workspaces" ON public.workspaces;

DROP POLICY IF EXISTS "workspaces_update" ON public.workspaces;
CREATE POLICY "workspaces_update" ON public.workspaces
  FOR UPDATE USING (public.is_workspace_admin(id))
  WITH CHECK (public.is_workspace_admin(id));

-- Canales: un Member los ve (los necesita en la bandeja) pero no los gestiona.
DROP POLICY IF EXISTS "Users can manage channels in their workspaces" ON public.channels;

DROP POLICY IF EXISTS "channels_insert" ON public.channels;
CREATE POLICY "channels_insert" ON public.channels
  FOR INSERT WITH CHECK (public.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "channels_update" ON public.channels;
CREATE POLICY "channels_update" ON public.channels
  FOR UPDATE USING (public.is_workspace_admin(workspace_id))
  WITH CHECK (public.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "channels_delete" ON public.channels;
CREATE POLICY "channels_delete" ON public.channels
  FOR DELETE USING (public.is_workspace_admin(workspace_id));

-- ------------------------------------------------------------
-- 6. Equipo: Admin puede invitar y cambiar roles; remover queda en Owner
-- ------------------------------------------------------------

DROP POLICY IF EXISTS "workspace_invites_insert" ON public.workspace_invites;
DROP POLICY IF EXISTS "workspace_invites_update" ON public.workspace_invites;
DROP POLICY IF EXISTS "workspace_invites_delete" ON public.workspace_invites;

DROP POLICY IF EXISTS "workspace_invites_insert" ON public.workspace_invites;
CREATE POLICY "workspace_invites_insert" ON public.workspace_invites
  FOR INSERT WITH CHECK (public.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "workspace_invites_update" ON public.workspace_invites;
CREATE POLICY "workspace_invites_update" ON public.workspace_invites
  FOR UPDATE USING (
    public.is_workspace_admin(workspace_id)
    -- el invitado acepta su propia invitacion
    OR email = (SELECT u.email FROM auth.users u WHERE u.id = auth.uid())
  );

DROP POLICY IF EXISTS "workspace_invites_delete" ON public.workspace_invites;
CREATE POLICY "workspace_invites_delete" ON public.workspace_invites
  FOR DELETE USING (public.is_workspace_admin(workspace_id));

-- Cambio de rol: Owner puede con cualquiera; Admin solo con filas que no sean
-- de un owner, y sin poder crear owners nuevos (el WITH CHECK mira la fila ya
-- modificada).
DROP POLICY IF EXISTS "Owners can update members" ON public.workspace_members;

DROP POLICY IF EXISTS "workspace_members_update" ON public.workspace_members;
CREATE POLICY "workspace_members_update" ON public.workspace_members
  FOR UPDATE USING (
    public.is_workspace_owner(workspace_id)
    OR (public.is_workspace_admin(workspace_id) AND role <> 'owner')
  )
  WITH CHECK (
    public.is_workspace_owner(workspace_id)
    OR (public.is_workspace_admin(workspace_id) AND role <> 'owner')
  );

-- Remover miembros sigue siendo solo del Owner (criterio de F3): la policy
-- "Owners can delete members" de la migracion 00002 queda como esta.

-- La policy de SELECT de workspace_members era 'user_id = auth.uid()': cada uno
-- veia solo su propia fila. Con eso un Admin no puede cambiarle el rol a nadie,
-- porque el UPDATE no llega a leer la fila del otro. Ademas el Bloque 3 necesita
-- listar los miembros para los desplegables de setter y vendedor.
-- No hay recursion: is_workspace_member es SECURITY DEFINER y corre como dueño
-- de la tabla, asi que la consulta de adentro no vuelve a pasar por RLS.
DROP POLICY IF EXISTS "Members can view their workspace memberships" ON public.workspace_members;

DROP POLICY IF EXISTS "workspace_members_select" ON public.workspace_members;
CREATE POLICY "workspace_members_select" ON public.workspace_members
  FOR SELECT USING (public.is_workspace_member(workspace_id));

-- ============================================================
-- MIGRATION 19: CHANNELS PROVIDER
-- ============================================================
-- ============================================================
-- MIGRACION 00019 — DE DONDE VIENE CADA CANAL
-- ============================================================
-- La tabla channels de ZernFlow asume que todo canal se conecto por Zernio:
-- late_account_id es obligatorio y todo el codigo de sync sale de ahi.
-- WhatsApp de Etapa 1 no pasa por Zernio, sino por Evolution API self-hosted.
--
-- En vez de partir la tabla en dos, se agrega de donde viene la conexion. El
-- inbox unificado sigue leyendo una sola tabla y no le importa el mecanismo,
-- que es lo que pide el diseño para las etapas siguientes.
--
-- late_account_id no se toca (sigue NOT NULL y unico por workspace): para
-- WhatsApp se guarda 'evolution:<instancia>', que cumple las dos cosas.
-- ============================================================

ALTER TABLE public.channels
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'zernio';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'channels_provider_check'
  ) THEN
    ALTER TABLE public.channels ADD CONSTRAINT channels_provider_check
      CHECK (provider IN ('zernio', 'evolution'));
  END IF;
END;
$$;

-- Nombre de la instancia en Evolution API. Null para los canales de Zernio.
ALTER TABLE public.channels
  ADD COLUMN IF NOT EXISTS evolution_instance text;

-- Estado de la conexion. Zernio no lo reporta en vivo, asi que sus canales
-- quedan en 'unknown' y siguen usando is_active como hasta ahora.
ALTER TABLE public.channels
  ADD COLUMN IF NOT EXISTS connection_status text NOT NULL DEFAULT 'unknown';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'channels_connection_status_check'
  ) THEN
    ALTER TABLE public.channels ADD CONSTRAINT channels_connection_status_check
      CHECK (connection_status IN ('connected', 'disconnected', 'connecting', 'error', 'unknown'));
  END IF;
END;
$$;

ALTER TABLE public.channels ADD COLUMN IF NOT EXISTS last_connected_at timestamptz;
ALTER TABLE public.channels ADD COLUMN IF NOT EXISTS last_error text;

-- Cuando se detecta la desconexion se avisa a los admins una sola vez, no en
-- cada chequeo del cron.
ALTER TABLE public.channels ADD COLUMN IF NOT EXISTS disconnected_notified_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS idx_channels_evolution_instance
  ON public.channels(evolution_instance)
  WHERE evolution_instance IS NOT NULL;

COMMENT ON COLUMN public.channels.provider IS
  'De donde sale la conexion: zernio (Instagram, Facebook, ...) o evolution (WhatsApp por Baileys). En Etapa 2 se suman mas.';
COMMENT ON COLUMN public.channels.connection_status IS
  'Estado en vivo. Solo lo mantienen los canales de Evolution; los de Zernio quedan en unknown.';

-- ------------------------------------------------------------
-- Idempotencia de los mensajes guardados localmente
-- ------------------------------------------------------------
-- Los mensajes de Instagram los guarda Zernio y la app se los pide por API: la
-- tabla messages queda vacia para esos canales. Los de WhatsApp no tienen donde
-- vivir salvo aca, y Evolution reintenta los webhooks, asi que hace falta que
-- el mismo mensaje no se pueda guardar dos veces.
DELETE FROM public.messages m
WHERE m.platform_message_id IS NOT NULL
  AND m.ctid <> (
    SELECT min(m2.ctid) FROM public.messages m2
    WHERE m2.conversation_id = m.conversation_id
      AND m2.platform_message_id = m.platform_message_id
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_platform_message_id
  ON public.messages(conversation_id, platform_message_id)
  WHERE platform_message_id IS NOT NULL;

-- Buscar la conversacion por instancia + remitente en cada mensaje entrante.
CREATE INDEX IF NOT EXISTS idx_contact_channels_sender
  ON public.contact_channels(platform_sender_id);

-- ============================================================
-- MIGRATION 20: INTEGRATION CONFIGS
-- ============================================================
-- ============================================================
-- MIGRACION 00020 — INTEGRACIONES (TABLA GENERICA)
-- ============================================================
-- Una sola tabla para TODAS las integraciones del sistema: canales de
-- mensajeria, proveedores de IA (BYOK) y email saliente. El campo `type` las
-- separa y `provider` dice cual es.
--
-- Por que una tabla generica y no una por integracion: sumar YouTube o
-- LinkedIn en Etapa 2 tiene que ser un registro nuevo, no una migracion. Lo
-- especifico de cada proveedor vive en `config` (jsonb), que no necesita
-- cambio de schema para crecer.
--
-- Las API keys NO viven aca: van a Supabase Vault (migracion 00017). Esta
-- tabla solo guarda el NOMBRE del secret (`vault_secret_name`) para saber
-- donde buscarlo. Nunca un valor secreto en texto plano.
--
-- Acceso: solo Owner/Admin. Un Member no ve ni una fila — configurar
-- integraciones no es parte de su rol (matriz de permisos de la fase).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.integration_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,

  -- Que clase de integracion es. En Etapa 2 se suman valores nuevos al CHECK
  -- si aparece una clase distinta (por ahora las tres cubren todo).
  type text NOT NULL,

  -- Quien la provee: 'instagram_zernio', 'whatsapp_evolution', 'resend',
  -- 'openai', 'anthropic', 'google_ai'. Texto libre a proposito: el catalogo
  -- vive en el codigo (lib/integrations/providers.ts), no en un CHECK que
  -- habria que migrar cada vez que se suma un proveedor.
  provider text NOT NULL,

  display_name text,

  -- Nombre "limpio" del secret en Vault (ej: 'resend_api_key'). El namespace
  -- por workspace lo agrega la RPC, no se guarda aca.
  vault_secret_name text,

  -- Para integraciones por OAuth (Etapa 2). Los tokens van encriptados en
  -- Vault igual que las keys; aca solo metadata (expiracion, scopes).
  oauth_data jsonb,

  -- Config especifica del proveedor: modelo por defecto, remitente de email,
  -- etc. Nunca secretos.
  config jsonb NOT NULL DEFAULT '{}'::jsonb,

  is_active boolean NOT NULL DEFAULT false,
  connected_at timestamptz,
  last_error text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'integration_configs_type_check'
  ) THEN
    ALTER TABLE public.integration_configs ADD CONSTRAINT integration_configs_type_check
      CHECK (type IN ('channel', 'ai_provider', 'email_provider'));
  END IF;
END;
$$;

-- Una integracion por proveedor por workspace: guardar dos veces la key de
-- Resend tiene que ser un reemplazo, no una fila nueva.
CREATE UNIQUE INDEX IF NOT EXISTS idx_integration_configs_ws_type_provider
  ON public.integration_configs(workspace_id, type, provider);

-- La pantalla de integraciones lee todo con una sola query filtrada por tipo.
CREATE INDEX IF NOT EXISTS idx_integration_configs_ws_type
  ON public.integration_configs(workspace_id, type);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_integration_configs'
  ) THEN
    CREATE TRIGGER set_updated_at_integration_configs
      BEFORE UPDATE ON public.integration_configs
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
  END IF;
END;
$$;

COMMENT ON TABLE public.integration_configs IS
  'Integraciones del workspace (canales, IA, email). Las API keys viven en Vault; aca solo el nombre del secret.';
COMMENT ON COLUMN public.integration_configs.vault_secret_name IS
  'Nombre limpio del secret en Vault (sin el prefijo ws:<id>:). Null si la integracion no usa API key.';

-- ------------------------------------------------------------
-- RLS: solo Owner/Admin, en las cuatro operaciones.
-- ------------------------------------------------------------
ALTER TABLE public.integration_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "integration_configs_select" ON public.integration_configs;
CREATE POLICY "integration_configs_select" ON public.integration_configs
  FOR SELECT USING (public.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "integration_configs_insert" ON public.integration_configs;
CREATE POLICY "integration_configs_insert" ON public.integration_configs
  FOR INSERT WITH CHECK (public.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "integration_configs_update" ON public.integration_configs;
CREATE POLICY "integration_configs_update" ON public.integration_configs
  FOR UPDATE USING (public.is_workspace_admin(workspace_id))
  WITH CHECK (public.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "integration_configs_delete" ON public.integration_configs;
CREATE POLICY "integration_configs_delete" ON public.integration_configs
  FOR DELETE USING (public.is_workspace_admin(workspace_id));

-- ============================================================
-- MIGRATION 21: EMAIL LOG
-- ============================================================
-- ============================================================
-- MIGRACION 00021 — REGISTRO DE EMAILS SALIENTES
-- ============================================================
-- Que se intento mandar, a quien, y como salio. Sirve para tres cosas:
--
-- 1. Mientras Resend NO este conectado, cada envio queda registrado como
--    'skipped_not_configured'. Asi se ve que quedo pendiente en vez de
--    perderse en silencio.
-- 2. Cuando falla un envio real, queda el error y cuantos intentos hubo.
-- 3. La Fase 2 (secuencias por email) lo necesita igual.
--
-- NO se guarda el cuerpo del mensaje: el asunto y el destinatario alcanzan
-- para rastrear, y el cuerpo puede tener datos del contacto.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.email_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,

  to_email text NOT NULL,
  subject text NOT NULL,

  -- Para que era el mail: 'team_invite', 'channel_disconnected', ...
  -- Texto libre: cada funcionalidad nueva suma su tipo sin migrar.
  kind text NOT NULL,

  status text NOT NULL,

  -- Id que devuelve Resend. Sirve para rastrear el mail en su panel.
  provider_message_id text,

  attempts integer NOT NULL DEFAULT 0,
  last_error text,

  -- A que se refiere el mail (la invitacion, el canal que se cayo).
  related_entity_type text,
  related_entity_id uuid,

  -- Quien lo disparo. Null si fue el sistema (cron, webhook).
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'email_log_status_check'
  ) THEN
    ALTER TABLE public.email_log ADD CONSTRAINT email_log_status_check
      CHECK (status IN ('sent', 'failed', 'skipped_not_configured'));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_email_log_ws_created
  ON public.email_log(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_log_ws_status
  ON public.email_log(workspace_id, status);

COMMENT ON TABLE public.email_log IS
  'Emails salientes intentados. skipped_not_configured = no habia Resend conectado al momento del envio.';

-- ------------------------------------------------------------
-- RLS: leen Owner/Admin. Escribe solo el servidor.
-- ------------------------------------------------------------
-- El envio siempre pasa por el servidor con la service key (necesita leer la
-- API key de Vault), asi que no hace falta ninguna policy de escritura para
-- usuarios: service_role saltea RLS. Sin policy de INSERT, un usuario logueado
-- no puede inventar registros de envio.
ALTER TABLE public.email_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "email_log_select" ON public.email_log;
CREATE POLICY "email_log_select" ON public.email_log
  FOR SELECT USING (public.is_workspace_admin(workspace_id));

-- ============================================================
-- MIGRATION 22: CONTACTS CRM FIELDS
-- ============================================================
-- ============================================================
-- MIGRACION 00022 — MODELO DE CONTACTO EXTENDIDO (F9 + F10)
-- ============================================================
-- ZernFlow trae un contacto minimo: display_name, email, avatar_url,
-- is_subscribed, last_interaction_at y metadata. Para un CRM de servicios
-- digitales falta todo lo demas: telefono, redes, asignaciones, seguimiento,
-- atribucion y borrado logico.
--
-- Tres decisiones que conviene tener a la vista:
--
-- 1. Los campos de identidad (telefono, email secundario, usernames de red)
--    son los que usa la deduplicacion cross-canal de la migracion 00025. Por
--    eso llevan indice: se consultan en cada mensaje entrante.
-- 2. setter_id y vendedor_id son los que enciende el scope de leads en la
--    migracion 00024. Los TODO "BLOQUE 3" de la 00018 apuntan a estas columnas.
-- 3. Hay campos que hoy quedan vacios a proposito (ai_conversation_summary,
--    next_followup_date, attribution): se agregan ahora para no volver a
--    migrar la tabla cuando lleguen las fases que los usan.
--
-- Esta migracion NO toca policies ni funciones: solo agrega columnas e
-- indices. can_see_contact se reescribe en la 00024, despues de que estas
-- columnas existan.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Datos de contacto
-- ------------------------------------------------------------

ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS secondary_email text;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS country text;

COMMENT ON COLUMN public.contacts.phone IS
  'Telefono principal, normalizado como "+<digitos>" por lib/phone.ts. Clave de deduplicacion cross-canal.';

-- ------------------------------------------------------------
-- 2. Identidades por plataforma
-- ------------------------------------------------------------
-- Una columna por red en vez de un jsonb: se filtra y se indexa directo, que
-- es lo que necesita el matching de cada mensaje entrante.
-- tiktok/youtube/linkedin quedan vacias hasta la Etapa 2; se crean ahora para
-- que el modelo no cambie cuando esos canales lleguen.

ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS instagram_username text;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS tiktok_username text;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS youtube_channel_id text;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS linkedin_profile_url text;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS whatsapp_phone text;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS twitter_username text;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS facebook_id text;

COMMENT ON COLUMN public.contacts.instagram_username IS
  'Usuario de Instagram sin la arroba, en minusculas. Lo normaliza lib/contacts/fields.ts.';
COMMENT ON COLUMN public.contacts.whatsapp_phone IS
  'Telefono de WhatsApp cuando difiere del principal. Mismo formato normalizado que phone.';

-- ------------------------------------------------------------
-- 3. Asignacion doble: setter y vendedor
-- ------------------------------------------------------------
-- Opcionales e independientes. ON DELETE SET NULL: si se borra el usuario, el
-- lead queda sin asignar, no se pierde.

ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS setter_id uuid
  REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS vendedor_id uuid
  REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.contacts.setter_id IS
  'Quien contacta y califica. Junto con vendedor_id define el scope de leads (migracion 00024).';
COMMENT ON COLUMN public.contacts.vendedor_id IS
  'Quien cierra. Independiente de setter_id: un lead puede tener uno, los dos o ninguno.';

-- ------------------------------------------------------------
-- 4. Seguimiento, no contactar y temperatura
-- ------------------------------------------------------------

ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS next_followup_date timestamptz;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS do_not_contact boolean NOT NULL DEFAULT false;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS do_not_contact_reason text;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS do_not_contact_at timestamptz;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS ai_conversation_summary text;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS lead_temperature text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contacts_lead_temperature_check'
  ) THEN
    ALTER TABLE public.contacts ADD CONSTRAINT contacts_lead_temperature_check
      CHECK (lead_temperature IS NULL OR lead_temperature IN ('cold', 'warm', 'hot'));
  END IF;
END;
$$;

COMMENT ON COLUMN public.contacts.next_followup_date IS
  'Proximo seguimiento. Se llena a mano en Etapa 1; es la base del agendamiento de Etapa 4.';
COMMENT ON COLUMN public.contacts.ai_conversation_summary IS
  'Memoria acumulativa del agente IA. Queda vacio hasta la Fase 3; se crea ahora para no volver a migrar.';

-- ------------------------------------------------------------
-- 5. Atribucion (F10) — jsonb, sin tabla aparte
-- ------------------------------------------------------------
-- Es 1:1 con el contacto, asi que una tabla separada solo agregaria un JOIN.
-- first_click se escribe una sola vez, last_click se pisa en cada interaccion
-- atribuible. La logica de merge vive en lib/contacts/attribution.ts.

ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS attribution jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.contacts.attribution IS
  '{ "first_click": {...}, "last_click": {...} } con UTMs, fbclid, gclid, ad_id, campaign_id, referrer_url, landing_page y captured_at. first_click no se pisa nunca.';

-- ------------------------------------------------------------
-- 6. Borrado logico (F15)
-- ------------------------------------------------------------
-- Nada se borra de verdad: se marca y un cron diario purga a los 30 dias
-- (migracion 00025). Las policies de SELECT lo filtran en la 00024.

ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

COMMENT ON COLUMN public.contacts.deleted_at IS
  'Borrado logico. Retencion de 30 dias, despues lo purga /api/cron/purge-deleted.';

-- ------------------------------------------------------------
-- 7. Indices
-- ------------------------------------------------------------
-- Los de identidad son parciales (WHERE ... IS NOT NULL): la mayoria de los
-- contactos no tiene todas las redes cargadas, asi que el indice queda chico.
-- Van compuestos con workspace_id porque el matching siempre busca dentro de
-- un workspace.

CREATE INDEX IF NOT EXISTS idx_contacts_phone
  ON public.contacts(workspace_id, phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_whatsapp_phone
  ON public.contacts(workspace_id, whatsapp_phone) WHERE whatsapp_phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_email
  ON public.contacts(workspace_id, lower(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_secondary_email
  ON public.contacts(workspace_id, lower(secondary_email)) WHERE secondary_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_instagram
  ON public.contacts(workspace_id, instagram_username) WHERE instagram_username IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_tiktok
  ON public.contacts(workspace_id, tiktok_username) WHERE tiktok_username IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_twitter
  ON public.contacts(workspace_id, twitter_username) WHERE twitter_username IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_facebook
  ON public.contacts(workspace_id, facebook_id) WHERE facebook_id IS NOT NULL;

-- Filtros de la lista de contactos.
CREATE INDEX IF NOT EXISTS idx_contacts_setter
  ON public.contacts(workspace_id, setter_id) WHERE setter_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_vendedor
  ON public.contacts(workspace_id, vendedor_id) WHERE vendedor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_temperature
  ON public.contacts(workspace_id, lead_temperature) WHERE lead_temperature IS NOT NULL;

-- Todos los listados filtran deleted_at IS NULL, asi que el indice parcial
-- inverso (los vivos) es el que sirve; el cron de purga usa el otro.
CREATE INDEX IF NOT EXISTS idx_contacts_alive
  ON public.contacts(workspace_id, last_interaction_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_deleted_at
  ON public.contacts(deleted_at) WHERE deleted_at IS NOT NULL;

-- ============================================================
-- MIGRATION 23: CRM TABLES
-- ============================================================
-- ============================================================
-- MIGRACION 00023 — NOTAS, AUDIT LOG Y BORRADO LOGICO (F13 + F15)
-- ============================================================
-- Tres tablas nuevas y una columna:
--
-- 1. contact_notes. Las notas viven en el CONTACTO, no en la conversacion:
--    un lead que escribe por Instagram y por WhatsApp tiene dos
--    conversaciones pero una sola historia.
-- 2. audit_log. Registro central de que cambio, quien lo cambio y cuando.
--    Lo necesitan ya las asignaciones (F11), las vinculaciones cross-canal
--    (F12) y el borrado logico (F15). Nunca se borra: no tiene deleted_at.
-- 3. response_templates. Su CRUD y su UI son del Bloque 4, pero F15 exige que
--    tenga deleted_at y que la purga la cubra, asi que la tabla se crea aca,
--    vacia. La migracion del Bloque 4 es CREATE TABLE IF NOT EXISTS: la va a
--    encontrar hecha y no rompe nada.
-- 4. conversations.deleted_at, la cuarta tabla con soft delete de F15.
--
-- Sobre la RLS de contact_notes: la policy consulta contacts en vez de
-- llamar a can_see_contact. Una subconsulta dentro de una policy tambien pasa
-- por la RLS de la tabla que consulta, asi que las notas heredan el scope de
-- leads solas y no hay que volver a tocarlas cuando el scope cambie. Es el
-- mismo mecanismo que documenta la migracion 00018 para contact_channels y
-- contact_tags.
-- ============================================================

-- ------------------------------------------------------------
-- 1. contact_notes (F13)
-- ------------------------------------------------------------
-- workspace_id esta desnormalizado a proposito: se podria derivar del
-- contacto, pero tenerlo directo evita un JOIN en cada policy.

CREATE TABLE IF NOT EXISTS public.contact_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,

  content text NOT NULL,

  -- Quien la escribio. ON DELETE SET NULL: si el usuario se va, la nota queda.
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contact_notes_content_not_blank'
  ) THEN
    ALTER TABLE public.contact_notes ADD CONSTRAINT contact_notes_content_not_blank
      CHECK (length(btrim(content)) > 0);
  END IF;
END;
$$;

-- La ficha lista las notas vivas de un contacto, mas nuevas primero.
CREATE INDEX IF NOT EXISTS idx_contact_notes_contact
  ON public.contact_notes(contact_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contact_notes_deleted_at
  ON public.contact_notes(deleted_at) WHERE deleted_at IS NOT NULL;

DROP TRIGGER IF EXISTS set_updated_at ON public.contact_notes;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.contact_notes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

COMMENT ON TABLE public.contact_notes IS
  'Notas del contacto (no de la conversacion). Cualquier miembro crea; solo el autor o un Admin/Owner edita o borra.';

-- ------------------------------------------------------------
-- 2. audit_log (F20, adelantado porque el Bloque 3 ya escribe en el)
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,

  -- 'contact', 'contact_note', 'conversation', 'channel', 'workspace', ...
  -- Texto libre: cada funcionalidad nueva suma su tipo sin migrar.
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,

  -- 'create', 'update', 'delete', 'restore', 'assign', 'link', 'import', ...
  action text NOT NULL,

  -- { campo: { old: valor, new: valor } } para los updates.
  changes jsonb,

  -- Datos extra del evento (motivo de una vinculacion, filas de un import).
  metadata jsonb,

  -- Null = lo hizo el sistema (webhook, cron).
  performed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  performed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_workspace
  ON public.audit_log(workspace_id, performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity
  ON public.audit_log(entity_type, entity_id, performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_performer
  ON public.audit_log(workspace_id, performed_by, performed_at DESC);

COMMENT ON TABLE public.audit_log IS
  'Historial de cambios significativos. Inmutable y sin soft delete: no se edita ni se borra nunca.';

-- ------------------------------------------------------------
-- 3. response_templates — solo la estructura (F15; el CRUD es del Bloque 4)
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.response_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,

  name text NOT NULL,
  content text NOT NULL,

  -- Atajo para buscarlo rapido en la bandeja, ej "/precio".
  shortcut text,

  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_response_templates_workspace
  ON public.response_templates(workspace_id, name) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_response_templates_deleted_at
  ON public.response_templates(deleted_at) WHERE deleted_at IS NOT NULL;

DROP TRIGGER IF EXISTS set_updated_at ON public.response_templates;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.response_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

COMMENT ON TABLE public.response_templates IS
  'Respuestas rapidas con variables {{...}}. La tabla se crea en el Bloque 3 porque el soft delete de F15 la incluye; el CRUD y la UI son del Bloque 4.';

-- ------------------------------------------------------------
-- 4. Soft delete en conversations (F15)
-- ------------------------------------------------------------

ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

COMMENT ON COLUMN public.conversations.deleted_at IS
  'Borrado logico. Retencion de 30 dias, despues lo purga /api/cron/purge-deleted.';

CREATE INDEX IF NOT EXISTS idx_conversations_deleted_at
  ON public.conversations(deleted_at) WHERE deleted_at IS NOT NULL;

-- ------------------------------------------------------------
-- 5. RLS
-- ------------------------------------------------------------

-- contact_notes: leer y crear lo puede cualquier miembro que VEA el contacto
-- (de ahi la subconsulta, que hereda el scope de leads). Editar y borrar,
-- solo el autor o un Admin/Owner.
ALTER TABLE public.contact_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contact_notes_select" ON public.contact_notes;
CREATE POLICY "contact_notes_select" ON public.contact_notes
  FOR SELECT USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.id = contact_notes.contact_id
    )
  );

DROP POLICY IF EXISTS "contact_notes_insert" ON public.contact_notes;
CREATE POLICY "contact_notes_insert" ON public.contact_notes
  FOR INSERT WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.id = contact_notes.contact_id
        AND c.workspace_id = contact_notes.workspace_id
    )
  );

-- El borrado es logico, o sea un UPDATE: por eso el USING no exige que la
-- nota este viva (si no, no se podria restaurar) pero si exige autoria o rol.
DROP POLICY IF EXISTS "contact_notes_update" ON public.contact_notes;
CREATE POLICY "contact_notes_update" ON public.contact_notes
  FOR UPDATE USING (
    (created_by = auth.uid() OR public.is_workspace_admin(workspace_id))
    AND EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = contact_notes.contact_id)
  )
  WITH CHECK (
    created_by = auth.uid() OR public.is_workspace_admin(workspace_id)
  );

DROP POLICY IF EXISTS "contact_notes_delete" ON public.contact_notes;
CREATE POLICY "contact_notes_delete" ON public.contact_notes
  FOR DELETE USING (
    created_by = auth.uid() OR public.is_workspace_admin(workspace_id)
  );

-- audit_log: un Member ve solo lo que hizo el; Owner y Admin ven todo.
-- El INSERT exige performed_by = auth.uid(): nadie puede inventar una entrada
-- a nombre de otro. Los procesos del sistema escriben con la service key, que
-- saltea RLS, y ahi performed_by queda en null.
-- Sin policies de UPDATE ni DELETE: el registro es inmutable.
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_log_select" ON public.audit_log;
CREATE POLICY "audit_log_select" ON public.audit_log
  FOR SELECT USING (
    public.is_workspace_admin(workspace_id)
    OR (public.is_workspace_member(workspace_id) AND performed_by = auth.uid())
  );

DROP POLICY IF EXISTS "audit_log_insert" ON public.audit_log;
CREATE POLICY "audit_log_insert" ON public.audit_log
  FOR INSERT WITH CHECK (
    public.is_workspace_member(workspace_id) AND performed_by = auth.uid()
  );

-- response_templates: las ve cualquier miembro (las usa en la bandeja), las
-- gestionan Owner y Admin.
ALTER TABLE public.response_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "response_templates_select" ON public.response_templates;
CREATE POLICY "response_templates_select" ON public.response_templates
  FOR SELECT USING (deleted_at IS NULL AND public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "response_templates_insert" ON public.response_templates;
CREATE POLICY "response_templates_insert" ON public.response_templates
  FOR INSERT WITH CHECK (public.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "response_templates_update" ON public.response_templates;
CREATE POLICY "response_templates_update" ON public.response_templates
  FOR UPDATE USING (public.is_workspace_admin(workspace_id))
  WITH CHECK (public.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "response_templates_delete" ON public.response_templates;
CREATE POLICY "response_templates_delete" ON public.response_templates
  FOR DELETE USING (public.is_workspace_admin(workspace_id));

-- ============================================================
-- MIGRATION 24: LEAD SCOPE ON
-- ============================================================
-- ============================================================
-- MIGRACION 00024 — ENCENDER EL SCOPE DE LEADS
-- ============================================================
-- La migracion 00018 dejo todo enganchado y apagado: las policies de contacts
-- y conversations ya llaman a can_see_contact y can_see_conversation, y los
-- flags del workspace existen en false. Faltaban setter_id y vendedor_id, que
-- llegaron en la 00022.
--
-- Asi que aca NO se toca una sola policy de scope: se reescribe el cuerpo de
-- las dos funciones y se prenden los flags. Es exactamente lo que anticipaban
-- los TODO "BLOQUE 3" de la 00018 (lineas 129, 139 y 185).
--
-- Regla que queda vigente al terminar:
--   Owner y Admin ven y editan todo.
--   Un Member ve y edita SOLO los contactos donde es setter_id, vendedor_id o
--   agente asignado de alguna de sus conversaciones.
--   Un lead sin nadie asignado lo ven todos los Members o solo Owner/Admin,
--   segun workspaces.unassigned_leads_visible_to_members (default: false).
--
-- Sobre el borrado logico: el filtro deleted_at IS NULL va en las policies de
-- SELECT, no adentro de can_see_contact. Motivo: borrar es un UPDATE que setea
-- deleted_at, y si la condicion estuviera en el WITH CHECK del UPDATE la fila
-- resultante se rechazaria a si misma y no se podria borrar nada.
-- ============================================================

-- ------------------------------------------------------------
-- 1. can_see_contact — ahora mira setter_id y vendedor_id
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_see_contact(c public.contacts)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_scoped              boolean;
  v_unassigned_visible  boolean;
  v_has_assignee        boolean;
BEGIN
  IF NOT public.is_workspace_member(c.workspace_id) THEN
    RETURN false;
  END IF;

  IF public.is_workspace_admin(c.workspace_id) THEN
    RETURN true;
  END IF;

  SELECT w.lead_scope_enabled, w.unassigned_leads_visible_to_members
    INTO v_scoped, v_unassigned_visible
  FROM public.workspaces w
  WHERE w.id = c.workspace_id;

  IF NOT COALESCE(v_scoped, false) THEN
    RETURN true;
  END IF;

  -- Asignado a mi, por cualquiera de las tres vias.
  IF c.setter_id = auth.uid() OR c.vendedor_id = auth.uid() THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.conversations conv
    WHERE conv.contact_id = c.id AND conv.assigned_to = auth.uid()
  ) THEN
    RETURN true;
  END IF;

  -- Sin asignar: lo decide el flag del workspace. "Asignado" incluye tener
  -- setter o vendedor, aunque ninguna conversacion tenga agente.
  v_has_assignee := c.setter_id IS NOT NULL OR c.vendedor_id IS NOT NULL;

  IF NOT v_has_assignee THEN
    SELECT EXISTS (
      SELECT 1 FROM public.conversations conv
      WHERE conv.contact_id = c.id AND conv.assigned_to IS NOT NULL
    ) INTO v_has_assignee;
  END IF;

  IF NOT v_has_assignee THEN
    RETURN COALESCE(v_unassigned_visible, false);
  END IF;

  RETURN false;
END;
$$;

-- ------------------------------------------------------------
-- 2. can_see_conversation — el setter y el vendedor del contacto tambien ven
-- ------------------------------------------------------------
-- Sin esto, un vendedor asignado al lead no podria abrir su conversacion
-- mientras el agente asignado sea otro (o no haya ninguno).

CREATE OR REPLACE FUNCTION public.can_see_conversation(conv public.conversations)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_scoped              boolean;
  v_unassigned_visible  boolean;
  v_setter              uuid;
  v_vendedor            uuid;
BEGIN
  IF NOT public.is_workspace_member(conv.workspace_id) THEN
    RETURN false;
  END IF;

  IF public.is_workspace_admin(conv.workspace_id) THEN
    RETURN true;
  END IF;

  SELECT w.lead_scope_enabled, w.unassigned_leads_visible_to_members
    INTO v_scoped, v_unassigned_visible
  FROM public.workspaces w
  WHERE w.id = conv.workspace_id;

  IF NOT COALESCE(v_scoped, false) THEN
    RETURN true;
  END IF;

  IF conv.assigned_to = auth.uid() THEN
    RETURN true;
  END IF;

  SELECT c.setter_id, c.vendedor_id INTO v_setter, v_vendedor
  FROM public.contacts c
  WHERE c.id = conv.contact_id;

  IF v_setter = auth.uid() OR v_vendedor = auth.uid() THEN
    RETURN true;
  END IF;

  -- Sin agente y sin setter ni vendedor: lo decide el flag del workspace.
  IF conv.assigned_to IS NULL AND v_setter IS NULL AND v_vendedor IS NULL THEN
    RETURN COALESCE(v_unassigned_visible, false);
  END IF;

  RETURN false;
END;
$$;

-- Los GRANT de la 00018 sobreviven al CREATE OR REPLACE, pero se repiten por
-- si esta migracion corre sobre una base donde la 00018 fue parcial.
REVOKE ALL ON FUNCTION public.can_see_contact(public.contacts) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_see_conversation(public.conversations) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_see_contact(public.contacts) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_see_conversation(public.conversations) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 3. Los borrados logicos desaparecen de los SELECT
-- ------------------------------------------------------------
-- Solo se reescriben las policies de SELECT. Las de INSERT, UPDATE y DELETE
-- quedan tal cual las dejo la 00018.

DROP POLICY IF EXISTS "contacts_select" ON public.contacts;
CREATE POLICY "contacts_select" ON public.contacts
  FOR SELECT USING (deleted_at IS NULL AND public.can_see_contact(contacts));

DROP POLICY IF EXISTS "conversations_select" ON public.conversations;
CREATE POLICY "conversations_select" ON public.conversations
  FOR SELECT USING (deleted_at IS NULL AND public.can_see_conversation(conversations));

-- ------------------------------------------------------------
-- 4. Prender el scope
-- ------------------------------------------------------------
-- Default true para los workspaces nuevos y backfill de los que ya existen.
-- unassigned_leads_visible_to_members se queda en false: los leads sin
-- asignar los ven solo Owner y Admin, que es el default del requerimiento.
-- Los dos flags se pueden cambiar desde Settings sin tocar la base.

ALTER TABLE public.workspaces ALTER COLUMN lead_scope_enabled SET DEFAULT true;
UPDATE public.workspaces SET lead_scope_enabled = true WHERE lead_scope_enabled = false;

COMMENT ON COLUMN public.workspaces.lead_scope_enabled IS
  'Prendido desde el Bloque 3: un Member solo ve contactos y conversaciones donde es setter, vendedor o agente asignado. Se cambia desde Settings.';

-- ============================================================
-- MIGRATION 25: CONTACT MATCHING AND PURGE
-- ============================================================
-- ============================================================
-- MIGRACION 00025 — DEDUPLICACION CROSS-CANAL Y PURGA (F12 + F15)
-- ============================================================
-- Por que esto vive en la base y no en TypeScript:
--
-- La logica de "encontrar o crear el contacto de este remitente" estaba
-- escrita tres veces: en supabase/functions/_shared/inbound.ts (que corre en
-- Deno y es el receptor real hoy), en lib/inbox-sync.ts y otra vez adentro de
-- lib/comment-processor.ts. La primera no puede importar de lib/ porque es
-- otro runtime, asi que sumar el matching cross-canal en TypeScript
-- significaba escribirlo y mantenerlo tres veces.
--
-- Ademas hay una carrera real: si el mismo lead escribe por Instagram y por
-- WhatsApp en el mismo segundo, dos procesos leen "no existe" y los dos
-- crean el contacto. Adentro de una funcion es una sola transaccion.
--
-- Orden de identificacion (regla de negocio: nunca por nombre solo):
--   1. Ya conocemos a este remitente en este canal.
--   2. Telefono exacto  -> vincula automatico.
--   3. Email exacto     -> vincula automatico.
--   4. Username exacto en la columna de LA MISMA plataforma del canal
--      (los usernames son unicos por plataforma) -> vincula automatico.
--   5. Nada             -> contacto nuevo.
--
-- Un username que coincide en OTRA plataforma no vincula: queda como
-- sugerencia en contacts.metadata.link_suggestions para que la ficha se la
-- ofrezca al operador. Es lo que pide F12 para los matches sin confirmar.
--
-- Cada canal conserva SU conversacion: esta funcion solo toca contacts y
-- contact_channels. La conversacion la crea upsertConversation por separado,
-- siempre por (channel_id, contact_id).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Normalizadores
-- ------------------------------------------------------------
-- Un username se guarda siempre en minusculas y sin arroba, para que la
-- comparacion sea exacta y el indice sirva. El telefono ya llega normalizado
-- como "+<digitos>" desde lib/phone.ts.

CREATE OR REPLACE FUNCTION public.normalize_handle(p_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT NULLIF(lower(btrim(ltrim(btrim(p_raw), '@'))), '');
$$;

CREATE OR REPLACE FUNCTION public.normalize_email(p_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT NULLIF(lower(btrim(p_raw)), '');
$$;

REVOKE ALL ON FUNCTION public.normalize_handle(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.normalize_email(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.normalize_handle(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.normalize_email(text) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 2. find_or_link_contact
-- ------------------------------------------------------------
-- Devuelve jsonb:
--   { "contact_id": uuid,
--     "existed": bool,            -- ya habia un contacto detras
--     "linked_by": text,          -- channel | phone | email | username | null
--     "suggested_contact_id": uuid | null }
--
-- SECURITY DEFINER: corre como dueña de las tablas, asi que ve todos los
-- contactos del workspace aunque quien la llame sea un Member con scope. Es
-- necesario — si no, un mensaje entrante crearia duplicados de leads que el
-- operador no tiene asignados. La funcion nunca DEVUELVE datos del contacto,
-- solo su id, asi que no filtra informacion fuera del scope.

CREATE OR REPLACE FUNCTION public.find_or_link_contact(
  p_channel_id      uuid,
  p_sender_id       text,
  p_display_name    text        DEFAULT NULL,
  p_username        text        DEFAULT NULL,
  p_avatar_url      text        DEFAULT NULL,
  p_phone           text        DEFAULT NULL,
  p_email           text        DEFAULT NULL,
  p_interaction_at  timestamptz DEFAULT now(),
  p_stamp_existing  boolean     DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ws          uuid;
  v_platform    text;
  v_handle      text;
  v_email       text;
  v_phone       text;
  v_contact     uuid;
  v_suggested   uuid;
  v_linked_by   text;
BEGIN
  SELECT ch.workspace_id, ch.platform INTO v_ws, v_platform
  FROM public.channels ch WHERE ch.id = p_channel_id;

  IF v_ws IS NULL THEN
    RETURN jsonb_build_object('contact_id', NULL, 'existed', false,
                              'linked_by', NULL, 'suggested_contact_id', NULL);
  END IF;

  v_handle := public.normalize_handle(p_username);
  v_email  := public.normalize_email(p_email);
  v_phone  := NULLIF(btrim(p_phone), '');

  -- ---- 1. Remitente ya conocido en este canal -------------------------
  SELECT cc.contact_id INTO v_contact
  FROM public.contact_channels cc
  WHERE cc.channel_id = p_channel_id AND cc.platform_sender_id = p_sender_id;

  IF v_contact IS NOT NULL THEN
    IF p_stamp_existing THEN
      UPDATE public.contacts
      SET last_interaction_at = p_interaction_at
      WHERE id = v_contact;
    END IF;
    RETURN jsonb_build_object('contact_id', v_contact, 'existed', true,
                              'linked_by', 'channel', 'suggested_contact_id', NULL);
  END IF;

  -- ---- 2. Telefono exacto ---------------------------------------------
  IF v_phone IS NOT NULL THEN
    SELECT c.id INTO v_contact
    FROM public.contacts c
    WHERE c.workspace_id = v_ws
      AND c.deleted_at IS NULL
      AND (c.phone = v_phone OR c.whatsapp_phone = v_phone)
    ORDER BY c.created_at
    LIMIT 1;
    IF v_contact IS NOT NULL THEN v_linked_by := 'phone'; END IF;
  END IF;

  -- ---- 3. Email exacto -------------------------------------------------
  IF v_contact IS NULL AND v_email IS NOT NULL THEN
    SELECT c.id INTO v_contact
    FROM public.contacts c
    WHERE c.workspace_id = v_ws
      AND c.deleted_at IS NULL
      AND (lower(c.email) = v_email OR lower(c.secondary_email) = v_email)
    ORDER BY c.created_at
    LIMIT 1;
    IF v_contact IS NOT NULL THEN v_linked_by := 'email'; END IF;
  END IF;

  -- ---- 4. Username en la MISMA plataforma ------------------------------
  -- Ramas explicitas en vez de SQL dinamico: se leen mejor y usan los
  -- indices parciales de la migracion 00022.
  IF v_contact IS NULL AND v_handle IS NOT NULL THEN
    SELECT c.id INTO v_contact
    FROM public.contacts c
    WHERE c.workspace_id = v_ws
      AND c.deleted_at IS NULL
      AND CASE v_platform
            WHEN 'instagram' THEN lower(c.instagram_username) = v_handle
            WHEN 'twitter'   THEN lower(c.twitter_username)   = v_handle
            WHEN 'facebook'  THEN lower(c.facebook_id)        = v_handle
            WHEN 'tiktok'    THEN lower(c.tiktok_username)    = v_handle
            ELSE false
          END
    ORDER BY c.created_at
    LIMIT 1;
    IF v_contact IS NOT NULL THEN v_linked_by := 'username'; END IF;
  END IF;

  -- ---- Vincular al contacto encontrado ---------------------------------
  IF v_contact IS NOT NULL THEN
    -- COALESCE en ese orden: lo que ya estaba cargado gana. Un mensaje
    -- entrante completa huecos, nunca pisa lo que cargo una persona.
    UPDATE public.contacts c SET
      last_interaction_at = GREATEST(COALESCE(c.last_interaction_at, p_interaction_at), p_interaction_at),
      display_name        = COALESCE(c.display_name, NULLIF(btrim(p_display_name), '')),
      avatar_url          = COALESCE(c.avatar_url, p_avatar_url),
      phone               = COALESCE(c.phone, v_phone),
      email               = COALESCE(c.email, v_email),
      whatsapp_phone      = CASE WHEN v_platform = 'whatsapp'  THEN COALESCE(c.whatsapp_phone, v_phone)  ELSE c.whatsapp_phone END,
      instagram_username  = CASE WHEN v_platform = 'instagram' THEN COALESCE(c.instagram_username, v_handle) ELSE c.instagram_username END,
      twitter_username    = CASE WHEN v_platform = 'twitter'   THEN COALESCE(c.twitter_username, v_handle)   ELSE c.twitter_username END,
      facebook_id         = CASE WHEN v_platform = 'facebook'  THEN COALESCE(c.facebook_id, v_handle)        ELSE c.facebook_id END,
      tiktok_username     = CASE WHEN v_platform = 'tiktok'    THEN COALESCE(c.tiktok_username, v_handle)    ELSE c.tiktok_username END
    WHERE c.id = v_contact;

    INSERT INTO public.contact_channels (contact_id, channel_id, platform_sender_id, platform_username)
    VALUES (v_contact, p_channel_id, p_sender_id, v_handle)
    ON CONFLICT (channel_id, platform_sender_id) DO NOTHING;

    -- Vinculacion automatica: queda registrada (F12).
    INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, metadata, performed_by)
    VALUES (v_ws, 'contact', v_contact, 'link',
            jsonb_build_object('linked_by', v_linked_by, 'channel_id', p_channel_id,
                               'platform', v_platform, 'automatic', true),
            NULL);

    RETURN jsonb_build_object('contact_id', v_contact, 'existed', true,
                              'linked_by', v_linked_by, 'suggested_contact_id', NULL);
  END IF;

  -- ---- 5. Contacto nuevo ------------------------------------------------
  -- Antes de crearlo: si el handle coincide con OTRA plataforma, es un match
  -- sin confirmar. No se vincula, se deja anotado para que decida una persona.
  IF v_handle IS NOT NULL THEN
    SELECT c.id INTO v_suggested
    FROM public.contacts c
    WHERE c.workspace_id = v_ws
      AND c.deleted_at IS NULL
      AND v_handle IN (
        lower(c.instagram_username), lower(c.twitter_username),
        lower(c.tiktok_username),    lower(c.facebook_id)
      )
    ORDER BY c.created_at
    LIMIT 1;
  END IF;

  INSERT INTO public.contacts (
    workspace_id, display_name, avatar_url, last_interaction_at,
    phone, email, whatsapp_phone, instagram_username, twitter_username,
    facebook_id, tiktok_username, metadata
  )
  VALUES (
    v_ws,
    NULLIF(btrim(p_display_name), ''),
    p_avatar_url,
    p_interaction_at,
    v_phone,
    v_email,
    CASE WHEN v_platform = 'whatsapp'  THEN v_phone  END,
    CASE WHEN v_platform = 'instagram' THEN v_handle END,
    CASE WHEN v_platform = 'twitter'   THEN v_handle END,
    CASE WHEN v_platform = 'facebook'  THEN v_handle END,
    CASE WHEN v_platform = 'tiktok'    THEN v_handle END,
    CASE
      WHEN v_suggested IS NULL THEN '{}'::jsonb
      ELSE jsonb_build_object('link_suggestions', jsonb_build_array(jsonb_build_object(
             'contact_id', v_suggested,
             'reason', 'username',
             'handle', v_handle,
             'at', p_interaction_at
           )))
    END
  )
  RETURNING id INTO v_contact;

  INSERT INTO public.contact_channels (contact_id, channel_id, platform_sender_id, platform_username)
  VALUES (v_contact, p_channel_id, p_sender_id, v_handle)
  ON CONFLICT (channel_id, platform_sender_id) DO NOTHING;

  INSERT INTO public.analytics_events (workspace_id, contact_id, event_type)
  VALUES (v_ws, v_contact, 'contact_created');

  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, metadata, performed_by)
  VALUES (v_ws, 'contact', v_contact, 'create',
          jsonb_build_object('source', 'inbound', 'channel_id', p_channel_id,
                             'platform', v_platform,
                             'suggested_contact_id', v_suggested),
          NULL);

  RETURN jsonb_build_object('contact_id', v_contact, 'existed', false,
                            'linked_by', NULL, 'suggested_contact_id', v_suggested);
END;
$$;

REVOKE ALL ON FUNCTION public.find_or_link_contact(uuid, text, text, text, text, text, text, timestamptz, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_or_link_contact(uuid, text, text, text, text, text, text, timestamptz, boolean) TO authenticated, service_role;

COMMENT ON FUNCTION public.find_or_link_contact(uuid, text, text, text, text, text, text, timestamptz, boolean) IS
  'Encuentra o crea el contacto de un remitente, deduplicando por telefono, email o username de la misma plataforma. Unica fuente de verdad: la usan el webhook (Deno), el backfill y el procesador de comentarios.';

-- ------------------------------------------------------------
-- 3. Purga de los borrados logicos (F15)
-- ------------------------------------------------------------
-- Borrar un contacto arrastra sus notas, conversaciones, mensajes, tags y
-- custom fields: todas esas FK son ON DELETE CASCADE desde la migracion 00001.
-- Por eso los contactos van primero y despues se limpia lo que quedo suelto.

CREATE OR REPLACE FUNCTION public.purge_soft_deleted(p_retention_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cutoff     timestamptz := now() - make_interval(days => GREATEST(p_retention_days, 0));
  v_contacts   integer := 0;
  v_notes      integer := 0;
  v_convs      integer := 0;
  v_templates  integer := 0;
BEGIN
  DELETE FROM public.contacts WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_contacts = ROW_COUNT;

  DELETE FROM public.conversations WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_convs = ROW_COUNT;

  DELETE FROM public.contact_notes WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_notes = ROW_COUNT;

  DELETE FROM public.response_templates WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_templates = ROW_COUNT;

  RETURN jsonb_build_object(
    'cutoff', v_cutoff,
    'contacts', v_contacts,
    'conversations', v_convs,
    'contact_notes', v_notes,
    'response_templates', v_templates
  );
END;
$$;

-- Solo el servidor la llama, con la service key, desde /api/cron/purge-deleted.
REVOKE ALL ON FUNCTION public.purge_soft_deleted(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_soft_deleted(integer) TO service_role;

COMMENT ON FUNCTION public.purge_soft_deleted(integer) IS
  'Borra de verdad lo que lleva mas de N dias marcado como eliminado. La llama el cron diario /api/cron/purge-deleted.';

-- ============================================================
-- MIGRATION 26: RESPONSE TEMPLATES SHORTCUT
-- ============================================================
-- ============================================================
-- MIGRACION 00026 — ATAJOS UNICOS EN LOS TEMPLATES (F17)
-- ============================================================
-- La tabla response_templates y su RLS ya estan completas desde la 00023, que
-- la creo vacia para que el borrado logico de F15 la cubriera. Lo unico que le
-- falta para el Bloque 4 es lo que aparece recien cuando la tabla se usa: que
-- el atajo sirva para elegir un template sin ambiguedad.
--
-- Dos reglas, las dos por el mismo motivo:
--
-- 1. Formato fijo (barra + minusculas, numeros, guiones). En la bandeja el
--    atajo se escribe atras de "/", asi que un atajo con espacios o mayusculas
--    es un atajo que nadie va a poder tipear.
-- 2. Unico por workspace. Con dos "/precio" el selector tiene que elegir uno y
--    la persona no tiene forma de saber cual le va a tocar.
--
-- Los dos son restricciones sobre datos que ya podrian existir (este proyecto
-- se clona), asi que antes de restringir se normaliza: los atajos se pasan a
-- minusculas, los que no entran en el formato se dejan en NULL y de los
-- repetidos sobrevive el mas viejo. Anular un atajo no pierde el template: el
-- nombre sigue estando y se sigue pudiendo buscar por ahi.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Normalizar lo que pueda haber
-- ------------------------------------------------------------

UPDATE public.response_templates
SET shortcut = lower(btrim(shortcut))
WHERE shortcut IS NOT NULL AND shortcut <> lower(btrim(shortcut));

-- Lo que no entra en el formato se queda sin atajo en vez de bloquear la
-- migracion. La barra inicial se agrega sola si falta, que es el error tipico.
UPDATE public.response_templates
SET shortcut = '/' || shortcut
WHERE shortcut IS NOT NULL
  AND shortcut !~ '^/'
  AND ('/' || shortcut) ~ '^/[a-z0-9][a-z0-9_-]{0,29}$';

UPDATE public.response_templates
SET shortcut = NULL
WHERE shortcut IS NOT NULL AND shortcut !~ '^/[a-z0-9][a-z0-9_-]{0,29}$';

-- De los repetidos dentro de un workspace sobrevive el primero que se creo.
UPDATE public.response_templates t
SET shortcut = NULL
WHERE t.shortcut IS NOT NULL
  AND t.deleted_at IS NULL
  AND EXISTS (
    SELECT 1 FROM public.response_templates otro
    WHERE otro.workspace_id = t.workspace_id
      AND otro.shortcut = t.shortcut
      AND otro.deleted_at IS NULL
      AND (otro.created_at, otro.id) < (t.created_at, t.id)
  );

-- ------------------------------------------------------------
-- 2. Formato del atajo
-- ------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'response_templates_shortcut_format'
  ) THEN
    ALTER TABLE public.response_templates
      ADD CONSTRAINT response_templates_shortcut_format
      CHECK (shortcut IS NULL OR shortcut ~ '^/[a-z0-9][a-z0-9_-]{0,29}$');
  END IF;
END;
$$;

-- El nombre tampoco puede quedar vacio: es lo que se ve en el selector.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'response_templates_name_not_blank'
  ) THEN
    ALTER TABLE public.response_templates
      ADD CONSTRAINT response_templates_name_not_blank
      CHECK (length(btrim(name)) > 0);
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'response_templates_content_not_blank'
  ) THEN
    ALTER TABLE public.response_templates
      ADD CONSTRAINT response_templates_content_not_blank
      CHECK (length(btrim(content)) > 0);
  END IF;
END;
$$;

-- ------------------------------------------------------------
-- 3. Un atajo por workspace
-- ------------------------------------------------------------
-- Parcial sobre los vivos: un template borrado no tiene que reservar su atajo,
-- porque a los 30 dias lo purga el cron de F15 y mientras tanto nadie lo ve.

CREATE UNIQUE INDEX IF NOT EXISTS idx_response_templates_shortcut
  ON public.response_templates(workspace_id, shortcut)
  WHERE deleted_at IS NULL AND shortcut IS NOT NULL;

COMMENT ON COLUMN public.response_templates.shortcut IS
  'Atajo para elegir el template escribiendo "/" en la bandeja. Formato /minusculas-numeros, unico entre los templates vivos del workspace. NULL = el template se busca solo por nombre.';

-- ============================================================
-- MIGRATION 27: OPT OUT
-- ============================================================
-- ============================================================
-- MIGRACION 00027 — DETECCION DE "NO CONTACTAR" (F18)
-- ============================================================
-- Cuando un lead escribe "no me contactes", el sistema tiene que marcarlo,
-- frenarle las secuencias y dejar constancia. Las columnas de la marca ya
-- existen desde la 00022 y el marcado a mano ya funciona; lo que falta es que
-- pase solo al recibir el mensaje.
--
-- Por que en SQL y no en TypeScript, que seria lo natural:
--
-- 1. Los mensajes entran por dos runtimes distintos: la Edge Function (Deno),
--    que es el receptor vivo, y /api/webhooks/late (Node), que ademas corre el
--    motor de flows. Deno no puede importar de lib/, asi que en TypeScript
--    esto se escribe y se mantiene dos veces. Es el mismo problema que la
--    00025 resolvio empujando find_or_link_contact a la base.
-- 2. Marcar el contacto, pausar sus inscripciones y escribir el audit son tres
--    escrituras que tienen que pasar juntas o no pasar.
-- 3. Un lead que manda "basta" por WhatsApp y por Instagram al mismo tiempo no
--    puede dejar el trabajo a medias.
--
-- Sobre como se busca la frase: por palabra completa, nunca por substring. Un
-- LIKE '%baja%' marca a quien escribe "trabaja con ustedes" o "me hacen una
-- rebaja?", que es exactamente el lead que no hay que perder. La comparacion
-- ignora mayusculas, acentos y puntuacion, porque nadie escribe con tildes
-- cuando esta enojado.
--
-- Las frases son configurables por workspace, como global_keywords: es una
-- lista corta que se edita entera desde Settings y no justifica una tabla.
-- La lista por defecto es deliberadamente conservadora. Quedan afuera "baja"
-- sola (demasiado corta) y "no me interesa" (es un no blando, no un pedido de
-- que dejen de escribirle); el workspace las agrega si quiere.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Las frases del workspace
-- ------------------------------------------------------------

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS opt_out_phrases jsonb NOT NULL DEFAULT
    '["no me contactes","no me contacten","no me escribas mas","no me escriban mas","no quiero recibir mensajes","dejen de escribirme","dejame de escribir","dar de baja","darme de baja","stop","unsubscribe","basta"]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspaces_opt_out_phrases_is_array'
  ) THEN
    ALTER TABLE public.workspaces
      ADD CONSTRAINT workspaces_opt_out_phrases_is_array
      CHECK (jsonb_typeof(opt_out_phrases) = 'array');
  END IF;
END;
$$;

COMMENT ON COLUMN public.workspaces.opt_out_phrases IS
  'Frases que marcan un contacto como "no contactar" cuando aparecen en un mensaje entrante (F18). Se editan desde Settings. Se comparan por palabra completa, sin acentos ni mayusculas.';

-- ------------------------------------------------------------
-- 2. Normalizacion y comparacion de frases
-- ------------------------------------------------------------
-- Aparte para poder probarla sola y para que la pantalla de configuracion
-- pueda mostrar en vivo que atrapa cada frase antes de guardarla.

CREATE OR REPLACE FUNCTION public.normalize_message_text(p_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  -- Minusculas, sin acentos y con cualquier cosa que no sea letra o numero
  -- convertida en un espacio. "NO ME ESCRIBAS MAS!!!" y "no me escribas mas"
  -- terminan siendo el mismo texto.
  SELECT btrim(regexp_replace(
    translate(lower(btrim(coalesce(p_raw, ''))),
              'áàäâãéèëêíìïîóòöôõúùüûñç',
              'aaaaaeeeeiiiiooooouuuunc'),
    '[^a-z0-9]+', ' ', 'g'
  ));
$$;

/*
 * true si el texto contiene la frase como secuencia de palabras completas.
 * Los dos lados se normalizan igual, y despues se busca la frase rodeada de
 * limites de palabra: asi "baja" no matchea adentro de "trabaja".
 */
CREATE OR REPLACE FUNCTION public.text_matches_phrase(p_text text, p_phrase text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_text   text := public.normalize_message_text(p_text);
  v_phrase text := public.normalize_message_text(p_phrase);
BEGIN
  IF v_text = '' OR v_phrase = '' THEN
    RETURN false;
  END IF;

  RETURN (' ' || v_text || ' ') LIKE ('% ' || v_phrase || ' %');
END;
$$;

REVOKE ALL ON FUNCTION public.normalize_message_text(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.text_matches_phrase(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.normalize_message_text(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.text_matches_phrase(text, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.text_matches_phrase(text, text) IS
  'true si el mensaje contiene la frase como palabras completas, ignorando mayusculas, acentos y puntuacion. Nunca por substring: "baja" no matchea en "trabaja".';

-- ------------------------------------------------------------
-- 3. apply_opt_out_check — la que corre el receptor
-- ------------------------------------------------------------
-- Devuelve jsonb:
--   { "matched": bool,
--     "phrase": text | null,       -- la frase que disparo
--     "already": bool,             -- ya estaba marcado de antes
--     "sequences_paused": int }
--
-- SECURITY DEFINER porque la llaman los webhooks con la service key y porque
-- tiene que poder marcar un contacto que el operador de turno no tiene
-- asignado. No devuelve ningun dato del contacto mas alla de si matcheo, asi
-- que no filtra nada fuera del scope de leads.
--
-- Solo service_role: marcar un contacto como "no contactar" a nombre del
-- sistema es una accion de sistema. Un usuario logueado tiene setDoNotContact,
-- que deja su nombre en el audit log.

CREATE OR REPLACE FUNCTION public.apply_opt_out_check(
  p_contact_id      uuid,
  p_conversation_id uuid DEFAULT NULL,
  p_text            text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_workspace_id uuid;
  v_already      boolean;
  v_phrases      jsonb;
  v_phrase       text;
  v_match        text := NULL;
  v_paused       integer := 0;
BEGIN
  IF p_contact_id IS NULL OR btrim(coalesce(p_text, '')) = '' THEN
    RETURN jsonb_build_object('matched', false, 'already', false, 'sequences_paused', 0);
  END IF;

  SELECT c.workspace_id, c.do_not_contact
    INTO v_workspace_id, v_already
  FROM public.contacts c
  WHERE c.id = p_contact_id;

  IF v_workspace_id IS NULL THEN
    RETURN jsonb_build_object('matched', false, 'already', false, 'sequences_paused', 0);
  END IF;

  -- Ya marcado: no se vuelve a escribir nada. Sin esta guarda, cada mensaje
  -- posterior del lead sumaria otra entrada identica al audit log y pisaria la
  -- razon original, que es la que explica por que quedo marcado.
  IF v_already THEN
    RETURN jsonb_build_object('matched', false, 'already', true, 'sequences_paused', 0);
  END IF;

  SELECT w.opt_out_phrases INTO v_phrases
  FROM public.workspaces w WHERE w.id = v_workspace_id;

  FOR v_phrase IN SELECT jsonb_array_elements_text(coalesce(v_phrases, '[]'::jsonb))
  LOOP
    IF public.text_matches_phrase(p_text, v_phrase) THEN
      v_match := v_phrase;
      EXIT;
    END IF;
  END LOOP;

  IF v_match IS NULL THEN
    RETURN jsonb_build_object('matched', false, 'already', false, 'sequences_paused', 0);
  END IF;

  -- is_subscribed tambien baja: es la marca que ya miraban los broadcasts y
  -- las palabras clave globales de ZernFlow, y seria raro que un contacto
  -- quede "no contactar" pero suscripto.
  UPDATE public.contacts
  SET do_not_contact = true,
      do_not_contact_reason = 'auto: ' || v_match,
      do_not_contact_at = now(),
      is_subscribed = false
  WHERE id = p_contact_id;

  UPDATE public.sequence_enrollments
  SET status = 'paused'
  WHERE contact_id = p_contact_id AND status = 'active';
  GET DIAGNOSTICS v_paused = ROW_COUNT;

  -- performed_by en null: lo hizo el sistema, no una persona.
  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by)
  VALUES (
    v_workspace_id, 'contact', p_contact_id, 'do_not_contact',
    jsonb_build_object('do_not_contact', jsonb_build_object('old', false, 'new', true)),
    jsonb_build_object(
      'source', 'auto',
      'phrase', v_match,
      'conversation_id', p_conversation_id,
      'sequences_paused', v_paused
    ),
    NULL
  );

  RETURN jsonb_build_object(
    'matched', true, 'phrase', v_match, 'already', false, 'sequences_paused', v_paused
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_opt_out_check(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_opt_out_check(uuid, uuid, text) TO service_role;

COMMENT ON FUNCTION public.apply_opt_out_check(uuid, uuid, text) IS
  'Marca el contacto como "no contactar" si el mensaje trae una frase de opt-out del workspace: pausa sus secuencias activas y deja la entrada en audit_log, todo en una transaccion. La llaman los dos receptores de webhooks. Idempotente: sobre un contacto ya marcado no escribe nada.';

-- ------------------------------------------------------------
-- 4. El estado "pausada" de las inscripciones
-- ------------------------------------------------------------
-- La columna no tiene CHECK (viene asi de la 00005) y el procesador solo toma
-- las 'active', asi que sumar el valor no necesita DDL. Se documenta y se
-- indexan las dos consultas que ahora importan: la del cron, que hasta hoy
-- escaneaba la tabla entera cada minuto, y la pausa por contacto.

COMMENT ON COLUMN public.sequence_enrollments.status IS
  'active = corriendo | paused = frenada porque el contacto pidio no ser contactado (F18); no se reanuda sola, ni siquiera al sacar la marca | completed = termino | cancelled = la secuencia dejo de estar activa.';

CREATE INDEX IF NOT EXISTS idx_sequence_enrollments_due
  ON public.sequence_enrollments(next_step_at)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_sequence_enrollments_contact
  ON public.sequence_enrollments(contact_id, status);

-- ============================================================
-- MIGRATION 28: CONVERSATION SCOPE ALIGNMENT
-- ============================================================
-- ============================================================
-- MIGRACION 00028 — QUE VER LA CONVERSACION Y VER AL LEAD SEAN LO MISMO (F16)
-- ============================================================
-- can_see_contact y can_see_conversation (00024) no dicen lo mismo, y eso deja
-- un hueco. El caso concreto:
--
--   Un lead sin setter ni vendedor tiene dos conversaciones: una asignada a
--   Alicia y otra sin nadie. Con unassigned_leads_visible_to_members prendido,
--   Bruno ve la conversacion sin asignar — pero NO ve al contacto, porque
--   can_see_contact considera que el lead "ya tiene dueño" apenas alguna de
--   sus conversaciones tiene agente.
--
-- Hoy eso se nota como conversaciones que aparecen en la bandeja con el nombre
-- vacio, porque el contacto que las acompaña no vuelve de la consulta. Y en
-- cuanto los filtros de F16 unan conversations con contacts para poder filtrar
-- por tag, por setter o por vendedor, esas conversaciones directamente
-- desaparecen sin explicacion.
--
-- La regla queda dicha una sola vez: se ve la conversacion de un lead que se
-- puede ver. Es lo que ya asume la ficha del contacto de F14, que muestra
-- todas sus conversaciones agrupadas por canal.
--
-- Lo que esto NO cambia: quien es agente asignado de una conversacion la sigue
-- viendo aunque no sea setter ni vendedor del contacto. can_see_contact
-- comprueba exactamente eso (00024, punto 6: existe una conversacion del
-- contacto con assigned_to = auth.uid()) antes de evaluar el caso "sin
-- asignar", asi que ser agente ya alcanza para ver al lead, y ver al lead
-- alcanza para ver la conversacion. Los casos de regresion de
-- scripts/verify-rls.mjs lo fijan.
--
-- Lo que si cambia, y conviene tenerlo presente: quien es agente de UNA
-- conversacion de un lead pasa a ver TODAS las conversaciones de ese lead (si
-- le asignaron el chat de WhatsApp, tambien ve el de Instagram). Es la lectura
-- que evita el absurdo de una ficha visible con huecos adentro.
--
-- Una trampa que hay que esquivar al leer esto: adentro de una funcion
-- SECURITY DEFINER, una subconsulta a contacts NO pasa por la RLS de contacts
-- (corre como la dueña de la tabla). El truco de "la subconsulta hereda el
-- scope sola" que documenta la 00023 para contact_notes vale en una POLICY,
-- que corre como quien invoca. Por eso aca hay que llamar a can_see_contact
-- explicitamente: sin esa llamada, esto le abriria todas las conversaciones a
-- todo el mundo.
-- ============================================================

-- ------------------------------------------------------------
-- 1. can_see_conversation delega en can_see_contact
-- ------------------------------------------------------------
-- No hay recursion: can_see_contact consulta la TABLA conversations (sin RLS,
-- por ser SECURITY DEFINER) y no llama a esta funcion.

CREATE OR REPLACE FUNCTION public.can_see_conversation(conv public.conversations)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_workspace_member(conv.workspace_id) THEN
    RETURN false;
  END IF;

  IF public.is_workspace_admin(conv.workspace_id) THEN
    RETURN true;
  END IF;

  -- El contacto borrado tambien esconde sus conversaciones: mientras el cron
  -- de F15 no lo purgue, no tiene por que seguir apareciendo en la bandeja.
  RETURN EXISTS (
    SELECT 1
    FROM public.contacts c
    WHERE c.id = conv.contact_id
      AND c.deleted_at IS NULL
      AND public.can_see_contact(c)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.can_see_conversation(public.conversations) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_see_conversation(public.conversations) TO authenticated, service_role;

COMMENT ON FUNCTION public.can_see_conversation(public.conversations) IS
  'Se ve la conversacion de un lead que se puede ver. Delega en can_see_contact para que las dos reglas no puedan separarse (migracion 00028).';

-- ------------------------------------------------------------
-- 2. El indice que esta consulta usa en cada fila
-- ------------------------------------------------------------
-- can_see_contact pregunta "tiene este contacto alguna conversacion con agente
-- asignado". Sin indice es un scan de conversations por cada fila evaluada, y
-- ahora se evalua tambien para llegar a la conversacion.

CREATE INDEX IF NOT EXISTS idx_conversations_contact_assigned
  ON public.conversations(contact_id, assigned_to);

-- ============================================================
-- MIGRATION 29: INBOX FILTER INDEXES
-- ============================================================
-- ============================================================
-- MIGRACION 00029 — INDICES PARA LOS FILTROS DE LA BANDEJA (F16)
-- ============================================================
-- Hasta ahora la bandeja traia 50 conversaciones ordenadas por fecha y
-- filtraba en memoria, asi que a la base solo le pedia eso. Con los filtros de
-- F16 la consulta cambia de forma: estado, canal, asignado y rango de fechas
-- se resuelven en Postgres y con paginacion, que es la unica manera de que el
-- filtro no mienta cuando hay mas conversaciones que las que entran en una
-- tanda.
--
-- Los tres indices cubren las consultas que aparecen, no todas las
-- combinaciones posibles: el orden siempre es por last_message_at descendente,
-- asi que va al final de cada uno.
-- ============================================================

-- Lo que se pide al entrar: las abiertas, mas recientes primero. Ya existia
-- idx_conversations_status(workspace_id, status), pero sin la fecha adentro el
-- orden se resuelve igual con un sort de todo lo que matchea.
CREATE INDEX IF NOT EXISTS idx_conversations_ws_status_last
  ON public.conversations(workspace_id, status, last_message_at DESC)
  WHERE deleted_at IS NULL;

-- El filtro por persona asignada.
CREATE INDEX IF NOT EXISTS idx_conversations_ws_assigned_last
  ON public.conversations(workspace_id, assigned_to, last_message_at DESC)
  WHERE deleted_at IS NULL;

-- Filtrar por tag entra por el tag y sale por los contactos. La clave primaria
-- de contact_tags es (contact_id, tag_id), que sirve para "los tags de este
-- contacto" y no para "los contactos de este tag", que es lo que hace falta
-- aca.
CREATE INDEX IF NOT EXISTS idx_contact_tags_tag
  ON public.contact_tags(tag_id, contact_id);

-- ============================================================
-- MIGRATION 30: CSV IMPORTS
-- ============================================================
-- ============================================================
-- MIGRACION 00030 — REGISTRO DE IMPORTACIONES DE CSV (F19)
-- ============================================================
-- Una fila por importacion, con los contadores de que paso. Existe por dos
-- motivos que no cubre el audit log:
--
-- 1. El detalle de los errores. Cuando de 800 filas entran 780, lo que se
--    necesita es la lista de las 20 con el numero de fila y el motivo, para
--    corregir la planilla y volver a subirla. Eso no entra en una entrada de
--    audit_log.
-- 2. La barra de progreso. La importacion se manda en tandas, y esta fila es
--    donde se van acumulando los contadores mientras corre.
--
-- Decisiones:
--
-- - Sin deleted_at. No es contenido que alguien vaya a borrar; es evidencia de
--   una operacion, como el audit log. Se va con el workspace por cascade.
-- - finished_at separado de created_at: una importacion que se corto a la
--   mitad (se cerro la pestaña, se fue internet) se reconoce porque nunca lo
--   estampo, y ahi los contadores no suman total_rows.
-- - error_details arranca en array vacio y no en null, para que sumar errores
--   no tenga que distinguir el primero de los demas. La app corta el detalle a
--   los primeros 200: 10.000 filas malas con un mensaje cada una serian varios
--   MB en una sola fila.
--
-- RLS espejo del audit_log: Owner y Admin ven todas las importaciones del
-- workspace, un Member solo las suyas. Sin DELETE ni por parte del dueño.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.csv_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,

  file_name text NOT NULL,
  total_rows integer NOT NULL DEFAULT 0,

  imported integer NOT NULL DEFAULT 0,
  updated integer NOT NULL DEFAULT 0,
  errors integer NOT NULL DEFAULT 0,

  -- [{ line: 7, error: "Email: formato invalido" }, ...]
  error_details jsonb NOT NULL DEFAULT '[]'::jsonb,

  imported_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- NULL mientras corre; se estampa al cerrar.
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_csv_imports_workspace
  ON public.csv_imports(workspace_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'csv_imports_file_name_not_blank'
  ) THEN
    ALTER TABLE public.csv_imports
      ADD CONSTRAINT csv_imports_file_name_not_blank
      CHECK (length(btrim(file_name)) > 0);
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'csv_imports_error_details_is_array'
  ) THEN
    ALTER TABLE public.csv_imports
      ADD CONSTRAINT csv_imports_error_details_is_array
      CHECK (jsonb_typeof(error_details) = 'array');
  END IF;
END;
$$;

COMMENT ON TABLE public.csv_imports IS
  'Una fila por importacion de CSV (F19): contadores, detalle de los errores y quien la corrio. Sin soft delete, como el audit log.';
COMMENT ON COLUMN public.csv_imports.finished_at IS
  'NULL mientras la importacion corre. Una que quedo con NULL y contadores que no suman total_rows es una que se corto a la mitad.';
COMMENT ON COLUMN public.csv_imports.error_details IS
  'Array de { line, error } con el numero de fila como lo ve la persona en la planilla. La app lo corta en los primeros 200.';

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
-- Quien importo puede seguir escribiendo sobre su propia fila mientras corre
-- (los contadores de cada tanda). Nadie puede tocar la de otro, y nadie borra.

ALTER TABLE public.csv_imports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "csv_imports_select" ON public.csv_imports;
CREATE POLICY "csv_imports_select" ON public.csv_imports
  FOR SELECT USING (
    public.is_workspace_admin(workspace_id)
    OR (public.is_workspace_member(workspace_id) AND imported_by = auth.uid())
  );

DROP POLICY IF EXISTS "csv_imports_insert" ON public.csv_imports;
CREATE POLICY "csv_imports_insert" ON public.csv_imports
  FOR INSERT WITH CHECK (
    public.is_workspace_member(workspace_id) AND imported_by = auth.uid()
  );

DROP POLICY IF EXISTS "csv_imports_update" ON public.csv_imports;
CREATE POLICY "csv_imports_update" ON public.csv_imports
  FOR UPDATE USING (
    public.is_workspace_member(workspace_id) AND imported_by = auth.uid()
  )
  WITH CHECK (
    public.is_workspace_member(workspace_id) AND imported_by = auth.uid()
  );

-- ============================================================
-- MIGRATION 31: CONTACT PROFILE ENRICHMENT
-- ============================================================
-- ============================================================
-- MIGRACION 00031 — COMPLETAR EL PERFIL DEL CONTACTO CON LO QUE MANDA EL CANAL
-- ============================================================
-- Cuando alguien le escribe a la cuenta sin haber interactuado antes,
-- Instagram no le da a Zernio el perfil de esa persona y llega el nombre
-- "Instagram User". Eso no es un dato: es la forma que tiene la plataforma de
-- decir que no lo tiene. Cuando esa misma persona responde, el perfil aparece
-- — pero hasta ahora no se guardaba, porque find_or_link_contact tiene dos
-- ramas y ninguna lo hacia:
--
--   Rama 1 (el remitente ya esta mapeado en contact_channels): solo sellaba
--   last_interaction_at. Es la rama por la que pasa el 99% de los mensajes de
--   una conversacion ya empezada, o sea justo cuando el perfil mejora.
--
--   Rama 2 (se lo encontro por telefono, email o usuario): usa COALESCE, o sea
--   "lo que ya estaba cargado gana". Correcto para no pisar lo que escribio
--   una persona, pero deja "Instagram User" para siempre, porque no es NULL.
--
-- La regla que queda: el canal escribe donde hay un hueco, o donde el valor que
-- hay lo puso el propio canal como placeholder. Lo que escribio una persona no
-- se toca nunca. Un nombre que no esta en la lista de placeholders se asume
-- escrito por una persona (o real), y es intocable.
--
-- Por que aca y no en TypeScript: los mensajes entran por dos receptores mas
-- el backfill mas el procesador de comentarios, y los cuatro llaman a esta
-- funcion. Hacerlo adentro es un solo lugar, sin una consulta extra por
-- mensaje, y en la misma transaccion que el resto del alta.
--
-- La lista de placeholders esta tambien en lib/contacts/anonymous.ts, porque
-- la necesita el filtro de contactos anonimos. Un test compara las dos.
-- ============================================================

-- ------------------------------------------------------------
-- 1. La lista de nombres que no son nombres
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_placeholder_name(p_name text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT lower(btrim(coalesce(p_name, ''))) IN (
    '', 'instagram user', 'facebook user', 'whatsapp user', 'unknown commenter'
  );
$$;

REVOKE ALL ON FUNCTION public.is_placeholder_name(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_placeholder_name(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.is_placeholder_name(text) IS
  'true si el nombre es un relleno que manda la plataforma cuando no tiene el perfil ("Instagram User" y companiia), y no algo que escribio una persona. Espejo de PLACEHOLDER_NAMES en lib/contacts/anonymous.ts.';

-- ------------------------------------------------------------
-- 2. find_or_link_contact completa el perfil en las dos ramas
-- ------------------------------------------------------------
-- Se reescribe entera porque plpgsql no admite parches parciales. Respecto de
-- la version de la 00025 cambian dos cosas y nada mas:
--   - la rama 1 ahora completa nombre, usuario y foto ademas de sellar la fecha
--   - el display_name de la rama 2 pisa el placeholder
-- El resto (orden de matcheo, sugerencias por username de otra plataforma,
-- audit log) es identico.

CREATE OR REPLACE FUNCTION public.find_or_link_contact(
  p_channel_id      uuid,
  p_sender_id       text,
  p_display_name    text        DEFAULT NULL,
  p_username        text        DEFAULT NULL,
  p_avatar_url      text        DEFAULT NULL,
  p_phone           text        DEFAULT NULL,
  p_email           text        DEFAULT NULL,
  p_interaction_at  timestamptz DEFAULT now(),
  p_stamp_existing  boolean     DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ws         uuid;
  v_platform   text;
  v_contact    uuid;
  v_suggested  uuid;
  v_linked_by  text := NULL;
  v_phone      text := NULLIF(btrim(p_phone), '');
  v_email      text := public.normalize_email(p_email);
  v_handle     text := public.normalize_handle(p_username);
  v_name       text := NULLIF(btrim(p_display_name), '');
BEGIN
  SELECT ch.workspace_id, ch.platform INTO v_ws, v_platform
  FROM public.channels ch WHERE ch.id = p_channel_id;

  IF v_ws IS NULL THEN
    RETURN jsonb_build_object('contact_id', NULL, 'existed', false,
                              'linked_by', NULL, 'suggested_contact_id', NULL);
  END IF;

  -- ---- 1. El remitente ya es conocido en este canal ---------------------
  SELECT cc.contact_id INTO v_contact
  FROM public.contact_channels cc
  WHERE cc.channel_id = p_channel_id AND cc.platform_sender_id = p_sender_id;

  IF v_contact IS NOT NULL THEN
    -- Ademas de sellar la fecha, se aprovecha lo que traiga este mensaje: es
    -- la rama por la que pasan los mensajes de una conversacion ya empezada,
    -- que es cuando Instagram recien expone el perfil.
    UPDATE public.contacts c SET
      last_interaction_at = CASE
        WHEN p_stamp_existing THEN p_interaction_at
        ELSE c.last_interaction_at
      END,
      display_name = CASE
        WHEN v_name IS NOT NULL
         AND NOT public.is_placeholder_name(v_name)
         AND public.is_placeholder_name(c.display_name)
        THEN v_name
        ELSE c.display_name
      END,
      avatar_url = COALESCE(c.avatar_url, p_avatar_url),
      instagram_username = CASE
        WHEN v_platform = 'instagram' THEN COALESCE(c.instagram_username, v_handle)
        ELSE c.instagram_username
      END,
      twitter_username = CASE
        WHEN v_platform = 'twitter' THEN COALESCE(c.twitter_username, v_handle)
        ELSE c.twitter_username
      END,
      facebook_id = CASE
        WHEN v_platform = 'facebook' THEN COALESCE(c.facebook_id, v_handle)
        ELSE c.facebook_id
      END,
      tiktok_username = CASE
        WHEN v_platform = 'tiktok' THEN COALESCE(c.tiktok_username, v_handle)
        ELSE c.tiktok_username
      END
    WHERE c.id = v_contact;

    -- El username tambien se completa en el mapeo del canal, que es de donde
    -- lo lee la ficha para mostrar por donde escribio.
    UPDATE public.contact_channels cc
    SET platform_username = COALESCE(cc.platform_username, v_handle)
    WHERE cc.channel_id = p_channel_id AND cc.platform_sender_id = p_sender_id;

    RETURN jsonb_build_object('contact_id', v_contact, 'existed', true,
                              'linked_by', 'channel', 'suggested_contact_id', NULL);
  END IF;

  -- ---- 2. Telefono exacto ---------------------------------------------
  IF v_phone IS NOT NULL THEN
    SELECT c.id INTO v_contact
    FROM public.contacts c
    WHERE c.workspace_id = v_ws
      AND c.deleted_at IS NULL
      AND (c.phone = v_phone OR c.whatsapp_phone = v_phone)
    ORDER BY c.created_at
    LIMIT 1;
    IF v_contact IS NOT NULL THEN v_linked_by := 'phone'; END IF;
  END IF;

  -- ---- 3. Email exacto -------------------------------------------------
  IF v_contact IS NULL AND v_email IS NOT NULL THEN
    SELECT c.id INTO v_contact
    FROM public.contacts c
    WHERE c.workspace_id = v_ws
      AND c.deleted_at IS NULL
      AND (public.normalize_email(c.email) = v_email
           OR public.normalize_email(c.secondary_email) = v_email)
    ORDER BY c.created_at
    LIMIT 1;
    IF v_contact IS NOT NULL THEN v_linked_by := 'email'; END IF;
  END IF;

  -- ---- 4. Usuario exacto de la MISMA plataforma ------------------------
  IF v_contact IS NULL AND v_handle IS NOT NULL THEN
    SELECT c.id INTO v_contact
    FROM public.contacts c
    WHERE c.workspace_id = v_ws
      AND c.deleted_at IS NULL
      AND CASE v_platform
            WHEN 'instagram' THEN lower(c.instagram_username) = v_handle
            WHEN 'twitter'   THEN lower(c.twitter_username)   = v_handle
            WHEN 'facebook'  THEN lower(c.facebook_id)        = v_handle
            WHEN 'tiktok'    THEN lower(c.tiktok_username)    = v_handle
            ELSE false
          END
    ORDER BY c.created_at
    LIMIT 1;
    IF v_contact IS NOT NULL THEN v_linked_by := 'username'; END IF;
  END IF;

  -- ---- Vincular al contacto encontrado ---------------------------------
  IF v_contact IS NOT NULL THEN
    -- COALESCE en casi todo: lo que ya estaba cargado gana. La excepcion es el
    -- nombre, que si es un placeholder de la plataforma se reemplaza: dejarlo
    -- seria conservar un "no se quien es" pudiendo saberlo.
    UPDATE public.contacts c SET
      last_interaction_at = GREATEST(COALESCE(c.last_interaction_at, p_interaction_at), p_interaction_at),
      display_name = CASE
        WHEN v_name IS NOT NULL
         AND NOT public.is_placeholder_name(v_name)
         AND public.is_placeholder_name(c.display_name)
        THEN v_name
        ELSE COALESCE(c.display_name, v_name)
      END,
      avatar_url          = COALESCE(c.avatar_url, p_avatar_url),
      phone               = COALESCE(c.phone, v_phone),
      email               = COALESCE(c.email, v_email),
      whatsapp_phone      = CASE WHEN v_platform = 'whatsapp'  THEN COALESCE(c.whatsapp_phone, v_phone)  ELSE c.whatsapp_phone END,
      instagram_username  = CASE WHEN v_platform = 'instagram' THEN COALESCE(c.instagram_username, v_handle) ELSE c.instagram_username END,
      twitter_username    = CASE WHEN v_platform = 'twitter'   THEN COALESCE(c.twitter_username, v_handle)   ELSE c.twitter_username END,
      facebook_id         = CASE WHEN v_platform = 'facebook'  THEN COALESCE(c.facebook_id, v_handle)        ELSE c.facebook_id END,
      tiktok_username     = CASE WHEN v_platform = 'tiktok'    THEN COALESCE(c.tiktok_username, v_handle)    ELSE c.tiktok_username END
    WHERE c.id = v_contact;

    INSERT INTO public.contact_channels (contact_id, channel_id, platform_sender_id, platform_username)
    VALUES (v_contact, p_channel_id, p_sender_id, v_handle)
    ON CONFLICT (channel_id, platform_sender_id) DO NOTHING;

    -- Vinculacion automatica: queda registrada (F12).
    INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, metadata, performed_by)
    VALUES (v_ws, 'contact', v_contact, 'link',
            jsonb_build_object('linked_by', v_linked_by, 'channel_id', p_channel_id,
                               'platform', v_platform, 'automatic', true),
            NULL);

    RETURN jsonb_build_object('contact_id', v_contact, 'existed', true,
                              'linked_by', v_linked_by, 'suggested_contact_id', NULL);
  END IF;

  -- ---- 5. Contacto nuevo ------------------------------------------------
  -- Antes de crearlo: si el handle coincide con OTRA plataforma, es un match
  -- sin confirmar. No se vincula, se deja anotado para que decida una persona.
  IF v_handle IS NOT NULL THEN
    SELECT c.id INTO v_suggested
    FROM public.contacts c
    WHERE c.workspace_id = v_ws
      AND c.deleted_at IS NULL
      AND (lower(c.instagram_username) = v_handle
           OR lower(c.twitter_username) = v_handle
           OR lower(c.facebook_id) = v_handle
           OR lower(c.tiktok_username) = v_handle)
    ORDER BY c.created_at
    LIMIT 1;
  END IF;

  INSERT INTO public.contacts (
    workspace_id, display_name, avatar_url, last_interaction_at,
    phone, email, whatsapp_phone, instagram_username, twitter_username,
    facebook_id, tiktok_username, metadata
  ) VALUES (
    v_ws, v_name, p_avatar_url, p_interaction_at,
    v_phone, v_email,
    CASE WHEN v_platform = 'whatsapp'  THEN v_phone  ELSE NULL END,
    CASE WHEN v_platform = 'instagram' THEN v_handle ELSE NULL END,
    CASE WHEN v_platform = 'twitter'   THEN v_handle ELSE NULL END,
    CASE WHEN v_platform = 'facebook'  THEN v_handle ELSE NULL END,
    CASE WHEN v_platform = 'tiktok'    THEN v_handle ELSE NULL END,
    CASE
      WHEN v_suggested IS NOT NULL THEN
        jsonb_build_object('link_suggestions', jsonb_build_array(
          jsonb_build_object('contact_id', v_suggested, 'reason', 'username',
                             'handle', v_handle, 'at', p_interaction_at)))
      ELSE '{}'::jsonb
    END
  )
  RETURNING id INTO v_contact;

  INSERT INTO public.contact_channels (contact_id, channel_id, platform_sender_id, platform_username)
  VALUES (v_contact, p_channel_id, p_sender_id, v_handle)
  ON CONFLICT (channel_id, platform_sender_id) DO NOTHING;

  INSERT INTO public.analytics_events (workspace_id, contact_id, event_type, metadata)
  VALUES (v_ws, v_contact, 'contact_created',
          jsonb_build_object('channel_id', p_channel_id, 'platform', v_platform));

  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, metadata, performed_by)
  VALUES (v_ws, 'contact', v_contact, 'create',
          jsonb_build_object('source', 'inbound', 'channel_id', p_channel_id,
                             'platform', v_platform), NULL);

  RETURN jsonb_build_object('contact_id', v_contact, 'existed', false,
                            'linked_by', NULL, 'suggested_contact_id', v_suggested);
END;
$$;

REVOKE ALL ON FUNCTION public.find_or_link_contact(uuid, text, text, text, text, text, text, timestamptz, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_or_link_contact(uuid, text, text, text, text, text, text, timestamptz, boolean) TO authenticated, service_role;

COMMENT ON FUNCTION public.find_or_link_contact(uuid, text, text, text, text, text, text, timestamptz, boolean) IS
  'Encuentra o crea el contacto detras de un remitente, y de paso completa su perfil con lo que traiga el canal: escribe donde hay un hueco o donde el valor que hay es un placeholder de la plataforma, nunca sobre lo que cargo una persona. La llaman los dos receptores de webhooks, el backfill y el procesador de comentarios.';

-- ============================================================
-- MIGRATION 32: CONTACTS IS ANONYMOUS
-- ============================================================
-- ============================================================
-- MIGRACION 00032 — MARCAR LOS CONTACTOS SIN DATOS DE CONTACTO (F2)
-- ============================================================
-- La bandeja crea un contacto por cada persona que escribe, tambien cuando
-- Instagram no dice quien es. Hoy 99 de 171 son asi: se llaman "Instagram
-- User", no tienen usuario, ni telefono, ni email. Hacen falta —la
-- conversacion cuelga de ellos— pero ensucian la lista de contactos, que es
-- donde se trabaja la cartera.
--
-- La marca se calcula en la base y no en cada consulta, por tres motivos:
--
-- 1. El predicado es una conjuncion de negaciones sobre seis columnas. Escrito
--    a mano en PostgREST son seis ramas de un `or`, y la lista de contactos ya
--    usa un `or` para la busqueda por texto. Dos `or` conviviendo en la misma
--    consulta es una forma cara de equivocarse.
-- 2. Una columna GENERATED se recalcula en cada UPDATE de la fila, asi que
--    cuando el enriquecimiento de la 00031 completa un @usuario, el contacto
--    deja de ser anonimo solo. No hay nada que mantener sincronizado.
-- 3. Un indice parcial sobre una columna booleana lo usa el planner sin
--    pensarlo; sobre seis ramas OR, es una apuesta.
--
-- Sobre "anonimo": es sobre la IDENTIDAD, no sobre el trabajo hecho. Un
-- contacto sin nombre pero con tags, notas y vendedor asignado sigue siendo
-- anonimo, porque sigue sin saberse quien es. Es lo correcto para el filtro:
-- lo que estorba en la lista es no poder reconocer a la persona.
--
-- Lo que hay que saber para el dia que esto cambie: la expresion de una
-- columna generada no se puede editar con ALTER (antes de PG17). Cambiarla es
-- DROP INDEX, DROP COLUMN, ADD COLUMN, CREATE INDEX. Por eso los placeholders
-- van escritos inline y no adentro de una funcion: si estuvieran en una
-- funcion, un CREATE OR REPLACE de esa funcion NO recalcularia los valores ya
-- guardados y la columna empezaria a mentir en silencio.
-- ============================================================

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS is_anonymous boolean
  GENERATED ALWAYS AS (
    lower(btrim(coalesce(display_name, ''))) IN (
      '', 'instagram user', 'facebook user', 'whatsapp user', 'unknown commenter'
    )
    AND email IS NULL
    AND secondary_email IS NULL
    AND phone IS NULL
    AND whatsapp_phone IS NULL
    AND instagram_username IS NULL
  ) STORED;

COMMENT ON COLUMN public.contacts.is_anonymous IS
  'true cuando no hay con que reconocer a la persona: sin nombre propio (o con un relleno de la plataforma) y sin ningun dato de contacto. Es sobre la identidad, no sobre el trabajo hecho: un contacto con tags y vendedor asignado sigue siendo anonimo. La calcula la base, asi que se apaga sola cuando el contacto se enriquece.';

-- El filtro por defecto de la lista de contactos: los vivos que no son anonimos.
CREATE INDEX IF NOT EXISTS idx_contacts_identified
  ON public.contacts(workspace_id, last_interaction_at DESC)
  WHERE deleted_at IS NULL AND NOT is_anonymous;

-- ============================================================
-- MIGRATION 33: CONTACT NOTES FIELD
-- ============================================================
-- ============================================================
-- MIGRACION 00033 — LAS NOTAS PASAN A SER UN CAMPO DEL CONTACTO (F3)
-- ============================================================
-- Cambio deliberado respecto de lo que definia la Fase 1: las notas dejan de
-- ser una tabla con una fila por nota y pasan a ser un solo campo de texto en
-- el contacto. Lo que se gana es lo obvio —escribir una nota es escribir en un
-- campo, no crear un registro— y lo que se pierde conviene decirlo en voz alta:
-- ya no hay autor ni fecha por nota, y cualquiera que pueda editar el contacto
-- puede reescribir el texto entero.
--
-- Lo segundo se compensa en parte con el audit log: cada guardado deja quien
-- cambio las notas y de que texto a que texto, asi que la historia no se
-- pierde, solo deja de estar a la vista.
--
-- La tabla contact_notes NO se borra. Queda deprecada y sin nadie
-- escribiendole. Borrarla ahora romperia purge_soft_deleted (que la nombra) y
-- el cron que lee su contador, y no habria forma de volver atras si el campo
-- unico resulta insuficiente. Se limpia en otro bloque, cuando esto lleve
-- tiempo funcionando.
--
-- El bloque de migracion de contenido de abajo hoy no mueve nada porque la
-- tabla esta vacia, pero este proyecto se clona: alguien que lo levante con
-- notas cargadas necesita que funcione. Concatena en orden cronologico y deja
-- la fecha de cada nota, que es lo unico que se puede conservar sin autor.
-- ============================================================

ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS notes text;

COMMENT ON COLUMN public.contacts.notes IS
  'Notas internas del contacto, en un solo texto. Reemplaza a la tabla contact_notes desde el Bloque 4. Quien cambio que queda en audit_log.';

-- ------------------------------------------------------------
-- Migracion del contenido que hubiera
-- ------------------------------------------------------------
-- Idempotente por partida doble: solo toca contactos cuyo campo esta vacio, y
-- solo lee notas sin borrar. Correrla dos veces no duplica nada.

DO $$
DECLARE
  v_migrados integer;
BEGIN
  WITH juntadas AS (
    SELECT
      n.contact_id,
      string_agg(
        to_char(n.created_at AT TIME ZONE 'UTC', 'DD/MM/YYYY HH24:MI') || ' — ' || n.content,
        E'\n\n' ORDER BY n.created_at
      ) AS texto
    FROM public.contact_notes n
    WHERE n.deleted_at IS NULL
    GROUP BY n.contact_id
  )
  UPDATE public.contacts c
  SET notes = j.texto
  FROM juntadas j
  WHERE c.id = j.contact_id
    AND (c.notes IS NULL OR btrim(c.notes) = '');

  GET DIAGNOSTICS v_migrados = ROW_COUNT;

  IF v_migrados > 0 THEN
    RAISE NOTICE 'Notas migradas al campo del contacto: % contactos', v_migrados;
  END IF;
END;
$$;

COMMENT ON TABLE public.contact_notes IS
  'DEPRECADA desde la migracion 00033: las notas viven en contacts.notes. La tabla se conserva para no perder lo que hubiera y porque purge_soft_deleted todavia la nombra. Nadie le escribe.';

-- ============================================================
-- MIGRATION 34: CUSTOM FIELDS ADMIN ONLY
-- ============================================================
-- ============================================================
-- MIGRACION 00034 — SOLO OWNER Y ADMIN DEFINEN CAMPOS PERSONALIZADOS (F6)
-- ============================================================
-- Hasta ahora no habia forma de crear un campo personalizado desde la app: las
-- definiciones solo existian si alguien escribia SQL a mano. La pantalla que
-- llega con este bloque cambia eso, y antes de abrirla hay que arreglar quien
-- puede usarla.
--
-- La policy que venia del fork es una sola, `for all`, con
-- is_workspace_member: cualquier Member podia crear, renombrar y BORRAR
-- definiciones. Borrar una definicion no es un cambio menor — el cascade se
-- lleva los valores de todos los contactos — asi que se parte en dos: leer lo
-- puede hacer cualquiera (la ficha del contacto necesita las definiciones para
-- mostrar los campos), definir es de Owner y Admin.
--
-- Se agrega tambien deleted_at, y esto merece explicacion porque cambia una
-- regla del fork: contact_custom_fields.field_id es ON DELETE CASCADE, o sea
-- que borrar una definicion destruye en silencio el valor que ese campo tenia
-- en cada contacto, sin vuelta atras. La regla del proyecto es que nada se
-- borra de verdad (F15), asi que la pantalla marca la definicion como borrada
-- en vez de borrarla: el campo desaparece de la UI y los valores quedan por si
-- fue un error.
--
-- El slug NO se toca al renombrar, y por eso lleva su comentario: el flow
-- builder busca los campos por slug (engine.ts) y esos slugs viven adentro del
-- JSON de los flows, que nada migra. Cambiarlo dejaria a los flows sin
-- encontrar el campo, y ese nodo falla en silencio.
-- ============================================================

ALTER TABLE public.custom_field_definitions
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_custom_field_definitions_alive
  ON public.custom_field_definitions(workspace_id, name)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN public.custom_field_definitions.slug IS
  'Identificador estable del campo. Se genera del nombre al crearlo y NO cambia al renombrar: el flow builder busca los campos por slug y esos slugs viven adentro del JSON de los flows, que nada migra.';

COMMENT ON COLUMN public.custom_field_definitions.deleted_at IS
  'Borrado logico. Borrar de verdad la definicion se llevaria por cascade el valor que ese campo tenia en cada contacto.';

-- ------------------------------------------------------------
-- Las policies: leer todos, definir solo Owner y Admin
-- ------------------------------------------------------------

DROP POLICY IF EXISTS "Users can view custom fields in their workspaces" ON public.custom_field_definitions;
DROP POLICY IF EXISTS "Users can manage custom fields in their workspaces" ON public.custom_field_definitions;
DROP POLICY IF EXISTS "custom_field_definitions_select" ON public.custom_field_definitions;
DROP POLICY IF EXISTS "custom_field_definitions_insert" ON public.custom_field_definitions;
DROP POLICY IF EXISTS "custom_field_definitions_update" ON public.custom_field_definitions;
DROP POLICY IF EXISTS "custom_field_definitions_delete" ON public.custom_field_definitions;

-- Las borradas siguen siendo visibles para el SELECT: la app filtra por
-- deleted_at donde corresponde, y dejarlas fuera de la policy romperia el
-- JOIN de contact_custom_fields con valores de un campo ya borrado.
CREATE POLICY "custom_field_definitions_select" ON public.custom_field_definitions
  FOR SELECT USING (public.is_workspace_member(workspace_id));

CREATE POLICY "custom_field_definitions_insert" ON public.custom_field_definitions
  FOR INSERT WITH CHECK (public.is_workspace_admin(workspace_id));

CREATE POLICY "custom_field_definitions_update" ON public.custom_field_definitions
  FOR UPDATE USING (public.is_workspace_admin(workspace_id))
  WITH CHECK (public.is_workspace_admin(workspace_id));

-- Sin policy de DELETE: la pantalla marca deleted_at. Que la base tampoco lo
-- permita evita que un borrado accidental se lleve los valores por cascade.

-- ============================================================
-- MIGRATION 35: CONTACT CUSTOM FIELDS RLS FIX
-- ============================================================
-- ============================================================
-- MIGRACION 00035 — ARREGLAR LA RECURSION EN LOS VALORES DE CAMPOS CUSTOM
-- ============================================================
-- Guardar el valor de un campo personalizado fallaba con:
--
--   infinite recursion detected in policy for relation "contact_custom_fields"
--
-- La policy de SELECT que venia del fork consulta la propia tabla adentro de
-- su propia condicion:
--
--   exists (select 1 from contacts c
--           join contact_custom_fields ccf on ccf.contact_id = c.id
--           where c.id = contact_custom_fields.contact_id and ...)
--
-- Ese JOIN no aportaba nada —la condicion ya ata la fila por contact_id— pero
-- obliga a Postgres a evaluar la policy de contact_custom_fields para poder
-- evaluar la policy de contact_custom_fields.
--
-- Es un bug que estaba desde el fork y que nunca se habia podido alcanzar:
-- hasta este bloque no existia forma de definir un campo personalizado, asi
-- que jamas se leyo ni se escribio un valor. Aparecio apenas la pantalla nueva
-- hizo posible cargar el primero.
--
-- La version correcta delega en la visibilidad del contacto y nada mas. Una
-- subconsulta adentro de una POLICY si pasa por la RLS de la tabla que
-- consulta, asi que "existe el contacto" ya significa "este usuario puede ver
-- el contacto", con el scope de leads incluido. Es el mismo mecanismo que la
-- 00023 documenta para contact_notes.
-- ============================================================

DROP POLICY IF EXISTS "Users can view contact custom fields" ON public.contact_custom_fields;
DROP POLICY IF EXISTS "Users can manage contact custom fields" ON public.contact_custom_fields;
DROP POLICY IF EXISTS "contact_custom_fields_select" ON public.contact_custom_fields;
DROP POLICY IF EXISTS "contact_custom_fields_write" ON public.contact_custom_fields;

CREATE POLICY "contact_custom_fields_select" ON public.contact_custom_fields
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = contact_custom_fields.contact_id)
  );

-- Escribir un valor es parte de trabajar el contacto, asi que lo puede hacer
-- cualquiera que lo vea. Definir QUE campos existen es otra cosa, y esa si es
-- de Owner/Admin (migracion 00034).
CREATE POLICY "contact_custom_fields_write" ON public.contact_custom_fields
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = contact_custom_fields.contact_id)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = contact_custom_fields.contact_id)
  );
