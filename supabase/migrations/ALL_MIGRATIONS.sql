-- =============================================
-- COMBINED MIGRATIONS
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
-- 1. Roles. El sistema original guarda el rol como texto libre y varias policies asumen
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
-- La tabla channels del sistema original asume que todo canal se conecto por Zernio:
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
-- El sistema original trae un contacto minimo: display_name, email, avatar_url,
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
  -- las palabras clave globales del sistema original, y seria raro que un contacto
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

-- ============================================================
-- MIGRATION 36: PG CRON SCHEDULER
-- ============================================================
-- ============================================================
-- MIGRACION 00036 — LOS CRONS PASAN A CORRER EN LA BASE (pg_cron + pg_net)
-- ============================================================
-- Hasta ahora los cuatro crons del sistema estaban declarados en vercel.json,
-- que Vercel lee y Railway no. La app esta en Railway. O sea: los crons no los
-- corria nadie.
--
-- Eso no es un detalle de configuracion pendiente, es funcionalidad apagada:
--
--   - /api/cron/jobs es quien despierta las sesiones de flow dormidas. Sin el,
--     un nodo Delay para el flow para siempre.
--   - /api/cron/sequences es quien avanza los pasos de las secuencias.
--   - purge_soft_deleted es quien cierra la ventana de retencion de 30 dias.
--
-- La Fase 2 suma ademas el trigger de inactividad, que es puro cron. Asi que
-- antes de construir nada arriba, hay que dejar los crons corriendo.
--
-- Se hace con pg_cron dentro de la misma base, en vez de un servicio externo,
-- por tres razones: no depende de otra cuenta ni de otro proveedor que se
-- pueda vencer sin avisar, el secreto nunca sale de la base, y la purga —que
-- es puro SQL— se llama directo sin dar la vuelta por HTTP.
--
-- Lo que crea:
--   1. Las extensiones pg_cron (agenda) y pg_net (llamadas HTTP desde SQL).
--   2. El schema `private` y la tabla `private.system_config`, donde viven la
--      URL de la app y el CRON_SECRET. Los valores NO van en esta migracion.
--   3. private.call_app_cron(path), que le pega a /api/cron/<path> con el
--      secreto en el header. Solo acepta rutas de una lista blanca.
--   4. private.purge_pg_net_responses(), porque pg_net guarda cada respuesta
--      HTTP en una tabla interna que si nadie limpia crece sin techo.
--   5. Los jobs agendados.
--
-- DESPUES DE APLICAR ESTA MIGRACION hay que cargar los dos valores de config,
-- o los crons que salen por HTTP no van a hacer nada (y lo van a decir claro
-- en el log, no en silencio). El INSERT esta documentado abajo de todo.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Extensiones
-- ------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ------------------------------------------------------------
-- 2. Configuracion del sistema
-- ------------------------------------------------------------
-- Va en el schema `private` y no en `public` a proposito: PostgREST solo
-- publica los schemas que tiene configurados (public, graphql_public), asi que
-- nada de lo que viva aca es alcanzable por la API, ni con la anon key ni con
-- un JWT de usuario. La RLS y los REVOKE de abajo son la segunda linea: si
-- alguien expone el schema por error, igual no se lee.
CREATE SCHEMA IF NOT EXISTS private;

REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS private.system_config (
  key         text PRIMARY KEY,
  value       text NOT NULL,
  description text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE private.system_config IS
  'Config del sistema que necesita la base para llamarse a si misma por HTTP (pg_cron). No es config por workspace: eso vive en integration_configs y en Vault.';

ALTER TABLE private.system_config ENABLE ROW LEVEL SECURITY;
-- Sin policies a proposito: con RLS activa y ninguna policy, nadie lee ni
-- escribe. service_role y postgres saltean RLS, que son los unicos que la
-- necesitan.

REVOKE ALL ON TABLE private.system_config FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 3. La llamada a los endpoints de cron de la app
-- ------------------------------------------------------------
-- El secreto viaja en el header Authorization y no en la query string. Las dos
-- formas las acepta el codigo de las rutas, pero una query string queda escrita
-- en los logs del proxy de Railway y en la tabla de pg_net; un header, no.
--
-- La lista blanca de rutas no es paranoia de mas: sin ella, cualquiera que
-- consiguiera ejecutar esta funcion podria usar la base como trampolin para
-- pegarle a cualquier URL de la app con el secreto de cron adjunto.
CREATE OR REPLACE FUNCTION private.call_app_cron(p_path text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_base   text;
  v_secret text;
BEGIN
  IF p_path NOT IN ('jobs', 'sequences', 'whatsapp-health', 'inactivity', 'automation-events') THEN
    RAISE EXCEPTION 'ruta de cron no permitida: %', p_path;
  END IF;

  SELECT value INTO v_base   FROM private.system_config WHERE key = 'app_url';
  SELECT value INTO v_secret FROM private.system_config WHERE key = 'cron_secret';

  -- Falta la config: se avisa y se corta. Un cron que falla en silencio es
  -- peor que uno que no corre, porque nadie se entera hasta que un lead se
  -- queda sin seguimiento.
  IF v_base IS NULL OR v_secret IS NULL THEN
    RAISE WARNING 'private.system_config sin app_url o cron_secret: el cron "%" no se ejecuto', p_path;
    RETURN NULL;
  END IF;

  RETURN net.http_get(
    url     => rtrim(v_base, '/') || '/api/cron/' || p_path,
    headers => jsonb_build_object(
                 'Authorization', 'Bearer ' || v_secret,
                 'Content-Type',  'application/json'
               ),
    timeout_milliseconds => 60000
  );
END;
$$;

REVOKE ALL ON FUNCTION private.call_app_cron(text) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION private.call_app_cron(text) IS
  'Llama a /api/cron/<path> de la app con el CRON_SECRET en el header. Solo rutas de la lista blanca. La usan los jobs de pg_cron.';

-- ------------------------------------------------------------
-- 4. Limpieza de la tabla interna de pg_net
-- ------------------------------------------------------------
-- pg_net guarda el resultado de cada llamada HTTP en net._http_response. Con
-- dos jobs por minuto son unas 2.900 filas por dia que nadie vuelve a mirar.
-- Se conservan 3 dias: alcanza para diagnosticar un cron que fallo el fin de
-- semana, y no mas.
--
-- El DELETE va por EXECUTE porque el nombre de esa tabla es interno de pg_net
-- y podria cambiar entre versiones: asi la funcion avisa en vez de reventar el
-- job de cron entero.
CREATE OR REPLACE FUNCTION private.purge_pg_net_responses(p_retention_days integer DEFAULT 3)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted integer := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_tables
    WHERE schemaname = 'net' AND tablename = '_http_response'
  ) THEN
    RAISE WARNING 'net._http_response no existe: pg_net cambio de esquema, hay que revisar la limpieza';
    RETURN 0;
  END IF;

  EXECUTE 'DELETE FROM net._http_response WHERE created < now() - make_interval(days => $1)'
  USING p_retention_days;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION private.purge_pg_net_responses(integer) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION private.purge_pg_net_responses(integer) IS
  'Borra las respuestas HTTP viejas que guarda pg_net. Sin esto net._http_response crece sin techo.';

-- ------------------------------------------------------------
-- 5. Los jobs
-- ------------------------------------------------------------
-- cron.schedule con nombre hace upsert (pg_cron 1.4+), asi que volver a correr
-- esta migracion reagenda en vez de duplicar. El unschedule previo es por si
-- la base quedo con una version anterior que no hacia upsert.
DO $$
DECLARE
  v_job text;
BEGIN
  FOREACH v_job IN ARRAY ARRAY[
    'jobs',
    'sequences',
    'whatsapp-health',
    'purge-deleted',
    'purge-pg-net'
  ] LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = v_job) THEN
      PERFORM cron.unschedule(v_job);
    END IF;
  END LOOP;
END;
$$;

-- Despierta las sesiones de flow dormidas (nodos Delay) y manda los broadcasts.
SELECT cron.schedule(
  'jobs',
  '* * * * *',
  $$SELECT private.call_app_cron('jobs')$$
);

-- Avanza los pasos de las secuencias.
SELECT cron.schedule(
  'sequences',
  '* * * * *',
  $$SELECT private.call_app_cron('sequences')$$
);

-- Estado de conexion de WhatsApp. Hoy sale por la puerta de atras sin hacer
-- nada, porque no hay ningun canal de Evolution: queda agendado para que el
-- dia que se conecte el numero no haya que acordarse de esto.
SELECT cron.schedule(
  'whatsapp-health',
  '*/5 * * * *',
  $$SELECT private.call_app_cron('whatsapp-health')$$
);

-- La purga es puro SQL: se llama directo, sin dar la vuelta por HTTP. La ruta
-- /api/cron/purge-deleted se conserva para poder correrla a mano.
SELECT cron.schedule(
  'purge-deleted',
  '0 4 * * *',
  $$SELECT public.purge_soft_deleted(30)$$
);

SELECT cron.schedule(
  'purge-pg-net',
  '10 4 * * *',
  $$SELECT private.purge_pg_net_responses(3)$$
);

-- ============================================================
-- PASO MANUAL DESPUES DE APLICAR
-- ============================================================
-- Cargar los dos valores, con los mismos que ya tiene la app en Railway:
--
--   INSERT INTO private.system_config (key, value, description) VALUES
--     ('app_url',     'https://<dominio-publico-de-la-app>', 'Base de las llamadas de cron'),
--     ('cron_secret', '<el CRON_SECRET de Railway>',         'Debe coincidir con la env var CRON_SECRET')
--   ON CONFLICT (key) DO UPDATE
--     SET value = EXCLUDED.value, updated_at = now();
--
-- Para verificar que quedaron corriendo:
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE 'ssa-%';
--   SELECT jobname, status, start_time, return_message
--     FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;
--   SELECT status_code, created FROM net._http_response ORDER BY created DESC LIMIT 5;
-- ============================================================

-- ============================================================
-- MIGRATION 37: CHANNEL RATE LIMIT
-- ============================================================
-- ============================================================
-- MIGRACION 00037 — TOPE DE ENVIOS AUTOMATIZADOS POR CANAL (F8)
-- ============================================================
-- Instagram permite hasta 200 mensajes automatizados por hora y por cuenta.
-- Pasarse no devuelve un error prolijo: la API empieza a rechazar envios y, si
-- se insiste, la cuenta queda limitada un rato largo. Es de esas cosas que no
-- se notan hasta que se rompen, y cuando se rompen se rompe el canal entero.
--
-- Hasta ahora no habia ningun control: el motor mandaba de a uno con una pausa
-- fija de 500ms entre mensajes del mismo nodo, y nada mas. Con un flow por
-- mensaje entrante y las secuencias corriendo por cron, llegar a 200 en una
-- hora es perfectamente posible.
--
-- Se cuenta con una fila por canal y por hora, en vez de contar mensajes de la
-- tabla `messages`. Contar mensajes obligaria a escanear un rango de tiempo en
-- cada envio, sobre una tabla que solo crece; asi es un upsert sobre una fila
-- chica, y el contador se reclama en la misma sentencia que lo verifica, que es
-- lo unico que lo hace seguro con varios envios en paralelo.
--
-- El tope NO aplica a lo que manda una persona a mano desde la bandeja: ese
-- limite es para mensajes automatizados. Quien decide es quien llama.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.channel_send_windows (
  channel_id   uuid NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  window_start timestamptz NOT NULL,
  sent_count   integer NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, window_start)
);

COMMENT ON TABLE public.channel_send_windows IS
  'Contador de mensajes automatizados por canal y por hora. Sostiene el tope de la API de Instagram (200/hora).';

CREATE INDEX IF NOT EXISTS idx_channel_send_windows_start
  ON public.channel_send_windows(window_start);

ALTER TABLE public.channel_send_windows ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- Solo lectura, y solo para quien ya ve el canal: sirve para mostrar "te
  -- quedan N envios" en la UI. Escribe unicamente el motor, con service role.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'channel_send_windows'
      AND policyname = 'channel_send_windows_select'
  ) THEN
    CREATE POLICY "channel_send_windows_select" ON public.channel_send_windows
      FOR SELECT USING (
        EXISTS (
          SELECT 1 FROM public.channels c
          WHERE c.id = channel_send_windows.channel_id
            AND public.is_workspace_member(c.workspace_id)
        )
      );
  END IF;
END;
$$;

-- ------------------------------------------------------------
-- Reclamar un envio
-- ------------------------------------------------------------
-- Devuelve true si el envio entra en la ventana, false si ya se llego al tope.
--
-- La verificacion y el incremento pasan en la misma sentencia a proposito: si
-- fueran un SELECT y despues un UPDATE, dos envios simultaneos podrian leer 199
-- los dos y terminar mandando 201.
CREATE OR REPLACE FUNCTION public.claim_automated_send(
  p_channel_id uuid,
  p_limit integer DEFAULT 200
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_window timestamptz := date_trunc('hour', now());
  v_count  integer;
BEGIN
  INSERT INTO public.channel_send_windows (channel_id, window_start, sent_count)
  VALUES (p_channel_id, v_window, 1)
  ON CONFLICT (channel_id, window_start) DO UPDATE
    SET sent_count = public.channel_send_windows.sent_count + 1,
        updated_at = now()
    WHERE public.channel_send_windows.sent_count < p_limit
  RETURNING sent_count INTO v_count;

  -- Sin fila devuelta, el WHERE del upsert no se cumplio: la ventana esta llena.
  RETURN v_count IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_automated_send(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_automated_send(uuid, integer) TO service_role;

COMMENT ON FUNCTION public.claim_automated_send(uuid, integer) IS
  'Reclama un envio automatizado en la ventana de la hora actual. true si entra, false si se llego al tope.';

-- ------------------------------------------------------------
-- Limpieza
-- ------------------------------------------------------------
-- Las ventanas viejas no le sirven a nadie: se guardan dos dias por si hay que
-- mirar por que un canal freno, y se van con la purga diaria.
CREATE OR REPLACE FUNCTION public.purge_send_windows(p_retention_days integer DEFAULT 2)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.channel_send_windows
  WHERE window_start < now() - make_interval(days => p_retention_days);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_send_windows(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_send_windows(integer) TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-send-windows') THEN
    PERFORM cron.unschedule('purge-send-windows');
  END IF;
END;
$$;

SELECT cron.schedule(
  'purge-send-windows',
  '20 4 * * *',
  $$SELECT public.purge_send_windows(2)$$
);

-- ============================================================
-- MIGRATION 38: AUTOMATION TRIGGERS
-- ============================================================
-- ============================================================
-- MIGRACION 00038 — TIPOS NUEVOS DE TRIGGER (F3, F4, F5)
-- ============================================================
-- La tabla `triggers` viene del sistema original con seis tipos, todos disparados por
-- algo que hace el contacto en el chat: una palabra clave, un boton, el primer
-- mensaje. La Fase 2 suma tres que nacen en otro lado:
--
--   new_contact  — se creo un contacto (por mensaje, por import o a mano)
--   crm_event    — cambio algo del contacto (tag, campo, setter/vendedor,
--                  marca de no contactar)
--   inactivity   — pasaron X horas sin respuesta del lead
--
-- F6 (palabra clave en respuesta a historia) NO suma un tipo: es un filtro
-- adicional adentro del config del trigger `keyword`, que es exactamente como
-- lo pide el requerimiento. Un tipo nuevo ahi seria un duplicado del matcher.
--
-- Lo que crea:
--   1. Los tres tipos nuevos en el CHECK de triggers.type.
--   2. triggers.workspace_id, desnormalizado.
--   3. triggers.updated_at.
--   4. RLS mas estricta: escribir triggers pasa a ser cosa de Owner/Admin.
--   5. La tabla trigger_fires, que resuelve la idempotencia de los tres.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Tipos nuevos
-- ------------------------------------------------------------
-- Mismo patron que la 00016 con channels.platform: se tira el CHECK y se
-- rehace, porque Postgres no deja extender uno existente.
ALTER TABLE public.triggers DROP CONSTRAINT IF EXISTS triggers_type_check;

ALTER TABLE public.triggers ADD CONSTRAINT triggers_type_check CHECK (
  type IN (
    'keyword',
    'postback',
    'quick_reply',
    'welcome',
    'default',
    'comment_keyword',
    'new_contact',
    'crm_event',
    'inactivity'
  )
);

-- ------------------------------------------------------------
-- 2. workspace_id desnormalizado
-- ------------------------------------------------------------
-- Hasta ahora al workspace de un trigger se llegaba por join con flows. Para
-- los triggers de mensaje daba igual, porque la consulta ya joineaba flows para
-- filtrar por status. Pero el cron de inactividad y el drenaje de eventos de
-- CRM arrancan al reves —tienen un workspace y buscan sus triggers— y ahi el
-- join es puro peso. Ademas permite escribir la RLS sin subconsulta.
ALTER TABLE public.triggers ADD COLUMN IF NOT EXISTS workspace_id uuid
  REFERENCES public.workspaces(id) ON DELETE CASCADE;

UPDATE public.triggers t
   SET workspace_id = f.workspace_id
  FROM public.flows f
 WHERE f.id = t.flow_id
   AND t.workspace_id IS DISTINCT FROM f.workspace_id;

DO $$
BEGIN
  -- Recien despues del backfill: si quedara alguna fila huerfana, mejor que
  -- falle aca y no en un insert cualquiera dentro de seis meses.
  IF NOT EXISTS (SELECT 1 FROM public.triggers WHERE workspace_id IS NULL) THEN
    ALTER TABLE public.triggers ALTER COLUMN workspace_id SET NOT NULL;
  ELSE
    RAISE WARNING 'Quedan triggers sin workspace_id: la columna queda opcional. Revisar filas huerfanas.';
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_triggers_workspace_type
  ON public.triggers(workspace_id, type, is_active);

-- Lo mantiene al dia sin que el codigo tenga que acordarse.
CREATE OR REPLACE FUNCTION public.triggers_set_workspace_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.workspace_id IS NULL THEN
    SELECT f.workspace_id INTO NEW.workspace_id
      FROM public.flows f WHERE f.id = NEW.flow_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS triggers_fill_workspace_id ON public.triggers;
CREATE TRIGGER triggers_fill_workspace_id
  BEFORE INSERT OR UPDATE OF flow_id ON public.triggers
  FOR EACH ROW EXECUTE FUNCTION public.triggers_set_workspace_id();

-- ------------------------------------------------------------
-- 3. updated_at
-- ------------------------------------------------------------
ALTER TABLE public.triggers ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- ------------------------------------------------------------
-- 4. RLS mas estricta
-- ------------------------------------------------------------
-- Las policies que venian del sistema original (migracion 00002) daban FOR ALL a
-- cualquier miembro del workspace: un Member podia crear, editar y borrar
-- triggers de cualquier flow. Es incoherente con el resto del sistema, donde
-- crear y publicar flows es cosa de Owner/Admin, y ademas es un agujero: un
-- trigger es lo que decide que automatizacion le contesta a un lead.
DROP POLICY IF EXISTS "Users can view triggers via flow" ON public.triggers;
DROP POLICY IF EXISTS "Users can manage triggers via flow" ON public.triggers;

DROP POLICY IF EXISTS "triggers_select" ON public.triggers;
CREATE POLICY "triggers_select" ON public.triggers
  FOR SELECT USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "triggers_insert" ON public.triggers;
CREATE POLICY "triggers_insert" ON public.triggers
  FOR INSERT WITH CHECK (public.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "triggers_update" ON public.triggers;
CREATE POLICY "triggers_update" ON public.triggers
  FOR UPDATE USING (public.is_workspace_admin(workspace_id))
  WITH CHECK (public.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "triggers_delete" ON public.triggers;
CREATE POLICY "triggers_delete" ON public.triggers
  FOR DELETE USING (public.is_workspace_admin(workspace_id));

-- ------------------------------------------------------------
-- 5. Idempotencia de los disparos
-- ------------------------------------------------------------
-- Los tres tipos nuevos necesitan lo mismo: no disparar dos veces por el mismo
-- motivo. Cambia solo que es "el mismo motivo":
--
--   new_contact — el contacto (dispara una vez en la vida)
--   crm_event   — el evento puntual que lo genero
--   inactivity  — la conversacion y la ventana ("conv:<id>:24h")
--
-- Una sola tabla con una clave de deduplicacion que arma quien dispara. El
-- indice unico es lo que garantiza la idempotencia: dos corridas del cron en
-- paralelo chocan en la base, no en la logica.
CREATE TABLE IF NOT EXISTS public.trigger_fires (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_id   uuid NOT NULL REFERENCES public.triggers(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  dedupe_key   text NOT NULL,
  contact_id   uuid REFERENCES public.contacts(id) ON DELETE CASCADE,
  fired_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.trigger_fires IS
  'Un disparo ya ocurrido. El indice unico sobre (trigger_id, dedupe_key) es lo que impide que un trigger dispare dos veces por el mismo motivo.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_trigger_fires_dedupe
  ON public.trigger_fires(trigger_id, dedupe_key);

CREATE INDEX IF NOT EXISTS idx_trigger_fires_workspace
  ON public.trigger_fires(workspace_id, fired_at DESC);

ALTER TABLE public.trigger_fires ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "trigger_fires_select" ON public.trigger_fires;
CREATE POLICY "trigger_fires_select" ON public.trigger_fires
  FOR SELECT USING (public.is_workspace_member(workspace_id));
-- Escribe solo el motor, con service role. Sin policies de escritura.

-- Los disparos viejos no le sirven a nadie, salvo los de new_contact, que
-- valen para toda la vida del contacto. Se limpian los de mas de 90 dias que
-- tengan una ventana en la clave (los de inactividad).
CREATE OR REPLACE FUNCTION public.purge_trigger_fires(p_retention_days integer DEFAULT 90)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.trigger_fires
  WHERE fired_at < now() - make_interval(days => p_retention_days)
    AND dedupe_key LIKE 'conv:%';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_trigger_fires(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_trigger_fires(integer) TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-trigger-fires') THEN
    PERFORM cron.unschedule('purge-trigger-fires');
  END IF;
END;
$$;

SELECT cron.schedule(
  'purge-trigger-fires',
  '30 4 * * *',
  $$SELECT public.purge_trigger_fires(90)$$
);

-- El trigger de inactividad corre por cron cada 15 minutos.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'inactivity') THEN
    PERFORM cron.unschedule('inactivity');
  END IF;
END;
$$;

SELECT cron.schedule(
  'inactivity',
  '*/15 * * * *',
  $$SELECT private.call_app_cron('inactivity')$$
);

-- ============================================================
-- MIGRATION 39: CRM AUTOMATION EVENTS
-- ============================================================
-- ============================================================
-- MIGRACION 00039 — EVENTOS DE CRM QUE DISPARAN FLOWS (F3, F4)
-- ============================================================
-- Los triggers "nuevo contacto" y "evento de CRM" reaccionan a cosas que pasan
-- en el CRM, no en el chat. La pregunta es donde detectarlas.
--
-- Se detectan en la base, con triggers de Postgres, y no en el codigo de las
-- Server Actions. El motivo es concreto: un contacto se crea por tres caminos
-- distintos (mensaje entrante, import de CSV, alta manual) y los tags se
-- agregan desde la ficha, desde un flow y desde el import. Emitir el evento en
-- cada lugar significa acordarse en cada lugar, hoy y en cada camino nuevo que
-- se sume. En la base se captura una vez y no se escapa ninguno.
--
-- Los eventos NO disparan el flow desde la base: se encolan en una tabla y los
-- drena un cron. El motor de flows corre en Node —manda mensajes, llama a la
-- IA, habla con APIs— y nada de eso se puede hacer desde una funcion de
-- Postgres. Ademas, si el disparo fuera sincronico, un flow lento o caido
-- frenaria el guardado del contacto.
--
-- SOBRE EL SCOPE DE LEADS: el disparo lo hace el sistema, sin usuario. Se
-- respeta el scope porque el evento solo puede nacer de un cambio que la RLS ya
-- permitio: un Member no puede tocar un lead que no ve, asi que no puede
-- generar un evento sobre el. La barrera esta antes, en la escritura.
-- ============================================================

-- ------------------------------------------------------------
-- 1. La cola de eventos
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.automation_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- contact_created | tag_added | tag_removed | field_changed |
  -- assignment_changed | do_not_contact
  event_type   text NOT NULL,
  contact_id   uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  -- Con que valor. Un tag trae su nombre, un campo su slug y su valor nuevo.
  -- Es lo que permite filtrar "cuando se agrega el tag interesado".
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  error        text
);

COMMENT ON TABLE public.automation_events IS
  'Cola de cambios del CRM que pueden disparar un flow. La llenan triggers de Postgres y la drena /api/cron/automation-events.';

-- El cron busca siempre lo mismo: lo no procesado, mas viejo primero.
CREATE INDEX IF NOT EXISTS idx_automation_events_pending
  ON public.automation_events(created_at)
  WHERE processed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_automation_events_contact
  ON public.automation_events(contact_id, created_at DESC);

ALTER TABLE public.automation_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "automation_events_select" ON public.automation_events;
CREATE POLICY "automation_events_select" ON public.automation_events
  FOR SELECT USING (public.is_workspace_admin(workspace_id));
-- Escriben los triggers de la base (SECURITY DEFINER) y el cron (service role).

-- ------------------------------------------------------------
-- 2. Emisor comun
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.emit_automation_event(
  p_workspace_id uuid,
  p_event_type text,
  p_contact_id uuid,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.automation_events (workspace_id, event_type, contact_id, payload)
  VALUES (p_workspace_id, p_event_type, p_contact_id, p_payload);
END;
$$;

REVOKE ALL ON FUNCTION public.emit_automation_event(uuid, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 3. Contacto creado (F3)
-- ------------------------------------------------------------
-- Cubre los tres origenes de una sola vez. Se ignoran los anonimos: un contacto
-- sin datos todavia no es un lead, y ya se ocultan de la lista (migracion
-- 00032). Cuando se completa deja de ser anonimo y ahi si emite.
CREATE OR REPLACE FUNCTION public.contacts_emit_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF COALESCE(NEW.is_anonymous, false) THEN
    RETURN NEW;
  END IF;

  PERFORM public.emit_automation_event(
    NEW.workspace_id,
    'contact_created',
    NEW.id,
    jsonb_build_object('source', COALESCE(NEW.attribution->>'source', 'unknown'))
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contacts_automation_created ON public.contacts;
CREATE TRIGGER contacts_automation_created
  AFTER INSERT ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.contacts_emit_created();

-- Un contacto que nacio anonimo (por ejemplo, de un mensaje sin perfil) y
-- despues se completa cuenta como contacto nuevo recien en ese momento.
CREATE OR REPLACE FUNCTION public.contacts_emit_deanonymized()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF COALESCE(OLD.is_anonymous, false) AND NOT COALESCE(NEW.is_anonymous, false) THEN
    PERFORM public.emit_automation_event(
      NEW.workspace_id,
      'contact_created',
      NEW.id,
      jsonb_build_object('source', COALESCE(NEW.attribution->>'source', 'unknown'), 'deanonymized', true)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contacts_automation_deanonymized ON public.contacts;
CREATE TRIGGER contacts_automation_deanonymized
  AFTER UPDATE OF is_anonymous ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.contacts_emit_deanonymized();

-- ------------------------------------------------------------
-- 4. Cambios en el contacto (F4)
-- ------------------------------------------------------------
-- Asignacion de setter o vendedor, y marca de no contactar. Cada campo emite
-- su propio evento: un flow que espera "se asigno vendedor" no tiene por que
-- despertarse porque cambio el setter.
CREATE OR REPLACE FUNCTION public.contacts_emit_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.setter_id IS DISTINCT FROM OLD.setter_id AND NEW.setter_id IS NOT NULL THEN
    PERFORM public.emit_automation_event(
      NEW.workspace_id, 'assignment_changed', NEW.id,
      jsonb_build_object('role', 'setter', 'user_id', NEW.setter_id)
    );
  END IF;

  IF NEW.vendedor_id IS DISTINCT FROM OLD.vendedor_id AND NEW.vendedor_id IS NOT NULL THEN
    PERFORM public.emit_automation_event(
      NEW.workspace_id, 'assignment_changed', NEW.id,
      jsonb_build_object('role', 'vendedor', 'user_id', NEW.vendedor_id)
    );
  END IF;

  -- Solo al activarse: desmarcar no es un evento que valga la pena automatizar.
  IF COALESCE(NEW.do_not_contact, false) AND NOT COALESCE(OLD.do_not_contact, false) THEN
    PERFORM public.emit_automation_event(
      NEW.workspace_id, 'do_not_contact', NEW.id,
      jsonb_build_object('reason', NEW.do_not_contact_reason)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contacts_automation_changes ON public.contacts;
CREATE TRIGGER contacts_automation_changes
  AFTER UPDATE OF setter_id, vendedor_id, do_not_contact ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.contacts_emit_changes();

-- ------------------------------------------------------------
-- 5. Tags (F4)
-- ------------------------------------------------------------
-- El payload lleva el NOMBRE del tag, no solo el id: el trigger se configura
-- escribiendo "interesado" en el editor, y comparar contra un uuid obligaria a
-- resolverlo en cada evaluacion.
CREATE OR REPLACE FUNCTION public.contact_tags_emit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_contact  public.contacts%ROWTYPE;
  v_tag_name text;
  v_tag_id   uuid;
BEGIN
  v_tag_id := COALESCE(NEW.tag_id, OLD.tag_id);

  SELECT * INTO v_contact FROM public.contacts
   WHERE id = COALESCE(NEW.contact_id, OLD.contact_id);
  IF NOT FOUND THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT name INTO v_tag_name FROM public.tags WHERE id = v_tag_id;

  PERFORM public.emit_automation_event(
    v_contact.workspace_id,
    CASE WHEN TG_OP = 'INSERT' THEN 'tag_added' ELSE 'tag_removed' END,
    v_contact.id,
    jsonb_build_object('tag_id', v_tag_id, 'tag_name', v_tag_name)
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS contact_tags_automation ON public.contact_tags;
CREATE TRIGGER contact_tags_automation
  AFTER INSERT OR DELETE ON public.contact_tags
  FOR EACH ROW EXECUTE FUNCTION public.contact_tags_emit();

-- ------------------------------------------------------------
-- 6. Campos personalizados (F4)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.contact_custom_fields_emit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_contact public.contacts%ROWTYPE;
  v_slug    text;
BEGIN
  -- Un update que deja el mismo valor no es un cambio.
  IF TG_OP = 'UPDATE' AND NEW.value IS NOT DISTINCT FROM OLD.value THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_contact FROM public.contacts WHERE id = NEW.contact_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  SELECT slug INTO v_slug FROM public.custom_field_definitions WHERE id = NEW.field_id;

  PERFORM public.emit_automation_event(
    v_contact.workspace_id, 'field_changed', v_contact.id,
    jsonb_build_object(
      'field_id', NEW.field_id,
      'field_slug', v_slug,
      'value', NEW.value,
      'previous_value', CASE WHEN TG_OP = 'UPDATE' THEN OLD.value ELSE NULL END
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contact_custom_fields_automation ON public.contact_custom_fields;
CREATE TRIGGER contact_custom_fields_automation
  AFTER INSERT OR UPDATE ON public.contact_custom_fields
  FOR EACH ROW EXECUTE FUNCTION public.contact_custom_fields_emit();

-- ------------------------------------------------------------
-- 7. Limpieza y agenda
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purge_automation_events(p_retention_days integer DEFAULT 7)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.automation_events
  WHERE processed_at IS NOT NULL
    AND processed_at < now() - make_interval(days => p_retention_days);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_automation_events(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_automation_events(integer) TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'automation-events') THEN
    PERFORM cron.unschedule('automation-events');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-automation-events') THEN
    PERFORM cron.unschedule('purge-automation-events');
  END IF;
END;
$$;

-- Cada minuto: un contacto nuevo que tiene que recibir un mensaje de
-- bienvenida no puede esperar un cuarto de hora.
SELECT cron.schedule(
  'automation-events',
  '* * * * *',
  $$SELECT private.call_app_cron('automation-events')$$
);

SELECT cron.schedule(
  'purge-automation-events',
  '40 4 * * *',
  $$SELECT public.purge_automation_events(7)$$
);

-- ============================================================
-- MIGRATION 40: FIX DEANONYMIZED TRIGGER
-- ============================================================
-- ============================================================
-- MIGRACION 00040 — ARREGLO: EL AVISO DE "CONTACTO IDENTIFICADO" NO DISPARABA
-- ============================================================
-- La migracion 00039 dejo un trigger sobre `AFTER UPDATE OF is_anonymous` para
-- avisar cuando un contacto que habia entrado sin datos (por ejemplo, un DM de
-- alguien cuyo perfil Instagram no expone) se completa y pasa a ser un lead de
-- verdad.
--
-- Ese trigger nunca se iba a disparar. `is_anonymous` es una columna GENERATED
-- ALWAYS (migracion 00032): la calcula la base a partir del nombre, el mail, el
-- telefono y el usuario de Instagram. Postgres dispara `UPDATE OF <columna>`
-- cuando esa columna aparece en el SET del UPDATE, y una columna generada nunca
-- puede aparecer ahi. El trigger se creaba sin error y no hacia nada.
--
-- Se escucha, entonces, a las columnas que la alimentan. La condicion sigue
-- siendo la misma —era anonimo y dejo de serlo— y esa se evalua igual sobre
-- OLD/NEW, donde el valor generado si esta disponible.
-- ============================================================

DROP TRIGGER IF EXISTS contacts_automation_deanonymized ON public.contacts;

CREATE TRIGGER contacts_automation_deanonymized
  AFTER UPDATE OF display_name, email, secondary_email, phone, whatsapp_phone, instagram_username
  ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.contacts_emit_deanonymized();

COMMENT ON FUNCTION public.contacts_emit_deanonymized() IS
  'Emite contact_created cuando un contacto anonimo se completa. Escucha las columnas que alimentan is_anonymous, porque una columna generada nunca aparece en el SET de un UPDATE y un trigger UPDATE OF sobre ella no dispara nunca.';

-- ============================================================
-- MIGRATION 41: SEQUENCES STATUS ROLES AND SCOPE
-- ============================================================
-- ============================================================================
-- 00041 — Secuencias: estados validos, roles y scope de leads (F9)
-- ============================================================================
-- Que hace:
--   1. CHECK en sequences.status y sequence_enrollments.status. Venian de la
--      00005 como texto libre: cualquier valor entra, y uno inesperado hace
--      crashear la lista de inscriptos (busca el estado en un diccionario y
--      lee .classes de undefined).
--   2. RLS por rol en sequences: hoy una sola policy FOR ALL deja que un Member
--      active, edite o borre una secuencia que le manda DMs a leads ajenos.
--   3. RLS con scope de leads en sequence_enrollments. La 00018/00024 ato el
--      scope a contacts y conversations, pero las inscripciones cuelgan de
--      sequences, asi que quedaron fuera: un Member ve y cancela inscripciones
--      de leads que la RLS le esconde en todos los demas lados.
--   4. Re-inscripcion: el UNIQUE(sequence_id, contact_id) de la 00005 impedia
--      volver a inscribir a un contacto para siempre, incluso despues de que
--      terminara la secuencia. Pasa a ser un unique parcial sobre las
--      inscripciones vivas.
--
-- Idempotente. No crea tablas ni funciones nuevas.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Estados validos
-- ----------------------------------------------------------------------------

-- Se normaliza antes de restringir: si quedo algun valor viejo fuera de la
-- lista, agregar el CHECK fallaria y la migracion no seria idempotente.
UPDATE public.sequences
SET status = 'draft'
WHERE status IS NULL OR status NOT IN ('draft', 'active', 'paused');

UPDATE public.sequence_enrollments
SET status = 'active'
WHERE status IS NULL OR status NOT IN ('active', 'paused', 'completed', 'cancelled');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sequences_status_check'
  ) THEN
    ALTER TABLE public.sequences
      ADD CONSTRAINT sequences_status_check
      CHECK (status IN ('draft', 'active', 'paused'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sequence_enrollments_status_check'
  ) THEN
    ALTER TABLE public.sequence_enrollments
      ADD CONSTRAINT sequence_enrollments_status_check
      CHECK (status IN ('active', 'paused', 'completed', 'cancelled'));
  END IF;
END $$;

COMMENT ON COLUMN public.sequences.status IS
  'draft = todavia no corre | active = inscribe y manda | paused = frenada; sus inscripciones se pausan, no se cancelan (00041).';

-- ----------------------------------------------------------------------------
-- 2. Re-inscripcion: unique solo sobre lo vivo
-- ----------------------------------------------------------------------------
-- Un contacto no puede estar dos veces a la vez en la misma secuencia, pero si
-- ya la termino (o se lo saco), se lo puede volver a inscribir. El indice
-- parcial es ademas el que necesita la deteccion de colision (00043).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sequence_enrollments_sequence_id_contact_id_key'
  ) THEN
    ALTER TABLE public.sequence_enrollments
      DROP CONSTRAINT sequence_enrollments_sequence_id_contact_id_key;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sequence_enrollments_one_live
  ON public.sequence_enrollments(sequence_id, contact_id)
  WHERE status IN ('active', 'paused');

-- ----------------------------------------------------------------------------
-- 3. RLS de sequences: leer todo el workspace, escribir solo Owner/Admin
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS "sequences_workspace" ON public.sequences;
DROP POLICY IF EXISTS "sequences_select" ON public.sequences;
DROP POLICY IF EXISTS "sequences_insert" ON public.sequences;
DROP POLICY IF EXISTS "sequences_update" ON public.sequences;
DROP POLICY IF EXISTS "sequences_delete" ON public.sequences;

CREATE POLICY "sequences_select" ON public.sequences
  FOR SELECT USING (public.is_workspace_member(workspace_id));

CREATE POLICY "sequences_insert" ON public.sequences
  FOR INSERT WITH CHECK (public.is_workspace_admin(workspace_id));

CREATE POLICY "sequences_update" ON public.sequences
  FOR UPDATE USING (public.is_workspace_admin(workspace_id))
  WITH CHECK (public.is_workspace_admin(workspace_id));

CREATE POLICY "sequences_delete" ON public.sequences
  FOR DELETE USING (public.is_workspace_admin(workspace_id));

-- ----------------------------------------------------------------------------
-- 4. RLS de sequence_enrollments: workspace + scope de leads
-- ----------------------------------------------------------------------------
-- can_see_contact recibe la fila entera de contacts, no un uuid, por eso va
-- como subconsulta y no como llamada directa. Adentro de una POLICY la
-- subconsulta a contacts hereda la RLS de contacts; en una funcion
-- SECURITY DEFINER no lo haria (leccion escrita en la 00028).

DROP POLICY IF EXISTS "enrollments_via_sequence" ON public.sequence_enrollments;
DROP POLICY IF EXISTS "enrollments_select" ON public.sequence_enrollments;
DROP POLICY IF EXISTS "enrollments_insert" ON public.sequence_enrollments;
DROP POLICY IF EXISTS "enrollments_update" ON public.sequence_enrollments;
DROP POLICY IF EXISTS "enrollments_delete" ON public.sequence_enrollments;

CREATE POLICY "enrollments_select" ON public.sequence_enrollments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.sequences s
      WHERE s.id = sequence_enrollments.sequence_id
        AND public.is_workspace_member(s.workspace_id)
    )
    AND EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.id = sequence_enrollments.contact_id
        AND public.can_see_contact(c)
    )
  );

CREATE POLICY "enrollments_insert" ON public.sequence_enrollments
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.sequences s
      WHERE s.id = sequence_enrollments.sequence_id
        AND public.is_workspace_member(s.workspace_id)
    )
    AND EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.id = sequence_enrollments.contact_id
        AND public.can_see_contact(c)
    )
  );

CREATE POLICY "enrollments_update" ON public.sequence_enrollments
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.sequences s
      WHERE s.id = sequence_enrollments.sequence_id
        AND public.is_workspace_member(s.workspace_id)
    )
    AND EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.id = sequence_enrollments.contact_id
        AND public.can_see_contact(c)
    )
  );

-- Borrar una inscripcion es perder la evidencia de que el contacto estuvo ahi.
-- El camino normal es cancelarla (UPDATE); el DELETE queda para Owner/Admin.
CREATE POLICY "enrollments_delete" ON public.sequence_enrollments
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.sequences s
      WHERE s.id = sequence_enrollments.sequence_id
        AND public.is_workspace_admin(s.workspace_id)
    )
  );

-- ============================================================
-- MIGRATION 42: SEQUENCE ENROLLMENT RUNTIME
-- ============================================================
-- ============================================================================
-- 00042 — Secuencias: estado de corrida y claim atomico del procesador
-- ============================================================================
-- Que hace:
--   1. Columnas de corrida en sequence_enrollments: por que se pauso, cuantos
--      intentos lleva el paso actual, cual fue el ultimo error, y desde cuando
--      esta reclamada por una corrida del cron.
--   2. claim_sequence_enrollments(): reclama las inscripciones vencidas de
--      forma atomica.
--
-- Por que el claim: el procesador hacia "select ... limit 50" sin reclamar
-- nada. En cuanto cada paso implica un POST a Instagram, una corrida dura mas
-- que el intervalo del cron (un minuto) y dos ticks leen las mismas filas: el
-- mismo DM sale dos veces. Es el mismo problema que webhook_events resolvio
-- del lado de entrada, ahora del lado de salida.
--
-- Idempotente.
-- ============================================================================

ALTER TABLE public.sequence_enrollments
  ADD COLUMN IF NOT EXISTS paused_reason text,
  ADD COLUMN IF NOT EXISTS paused_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS last_error_at timestamptz,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz;

COMMENT ON COLUMN public.sequence_enrollments.paused_reason IS
  'contact_replied = el lead contesto (F11) | opt_out = pidio no ser contactado | sequence_paused = se pauso la secuencia | no_conversation = no hay hilo abierto por donde escribir | collision = un admin la freno por colision (F13). Solo las tres primeras y collision se reanudan.';

COMMENT ON COLUMN public.sequence_enrollments.attempt_count IS
  'Intentos del paso actual. Se limpia al avanzar. Ver MAX_STEP_ATTEMPTS en lib/sequences/steps.ts.';

COMMENT ON COLUMN public.sequence_enrollments.locked_at IS
  'La reclamo una corrida del cron. Se limpia al terminar el paso; una corrida caida la libera sola pasado p_stale_after.';

-- ----------------------------------------------------------------------------
-- claim_sequence_enrollments
-- ----------------------------------------------------------------------------
-- FOR UPDATE SKIP LOCKED hace que dos corridas simultaneas se repartan las
-- filas en vez de pelearlas. La ventana de 5 minutos recupera lo que quedo
-- trabado por una corrida que se cayo antes de soltar el lock (mismo criterio
-- que /api/cron/jobs con las invocaciones muertas).

CREATE OR REPLACE FUNCTION public.claim_sequence_enrollments(
  p_limit integer DEFAULT 25,
  p_stale_after interval DEFAULT '5 minutes'
)
RETURNS SETOF public.sequence_enrollments
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH due AS (
    SELECT e.id
    FROM public.sequence_enrollments e
    WHERE e.status = 'active'
      AND e.next_step_at IS NOT NULL
      AND e.next_step_at <= now()
      AND (e.locked_at IS NULL OR e.locked_at < now() - p_stale_after)
    ORDER BY e.next_step_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.sequence_enrollments e
  SET locked_at = now()
  FROM due
  WHERE e.id = due.id
  RETURNING e.*;
$$;

REVOKE ALL ON FUNCTION public.claim_sequence_enrollments(integer, interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_sequence_enrollments(integer, interval) TO service_role;

COMMENT ON FUNCTION public.claim_sequence_enrollments(integer, interval) IS
  'Reclama inscripciones vencidas para una corrida del cron. Solo service_role: la ejecuta el procesador, nunca la UI.';

-- ============================================================
-- MIGRATION 43: SEQUENCE COLLISIONS
-- ============================================================
-- ============================================================================
-- 00043 — Secuencias: deteccion de colision (F13)
-- ============================================================================
-- Una colision es que un contacto quede en mas de una secuencia viva por el
-- mismo canal: dos seguimientos automaticos escribiendole en paralelo.
--
-- No lleva tabla nueva: la deteccion es una query sobre sequence_enrollments.
-- Lo unico que hace falta persistir es que la colision se detecto y que alguien
-- ya la resolvio, y eso es una propiedad de la inscripcion en el momento en que
-- se creo, no una entidad con vida propia.
--
-- collision_with guarda un snapshot ({enrollment_id, sequence_id,
-- sequence_name}) para que el aviso siga siendo legible despues de que la otra
-- inscripcion se cancelo o la otra secuencia se renombro.
--
-- Idempotente.
-- ============================================================================

ALTER TABLE public.sequence_enrollments
  ADD COLUMN IF NOT EXISTS collision_detected_at timestamptz,
  ADD COLUMN IF NOT EXISTS collision_with jsonb,
  ADD COLUMN IF NOT EXISTS collision_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS collision_reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS collision_resolution text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sequence_enrollments_collision_resolution_check'
  ) THEN
    ALTER TABLE public.sequence_enrollments
      ADD CONSTRAINT sequence_enrollments_collision_resolution_check
      CHECK (collision_resolution IS NULL OR collision_resolution IN (
        'kept_both', 'paused_other', 'removed_other', 'removed_this'
      ));
  END IF;
END $$;

COMMENT ON COLUMN public.sequence_enrollments.collision_with IS
  'Snapshot de las otras inscripciones vivas al momento de inscribir: [{enrollment_id, sequence_id, sequence_name}]. Snapshot y no join, para que el aviso siga siendo legible si despues se cancela o renombra.';

COMMENT ON COLUMN public.sequence_enrollments.collision_reviewed_at IS
  'Null = colision sin resolver; es lo que filtra el aviso en la pantalla de la secuencia.';

-- Alimenta el badge de la lista y del detalle sin escanear inscripciones viejas.
CREATE INDEX IF NOT EXISTS idx_sequence_enrollments_open_collision
  ON public.sequence_enrollments(sequence_id)
  WHERE collision_detected_at IS NOT NULL AND collision_reviewed_at IS NULL;

-- La consulta de la deteccion: otras inscripciones vivas de este contacto en
-- este canal. El indice viejo (contact_id, status) no filtra canal e incluye
-- las completed/cancelled, que con el tiempo son la mayoria de la tabla.
CREATE INDEX IF NOT EXISTS idx_sequence_enrollments_live_channel
  ON public.sequence_enrollments(contact_id, channel_id)
  WHERE status IN ('active', 'paused');

-- ============================================================
-- MIGRATION 44: SEQUENCE AUTOPAUSE ON REPLY
-- ============================================================
-- ============================================================================
-- 00044 — Secuencias: auto-pausa cuando el contacto responde (F11)
-- ============================================================================
-- Hasta ahora una secuencia solo se frenaba si el lead escribia una frase de
-- baja ("stop", "no me contactes") o si estaba marcado "no contactar". Si
-- contestaba "gracias, lo veo manana", el drip le seguia mandando pasos.
--
-- Va en SQL y no en TypeScript por lo mismo que find_or_link_contact (00025) y
-- apply_opt_out_check (00027): hay dos receptores de webhook, y la pausa mas su
-- entrada en el audit log tienen que pasar juntas en una transaccion.
--
-- Se limita al canal del mensaje a proposito: un lead que contesta por
-- Instagram no tiene por que frenar el seguimiento que corre por WhatsApp. Eso
-- es exactamente F12.
--
-- Idempotente: sobre un contacto sin nada activo no escribe nada, asi que no
-- llena el audit log con una entrada por cada mensaje entrante.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.pause_sequences_on_reply(
  p_contact_id uuid,
  p_channel_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ids uuid[];
  v_count integer;
  v_workspace_id uuid;
BEGIN
  IF p_contact_id IS NULL OR p_channel_id IS NULL THEN
    RETURN 0;
  END IF;

  -- El UPDATE va adentro de un CTE para poder juntar los ids de TODAS las
  -- filas tocadas: un RETURNING ... INTO suelto sobre varias filas se queda
  -- solo con una.
  WITH paused AS (
    UPDATE public.sequence_enrollments
    SET status = 'paused',
        paused_reason = 'contact_replied',
        paused_at = now(),
        locked_at = NULL
    WHERE contact_id = p_contact_id
      AND channel_id = p_channel_id
      AND status = 'active'
    RETURNING id
  )
  SELECT array_agg(id) INTO v_ids FROM paused;

  v_count := COALESCE(array_length(v_ids, 1), 0);
  IF v_count = 0 THEN
    RETURN 0;
  END IF;

  SELECT workspace_id INTO v_workspace_id
  FROM public.contacts WHERE id = p_contact_id;

  -- Una sola entrada por respuesta, no una por inscripcion: lo que paso es un
  -- hecho del contacto, y las inscripciones afectadas son su detalle.
  INSERT INTO public.audit_log (
    workspace_id, entity_type, entity_id, action, metadata, performed_by
  ) VALUES (
    v_workspace_id,
    'contact',
    p_contact_id,
    'sequence_paused',
    jsonb_build_object(
      'source', 'auto',
      'reason', 'contact_replied',
      'channel_id', p_channel_id,
      'enrollment_ids', to_jsonb(v_ids),
      'count', v_count
    ),
    NULL
  );

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.pause_sequences_on_reply(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pause_sequences_on_reply(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.pause_sequences_on_reply(uuid, uuid) IS
  'Pausa las secuencias activas del contacto en ESE canal cuando responde (F11). La llaman los dos receptores de webhook con service role.';

-- ============================================================
-- MIGRATION 45: SECURE LEGACY RPCS
-- ============================================================
-- ============================================================================
-- 00045 — Asegurar las funciones de la era pre-hardening
-- ============================================================================
-- Las migraciones 00001-00003 son anteriores al convenio que el repo adopto en
-- la 00017 (REVOKE a PUBLIC/anon + GRANT explicito + SET search_path = '').
-- Postgres le da EXECUTE a PUBLIC a toda funcion nueva, anon hereda de PUBLIC,
-- y PostgREST publica todo lo invocable del schema public. Nadie escribio el
-- REVOKE, asi que quedaron abiertas.
--
-- El agujero concreto: increment_unread es SECURITY DEFINER, no valida nada, y
-- cualquiera con la anon key (que es publica, va en el frontend) podia llamarla
-- por REST para reabrir conversaciones de cualquier workspace y escribir texto
-- arbitrario en last_message_preview, que es lo que se pinta en la bandeja.
-- Los dos contadores de broadcast son el mismo defecto sobre las metricas.
-- Sus unicos llamadores son los webhooks y el cron, todos con service role.
--
-- Sobre lo que NO se toca, para que el proximo scan no lo reabra:
--
--   * Las funciones de Vault (read_secret, store_secret, delete_secret,
--     list_secret_names) siguen con EXECUTE de authenticated, y esta bien: el
--     control esta adentro (assert_can_manage_secrets exige Owner/Admin o
--     service_role, y a un Member lo rechaza con "forbidden"). Sus llamadores
--     usan el cliente del usuario a proposito, porque es el usuario quien tiene
--     que estar autorizado. Pasarlas a service role moveria la decision de
--     autorizacion de la base a la app, que es al reves de como funciona todo
--     el resto del sistema.
--
--   * is_workspace_member y sus hermanas conservan EXECUTE de authenticated
--     porque es OBLIGATORIO. Ver el comentario de cada una mas abajo.
--
-- Idempotente.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Las tres RPC sin guard: search_path fijo y solo service role
-- ----------------------------------------------------------------------------
-- El CREATE OR REPLACE va ANTES del REVOKE y califica las tablas: fijar
-- search_path = '' sin calificar los nombres las romperia en silencio.

CREATE OR REPLACE FUNCTION public.increment_unread(conv_id uuid, preview text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.conversations
  SET unread_count = unread_count + 1,
      last_message_at = now(),
      last_message_preview = preview,
      status = 'open'
  WHERE id = conv_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_broadcast_sent(b_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.broadcasts
  SET sent = sent + 1,
      delivered = delivered + 1
  WHERE id = b_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_broadcast_failed(b_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.broadcasts
  SET failed = failed + 1
  WHERE id = b_id;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_unread(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_unread(uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.increment_broadcast_sent(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_broadcast_sent(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.increment_broadcast_failed(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_broadcast_failed(uuid) TO service_role;

COMMENT ON FUNCTION public.increment_unread(uuid, text) IS
  'Suma un no leido y pisa el preview de la conversacion. Solo service_role: la llaman los receptores de webhooks (lib/inbound.ts). No valida permisos, por eso no puede quedar expuesta a la anon key.';

-- ----------------------------------------------------------------------------
-- 2. update_updated_at: search_path fijo
-- ----------------------------------------------------------------------------
-- La unica de las ocho trigger functions con un defecto propio. Corre como
-- definer en el contexto del rol que dispara el trigger, y ese rol controla el
-- search_path.

CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. Trigger functions: sacarles el EXECUTE de anon
-- ----------------------------------------------------------------------------
-- No son explotables: retornan `trigger` y Postgres rechaza llamarlas fuera de
-- un trigger ("trigger functions can only be called as triggers"). El linter
-- las marca porque mira el GRANT, no la invocabilidad. Se revocan para que el
-- reporte quede limpio y siga siendo legible: un linter con ruido cronico es
-- uno que nadie lee. Un trigger corre con los privilegios del dueño de la
-- tabla, asi que esto no los afecta.

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_updated_at() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.triggers_set_workspace_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.contacts_emit_created() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.contacts_emit_deanonymized() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.contacts_emit_changes() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.contact_tags_emit() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.contact_custom_fields_emit() FROM PUBLIC, anon;

-- ----------------------------------------------------------------------------
-- 4. is_workspace_member: revocar anon, JAMAS authenticated
-- ----------------------------------------------------------------------------
-- Es la unica del grupo de helpers a la que nunca se le aplico el REVOKE.
-- Para anon devuelve false para cualquier entrada (no hay auth.uid()), asi que
-- no filtra nada; se cierra igual porque cuesta una linea.

REVOKE ALL ON FUNCTION public.is_workspace_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_workspace_member(uuid) TO authenticated, service_role;

-- ADVERTENCIA, y el motivo de que este escrita:
--
-- Un scanner de seguridad va a seguir marcando estas cinco funciones como
-- "SECURITY DEFINER ejecutable por usuarios logueados". NO se les puede revocar
-- authenticated. Las llaman ~37 expresiones de policy RLS sobre 23 tablas, y
-- una expresion de policy se evalua con el rol de la SESION, no como definer:
-- sin EXECUTE, cada SELECT sobre contacts, conversations, channels o flows
-- falla con "permission denied for function ...". Es decir, la app entera.
--
-- Si el objetivo es callar al linter, la unica salida correcta seria mover las
-- funciones a un schema no publicado por PostgREST y actualizar las 37
-- policies. No vale la pena por un warning.

COMMENT ON FUNCTION public.is_workspace_member(uuid) IS
  'Helper de RLS. authenticated NECESITA EXECUTE: la llaman ~37 policies y una expresion de policy se evalua con el rol de la sesion. Revocarlo rompe toda lectura de la app.';
COMMENT ON FUNCTION public.is_workspace_admin(uuid) IS
  'Helper de RLS. authenticated NECESITA EXECUTE (ver is_workspace_member).';
COMMENT ON FUNCTION public.is_workspace_owner(uuid) IS
  'Helper de RLS. authenticated NECESITA EXECUTE (ver is_workspace_member).';
COMMENT ON FUNCTION public.can_see_contact(public.contacts) IS
  'Scope de leads. authenticated NECESITA EXECUTE (ver is_workspace_member).';
COMMENT ON FUNCTION public.can_see_conversation(public.conversations) IS
  'Scope de leads. authenticated NECESITA EXECUTE (ver is_workspace_member).';

-- ============================================================
-- MIGRATION 46: SCHEDULED JOBS SERVICE ONLY
-- ============================================================
-- ============================================================================
-- 00046 — scheduled_jobs vuelve a ser solo del service role
-- ============================================================================
-- La migracion 00002 la habia dejado bien: RLS habilitada y CERO policies, con
-- el comentario "service role only, no user RLS needed". La 00009 lo revirtio
-- al sumar broadcasts —"Jobs are workspace-agnostic (system-level), so allow
-- authenticated users"— porque el envio de broadcasts insertaba con el cliente
-- del usuario. En vez de mover ese insert a service role, se abrio la tabla.
--
-- Lo que eso dejaba abierto:
--
--   * SELECT con `auth.uid() IS NOT NULL` significa "cualquier usuario logueado
--     del sistema", no "de este workspace" — la tabla no tiene workspace_id,
--     asi que no habia con que filtrar. El payload de los jobs resume_flow
--     (lib/flow-engine/nodes/delay.ts) lleva contactId, conversationId, los ids
--     de Zernio y `variables`, que arrastra el TEXTO DEL MENSAJE del lead. Es
--     fuga de conversaciones y de datos personales entre negocios distintos.
--
--   * UPDATE abierto: marcar los jobs pendientes como completados deja colgados
--     para siempre todos los flows con un nodo de espera.
--
--   * INSERT abierto: encolar un resume_flow con la sesion de otro.
--
-- Se vuelve a deny-all. Ninguna pantalla ni Server Action lee esta tabla: los
-- unicos consumidores son app/api/cron/jobs (service) y los productores
-- lib/flow-engine/nodes/delay.ts y lib/scheduler.ts, este ultimo ya migrado a
-- service client en el commit anterior.
--
-- Por que no se agrega workspace_id: no hay ninguna pantalla que necesite leer
-- la cola, ni esta planificada. Una columna con backfill y policies que nadie
-- usa es costo de mantenimiento sin consumidor. Deny-all ademas es la postura
-- correcta por defecto: el dia que se sume un tipo de job con un payload
-- sensible, la tabla ya esta cerrada.
--
-- Idempotente.
-- ============================================================================

DROP POLICY IF EXISTS "Authenticated users can insert jobs" ON public.scheduled_jobs;
DROP POLICY IF EXISTS "Authenticated users can read jobs" ON public.scheduled_jobs;
DROP POLICY IF EXISTS "Authenticated users can update jobs" ON public.scheduled_jobs;

-- La RLS ya estaba habilitada desde la 00002; se reafirma por si esta migracion
-- corre sobre una base donde alguien la apago.
ALTER TABLE public.scheduled_jobs ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.scheduled_jobs IS
  'Cola interna del motor (delays de flows, entrega de broadcasts). RLS habilitada y SIN POLICIES a proposito: solo el service role entra. No es un descuido — el payload lleva variables de flow y texto de mensajes de los leads, y ninguna pantalla necesita leer esto. Si hace falta exponerla, agregar workspace_id primero.';

-- ============================================================
-- MIGRATION 47: FIND OR LINK CONTACT SERVICE ONLY
-- ============================================================
-- ============================================================================
-- 00047 — find_or_link_contact queda solo para el service role
-- ============================================================================
-- La funcion no tiene ningun control de permisos propio: lo unico que hace es
-- derivar el workspace del canal que le pasan. Con EXECUTE de `authenticated`,
-- un Member —que por diseño solo ve los leads que le asignaron— podia llamarla
-- por REST directo para crear o vincular contactos en el workspace, saltandose
-- el scope de leads. Y con p_stamp_existing pisar last_interaction_at de
-- cualquier contacto.
--
-- No cruza workspaces (el canal ancla el workspace), asi que no es una fuga
-- entre negocios: es escalada de privilegios adentro del workspace.
--
-- PRECONDICION: los dos unicos llamadores con cliente de usuario ya se
-- migraron a service client en commits anteriores —
--   app/api/v1/channels/sync/route.ts  (ademas ahora exige Owner/Admin)
--   app/api/v1/channels/test-key/route.ts
-- via lib/inbox-sync.ts, que recibe el service client como parametro aparte.
-- Los webhooks siempre la llamaron con service role.
--
-- Va sola y despues del resto porque su rotura seria silenciosa: el backfill
-- del Inbox falla adentro de un catch que solo loguea, asi que el usuario veria
-- "conectado, todo bien" con la bandeja vacia.
--
-- Idempotente.
-- ============================================================================

REVOKE EXECUTE ON FUNCTION public.find_or_link_contact(
  uuid, text, text, text, text, text, text, timestamptz, boolean
) FROM authenticated;

COMMENT ON FUNCTION public.find_or_link_contact(
  uuid, text, text, text, text, text, text, timestamptz, boolean
) IS
  'Dedup cross-canal. Solo service_role: no valida permisos, solo deriva el workspace del canal. Las rutas que la usan validan el rol antes y llaman con service client (lib/inbox-sync.ts).';

-- ============================================================
-- MIGRATION 48: TRIGGER FUNCTIONS NOT CALLABLE
-- ============================================================
-- ============================================================================
-- 00048 — Las trigger functions tampoco quedan expuestas a usuarios logueados
-- ============================================================================
-- La 00045 les saco el EXECUTE de `anon` pero dejo el de `authenticated`, asi
-- que el linter las sigue reportando. No son explotables por ninguno de los dos
-- roles —retornan `trigger` y Postgres rechaza llamarlas fuera de un trigger—,
-- pero mientras esten en el reporte tapan a las que si hay que mirar, y un
-- reporte con ruido cronico es uno que nadie lee.
--
-- Un trigger corre con los privilegios del dueño de la tabla, no del invocante,
-- asi que revocar EXECUTE no afecta a ninguno de los triggers que las usan.
--
-- Despues de esto, lo unico que el linter sigue marcando en esta categoria son
-- las funciones de Vault y los helpers de RLS, las dos cosas documentadas en la
-- 00045 como intencionales.
--
-- Idempotente.
-- ============================================================================

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.triggers_set_workspace_id() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.contacts_emit_created() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.contacts_emit_deanonymized() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.contacts_emit_changes() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.contact_tags_emit() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.contact_custom_fields_emit() FROM authenticated;

-- ============================================================
-- MIGRATION 49: KNOWLEDGE BASE
-- ============================================================
-- ============================================================================
-- 00049 — Base de conocimiento con busqueda semantica (F16)
-- ============================================================================
-- Documentos del negocio (PDF/DOCX/TXT/MD) convertidos a markdown, troceados y
-- indexados con embeddings, para que el agente de la Fase 3 responda con
-- informacion real y no inventada.
--
-- Dos tablas y no una: el documento es lo que la usuaria ve y edita; el chunk
-- es una unidad de recuperacion que solo existe para la busqueda. Mezclarlos
-- obligaria a reescribir la fila del documento en cada reindexado.
--
-- workspace_id desnormalizado en knowledge_chunks: se deriva del documento,
-- pero tenerlo directo evita un JOIN en la busqueda semantica, que es lo unico
-- sensible a performance de todo esto, y hace la RLS de una sola condicion.
--
-- DIMENSION DEL EMBEDDING — leer antes de tocar:
-- La columna esta anclada a vector(1024) porque el modelo es Voyage AI
-- 'voyage-4-lite' con output_dimension 1024 (su default). voyage-4-lite tambien
-- soporta 256/512/2048, pero una columna vector(N) admite UN solo N: mezclar
-- embeddings de dimensiones distintas no funciona, y comparar embeddings de
-- modelos distintos aunque coincida la dimension da resultados sin sentido.
-- Si algun dia se cambia de modelo o de dimension hay que: cambiar el tipo de
-- la columna, recrear el indice, y REINDEXAR TODOS los documentos.
--
-- Indice HNSW y no IVFFlat: IVFFlat necesita datos para entrenar sus listas y
-- aca el indice se crea con la tabla vacia (quedaria mal calibrado para siempre
-- salvo que alguien se acuerde de recrearlo). HNSW se construye incremental.
-- Distancia coseno, que es la que recomienda Voyage para sus embeddings.
--
-- Idempotente.
-- ============================================================================

-- pgvector va al esquema 'extensions', que es donde Supabase pone las suyas
-- (pgcrypto, uuid-ossp, pg_stat_statements). public queda solo con lo nuestro.
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- ----------------------------------------------------------------------------
-- 1. knowledge_base — el documento
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.knowledge_base (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  title text NOT NULL,
  tags text[] NOT NULL DEFAULT '{}',
  -- Ruta dentro del bucket privado 'knowledge' (migracion 00050).
  source_file_path text,
  source_mime text,
  source_size_bytes bigint,
  source_filename text,
  content_md text,
  status text NOT NULL DEFAULT 'processing',
  error_detail text,
  chunk_count integer NOT NULL DEFAULT 0,
  -- Que modelo genero los embeddings de este documento. Si se cambia de modelo,
  -- esto dice cuales hay que reindexar.
  embedding_model text,
  indexed_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_base_status_check'
  ) THEN
    ALTER TABLE public.knowledge_base
      ADD CONSTRAINT knowledge_base_status_check
      CHECK (status IN ('processing', 'ready', 'error'));
  END IF;
END $$;

COMMENT ON TABLE public.knowledge_base IS
  'Documentos de la base de conocimiento. El archivo original vive en el bucket privado "knowledge"; content_md es su conversion a markdown. Soft delete con deleted_at (retencion 30 dias, purga por el cron de Fase 1).';

COMMENT ON COLUMN public.knowledge_base.status IS
  'processing = el job async todavia corre; ready = indexado; error = fallo, el motivo esta en error_detail.';

COMMENT ON COLUMN public.knowledge_base.embedding_model IS
  'Modelo que genero los embeddings de este documento (ej: voyage-4-lite). Si se cambia de modelo, identifica que hay que reindexar.';

-- El listado de la pantalla: los del workspace, sin borrar, mas nuevos primero.
CREATE INDEX IF NOT EXISTS idx_knowledge_base_ws_created
  ON public.knowledge_base(workspace_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- Lo que mira el cron de purga de soft-deleted.
CREATE INDEX IF NOT EXISTS idx_knowledge_base_deleted
  ON public.knowledge_base(deleted_at)
  WHERE deleted_at IS NOT NULL;

-- Filtro por etiqueta.
CREATE INDEX IF NOT EXISTS idx_knowledge_base_tags
  ON public.knowledge_base USING gin(tags);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_knowledge_base') THEN
    CREATE TRIGGER set_updated_at_knowledge_base
      BEFORE UPDATE ON public.knowledge_base
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2. knowledge_chunks — los fragmentos indexados
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.knowledge_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.knowledge_base(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL,
  content text NOT NULL,
  -- Estimacion, no cuenta real: sirve para no pasarse del limite de tokens por
  -- request de Voyage al armar los lotes.
  token_estimate integer,
  embedding extensions.vector(1024) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.knowledge_chunks IS
  'Fragmentos indexados de un documento. Se borran en cascada con su documento. Los escribe solo el service role, desde el job de indexacion.';

COMMENT ON COLUMN public.knowledge_chunks.embedding IS
  'Embedding de Voyage AI voyage-4-lite, 1024 dimensiones (su default). Ver la cabecera de esta migracion antes de cambiar la dimension: obliga a reindexar todo.';

COMMENT ON COLUMN public.knowledge_chunks.workspace_id IS
  'Desnormalizado del documento a proposito: evita un JOIN en la busqueda semantica y hace la RLS de una sola condicion.';

-- Un reindexado borra e inserta de nuevo; el unique atrapa un job duplicado que
-- intente escribir dos veces el mismo fragmento.
CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_chunks_doc_index
  ON public.knowledge_chunks(document_id, chunk_index);

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_ws
  ON public.knowledge_chunks(workspace_id);

-- El indice de la busqueda semantica. La opclass va calificada con el esquema
-- para que resuelva sin depender del search_path con el que corra la migracion.
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_embedding
  ON public.knowledge_chunks
  USING hnsw (embedding extensions.vector_cosine_ops);

-- ----------------------------------------------------------------------------
-- 3. RLS
-- ----------------------------------------------------------------------------
-- La KB no lleva scope de leads: es conocimiento del negocio, no de un lead.
-- Todo el equipo la lee; solo Owner/Admin la gestiona (F17).
ALTER TABLE public.knowledge_base ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "knowledge_base_select" ON public.knowledge_base;
CREATE POLICY "knowledge_base_select" ON public.knowledge_base
  FOR SELECT USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "knowledge_base_insert" ON public.knowledge_base;
CREATE POLICY "knowledge_base_insert" ON public.knowledge_base
  FOR INSERT WITH CHECK (public.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "knowledge_base_update" ON public.knowledge_base;
CREATE POLICY "knowledge_base_update" ON public.knowledge_base
  FOR UPDATE USING (public.is_workspace_admin(workspace_id))
  WITH CHECK (public.is_workspace_admin(workspace_id));

-- El borrado real lo hace el cron de purga (service role) 30 dias despues; esta
-- policy existe por si un admin necesita borrar de verdad.
DROP POLICY IF EXISTS "knowledge_base_delete" ON public.knowledge_base;
CREATE POLICY "knowledge_base_delete" ON public.knowledge_base
  FOR DELETE USING (public.is_workspace_admin(workspace_id));

ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "knowledge_chunks_select" ON public.knowledge_chunks;
CREATE POLICY "knowledge_chunks_select" ON public.knowledge_chunks
  FOR SELECT USING (public.is_workspace_member(workspace_id));

-- Sin policies de INSERT/UPDATE/DELETE a proposito: los fragmentos los escribe
-- solo el job de indexacion, con el service role, y se borran en cascada con su
-- documento. Un usuario no tiene por que poder escribir un embedding a mano.
DROP POLICY IF EXISTS "knowledge_chunks_insert" ON public.knowledge_chunks;
DROP POLICY IF EXISTS "knowledge_chunks_update" ON public.knowledge_chunks;
DROP POLICY IF EXISTS "knowledge_chunks_delete" ON public.knowledge_chunks;

-- ----------------------------------------------------------------------------
-- 4. Busqueda semantica
-- ----------------------------------------------------------------------------
-- Es SECURITY DEFINER para poder ordenar por el indice HNSW sin que la RLS de
-- knowledge_chunks se meta en el plan, asi que la pertenencia al workspace se
-- chequea a mano adentro. Sin ese chequeo, cualquiera leeria la KB de cualquier
-- workspace pasando otro id.
--
-- El operador de distancia va calificado —OPERATOR(extensions.<=>)— porque con
-- search_path = '' no hay forma de resolverlo por nombre. Escrito asi el
-- planner igual lo reconoce y usa el indice HNSW.
--
-- 1 - distancia_coseno = similitud, para que el numero que vuelve se lea como
-- "cuanto se parece" (1 = identico) y no al reves.
CREATE OR REPLACE FUNCTION public.match_knowledge_chunks(
  p_workspace_id uuid,
  p_query_embedding extensions.vector(1024),
  p_match_count integer DEFAULT 8,
  p_min_similarity double precision DEFAULT 0.0
)
RETURNS TABLE (
  chunk_id uuid,
  document_id uuid,
  document_title text,
  chunk_index integer,
  content text,
  similarity double precision
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
BEGIN
  IF p_workspace_id IS NULL THEN
    RAISE EXCEPTION 'workspace_id is required';
  END IF;

  -- coalesce y no auth.role() pelado: una conexion sin JWT devuelve NULL, y
  -- "NULL <> 'service_role' AND ..." evalua a NULL, con lo cual el IF no entra
  -- y el chequeo de permiso se saltea solo. Con coalesce, sin rol conocido se
  -- exige pertenencia al workspace, que es el lado seguro.
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND NOT public.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'forbidden: not a member of this workspace';
  END IF;

  RETURN QUERY
  SELECT
    kc.id,
    kc.document_id,
    kb.title,
    kc.chunk_index,
    kc.content,
    (1 - (kc.embedding OPERATOR(extensions.<=>) p_query_embedding))::double precision
  FROM public.knowledge_chunks kc
  JOIN public.knowledge_base kb ON kb.id = kc.document_id
  WHERE kc.workspace_id = p_workspace_id
    AND kb.deleted_at IS NULL
    AND (1 - (kc.embedding OPERATOR(extensions.<=>) p_query_embedding)) >= p_min_similarity
  ORDER BY kc.embedding OPERATOR(extensions.<=>) p_query_embedding
  LIMIT GREATEST(p_match_count, 1);
END;
$$;

COMMENT ON FUNCTION public.match_knowledge_chunks(uuid, extensions.vector, integer, double precision) IS
  'Busqueda semantica sobre la base de conocimiento. Recibe el embedding de la consulta (Voyage voyage-4-lite, 1024 dim, input_type=query) y devuelve los fragmentos mas parecidos. La consumira el agente en la Fase 3.';

REVOKE ALL ON FUNCTION public.match_knowledge_chunks(uuid, extensions.vector, integer, double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_knowledge_chunks(uuid, extensions.vector, integer, double precision) TO authenticated, service_role;

-- ============================================================
-- MIGRATION 50: KNOWLEDGE STORAGE
-- ============================================================
-- ============================================================================
-- 00050 — Bucket privado para los documentos de la base de conocimiento (F16)
-- ============================================================================
-- Primer bucket del proyecto. Los documentos de la KB pueden tener info
-- sensible del negocio (precios, procesos, contratos), asi que el bucket es
-- privado y se baja siempre por signed URL de vida corta.
--
-- SIN POLICIES sobre storage.objects, a proposito. Es el mismo criterio
-- deny-all que scheduled_jobs: nadie toca el bucket directo. Subir, bajar y
-- borrar pasa por Server Actions que verifican Owner/Admin y despues usan el
-- service role. Una policy sobre storage.objects que dejara entrar a
-- 'authenticated' abriria el bucket a cualquier miembro con la anon key en la
-- mano, salteando esa verificacion.
--
-- El limite de tamano y la lista de MIME que van aca son la ultima linea, no la
-- primera: la validacion de verdad (tipo real por magic bytes, no por
-- extension) corre en el servidor antes de subir. Esto atrapa lo que se le
-- escape a esa validacion.
--
-- Idempotente.
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'knowledge',
  'knowledge',
  false,
  26214400,  -- 25 MB
  ARRAY[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/markdown'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- Si el bucket ya existia (creado a mano desde el panel, por ejemplo), se
-- fuerzan las tres cosas que no son negociables. Sin esto, una migracion que
-- "corrio bien" podria estar dejando un bucket publico.
UPDATE storage.buckets
SET
  public = false,
  file_size_limit = 26214400,
  allowed_mime_types = ARRAY[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/markdown'
  ]
WHERE id = 'knowledge';

-- Por si una version anterior de esta migracion, o alguien a mano, dejo
-- policies abiertas sobre el bucket.
DROP POLICY IF EXISTS "knowledge_objects_select" ON storage.objects;
DROP POLICY IF EXISTS "knowledge_objects_insert" ON storage.objects;
DROP POLICY IF EXISTS "knowledge_objects_update" ON storage.objects;
DROP POLICY IF EXISTS "knowledge_objects_delete" ON storage.objects;

-- ============================================================
-- MIGRATION 51: NOTIFICATIONS
-- ============================================================
-- ============================================================================
-- 00051 — Centro de notificaciones in-app (F18)
-- ============================================================================
-- Avisos operativos dentro del sistema: se derivo una conversacion a una
-- persona, se cayo un canal, un contacto quedo en dos secuencias a la vez.
--
-- Por que una tabla y no seguir usando analytics_events, que es donde vivian
-- hasta ahora: un aviso necesita estado de leido/no leido por persona y un
-- indice pensado para contar los no leidos. analytics_events es una bitacora de
-- metricas; meterle ese estado la convertia en dos cosas a la vez.
--
-- SCOPE — es lo unico delicado de esta migracion:
-- Un Member solo puede ver los avisos de SUS leads. Una notificacion de "se
-- derivo una conversacion" apunta a una conversacion concreta, asi que la
-- pregunta "puede ver este aviso?" se reduce a "puede ver esa conversacion?",
-- que ya sabe contestar can_see_conversation (00018/00028). Por eso el helper
-- delega en las funciones que ya existen en vez de reimplementar el scope: si
-- manana cambia la regla de scope, cambia en un solo lugar.
--
-- recipient_id NULL significa "para los admins del workspace". No significa
-- "para cualquiera".
--
-- Sin soft delete: un aviso leido no es historia que haya que conservar. Se
-- purgan los viejos por cron.
--
-- Idempotente.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- Sin CHECK a proposito: el catalogo de tipos vive en TypeScript
  -- (lib/notifications/types.ts), igual que integration_configs.provider y
  -- audit_log.action. Un tipo nuevo no tiene que ser una migracion.
  type text NOT NULL,
  title text NOT NULL,
  body text,
  -- A que apunta el aviso. entity_type manda el deep-link Y el scope.
  entity_type text,
  entity_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- NULL = para los Owner/Admin del workspace.
  recipient_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.notifications IS
  'Centro de notificaciones in-app (F18). Las escribe solo el service role. Un Member ve las de sus leads; Owner/Admin, las del workspace.';

COMMENT ON COLUMN public.notifications.recipient_id IS
  'Destinatario puntual. NULL = para los Owner/Admin del workspace (no "para cualquiera").';

COMMENT ON COLUMN public.notifications.entity_type IS
  'A que apunta el aviso: conversation, channel, sequence_enrollment, contact. Define el deep-link y, para un Member, si puede verlo.';

COMMENT ON COLUMN public.notifications.metadata IS
  'Datos del evento. Nunca API keys, contenido de mensajes ni PII de mas.';

-- El contador de la campana: no leidas del workspace, mas nuevas primero.
CREATE INDEX IF NOT EXISTS idx_notifications_ws_unread
  ON public.notifications(workspace_id, created_at DESC)
  WHERE read_at IS NULL;

-- El listado completo del panel.
CREATE INDEX IF NOT EXISTS idx_notifications_ws_created
  ON public.notifications(workspace_id, created_at DESC);

-- Las de un destinatario puntual.
CREATE INDEX IF NOT EXISTS idx_notifications_recipient
  ON public.notifications(recipient_id, created_at DESC)
  WHERE recipient_id IS NOT NULL;

-- Lo que mira la purga.
CREATE INDEX IF NOT EXISTS idx_notifications_read_at
  ON public.notifications(read_at)
  WHERE read_at IS NOT NULL;

-- ----------------------------------------------------------------------------
-- Scope: puede esta persona ver este aviso?
-- ----------------------------------------------------------------------------
-- Recibe la fila entera como tipo compuesto, igual que can_see_contact: asi la
-- policy se escribe can_see_notification(notifications) y el planner no tiene
-- que resolver nada raro.
CREATE OR REPLACE FUNCTION public.can_see_notification(n public.notifications)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_visible boolean;
BEGIN
  IF NOT public.is_workspace_member(n.workspace_id) THEN
    RETURN false;
  END IF;

  -- Owner y Admin ven todo lo del workspace.
  IF public.is_workspace_admin(n.workspace_id) THEN
    RETURN true;
  END IF;

  -- Dirigida a mi personalmente.
  IF n.recipient_id = auth.uid() THEN
    RETURN true;
  END IF;

  -- De aca para abajo: es un Member y el aviso no es suyo. Solo lo ve si apunta
  -- a un lead que le corresponde. La pregunta se delega en las funciones de
  -- scope que ya existen, para no tener la regla escrita dos veces.
  IF n.entity_id IS NULL THEN
    RETURN false;
  END IF;

  IF n.entity_type = 'conversation' THEN
    SELECT public.can_see_conversation(c) INTO v_visible
    FROM public.conversations c
    WHERE c.id = n.entity_id;
    RETURN COALESCE(v_visible, false);
  END IF;

  IF n.entity_type = 'contact' THEN
    SELECT public.can_see_contact(ct) INTO v_visible
    FROM public.contacts ct
    WHERE ct.id = n.entity_id;
    RETURN COALESCE(v_visible, false);
  END IF;

  -- Todo lo demas (canales caidos, colisiones de secuencias) es informacion de
  -- administracion: un Member no la ve.
  RETURN false;
END;
$$;

COMMENT ON FUNCTION public.can_see_notification(public.notifications) IS
  'Scope de leads aplicado a las notificaciones (F18). Owner/Admin ven todo el workspace; un Member ve las suyas y las que apuntan a un lead que le corresponde. Delega en can_see_conversation / can_see_contact.';

REVOKE ALL ON FUNCTION public.can_see_notification(public.notifications) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_see_notification(public.notifications) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications_select" ON public.notifications;
CREATE POLICY "notifications_select" ON public.notifications
  FOR SELECT USING (public.can_see_notification(notifications));

-- Marcar leido y nada mas. El USING y el WITH CHECK son el mismo predicado, asi
-- que nadie puede mover un aviso a otro workspace ni "leer" el de otro.
DROP POLICY IF EXISTS "notifications_update" ON public.notifications;
CREATE POLICY "notifications_update" ON public.notifications
  FOR UPDATE USING (public.can_see_notification(notifications))
  WITH CHECK (public.can_see_notification(notifications));

DROP POLICY IF EXISTS "notifications_delete" ON public.notifications;
CREATE POLICY "notifications_delete" ON public.notifications
  FOR DELETE USING (public.is_workspace_admin(workspace_id));

-- Sin policy de INSERT: los avisos los genera el sistema con el service role.
-- Si un usuario pudiera insertar, podria fabricarle un aviso a otro.
DROP POLICY IF EXISTS "notifications_insert" ON public.notifications;

-- ----------------------------------------------------------------------------
-- Realtime — para que la campana se actualice sola
-- ----------------------------------------------------------------------------
-- Con guard: el ALTER pelado falla al re-correr con "table is already member of
-- publication", y esta migracion tiene que poder correrse dos veces.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- Purga
-- ----------------------------------------------------------------------------
-- Un aviso leido de hace dos meses no lo mira nadie y la tabla crece sola.
-- Los NO leidos no se tocan nunca: si nadie lo vio, sigue pendiente.
CREATE OR REPLACE FUNCTION public.purge_read_notifications(p_retention_days integer DEFAULT 60)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted integer := 0;
BEGIN
  DELETE FROM public.notifications
  WHERE read_at IS NOT NULL
    AND read_at < now() - make_interval(days => GREATEST(p_retention_days, 1));

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

COMMENT ON FUNCTION public.purge_read_notifications(integer) IS
  'Borra las notificaciones LEIDAS de mas de N dias. Las no leidas no se tocan nunca. La llama el cron diario.';

REVOKE ALL ON FUNCTION public.purge_read_notifications(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_read_notifications(integer) TO service_role;

-- ============================================================
-- MIGRATION 52: PURGE NOTIFICATIONS CRON
-- ============================================================
-- ============================================================================
-- 00052 — Agendar la purga de notificaciones leidas (F18)
-- ============================================================================
-- La funcion purge_read_notifications quedo creada en la 00051 pero no la
-- llamaba nadie: una funcion de purga sin cron es una tabla que crece igual.
--
-- Va por SQL directo y no por HTTP, como purge_soft_deleted: es puro SQL, no
-- necesita Storage ni nada de la app, y dar la vuelta por la red solo suma un
-- punto de falla.
--
-- Los documentos borrados de la base de conocimiento NO se purgan aca. Esos si
-- necesitan borrar el archivo del bucket de Storage, y eso desde SQL no se
-- puede: lo hace la app, en /api/cron/jobs. Borrar la fila desde aca dejaria el
-- archivo huerfano para siempre.
--
-- Idempotente: cron.unschedule antes de agendar, envuelto para que no falle si
-- el job todavia no existe.
-- ============================================================================

DO $$
BEGIN
  PERFORM cron.unschedule('purge-notifications');
EXCEPTION
  WHEN OTHERS THEN NULL;  -- todavia no existia
END $$;

-- 4:50: las otras purgas ya ocupan :00, :10, :20, :30 y :40.
SELECT cron.schedule(
  'purge-notifications',
  '50 4 * * *',
  $$SELECT public.purge_read_notifications(60)$$
);

-- ============================================================
-- MIGRATION 53: MESSAGES PERSISTENCE
-- ============================================================
-- ============================================================================
-- 00053 — Persistencia de mensajes: workspace_id, autoria del agente e interruptor
-- ============================================================================
-- Prepara la tabla `messages` para que empiece a recibir los entrantes de TODOS
-- los canales, incluidos los DMs de Instagram que hasta ahora no se guardaban
-- (Zernio era la fuente de verdad y la bandeja le pedia el hilo por API).
--
-- Tres cosas:
--
-- 1. `workspace_id` denormalizado. Hasta hoy el aislamiento se resolvia por
--    join contra `conversations`, y alcanzaba porque casi nadie consultaba
--    `messages`. Los dashboards de la Fase 3 agrupan por dia, canal y direccion
--    sobre esta tabla, que va a ser la mas grande del sistema: sin la columna,
--    cada consulta arrastra un join. La tabla tiene 0 filas hoy, asi que es el
--    momento mas barato para agregarla.
--
-- 2. `sent_by_agent_id`, para distinguir lo que manda el agente de IA de lo que
--    manda una persona (`sent_by_user_id`) o un flow (`sent_by_flow_id`).
--
-- 3. El interruptor `workspaces.persist_zernio_inbound`, para poder apagar el
--    guardado de los entrantes de Zernio sin un deploy.
--
-- Lo que NO se hace aca, a proposito:
--   - `deleted_at` en messages. El borrado es fisico: messages.conversation_id
--     y conversations.contact_id son ON DELETE CASCADE, asi que purge_soft_deleted
--     (00025) ya se lleva los mensajes de un contacto purgado. Un soft delete
--     dejaria el texto del lead en la base aparentando estar borrado, que es lo
--     contrario de lo que exigen las reglas de retencion de Meta.
--   - `agent_run_id`. Es del Bloque 2, junto con la tabla `agent_runs`.
--
-- Idempotente.
-- ============================================================================

-- ------------------------------------------------------------
-- 1. workspace_id en messages
-- ------------------------------------------------------------

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;

COMMENT ON COLUMN public.messages.workspace_id IS
  'Denormalizado desde conversations. Lo completa el trigger messages_fill_workspace_id, asi que ningun insert tiene que acordarse. Existe para que los dashboards agrupen sin join; NO reemplaza al EXISTS de la policy, que es de donde sale el scope de leads.';

-- Las filas que ya estaban (los de WhatsApp y los salientes de flow).
UPDATE public.messages m
   SET workspace_id = c.workspace_id
  FROM public.conversations c
 WHERE c.id = m.conversation_id
   AND m.workspace_id IS NULL;

-- NOT NULL solo si quedo todo completo. Mismo criterio que la 00038: una fila
-- huerfana no puede bloquear la migracion entera, pero tiene que avisar.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.messages WHERE workspace_id IS NULL) THEN
    ALTER TABLE public.messages ALTER COLUMN workspace_id SET NOT NULL;
  ELSE
    RAISE WARNING 'Quedan mensajes sin workspace_id: la columna queda opcional. Revisar filas huerfanas.';
  END IF;
END $$;

-- Lo mantiene al dia sin que el codigo tenga que acordarse. Hace falta porque
-- hay seis lugares que insertan en messages sin pasar por insertMessage
-- (flow-engine/send.ts, los nodos send-message y comment-reply, ai-response y
-- el envio manual de /api/v1/messages): confiar en que cada uno mande la
-- columna es confiar en acordarse seis veces, y en la septima.
CREATE OR REPLACE FUNCTION public.messages_set_workspace_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.workspace_id IS NULL THEN
    SELECT c.workspace_id INTO NEW.workspace_id
      FROM public.conversations c WHERE c.id = NEW.conversation_id;
  END IF;
  RETURN NEW;
END;
$$;

-- Un trigger corre con los privilegios del dueño de la tabla, no del invocante:
-- revocar EXECUTE no lo afecta. Es lo que pide la 00048 para que el linter no
-- la reporte.
REVOKE ALL ON FUNCTION public.messages_set_workspace_id() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS messages_fill_workspace_id ON public.messages;
CREATE TRIGGER messages_fill_workspace_id
  BEFORE INSERT OR UPDATE OF conversation_id ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.messages_set_workspace_id();

-- ------------------------------------------------------------
-- 2. Autoria del agente de IA
-- ------------------------------------------------------------
-- SIN foreign key a proposito: la tabla `agents` todavia no existe, se crea en
-- el Bloque 2 de esta fase.
--
--   >>> BLOQUE 2: agregar aca la constraint cuando exista `agents`:
--   >>> ALTER TABLE public.messages
--   >>>   ADD CONSTRAINT messages_sent_by_agent_id_fkey
--   >>>   FOREIGN KEY (sent_by_agent_id) REFERENCES public.agents(id) ON DELETE SET NULL;
--
-- Y en esa misma migracion va `agent_run_id`, que tampoco se crea aca.

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS sent_by_agent_id uuid;

COMMENT ON COLUMN public.messages.sent_by_agent_id IS
  'Que agente de IA mando este mensaje. Sin FK todavia: la tabla agents se crea en el Bloque 2 de la Fase 3, que es donde hay que agregar la constraint.';

-- ------------------------------------------------------------
-- 3. Indices para los dashboards del Bloque 3
-- ------------------------------------------------------------
-- El grafico es un GROUP BY por dia y direccion dentro de un rango de fechas.
-- Con estos dos, y la columna recien agregada, sale del indice sin tocar
-- conversations.

CREATE INDEX IF NOT EXISTS idx_messages_workspace_created
  ON public.messages(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_workspace_direction_created
  ON public.messages(workspace_id, direction, created_at);

-- Para el "abrir el run que genero este mensaje" del Bloque 2, y para que
-- desactivar un agente no obligue a un seq scan.
CREATE INDEX IF NOT EXISTS idx_messages_sent_by_agent
  ON public.messages(sent_by_agent_id) WHERE sent_by_agent_id IS NOT NULL;

-- ------------------------------------------------------------
-- 4. El interruptor del guardado de entrantes de Zernio
-- ------------------------------------------------------------
-- Un registro en la base y no una variable de entorno: apagarlo no puede
-- depender de un deploy. Mismo patron que lead_scope_enabled (00018/00024).
--
-- Arranca en true: los mensajes no son retroactivos mas alla de los ~500 por
-- conversacion que devuelve la API de Zernio, asi que cada dia apagado es
-- historia que no se recupera. Si la confirmacion de los terminos de Zernio y
-- Meta sale mal, se apaga desde Ajustes y se purga lo guardado.
--
-- Solo gobierna los entrantes de los canales de Zernio. Los de WhatsApp
-- (Evolution) y los salientes se guardan siempre: para WhatsApp esta tabla es
-- la unica fuente del hilo, apagarlo vaciaria la bandeja.
--
-- No hace falta policy nueva: workspaces_update ya es Owner/Admin (00018).

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS persist_zernio_inbound boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.workspaces.persist_zernio_inbound IS
  'Si se guardan localmente los mensajes entrantes de los canales de Zernio (Instagram). Apagado, el receptor no inserta y el sistema se comporta como antes de la Fase 3. No afecta a WhatsApp ni a los salientes.';

-- ============================================================
-- MIGRATION 54: MESSAGES RLS
-- ============================================================
-- ============================================================================
-- 00054 — RLS de messages con workspace_id, sin perder el scope de leads
-- ============================================================================
-- Las dos policies de messages vienen intactas desde la 00002 y dicen, las dos,
-- lo mismo: "existe una conversacion con este id de la que sos miembro".
--
-- Ese EXISTS es mas importante de lo que parece, y hay que entender por que
-- antes de tocarlo. Una subconsulta dentro de una POLICY pasa por la RLS de la
-- tabla que consulta (esta documentado en la 00018, lineas 203-206). Asi que
-- ese `select 1 from conversations` no devuelve cualquier conversacion:
-- devuelve las que la policy conversations_select deja ver, que llama a
-- can_see_conversation -> can_see_contact. De ahi sale, gratis y sin nombrarlo,
-- TODO el scope de leads de los mensajes: un Member no ve los mensajes de un
-- lead ajeno porque no ve la conversacion.
--
-- Por eso esta migracion NO reemplaza el EXISTS por un filtro sobre la columna
-- workspace_id recien agregada. Cambiar
--
--     EXISTS (select 1 from conversations ...)     -- scope de leads incluido
--   por
--     public.is_workspace_member(workspace_id)     -- solo aislamiento
--
-- se leeria como una simplificacion equivalente y seria un agujero: cualquier
-- Member pasaria a ver los mensajes de todos los leads del workspace. El
-- aislamiento por workspace y el scope de leads no son la misma regla.
--
-- Lo que se hace es SUMAR la condicion, no cambiarla. Queda igual de estricta
-- que antes mas una barrera extra, y el planner puede arrancar por el indice
-- de workspace_id en vez de por el join.
--
-- UPDATE y DELETE siguen sin policy, y eso es deliberado: con RLS activa y sin
-- policy, nadie que no sea service role puede tocar un mensaje. Es lo correcto
-- —ninguna pantalla edita ni borra mensajes; el status lo escribe el servidor y
-- el borrado es por cascade o por la purga de retencion— y es el mismo criterio
-- que la 00046 dejo escrito para scheduled_jobs. Se documenta en un COMMENT
-- para que se lea como una decision y no como un olvido.
--
-- Idempotente.
-- ============================================================================

-- Los nombres viejos, de la 00002. Se borran por nombre exacto para no dejar
-- dos policies permisivas conviviendo (en RLS se suman con OR: la vieja, mas
-- laxa, ganaria y esta migracion no haria nada).
DROP POLICY IF EXISTS "Users can view messages via conversation" ON public.messages;
DROP POLICY IF EXISTS "Users can insert messages via conversation" ON public.messages;

DROP POLICY IF EXISTS "messages_select" ON public.messages;
CREATE POLICY "messages_select" ON public.messages
  FOR SELECT USING (
    public.is_workspace_member(workspace_id)
    AND EXISTS (
      SELECT 1 FROM public.conversations conv
      WHERE conv.id = messages.conversation_id
    )
  );

DROP POLICY IF EXISTS "messages_insert" ON public.messages;
CREATE POLICY "messages_insert" ON public.messages
  FOR INSERT WITH CHECK (
    public.is_workspace_member(workspace_id)
    AND EXISTS (
      SELECT 1 FROM public.conversations conv
      WHERE conv.id = messages.conversation_id
    )
  );

COMMENT ON TABLE public.messages IS
  'Mensajes de todos los canales. Desde la Fase 3 guarda tambien los entrantes de Zernio (Instagram), sujeto al interruptor workspaces.persist_zernio_inbound. SELECT e INSERT exigen ver la conversacion (de ahi sale el scope de leads) ademas de ser miembro del workspace. UPDATE y DELETE no tienen policy a proposito: solo el service role escribe estados y solo la purga borra.';

-- ============================================================
-- MIGRATION 55: MESSAGES RETENTION
-- ============================================================
-- ============================================================================
-- 00055 — Retencion de los mensajes crudos (F20)
-- ============================================================================
-- Desde la 00053 se guardan los entrantes de todos los canales, incluido el
-- contenido de los DMs de Instagram. Guardar texto de leads sin una fecha de
-- vencimiento no es una tabla que crece: es un compromiso que no se esta
-- cumpliendo. Esta migracion le pone el vencimiento.
--
-- **Politica: 12 meses para los mensajes crudos.** Los agregados que alimenten
-- los dashboards (Bloque 3) son otra cosa y se conservan indefinidamente: son
-- conteos por dia, canal y direccion, sin texto ni datos personales. La linea
-- divisoria es esa — lo que tiene contenido del lead vence, lo que es un numero
-- no.
--
-- Que NO borra esta purga, y por que:
--
--   - **Los mensajes de un contacto marcado "no contactar".** Esa marca dice
--     que no le escribamos mas, no que borremos lo que dijo. Borrarlos ademas
--     dejaria al operador sin el contexto de por que pidio la baja, que es
--     justo lo que necesita para no volver a equivocarse. Siguen la retencion
--     normal de 12 meses como cualquier otro.
--
--   - **Los mensajes de un contacto borrado.** No hacen falta reglas nuevas:
--     messages.conversation_id y conversations.contact_id son ON DELETE
--     CASCADE, asi que cuando purge_soft_deleted (00025) borra el contacto a
--     los 30 dias del soft delete, sus mensajes se van con el. El borrado en
--     cascada ya existia; lo que faltaba era el vencimiento por antiguedad.
--
-- Los mensajes no tienen deleted_at: el borrado es fisico. Es lo que
-- corresponde cuando lo que se promete es borrar de verdad.
--
-- Idempotente.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.purge_old_messages(
  p_retention_months integer DEFAULT 12,
  p_batch_size       integer DEFAULT 5000
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cutoff  timestamptz := now() - make_interval(months => GREATEST(p_retention_months, 1));
  v_deleted integer := 0;
  v_batch   integer := 0;
  v_rounds  integer := 0;
BEGIN
  -- Por lotes y no de un saque. Todo corre igual dentro de una transaccion
  -- (plpgsql no puede commitear en el medio), asi que esto no libera el lock
  -- entre vueltas; lo que evita es un unico DELETE enorme la primera vez que
  -- corra sobre una tabla con anios de historia. A la escala de una agencia el
  -- borrado diario es de unos pocos miles de filas y termina al instante.
  LOOP
    DELETE FROM public.messages
    WHERE id IN (
      SELECT id FROM public.messages
      WHERE created_at < v_cutoff
      ORDER BY created_at
      LIMIT GREATEST(p_batch_size, 1)
    );

    GET DIAGNOSTICS v_batch = ROW_COUNT;
    v_deleted := v_deleted + v_batch;
    v_rounds  := v_rounds + 1;

    EXIT WHEN v_batch = 0;

    -- Freno de mano: 200 lotes son un millon de filas. Si un dia hiciera falta
    -- borrar mas que eso de una vez, es una migracion pensada, no un cron que
    -- se queda toda la noche tomando la tabla del inbox.
    IF v_rounds >= 200 THEN
      RAISE WARNING 'purge_old_messages corto en % lotes (% filas). Queda historia por borrar: volve a correrla.', v_rounds, v_deleted;
      EXIT;
    END IF;
  END LOOP;

  RETURN v_deleted;
END;
$$;

COMMENT ON FUNCTION public.purge_old_messages(integer, integer) IS
  'Borra los mensajes de mas de N meses (default 12). Politica de retencion de la Fase 3. No distingue canal ni contacto: un mensaje de un contacto "no contactar" vence igual que cualquier otro, y los de un contacto borrado ya se van por cascade con purge_soft_deleted. La llama el cron diario.';

REVOKE ALL ON FUNCTION public.purge_old_messages(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_old_messages(integer, integer) TO service_role;

-- ------------------------------------------------------------
-- El cron
-- ------------------------------------------------------------
-- SQL directo, sin dar la vuelta por HTTP: es puro SQL y no necesita nada de la
-- app, igual que purge_soft_deleted. Dar la vuelta por la red solo sumaria un
-- punto de falla.
--
-- 5:00. Las purgas van encadenadas cada 10 minutos desde las 4:00 y los seis
-- slots de esa hora ya estan tomados (:00 borrados, :10 pg_net, :20 ventanas de
-- envio, :30 trigger_fires, :40 automation_events, :50 notificaciones).

DO $$
BEGIN
  PERFORM cron.unschedule('purge-messages');
EXCEPTION
  WHEN OTHERS THEN NULL;  -- todavia no existia
END $$;

SELECT cron.schedule(
  'purge-messages',
  '0 5 * * *',
  $$SELECT public.purge_old_messages(12)$$
);

-- ============================================================
-- MIGRATION 56: MESSAGES NATIVE ID
-- ============================================================
-- ============================================================================
-- 00056 — Guardar tambien el id nativo de la plataforma
-- ============================================================================
-- `platform_message_id` guarda el id de ZERNIO. Es lo correcto y no cambia: es
-- el que devuelve la API al enviar, el que usa la bandeja al leer y el unico
-- que trae el endpoint de historial, asi que es el que hace funcionar al indice
-- unico que evita los duplicados.
--
-- Pero el webhook trae DOS ids y hasta ahora se tiraba uno: `message.id` (el de
-- Zernio) y `message.platformMessageId` (el que Meta le dio al mensaje en
-- Instagram). Ese segundo es el unico handle que sirve para hablar con Meta
-- —un pedido de borrado, un reclamo de soporte, una verificacion— y NO se puede
-- recuperar despues: el endpoint de historial no lo devuelve, asi que lo que no
-- se guarde cuando entra el webhook se pierde para siempre.
--
-- Por eso va en su propia columna y no adentro de `attachments`: attachments es
-- la lista de media que la bandeja recorre para pintar imagenes, y meterle un
-- metadato que no es un adjunto obliga a filtrarlo en cada lectura. Una columna
-- nullable cuesta menos y se explica sola.
--
-- Queda en null en dos casos, los dos esperados:
--   - Los mensajes que trae el backfill, porque la API no lo devuelve.
--   - Los de WhatsApp, donde el id de Evolution ya es el nativo y esta en
--     platform_message_id.
--
-- Sin indice: no se busca por esta columna, se la consulta cuando ya se tiene
-- el mensaje. El dia que haya que buscar al reves, se agrega.
--
-- Idempotente.
-- ============================================================================

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS platform_native_message_id text;

COMMENT ON COLUMN public.messages.platform_native_message_id IS
  'Id que le dio la plataforma al mensaje (Instagram via Meta), distinto del de platform_message_id, que es el de Zernio. Solo lo trae el webhook en vivo: el endpoint de historial no lo devuelve, asi que los mensajes del backfill lo tienen en null. Es el handle para pedidos de borrado o soporte contra Meta.';

-- ============================================================
-- MIGRATION 57: PURGE ZERNIO INBOUND
-- ============================================================
-- ============================================================================
-- 00057 — Borrar todo lo persistido de los entrantes de Zernio
-- ============================================================================
-- El interruptor `workspaces.persist_zernio_inbound` existe por una duda que
-- todavia no esta resuelta: si persistir el contenido de los DMs de Instagram
-- entra dentro de los terminos de Zernio y de Meta para este tipo de cuenta.
--
-- Apagarlo frena el guardado hacia adelante, pero deja intacto todo lo que ya
-- se guardo, y la purga por antiguedad (00055) recien lo alcanzaria a los 12
-- meses. Si la respuesta llega y es que no, doce meses no es una respuesta.
--
-- Esta funcion es la otra mitad del interruptor: deja la base como si el
-- guardado nunca se hubiera prendido.
--
-- Que borra, exactamente:
--   - Mensajes ENTRANTES (direction = 'inbound')
--   - de conversaciones cuyo canal es de Zernio (provider = 'zernio')
--
-- Que NO borra, y es a proposito:
--   - Los SALIENTES de Zernio. Esos son nuestros, no del lead: los escribio el
--     sistema o una persona del equipo, y son los que dejan ver en la bandeja
--     que el bot contesto. Nunca estuvieron en discusion.
--   - Nada de WhatsApp. Evolution no pasa por los terminos de Zernio, y para
--     ese canal esta tabla es la unica fuente del hilo: borrarlo vaciaria la
--     bandeja de WhatsApp.
--
-- No la agenda ningun cron, y no deberia: es una decision que se toma una vez,
-- a mano, cuando hay una respuesta. Se corre con scripts/purge-zernio-inbound.mjs,
-- que primero muestra cuanto va a borrar y solo escribe con --apply.
--
-- Con p_apply en false (el default) no borra: cuenta. El default es el lado
-- seguro a proposito, para que una llamada sin argumentos nunca sea destructiva.
--
-- Idempotente.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.purge_zernio_inbound_messages(
  p_workspace_id uuid,
  p_apply        boolean DEFAULT false
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF p_workspace_id IS NULL THEN
    RAISE EXCEPTION 'purge_zernio_inbound_messages necesita un workspace: sin el, borraria de todos';
  END IF;

  IF NOT p_apply THEN
    SELECT count(*) INTO v_count
      FROM public.messages m
      JOIN public.conversations c ON c.id = m.conversation_id
      JOIN public.channels ch     ON ch.id = c.channel_id
     WHERE m.workspace_id = p_workspace_id
       AND m.direction = 'inbound'
       AND ch.provider = 'zernio';
    RETURN v_count;
  END IF;

  DELETE FROM public.messages m
   USING public.conversations c, public.channels ch
   WHERE c.id = m.conversation_id
     AND ch.id = c.channel_id
     AND m.workspace_id = p_workspace_id
     AND m.direction = 'inbound'
     AND ch.provider = 'zernio';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.purge_zernio_inbound_messages(uuid, boolean) IS
  'La otra mitad del interruptor persist_zernio_inbound: borra TODOS los mensajes entrantes ya guardados de los canales de Zernio, para cuando haya que deshacer la persistencia. No toca los salientes ni WhatsApp. Con p_apply en false solo cuenta. No la llama ningun cron: se corre a mano con scripts/purge-zernio-inbound.mjs.';

REVOKE ALL ON FUNCTION public.purge_zernio_inbound_messages(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_zernio_inbound_messages(uuid, boolean) TO service_role;

-- ============================================================
-- MIGRATION 58: AGENTS
-- ============================================================
-- ============================================================================
-- 00058 — Agentes de IA, historial del system prompt y las palancas nuevas
-- ============================================================================
-- Fase 3, Bloque 2a. Crea la configuracion del agente conversacional y las
-- columnas que lo conectan con el resto del sistema.
--
-- 1. `agents`. Una fila por agente. En la Etapa 1 hay un solo tipo (`chat`),
--    pero la tabla no lo asume: `type` es texto libre validado en la app contra
--    el registro de tipos, asi que el agente de contenido (Etapa 2/3) y el de
--    gestion (Etapa 3) entran como filas nuevas, sin migracion.
--    - El encendido por canal vive en `enabled_channel_ids` y no en una tabla
--      join: single-tenant, pocos canales, un agente. Al no haber FK, la app
--      valida que cada id exista y sea del workspace.
--    - Lo heterogeneo va en jsonb (`tools_config`, `guardrails`,
--      `output_format`) y se valida contra los schemas del registro.
--    - Dos defaults se apartan del documento de requerimientos a proposito:
--      `knowledge_enabled` arranca en false (el agente arranca con la base de
--      conocimiento apagada) y `knowledge_fallback` en 'general' (quien decide
--      "no se" es el agente usando la herramienta de derivar, no una busqueda
--      que volvio vacia).
--    - Tres campos que no estaban en el documento: `response_delay_seconds`
--      (demora deliberada despues de la ventana de silencio),
--      `model_timeout_seconds` y `max_replies_per_conversation`.
--    - Topes de gasto con una accion por tope: el diario avisa, el mensual
--      apaga. Cortar leads por un numero que todavia no conocemos es peor que
--      avisar, pero un loop que se come la key en una noche tiene que frenarse.
--
-- 2. `agent_prompt_versions`. Mismo patron que `flow_versions` (00010): cada
--    guardado del prompt es una fila nueva e inmutable, unica por
--    (agent_id, version). Sin policy de UPDATE ni de DELETE: el historial no se
--    reescribe. Se va en cascada solo si el agente se borra fisicamente, cosa
--    que la app no hace (soft delete).
--
-- 3. Columnas nuevas en tablas existentes:
--    - conversations.agent_enabled: el toggle de la bandeja. Decision tuya.
--    - conversations.agent_paused_until: la pausa temporal que ponen los flows
--      ("pausar agente"). Separada del toggle a proposito: "reanudar agente"
--      levanta la pausa y nunca prende un agente que nadie prendio. NULL = sin
--      pausa; 'infinity' = pausado hasta que un flow lo reanude.
--    - knowledge_base.internal_only: documento de uso interno, nunca llega al
--      prompt del agente tenga el tag que tenga.
--    - audit_log.performed_by_agent_id: performed_by apunta a un usuario, asi
--      que sin esta columna no hay forma de filtrar "lo que hizo el agente".
--    - La FK que la 00053 dejo pendiente: messages.sent_by_agent_id -> agents.
--    - workspaces.ai_daily_cost_limit_usd / ai_monthly_cost_limit_usd: topes
--      globales de gasto de IA del workspace (todas las fuentes). NULL = sin
--      tope global; los del agente siguen valiendo.
--
-- Los costos de los topes (`daily_cost_limit_usd`, `monthly_cost_limit_usd`)
-- solo los lee Owner/Admin: el privilegio de columna se ajusta en la 00060.
--
-- El estado efectivo del agente NO se guarda: se deriva de agente global +
-- canal + toggle + pausa + guardarrailes + automatizaciones + control humano.
-- Guardar solo las palancas evita estados inconsistentes.
--
-- Idempotente.
-- ============================================================================

-- ------------------------------------------------------------
-- 1. agents
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.agents (
  id                           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id                 uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name                         text NOT NULL,
  type                         text NOT NULL DEFAULT 'chat',
  is_enabled                   boolean NOT NULL DEFAULT false,

  system_prompt                text,
  active_prompt_version        integer,

  provider                     text,
  model                        text,
  fallback_provider            text,
  fallback_model               text,
  temperature                  numeric(3,2),
  max_output_tokens            integer,
  model_timeout_seconds        integer NOT NULL DEFAULT 120,

  bundle_window_seconds        integer NOT NULL DEFAULT 60,
  response_delay_seconds       integer NOT NULL DEFAULT 20,
  max_wait_seconds             integer DEFAULT 300,
  max_replies_per_conversation integer NOT NULL DEFAULT 12,

  output_format                jsonb NOT NULL DEFAULT '{}'::jsonb,
  allowed_tools                text[] NOT NULL DEFAULT '{}',
  tools_config                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  guardrails                   jsonb NOT NULL DEFAULT '{}'::jsonb,

  knowledge_enabled            boolean NOT NULL DEFAULT false,
  knowledge_tags               text[] NOT NULL DEFAULT '{}',
  knowledge_fallback           text NOT NULL DEFAULT 'general',

  daily_cost_limit_usd         numeric(10,2) DEFAULT 5,
  daily_cost_limit_action      text NOT NULL DEFAULT 'notify',
  monthly_cost_limit_usd       numeric(10,2) DEFAULT 100,
  monthly_cost_limit_action    text NOT NULL DEFAULT 'disable',

  enabled_channel_ids          uuid[] NOT NULL DEFAULT '{}',
  config                       jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_by                   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now(),
  deleted_at                   timestamptz
);

COMMENT ON TABLE public.agents IS
  'Agentes de IA del workspace. type dirige que configuracion y herramientas se muestran (validado en la app, no con CHECK, para sumar tipos sin migracion). El encendido por canal vive en enabled_channel_ids. Soft delete con deleted_at: los runs historicos siguen apuntando aca.';
COMMENT ON COLUMN public.agents.enabled_channel_ids IS
  'Canales que el agente atiende (interruptor maestro). Sin FK: la app valida que existan y sean del workspace. Vacio = ninguno.';
COMMENT ON COLUMN public.agents.response_delay_seconds IS
  'Demora deliberada despues de que cierra la ventana de silencio. El envio apunta a ultimo_mensaje + bundle_window_seconds + response_delay_seconds; la generacion y el tic del cron se absorben dentro de esta demora.';
COMMENT ON COLUMN public.agents.knowledge_fallback IS
  'escalate | general. Default general: si la busqueda no encuentra nada, el agente sigue y decide el mismo si deriva.';

-- Checks con nombre, agregados por separado para que la migracion sea
-- re-ejecutable sobre una tabla que ya existe.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agents_type_format') THEN
    ALTER TABLE public.agents ADD CONSTRAINT agents_type_format
      CHECK (type ~ '^[a-z][a-z0-9_]{1,39}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agents_name_not_blank') THEN
    ALTER TABLE public.agents ADD CONSTRAINT agents_name_not_blank
      CHECK (length(btrim(name)) BETWEEN 1 AND 80);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agents_temperature_range') THEN
    ALTER TABLE public.agents ADD CONSTRAINT agents_temperature_range
      CHECK (temperature IS NULL OR temperature BETWEEN 0 AND 2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agents_max_output_tokens_range') THEN
    ALTER TABLE public.agents ADD CONSTRAINT agents_max_output_tokens_range
      CHECK (max_output_tokens IS NULL OR max_output_tokens BETWEEN 16 AND 16000);
  END IF;
  -- Techo del tiempo de la invocacion: la ruta de cron tiene maxDuration 300 s
  -- y la espera al objetivo suma demora + timeout dentro de la misma ejecucion.
  -- La app valida la regla completa (demora + timeout + 30 < 300); la base
  -- sostiene la version dura por si alguien escribe por fuera de la app.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agents_time_budget') THEN
    ALTER TABLE public.agents ADD CONSTRAINT agents_time_budget
      CHECK (
        model_timeout_seconds BETWEEN 10 AND 240
        AND response_delay_seconds BETWEEN 0 AND 180
        AND response_delay_seconds + model_timeout_seconds + 30 < 300
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agents_windows_range') THEN
    ALTER TABLE public.agents ADD CONSTRAINT agents_windows_range
      CHECK (
        bundle_window_seconds BETWEEN 15 AND 3600
        AND (max_wait_seconds IS NULL OR max_wait_seconds >= bundle_window_seconds)
        AND max_replies_per_conversation BETWEEN 1 AND 500
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agents_knowledge_fallback_values') THEN
    ALTER TABLE public.agents ADD CONSTRAINT agents_knowledge_fallback_values
      CHECK (knowledge_fallback IN ('escalate', 'general'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agents_cost_limits') THEN
    ALTER TABLE public.agents ADD CONSTRAINT agents_cost_limits
      CHECK (
        (daily_cost_limit_usd IS NULL OR daily_cost_limit_usd >= 0)
        AND (monthly_cost_limit_usd IS NULL OR monthly_cost_limit_usd >= 0)
        AND daily_cost_limit_action IN ('notify', 'disable')
        AND monthly_cost_limit_action IN ('notify', 'disable')
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_agents_workspace
  ON public.agents(workspace_id) WHERE deleted_at IS NULL;

-- "Que agente atiende este canal" es la consulta de cada mensaje entrante.
CREATE INDEX IF NOT EXISTS idx_agents_enabled_channels
  ON public.agents USING gin(enabled_channel_ids) WHERE deleted_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_agents') THEN
    CREATE TRIGGER set_updated_at_agents
      BEFORE UPDATE ON public.agents
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
  END IF;
END $$;

-- ------------------------------------------------------------
-- 2. agent_prompt_versions
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.agent_prompt_versions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  agent_id      uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  version       integer NOT NULL,
  system_prompt text NOT NULL,
  note          text,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.agent_prompt_versions IS
  'Historial inmutable del system prompt de cada agente. Mismo patron que flow_versions. Cada run guarda la version que uso (agent_runs.prompt_version).';

CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_prompt_versions_agent_version
  ON public.agent_prompt_versions(agent_id, version);

-- ------------------------------------------------------------
-- 3. Columnas nuevas en tablas existentes
-- ------------------------------------------------------------

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS agent_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS agent_paused_until timestamptz;

COMMENT ON COLUMN public.conversations.agent_enabled IS
  'Toggle del agente en esta conversacion (bandeja). Lo apaga Human Takeover y una respuesta manual del operador. Ortogonal a is_automation_paused, que gobierna los flows.';
COMMENT ON COLUMN public.conversations.agent_paused_until IS
  'Pausa temporal del agente puesta por un flow ("pausar agente"). NULL = sin pausa, infinity = hasta que un flow lo reanude. Reanudar la levanta sin tocar agent_enabled.';

ALTER TABLE public.knowledge_base
  ADD COLUMN IF NOT EXISTS internal_only boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.knowledge_base.internal_only IS
  'Uso interno: nunca llega al prompt de un agente, tenga el tag que tenga. El filtro va dentro de match_knowledge_chunks_filtered (00062).';

ALTER TABLE public.audit_log
  ADD COLUMN IF NOT EXISTS performed_by_agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.audit_log.performed_by_agent_id IS
  'Agente que ejecuto la accion. performed_by (usuario) queda NULL en ese caso. Es la base de la vista de Acciones.';

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS ai_daily_cost_limit_usd numeric(10,2),
  ADD COLUMN IF NOT EXISTS ai_monthly_cost_limit_usd numeric(10,2);

COMMENT ON COLUMN public.workspaces.ai_daily_cost_limit_usd IS
  'Tope diario de gasto de IA de todo el workspace (todas las fuentes). NULL = sin tope global. Corte del dia en la zona del negocio.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_sent_by_agent_id_fkey') THEN
    -- NOT VALID + VALIDATE: si quedo algun id huerfano de pruebas, la
    -- validacion avisa en vez de tumbar toda la migracion.
    ALTER TABLE public.messages
      ADD CONSTRAINT messages_sent_by_agent_id_fkey
      FOREIGN KEY (sent_by_agent_id) REFERENCES public.agents(id) ON DELETE SET NULL
      NOT VALID;
    BEGIN
      ALTER TABLE public.messages VALIDATE CONSTRAINT messages_sent_by_agent_id_fkey;
    EXCEPTION WHEN foreign_key_violation THEN
      RAISE WARNING 'messages.sent_by_agent_id tiene ids que no existen en agents: la FK queda NOT VALID. Revisar.';
    END;
  END IF;
END $$;

COMMENT ON COLUMN public.messages.sent_by_agent_id IS
  'Que agente de IA mando este mensaje. FK a agents desde la 00058.';

-- El agente se busca por conversacion en cada mensaje entrante y en cada turno.
CREATE INDEX IF NOT EXISTS idx_conversations_agent_enabled
  ON public.conversations(workspace_id) WHERE agent_enabled;

-- ============================================================
-- MIGRATION 59: AGENT RUNS
-- ============================================================
-- ============================================================================
-- 00059 — Runs, pasos, precios por modelo y la marca de error del agente
-- ============================================================================
-- Fase 3, Bloque 2a. La observabilidad va junto con el agente y no despues:
-- el historial de runs y el costo no son retroactivos.
--
-- 1. `agent_runs`. Una fila por llamada a IA del sistema, no solo del agente.
--    - Un run del agente es un TURNO (un disparo y su respuesta), no una
--      conversacion: es la unidad que hace el costo atribuible y el error
--      localizable. Una rafaga respondida junta es un run.
--    - `source` cubre todo el gasto de IA: agent / flow_ai_node /
--      sequence_ai_step / kb_indexing / conversation_summary. El documento
--      listaba cuatro; los pasos de IA de las secuencias son un quinto llamador
--      real y meterlos en flow_ai_node haria mentir la pestana de costos.
--    - `status` suma dos valores a los cinco del documento: `running` (el run
--      se abre ANTES de la llamada, asi un proceso que muere deja evidencia y no
--      un agujero; un barrido del cron los cierra) y `completed` (indexar un
--      documento no "responde").
--    - `conversation_id` nullable + `thread_id`: el agente de contenido de la
--      Etapa 2/3 no vive en una conversacion de la bandeja.
--    - `cost_usd` se calcula y se congela al cerrar el run. Si el precio cambia
--      despues, el historial no se reescribe. NULL si el modelo no tenia precio
--      cargado: el run se guarda igual.
--    - Los runs NO se borran con el agente ni con el contacto: son la serie
--      historica del gasto. Las FKs son ON DELETE SET NULL.
--
-- 2. `agent_run_steps`. Una fila por llamada a modelo, busqueda en la KB o
--    herramienta. Guarda el detalle tecnico; el efecto de negocio vive en
--    audit_log y el paso lo referencia (`audit_log_id`) sin duplicarlo.
--    `input`/`output` pueden tener texto del lead y fragmentos de documentos:
--    siguen la retencion de los mensajes (12 meses) y se vacian cuando el
--    contacto se purga. La fila y sus metricas se conservan.
--
-- 3. `model_pricing`. Precio por millon de tokens con `valid_from`. Nunca se
--    sobrescribe: un precio nuevo es una fila nueva. Se siembra con
--    supabase/seeds/00_model_pricing.sql, separado de la estructura.
--
-- 4. `messages.agent_run_id`: desde un mensaje de la bandeja se abre el run que
--    lo genero.
--
-- 5. `conversations.last_agent_error_at` / `last_agent_error_run_id`: la marca
--    de "el agente fallo aca y este lead puede estar sin respuesta". La pone el
--    runner cuando un turno termina en error o se descarta; la borran una
--    respuesta buena del agente, un mensaje de una persona del equipo o el
--    cierre de la conversacion. Nunca la borra el paso del tiempo.
--
-- Indices: los de la seccion 7.3 del documento, mas los de audit_log para la
-- vista de Acciones (Bloque 2b) y el parcial del filtro de errores de la bandeja.
--
-- Las policies y los privilegios de columna van en la 00060.
--
-- Idempotente.
-- ============================================================================

-- ------------------------------------------------------------
-- 1. model_pricing (primero: agent_runs la referencia)
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.model_pricing (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider              text NOT NULL,
  model                 text NOT NULL,
  input_per_mtok        numeric(12,6) NOT NULL,
  output_per_mtok       numeric(12,6) NOT NULL,
  cached_input_per_mtok numeric(12,6) NOT NULL,
  currency              text NOT NULL DEFAULT 'USD',
  valid_from            timestamptz NOT NULL DEFAULT now(),
  note                  text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.model_pricing IS
  'Precios por millon de tokens por modelo, con vigencia. Un cambio de precio es una fila nueva con valid_from nuevo: el historial se conserva y los runs viejos no se recalculan. model es texto libre, sin lista cerrada. Solo Owner/Admin la leen.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'model_pricing_non_negative') THEN
    ALTER TABLE public.model_pricing ADD CONSTRAINT model_pricing_non_negative
      CHECK (input_per_mtok >= 0 AND output_per_mtok >= 0 AND cached_input_per_mtok >= 0);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_model_pricing_version
  ON public.model_pricing(workspace_id, provider, model, valid_from);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_model_pricing') THEN
    CREATE TRIGGER set_updated_at_model_pricing
      BEFORE UPDATE ON public.model_pricing
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
  END IF;
END $$;

-- ------------------------------------------------------------
-- 2. agent_runs
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.agent_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  source           text NOT NULL,
  agent_id         uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  prompt_version   integer,
  conversation_id  uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  thread_id        text,
  contact_id       uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  channel_id       uuid REFERENCES public.channels(id) ON DELETE SET NULL,
  trigger          text NOT NULL,
  status           text NOT NULL DEFAULT 'running',
  status_detail    text,
  provider         text,
  model            text,
  input_tokens     integer,
  output_tokens    integer,
  cached_tokens    integer,
  embedding_tokens integer,
  cost_usd         numeric(12,6),
  pricing_id       uuid REFERENCES public.model_pricing(id) ON DELETE SET NULL,
  latency_ms       integer,
  step_count       integer NOT NULL DEFAULT 0,
  error            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz
);

COMMENT ON TABLE public.agent_runs IS
  'Una fila por llamada a IA del sistema (source). Para el agente, un run = un turno. Solo la escribe el service role. Las columnas de tokens y costo solo son legibles por Owner/Admin via servidor (privilegio de columna en la 00060).';
COMMENT ON COLUMN public.agent_runs.cost_usd IS
  'Costo congelado al cerrar el run: tokens de chat + embeddings del turno por el precio vigente en ese momento. NULL si el modelo no tenia precio cargado (status_detail lo aclara).';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_runs_source_values') THEN
    ALTER TABLE public.agent_runs ADD CONSTRAINT agent_runs_source_values
      CHECK (source IN ('agent', 'flow_ai_node', 'sequence_ai_step', 'kb_indexing', 'conversation_summary'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_runs_trigger_values') THEN
    ALTER TABLE public.agent_runs ADD CONSTRAINT agent_runs_trigger_values
      CHECK (trigger IN ('inbound_message', 'cron_close', 'manual', 'flow_node', 'sequence_step', 'job'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_runs_status_values') THEN
    ALTER TABLE public.agent_runs ADD CONSTRAINT agent_runs_status_values
      CHECK (status IN ('running', 'responded', 'escalated', 'skipped_automation',
                        'blocked_guardrail', 'completed', 'error'));
  END IF;
  -- Cuando la fuente no es el agente, agent_id queda nulo (documento, 4.5).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_runs_agent_only_for_agent_sources') THEN
    ALTER TABLE public.agent_runs ADD CONSTRAINT agent_runs_agent_only_for_agent_sources
      CHECK (agent_id IS NULL OR source IN ('agent', 'conversation_summary'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_agent_runs_workspace_created
  ON public.agent_runs(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_created
  ON public.agent_runs(agent_id, created_at DESC) WHERE agent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_runs_conversation
  ON public.agent_runs(conversation_id, created_at DESC) WHERE conversation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_runs_status
  ON public.agent_runs(status);
-- El barrido de runs colgados mira solo los abiertos.
CREATE INDEX IF NOT EXISTS idx_agent_runs_running
  ON public.agent_runs(created_at) WHERE status = 'running';

-- ------------------------------------------------------------
-- 3. agent_run_steps
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.agent_run_steps (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  run_id       uuid NOT NULL REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  step_index   integer NOT NULL,
  kind         text NOT NULL,
  name         text,
  input        jsonb,
  output       jsonb,
  kb_chunk_ids uuid[],
  audit_log_id uuid REFERENCES public.audit_log(id) ON DELETE SET NULL,
  duration_ms  integer,
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.agent_run_steps IS
  'Detalle tecnico de cada run: una fila por llamada al modelo, busqueda en la KB o herramienta. input/output pueden tener texto del lead: siguen la retencion de los mensajes y nunca van a los logs.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_run_steps_kind_values') THEN
    ALTER TABLE public.agent_run_steps ADD CONSTRAINT agent_run_steps_kind_values
      CHECK (kind IN ('model_call', 'kb_search', 'tool_call', 'guardrail'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_run_steps_run_index
  ON public.agent_run_steps(run_id, step_index);
CREATE INDEX IF NOT EXISTS idx_agent_run_steps_audit
  ON public.agent_run_steps(audit_log_id) WHERE audit_log_id IS NOT NULL;

-- ------------------------------------------------------------
-- 4. messages.agent_run_id
-- ------------------------------------------------------------

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS agent_run_id uuid REFERENCES public.agent_runs(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.messages.agent_run_id IS
  'Run del agente que genero este mensaje. Desde la bandeja se abre el run; desde el run se salta a la conversacion.';

CREATE INDEX IF NOT EXISTS idx_messages_agent_run
  ON public.messages(agent_run_id) WHERE agent_run_id IS NOT NULL;

-- ------------------------------------------------------------
-- 5. La marca de error del agente en la conversacion
-- ------------------------------------------------------------

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS last_agent_error_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_agent_error_run_id uuid REFERENCES public.agent_runs(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.conversations.last_agent_error_at IS
  'El agente fallo en esta conversacion y el lead puede estar sin respuesta. Se pone con un turno en error, descartado o con el proveedor caido despues del respaldo. Se borra con una respuesta buena del agente, un mensaje de una persona del equipo o el cierre de la conversacion. No se borra por paso del tiempo ni porque el lead vuelva a escribir.';

-- El filtro "con error del agente" de la bandeja. Parcial: son pocas filas.
CREATE INDEX IF NOT EXISTS idx_conversations_agent_error
  ON public.conversations(workspace_id, last_agent_error_at DESC)
  WHERE last_agent_error_at IS NOT NULL;

-- ------------------------------------------------------------
-- 6. Indices de audit_log para la vista de Acciones (Bloque 2b)
-- ------------------------------------------------------------
-- (workspace_id, performed_at DESC) ya existe desde la 00023 con otro nombre;
-- IF NOT EXISTS por nombre no lo detecta, asi que se chequea por definicion.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'audit_log'
      AND indexdef ILIKE '%(workspace_id, performed_at DESC)%'
  ) THEN
    CREATE INDEX idx_audit_log_workspace_performed
      ON public.audit_log(workspace_id, performed_at DESC);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_audit_log_workspace_action
  ON public.audit_log(workspace_id, action, performed_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_agent
  ON public.audit_log(performed_by_agent_id, performed_at DESC)
  WHERE performed_by_agent_id IS NOT NULL;

-- ------------------------------------------------------------
-- 7. Retencion del contenido textual de los pasos
-- ------------------------------------------------------------
-- Dos casos, los dos vacian input/output y conservan la fila con sus metricas:
--   - Antiguedad: la misma que los mensajes (12 meses, 00055).
--   - Contacto purgado: purge_soft_deleted (00025) borra el contacto y, por
--     ON DELETE SET NULL, el run queda sin contact_id ni conversation_id. Si la
--     fuente era una conversacion con un lead (agent / conversation_summary),
--     ese texto ya no tiene dueno y se vacia.

CREATE OR REPLACE FUNCTION public.purge_agent_run_step_content(p_retention_months integer DEFAULT 12)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cutoff  timestamptz := now() - make_interval(months => GREATEST(p_retention_months, 1));
  v_cleared integer := 0;
BEGIN
  UPDATE public.agent_run_steps s
     SET input = NULL, output = NULL
    FROM public.agent_runs r
   WHERE r.id = s.run_id
     AND (s.input IS NOT NULL OR s.output IS NOT NULL)
     AND (
       s.created_at < v_cutoff
       OR (r.source IN ('agent', 'conversation_summary')
           AND r.contact_id IS NULL AND r.conversation_id IS NULL AND r.thread_id IS NULL)
     );

  GET DIAGNOSTICS v_cleared = ROW_COUNT;
  RETURN v_cleared;
END;
$$;

COMMENT ON FUNCTION public.purge_agent_run_step_content(integer) IS
  'Vacia input/output de los pasos de runs vencidos (misma retencion que messages) o cuyo contacto fue purgado. Conserva la fila y sus metricas. La llama el cron diario.';

REVOKE ALL ON FUNCTION public.purge_agent_run_step_content(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_agent_run_step_content(integer) TO service_role;

DO $$
BEGIN
  PERFORM cron.unschedule('purge-agent-steps');
EXCEPTION
  WHEN OTHERS THEN NULL;  -- todavia no existia
END $$;

-- 5:10, despues de la purga de mensajes de las 5:00.
SELECT cron.schedule(
  'purge-agent-steps',
  '10 5 * * *',
  $$SELECT public.purge_agent_run_step_content(12)$$
);

-- ============================================================
-- MIGRATION 60: AGENTS RLS
-- ============================================================
-- ============================================================================
-- 00060 — RLS y privilegios de columna de las tablas del agente
-- ============================================================================
-- Fase 3, Bloque 2a. Todas las tablas nuevas con RLS y policies explicitas.
--
-- | Tabla                 | SELECT                                  | INSERT        | UPDATE        | DELETE  |
-- |-----------------------|-----------------------------------------|---------------|---------------|---------|
-- | agents                | Miembros (sin columnas de topes)        | Owner, Admin  | Owner, Admin  | nadie (soft delete) |
-- | agent_prompt_versions | Owner, Admin                            | Owner, Admin  | nadie         | nadie   |
-- | agent_runs            | Owner/Admin; Member los de su scope     | service role  | service role  | nadie   |
-- | agent_run_steps       | igual que su run                        | service role  | nadie         | cascada |
-- | model_pricing         | Owner, Admin                            | Owner         | Owner         | Owner   |
--
-- ---------------------------------------------------------------------------
-- LOS COSTOS: privilegio de columna, no una vista
-- ---------------------------------------------------------------------------
-- La RLS es de fila: no esconde columnas. Para que un Member no pueda leer el
-- costo de un run que si puede ver, se usa el privilegio de columna.
--
-- Ojo con un detalle de Postgres que hace inutil la version ingenua: un
-- `REVOKE SELECT (col) ON t FROM authenticated` NO tiene ningun efecto si el rol
-- tiene SELECT a nivel tabla, y Supabase se lo otorga por defecto a toda tabla
-- nueva de public. Por eso se revoca el SELECT de la tabla entera y se vuelve a
-- otorgar solo sobre la lista de columnas publicas.
--
-- Consecuencias, las dos deseadas:
--   - `select('*')` sobre agent_runs con el cliente de un usuario falla con
--     permission denied, sea Member u Owner. Las consultas del cliente listan
--     columnas explicitas (AGENT_RUN_PUBLIC_COLUMNS en lib/agent/runs.ts).
--   - Los costos se leen solo desde el servidor con service role, detras de un
--     requireWorkspaceAdmin() explicito.
--
-- CUANDO SE AGREGUE UNA COLUMNA a agent_runs o agents, hay que decidir si va al
-- GRANT de abajo. Si no se agrega, el cliente de usuario no la puede leer.
--
-- Scope de leads: la policy de agent_runs para un Member usa un EXISTS sobre
-- conversations, que pasa por la RLS de conversations y arrastra el scope gratis.
-- Mismo truco que la 00054 en messages. Un run sin conversacion (indexacion,
-- nodo de flow sin conversacion) solo lo ven Owner/Admin.
--
-- Idempotente.
-- ============================================================================

-- ------------------------------------------------------------
-- 1. agents
-- ------------------------------------------------------------

ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agents_select" ON public.agents;
CREATE POLICY "agents_select" ON public.agents
  FOR SELECT USING (public.is_workspace_member(workspace_id) AND deleted_at IS NULL);

DROP POLICY IF EXISTS "agents_insert" ON public.agents;
CREATE POLICY "agents_insert" ON public.agents
  FOR INSERT WITH CHECK (public.is_workspace_admin(workspace_id));

-- El soft delete es un UPDATE que setea deleted_at: por eso el filtro de
-- deleted_at va solo en el SELECT (mismo criterio que la 00024).
DROP POLICY IF EXISTS "agents_update" ON public.agents;
CREATE POLICY "agents_update" ON public.agents
  FOR UPDATE USING (public.is_workspace_admin(workspace_id))
  WITH CHECK (public.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "agents_delete" ON public.agents;

REVOKE ALL ON TABLE public.agents FROM anon;
REVOKE SELECT ON TABLE public.agents FROM authenticated;
GRANT SELECT (
  id, workspace_id, name, type, is_enabled,
  system_prompt, active_prompt_version,
  provider, model, fallback_provider, fallback_model,
  temperature, max_output_tokens, model_timeout_seconds,
  bundle_window_seconds, response_delay_seconds, max_wait_seconds,
  max_replies_per_conversation,
  output_format, allowed_tools, tools_config, guardrails,
  knowledge_enabled, knowledge_tags, knowledge_fallback,
  enabled_channel_ids, config,
  created_by, created_at, updated_at, deleted_at
) ON public.agents TO authenticated;
-- Sin GRANT de lectura: daily_cost_limit_usd, daily_cost_limit_action,
-- monthly_cost_limit_usd, monthly_cost_limit_action.

-- ------------------------------------------------------------
-- 2. agent_prompt_versions
-- ------------------------------------------------------------

ALTER TABLE public.agent_prompt_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_prompt_versions_select" ON public.agent_prompt_versions;
CREATE POLICY "agent_prompt_versions_select" ON public.agent_prompt_versions
  FOR SELECT USING (public.is_workspace_admin(workspace_id));

-- Quien guarda queda escrito como quien guardo, y la version tiene que ser de
-- un agente del mismo workspace.
DROP POLICY IF EXISTS "agent_prompt_versions_insert" ON public.agent_prompt_versions;
CREATE POLICY "agent_prompt_versions_insert" ON public.agent_prompt_versions
  FOR INSERT WITH CHECK (
    public.is_workspace_admin(workspace_id)
    AND created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.agents a
      WHERE a.id = agent_prompt_versions.agent_id
        AND a.workspace_id = agent_prompt_versions.workspace_id
    )
  );

-- Inmutable: sin policies de UPDATE ni DELETE, y sin el privilegio.
DROP POLICY IF EXISTS "agent_prompt_versions_update" ON public.agent_prompt_versions;
DROP POLICY IF EXISTS "agent_prompt_versions_delete" ON public.agent_prompt_versions;
REVOKE ALL ON TABLE public.agent_prompt_versions FROM anon;
REVOKE UPDATE, DELETE ON TABLE public.agent_prompt_versions FROM authenticated;

-- ------------------------------------------------------------
-- 3. agent_runs
-- ------------------------------------------------------------

ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_runs_select" ON public.agent_runs;
CREATE POLICY "agent_runs_select" ON public.agent_runs
  FOR SELECT USING (
    public.is_workspace_admin(workspace_id)
    OR (
      public.is_workspace_member(workspace_id)
      AND conversation_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.conversations conv
        WHERE conv.id = agent_runs.conversation_id
      )
    )
  );

-- Sin INSERT/UPDATE/DELETE: solo el service role escribe runs.
DROP POLICY IF EXISTS "agent_runs_insert" ON public.agent_runs;
DROP POLICY IF EXISTS "agent_runs_update" ON public.agent_runs;
DROP POLICY IF EXISTS "agent_runs_delete" ON public.agent_runs;

REVOKE ALL ON TABLE public.agent_runs FROM anon, authenticated;
GRANT SELECT (
  id, workspace_id, source, agent_id, prompt_version,
  conversation_id, thread_id, contact_id, channel_id,
  trigger, status, status_detail, provider, model,
  latency_ms, step_count, error, created_at, completed_at
) ON public.agent_runs TO authenticated;
-- Sin GRANT de lectura: input_tokens, output_tokens, cached_tokens,
-- embedding_tokens, cost_usd, pricing_id.

-- ------------------------------------------------------------
-- 4. agent_run_steps
-- ------------------------------------------------------------

ALTER TABLE public.agent_run_steps ENABLE ROW LEVEL SECURITY;

-- El EXISTS pasa por la RLS de agent_runs: un paso se ve si se ve su run.
DROP POLICY IF EXISTS "agent_run_steps_select" ON public.agent_run_steps;
CREATE POLICY "agent_run_steps_select" ON public.agent_run_steps
  FOR SELECT USING (
    public.is_workspace_member(workspace_id)
    AND EXISTS (
      SELECT 1 FROM public.agent_runs r WHERE r.id = agent_run_steps.run_id
    )
  );

DROP POLICY IF EXISTS "agent_run_steps_insert" ON public.agent_run_steps;
DROP POLICY IF EXISTS "agent_run_steps_update" ON public.agent_run_steps;
DROP POLICY IF EXISTS "agent_run_steps_delete" ON public.agent_run_steps;

REVOKE ALL ON TABLE public.agent_run_steps FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.agent_run_steps FROM authenticated;

-- ------------------------------------------------------------
-- 5. model_pricing
-- ------------------------------------------------------------

ALTER TABLE public.model_pricing ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "model_pricing_select" ON public.model_pricing;
CREATE POLICY "model_pricing_select" ON public.model_pricing
  FOR SELECT USING (public.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "model_pricing_insert" ON public.model_pricing;
CREATE POLICY "model_pricing_insert" ON public.model_pricing
  FOR INSERT WITH CHECK (public.is_workspace_owner(workspace_id));

DROP POLICY IF EXISTS "model_pricing_update" ON public.model_pricing;
CREATE POLICY "model_pricing_update" ON public.model_pricing
  FOR UPDATE USING (public.is_workspace_owner(workspace_id))
  WITH CHECK (public.is_workspace_owner(workspace_id));

DROP POLICY IF EXISTS "model_pricing_delete" ON public.model_pricing;
CREATE POLICY "model_pricing_delete" ON public.model_pricing
  FOR DELETE USING (public.is_workspace_owner(workspace_id));

REVOKE ALL ON TABLE public.model_pricing FROM anon;

-- ============================================================
-- MIGRATION 61: DEBOUNCED JOBS
-- ============================================================
-- ============================================================================
-- 00061 — Jobs reprogramables: la ventana de silencio del agente
-- ============================================================================
-- Fase 3, Bloque 2a. El agente no responde al instante: espera una ventana de
-- silencio desde el ULTIMO mensaje del lead, y cada mensaje nuevo la reinicia.
-- Un temporizador en memoria (setTimeout) se pierde con cada reinicio del
-- proceso, asi que la ventana es una fila en scheduled_jobs que cada mensaje
-- empuja hacia adelante.
--
-- ---------------------------------------------------------------------------
-- dedupe_key + indice unico parcial SOLO sobre 'pending'
-- ---------------------------------------------------------------------------
-- La clave es "agent_burst:<conversation_id>". El indice unico cubre solo las
-- filas pending, y esa restriccion es la que hace todo el mecanismo:
--
--   - Mientras la rafaga esta abierta hay UNA fila pending por conversacion.
--     Dos webhooks a la vez no pueden crear dos: la exclusion la hace el motor,
--     no un "fijate si existe y si no inserto" que se pisa solo.
--
--   - Cuando el runner reclama el job (pending -> processing) la fila SALE del
--     indice. Un mensaje que llega mientras el agente esta generando puede
--     insertar una fila pending nueva con la misma clave: abre una ventana
--     nueva sin pisar el turno en curso. Si el indice cubriera processing, ese
--     mensaje tardio no tendria donde anotarse.
--
-- ---------------------------------------------------------------------------
-- push_debounced_job
-- ---------------------------------------------------------------------------
-- Atomica: INSERT ... ON CONFLICT DO UPDATE.
--
--   - El tope de espera (burst_deadline) se congela en el PRIMER mensaje de la
--     rafaga y las reprogramaciones lo leen del payload: es imposible empujar la
--     rafaga mas alla del techo aunque el lead escriba cuarenta veces.
--   - Sin tope (p_deadline NULL): LEAST(x, NULL) devuelve x en Postgres, asi que
--     el mecanismo funciona igual sin ramas. Hay test de este borde.
--   - GREATEST con el run_at existente: un webhook viejo que llega tarde (fuera
--     de orden) nunca adelanta la ventana.
--   - Si el UPDATE no afecta filas es porque la fila en conflicto paso a
--     processing entre el conflicto y el update: se reintenta el INSERT, que
--     ahora ya no choca.
--
-- El payload NO lleva textos de mensajes: el job los lee de messages al
-- ejecutarse. Eso resuelve solo la carrera del mensaje que llega entre el
-- agendado y la ejecucion, y mantiene la cola sin datos del lead.
--
-- Solo service role, como el resto de la cola (00046).
--
-- Idempotente.
-- ============================================================================

ALTER TABLE public.scheduled_jobs
  ADD COLUMN IF NOT EXISTS dedupe_key text;

COMMENT ON COLUMN public.scheduled_jobs.dedupe_key IS
  'Clave de un job reprogramable. Unica solo entre los pending: un job en processing sale del indice y deja lugar a una ventana nueva.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_scheduled_jobs_dedupe_pending
  ON public.scheduled_jobs(dedupe_key)
  WHERE dedupe_key IS NOT NULL AND status = 'pending';

-- La ruta de cron del agente pide solo sus jobs.
CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_type_pending
  ON public.scheduled_jobs(type, run_at)
  WHERE status = 'pending';

CREATE OR REPLACE FUNCTION public.push_debounced_job(
  p_type       text,
  p_dedupe_key text,
  p_payload    jsonb,
  p_run_at     timestamptz,
  p_deadline   timestamptz
)
RETURNS TABLE (job_id uuid, job_run_at timestamptz, created boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_attempt integer := 0;
BEGIN
  IF p_type IS NULL OR p_dedupe_key IS NULL OR p_run_at IS NULL THEN
    RAISE EXCEPTION 'push_debounced_job: type, dedupe_key y run_at son obligatorios';
  END IF;

  LOOP
    v_attempt := v_attempt + 1;

    RETURN QUERY
    INSERT INTO public.scheduled_jobs AS j (type, payload, run_at, dedupe_key)
    VALUES (
      p_type,
      COALESCE(p_payload, '{}'::jsonb) || jsonb_build_object('burst_deadline', p_deadline),
      LEAST(p_run_at, p_deadline),
      p_dedupe_key
    )
    ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status = 'pending'
    DO UPDATE SET
      run_at = GREATEST(
        j.run_at,
        LEAST(p_run_at, (j.payload->>'burst_deadline')::timestamptz)
      ),
      payload = j.payload || jsonb_build_object(
        'last_message_at', COALESCE(p_payload->'last_message_at', to_jsonb(now()))
      )
    WHERE j.status = 'pending'
    RETURNING j.id, j.run_at, (j.xmax = 0);

    IF FOUND THEN
      RETURN;
    END IF;

    IF v_attempt >= 3 THEN
      RAISE EXCEPTION 'push_debounced_job: no se pudo agendar % despues de % intentos', p_dedupe_key, v_attempt;
    END IF;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.push_debounced_job(text, text, jsonb, timestamptz, timestamptz) IS
  'Agenda o empuja hacia adelante un job reprogramable (ventana de silencio del agente). Atomica. El tope se congela en el primer mensaje de la rafaga. Solo service role.';

REVOKE ALL ON FUNCTION public.push_debounced_job(text, text, jsonb, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.push_debounced_job(text, text, jsonb, timestamptz, timestamptz) TO service_role;

-- ============================================================
-- MIGRATION 62: KNOWLEDGE SEARCH FILTERED
-- ============================================================
-- ============================================================================
-- 00062 — Busqueda semantica con el filtro de acceso adentro de la consulta
-- ============================================================================
-- Fase 3, Bloque 2a (F27). El agente accede a la base de conocimiento solo por
-- los tags que tenga habilitados, y nunca a un documento marcado internal_only.
--
-- El filtro va DENTRO del SQL y no despues de traer los fragmentos. Si se
-- filtrara en el codigo que consume la busqueda, el contenido prohibido ya
-- habria viajado hasta el proceso de la app: un bug, un log de mas o un cambio
-- de orden y termina en el prompt. Con el filtro en el WHERE, esas filas no
-- salen de la base.
--
-- Es una funcion NUEVA y no un cambio a match_knowledge_chunks (00049), que
-- queda intacta: la usan scripts/verify-knowledge.mjs y verify-rls.mjs. Los dos
-- parametros nuevos van SIN default a proposito: con defaults, una llamada de
-- cuatro argumentos quedaria ambigua entre las dos firmas si alguna vez se
-- unificaran los nombres.
--
-- Semantica de p_tags:
--   - NULL o vacio: toda la base de conocimiento (salvo lo interno).
--   - Con valores: documentos que tengan AL MENOS UNO de esos tags.
-- p_include_internal existe para el agente de gestion de la Etapa 3 (que opera
-- para el dueno y si puede leer lo interno). El agente de leads siempre pasa
-- false. Un Member que llame la funcion con true no gana nada: ya puede leer
-- knowledge_chunks por RLS (00049).
--
-- Idempotente.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.match_knowledge_chunks_filtered(
  p_workspace_id     uuid,
  p_query_embedding  extensions.vector(1024),
  p_match_count      integer,
  p_min_similarity   double precision,
  p_tags             text[],
  p_include_internal boolean
)
RETURNS TABLE (
  chunk_id       uuid,
  document_id    uuid,
  document_title text,
  chunk_index    integer,
  content        text,
  similarity     double precision
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
BEGIN
  IF p_workspace_id IS NULL THEN
    RAISE EXCEPTION 'workspace_id is required';
  END IF;

  -- Mismo chequeo que match_knowledge_chunks (ver el comentario de la 00049
  -- sobre por que va el coalesce).
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND NOT public.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'forbidden: not a member of this workspace';
  END IF;

  RETURN QUERY
  SELECT
    kc.id,
    kc.document_id,
    kb.title,
    kc.chunk_index,
    kc.content,
    (1 - (kc.embedding OPERATOR(extensions.<=>) p_query_embedding))::double precision
  FROM public.knowledge_chunks kc
  JOIN public.knowledge_base kb ON kb.id = kc.document_id
  WHERE kc.workspace_id = p_workspace_id
    AND kb.deleted_at IS NULL
    AND (COALESCE(p_include_internal, false) OR kb.internal_only = false)
    AND (p_tags IS NULL OR cardinality(p_tags) = 0 OR kb.tags && p_tags)
    AND (1 - (kc.embedding OPERATOR(extensions.<=>) p_query_embedding)) >= COALESCE(p_min_similarity, 0)
  ORDER BY kc.embedding OPERATOR(extensions.<=>) p_query_embedding
  LIMIT GREATEST(COALESCE(p_match_count, 8), 1);
END;
$$;

COMMENT ON FUNCTION public.match_knowledge_chunks_filtered(uuid, extensions.vector, integer, double precision, text[], boolean) IS
  'Busqueda semantica con el filtro de acceso del agente adentro de la consulta: tags permitidos (vacio = todos) y exclusion de documentos internal_only. El contenido excluido nunca sale de la base.';

REVOKE ALL ON FUNCTION public.match_knowledge_chunks_filtered(uuid, extensions.vector, integer, double precision, text[], boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_knowledge_chunks_filtered(uuid, extensions.vector, integer, double precision, text[], boolean) TO authenticated, service_role;

-- ============================================================
-- MIGRATION 63: AGENT BURSTS CRON
-- ============================================================
-- ============================================================================
-- 00063 — Cron del agente cada 15 segundos y purgas ajustadas al volumen nuevo
-- ============================================================================
-- Fase 3, Bloque 2a.
--
-- 1. Ruta de cron propia: /api/cron/agent-bursts.
--    El runner general (/api/cron/jobs) procesa 20 jobs por corrida y una tanda
--    de broadcasts podria demorar el turno del agente varios minutos. Separarlo
--    lo aisla de esa cola.
--
-- 2. Cada 15 segundos y no cada minuto. El envio apunta a un objetivo absoluto
--    (ultimo_mensaje + ventana + demora), y la demora absorbe el tic del cron y
--    el tiempo de generacion. Con un cron por minuto el tic mete hasta 60 s de
--    azar y la demora default no alcanza a taparlo; con 15 s, si. pg_cron 1.6.4
--    soporta intervalos sub-minuto ('15 seconds').
--    Son ~5.760 llamadas por dia que salen por la puerta de atras cuando no hay
--    turnos pendientes.
--
-- 3. Purgas. Ese volumen se acumula en dos lugares:
--    - net._http_response: la purga pasa de diaria con 3 dias de retencion a
--      CADA HORA con 1 dia. Pico entre purgas: ~12.000 filas en vez de ~47.000.
--    - cron.job_run_details: pg_cron anota cada ejecucion y hasta hoy nadie la
--      limpiaba. Con este cron sumaria 5.760 filas por dia para siempre. Se
--      purga una vez por dia con 3 dias de retencion.
--
-- Idempotente.
-- ============================================================================

-- ------------------------------------------------------------
-- 1. Lista blanca de rutas
-- ------------------------------------------------------------
-- Misma funcion de la 00036, con 'agent-bursts' agregado. Todo lo demas igual.

CREATE OR REPLACE FUNCTION private.call_app_cron(p_path text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_base   text;
  v_secret text;
BEGIN
  IF p_path NOT IN ('jobs', 'sequences', 'whatsapp-health', 'inactivity', 'automation-events', 'agent-bursts') THEN
    RAISE EXCEPTION 'ruta de cron no permitida: %', p_path;
  END IF;

  SELECT value INTO v_base   FROM private.system_config WHERE key = 'app_url';
  SELECT value INTO v_secret FROM private.system_config WHERE key = 'cron_secret';

  IF v_base IS NULL OR v_secret IS NULL THEN
    RAISE WARNING 'private.system_config sin app_url o cron_secret: el cron "%" no se ejecuto', p_path;
    RETURN NULL;
  END IF;

  RETURN net.http_get(
    url     => rtrim(v_base, '/') || '/api/cron/' || p_path,
    headers => jsonb_build_object(
                 'Authorization', 'Bearer ' || v_secret,
                 'Content-Type',  'application/json'
               ),
    timeout_milliseconds => 60000
  );
END;
$$;

REVOKE ALL ON FUNCTION private.call_app_cron(text) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 2. Limpieza de cron.job_run_details
-- ------------------------------------------------------------
-- Mismo patron defensivo que purge_pg_net_responses: la tabla es interna de
-- pg_cron, asi que si cambia de esquema la funcion avisa en vez de reventar.

CREATE OR REPLACE FUNCTION private.purge_cron_run_details(p_retention_days integer DEFAULT 3)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted integer := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_tables
    WHERE schemaname = 'cron' AND tablename = 'job_run_details'
  ) THEN
    RAISE WARNING 'cron.job_run_details no existe: pg_cron cambio de esquema, hay que revisar la limpieza';
    RETURN 0;
  END IF;

  EXECUTE 'DELETE FROM cron.job_run_details WHERE end_time < now() - make_interval(days => $1)'
  USING GREATEST(p_retention_days, 1);

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION private.purge_cron_run_details(integer) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION private.purge_cron_run_details(integer) IS
  'Borra el historial de ejecuciones de pg_cron de mas de N dias. Sin esto cron.job_run_details crece sin techo (el cron del agente corre cada 15 s).';

-- ------------------------------------------------------------
-- 3. Los schedules
-- ------------------------------------------------------------

DO $$
DECLARE
  v_job text;
BEGIN
  FOREACH v_job IN ARRAY ARRAY[
    'agent-bursts',
    'purge-pg-net',
    'purge-cron-runs'
  ] LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = v_job) THEN
      PERFORM cron.unschedule(v_job);
    END IF;
  END LOOP;
END;
$$;

SELECT cron.schedule(
  'agent-bursts',
  '15 seconds',
  $$SELECT private.call_app_cron('agent-bursts')$$
);

-- Cada hora al minuto 10, 1 dia de retencion (antes: 4:10 diario, 3 dias).
SELECT cron.schedule(
  'purge-pg-net',
  '10 * * * *',
  $$SELECT private.purge_pg_net_responses(1)$$
);

-- 5:20, despues de las purgas de mensajes (5:00) y de pasos del agente (5:10).
SELECT cron.schedule(
  'purge-cron-runs',
  '20 5 * * *',
  $$SELECT private.purge_cron_run_details(3)$$
);

-- ============================================================
-- MIGRATION 64: AI SPEND SUM
-- ============================================================
-- ============================================================================
-- 00064 — Suma del gasto de IA, en la base
-- ============================================================================
-- Fase 3, Bloque 2a (F25/F29). Los topes de gasto se evaluan ANTES de cada
-- llamada al modelo, sumando cost_usd sobre agent_runs desde el inicio del dia
-- o del mes en la zona del negocio.
--
-- La suma va en SQL y no en la app por un motivo concreto: PostgREST devuelve
-- como maximo 1.000 filas por consulta. Un mes con mas runs que eso sumado del
-- lado de la app da un total por debajo del real, y un tope que subestima el
-- gasto no protege nada. Con sum() el total es exacto y sale del indice
-- (workspace_id, created_at) o (agent_id, created_at) de la 00059.
--
-- Los runs con cost_usd NULL (modelo sin precio cargado) suman 0: no hay un
-- numero mejor, y la pantalla ya avisa que falta el precio.
--
-- Solo service role: el gasto es informacion de Owner/Admin y la evalua el
-- motor del agente, que corre sin usuario.
--
-- Idempotente.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sum_ai_spend(
  p_workspace_id uuid,
  p_since        timestamptz,
  p_agent_id     uuid DEFAULT NULL
)
RETURNS numeric
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE(SUM(r.cost_usd), 0)
  FROM public.agent_runs r
  WHERE r.workspace_id = p_workspace_id
    AND r.created_at >= p_since
    AND (p_agent_id IS NULL OR r.agent_id = p_agent_id);
$$;

COMMENT ON FUNCTION public.sum_ai_spend(uuid, timestamptz, uuid) IS
  'Gasto de IA en USD desde un instante: de todo el workspace o de un agente. Lo usan los topes de gasto antes de cada llamada. Solo service role.';

REVOKE ALL ON FUNCTION public.sum_ai_spend(uuid, timestamptz, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sum_ai_spend(uuid, timestamptz, uuid) TO service_role;

-- ============================================================
-- MIGRATION 65: AGENT RUNS SKIPPED STATUS
-- ============================================================
-- ============================================================================
-- 00065 — Resultado "skipped" para los runs del agente
-- ============================================================================
-- Fase 3, Bloque 2a. Toda abstencion del agente deja un run con su motivo,
-- y los cinco resultados del documento no cubrian uno muy comun: el agente no
-- actuo porque estaba apagado (global, por canal o en la conversacion), pausado
-- por un flow, o porque una persona tomo la conversacion mientras generaba.
--
-- Ninguno encaja: no es "se abstuvo por automatizacion" (no hubo automatizacion)
-- ni "bloqueado por guardarrail" (no bloqueo un limite). Meterlo en uno de esos
-- haria mentir el filtro de runs. El motivo puntual va en status_detail.
--
-- Idempotente: reemplaza el CHECK por nombre.
-- ============================================================================

ALTER TABLE public.agent_runs DROP CONSTRAINT IF EXISTS agent_runs_status_values;
ALTER TABLE public.agent_runs ADD CONSTRAINT agent_runs_status_values
  CHECK (status IN ('running', 'responded', 'escalated', 'skipped_automation',
                    'skipped', 'blocked_guardrail', 'completed', 'error'));

COMMENT ON COLUMN public.agent_runs.status IS
  'running | responded | escalated | skipped_automation | skipped | blocked_guardrail | completed | error. skipped = el agente no actuo por una palanca (apagado, canal, conversacion, pausa, una persona tomo la conversacion); el motivo va en status_detail.';

-- ============================================================
-- MIGRATION 66: CONVERSATIONS AGENT TRI STATE
-- ============================================================
-- ============================================================================
-- 00066 — El agente por conversacion pasa a tres estados, y la rafaga tiene
--         antiguedad maxima
-- ============================================================================
-- Fase 3, Bloque 2b.
--
-- 1. conversations.agent_enabled: de boolean NOT NULL DEFAULT false a
--    NULLABLE sin default.
--
--      NULL  = heredar del canal (el maestro de agents.enabled_channel_ids manda)
--      true  = forzado prendido en esta conversacion
--      false = forzado apagado (lo pone Human Takeover, una respuesta manual, o
--              una persona desde la bandeja)
--
--    Antes el default false obligaba a prender el agente conversacion por
--    conversacion, y un lead nuevo nunca lo tenia. Iba contra el objetivo del
--    sistema. Ahora el maestro del canal manda por defecto y la conversacion es
--    la excepcion explicita.
--
--    MIGRACION DE LAS FILAS EXISTENTES, UNA SOLA VEZ: todas las conversaciones
--    que hoy estan en false lo estan porque era el default, ninguna fue apagada
--    a proposito (verificado el 24/9/2026: 583 filas, todas false, 0 runs). Se
--    pasan todas a NULL. El bloque comprueba antes que la columna todavia sea
--    NOT NULL: si la migracion se vuelve a correr, la columna ya es nullable y
--    no toca nada, asi que un false puesto a proposito despues de hoy nunca se
--    pisa.
--
--    El dia que se prenda el maestro de Instagram, las 583 conversaciones
--    (y toda conversacion nueva) pasan a estar atendidas por el agente ante el
--    proximo mensaje entrante. No es retroactivo: nadie recibe nada por prender
--    el maestro.
--
-- 2. agents.burst_max_age_hours (default 6). La rafaga que responde un turno
--    son "los entrantes posteriores a la ultima salida". Con 137 conversaciones
--    sin una sola respuesta, eso seria el historial entero: si un lead escribe
--    hoy, el agente contestaria tambien la pregunta de hace tres semanas. Con
--    esto la rafaga descarta lo anterior a N horas. El contexto de la
--    conversacion sigue entrando por el historial de ~20 mensajes: esto decide
--    QUE se responde, no que se lee.
--
-- Idempotente.
-- ============================================================================

-- ------------------------------------------------------------
-- 1. conversations.agent_enabled: tres estados
-- ------------------------------------------------------------

DO $$
DECLARE
  v_was_not_null boolean;
BEGIN
  SELECT (is_nullable = 'NO') INTO v_was_not_null
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'conversations'
     AND column_name = 'agent_enabled';

  IF v_was_not_null THEN
    ALTER TABLE public.conversations ALTER COLUMN agent_enabled DROP DEFAULT;
    ALTER TABLE public.conversations ALTER COLUMN agent_enabled DROP NOT NULL;
    -- Solo en la primera corrida: todo false era el default, no una decision.
    UPDATE public.conversations SET agent_enabled = NULL WHERE agent_enabled = false;
  END IF;
END $$;

COMMENT ON COLUMN public.conversations.agent_enabled IS
  'Agente de IA en esta conversacion, tres estados. NULL = hereda del canal (el maestro de agents.enabled_channel_ids decide). true = forzado prendido. false = forzado apagado: lo pone Human Takeover, una respuesta manual del operador o una persona desde la bandeja. Ortogonal a is_automation_paused (flows) y a agent_paused_until (pausa de un flow).';

-- El indice parcial de la 00058 (WHERE agent_enabled) sigue valiendo: NULL no
-- entra, solo las forzadas prendidas.

-- ------------------------------------------------------------
-- 2. agents.burst_max_age_hours
-- ------------------------------------------------------------

ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS burst_max_age_hours integer NOT NULL DEFAULT 6;

COMMENT ON COLUMN public.agents.burst_max_age_hours IS
  'La rafaga que responde un turno ignora los entrantes mas viejos que esto (horas, contadas desde el instante del turno). Siguen en el contexto del prompt; solo no se responden.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agents_burst_max_age_range') THEN
    ALTER TABLE public.agents ADD CONSTRAINT agents_burst_max_age_range
      CHECK (burst_max_age_hours BETWEEN 1 AND 720);
  END IF;
END $$;

-- La 00060 revoco el SELECT de la tabla y lo otorgo por columnas: toda columna
-- nueva que la pantalla tenga que leer con el cliente del usuario va aca.
GRANT SELECT (burst_max_age_hours) ON public.agents TO authenticated;

-- ============================================================
-- MIGRATION 67: CONVERSATION CLOSING
-- ============================================================
-- ============================================================================
-- 00067 — Cierre de conversaciones, memoria acumulativa y clasificacion (F33, F34)
-- ============================================================================
-- Fase 3, Bloque 2b.
--
-- 1. agents: cuando se cierra sola una conversacion que atiende el agente
--    (horas de inactividad, default 12), y si al cierre genera el resumen
--    acumulativo del contacto y aplica la clasificacion (tags, temperatura,
--    seguimiento). Se agregan al GRANT de columnas de la 00060.
--
-- 2. conversations.closed_at: cuando se cerro (a mano o por el barrido).
--    conversations.summarized_at: hasta que instante estan resumidos sus
--    mensajes. Un cierre sin mensajes nuevos desde ahi no llama al modelo.
--
-- 3. Indice parcial para el barrido de inactividad: conversaciones abiertas
--    por canal y fecha del ultimo mensaje.
--
-- El barrido solo cierra conversaciones donde el agente esta activo Y ya
-- participo (tiene al menos un run): el backlog de conversaciones viejas queda
-- abierto y no dispara cientos de resumenes el dia que se prenda el maestro.
--
-- Idempotente.
-- ============================================================================

ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS close_after_inactive_hours integer NOT NULL DEFAULT 12,
  ADD COLUMN IF NOT EXISTS summary_on_close boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS classify_on_close boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.agents.close_after_inactive_hours IS
  'Horas sin mensajes tras las que el barrido cierra una conversacion que el agente atiende y en la que ya participo. Al cerrar, resumen y clasificacion segun las otras dos columnas.';
COMMENT ON COLUMN public.agents.summary_on_close IS
  'Si al cerrar una conversacion el agente genera el resumen acumulativo del contacto (contacts.ai_conversation_summary). Deja un run con source conversation_summary.';
COMMENT ON COLUMN public.agents.classify_on_close IS
  'Si al cerrar aplica tags, temperatura y proximo seguimiento, con las mismas reglas que sus herramientas.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agents_close_after_range') THEN
    ALTER TABLE public.agents ADD CONSTRAINT agents_close_after_range
      CHECK (close_after_inactive_hours BETWEEN 1 AND 720);
  END IF;
END $$;

GRANT SELECT (close_after_inactive_hours, summary_on_close, classify_on_close) ON public.agents TO authenticated;

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS summarized_at timestamptz;

COMMENT ON COLUMN public.conversations.closed_at IS
  'Cuando se cerro por ultima vez (a mano o por inactividad). Se conserva al reabrir.';
COMMENT ON COLUMN public.conversations.summarized_at IS
  'Hasta que instante estan incorporados sus mensajes al resumen del contacto. Un cierre sin mensajes posteriores no genera otro resumen.';

CREATE INDEX IF NOT EXISTS idx_conversations_open_by_last_message
  ON public.conversations(channel_id, last_message_at)
  WHERE status = 'open' AND deleted_at IS NULL;

-- ============================================================
-- MIGRATION 68: AUDIT LOG AGENT ACTIONS
-- ============================================================
-- ============================================================================
-- 00068 — La vista de Acciones del agente sobre audit_log (F28) y su reversion
-- ============================================================================
-- Fase 3, Bloque 2b. Sin tabla nueva: el audit_log ya es el registro canonico
-- de los efectos de negocio (antes/despues en `changes`, el agente como actor
-- en `performed_by_agent_id`). Lo que faltaba:
--
-- 1. Saber si una accion fue revertida: `reverted_at` y `reverted_by_audit_id`
--    (la entrada `revert` que la deshizo, con quien y cuando). Las marca el
--    service role desde la Server Action, despues de aplicar el inverso con el
--    cliente del usuario: audit_log sigue sin policy de UPDATE, y asi un
--    usuario no puede "desmarcar" una reversion ni marcar una que no hizo.
--
-- 2. Que un Member VEA las acciones del agente sobre sus leads. La policy de
--    la 00023 le deja ver solo sus propias filas (performed_by = auth.uid()), y
--    las del agente tienen performed_by NULL: la pestana Acciones le quedaba
--    vacia. Se suma una rama: filas con performed_by_agent_id sobre un contacto
--    o una conversacion que el Member puede ver. El EXISTS pasa por la RLS de
--    contacts / conversations y arrastra el scope de leads gratis (mismo truco
--    que agent_runs en la 00060 y messages en la 00054).
--
-- 3. Indices para los filtros de la pestana: tipo de accion (el principal),
--    reversion, y canal / contacto / conversacion via metadata (GIN parcial
--    sobre las filas del agente, que son las unicas que se consultan asi).
--
-- Idempotente.
-- ============================================================================

ALTER TABLE public.audit_log
  ADD COLUMN IF NOT EXISTS reverted_at timestamptz,
  ADD COLUMN IF NOT EXISTS reverted_by_audit_id uuid REFERENCES public.audit_log(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.audit_log.reverted_at IS
  'Cuando una persona revirtio esta accion del agente desde la pestana Acciones. La reversion es a su vez una entrada (action = revert).';
COMMENT ON COLUMN public.audit_log.reverted_by_audit_id IS
  'La entrada revert que deshizo esta accion (quien y cuando).';

DROP POLICY IF EXISTS "audit_log_select" ON public.audit_log;
CREATE POLICY "audit_log_select" ON public.audit_log
  FOR SELECT USING (
    public.is_workspace_admin(workspace_id)
    OR (public.is_workspace_member(workspace_id) AND performed_by = auth.uid())
    OR (
      public.is_workspace_member(workspace_id)
      AND performed_by_agent_id IS NOT NULL
      AND (
        (entity_type = 'contact' AND EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = audit_log.entity_id))
        OR (entity_type = 'conversation' AND EXISTS (SELECT 1 FROM public.conversations cv WHERE cv.id = audit_log.entity_id))
      )
    )
  );

-- Sin UPDATE ni DELETE para authenticated, como siempre. Las marcas de
-- reversion las escribe el service role.
DROP POLICY IF EXISTS "audit_log_update" ON public.audit_log;
DROP POLICY IF EXISTS "audit_log_delete" ON public.audit_log;
REVOKE UPDATE, DELETE ON TABLE public.audit_log FROM authenticated;

CREATE INDEX IF NOT EXISTS idx_audit_log_agent_action
  ON public.audit_log(workspace_id, action, performed_at DESC)
  WHERE performed_by_agent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_log_agent_reverted
  ON public.audit_log(workspace_id, reverted_at, performed_at DESC)
  WHERE performed_by_agent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_log_agent_metadata
  ON public.audit_log USING gin(metadata jsonb_path_ops)
  WHERE performed_by_agent_id IS NOT NULL;

-- ============================================================
-- MIGRATION 69: AI COST REPORT
-- ============================================================
-- ============================================================================
-- 00069 — Agregados de costo de IA para la pestana Costos (F29)
-- ============================================================================
-- Fase 3, Bloque 2b. Totales, promedios, desglose por fuente / agente / modelo
-- y top 10 de conversaciones mas caras de un periodo, en UNA consulta.
--
-- Va en SQL y no en la app por el mismo motivo que sum_ai_spend (00064):
-- PostgREST devuelve como maximo 1.000 filas y un mes con mas runs sumado del
-- lado de la app da un total por debajo del real. Y porque GROUP BY con
-- PostgREST no existe: sin esto serian seis consultas y un LIMIT por
-- conversacion imposible de expresar.
--
-- Solo service role: los costos son de Owner/Admin y se leen del servidor
-- detras de requireWorkspaceAdmin(), como quedo en la 00060.
--
-- Los runs con cost_usd NULL (modelo sin precio) suman 0 y se cuentan aparte
-- en missing_pricing para que la pantalla lo avise. Los runs `running` no
-- entran: no tienen costo todavia.
--
-- Idempotente.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ai_cost_report(
  p_workspace_id uuid,
  p_from         timestamptz,
  p_to           timestamptz
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  WITH r AS (
    SELECT *
    FROM public.agent_runs
    WHERE workspace_id = p_workspace_id
      AND created_at >= p_from
      AND created_at < p_to
      AND status <> 'running'
  )
  SELECT jsonb_build_object(
    'totals', (
      SELECT jsonb_build_object(
        'runs',             count(*),
        'cost_usd',         COALESCE(sum(cost_usd), 0),
        'conversations',    count(DISTINCT conversation_id),
        'escalations',      count(*) FILTER (WHERE status = 'escalated'),
        'responded',        count(*) FILTER (WHERE status = 'responded'),
        'missing_pricing',  count(*) FILTER (WHERE cost_usd IS NULL AND (COALESCE(input_tokens, 0) > 0 OR COALESCE(embedding_tokens, 0) > 0)),
        'input_tokens',     COALESCE(sum(input_tokens), 0),
        'output_tokens',    COALESCE(sum(output_tokens), 0),
        'cached_tokens',    COALESCE(sum(cached_tokens), 0),
        'embedding_tokens', COALESCE(sum(embedding_tokens), 0)
      )
      FROM r
    ),
    'by_source', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('source', source, 'runs', n, 'cost_usd', c) ORDER BY c DESC, n DESC), '[]'::jsonb)
      FROM (SELECT source, count(*) AS n, COALESCE(sum(cost_usd), 0) AS c FROM r GROUP BY source) s
    ),
    'by_agent', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('agent_id', agent_id, 'runs', n, 'cost_usd', c) ORDER BY c DESC, n DESC), '[]'::jsonb)
      FROM (SELECT agent_id, count(*) AS n, COALESCE(sum(cost_usd), 0) AS c FROM r GROUP BY agent_id) a
    ),
    'by_model', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'provider', provider, 'model', model, 'runs', n, 'cost_usd', c,
        'input_tokens', i, 'output_tokens', o, 'missing_pricing', m
      ) ORDER BY c DESC, n DESC), '[]'::jsonb)
      FROM (
        SELECT provider, model, count(*) AS n, COALESCE(sum(cost_usd), 0) AS c,
               COALESCE(sum(input_tokens), 0) AS i, COALESCE(sum(output_tokens), 0) AS o,
               count(*) FILTER (WHERE cost_usd IS NULL AND COALESCE(input_tokens, 0) > 0) AS m
        FROM r
        WHERE model IS NOT NULL
        GROUP BY provider, model
      ) mo
    ),
    'top_conversations', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('conversation_id', conversation_id, 'contact_id', contact_id, 'runs', n, 'cost_usd', c) ORDER BY c DESC, n DESC), '[]'::jsonb)
      FROM (
        SELECT conversation_id, max(contact_id::text)::uuid AS contact_id, count(*) AS n, COALESCE(sum(cost_usd), 0) AS c
        FROM r
        WHERE conversation_id IS NOT NULL
        GROUP BY conversation_id
        ORDER BY c DESC, n DESC
        LIMIT 10
      ) t
    )
  );
$$;

COMMENT ON FUNCTION public.ai_cost_report(uuid, timestamptz, timestamptz) IS
  'Agregados de costo de IA de un periodo para la pestana Costos: totales, por fuente, por agente, por modelo y top 10 de conversaciones. Solo service role.';

REVOKE ALL ON FUNCTION public.ai_cost_report(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_cost_report(uuid, timestamptz, timestamptz) TO service_role;

-- ============================================================
-- MIGRATION 70: AGENT DRAFTS
-- ============================================================
-- ============================================================================
-- 00070 — Modo borrador del agente (Bloque 2c)
-- ============================================================================
-- Fase 3, Bloque 2c. Cuando un canal esta en modo borrador, el turno del agente
-- termina guardando la respuesta en agent_drafts en vez de enviarla. Una
-- persona la revisa en la cola y decide: enviar, editar y enviar, regenerar o
-- descartar.
--
-- Por que una tabla aparte y no un mensaje con estado "borrador": una fila en
-- messages la contarian los dashboards como enviada, el contexto del agente la
-- leeria como algo que dijo, y extractBurst la tomaria como la salida que
-- cierra la rafaga (si despues se descarta, esos entrantes no se vuelven a
-- responder nunca).
--
--  1. agents.channel_modes: el modo por canal (send | draft). Sin entrada =
--     send, asi que esta migracion no cambia el comportamiento de nada.
--  2. agents.max_replies_per_conversation pasa a aceptar NULL = sin tope, y ese
--     es el default. La columna y el guardarrail quedan: volver a tener tope es
--     escribir un numero.
--  3. agent_runs: estado nuevo 'drafted', y los dos instantes que miden el
--     tiempo de respuesta en los dos modos (inbound_at, responded_at).
--  4. channels.messaging_window_hours: la ventana de mensajeria del canal.
--  5. contacts.ai_summary_updated_at: cuando se actualizo la memoria.
--  6. agent_drafts, con su RLS, indices y Realtime.
--  7. messaging_window_hours(): la misma regla que lib/messaging-window.ts.
--  8. El barrido de borradores cada 5 minutos (envios colgados y ventanas
--     perdidas) y la retencion de 12 meses del texto.
--  9. push_debounced_job con claves volatiles.
--
-- Idempotente.
-- ============================================================================

-- ------------------------------------------------------------
-- 1. agents.channel_modes
-- ------------------------------------------------------------

ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS channel_modes jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.agents.channel_modes IS
  'Modo del agente por canal: { channel_id: "send" | "draft" }. Sin entrada = send (envia directo). En draft el turno deja un borrador en agent_drafts y no envia nada. Solo tiene sentido para canales que estan en enabled_channel_ids.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agents_channel_modes_object') THEN
    ALTER TABLE public.agents ADD CONSTRAINT agents_channel_modes_object
      CHECK (jsonb_typeof(channel_modes) = 'object');
  END IF;
END $$;

-- Regla de la 00060: toda columna de agents que lea la pantalla va al GRANT.
GRANT SELECT (channel_modes) ON public.agents TO authenticated;

-- ------------------------------------------------------------
-- 2. Tope de respuestas por conversacion: vacio = sin tope
-- ------------------------------------------------------------
-- Lo que protegia contra un agente en loop ya lo cubren los topes de gasto y
-- la regla de escalamiento (N turnos sin resolver -> deriva).

ALTER TABLE public.agents ALTER COLUMN max_replies_per_conversation DROP NOT NULL;
ALTER TABLE public.agents ALTER COLUMN max_replies_per_conversation DROP DEFAULT;

ALTER TABLE public.agents DROP CONSTRAINT IF EXISTS agents_windows_range;
ALTER TABLE public.agents ADD CONSTRAINT agents_windows_range
  CHECK (
    bundle_window_seconds BETWEEN 15 AND 3600
    AND (max_wait_seconds IS NULL OR max_wait_seconds >= bundle_window_seconds)
    AND (max_replies_per_conversation IS NULL OR max_replies_per_conversation BETWEEN 1 AND 500)
  );

-- Los agentes que todavia tienen el default viejo (12) nunca lo configuro
-- nadie: pasan a sin tope, que es el default nuevo. Un numero distinto de 12
-- lo puso una persona y se respeta.
UPDATE public.agents
SET max_replies_per_conversation = NULL
WHERE max_replies_per_conversation = 12;

COMMENT ON COLUMN public.agents.max_replies_per_conversation IS
  'Tope de respuestas del agente por conversacion desde la ultima intervencion humana. NULL = sin tope (default desde la 00070). El guardarrail solo actua con un numero cargado.';

-- ------------------------------------------------------------
-- 3. agent_runs: 'drafted' y los instantes de la respuesta
-- ------------------------------------------------------------

ALTER TABLE public.agent_runs DROP CONSTRAINT IF EXISTS agent_runs_status_values;
ALTER TABLE public.agent_runs ADD CONSTRAINT agent_runs_status_values
  CHECK (status IN ('running', 'responded', 'escalated', 'skipped_automation',
                    'skipped', 'blocked_guardrail', 'completed', 'error', 'drafted'));

ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS inbound_at timestamptz,
  ADD COLUMN IF NOT EXISTS responded_at timestamptz;

COMMENT ON COLUMN public.agent_runs.inbound_at IS
  'El ULTIMO mensaje entrante de la rafaga que responde este turno. Se congela al abrir el run. Existe en los dos modos, asi que permite comparar envio directo contra borrador con el mismo numero.';
COMMENT ON COLUMN public.agent_runs.responded_at IS
  'Cuando salio la respuesta de verdad. Envio directo: segundos despues del turno. Borrador: cuando alguien lo aprobo. NULL mientras no salio.';

CREATE INDEX IF NOT EXISTS idx_agent_runs_response_time
  ON public.agent_runs(workspace_id, inbound_at)
  WHERE responded_at IS NOT NULL;

GRANT SELECT (inbound_at, responded_at) ON public.agent_runs TO authenticated;

-- ------------------------------------------------------------
-- 4. channels.messaging_window_hours
-- ------------------------------------------------------------

ALTER TABLE public.channels
  ADD COLUMN IF NOT EXISTS messaging_window_hours integer;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'channels_messaging_window_range') THEN
    ALTER TABLE public.channels ADD CONSTRAINT channels_messaging_window_range
      CHECK (messaging_window_hours IS NULL OR messaging_window_hours BETWEEN 0 AND 168);
  END IF;
END $$;

COMMENT ON COLUMN public.channels.messaging_window_hours IS
  'Horas desde el ultimo mensaje del lead en las que la plataforma deja responder. NULL = default por plataforma (Instagram y Facebook: 24, lo que documenta Meta; el resto: sin ventana). 0 = sin ventana (WhatsApp por Evolution).';

-- ------------------------------------------------------------
-- 5. contacts.ai_summary_updated_at
-- ------------------------------------------------------------

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS ai_summary_updated_at timestamptz;

COMMENT ON COLUMN public.contacts.ai_summary_updated_at IS
  'Cuando se actualizo por ultima vez ai_conversation_summary (la memoria del agente). NULL en las memorias anteriores a la 00070.';

-- ------------------------------------------------------------
-- 6. agent_drafts
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.agent_drafts (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id             uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  agent_id                 uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  conversation_id          uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  contact_id               uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  channel_id               uuid NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  run_id                   uuid REFERENCES public.agent_runs(id) ON DELETE SET NULL,
  status                   text NOT NULL DEFAULT 'pending',
  body                     text,
  body_parts               jsonb,
  no_reply_reason          text,
  suggested_actions        jsonb NOT NULL DEFAULT '[]'::jsonb,
  applied_actions          jsonb NOT NULL DEFAULT '[]'::jsonb,
  burst_message_ids        uuid[] NOT NULL DEFAULT '{}',
  burst_started_at         timestamptz,
  burst_last_inbound_at    timestamptz,
  sendable_until           timestamptz,
  alerted_thresholds       smallint[] NOT NULL DEFAULT '{}',
  window_missed_at         timestamptz,
  missed_while_assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sent_body                text,
  send_error               text,
  sent_message_id          uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  discard_reason           text,
  regenerate_instruction   text,
  previous_draft_id        uuid REFERENCES public.agent_drafts(id) ON DELETE SET NULL,
  decided_at               timestamptz,
  decided_by               uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.agent_drafts IS
  'Respuestas del agente que esperan aprobacion humana (modo borrador, Bloque 2c). No son mensajes: nada de aca se envia ni cuenta como salida hasta que una persona lo aprueba.';
COMMENT ON COLUMN public.agent_drafts.status IS
  'pending: espera decision. sending: saliendo en este instante (lo toma quien aprueba). sent: salio. failed: el envio fallo, se puede reintentar. discarded: alguien lo descarto, o hubo una respuesta real por otro lado. superseded: el lead escribio antes de que se aprobara. regenerated: alguien pidio otra version.';
COMMENT ON COLUMN public.agent_drafts.body IS
  'Texto propuesto. NULL = "necesita respuesta humana" (el agente sugirio derivar o lo freno un guardarrail); el motivo esta en no_reply_reason.';
COMMENT ON COLUMN public.agent_drafts.no_reply_reason IS
  'Por que no hay texto: escalate, guardrail:<cual> o error:<cual>.';
COMMENT ON COLUMN public.agent_drafts.suggested_actions IS
  'Acciones que el agente sugirio y NO ejecuto (derivar, pausarse). Se aplican si la persona aprueba.';
COMMENT ON COLUMN public.agent_drafts.applied_actions IS
  'Acciones que el agente YA aplico en ese turno (etiquetas, temperatura, seguimiento...), para mostrarlas en la cola. Se revierten desde la pestana Acciones.';
COMMENT ON COLUMN public.agent_drafts.burst_last_inbound_at IS
  'El ultimo mensaje del lead que responde. La ventana de mensajeria se cuenta desde aca.';
COMMENT ON COLUMN public.agent_drafts.sendable_until IS
  'Hasta cuando se puede enviar (burst_last_inbound_at + ventana del canal). NULL = el canal no tiene ventana. "No enviable" es un calculo sobre esto, no un estado.';
COMMENT ON COLUMN public.agent_drafts.alerted_thresholds IS
  'Que cortes de la ventana ya se avisaron, como denominadores: 2 = mitad, 4 = cuarto, 8 = octavo. Sobrevive a un cambio de messaging_window_hours.';
COMMENT ON COLUMN public.agent_drafts.window_missed_at IS
  'Cuando la ventana cerro con el borrador todavia sin enviar. El estado NO cambia: sin vencimiento quiere decir que nada se autovence.';
COMMENT ON COLUMN public.agent_drafts.missed_while_assigned_to IS
  'De quien era el borrador cuando se perdio la ventana (setter del contacto, o vendedor). Congelado: una reasignacion posterior no reescribe la historia.';
COMMENT ON COLUMN public.agent_drafts.sent_body IS
  'Lo que se envio realmente. Distinto de body si se edito: esa diferencia es la metrica de calidad.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_drafts_status_values') THEN
    ALTER TABLE public.agent_drafts ADD CONSTRAINT agent_drafts_status_values
      CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'discarded', 'superseded', 'regenerated'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_drafts_sent_has_body') THEN
    ALTER TABLE public.agent_drafts ADD CONSTRAINT agent_drafts_sent_has_body
      CHECK (status <> 'sent' OR sent_body IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_drafts_empty_has_reason') THEN
    ALTER TABLE public.agent_drafts ADD CONSTRAINT agent_drafts_empty_has_reason
      CHECK (body IS NOT NULL OR no_reply_reason IS NOT NULL);
  END IF;
END $$;

-- Un solo borrador vivo por conversacion, garantizado por la base y no solo
-- por codigo. failed es vivo: tiene "Reintentar" en la cola.
CREATE UNIQUE INDEX IF NOT EXISTS agent_drafts_one_open_per_conversation
  ON public.agent_drafts(conversation_id)
  WHERE status IN ('pending', 'sending', 'failed');

-- La cola. No cubre la expresion (sendable_until < now()) con la que empieza
-- el ORDER BY: a este volumen no importa.
CREATE INDEX IF NOT EXISTS idx_agent_drafts_queue
  ON public.agent_drafts(workspace_id, status, sendable_until NULLS LAST, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_drafts_run ON public.agent_drafts(run_id) WHERE run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_drafts_contact ON public.agent_drafts(contact_id);
CREATE INDEX IF NOT EXISTS idx_agent_drafts_conversation ON public.agent_drafts(conversation_id, status);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_agent_drafts') THEN
    CREATE TRIGGER set_updated_at_agent_drafts
      BEFORE UPDATE ON public.agent_drafts
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
  END IF;
END $$;

-- RLS. Mismo patron que agent_runs (00060): el EXISTS sobre conversations pasa
-- por la RLS de conversations y arrastra el scope de leads sin nombrarlo. Un
-- Member ve y decide solo los borradores de sus leads.
ALTER TABLE public.agent_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_drafts_select" ON public.agent_drafts;
CREATE POLICY "agent_drafts_select" ON public.agent_drafts
  FOR SELECT USING (
    public.is_workspace_admin(workspace_id)
    OR (
      public.is_workspace_member(workspace_id)
      AND EXISTS (
        SELECT 1 FROM public.conversations conv
        WHERE conv.id = agent_drafts.conversation_id
      )
    )
  );

-- UPDATE: una persona solo puede TOMAR un borrador vivo para enviarlo, o
-- descartarlo, o pedir otra version, siempre a su nombre. Marcar 'sent' o
-- 'failed' lo hace el service role despues de enviar de verdad; resucitar un
-- borrador terminado no se puede (el USING solo deja tocar filas vivas).
DROP POLICY IF EXISTS "agent_drafts_update" ON public.agent_drafts;
CREATE POLICY "agent_drafts_update" ON public.agent_drafts
  FOR UPDATE
  USING (
    status IN ('pending', 'failed')
    AND (
      public.is_workspace_admin(workspace_id)
      OR (
        public.is_workspace_member(workspace_id)
        AND EXISTS (
          SELECT 1 FROM public.conversations conv
          WHERE conv.id = agent_drafts.conversation_id
        )
      )
    )
  )
  WITH CHECK (
    status IN ('sending', 'discarded', 'regenerated')
    AND decided_by = auth.uid()
  );

-- Sin INSERT ni DELETE: los borradores los escribe el agente (service role).
DROP POLICY IF EXISTS "agent_drafts_insert" ON public.agent_drafts;
DROP POLICY IF EXISTS "agent_drafts_delete" ON public.agent_drafts;

REVOKE ALL ON TABLE public.agent_drafts FROM anon, authenticated;
GRANT SELECT ON public.agent_drafts TO authenticated;
GRANT UPDATE (status, decided_at, decided_by, sent_body, discard_reason, regenerate_instruction, updated_at)
  ON public.agent_drafts TO authenticated;

-- Realtime: la cola y la conversacion se actualizan solas. Filtra por la
-- policy de SELECT de cada suscriptor.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'agent_drafts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_drafts;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 7. messaging_window_hours()
-- ------------------------------------------------------------
-- La misma regla que lib/messaging-window.ts. Si cambia una, cambia la otra.

CREATE OR REPLACE FUNCTION public.messaging_window_hours(p_platform text, p_configured integer)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_configured IS NOT NULL THEN p_configured
    WHEN p_platform IN ('instagram', 'facebook') THEN 24
    ELSE 0
  END;
$$;

COMMENT ON FUNCTION public.messaging_window_hours(text, integer) IS
  'Ventana de mensajeria de un canal en horas: la configurada, o 24 para Instagram/Facebook, o 0 (sin ventana). Espejo de lib/messaging-window.ts.';

REVOKE ALL ON FUNCTION public.messaging_window_hours(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.messaging_window_hours(text, integer) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 8a. El barrido de borradores (cada 5 minutos)
-- ------------------------------------------------------------
-- Dos cosas, las dos sobre un punado de filas (solo borradores vivos):
--
--   - Un envio colgado: un borrador en 'sending' hace mas de 5 minutos es un
--     proceso que murio a mitad del envio. Pasa a 'failed' para que se pueda
--     reintentar y deje de bloquear la conversacion (mientras hay un 'sending'
--     el agente no puede dejar otro borrador ahi).
--   - Una ventana perdida: la ventana cerro con el borrador sin enviar. Se
--     anota cuando y de quien era en ese momento. El estado no cambia.
--
-- Va en un cron lento y no en el de 15 segundos del agente: es algo que casi
-- nunca pasa. Los avisos a las personas (00072) son otro job.

CREATE OR REPLACE FUNCTION private.sweep_agent_drafts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_failed integer := 0;
  v_missed integer := 0;
BEGIN
  UPDATE public.agent_drafts
  SET status = 'failed',
      send_error = 'send_timeout'
  WHERE status = 'sending'
    AND updated_at < now() - interval '5 minutes';
  GET DIAGNOSTICS v_failed = ROW_COUNT;

  UPDATE public.agent_drafts d
  SET window_missed_at = now(),
      missed_while_assigned_to = (
        SELECT COALESCE(c.setter_id, c.vendedor_id)
        FROM public.contacts c
        WHERE c.id = d.contact_id
      )
  WHERE d.status IN ('pending', 'failed')
    AND d.sendable_until IS NOT NULL
    AND d.sendable_until < now()
    AND d.window_missed_at IS NULL;
  GET DIAGNOSTICS v_missed = ROW_COUNT;

  RETURN jsonb_build_object('sending_failed', v_failed, 'windows_missed', v_missed);
END;
$$;

COMMENT ON FUNCTION private.sweep_agent_drafts() IS
  'Barrido de borradores cada 5 minutos: envios colgados pasan a failed, ventanas cerradas sin envio quedan anotadas (window_missed_at, missed_while_assigned_to). No cambia el estado de un pendiente.';

REVOKE ALL ON FUNCTION private.sweep_agent_drafts() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 8b. Retencion: el texto sigue la politica de los mensajes (12 meses)
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.purge_agent_draft_content(p_retention_months integer DEFAULT 12)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  UPDATE public.agent_drafts
  SET body = NULL,
      body_parts = NULL,
      sent_body = CASE WHEN status = 'sent' THEN '' ELSE NULL END,
      no_reply_reason = COALESCE(no_reply_reason, 'purged')
  WHERE status IN ('sent', 'discarded', 'superseded', 'regenerated')
    AND created_at < now() - make_interval(months => GREATEST(p_retention_months, 1))
    AND (body IS NOT NULL OR body_parts IS NOT NULL OR (sent_body IS NOT NULL AND sent_body <> ''));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.purge_agent_draft_content(integer) IS
  'Vacia el texto de los borradores terminados de mas de N meses (default 12), la misma politica que el contenido de messages. La fila queda para las metricas.';

REVOKE ALL ON FUNCTION public.purge_agent_draft_content(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_agent_draft_content(integer) TO service_role;

-- 8c. Los schedules. Cada 5 minutos el barrido; 5:30 la retencion (el primer
-- hueco libre despues de las purgas de 5:00, 5:10 y 5:20).
DO $$
DECLARE
  v_job text;
BEGIN
  FOREACH v_job IN ARRAY ARRAY['agent-drafts-sweep', 'purge-agent-drafts'] LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = v_job) THEN
      PERFORM cron.unschedule(v_job);
    END IF;
  END LOOP;
END $$;

SELECT cron.schedule(
  'agent-drafts-sweep',
  '*/5 * * * *',
  $$SELECT private.sweep_agent_drafts()$$
);

SELECT cron.schedule(
  'purge-agent-drafts',
  '30 5 * * *',
  $$SELECT public.purge_agent_draft_content(12)$$
);

-- ------------------------------------------------------------
-- 9. push_debounced_job con claves volatiles
-- ------------------------------------------------------------
-- Un conflicto sobre la clave de un job reprogramable quiere decir que dos
-- disparadores se fusionaron en un solo turno. Algunas claves del payload
-- solo valen para el disparador que las trajo: si se fusiona con otro, dejan
-- de valer. p_volatile_keys son esas claves, y en un conflicto se descartan
-- del payload resultante VENGAN DE DONDE VENGAN (del existente o del que
-- entra).
--
-- El caso que lo motiva (Bloque 2c): regenerar un borrador con una instruccion
-- ("mas corto", "no menciones el precio"). Si el lead escribe mientras la
-- regeneracion espera, la instruccion era sobre un borrador que ya quedo viejo:
-- se descarta (regenerate_instruction es volatil) y se conserva la cadena
-- (regenerate_of no lo es). La funcion no sabe nada de borradores: quien
-- agenda dice que es volatil.
--
-- La firma de cinco parametros se conserva y delega con la lista vacia: las
-- llamadas existentes no cambian.

CREATE OR REPLACE FUNCTION public.push_debounced_job(
  p_type          text,
  p_dedupe_key    text,
  p_payload       jsonb,
  p_run_at        timestamptz,
  p_deadline      timestamptz,
  p_volatile_keys text[]
)
RETURNS TABLE (job_id uuid, job_run_at timestamptz, created boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_attempt  integer := 0;
  v_volatile text[] := COALESCE(p_volatile_keys, '{}');
BEGIN
  IF p_type IS NULL OR p_dedupe_key IS NULL OR p_run_at IS NULL THEN
    RAISE EXCEPTION 'push_debounced_job: type, dedupe_key y run_at son obligatorios';
  END IF;

  LOOP
    v_attempt := v_attempt + 1;

    RETURN QUERY
    INSERT INTO public.scheduled_jobs AS j (type, payload, run_at, dedupe_key)
    VALUES (
      p_type,
      COALESCE(p_payload, '{}'::jsonb) || jsonb_build_object('burst_deadline', p_deadline),
      LEAST(p_run_at, p_deadline),
      p_dedupe_key
    )
    ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status = 'pending'
    DO UPDATE SET
      run_at = GREATEST(
        j.run_at,
        LEAST(p_run_at, (j.payload->>'burst_deadline')::timestamptz)
      ),
      payload = (
        j.payload || jsonb_build_object(
          'last_message_at', COALESCE(p_payload->'last_message_at', to_jsonb(now()))
        )
      ) - v_volatile
    WHERE j.status = 'pending'
    RETURNING j.id, j.run_at, (j.xmax = 0);

    IF FOUND THEN
      RETURN;
    END IF;

    IF v_attempt >= 3 THEN
      RAISE EXCEPTION 'push_debounced_job: no se pudo agendar % despues de % intentos', p_dedupe_key, v_attempt;
    END IF;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.push_debounced_job(text, text, jsonb, timestamptz, timestamptz, text[]) IS
  'Agenda o empuja hacia adelante un job reprogramable. En un conflicto (dos disparadores fusionados) descarta del payload las claves de p_volatile_keys, vengan del job existente o del que entra. Solo service role.';

REVOKE ALL ON FUNCTION public.push_debounced_job(text, text, jsonb, timestamptz, timestamptz, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.push_debounced_job(text, text, jsonb, timestamptz, timestamptz, text[]) TO service_role;

CREATE OR REPLACE FUNCTION public.push_debounced_job(
  p_type       text,
  p_dedupe_key text,
  p_payload    jsonb,
  p_run_at     timestamptz,
  p_deadline   timestamptz
)
RETURNS TABLE (job_id uuid, job_run_at timestamptz, created boolean)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT * FROM public.push_debounced_job(p_type, p_dedupe_key, p_payload, p_run_at, p_deadline, '{}'::text[]);
$$;

COMMENT ON FUNCTION public.push_debounced_job(text, text, jsonb, timestamptz, timestamptz) IS
  'Firma original (00061): delega en la de seis parametros sin claves volatiles. Solo service role.';

REVOKE ALL ON FUNCTION public.push_debounced_job(text, text, jsonb, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.push_debounced_job(text, text, jsonb, timestamptz, timestamptz) TO service_role;

-- ============================================================
-- MIGRATION 71: DRAFT METRICS
-- ============================================================
-- ============================================================================
-- 00071 — Metricas del modo borrador (Bloque 2c)
-- ============================================================================
-- Fase 3, Bloque 2c.
--
-- 1. ai_cost_report suma lo que cuestan los borradores: cuantos turnos
--    terminaron en borrador, cuanto se gasto en los que se descartaron (lo que
--    cuesta la desconfianza) y cuantos se enviaron sin editar (el dato que dice
--    cuando pasar a envio directo). Sigue siendo solo service role: son costos.
--
-- 2. draft_queue_metrics: la franja de la cola (tiempos de respuesta, ventanas
--    perdidas, aprobados sin editar). NO es de costos: es operacion, y la puede
--    pedir cualquiera del workspace. Por eso NO sigue el patron de
--    ai_cost_report (solo service role, con el workspace de parametro y la
--    garantia en TypeScript): se llama con el cliente del usuario y se defiende
--    sola, como match_knowledge_chunks_filtered (00062). Un Member siempre
--    recibe SUS numeros, pase el id que pase.
--
-- 3. draft_queue_metrics_by_person: el desglose por persona. Solo Owner/Admin,
--    chequeado adentro.
--
-- Los tres tiempos son tres cosas distintas y se calculan por separado:
--   - del agente:     completed_at - inbound_at. Incluye la espera de la
--                     rafaga (30 s de ventana + 8 de generacion = 38 s).
--   - de aprobacion:  responded_at - completed_at, SOLO sobre runs que dejaron
--                     borrador. Sobre todos, los de envio directo (~0) la
--                     hundirian y se leeria como una mejora que no existio.
--   - de respuesta:   responded_at - inbound_at. Lo unico que percibe el lead,
--                     contado desde su ULTIMO mensaje.
--
-- De quien es un borrador: del setter del contacto; sin setter, del vendedor;
-- sin ninguno, "sin asignar". Se resuelve por join, no hay campo en el
-- borrador (una reasignacion lo moveria sin desincronizar nada).
--
-- Idempotente.
-- ============================================================================

-- ------------------------------------------------------------
-- 1. ai_cost_report con los borradores
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ai_cost_report(
  p_workspace_id uuid,
  p_from         timestamptz,
  p_to           timestamptz
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  WITH r AS (
    SELECT *
    FROM public.agent_runs
    WHERE workspace_id = p_workspace_id
      AND created_at >= p_from
      AND created_at < p_to
      AND status <> 'running'
  ),
  rd AS (
    SELECT r.id, r.cost_usd, d.status AS draft_status, d.body, d.sent_body
    FROM r
    JOIN public.agent_drafts d ON d.run_id = r.id
  )
  SELECT jsonb_build_object(
    'totals', (
      SELECT jsonb_build_object(
        'runs',             count(*),
        'cost_usd',         COALESCE(sum(cost_usd), 0),
        'conversations',    count(DISTINCT conversation_id),
        'escalations',      count(*) FILTER (WHERE status = 'escalated'),
        'responded',        count(*) FILTER (WHERE status = 'responded'),
        'drafted',          count(*) FILTER (WHERE status = 'drafted'),
        'missing_pricing',  count(*) FILTER (WHERE cost_usd IS NULL AND (COALESCE(input_tokens, 0) > 0 OR COALESCE(embedding_tokens, 0) > 0)),
        'input_tokens',     COALESCE(sum(input_tokens), 0),
        'output_tokens',    COALESCE(sum(output_tokens), 0),
        'cached_tokens',    COALESCE(sum(cached_tokens), 0),
        'embedding_tokens', COALESCE(sum(embedding_tokens), 0)
      )
      FROM r
    ),
    'drafts', (
      SELECT jsonb_build_object(
        'discarded',          count(*) FILTER (WHERE draft_status = 'discarded'),
        'discarded_cost_usd', COALESCE(sum(cost_usd) FILTER (WHERE draft_status = 'discarded'), 0),
        'sent',               count(*) FILTER (WHERE draft_status = 'sent'),
        'sent_unedited',      count(*) FILTER (WHERE draft_status = 'sent' AND sent_body = body)
      )
      FROM rd
    ),
    'by_source', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('source', source, 'runs', n, 'cost_usd', c) ORDER BY c DESC, n DESC), '[]'::jsonb)
      FROM (SELECT source, count(*) AS n, COALESCE(sum(cost_usd), 0) AS c FROM r GROUP BY source) s
    ),
    'by_agent', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('agent_id', agent_id, 'runs', n, 'cost_usd', c) ORDER BY c DESC, n DESC), '[]'::jsonb)
      FROM (SELECT agent_id, count(*) AS n, COALESCE(sum(cost_usd), 0) AS c FROM r GROUP BY agent_id) a
    ),
    'by_model', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'provider', provider, 'model', model, 'runs', n, 'cost_usd', c,
        'input_tokens', i, 'output_tokens', o, 'missing_pricing', m
      ) ORDER BY c DESC, n DESC), '[]'::jsonb)
      FROM (
        SELECT provider, model, count(*) AS n, COALESCE(sum(cost_usd), 0) AS c,
               COALESCE(sum(input_tokens), 0) AS i, COALESCE(sum(output_tokens), 0) AS o,
               count(*) FILTER (WHERE cost_usd IS NULL AND COALESCE(input_tokens, 0) > 0) AS m
        FROM r
        WHERE model IS NOT NULL
        GROUP BY provider, model
      ) mo
    ),
    'top_conversations', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('conversation_id', conversation_id, 'contact_id', contact_id, 'runs', n, 'cost_usd', c) ORDER BY c DESC, n DESC), '[]'::jsonb)
      FROM (
        SELECT conversation_id, max(contact_id::text)::uuid AS contact_id, count(*) AS n, COALESCE(sum(cost_usd), 0) AS c
        FROM r
        WHERE conversation_id IS NOT NULL
        GROUP BY conversation_id
        ORDER BY c DESC, n DESC
        LIMIT 10
      ) t
    )
  );
$$;

COMMENT ON FUNCTION public.ai_cost_report(uuid, timestamptz, timestamptz) IS
  'Agregados de costo de IA de un periodo para la pestana Costos: totales, borradores (descartados y su gasto, enviados sin editar), por fuente, por agente, por modelo y top 10 de conversaciones. Solo service role.';

REVOKE ALL ON FUNCTION public.ai_cost_report(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_cost_report(uuid, timestamptz, timestamptz) TO service_role;

-- ------------------------------------------------------------
-- 2. draft_queue_metrics
-- ------------------------------------------------------------
-- p_user_id: solo lo respeta un Owner/Admin (NULL = el equipo, un id = esa
-- persona). Para un Member se reemplaza por auth.uid() sin mirar lo que vino:
-- pedir los numeros de otro rebota en la base, no en un if de la pantalla.
--
-- "De una persona" quiere decir:
--   - tiempos de respuesta y del agente: runs sobre contactos que son suyos;
--   - aprobacion, enviados, sin editar y descartados: lo que decidio ella;
--   - ventanas perdidas: las que se perdieron mientras el borrador era suyo.

CREATE OR REPLACE FUNCTION public.draft_queue_metrics(
  p_workspace_id uuid,
  p_from         timestamptz,
  p_to           timestamptz,
  p_user_id      uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_user uuid;
  v_result jsonb;
BEGIN
  IF p_workspace_id IS NULL THEN
    RAISE EXCEPTION 'workspace_id is required';
  END IF;
  IF NOT public.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'forbidden: not a member of this workspace';
  END IF;

  IF public.is_workspace_admin(p_workspace_id) THEN
    v_user := p_user_id;
  ELSE
    v_user := auth.uid();
  END IF;

  WITH runs AS (
    SELECT r.id, r.status, r.inbound_at, r.completed_at, r.responded_at
    FROM public.agent_runs r
    LEFT JOIN public.contacts c ON c.id = r.contact_id
    WHERE r.workspace_id = p_workspace_id
      AND r.source = 'agent'
      AND r.inbound_at IS NOT NULL
      AND (v_user IS NULL OR COALESCE(c.setter_id, c.vendedor_id) = v_user)
  ),
  decided AS (
    SELECT d.*, r.completed_at AS run_completed_at, r.responded_at AS run_responded_at
    FROM public.agent_drafts d
    LEFT JOIN public.agent_runs r ON r.id = d.run_id
    WHERE d.workspace_id = p_workspace_id
      AND d.decided_at >= p_from AND d.decided_at < p_to
      AND (v_user IS NULL OR d.decided_by = v_user)
  )
  SELECT jsonb_build_object(
    'response_median_s', (
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM responded_at - inbound_at))
      FROM runs
      WHERE responded_at >= p_from AND responded_at < p_to
    ),
    'agent_median_s', (
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM completed_at - inbound_at))
      FROM runs
      WHERE status IN ('responded', 'drafted')
        AND completed_at >= p_from AND completed_at < p_to
    ),
    -- Solo borradores enviados: sobre todos los runs, los de envio directo
    -- (~0 s) hundirian la mediana.
    'approval_median_s', (
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM run_responded_at - run_completed_at))
      FROM decided
      WHERE status = 'sent' AND run_responded_at IS NOT NULL AND run_completed_at IS NOT NULL
    ),
    'sent',          (SELECT count(*) FROM decided WHERE status = 'sent'),
    'sent_unedited', (SELECT count(*) FROM decided WHERE status = 'sent' AND sent_body = body),
    -- Descartar a proposito es una decision; los descartes automaticos (una
    -- respuesta a mano, un cierre) llevan el prefijo auto: y no cuentan.
    'discarded',     (SELECT count(*) FROM decided WHERE status = 'discarded' AND COALESCE(discard_reason, '') NOT LIKE 'auto:%'),
    'windows_missed', (
      SELECT count(*)
      FROM public.agent_drafts d
      WHERE d.workspace_id = p_workspace_id
        AND d.window_missed_at >= p_from AND d.window_missed_at < p_to
        AND (v_user IS NULL OR d.missed_while_assigned_to = v_user)
    ),
    'scope', CASE WHEN v_user IS NULL THEN 'team' ELSE 'person' END
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.draft_queue_metrics(uuid, timestamptz, timestamptz, uuid) IS
  'Franja de la cola de borradores: medianas de respuesta, del agente y de aprobacion, enviados, sin editar, descartados y ventanas perdidas de un periodo. Se defiende sola: exige ser miembro, y a un Member le devuelve siempre sus numeros.';

REVOKE ALL ON FUNCTION public.draft_queue_metrics(uuid, timestamptz, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.draft_queue_metrics(uuid, timestamptz, timestamptz, uuid) TO authenticated;

-- ------------------------------------------------------------
-- 3. draft_queue_metrics_by_person (Owner/Admin)
-- ------------------------------------------------------------
-- Una fila por persona que decidio algo o perdio una ventana en el periodo,
-- mas la fila "sin asignar" (user_id NULL) para las ventanas perdidas de
-- borradores que no eran de nadie.

CREATE OR REPLACE FUNCTION public.draft_queue_metrics_by_person(
  p_workspace_id uuid,
  p_from         timestamptz,
  p_to           timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF p_workspace_id IS NULL THEN
    RAISE EXCEPTION 'workspace_id is required';
  END IF;
  IF NOT public.is_workspace_admin(p_workspace_id) THEN
    RAISE EXCEPTION 'forbidden: only workspace owners and admins';
  END IF;

  WITH decided AS (
    SELECT d.decided_by AS user_id, d.status, d.body, d.sent_body, d.discard_reason,
           r.completed_at, r.responded_at
    FROM public.agent_drafts d
    LEFT JOIN public.agent_runs r ON r.id = d.run_id
    WHERE d.workspace_id = p_workspace_id
      AND d.decided_by IS NOT NULL
      AND d.decided_at >= p_from AND d.decided_at < p_to
  ),
  per_decider AS (
    SELECT user_id,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM responded_at - completed_at))
        FILTER (WHERE status = 'sent' AND responded_at IS NOT NULL AND completed_at IS NOT NULL) AS approval_median_s,
      count(*) FILTER (WHERE status = 'sent') AS sent,
      count(*) FILTER (WHERE status = 'sent' AND sent_body = body) AS sent_unedited,
      count(*) FILTER (WHERE status = 'discarded' AND COALESCE(discard_reason, '') NOT LIKE 'auto:%') AS discarded
    FROM decided
    GROUP BY user_id
  ),
  per_missed AS (
    SELECT d.missed_while_assigned_to AS user_id, count(*) AS windows_missed
    FROM public.agent_drafts d
    WHERE d.workspace_id = p_workspace_id
      AND d.window_missed_at >= p_from AND d.window_missed_at < p_to
    GROUP BY d.missed_while_assigned_to
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'user_id',           u.user_id,
    'approval_median_s', pd.approval_median_s,
    'sent',              COALESCE(pd.sent, 0),
    'sent_unedited',     COALESCE(pd.sent_unedited, 0),
    'discarded',         COALESCE(pd.discarded, 0),
    'windows_missed',    COALESCE(pm.windows_missed, 0)
  ) ORDER BY u.user_id NULLS LAST), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT user_id FROM per_decider
    UNION
    SELECT user_id FROM per_missed
  ) u
  LEFT JOIN per_decider pd ON pd.user_id IS NOT DISTINCT FROM u.user_id
  LEFT JOIN per_missed pm ON pm.user_id IS NOT DISTINCT FROM u.user_id;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.draft_queue_metrics_by_person(uuid, timestamptz, timestamptz) IS
  'Desglose por persona de la cola de borradores (mediana de aprobacion, enviados, sin editar, descartados, ventanas perdidas). Solo Owner/Admin, chequeado adentro.';

REVOKE ALL ON FUNCTION public.draft_queue_metrics_by_person(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.draft_queue_metrics_by_person(uuid, timestamptz, timestamptz) TO authenticated;

-- ============================================================
-- MIGRATION 72: DRAFT WINDOW ALERTS
-- ============================================================
-- ============================================================================
-- 00072 — Avisos de ventana de los borradores (Bloque 2c)
-- ============================================================================
-- Fase 3, Bloque 2c. Un borrador pendiente no se autovence nunca, pero la
-- ventana de mensajeria de la plataforma si: pasado el plazo (24 h en
-- Instagram) ya no se le puede responder al lead. Este job avisa ANTES, a la
-- persona a la que le toca, cuando un borrador cruza la mitad, el cuarto y el
-- octavo de su ventana.
--
-- SE APLICA CUANDO LA COLA YA SE LLENO SOLA UN PAR DE DIAS: es lo unico del
-- modo borrador que le manda notificaciones a una persona, y conviene
-- enchufarlo sabiendo que volumen tiene la cola. Lo que no puede esperar (los
-- envios colgados y las ventanas perdidas) ya lo hace el barrido de la 00070.
--
-- Guardas, todas obligatorias:
--
--   1. AGREGADO, NO UNO POR BORRADOR. Una notificacion por persona y corte:
--      "3 borradores tuyos con menos de 6 h de ventana". Un lote de 40 no
--      produce 40 avisos.
--
--   2. POR DESTINATARIO, NO POR WORKSPACE. Cada persona recibe el conteo de
--      SUS borradores (el setter del contacto; sin setter, el vendedor). Los
--      sin asignar van a Owner/Admin en un aviso aparte (recipient_id NULL) y
--      con ese rotulo. Nadie con cero borradores en el corte recibe nada. Un
--      aviso de workspace le llegaria a cuatro personas por un borrador que no
--      es de ninguna, y todas asumirian que lo tiene otro: el problema que el
--      aviso viene a resolver.
--
--   3. SOLO LO NUEVO. Se ignoran los borradores creados antes de aplicar esta
--      migracion (private.system_config 'draft_alerts_since'), o la primera
--      corrida dispararia el historial entero de una vez.
--
--   4. IDEMPOTENTE. Cada corte se anota en agent_drafts.alerted_thresholds EN
--      LA MISMA TRANSACCION que la notificacion. Correr el job dos veces
--      seguidas no avisa dos veces. alerted_thresholds es por borrador y no por
--      persona: si el contacto se reasigna entre un corte y el siguiente, el
--      corte ya avisado no se repite.
--
--   5. NUNCA PARA ATRAS. Si entre dos corridas se cruzaron dos cortes (un
--      canal con ventana corta, donde el octavo es del orden de los 5 minutos
--      del job), se anotan todos y se avisa solo el mas profundo.
--
-- Los cortes son denominadores de la ventana del canal (2, 4, 8), nunca horas
-- fijas: con W = 24 son 12, 6 y 3 horas. Un canal sin ventana no avisa.
--
-- Idempotente.
-- ============================================================================

-- Desde cuando se avisa: el momento en que se aplica esta migracion. Volver a
-- correrla no lo mueve.
INSERT INTO private.system_config (key, value, description)
VALUES (
  'draft_alerts_since',
  now()::text,
  'Los avisos de ventana (00072) ignoran los borradores creados antes de esto, para que la primera corrida no dispare el historial.'
)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION private.alert_draft_windows()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_since timestamptz;
  v_drafts integer := 0;
  v_notifications integer := 0;
BEGIN
  SELECT value::timestamptz INTO v_since FROM private.system_config WHERE key = 'draft_alerts_since';
  v_since := COALESCE(v_since, now());

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.draft_alerts (
    id uuid, workspace_id uuid, owner uuid, window_hours integer, new_cuts smallint[], deepest smallint
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.draft_alerts;

  -- Los borradores vivos con ventana abierta que cruzaron algun corte nuevo.
  -- FOR UPDATE: dos corridas superpuestas no avisan el mismo corte.
  INSERT INTO pg_temp.draft_alerts (id, workspace_id, owner, window_hours, new_cuts, deepest)
  SELECT x.id, x.workspace_id, x.owner, x.w, x.cuts, (SELECT max(t) FROM unnest(x.cuts) t)
  FROM (
    SELECT d.id, d.workspace_id, COALESCE(c.setter_id, c.vendedor_id) AS owner, w.w,
      ARRAY(
        SELECT t FROM unnest(ARRAY[2, 4, 8]::smallint[]) t
        WHERE (d.sendable_until - now()) <= make_interval(secs => w.w * 3600.0 / t)
          AND NOT (t = ANY (d.alerted_thresholds))
      ) AS cuts
    FROM public.agent_drafts d
    JOIN public.channels ch ON ch.id = d.channel_id
    JOIN public.contacts c ON c.id = d.contact_id
    CROSS JOIN LATERAL (SELECT public.messaging_window_hours(ch.platform, ch.messaging_window_hours) AS w) w
    WHERE d.status IN ('pending', 'failed')
      AND d.sendable_until IS NOT NULL
      AND d.sendable_until > now()
      AND d.created_at >= v_since
      AND w.w > 0
    FOR UPDATE OF d SKIP LOCKED
  ) x
  WHERE cardinality(x.cuts) > 0;

  -- Se anotan TODOS los cortes cruzados.
  UPDATE public.agent_drafts d
  SET alerted_thresholds = d.alerted_thresholds || a.new_cuts
  FROM pg_temp.draft_alerts a
  WHERE d.id = a.id;
  GET DIAGNOSTICS v_drafts = ROW_COUNT;

  -- Y se avisa solo el mas profundo, agrupado por persona, corte y ventana.
  INSERT INTO public.notifications (workspace_id, type, title, body, entity_type, entity_id, recipient_id, metadata)
  SELECT
    g.workspace_id,
    'draft_window',
    format(
      '%s borrador%s %s con menos de %s de ventana',
      g.n,
      CASE WHEN g.n = 1 THEN '' ELSE 'es' END,
      CASE WHEN g.owner IS NULL THEN 'sin asignar'
           WHEN g.n = 1 THEN 'tuyo' ELSE 'tuyos' END,
      CASE WHEN g.window_hours % g.deepest = 0 THEN (g.window_hours / g.deepest)::text || ' h'
           ELSE round(g.window_hours::numeric / g.deepest * 60)::text || ' min' END
    ),
    CASE WHEN g.owner IS NULL
      THEN 'Nadie los tiene asignados. Pasada la ventana, la plataforma ya no deja responder.'
      ELSE 'Pasada la ventana, la plataforma ya no deja responder: quedan para responder a mano.' END,
    'draft_queue',
    NULL,
    g.owner,
    jsonb_build_object('threshold', g.deepest, 'count', g.n, 'draft_ids', to_jsonb(g.ids), 'unassigned', g.owner IS NULL)
  FROM (
    SELECT workspace_id, owner, deepest, window_hours, count(*) AS n, array_agg(id) AS ids
    FROM pg_temp.draft_alerts
    GROUP BY workspace_id, owner, deepest, window_hours
  ) g;
  GET DIAGNOSTICS v_notifications = ROW_COUNT;

  RETURN jsonb_build_object('drafts', v_drafts, 'notifications', v_notifications);
END;
$$;

COMMENT ON FUNCTION private.alert_draft_windows() IS
  'Avisos de ventana de los borradores (00072): agregados por persona y corte (mitad, cuarto, octavo de la ventana del canal), idempotentes por agent_drafts.alerted_thresholds, solo para borradores creados despues de aplicar la migracion. Los sin asignar van a Owner/Admin.';

REVOKE ALL ON FUNCTION private.alert_draft_windows() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'draft-window-alerts') THEN
    PERFORM cron.unschedule('draft-window-alerts');
  END IF;
END $$;

SELECT cron.schedule(
  'draft-window-alerts',
  '*/5 * * * *',
  $$SELECT private.alert_draft_windows()$$
);

-- ============================================================
-- MIGRATION 73: TAG EFFECTS
-- ============================================================
-- ============================================================================
-- 00073 — Etiquetas con efecto sobre el agente (Bloque 2d-A)
-- ============================================================================
-- Fase 3, Bloque 2d-A.
--
-- La persona duena del negocio tiene contactos personales en el mismo Instagram
-- por el que entran los leads. El peor error posible del sistema es que el
-- agente le ofrezca la academia a un amigo. Una etiqueta que solo queda
-- guardada no alcanza: el agente igual redactaria la respuesta de venta.
-- Tiene que tener efecto.
--
-- Una sola implementacion generica, no dos casos especiales: `es-conocido` y
-- `no-es-lead` piden lo mismo (apagar el agente en las conversaciones del
-- contacto, las de hoy y las que se abran despues) y solo difieren en si ademas
-- asignan a alguien. Dos columnas en `tags` y triggers en la base. Viven en la
-- base y no en una Server Action porque son seis los caminos que ponen
-- etiquetas (ficha, panel de la bandeja, importacion CSV, nodo de flow,
-- herramienta del agente, accion masiva) y no comparten una funcion de TS.
--
--   1. tags.disables_agent / tags.assigns_to. Solo Owner/Admin crea, edita o
--      borra una etiqueta con efecto (policies de tags por comando). Un Member
--      sigue creando y usando etiquetas comunes, y PUEDE aplicarle una con
--      efecto a un lead suyo (contact_tags no cambia).
--
--   2. conversations.agent_disabled_by_tag_id: la marca de "esto lo apago una
--      etiqueta". Sin FK a proposito: el tag puede borrarse. Es lo que permite
--      revertir SOLO lo que apago la etiqueta y nunca un apagado a mano (Human
--      Takeover, respuesta manual, el toggle).
--
--   3. Al poner la etiqueta (AFTER INSERT en contact_tags): las conversaciones
--      del contacto que no estaban apagadas pasan a forzado apagado con la
--      marca; si la etiqueta asigna, setter y vendedor pasan a esa persona.
--      Una fila de audit_log con las dos consecuencias y el estado previo de
--      cada conversacion.
--
--   4. Al sacarla (AFTER DELETE): las conversaciones con la marca de ESA
--      etiqueta vuelven a heredar (NULL). La asignacion NO se revierte (la
--      persona sigue siendo la responsable; decision de producto). Si el contacto
--      conserva otra etiqueta con efecto, la marca pasa a esa y nada se prende.
--
--   5. Conversaciones nuevas del contacto (BEFORE INSERT en conversations) y
--      conversaciones que se mueven a el en una fusion (BEFORE UPDATE OF
--      contact_id) nacen apagadas con la marca.
--
--   6. La marca se limpia sola cuando una persona cambia el estado del agente
--      en la conversacion (BEFORE UPDATE OF agent_enabled). Asi prender a mano
--      gana sobre la etiqueta. Y contestar a mano una conversacion que YA
--      estaba apagada por la etiqueta no la toca: el estado no cambia, no es
--      una decision nueva, y sacar la etiqueta despues la vuelve a heredar.
--      Vale para cualquier escritor, presente o futuro: no depende de que cada
--      archivo de TypeScript se acuerde de limpiarla.
--
--   7. Borrar la etiqueta de la tabla tags (BEFORE DELETE) revierte mientras la
--      fila existe: en la cascada a contact_tags el trigger por fila ya no la
--      encontraria. Prender o apagar "Apaga el agente" en una etiqueta en uso
--      (AFTER UPDATE OF disables_agent) aplica o revierte en sus contactos.
--
-- Los triggers corren como el dueño de las tablas (SECURITY DEFINER): la RLS de
-- audit_log no aplica adentro, igual que en apply_opt_out_check (00027).
-- performed_by = auth.uid(): quien puso la etiqueta, o NULL si fue el sistema.
--
-- Idempotente.
-- ============================================================================

-- ------------------------------------------------------------
-- 1. Columnas
-- ------------------------------------------------------------

ALTER TABLE public.tags ADD COLUMN IF NOT EXISTS disables_agent boolean NOT NULL DEFAULT false;
ALTER TABLE public.tags ADD COLUMN IF NOT EXISTS assigns_to uuid NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tags_assigns_to_fkey') THEN
    ALTER TABLE public.tags
      ADD CONSTRAINT tags_assigns_to_fkey FOREIGN KEY (assigns_to) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.tags.disables_agent IS
  'Etiqueta con efecto (00073): el agente queda forzado apagado en las conversaciones del contacto.';
COMMENT ON COLUMN public.tags.assigns_to IS
  'Etiqueta con efecto (00073): al ponerla, setter y vendedor del contacto pasan a esta persona.';

CREATE INDEX IF NOT EXISTS idx_tags_with_effect ON public.tags (workspace_id) WHERE disables_agent;

ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS agent_disabled_by_tag_id uuid NULL;

COMMENT ON COLUMN public.conversations.agent_disabled_by_tag_id IS
  'La etiqueta que apago el agente aca (00073). Se limpia sola si una persona cambia el estado del agente.';

CREATE INDEX IF NOT EXISTS idx_conversations_disabled_by_tag
  ON public.conversations (agent_disabled_by_tag_id) WHERE agent_disabled_by_tag_id IS NOT NULL;

-- ------------------------------------------------------------
-- 2. Policies de tags, por comando
-- ------------------------------------------------------------
-- La 00002 tenia una sola FOR ALL para cualquier miembro. No se usa privilegio
-- de columna: todos los usuarios son el mismo rol `authenticated`, asi que
-- revocar la columna se la sacaria tambien a la duena del negocio.

DROP POLICY IF EXISTS "Users can manage tags in their workspaces" ON public.tags;
DROP POLICY IF EXISTS "tags_insert" ON public.tags;
DROP POLICY IF EXISTS "tags_update" ON public.tags;
DROP POLICY IF EXISTS "tags_delete" ON public.tags;

CREATE POLICY "tags_insert" ON public.tags
  FOR INSERT
  WITH CHECK (
    public.is_workspace_member(workspace_id)
    AND (public.is_workspace_admin(workspace_id) OR (disables_agent = false AND assigns_to IS NULL))
  );

CREATE POLICY "tags_update" ON public.tags
  FOR UPDATE
  USING (
    public.is_workspace_member(workspace_id)
    AND (public.is_workspace_admin(workspace_id) OR (disables_agent = false AND assigns_to IS NULL))
  )
  WITH CHECK (
    public.is_workspace_member(workspace_id)
    AND (public.is_workspace_admin(workspace_id) OR (disables_agent = false AND assigns_to IS NULL))
  );

CREATE POLICY "tags_delete" ON public.tags
  FOR DELETE
  USING (
    public.is_workspace_member(workspace_id)
    AND (public.is_workspace_admin(workspace_id) OR (disables_agent = false AND assigns_to IS NULL))
  );

-- ------------------------------------------------------------
-- 3. Aplicar el efecto de una etiqueta a un contacto
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.tag_effect_apply(p_contact_id uuid, p_tag_id uuid, p_origin text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tag      public.tags%ROWTYPE;
  v_contact  public.contacts%ROWTYPE;
  v_forced   jsonb := '[]'::jsonb;
  v_assigned boolean := false;
BEGIN
  SELECT * INTO v_tag FROM public.tags WHERE id = p_tag_id;
  IF NOT FOUND OR (NOT v_tag.disables_agent AND v_tag.assigns_to IS NULL) THEN
    RETURN;
  END IF;

  SELECT * INTO v_contact FROM public.contacts WHERE id = p_contact_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_tag.disables_agent THEN
    -- Solo las que no estaban apagadas: una apagada a mano (Human Takeover,
    -- respuesta manual) no se "reclama", asi sacar la etiqueta no la prende.
    WITH prev AS (
      SELECT c.id, c.agent_enabled
      FROM public.conversations c
      WHERE c.contact_id = p_contact_id
        AND c.deleted_at IS NULL
        AND c.agent_enabled IS DISTINCT FROM false
    ), upd AS (
      UPDATE public.conversations c
      SET agent_enabled = false, agent_disabled_by_tag_id = p_tag_id
      FROM prev
      WHERE c.id = prev.id
      RETURNING c.id, prev.agent_enabled AS previous
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', upd.id, 'previous', upd.previous)), '[]'::jsonb)
      INTO v_forced
      FROM upd;
  END IF;

  -- Asignar solo a un miembro vigente, y solo si algo cambia: no se emiten
  -- eventos assignment_changed de mas (contacts_automation_changes, 00039).
  IF v_tag.assigns_to IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.workspace_members m
       WHERE m.workspace_id = v_tag.workspace_id AND m.user_id = v_tag.assigns_to
     )
     AND (v_contact.setter_id IS DISTINCT FROM v_tag.assigns_to
          OR v_contact.vendedor_id IS DISTINCT FROM v_tag.assigns_to) THEN
    UPDATE public.contacts
    SET setter_id = v_tag.assigns_to, vendedor_id = v_tag.assigns_to
    WHERE id = p_contact_id;
    v_assigned := true;
  END IF;

  IF jsonb_array_length(v_forced) = 0 AND NOT v_assigned THEN
    RETURN;
  END IF;

  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by)
  VALUES (
    v_contact.workspace_id, 'contact', p_contact_id, 'tag_effect',
    CASE WHEN v_assigned THEN jsonb_build_object(
      'setter_id', jsonb_build_object('old', v_contact.setter_id, 'new', v_tag.assigns_to),
      'vendedor_id', jsonb_build_object('old', v_contact.vendedor_id, 'new', v_tag.assigns_to)
    ) END,
    jsonb_build_object(
      'applied', true,
      'origin', p_origin,
      'tag_id', p_tag_id,
      'tag_name', v_tag.name,
      'conversations_forced_off', v_forced,
      'assigned_to', CASE WHEN v_assigned THEN v_tag.assigns_to END,
      'previous_setter_id', v_contact.setter_id,
      'previous_vendedor_id', v_contact.vendedor_id
    ),
    auth.uid()
  );
END;
$$;

-- ------------------------------------------------------------
-- 4. Liberar lo que apago una etiqueta
-- ------------------------------------------------------------
-- p_always_audit: al sacar la etiqueta a mano queda el registro aunque no haya
-- nada que prender (todas se habian prendido a mano). En los barridos (borrar
-- la etiqueta, apagar su efecto) solo se anota el contacto donde algo cambio.

CREATE OR REPLACE FUNCTION private.tag_effect_release(
  p_contact_id   uuid,
  p_tag_id       uuid,
  p_origin       text,
  p_tag_name     text,
  p_always_audit boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_workspace uuid;
  v_other     uuid;
  v_restored  jsonb := '[]'::jsonb;
  v_moved     jsonb := '[]'::jsonb;
BEGIN
  SELECT workspace_id INTO v_workspace FROM public.contacts WHERE id = p_contact_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Otra etiqueta con efecto que el contacto conserva: la marca pasa a esa y
  -- nada se prende.
  SELECT ct.tag_id INTO v_other
  FROM public.contact_tags ct
  JOIN public.tags t ON t.id = ct.tag_id
  WHERE ct.contact_id = p_contact_id
    AND ct.tag_id <> p_tag_id
    AND t.disables_agent
  ORDER BY ct.created_at
  LIMIT 1;

  IF v_other IS NOT NULL THEN
    -- Solo la marca: agent_enabled no esta en el SET, asi que la marca no se limpia.
    WITH upd AS (
      UPDATE public.conversations
      SET agent_disabled_by_tag_id = v_other
      WHERE contact_id = p_contact_id AND agent_disabled_by_tag_id = p_tag_id
      RETURNING id
    )
    SELECT COALESCE(jsonb_agg(upd.id), '[]'::jsonb) INTO v_moved FROM upd;
  ELSE
    WITH upd AS (
      UPDATE public.conversations
      SET agent_enabled = NULL, agent_disabled_by_tag_id = NULL
      WHERE contact_id = p_contact_id
        AND agent_disabled_by_tag_id = p_tag_id
        AND agent_enabled = false
      RETURNING id
    )
    SELECT COALESCE(jsonb_agg(upd.id), '[]'::jsonb) INTO v_restored FROM upd;
  END IF;

  IF NOT p_always_audit AND jsonb_array_length(v_restored) = 0 AND jsonb_array_length(v_moved) = 0 THEN
    RETURN;
  END IF;

  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by)
  VALUES (
    v_workspace, 'contact', p_contact_id, 'tag_effect', NULL,
    jsonb_build_object(
      'removed', true,
      'origin', p_origin,
      'tag_id', p_tag_id,
      'tag_name', p_tag_name,
      'conversations_restored', v_restored,
      'still_disabled_by_tag_id', v_other,
      'conversations_still_disabled', v_moved,
      'assignment_kept', true
    ),
    auth.uid()
  );
END;
$$;

REVOKE ALL ON FUNCTION private.tag_effect_apply(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.tag_effect_release(uuid, uuid, text, text, boolean) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 5. Trigger en contact_tags: poner, sacar, mover (fusion)
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.contact_tags_apply_effects()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_name     text;
  v_disables boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM private.tag_effect_apply(NEW.contact_id, NEW.tag_id, 'tag_added');
    RETURN NULL;
  END IF;

  IF TG_OP = 'DELETE' THEN
    -- En la cascada de un DELETE en tags la fila ya no esta: ese caso lo
    -- resolvio tags_effect_changed antes de borrar.
    SELECT name, disables_agent INTO v_name, v_disables FROM public.tags WHERE id = OLD.tag_id;
    IF FOUND AND v_disables THEN
      PERFORM private.tag_effect_release(OLD.contact_id, OLD.tag_id, 'tag_removed', v_name, true);
    END IF;
    RETURN NULL;
  END IF;

  -- UPDATE OF contact_id: la fusion de contactos mueve las etiquetas del
  -- duplicado al principal (lib/actions/contacts.ts, linkContacts).
  IF NEW.contact_id IS DISTINCT FROM OLD.contact_id THEN
    PERFORM private.tag_effect_apply(NEW.contact_id, NEW.tag_id, 'contact_merge');
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS contact_tags_effects ON public.contact_tags;
CREATE TRIGGER contact_tags_effects
  AFTER INSERT OR DELETE OR UPDATE OF contact_id ON public.contact_tags
  FOR EACH ROW EXECUTE FUNCTION public.contact_tags_apply_effects();

-- ------------------------------------------------------------
-- 6. Trigger en tags: borrar la etiqueta, prender o apagar su efecto
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tags_effect_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  r record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- BEFORE DELETE: la fila todavia existe, se libera antes de la cascada.
    FOR r IN
      SELECT DISTINCT contact_id FROM public.conversations WHERE agent_disabled_by_tag_id = OLD.id
    LOOP
      PERFORM private.tag_effect_release(r.contact_id, OLD.id, 'tag_deleted', OLD.name, false);
    END LOOP;
    RETURN OLD;
  END IF;

  -- AFTER UPDATE OF disables_agent.
  IF NEW.disables_agent AND NOT OLD.disables_agent THEN
    FOR r IN SELECT contact_id FROM public.contact_tags WHERE tag_id = NEW.id LOOP
      PERFORM private.tag_effect_apply(r.contact_id, NEW.id, 'effect_enabled');
    END LOOP;
  ELSIF OLD.disables_agent AND NOT NEW.disables_agent THEN
    FOR r IN
      SELECT DISTINCT contact_id FROM public.conversations WHERE agent_disabled_by_tag_id = NEW.id
    LOOP
      PERFORM private.tag_effect_release(r.contact_id, NEW.id, 'effect_disabled', NEW.name, false);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tags_effect_on_delete ON public.tags;
CREATE TRIGGER tags_effect_on_delete
  BEFORE DELETE ON public.tags
  FOR EACH ROW EXECUTE FUNCTION public.tags_effect_changed();

DROP TRIGGER IF EXISTS tags_effect_on_update ON public.tags;
CREATE TRIGGER tags_effect_on_update
  AFTER UPDATE OF disables_agent ON public.tags
  FOR EACH ROW EXECUTE FUNCTION public.tags_effect_changed();

-- ------------------------------------------------------------
-- 7. Triggers en conversations
-- ------------------------------------------------------------

-- Conversaciones nuevas y movidas (fusion) heredan el efecto del contacto.
CREATE OR REPLACE FUNCTION public.conversations_inherit_tag_effects()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tag_id   uuid;
  v_tag_name text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.contact_id IS NOT DISTINCT FROM OLD.contact_id THEN
    RETURN NEW;
  END IF;

  SELECT ct.tag_id, t.name INTO v_tag_id, v_tag_name
  FROM public.contact_tags ct
  JOIN public.tags t ON t.id = ct.tag_id
  WHERE ct.contact_id = NEW.contact_id AND t.disables_agent
  ORDER BY ct.created_at
  LIMIT 1;

  IF v_tag_id IS NOT NULL THEN
    IF TG_OP = 'INSERT' OR NEW.agent_enabled IS DISTINCT FROM false THEN
      NEW.agent_enabled := false;
      NEW.agent_disabled_by_tag_id := v_tag_id;
      INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by)
      VALUES (
        NEW.workspace_id, 'contact', NEW.contact_id, 'tag_effect', NULL,
        jsonb_build_object(
          'applied', true,
          'origin', CASE WHEN TG_OP = 'INSERT' THEN 'new_conversation' ELSE 'contact_merge' END,
          'tag_id', v_tag_id,
          'tag_name', v_tag_name,
          'conversations_forced_off', jsonb_build_array(jsonb_build_object('id', NEW.id, 'previous', CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.agent_enabled END))
        ),
        auth.uid()
      );
    END IF;
  ELSIF TG_OP = 'UPDATE' AND NEW.agent_disabled_by_tag_id IS NOT NULL THEN
    -- Se movio a un contacto sin etiqueta con efecto: lo que apago la
    -- etiqueta del contacto anterior se libera.
    NEW.agent_enabled := NULL;
    NEW.agent_disabled_by_tag_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS conversations_a_inherit_tag_effects ON public.conversations;
CREATE TRIGGER conversations_a_inherit_tag_effects
  BEFORE INSERT OR UPDATE OF contact_id ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.conversations_inherit_tag_effects();

-- Una persona cambio el estado del agente en la conversacion: la marca de la
-- etiqueta deja de valer. Solo si el estado cambia de verdad y quien escribe no
-- es el mecanismo de la etiqueta (que escribe la marca junto con el estado).
CREATE OR REPLACE FUNCTION public.conversations_keep_tag_marker()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.agent_enabled IS DISTINCT FROM OLD.agent_enabled
     AND NEW.agent_disabled_by_tag_id IS NOT DISTINCT FROM OLD.agent_disabled_by_tag_id THEN
    NEW.agent_disabled_by_tag_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS conversations_b_keep_tag_marker ON public.conversations;
CREATE TRIGGER conversations_b_keep_tag_marker
  BEFORE UPDATE OF agent_enabled ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.conversations_keep_tag_marker();

-- Las trigger functions no quedan invocables por usuarios (00048).
REVOKE ALL ON FUNCTION public.contact_tags_apply_effects() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tags_effect_changed() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.conversations_inherit_tag_effects() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.conversations_keep_tag_marker() FROM PUBLIC, anon, authenticated;

-- ============================================================
-- MIGRATION 74: MESSAGES ORIGIN
-- ============================================================
-- ============================================================================
-- 00074 — Origen de los salientes (Fase 3, Bloque 1, F2)
-- ============================================================================
-- Hasta ahora ningun saliente guardaba de donde salio. Los 1.580 del historial
-- entraron sin autor (ver docs/diagnostico-autoria.md). El dashboard del
-- Bloque 3 necesita separar Agente / Equipo / Automatizaciones / Fuera del
-- sistema, y la verificacion del Bloque 2 necesita distinguir un saliente
-- externo (ManyChat) de uno propio. Ese dato es `messages.origin`.
--
--   1. Columna `origin` con su lista cerrada. null en entrantes; no null en
--      salientes (el CHECK se exige recien despues del backfill).
--   2. Backfill: agent > user > flow por sus sent_by_*, y external si no tiene
--      ninguno (que es el caso de todo el historial).
--   3. Trigger BEFORE INSERT que deriva el origin de cualquier saliente que
--      llegue sin el. Protege la base mientras la version vieja de la app siga
--      desplegada: un saliente que entre por un camino todavia sin actualizar
--      no queda con origin null (romperia el CHECK), se deriva de sus autores.
--   4. Indice (workspace_id, origin, created_at) para el dashboard.
--
-- Idempotente. Solo aditiva: agrega una columna, la puebla y la indexa. No
-- borra ni modifica datos existentes mas alla de completar `origin`.
-- ============================================================================

-- 1. Columna --------------------------------------------------------------
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS origin text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_origin_values') THEN
    ALTER TABLE public.messages ADD CONSTRAINT messages_origin_values
      CHECK (origin IS NULL OR origin IN ('agent', 'user', 'flow', 'sequence', 'broadcast', 'external'));
  END IF;
END $$;

COMMENT ON COLUMN public.messages.origin IS
  'De donde salio el saliente: agent, user, flow, sequence, broadcast o external. null en entrantes. Lo escribe cada camino de envio; el trigger messages_fill_origin lo deriva si falta (F2).';

-- 2. Backfill de lo ya guardado ------------------------------------------
-- Prioridad agent > user > flow: un borrador aprobado lleva las dos autorias
-- (agente y quien aprobo), y ahi manda el agente. sequence/broadcast no tienen
-- columna propia en el historial, asi que un saliente sin ningun autor es
-- external (todo el historial cae aca).
UPDATE public.messages
SET origin = CASE
    WHEN sent_by_agent_id IS NOT NULL THEN 'agent'
    WHEN sent_by_user_id IS NOT NULL THEN 'user'
    WHEN sent_by_flow_id IS NOT NULL THEN 'flow'
    ELSE 'external'
  END
WHERE direction = 'outbound' AND origin IS NULL;

UPDATE public.messages
SET origin = NULL
WHERE direction = 'inbound' AND origin IS NOT NULL;

-- 3. Trigger que deriva el origin en salientes sin el --------------------
CREATE OR REPLACE FUNCTION public.messages_fill_origin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.direction = 'inbound' THEN
    NEW.origin := NULL;
  ELSIF NEW.origin IS NULL THEN
    NEW.origin := CASE
      WHEN NEW.sent_by_agent_id IS NOT NULL THEN 'agent'
      WHEN NEW.sent_by_user_id IS NOT NULL THEN 'user'
      WHEN NEW.sent_by_flow_id IS NOT NULL THEN 'flow'
      ELSE 'external'
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS messages_fill_origin ON public.messages;
CREATE TRIGGER messages_fill_origin
  BEFORE INSERT OR UPDATE OF origin, direction, sent_by_agent_id, sent_by_user_id, sent_by_flow_id
  ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.messages_fill_origin();

-- 4. CHECK duro: todo saliente tiene origin -------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_outbound_has_origin') THEN
    ALTER TABLE public.messages ADD CONSTRAINT messages_outbound_has_origin
      CHECK (direction <> 'outbound' OR origin IS NOT NULL);
  END IF;
END $$;

-- 5. Indice para el dashboard ---------------------------------------------
CREATE INDEX IF NOT EXISTS idx_messages_workspace_origin_created
  ON public.messages (workspace_id, origin, created_at);

-- 6. Verificacion: no puede quedar un saliente sin origin -----------------
DO $$
DECLARE v_missing integer;
BEGIN
  SELECT count(*) INTO v_missing
  FROM public.messages
  WHERE direction = 'outbound' AND origin IS NULL;
  IF v_missing > 0 THEN
    RAISE EXCEPTION 'Quedaron % salientes sin origin despues del backfill', v_missing;
  END IF;
END $$;

-- ============================================================
-- MIGRATION 75: WORKSPACE TIMEZONE
-- ============================================================
-- ============================================================================
-- 00075 — Zona horaria del workspace (Fase 3, Bloque 1, F3)
-- ============================================================================
-- Los dashboards del Bloque 3 cortan los dias en la zona del negocio ("Hoy",
-- "Esta semana"). Hasta ahora la zona vivia como constante en el codigo
-- (BUSINESS_TIMEZONE = America/Costa_Rica). Se guarda en el workspace para que
-- las funciones de metricas la usen. Los lectores viejos (guardarrailes,
-- costos, topes) siguen con la constante por ahora; unificarlos queda anotado.
--
-- Idempotente y aditiva: una columna con default.
-- ============================================================================

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'America/Costa_Rica';

COMMENT ON COLUMN public.workspaces.timezone IS
  'Zona horaria IANA del negocio. Los dashboards cortan dias y semanas con esta zona (F3). Default America/Costa_Rica.';

-- authenticated ya puede leer todas las columnas de workspaces por su policy;
-- no hace falta GRANT de columna (a diferencia de agents, que revoca costos).

-- ============================================================
-- MIGRATION 76: RUN VALUES AND NORMALIZE
-- ============================================================
-- ============================================================================
-- 00076 — Valores nuevos en agent_runs y normalizador para agrupar (F4)
-- ============================================================================
-- Fase 3, Bloque 1.
--
--   1. agent_runs.status suma `already_answered`: el turno se retira porque ya
--      hubo una respuesta (Bloque 2, verificacion antes de responder).
--   2. agent_runs.source suma `message_classification` y
--      `message_classification_eval`: las corridas del clasificador de patrones
--      y su evaluacion contra el set de control (Bloques 4 y 5). No llevan
--      agent_id, asi que el CHECK agent_only_for_agent_sources no cambia.
--   3. public.normalize_for_grouping(text): normaliza para AGRUPAR mensajes
--      (colapsa letras repetidas: "siii" y "si" caen juntas). Es distinta de
--      normalize_message_text (00027), que se sigue usando para detectar frases
--      de "no contactar" y NO se toca: cambiarla movería esa deteccion.
--
-- Idempotente. Aditiva: recrea CHECKs para sumar valores (patron del repo) y
-- crea una funcion nueva. No borra datos.
-- ============================================================================

-- 1 y 2. CHECKs de agent_runs --------------------------------------------
ALTER TABLE public.agent_runs DROP CONSTRAINT IF EXISTS agent_runs_status_values;
ALTER TABLE public.agent_runs ADD CONSTRAINT agent_runs_status_values
  CHECK (status IN ('running', 'responded', 'escalated', 'skipped_automation',
                    'skipped', 'blocked_guardrail', 'completed', 'error', 'drafted',
                    'already_answered'));

ALTER TABLE public.agent_runs DROP CONSTRAINT IF EXISTS agent_runs_source_values;
ALTER TABLE public.agent_runs ADD CONSTRAINT agent_runs_source_values
  CHECK (source IN ('agent', 'flow_ai_node', 'sequence_ai_step', 'kb_indexing',
                    'conversation_summary', 'message_classification',
                    'message_classification_eval'));

-- 3. Normalizador para agrupar -------------------------------------------
-- minusculas → saca acentos con translate (no unaccent) → elimina todo lo que
-- no sea letra, numero o espacio → colapsa 2+ caracteres iguales seguidos en
-- uno → colapsa espacios y recorta → trunca a 300.
CREATE OR REPLACE FUNCTION public.normalize_for_grouping(p_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT left(
    btrim(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            translate(lower(coalesce(p_raw, '')),
              'áàäâãéèëêíìïîóòöôõúùüûñç',
              'aaaaaeeeeiiiiooooouuuunc'),
            '[^a-z0-9 ]', '', 'g'),
          '(.)\1+', '\1', 'g'),
        '\s+', ' ', 'g')
    ),
    300
  );
$$;

REVOKE ALL ON FUNCTION public.normalize_for_grouping(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.normalize_for_grouping(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.normalize_for_grouping(text) IS
  'Normaliza para AGRUPAR mensajes por lo que significan (colapsa letras repetidas: siii=si). Distinta de normalize_message_text (00027), que detecta frases de no contactar. Espejo exacto de lib/text/normalize.ts (F4).';

-- ============================================================
-- MIGRATION 77: AGENT REPLY RULES
-- ============================================================
-- ============================================================================
-- 00077 — Verificación antes de responder y reglas de respuesta (Bloque 2)
-- ============================================================================
-- Fase 3, Bloque 2 (F5–F12).
--
--   1. Columnas de reglas en `agents`: response_rules (lista jsonb),
--      response_rules_default (send/draft/skip), external_reply_cooldown_minutes
--      (0–120). Con su GRANT SELECT a authenticated (regla de la 00060).
--   2. agent_runs.routing jsonb: qué decidió el turno (modo, regla, chequeo,
--      salud del refresco). Con GRANT SELECT (no es un costo).
--   3. RPC claim_agent_reply: bajo pg_advisory_xact_lock por conversación,
--      mira si ya hubo un saliente después del inbound del turno que no es el
--      propio. Es el "momento 2": el chequeo antes de enviar/guardar.
--      Elección de atomicidad (F5): la app no puede sostener una transacción a
--      través de la llamada a Zernio, así que el lock serializa turno-vs-turno
--      del agente (que además ya es imposible por el índice único de un job
--      pendiente por conversación). El caso "una PERSONA responde entre el
--      chequeo y el envío" queda cubierto por el paso 8 del runner (respuesta
--      humana) y, en modo borrador, por el descarte del momento 3. No se
--      reserva una fila `pending` en messages a propósito: contaminaría la
--      bandeja, los conteos y la ráfaga.
--   4. Trigger messages_discard_answered_drafts (momento 3): cuando entra un
--      saliente, descarta el borrador pendiente/fallido de esa conversación si
--      es posterior a su ráfaga y no salió de su propio run. auto:manual_reply
--      si el saliente es de una persona, auto:answered_elsewhere si no.
--   5. Cron drafts-refresh cada 5 min (refresca contra Zernio las
--      conversaciones con borrador pendiente) + whitelist de call_app_cron.
--
-- Idempotente. Aditiva.
-- ============================================================================

-- 1. Columnas de reglas ---------------------------------------------------
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS response_rules jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS response_rules_default text NOT NULL DEFAULT 'draft';
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS external_reply_cooldown_minutes integer NOT NULL DEFAULT 10;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agents_response_rules_default_values') THEN
    ALTER TABLE public.agents ADD CONSTRAINT agents_response_rules_default_values
      CHECK (response_rules_default IN ('send', 'draft', 'skip'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agents_external_cooldown_range') THEN
    ALTER TABLE public.agents ADD CONSTRAINT agents_external_cooldown_range
      CHECK (external_reply_cooldown_minutes BETWEEN 0 AND 120);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agents_response_rules_is_array') THEN
    ALTER TABLE public.agents ADD CONSTRAINT agents_response_rules_is_array
      CHECK (jsonb_typeof(response_rules) = 'array');
  END IF;
END $$;

GRANT SELECT (response_rules, response_rules_default, external_reply_cooldown_minutes)
  ON public.agents TO authenticated;

-- 2. agent_runs.routing ---------------------------------------------------
ALTER TABLE public.agent_runs ADD COLUMN IF NOT EXISTS routing jsonb;
GRANT SELECT (routing) ON public.agent_runs TO authenticated;

COMMENT ON COLUMN public.agent_runs.routing IS
  'Qué decidió el turno (F9/F12): mode, rule_id, rule_index, action, matched, check, moment, refresh. Se lee en Runs y en la cola; la pantalla arma una oración, nunca muestra rule:<id>.';

-- 3. RPC claim_agent_reply (momento 2) -----------------------------------
CREATE OR REPLACE FUNCTION public.claim_agent_reply(
  p_conversation_id uuid,
  p_inbound_at timestamptz,
  p_run_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_answered boolean;
BEGIN
  -- Serializa contra otro turno del agente sobre la misma conversación. Se
  -- libera al terminar la transacción (commit o rollback): un turno que muere
  -- nunca deja el lock tomado.
  PERFORM pg_advisory_xact_lock(hashtext(p_conversation_id::text));

  SELECT EXISTS (
    SELECT 1 FROM public.messages
    WHERE conversation_id = p_conversation_id
      AND direction = 'outbound'
      AND created_at > p_inbound_at
      AND status <> 'failed'
      AND (p_run_id IS NULL OR agent_run_id IS DISTINCT FROM p_run_id)
  ) INTO v_answered;

  RETURN v_answered;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_agent_reply(uuid, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_agent_reply(uuid, timestamptz, uuid) TO service_role;

COMMENT ON FUNCTION public.claim_agent_reply(uuid, timestamptz, uuid) IS
  'Momento 2 (F5): bajo advisory lock por conversación, true si ya hay un saliente posterior al inbound del turno que no es el propio run. Ver la elección de atomicidad en la cabecera de 00077.';

-- 4. Trigger momento 3: un saliente descarta el borrador pendiente --------
CREATE OR REPLACE FUNCTION public.messages_discard_answered_drafts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.direction <> 'outbound' OR NEW.status = 'failed' THEN
    RETURN NEW;
  END IF;

  UPDATE public.agent_drafts d
  SET status = 'discarded',
      discard_reason = CASE WHEN NEW.origin = 'user' THEN 'auto:manual_reply' ELSE 'auto:answered_elsewhere' END,
      decided_at = now()
  WHERE d.conversation_id = NEW.conversation_id
    AND d.status IN ('pending', 'failed')
    -- Solo si el saliente es posterior a la ráfaga del borrador y no salió del
    -- propio run del borrador (aprobar un borrador no se descarta a sí mismo).
    AND (d.burst_last_inbound_at IS NULL OR d.burst_last_inbound_at < NEW.created_at)
    AND (NEW.agent_run_id IS NULL OR d.run_id IS DISTINCT FROM NEW.agent_run_id);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS messages_discard_answered_drafts ON public.messages;
CREATE TRIGGER messages_discard_answered_drafts
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.messages_discard_answered_drafts();

-- 5. Cron drafts-refresh + whitelist -------------------------------------
CREATE OR REPLACE FUNCTION private.call_app_cron(p_path text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_base   text;
  v_secret text;
BEGIN
  IF p_path NOT IN ('jobs', 'sequences', 'whatsapp-health', 'inactivity', 'automation-events', 'agent-bursts', 'drafts-refresh') THEN
    RAISE EXCEPTION 'ruta de cron no permitida: %', p_path;
  END IF;

  SELECT value INTO v_base   FROM private.system_config WHERE key = 'app_url';
  SELECT value INTO v_secret FROM private.system_config WHERE key = 'cron_secret';

  IF v_base IS NULL OR v_secret IS NULL THEN
    RAISE WARNING 'private.system_config sin app_url o cron_secret: el cron "%" no se ejecuto', p_path;
    RETURN NULL;
  END IF;

  RETURN net.http_get(
    url     => rtrim(v_base, '/') || '/api/cron/' || p_path,
    headers => jsonb_build_object(
                 'Authorization', 'Bearer ' || v_secret,
                 'Content-Type',  'application/json'
               ),
    timeout_milliseconds => 60000
  );
END;
$$;

REVOKE ALL ON FUNCTION private.call_app_cron(text) FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'drafts-refresh') THEN
    PERFORM cron.unschedule('drafts-refresh');
  END IF;
  PERFORM cron.schedule('drafts-refresh', '*/5 * * * *', $cron$SELECT private.call_app_cron('drafts-refresh')$cron$);
END $$;

-- ============================================================
-- MIGRATION 78: CHAT DASHBOARD METRICS
-- ============================================================
-- ============================================================================
-- 00078 — Funciones de métricas del dashboard de Chat (Bloque 3, F15)
-- ============================================================================
-- Todas SECURITY INVOKER: se llaman con el cliente del usuario, así la RLS de
-- messages/conversations aplica el scope de leads (un Member ve solo lo suyo).
-- Reciben los mismos filtros (p_from, p_to, p_channel, p_author) y cortan los
-- días en la zona del workspace. "Período anterior" se calcula del lado de la
-- app y se pasa como otro rango.
--
-- No crean tablas: los episodios se derivan con una función (§12.4).
-- Idempotente (CREATE OR REPLACE) y aditiva.
-- ============================================================================

-- Episodios (§11.3): un episodio arranca con un entrante que es el primero de
-- la conversación, o el primero tras una inactividad mayor que
-- close_after_inactive_hours. Termina con el siguiente arranque o el final.
CREATE OR REPLACE FUNCTION public.chat_episodes(
  p_workspace_id uuid,
  p_channel text DEFAULT NULL
)
RETURNS TABLE (
  conversation_id uuid,
  contact_id uuid,
  channel_id uuid,
  episode_no integer,
  episode_start timestamptz,
  first_inbound_at timestamptz,
  first_outbound_at timestamptz,
  first_outbound_origin text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH gap AS (
    SELECT COALESCE(MIN(close_after_inactive_hours), 12) AS hours
    FROM public.agents WHERE workspace_id = p_workspace_id AND deleted_at IS NULL
  ),
  msgs AS (
    SELECT m.conversation_id, m.direction, m.origin, m.created_at,
           c.contact_id AS c_contact, c.channel_id AS c_channel
    FROM public.messages m
    JOIN public.conversations c ON c.id = m.conversation_id
    WHERE m.workspace_id = p_workspace_id
      AND c.deleted_at IS NULL
      AND (p_channel IS NULL OR c.channel_id::text = p_channel OR c.platform = p_channel)
  ),
  ordered AS (
    SELECT *, LAG(created_at) OVER (PARTITION BY conversation_id ORDER BY created_at) AS prev_at
    FROM msgs
  ),
  starts AS (
    SELECT *,
      CASE WHEN direction = 'inbound'
             AND (prev_at IS NULL OR created_at - prev_at > ((SELECT hours FROM gap) || ' hours')::interval)
           THEN 1 ELSE 0 END AS is_start
    FROM ordered
  ),
  numbered AS (
    SELECT *, SUM(is_start) OVER (PARTITION BY conversation_id ORDER BY created_at ROWS UNBOUNDED PRECEDING) AS episode_no
    FROM starts
  )
  SELECT conversation_id,
         c_contact AS contact_id,
         c_channel AS channel_id,
         episode_no::integer,
         MIN(created_at) AS episode_start,
         MIN(created_at) FILTER (WHERE direction = 'inbound') AS first_inbound_at,
         MIN(created_at) FILTER (WHERE direction = 'outbound') AS first_outbound_at,
         (ARRAY_AGG(origin ORDER BY created_at) FILTER (WHERE direction = 'outbound'))[1] AS first_outbound_origin
  FROM numbered
  WHERE episode_no >= 1
  GROUP BY conversation_id, episode_no, c_contact, c_channel;
$$;

-- Filtro "respondido por" aplicado a los salientes: 'all'/NULL = todos;
-- 'agent'/'user'/'flow'/'sequence'/'broadcast'/'external' = ese origin;
-- un uuid = ese sent_by_user_id. Devuelve true si el saliente entra.
CREATE OR REPLACE FUNCTION public.chat_author_match(p_author text, p_origin text, p_sent_by_user uuid)
RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_author IS NULL OR p_author = 'all' THEN true
    WHEN p_author = 'automations' THEN p_origin IN ('flow', 'sequence', 'broadcast')
    WHEN p_author IN ('agent', 'user', 'external') THEN p_origin = p_author
    WHEN p_author ~ '^[0-9a-f-]{36}$' THEN p_sent_by_user::text = p_author
    ELSE false
  END;
$$;

-- Números principales (§11.1, §11.4). Un rango; la app llama dos veces para el
-- período anterior. Devuelve una fila.
CREATE OR REPLACE FUNCTION public.chat_dashboard_numbers(
  p_workspace_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_channel text DEFAULT NULL,
  p_author text DEFAULT NULL
)
RETURNS TABLE (
  new_conversations bigint,
  messages_in bigint,
  messages_out bigint,
  first_response_median_seconds numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH ep AS (
    SELECT * FROM public.chat_episodes(p_workspace_id, p_channel)
  ),
  msgs AS (
    SELECT m.direction, m.origin, m.sent_by_user_id, m.created_at
    FROM public.messages m
    JOIN public.conversations c ON c.id = m.conversation_id
    WHERE m.workspace_id = p_workspace_id AND c.deleted_at IS NULL
      AND (p_channel IS NULL OR c.channel_id::text = p_channel OR c.platform = p_channel)
      AND (p_from IS NULL OR m.created_at >= p_from)
      AND (p_to IS NULL OR m.created_at <= p_to)
  )
  SELECT
    (SELECT COUNT(*) FROM ep
       WHERE (p_from IS NULL OR episode_start >= p_from) AND (p_to IS NULL OR episode_start <= p_to)),
    (SELECT COUNT(*) FROM msgs WHERE direction = 'inbound'),
    (SELECT COUNT(*) FROM msgs WHERE direction = 'outbound'
       AND public.chat_author_match(p_author, origin, sent_by_user_id)),
    (SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (first_outbound_at - first_inbound_at)))
       FROM ep
       WHERE first_inbound_at IS NOT NULL AND first_outbound_at IS NOT NULL
         AND first_outbound_at >= first_inbound_at
         AND (p_from IS NULL OR episode_start >= p_from) AND (p_to IS NULL OR episode_start <= p_to));
$$;

-- Esperando respuesta ahora (§11.9): conversaciones abiertas, no borradas, sin
-- do_not_contact ni agent_disabled_by_tag_id, con último mensaje entrante de
-- hace más de 1 hora.
CREATE OR REPLACE FUNCTION public.chat_waiting_now(
  p_workspace_id uuid,
  p_channel text DEFAULT NULL
)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH last_msg AS (
    SELECT DISTINCT ON (m.conversation_id) m.conversation_id, m.direction, m.created_at
    FROM public.messages m
    JOIN public.conversations c ON c.id = m.conversation_id
    WHERE m.workspace_id = p_workspace_id
    ORDER BY m.conversation_id, m.created_at DESC
  )
  SELECT COUNT(*)
  FROM public.conversations c
  JOIN public.contacts ct ON ct.id = c.contact_id
  JOIN last_msg lm ON lm.conversation_id = c.id
  WHERE c.workspace_id = p_workspace_id
    AND c.deleted_at IS NULL
    AND c.status = 'open'
    AND c.agent_disabled_by_tag_id IS NULL
    AND COALESCE(ct.do_not_contact, false) = false
    AND lm.direction = 'inbound'
    AND lm.created_at < now() - interval '1 hour'
    AND (p_channel IS NULL OR c.channel_id::text = p_channel OR c.platform = p_channel);
$$;

-- Tabla "Quién responde" (§11.4, §15.2). Una fila por autor (agente + cada
-- persona). Tiempos en segundos (mediana). RLS aplica el scope.
CREATE OR REPLACE FUNCTION public.chat_dashboard_team(
  p_workspace_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_channel text DEFAULT NULL
)
RETURNS TABLE (
  author text,
  messages_out bigint,
  first_response_median_seconds numeric,
  reply_median_seconds numeric,
  replies_under_1h_pct numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH outs AS (
    SELECT
      CASE WHEN m.origin = 'user' THEN m.sent_by_user_id::text ELSE m.origin END AS author,
      m.conversation_id, m.created_at,
      LAG(m.direction) OVER (PARTITION BY m.conversation_id ORDER BY m.created_at) AS prev_dir,
      LAG(m.created_at) OVER (PARTITION BY m.conversation_id ORDER BY m.created_at) AS prev_at
    FROM public.messages m
    JOIN public.conversations c ON c.id = m.conversation_id
    WHERE m.workspace_id = p_workspace_id AND c.deleted_at IS NULL
      AND (p_channel IS NULL OR c.channel_id::text = p_channel OR c.platform = p_channel)
  ),
  replies AS (
    SELECT author, EXTRACT(EPOCH FROM (created_at - prev_at)) AS secs
    FROM outs
    WHERE prev_dir = 'inbound' AND author IS NOT NULL
      AND (p_from IS NULL OR created_at >= p_from) AND (p_to IS NULL OR created_at <= p_to)
  ),
  sent AS (
    SELECT author, COUNT(*) AS n
    FROM outs
    WHERE author IS NOT NULL
      AND (p_from IS NULL OR created_at >= p_from) AND (p_to IS NULL OR created_at <= p_to)
    GROUP BY author
  )
  SELECT s.author, s.n,
    (SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY secs) FROM replies r0 WHERE r0.author = s.author) AS first_resp,
    (SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY secs) FROM replies r1 WHERE r1.author = s.author) AS reply_med,
    (SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE secs < 3600) / NULLIF(COUNT(*), 0), 1) FROM replies r2 WHERE r2.author = s.author) AS under1h
  FROM sent s;
$$;

-- Sección del agente (§11.5): actuó, tomó desde el primer mensaje, derivó.
-- Sobre las conversaciones nuevas (episodios) del período.
CREATE OR REPLACE FUNCTION public.chat_dashboard_agent(
  p_workspace_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_channel text DEFAULT NULL
)
RETURNS TABLE (
  new_conversations bigint,
  agent_acted bigint,
  agent_took_first bigint,
  agent_escalated bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH ep AS (
    SELECT * FROM public.chat_episodes(p_workspace_id, p_channel)
    WHERE (p_from IS NULL OR episode_start >= p_from) AND (p_to IS NULL OR episode_start <= p_to)
  )
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE first_outbound_origin = 'agent'
      OR EXISTS (SELECT 1 FROM public.agent_drafts d WHERE d.conversation_id = ep.conversation_id)
      OR EXISTS (SELECT 1 FROM public.audit_log al WHERE al.entity_id = ep.conversation_id AND al.performed_by_agent_id IS NOT NULL)),
    COUNT(*) FILTER (WHERE first_outbound_origin = 'agent'),
    COUNT(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM public.agent_runs r WHERE r.conversation_id = ep.conversation_id AND r.status = 'escalated'))
  FROM ep;
$$;

REVOKE ALL ON FUNCTION public.chat_episodes(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chat_author_match(text, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chat_dashboard_numbers(uuid, timestamptz, timestamptz, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chat_waiting_now(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chat_dashboard_team(uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chat_dashboard_agent(uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_episodes(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_author_match(text, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_dashboard_numbers(uuid, timestamptz, timestamptz, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_waiting_now(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_dashboard_team(uuid, timestamptz, timestamptz, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_dashboard_agent(uuid, timestamptz, timestamptz, text) TO authenticated, service_role;

-- Series de tendencias por día (F16). La app agrupa a semanal si el período
-- supera 62 días. Corta los días en la zona que se pasa.
CREATE OR REPLACE FUNCTION public.chat_dashboard_trends(
  p_workspace_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_channel text DEFAULT NULL,
  p_author text DEFAULT NULL,
  p_tz text DEFAULT 'America/Costa_Rica'
)
RETURNS TABLE (day date, messages_in bigint, messages_out bigint, new_conversations bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH msgs AS (
    SELECT (m.created_at AT TIME ZONE p_tz)::date AS d, m.direction, m.origin, m.sent_by_user_id
    FROM public.messages m JOIN public.conversations c ON c.id = m.conversation_id
    WHERE m.workspace_id = p_workspace_id AND c.deleted_at IS NULL
      AND (p_channel IS NULL OR c.channel_id::text = p_channel OR c.platform = p_channel)
      AND (p_from IS NULL OR m.created_at >= p_from) AND (p_to IS NULL OR m.created_at <= p_to)
  ),
  eps AS (
    SELECT (episode_start AT TIME ZONE p_tz)::date AS d
    FROM public.chat_episodes(p_workspace_id, p_channel)
    WHERE (p_from IS NULL OR episode_start >= p_from) AND (p_to IS NULL OR episode_start <= p_to)
  ),
  days AS (
    SELECT d FROM msgs UNION SELECT d FROM eps
  )
  SELECT d,
    (SELECT COUNT(*) FROM msgs WHERE msgs.d = days.d AND direction = 'inbound'),
    (SELECT COUNT(*) FROM msgs WHERE msgs.d = days.d AND direction = 'outbound' AND public.chat_author_match(p_author, origin, sent_by_user_id)),
    (SELECT COUNT(*) FROM eps WHERE eps.d = days.d)
  FROM days ORDER BY d;
$$;

REVOKE ALL ON FUNCTION public.chat_dashboard_trends(uuid, timestamptz, timestamptz, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_dashboard_trends(uuid, timestamptz, timestamptz, text, text, text) TO authenticated, service_role;

-- ============================================================
-- MIGRATION 79: MESSAGE PATTERNS
-- ============================================================
-- ============================================================================
-- 00079 — Patrones de mensajes (Bloque 4, F19-F22)
-- ============================================================================
-- Agrupa los mensajes por lo que significan. Capa 1 gratis (normalización);
-- capa 2 con un LLM chico en lote (Bloque 4/5). Dos tablas nuevas
-- (message_categories, message_texts), la columna generada messages.text_norm
-- y un trigger que crea la fila del texto al entrar cada mensaje.
--
-- Idempotente y aditiva. El backfill solo inserta.
-- ============================================================================

-- 1. Tablas -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.message_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  name text NOT NULL,
  description text,
  examples text[] NOT NULL DEFAULT '{}',
  is_fallback boolean NOT NULL DEFAULT false,
  created_by text NOT NULL CHECK (created_by IN ('model', 'user', 'system')),
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  merged_into_id uuid REFERENCES public.message_categories(id) ON DELETE SET NULL,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_message_categories_name
  ON public.message_categories (workspace_id, direction, lower(name)) WHERE archived_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_message_categories_fallback
  ON public.message_categories (workspace_id, direction) WHERE is_fallback;

CREATE TABLE IF NOT EXISTS public.message_texts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  normalized_text text NOT NULL,
  sample_text text NOT NULL,
  category_id uuid REFERENCES public.message_categories(id) ON DELETE SET NULL,
  confidence numeric(3, 2),
  source text CHECK (source IN ('rule', 'model', 'human')),
  prompt_version integer,
  run_id uuid REFERENCES public.agent_runs(id) ON DELETE SET NULL,
  is_button boolean NOT NULL DEFAULT false,
  classified_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  review_result text CHECK (review_result IN ('ok', 'corrected')),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_message_texts_norm
  ON public.message_texts (workspace_id, direction, normalized_text);
CREATE INDEX IF NOT EXISTS idx_message_texts_category ON public.message_texts (workspace_id, category_id);
CREATE INDEX IF NOT EXISTS idx_message_texts_unclassified
  ON public.message_texts (workspace_id, direction) WHERE category_id IS NULL;

-- 2. Columna generada messages.text_norm -----------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'messages' AND column_name = 'text_norm') THEN
    ALTER TABLE public.messages ADD COLUMN text_norm text GENERATED ALWAYS AS (public.normalize_for_grouping(text)) STORED;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_messages_workspace_textnorm ON public.messages (workspace_id, direction, text_norm);

-- 3. RLS --------------------------------------------------------------------
ALTER TABLE public.message_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_texts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS message_categories_select ON public.message_categories;
CREATE POLICY message_categories_select ON public.message_categories FOR SELECT USING (public.is_workspace_member(workspace_id));
DROP POLICY IF EXISTS message_categories_write ON public.message_categories;
CREATE POLICY message_categories_write ON public.message_categories FOR ALL
  USING (public.is_workspace_admin(workspace_id)) WITH CHECK (public.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS message_texts_select ON public.message_texts;
CREATE POLICY message_texts_select ON public.message_texts FOR SELECT USING (public.is_workspace_member(workspace_id));
DROP POLICY IF EXISTS message_texts_write ON public.message_texts;
CREATE POLICY message_texts_write ON public.message_texts FOR ALL
  USING (public.is_workspace_admin(workspace_id)) WITH CHECK (public.is_workspace_admin(workspace_id));

-- 4. Categorías fallback por dirección --------------------------------------
INSERT INTO public.message_categories (workspace_id, direction, name, is_fallback, created_by)
SELECT w.id, d.dir, 'Otro', true, 'system'
FROM public.workspaces w CROSS JOIN (VALUES ('inbound'), ('outbound')) AS d(dir)
ON CONFLICT DO NOTHING;

INSERT INTO public.message_categories (workspace_id, direction, name, is_fallback, created_by)
SELECT w.id, d.dir, 'Solo emoji o adjunto', false, 'system'
FROM public.workspaces w CROSS JOIN (VALUES ('inbound'), ('outbound')) AS d(dir)
ON CONFLICT DO NOTHING;

-- 5. Trigger: cada mensaje con texto crea (o reusa) su fila ------------------
CREATE OR REPLACE FUNCTION public.messages_upsert_text()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_norm text;
  v_emoji_cat uuid;
BEGIN
  IF NEW.text IS NULL OR btrim(NEW.text) = '' THEN
    RETURN NEW;
  END IF;
  v_norm := public.normalize_for_grouping(NEW.text);

  IF v_norm = '' THEN
    -- Solo emoji/adjunto: va directo a su categoría con source rule.
    SELECT id INTO v_emoji_cat FROM public.message_categories
      WHERE workspace_id = NEW.workspace_id AND direction = NEW.direction AND name = 'Solo emoji o adjunto' LIMIT 1;
    INSERT INTO public.message_texts (workspace_id, direction, normalized_text, sample_text, category_id, source, first_seen_at)
    VALUES (NEW.workspace_id, NEW.direction, '', NEW.text, v_emoji_cat, 'rule', NEW.created_at)
    ON CONFLICT (workspace_id, direction, normalized_text) DO NOTHING;
  ELSE
    INSERT INTO public.message_texts (workspace_id, direction, normalized_text, sample_text, first_seen_at)
    VALUES (NEW.workspace_id, NEW.direction, v_norm, NEW.text, NEW.created_at)
    ON CONFLICT (workspace_id, direction, normalized_text) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS messages_upsert_text ON public.messages;
CREATE TRIGGER messages_upsert_text
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.messages_upsert_text();

-- 6. Backfill de message_texts con lo ya guardado --------------------------
-- Un texto distinto por (workspace, dirección, normalizado). sample_text = el
-- más viejo. first_seen_at = su primera aparición.
INSERT INTO public.message_texts (workspace_id, direction, normalized_text, sample_text, first_seen_at)
SELECT m.workspace_id, m.direction, public.normalize_for_grouping(m.text),
       (ARRAY_AGG(m.text ORDER BY m.created_at))[1],
       MIN(m.created_at)
FROM public.messages m
WHERE m.text IS NOT NULL AND btrim(m.text) <> ''
GROUP BY m.workspace_id, m.direction, public.normalize_for_grouping(m.text)
ON CONFLICT (workspace_id, direction, normalized_text) DO NOTHING;

-- Los textos vacíos (solo emoji/adjunto) van a su categoría con source rule.
UPDATE public.message_texts t
SET category_id = c.id, source = 'rule'
FROM public.message_categories c
WHERE t.normalized_text = '' AND t.category_id IS NULL
  AND c.workspace_id = t.workspace_id AND c.direction = t.direction AND c.name = 'Solo emoji o adjunto';

-- 7. Textos de botón conocidos (§10.6). Categoría inbound "Respuesta a botón",
-- para marcar con is_button = true y source = 'rule' los textos que la base
-- de CADA cliente use como botón (no los toca el modelo). La categoría es
-- generica y se crea siempre; los textos puntuales no se siembran aca: son
-- campaña de cada negocio, no del sistema (lib/agent/rules/known-buttons.ts,
-- hoy una lista vacia a proposito — ver docs/PROGRESS-white-label.md).
INSERT INTO public.message_categories (workspace_id, direction, name, description, is_fallback, created_by)
SELECT w.id, 'inbound', 'Respuesta a botón', 'Clic en un botón de ManyChat u otra automatización', false, 'system'
FROM public.workspaces w
ON CONFLICT DO NOTHING;

-- 8. Categorías de sistema al crear un workspace ----------------------------
-- Sin esto, un workspace nuevo (o el de prueba de verify-dashboards) no tiene
-- "Otro" ni "Solo emoji o adjunto", y el trigger de textos no puede clasificar
-- los emojis. Con esto cada workspace nace con sus categorías fallback.
CREATE OR REPLACE FUNCTION public.seed_message_categories()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.message_categories (workspace_id, direction, name, is_fallback, created_by)
  VALUES (NEW.id, 'inbound', 'Otro', true, 'system'), (NEW.id, 'outbound', 'Otro', true, 'system'),
         (NEW.id, 'inbound', 'Solo emoji o adjunto', false, 'system'), (NEW.id, 'outbound', 'Solo emoji o adjunto', false, 'system')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS seed_message_categories ON public.workspaces;
CREATE TRIGGER seed_message_categories AFTER INSERT ON public.workspaces FOR EACH ROW EXECUTE FUNCTION public.seed_message_categories();

-- 9. Patrones para el dashboard (F22): categorías con su volumen de mensajes y
-- las variantes principales. El volumen cuenta MENSAJES (no textos distintos).
CREATE OR REPLACE FUNCTION public.chat_dashboard_patterns(
  p_workspace_id uuid, p_direction text, p_from timestamptz, p_to timestamptz
)
RETURNS TABLE (category_id uuid, category_name text, is_fallback boolean, message_count bigint, text_count bigint, top_variants jsonb)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH msg_counts AS (
    SELECT m.text_norm, COUNT(*) AS n
    FROM public.messages m
    WHERE m.workspace_id = p_workspace_id AND m.direction = p_direction
      AND m.text_norm IS NOT NULL AND m.text_norm <> ''
      AND (p_from IS NULL OR m.created_at >= p_from) AND (p_to IS NULL OR m.created_at <= p_to)
    GROUP BY m.text_norm
  ),
  texts AS (
    SELECT t.id, t.category_id, t.normalized_text, t.sample_text, t.confidence, t.is_button,
           COALESCE(mc.n, 0) AS msg_n
    FROM public.message_texts t
    LEFT JOIN msg_counts mc ON mc.text_norm = t.normalized_text
    WHERE t.workspace_id = p_workspace_id AND t.direction = p_direction
  )
  SELECT c.id, c.name, c.is_fallback,
    COALESCE(SUM(t.msg_n), 0)::bigint AS message_count,
    COUNT(t.id)::bigint AS text_count,
    COALESCE((
      SELECT jsonb_agg(v) FROM (
        SELECT jsonb_build_object('text', t2.sample_text, 'count', t2.msg_n, 'confidence', t2.confidence, 'is_button', t2.is_button) AS v
        FROM texts t2 WHERE t2.category_id IS NOT DISTINCT FROM c.id ORDER BY t2.msg_n DESC LIMIT 5
      ) top
    ), '[]'::jsonb) AS top_variants
  FROM public.message_categories c
  LEFT JOIN texts t ON t.category_id = c.id
  WHERE c.workspace_id = p_workspace_id AND c.direction = p_direction AND c.archived_at IS NULL
  GROUP BY c.id, c.name, c.is_fallback
  ORDER BY COALESCE(SUM(t.msg_n), 0) DESC;
$$;
REVOKE ALL ON FUNCTION public.chat_dashboard_patterns(uuid, text, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_dashboard_patterns(uuid, text, timestamptz, timestamptz) TO authenticated, service_role;

-- ============================================================
-- MIGRATION 80: BACKGROUND TASKS
-- ============================================================
-- ============================================================================
-- 00080 — Tareas en segundo plano, calidad e intención (Bloque 5, F23-F26)
-- ============================================================================
--   1. workspaces.ai_background_settings (jsonb): modo de cada tarea de IA que
--      no es conversación en vivo (clasificación, resumen, cierre, indexación).
--   2. agent_runs.intent (jsonb): la intención que declara el agente en cada
--      turno (F26). Con GRANT SELECT (no es un costo).
--   3. Cron bg-dispatch y bg-collect cada 15 min + whitelist.
--
-- Idempotente y aditiva.
-- ============================================================================

ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS ai_background_settings jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.agent_runs ADD COLUMN IF NOT EXISTS intent jsonb;
GRANT SELECT (intent) ON public.agent_runs TO authenticated;
COMMENT ON COLUMN public.agent_runs.intent IS
  'Intención declarada por el agente en el turno (F26): { category_id, confidence }. null si no la declaró o el id no existe.';

CREATE OR REPLACE FUNCTION private.call_app_cron(p_path text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_base text; v_secret text;
BEGIN
  IF p_path NOT IN ('jobs', 'sequences', 'whatsapp-health', 'inactivity', 'automation-events', 'agent-bursts', 'drafts-refresh', 'bg-dispatch', 'bg-collect') THEN
    RAISE EXCEPTION 'ruta de cron no permitida: %', p_path;
  END IF;
  SELECT value INTO v_base FROM private.system_config WHERE key = 'app_url';
  SELECT value INTO v_secret FROM private.system_config WHERE key = 'cron_secret';
  IF v_base IS NULL OR v_secret IS NULL THEN
    RAISE WARNING 'private.system_config sin app_url o cron_secret: el cron "%" no se ejecuto', p_path;
    RETURN NULL;
  END IF;
  RETURN net.http_get(
    url => rtrim(v_base, '/') || '/api/cron/' || p_path,
    headers => jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json'),
    timeout_milliseconds => 60000);
END; $$;
REVOKE ALL ON FUNCTION private.call_app_cron(text) FROM PUBLIC, anon, authenticated;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'bg-dispatch') THEN PERFORM cron.unschedule('bg-dispatch'); END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'bg-collect') THEN PERFORM cron.unschedule('bg-collect'); END IF;
  PERFORM cron.schedule('bg-dispatch', '*/15 * * * *', $c$SELECT private.call_app_cron('bg-dispatch')$c$);
  PERFORM cron.schedule('bg-collect', '*/15 * * * *', $c$SELECT private.call_app_cron('bg-collect')$c$);
END $$;

-- ============================================================
-- MIGRATION 81: INTEGRATION TYPES ETAPA2
-- ============================================================
-- 00081 · Tipos de integracion de la etapa 2
--
-- `integration_configs` es la tabla generica de "toda configuracion y secreto de
-- un servicio externo, por workspace". La etapa 2 suma cuatro clases de
-- integracion: las redes que se conectan directo (LinkedIn, Threads), los
-- servicios que publican por nosotros (Postproxy), Google (YouTube) y Meta
-- (anuncios e insights de Instagram).
--
-- Es aditiva: solo amplia el CHECK. Ninguna fila existente cambia, y las tres
-- clases de la etapa 1 (`channel`, `ai_provider`, `email_provider`) siguen
-- valiendo. Correrla dos veces no falla.
--
-- La lista de valores tiene que coincidir con `IntegrationType` en
-- lib/types/database.ts.

DO $$
BEGIN
  -- Se reemplaza el CHECK entero en vez de sumar otro: dos CHECK sobre la misma
  -- columna se cumplen los dos a la vez, asi que el viejo seguiria rechazando
  -- los valores nuevos.
  ALTER TABLE public.integration_configs
    DROP CONSTRAINT IF EXISTS integration_configs_type_check;

  ALTER TABLE public.integration_configs
    ADD CONSTRAINT integration_configs_type_check
    CHECK (type IN (
      -- Etapa 1
      'channel',           -- Zernio (Instagram) y Evolution (WhatsApp)
      'ai_provider',       -- OpenAI, Anthropic, Google IA, Voyage
      'email_provider',    -- Resend (saliente) y Resend entrante (bloque 8)
      -- Etapa 2
      'social_network',    -- la red se conecta directo: LinkedIn, Threads
      'publishing_service',-- publica por nosotros: Postproxy
      'google',            -- cliente OAuth propio de Google (YouTube)
      'meta'               -- token de system user: anuncios e insights de Instagram
    ));
END;
$$;

COMMENT ON CONSTRAINT integration_configs_type_check ON public.integration_configs IS
  'Clases de integracion. Sumar una implica tocar IntegrationType en lib/types/database.ts y el catalogo en lib/integrations/providers.ts.';

-- ============================================================
-- MIGRATION 82: OAUTH AND SOCIAL ACCOUNTS
-- ============================================================
-- ============================================================================
-- 00082 — Conexiones OAuth y cuentas sociales (Etapa 2, Bloque 2)
-- ============================================================================
-- Dos tablas nuevas y un cron.
--
--  1. oauth_connections: una fila por proveedor conectado (Google, LinkedIn,
--     Threads). Guarda QUE se conecto y en que estado esta, nunca el token: los
--     tokens viven en Vault, y aca queda solo el prefijo con el que se arma su
--     nombre (`vault_secret_prefix`).
--
--     No hay tabla de `oauth_states`: el `state` del flujo es un token firmado
--     con vencimiento (F9), asi que no hay nada que guardar ni que purgar.
--
--  2. social_accounts: una cuenta por red (Instagram, TikTok, YouTube,
--     LinkedIn, Threads), con los datos del perfil que se muestran en la
--     pagina Social y `publishers jsonb` con por donde se puede publicar en
--     esa red y si esta disponible. Es un jsonb y no una tabla: son dos o tres
--     filas por cuenta, siempre se leen juntas y se reescriben enteras.
--
--  3. Cron semanal social-token-refresh: renueva los tokens largos antes de
--     que venzan (Threads vence a los 60 dias).
--
-- Todo por workspace y con RLS. Las dos tablas las escribe solo el servidor:
-- conectar una cuenta pasa siempre por una Server Action o una ruta OAuth, que
-- ya verifican el rol.
--
-- Idempotente.
-- ============================================================================

-- ------------------------------------------------------------
-- 1. oauth_connections
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.oauth_connections (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider             text NOT NULL,
  -- NULL = la conexion es del workspace (asi son todas en esta etapa).
  -- Con valor = es de una persona. Lo necesita Google Calendar en la etapa 4,
  -- donde cada uno conecta su propia agenda.
  user_id              uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  external_account_id  text,
  account_label        text,
  granted_scopes       text[] NOT NULL DEFAULT '{}',
  token_expires_at     timestamptz,
  refresh_expires_at   timestamptz,
  status               text NOT NULL DEFAULT 'active',
  last_error           text,
  last_refreshed_at    timestamptz,
  vault_secret_prefix  text NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.oauth_connections IS
  'Una fila por proveedor OAuth conectado. Los tokens NO estan aca: viven en Vault, con el nombre que arma vault_secret_prefix.';
COMMENT ON COLUMN public.oauth_connections.user_id IS
  'NULL = la conexion es del workspace. Con valor = de esa persona (Google Calendar, etapa 4). El unico por workspace+proveedor lo contempla.';
COMMENT ON COLUMN public.oauth_connections.granted_scopes IS
  'Los permisos que el proveedor otorgo DE VERDAD, no los que se pidieron. Un permiso que la persona destildo se ve aca.';
COMMENT ON COLUMN public.oauth_connections.status IS
  'active: anda. attention: hay algo que resolver (vence pronto, falta un permiso). revoked: el proveedor corto el acceso. error: la ultima operacion fallo.';
COMMENT ON COLUMN public.oauth_connections.vault_secret_prefix IS
  'Prefijo del nombre de sus secretos en Vault: <prefijo>_access_token y <prefijo>_refresh_token.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'oauth_connections_provider_check') THEN
    ALTER TABLE public.oauth_connections ADD CONSTRAINT oauth_connections_provider_check
      CHECK (provider IN ('google', 'linkedin', 'threads'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'oauth_connections_status_check') THEN
    ALTER TABLE public.oauth_connections ADD CONSTRAINT oauth_connections_status_check
      CHECK (status IN ('active', 'attention', 'revoked', 'error'));
  END IF;
END $$;

-- Una conexion por proveedor y por persona. Un indice de expresion y no un
-- UNIQUE comun porque en SQL dos NULL no chocan entre si: sin el coalesce se
-- podrian crear dos conexiones del workspace para el mismo proveedor.
CREATE UNIQUE INDEX IF NOT EXISTS uq_oauth_connections_ws_provider_user
  ON public.oauth_connections (
    workspace_id,
    provider,
    coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

-- El cron de renovacion busca lo que vence pronto.
CREATE INDEX IF NOT EXISTS idx_oauth_connections_expiring
  ON public.oauth_connections (token_expires_at)
  WHERE status IN ('active', 'attention');

DROP TRIGGER IF EXISTS set_updated_at ON public.oauth_connections;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.oauth_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.oauth_connections ENABLE ROW LEVEL SECURITY;

-- Solo Owner/Admin la leen: dice con que cuenta esta conectado el negocio y
-- que permisos dio. Escribir es solo del servidor (service role): conectar
-- pasa por la ruta de OAuth, que verifica el rol antes de empezar.
DROP POLICY IF EXISTS "oauth_connections_select" ON public.oauth_connections;
CREATE POLICY "oauth_connections_select" ON public.oauth_connections
  FOR SELECT USING (public.is_workspace_admin(workspace_id));

-- ------------------------------------------------------------
-- 2. social_accounts
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.social_accounts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  platform          text NOT NULL,
  handle            text,
  username          text,
  display_name      text,
  avatar_url        text,
  bio               text,
  profile_url       text,
  website           text,
  external_id       text,
  -- Instagram entra por Zernio y ademas tiene bandeja: es la misma cuenta.
  channel_id        uuid REFERENCES public.channels(id) ON DELETE SET NULL,
  default_publisher text,
  publishers        jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active         boolean NOT NULL DEFAULT true,
  profile_synced_at timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.social_accounts IS
  'Una cuenta por red social del workspace: por donde se publica y que se muestra en la pagina Social.';
COMMENT ON COLUMN public.social_accounts.publishers IS
  'Por donde se puede publicar en esta red: [{ publisher, account_ref, status, status_reason, verified_at, manually_enabled }]. Se valida con Zod al escribir.';
COMMENT ON COLUMN public.social_accounts.default_publisher IS
  'Cual se usa si no se elige otro. Si deja de estar disponible, el sistema pasa al siguiente y avisa.';
COMMENT ON COLUMN public.social_accounts.channel_id IS
  'El canal de la bandeja, cuando la misma cuenta ademas conversa (Instagram por Zernio).';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'social_accounts_platform_check') THEN
    ALTER TABLE public.social_accounts ADD CONSTRAINT social_accounts_platform_check
      CHECK (platform IN ('instagram', 'tiktok', 'youtube', 'linkedin', 'threads'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'social_accounts_publishers_array') THEN
    ALTER TABLE public.social_accounts ADD CONSTRAINT social_accounts_publishers_array
      CHECK (jsonb_typeof(publishers) = 'array');
  END IF;
END $$;

-- Una cuenta por red en esta etapa (varias cuentas de la misma red estan fuera
-- de alcance, §17).
CREATE UNIQUE INDEX IF NOT EXISTS uq_social_accounts_ws_platform
  ON public.social_accounts (workspace_id, platform);

CREATE INDEX IF NOT EXISTS idx_social_accounts_ws_active
  ON public.social_accounts (workspace_id, is_active);

DROP TRIGGER IF EXISTS set_updated_at ON public.social_accounts;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.social_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.social_accounts ENABLE ROW LEVEL SECURITY;

-- La leen todos los miembros: el editor de contenido necesita saber a que
-- redes se puede publicar. No hay nada sensible (usuario, foto, bio).
DROP POLICY IF EXISTS "social_accounts_select" ON public.social_accounts;
CREATE POLICY "social_accounts_select" ON public.social_accounts
  FOR SELECT USING (public.is_workspace_member(workspace_id));

-- Escribir es de Owner/Admin: cambia por donde publica todo el negocio.
DROP POLICY IF EXISTS "social_accounts_insert" ON public.social_accounts;
CREATE POLICY "social_accounts_insert" ON public.social_accounts
  FOR INSERT WITH CHECK (public.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "social_accounts_update" ON public.social_accounts;
CREATE POLICY "social_accounts_update" ON public.social_accounts
  FOR UPDATE USING (public.is_workspace_admin(workspace_id))
  WITH CHECK (public.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "social_accounts_delete" ON public.social_accounts;
CREATE POLICY "social_accounts_delete" ON public.social_accounts
  FOR DELETE USING (public.is_workspace_admin(workspace_id));

-- ------------------------------------------------------------
-- 3. Cron semanal de renovacion de tokens
-- ------------------------------------------------------------
-- Cada cron nuevo redefine call_app_cron con la lista blanca ampliada: la
-- funcion solo acepta rutas de esa lista, para no ser un trampolin hacia
-- cualquier URL de la app con el secreto adjunto.

-- Se copia la definicion vigente (00080) tal cual y solo se suma la ruta: la
-- firma, el tipo de retorno y el comportamiento tienen que quedar iguales.
-- Cambiar el tipo de retorno directamente no se puede (hay que DROP primero),
-- y cambiar el aviso por una excepcion haria fallar todos los crons el dia que
-- falte una fila de configuracion.
CREATE OR REPLACE FUNCTION private.call_app_cron(p_path text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_base text; v_secret text;
BEGIN
  IF p_path NOT IN (
    'jobs', 'sequences', 'whatsapp-health', 'inactivity', 'automation-events',
    'agent-bursts', 'drafts-refresh', 'bg-dispatch', 'bg-collect',
    'social-token-refresh'
  ) THEN
    RAISE EXCEPTION 'ruta de cron no permitida: %', p_path;
  END IF;
  SELECT value INTO v_base FROM private.system_config WHERE key = 'app_url';
  SELECT value INTO v_secret FROM private.system_config WHERE key = 'cron_secret';
  IF v_base IS NULL OR v_secret IS NULL THEN
    RAISE WARNING 'private.system_config sin app_url o cron_secret: el cron "%" no se ejecuto', p_path;
    RETURN NULL;
  END IF;
  RETURN net.http_get(
    url => rtrim(v_base, '/') || '/api/cron/' || p_path,
    headers => jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json'),
    timeout_milliseconds => 60000
  );
END; $function$;

-- Lunes a las 4:40 UTC. Los tokens largos duran 60 dias y se renuevan cuando
-- quedan menos de 15: una vez por semana alcanza de sobra.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'social-token-refresh') THEN
    PERFORM cron.unschedule('social-token-refresh');
  END IF;
  PERFORM cron.schedule(
    'social-token-refresh',
    '40 4 * * 1',
    $cron$SELECT private.call_app_cron('social-token-refresh')$cron$
  );
END $$;

-- ============================================================
-- MIGRATION 83: CONTENT PIPELINE
-- ============================================================
-- ============================================================================
-- 00083 — Pipeline de contenido (Etapa 2, Bloque 3)
-- ============================================================================
-- Cuatro tablas, un bucket y un cron.
--
--  1. content_ideas: la idea antes de ser post. Tiene su propio estado
--     (nueva / aprobada / descartada) porque aprobarla es una decision, y una
--     idea puede originar varios posts.
--
--  2. content_posts: la PIEZA. Un copy (el guion para grabar), un caption
--     base, la media, y `networks jsonb` con lo propio de cada red: su fecha
--     tentativa, su caption, su CTA y sus opciones. El estado del post se
--     deriva de sus publicaciones a partir de "programado" (§9.4).
--
--  3. content_post_versions: el historial. Nada se pisa sin dejar version.
--
--  4. social_posts: UNA FILA POR RED Y POST, creada al PROGRAMAR esa red.
--     Es la frontera entre "planeado" y "en la cola": mientras la fecha vive
--     en el jsonb es tentativa y no hay nada agendado. Tambien entran aca las
--     publicaciones hechas a mano fuera del sistema (`origin = 'external'`),
--     que aparecen en metricas y en la pagina Social pero no en el kanban.
--     Las columnas de engagement a 7 dias se crean desde ahora para no volver
--     a tocar la tabla en el bloque 5.
--
--  5. Bucket `content-media` CON policies por workspace. Es el primer bucket
--     del proyecto que las tiene, y hace falta: la subida va directo del
--     navegador a Storage con el JWT de la persona (un video de 1 GB no puede
--     pasar por una Server Action), asi que la base tiene que decidir quien
--     escribe donde. La regla es el primer segmento del path: <workspace_id>/…
--
--  6. Cron diario de limpieza de media publicada.
--
-- Idempotente.
-- ============================================================================

-- ------------------------------------------------------------
-- 1. Ideas
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.content_ideas (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  title             text NOT NULL,
  hook              text,
  angle             text,
  format            text,
  pillar            text,
  reference         text,
  notes             text,
  status            text NOT NULL DEFAULT 'nueva',
  source            text NOT NULL DEFAULT 'manual',
  position          integer NOT NULL DEFAULT 0,
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at       timestamptz,
  discarded_reason  text,
  -- Reservados para la etapa 3 (agentes): se crean vacios para no migrar
  -- despues una tabla con datos.
  score             numeric,
  target_audience   text,
  awareness_level   text,
  embedding         vector(1024),
  deleted_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.content_ideas IS
  'Ideas de contenido. Aprobar una crea un post; una idea puede originar varios.';
COMMENT ON COLUMN public.content_ideas.source IS
  'manual: la escribio una persona. agent: la propuso un agente (etapa 3).';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_ideas_status_check') THEN
    ALTER TABLE public.content_ideas ADD CONSTRAINT content_ideas_status_check
      CHECK (status IN ('nueva', 'aprobada', 'descartada'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_ideas_source_check') THEN
    ALTER TABLE public.content_ideas ADD CONSTRAINT content_ideas_source_check
      CHECK (source IN ('manual', 'agent'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_content_ideas_board
  ON public.content_ideas (workspace_id, status, position)
  WHERE deleted_at IS NULL;

-- ------------------------------------------------------------
-- 2. Posts
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.content_posts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  idea_id          uuid REFERENCES public.content_ideas(id) ON DELETE SET NULL,
  title            text NOT NULL,
  format           text,
  copy             jsonb NOT NULL DEFAULT '{}'::jsonb,
  caption          text,
  networks         jsonb NOT NULL DEFAULT '[]'::jsonb,
  media            jsonb NOT NULL DEFAULT '[]'::jsonb,
  material_status  text NOT NULL DEFAULT 'pendiente',
  copy_source      text NOT NULL DEFAULT 'manual',
  ai_unreviewed    boolean NOT NULL DEFAULT false,
  status           text NOT NULL DEFAULT 'draft',
  current_version  integer NOT NULL DEFAULT 0,
  position         integer NOT NULL DEFAULT 0,
  created_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at      timestamptz,
  review_note      text,
  source           text NOT NULL DEFAULT 'manual',
  archived_at      timestamptz,
  deleted_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.content_posts IS
  'Una pieza de contenido: un copy, un caption y las redes donde va. El estado desde "scheduled" se deriva de sus filas en social_posts.';
COMMENT ON COLUMN public.content_posts.copy IS
  'El guion para grabar: { hook, body, cta, recording_notes }.';
COMMENT ON COLUMN public.content_posts.networks IS
  'Lo propio de cada red: [{ platform, planned_at, caption, media, cta, options, publisher, youtube_title }]. planned_at es TENTATIVA: mientras viva solo aca, no hay nada en la cola.';
COMMENT ON COLUMN public.content_posts.media IS
  'La media base: [{ storage_path, mime_type, kind, size_bytes, ... , deleted_at }].';
COMMENT ON COLUMN public.content_posts.material_status IS
  'Como viene la grabacion: pendiente, grabado, editado, listo. Marcar "grabado" mueve el post a En produccion.';
COMMENT ON COLUMN public.content_posts.copy_source IS
  'Quien escribio el copy: manual, ai, o mixed (la IA lo escribio y una persona lo edito).';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_posts_status_check') THEN
    ALTER TABLE public.content_posts ADD CONSTRAINT content_posts_status_check
      CHECK (status IN (
        'draft', 'in_production', 'in_review', 'approved',
        'scheduled', 'publishing', 'published', 'partially_published', 'failed'
      ));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_posts_material_check') THEN
    ALTER TABLE public.content_posts ADD CONSTRAINT content_posts_material_check
      CHECK (material_status IN ('pendiente', 'grabado', 'editado', 'listo'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_posts_copy_source_check') THEN
    ALTER TABLE public.content_posts ADD CONSTRAINT content_posts_copy_source_check
      CHECK (copy_source IN ('manual', 'ai', 'mixed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_posts_source_check') THEN
    ALTER TABLE public.content_posts ADD CONSTRAINT content_posts_source_check
      CHECK (source IN ('manual', 'agent'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_posts_networks_array') THEN
    ALTER TABLE public.content_posts ADD CONSTRAINT content_posts_networks_array
      CHECK (jsonb_typeof(networks) = 'array');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_posts_media_array') THEN
    ALTER TABLE public.content_posts ADD CONSTRAINT content_posts_media_array
      CHECK (jsonb_typeof(media) = 'array');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_content_posts_board
  ON public.content_posts (workspace_id, status, position)
  WHERE deleted_at IS NULL AND archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_content_posts_idea
  ON public.content_posts (idea_id)
  WHERE idea_id IS NOT NULL;

-- ------------------------------------------------------------
-- 3. Versiones
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.content_post_versions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  post_id      uuid NOT NULL REFERENCES public.content_posts(id) ON DELETE CASCADE,
  version_no   integer NOT NULL,
  snapshot     jsonb NOT NULL,
  author_kind  text NOT NULL DEFAULT 'human',
  author_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reason       text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.content_post_versions IS
  'Historial del post. Restaurar crea una version nueva: nunca se borra una.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_post_versions_author_check') THEN
    ALTER TABLE public.content_post_versions ADD CONSTRAINT content_post_versions_author_check
      CHECK (author_kind IN ('human', 'ai', 'system'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_post_versions_reason_check') THEN
    ALTER TABLE public.content_post_versions ADD CONSTRAINT content_post_versions_reason_check
      CHECK (reason IN ('status_change', 'manual_save', 'resume_after_idle', 'ai_generation', 'restore'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_content_post_versions_no
  ON public.content_post_versions (post_id, version_no);

-- ------------------------------------------------------------
-- 4. Publicaciones por red
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.social_posts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  content_post_id      uuid REFERENCES public.content_posts(id) ON DELETE CASCADE,
  social_account_id    uuid REFERENCES public.social_accounts(id) ON DELETE SET NULL,
  platform             text NOT NULL,
  publisher            text,
  publisher_ref        text,
  origin               text NOT NULL DEFAULT 'system',
  status               text,
  scheduled_at         timestamptz,
  attempts             integer NOT NULL DEFAULT 0,
  last_error           text,
  last_error_kind      text,
  requested_visibility text,
  actual_visibility    text,
  warning              text,
  external_post_id     text,
  url                  text,
  published_at         timestamptz,
  caption              text,
  media_type           text,
  thumbnail_url        text,
  last_synced_at       timestamptz,
  sync_error           text,
  -- Engagement comparable a 7 dias (F45). Se crean ahora para no volver a
  -- tocar la tabla en el bloque 5.
  engagement_d7        numeric,
  interactions_d7      integer,
  reach_d7             integer,
  views_d7             integer,
  d7_computed_at       timestamptz,
  deleted_at           timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.social_posts IS
  'Una fila por red y post, creada al PROGRAMAR esa red. Tambien entran las publicaciones hechas a mano (origin = external), que aparecen en metricas y en Social pero no en el kanban. Solo la escribe el servidor.';
COMMENT ON COLUMN public.social_posts.status IS
  'scheduled, publishing, published, failed, cancelled. NULL en las externas: nunca pasaron por nuestra cola.';
COMMENT ON COLUMN public.social_posts.last_error_kind IS
  'temporary: reintentar tiene sentido. permanent: no va a mejorar solo.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'social_posts_platform_check') THEN
    ALTER TABLE public.social_posts ADD CONSTRAINT social_posts_platform_check
      CHECK (platform IN ('instagram', 'tiktok', 'youtube', 'linkedin', 'threads'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'social_posts_origin_check') THEN
    ALTER TABLE public.social_posts ADD CONSTRAINT social_posts_origin_check
      CHECK (origin IN ('system', 'external'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'social_posts_status_check') THEN
    ALTER TABLE public.social_posts ADD CONSTRAINT social_posts_status_check
      CHECK (status IS NULL OR status IN ('scheduled', 'publishing', 'published', 'failed', 'cancelled'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'social_posts_error_kind_check') THEN
    ALTER TABLE public.social_posts ADD CONSTRAINT social_posts_error_kind_check
      CHECK (last_error_kind IS NULL OR last_error_kind IN ('temporary', 'permanent'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'social_posts_media_type_check') THEN
    ALTER TABLE public.social_posts ADD CONSTRAINT social_posts_media_type_check
      CHECK (media_type IS NULL OR media_type IN ('image', 'carousel', 'reel', 'story', 'video', 'short', 'text', 'document'));
  END IF;
END $$;

-- Una pieza no puede tener dos publicaciones en la misma red. Parcial: las
-- externas no tienen content_post_id, y varias con NULL no deben chocar.
CREATE UNIQUE INDEX IF NOT EXISTS uq_social_posts_content_platform
  ON public.social_posts (content_post_id, platform)
  WHERE content_post_id IS NOT NULL AND deleted_at IS NULL;

-- El mismo post de la red no se guarda dos veces (lo escribe la recoleccion
-- de metricas y tambien el webhook).
CREATE UNIQUE INDEX IF NOT EXISTS uq_social_posts_account_external
  ON public.social_posts (social_account_id, external_post_id)
  WHERE external_post_id IS NOT NULL;

-- Para contar cuotas por publicador y mes.
CREATE INDEX IF NOT EXISTS idx_social_posts_publisher
  ON public.social_posts (workspace_id, publisher, published_at);

CREATE INDEX IF NOT EXISTS idx_social_posts_scheduled
  ON public.social_posts (workspace_id, status, scheduled_at)
  WHERE status IN ('scheduled', 'publishing');

-- ------------------------------------------------------------
-- 5. Retencion de media y triggers de updated_at
-- ------------------------------------------------------------

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS content_media_retention_days integer NOT NULL DEFAULT 30;

COMMENT ON COLUMN public.workspaces.content_media_retention_days IS
  'Dias que se conserva la media despues de publicada. 0 = no se borra nunca.';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['content_ideas', 'content_posts', 'social_posts'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.update_updated_at()',
      t
    );
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 6. RLS
-- ------------------------------------------------------------
-- El contenido NO tiene scope de leads: una pieza es del negocio, no de un
-- contacto. Todos los miembros la ven. Lo que cambia por rol es quien puede
-- APROBAR y PROGRAMAR, que es donde se decide que sale publicado.
--
-- Un Member crea y edita LO SUYO mientras esta en borrador, en produccion o
-- en revision. Desde aprobado en adelante es de Owner/Admin: si pudiera
-- editar un post aprobado, la aprobacion no querria decir nada.

ALTER TABLE public.content_ideas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "content_ideas_select" ON public.content_ideas;
CREATE POLICY "content_ideas_select" ON public.content_ideas
  FOR SELECT USING (public.is_workspace_member(workspace_id) AND deleted_at IS NULL);

DROP POLICY IF EXISTS "content_ideas_insert" ON public.content_ideas;
CREATE POLICY "content_ideas_insert" ON public.content_ideas
  FOR INSERT WITH CHECK (
    public.is_workspace_member(workspace_id)
    -- Una idea nace 'nueva'. Nadie crea una ya aprobada saltandose el paso.
    AND status = 'nueva'
    AND (public.is_workspace_admin(workspace_id) OR created_by = auth.uid())
  );

DROP POLICY IF EXISTS "content_ideas_update" ON public.content_ideas;
CREATE POLICY "content_ideas_update" ON public.content_ideas
  FOR UPDATE USING (
    public.is_workspace_admin(workspace_id)
    OR (public.is_workspace_member(workspace_id) AND created_by = auth.uid() AND status = 'nueva')
  )
  WITH CHECK (
    -- Aprobar o descartar es de Owner/Admin: es la decision, no la edicion.
    public.is_workspace_admin(workspace_id)
    OR (created_by = auth.uid() AND status = 'nueva')
  );

DROP POLICY IF EXISTS "content_ideas_delete" ON public.content_ideas;
CREATE POLICY "content_ideas_delete" ON public.content_ideas
  FOR DELETE USING (public.is_workspace_admin(workspace_id));

ALTER TABLE public.content_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "content_posts_select" ON public.content_posts;
CREATE POLICY "content_posts_select" ON public.content_posts
  FOR SELECT USING (public.is_workspace_member(workspace_id) AND deleted_at IS NULL);

DROP POLICY IF EXISTS "content_posts_insert" ON public.content_posts;
CREATE POLICY "content_posts_insert" ON public.content_posts
  FOR INSERT WITH CHECK (
    public.is_workspace_member(workspace_id)
    AND (
      public.is_workspace_admin(workspace_id)
      OR (created_by = auth.uid() AND status IN ('draft', 'in_production', 'in_review'))
    )
  );

DROP POLICY IF EXISTS "content_posts_update" ON public.content_posts;
CREATE POLICY "content_posts_update" ON public.content_posts
  FOR UPDATE USING (
    public.is_workspace_admin(workspace_id)
    OR (
      public.is_workspace_member(workspace_id)
      AND created_by = auth.uid()
      AND status IN ('draft', 'in_production', 'in_review')
    )
  )
  WITH CHECK (
    public.is_workspace_admin(workspace_id)
    OR (
      created_by = auth.uid()
      -- El Member puede mover su post entre esos tres estados, y nada mas.
      -- Pasar a 'approved' o 'scheduled' por la API directa se rechaza aca,
      -- no solo en la pantalla.
      AND status IN ('draft', 'in_production', 'in_review')
    )
  );

DROP POLICY IF EXISTS "content_posts_delete" ON public.content_posts;
CREATE POLICY "content_posts_delete" ON public.content_posts
  FOR DELETE USING (public.is_workspace_admin(workspace_id));

ALTER TABLE public.content_post_versions ENABLE ROW LEVEL SECURITY;

-- Las versiones se leen pero no se escriben desde el navegador: las crea el
-- servidor cuando corresponde, y el recorte a 50 tambien.
DROP POLICY IF EXISTS "content_post_versions_select" ON public.content_post_versions;
CREATE POLICY "content_post_versions_select" ON public.content_post_versions
  FOR SELECT USING (public.is_workspace_member(workspace_id));

-- social_posts: RLS activa y SELECT para miembros. Escribir es solo del
-- servidor (deny-all sin policy), porque una fila aca es una publicacion
-- agendada de verdad.
ALTER TABLE public.social_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "social_posts_select" ON public.social_posts;
CREATE POLICY "social_posts_select" ON public.social_posts
  FOR SELECT USING (public.is_workspace_member(workspace_id) AND deleted_at IS NULL);

-- ------------------------------------------------------------
-- 7. Bucket de media, con policies por workspace
-- ------------------------------------------------------------
-- A diferencia de `knowledge`, este bucket SI tiene policies. La razon es
-- concreta: la media se sube directo del navegador a Storage (un video de
-- 1 GB no puede pasar por una Server Action, y con TUS va en partes), asi que
-- quien autoriza la escritura es la base y no nuestro codigo.
--
-- La regla es el PRIMER SEGMENTO del path: <workspace_id>/<post_id>/<archivo>.
-- storage.foldername(name) devuelve los segmentos; el primero tiene que ser un
-- workspace del que la persona sea miembro.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'content-media',
  'content-media',
  false,
  1073741824,  -- 1 GB
  ARRAY[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'video/mp4', 'video/quicktime',
    'application/pdf'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- Si ya existia, se fuerzan las tres cosas que no son negociables.
UPDATE storage.buckets
SET
  public = false,
  file_size_limit = 1073741824,
  allowed_mime_types = ARRAY[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'video/mp4', 'video/quicktime',
    'application/pdf'
  ]
WHERE id = 'content-media';

DROP POLICY IF EXISTS "content_media_select" ON storage.objects;
CREATE POLICY "content_media_select" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'content-media'
    AND public.is_workspace_member(((storage.foldername(name))[1])::uuid)
  );

DROP POLICY IF EXISTS "content_media_insert" ON storage.objects;
CREATE POLICY "content_media_insert" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'content-media'
    AND public.is_workspace_member(((storage.foldername(name))[1])::uuid)
  );

DROP POLICY IF EXISTS "content_media_update" ON storage.objects;
CREATE POLICY "content_media_update" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'content-media'
    AND public.is_workspace_member(((storage.foldername(name))[1])::uuid)
  );

-- Borrar es de Owner/Admin: sacar la media de un post publicado rompe lo que
-- se ve en la red.
DROP POLICY IF EXISTS "content_media_delete" ON storage.objects;
CREATE POLICY "content_media_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'content-media'
    AND public.is_workspace_admin(((storage.foldername(name))[1])::uuid)
  );

-- ------------------------------------------------------------
-- 8. Cron diario de limpieza de media
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.call_app_cron(p_path text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_base text; v_secret text;
BEGIN
  IF p_path NOT IN (
    'jobs', 'sequences', 'whatsapp-health', 'inactivity', 'automation-events',
    'agent-bursts', 'drafts-refresh', 'bg-dispatch', 'bg-collect',
    'social-token-refresh', 'content-media-cleanup'
  ) THEN
    RAISE EXCEPTION 'ruta de cron no permitida: %', p_path;
  END IF;
  SELECT value INTO v_base FROM private.system_config WHERE key = 'app_url';
  SELECT value INTO v_secret FROM private.system_config WHERE key = 'cron_secret';
  IF v_base IS NULL OR v_secret IS NULL THEN
    RAISE WARNING 'private.system_config sin app_url o cron_secret: el cron "%" no se ejecuto', p_path;
    RETURN NULL;
  END IF;
  RETURN net.http_get(
    url => rtrim(v_base, '/') || '/api/cron/' || p_path,
    headers => jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json'),
    timeout_milliseconds => 60000
  );
END; $function$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'content-media-cleanup') THEN
    PERFORM cron.unschedule('content-media-cleanup');
  END IF;
  PERFORM cron.schedule(
    'content-media-cleanup',
    '50 5 * * *',
    $cron$SELECT private.call_app_cron('content-media-cleanup')$cron$
  );
END $$;

-- ============================================================
-- MIGRATION 84: APPROVE CONTENT IDEA
-- ============================================================
-- ============================================================================
-- 00084 — Aprobar una idea, en una sola transaccion (Etapa 2, F19)
-- ============================================================================
-- Aprobar hace DOS cosas: crea el post y marca la idea aprobada. Hacerlas con
-- dos llamadas desde la app deja una ventana donde puede quedar la idea
-- aprobada sin post (o al reves, un post huerfano). Una funcion plpgsql corre
-- entera en una transaccion: o pasan las dos o no pasa ninguna.
--
-- SECURITY INVOKER a proposito, que es el default: asi las dos escrituras
-- pasan por la RLS de quien llama. Un Member que intente aprobar rebota en el
-- UPDATE de content_ideas, igual que si lo hiciera por la API directa. Con
-- SECURITY DEFINER habria que reimplementar el permiso adentro, y esa copia es
-- justo lo que se desincroniza.
--
-- Idempotente.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.approve_content_idea(
  p_idea_id    uuid,
  p_title      text,
  p_format     text,
  p_copy       jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_idea   public.content_ideas%ROWTYPE;
  v_post_id uuid;
BEGIN
  -- La lectura ya pasa por la RLS: si no la puede ver, no existe para el.
  SELECT * INTO v_idea FROM public.content_ideas WHERE id = p_idea_id AND deleted_at IS NULL;

  IF v_idea.id IS NULL THEN
    RAISE EXCEPTION 'idea_no_encontrada';
  END IF;

  -- Aprobar dos veces crearia dos posts de la misma idea sin que nadie lo
  -- pidiera (un doble clic alcanza).
  IF v_idea.status <> 'nueva' THEN
    RAISE EXCEPTION 'idea_ya_decidida';
  END IF;

  INSERT INTO public.content_posts (
    workspace_id, idea_id, title, format, copy, status, created_by, position
  )
  VALUES (
    v_idea.workspace_id, v_idea.id, p_title, p_format, p_copy, 'draft', auth.uid(),
    -- Al final de la columna Borrador.
    coalesce((
      SELECT max(position) + 10 FROM public.content_posts
      WHERE workspace_id = v_idea.workspace_id AND status = 'draft' AND deleted_at IS NULL
    ), 10)
  )
  RETURNING id INTO v_post_id;

  UPDATE public.content_ideas
  SET status = 'aprobada', approved_by = auth.uid(), approved_at = now()
  WHERE id = v_idea.id;

  -- Si la RLS no dejo actualizar la idea, la insercion del post se deshace con
  -- la transaccion: no queda un post de una idea que sigue sin aprobar.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sin_permiso_para_aprobar';
  END IF;

  RETURN v_post_id;
END;
$$;

COMMENT ON FUNCTION public.approve_content_idea(uuid, text, text, jsonb) IS
  'Crea el post y marca la idea aprobada en una sola transaccion (F19). SECURITY INVOKER: la RLS decide si puede.';

REVOKE ALL ON FUNCTION public.approve_content_idea(uuid, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_content_idea(uuid, text, text, jsonb) TO authenticated, service_role;

-- ============================================================
-- MIGRATION 85: CONTENT AI
-- ============================================================
-- ============================================================================
-- 00085 — Generar copy con IA (Etapa 2, F29)
-- ============================================================================
-- Dos cosas, las dos aditivas:
--
--  1. `agent_runs.source` acepta dos fuentes nuevas: `content_copy` (generar
--     guion y caption) y `ads_analysis` (el "Analizar con IA" del bloque 7).
--     Toda llamada a un modelo pasa por openAiRun y queda registrada con su
--     costo; sin ampliar el CHECK, el registro falla y la generacion se cae
--     por un motivo que no tiene nada que ver.
--
--     La 00059 ademas exige que `agent_id` sea null salvo para `agent` y
--     `conversation_summary`. Las fuentes nuevas no tienen agente, asi que esa
--     regla ya las cubre y no hay que tocarla.
--
--  2. `workspaces.content_copy_settings`: la voz de marca. Es lo que hace que
--     el guion suene al negocio y no a un modelo generico, y es por workspace
--     porque cada negocio habla distinto.
--
-- Idempotente.
-- ============================================================================

DO $$
BEGIN
  ALTER TABLE public.agent_runs DROP CONSTRAINT IF EXISTS agent_runs_source_check;

  ALTER TABLE public.agent_runs
    ADD CONSTRAINT agent_runs_source_check
    CHECK (source IN (
      'agent',
      'flow_ai_node',
      'sequence_ai_step',
      'kb_indexing',
      'conversation_summary',
      'message_classification',
      'message_classification_eval',
      -- Etapa 2
      'content_copy',
      'ads_analysis'
    ));
END $$;

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS content_copy_settings jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.workspaces.content_copy_settings IS
  'Voz de marca para generar copy: { voice, audience, examples[], avoid }. Vacio = se genera sin guia de estilo.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspaces_content_copy_settings_object') THEN
    ALTER TABLE public.workspaces ADD CONSTRAINT workspaces_content_copy_settings_object
      CHECK (jsonb_typeof(content_copy_settings) = 'object');
  END IF;
END $$;

-- ============================================================
-- MIGRATION 86: METRICS COMMENTS ADS
-- ============================================================
-- ============================================================
-- 00086: metricas, comentarios y anuncios (F41, bloque 5)
-- ============================================================
--
-- Cuatro tablas de SOLO LECTURA para la aplicacion: las escribe el servidor
-- desde los lectores de cada red, y nadie las edita a mano.
--
-- Tres decisiones que se repiten en las cuatro:
--
--  1. **Una fila por dia y objeto, con valores ACUMULADOS a ese dia.** Asi una
--     recoleccion repetida del mismo dia corrige la fila en vez de sumar dos
--     veces. El unico `(objeto, date)` es lo que lo hace posible.
--  2. **Un dia sin dato NO tiene fila.** Si una red falla, no se escribe un
--     cero: el grafico muestra el hueco. Un cero inventado se lee como
--     "ese dia no paso nada", que es una afirmacion distinta y falsa.
--  3. **`extra jsonb`** para lo propio de cada red (alcance por seguidores,
--     audiencia). Sumar una metrica de una sola red no puede costar una
--     migracion ni una columna vacia para las otras cuatro.
--
-- RLS: leen Owner/Admin (en el bloque 9 pasa a `dashboards.content.view` y
-- `dashboards.ads.view`); escribe solo el servidor, como `social_posts`.

-- ------------------------------------------------------------
-- 1. Metricas por publicacion y dia
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.social_post_metrics_daily (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id              uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  social_post_id            uuid NOT NULL REFERENCES public.social_posts(id) ON DELETE CASCADE,
  -- La fecha en la zona del workspace, no en UTC: "el lunes" tiene que ser
  -- el lunes de quien mira el dashboard.
  date                      date NOT NULL,
  views                     integer,
  impressions               integer,
  reach                     integer,
  likes                     integer,
  comments                  integer,
  shares                    integer,
  saves                     integer,
  watch_time_seconds        integer,
  avg_view_duration_seconds numeric,
  engagement_rate           numeric,
  extra                     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.social_post_metrics_daily IS
  'Metricas de una publicacion, acumuladas a cada dia. Un dia sin dato no tiene fila: el grafico muestra el hueco en vez de un cero inventado.';
COMMENT ON COLUMN public.social_post_metrics_daily.extra IS
  'Lo propio de cada red: reach_followers, reach_non_followers, creatorContentType, etc.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_post_metrics_daily
  ON public.social_post_metrics_daily (social_post_id, date);

CREATE INDEX IF NOT EXISTS idx_post_metrics_workspace_date
  ON public.social_post_metrics_daily (workspace_id, date DESC);

-- ------------------------------------------------------------
-- 2. Metricas por cuenta y dia
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.social_account_metrics_daily (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  social_account_id uuid NOT NULL REFERENCES public.social_accounts(id) ON DELETE CASCADE,
  date              date NOT NULL,
  followers         integer,
  followers_gained  integer,
  followers_lost    integer,
  impressions       integer,
  reach             integer,
  profile_views     integer,
  extra             jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.social_account_metrics_daily IS
  'Seguidores y alcance de una cuenta, por dia. Es la base del grafico de crecimiento y del salto de seguidores por post (F52).';

CREATE UNIQUE INDEX IF NOT EXISTS uq_account_metrics_daily
  ON public.social_account_metrics_daily (social_account_id, date);

CREATE INDEX IF NOT EXISTS idx_account_metrics_workspace_date
  ON public.social_account_metrics_daily (workspace_id, date DESC);

-- ------------------------------------------------------------
-- 3. Comentarios
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.social_post_comments (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id              uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- Nullable: un comentario puede llegar por webhook antes de que la
  -- publicacion exista de nuestro lado. La sincronizacion la completa.
  social_post_id            uuid REFERENCES public.social_posts(id) ON DELETE CASCADE,
  platform                  text NOT NULL,
  external_comment_id       text NOT NULL,
  parent_external_comment_id text,
  author_external_id        text,
  author_username           text,
  author_name               text,
  author_avatar_url         text,
  -- Un comentario nuestro (la respuesta publica del flow, o una a mano).
  -- Se guarda para que el hilo se lea completo, pero nunca dispara nada.
  is_own                    boolean NOT NULL DEFAULT false,
  text                      text,
  commented_at              timestamptz,
  like_count                integer,
  hidden                    boolean NOT NULL DEFAULT false,
  -- Si el autor resulta ser un contacto conocido, queda vinculado.
  contact_id                uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  source                    text NOT NULL DEFAULT 'sync',
  deleted_at                timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.social_post_comments IS
  'Comentarios de las publicaciones. Entran por el webhook en el momento y se vuelven a leer en la sincronizacion. Los propios se guardan y nunca disparan automatizaciones.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'social_post_comments_source_check') THEN
    ALTER TABLE public.social_post_comments ADD CONSTRAINT social_post_comments_source_check
      CHECK (source IN ('webhook', 'sync'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'social_post_comments_platform_check') THEN
    ALTER TABLE public.social_post_comments ADD CONSTRAINT social_post_comments_platform_check
      CHECK (platform IN ('instagram', 'tiktok', 'youtube', 'linkedin', 'threads'));
  END IF;
END $$;

-- El mismo comentario no se guarda dos veces, venga del webhook o de la
-- relectura. Es lo que hace que los dos caminos puedan convivir.
CREATE UNIQUE INDEX IF NOT EXISTS uq_post_comments_external
  ON public.social_post_comments (workspace_id, platform, external_comment_id);

CREATE INDEX IF NOT EXISTS idx_post_comments_post
  ON public.social_post_comments (social_post_id, commented_at DESC)
  WHERE deleted_at IS NULL;

-- Para completar los que llegaron antes que su publicacion.
CREATE INDEX IF NOT EXISTS idx_post_comments_orphans
  ON public.social_post_comments (workspace_id, platform)
  WHERE social_post_id IS NULL;

-- ------------------------------------------------------------
-- 4. Insights de Meta Ads
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.meta_ads_insights_daily (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id            uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  ad_account_id           text NOT NULL,
  -- Los cuatro niveles conviven en la misma tabla: son las mismas metricas
  -- con distinto grado de detalle, y separarlas en cuatro tablas obligaria a
  -- escribir cuatro veces la misma consulta.
  level                   text NOT NULL,
  object_id               text NOT NULL,
  object_name             text,
  parent_name             text,
  campaign_id             text,
  adset_id                text,
  date                    date NOT NULL,
  spend                   numeric,
  impressions             integer,
  reach                   integer,
  clicks                  integer,
  outbound_clicks         integer,
  link_clicks             integer,
  ctr                     numeric,
  cpc                     numeric,
  cpm                     numeric,
  leads                   integer,
  purchases               integer,
  purchase_value          numeric,
  video_p25               integer,
  video_p50               integer,
  video_p75               integer,
  video_p95               integer,
  video_p100              integer,
  thruplays               integer,
  video_avg_time_seconds  numeric,
  quality_ranking         text,
  engagement_ranking      text,
  conversion_ranking      text,
  status                  text,
  effective_status        text,
  -- Las acciones crudas de Meta: sus nombres cambian por objetivo de campaña
  -- y por plataforma, asi que se guardan enteras y se interpretan al leer.
  actions                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.meta_ads_insights_daily IS
  'Insights de Meta Ads por dia y objeto. Los cuatro niveles (cuenta, campaña, conjunto, anuncio) en una tabla: son las mismas metricas con distinto detalle.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meta_ads_insights_level_check') THEN
    ALTER TABLE public.meta_ads_insights_daily ADD CONSTRAINT meta_ads_insights_level_check
      CHECK (level IN ('account', 'campaign', 'adset', 'ad'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_meta_ads_insights
  ON public.meta_ads_insights_daily (workspace_id, level, object_id, date);

CREATE INDEX IF NOT EXISTS idx_meta_ads_insights_account_date
  ON public.meta_ads_insights_daily (workspace_id, ad_account_id, level, date DESC);

-- ------------------------------------------------------------
-- 5. updated_at
-- ------------------------------------------------------------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'social_post_metrics_daily',
    'social_account_metrics_daily',
    'social_post_comments',
    'meta_ads_insights_daily'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_' || t
    ) THEN
      EXECUTE format(
        'CREATE TRIGGER set_updated_at_%1$s BEFORE UPDATE ON public.%1$I
           FOR EACH ROW EXECUTE FUNCTION public.update_updated_at()',
        t
      );
    END IF;
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 6. RLS
-- ------------------------------------------------------------
--
-- Lectura para Owner/Admin, escritura de nadie: las escribe el service role,
-- que no pasa por RLS. Un Member no ve metricas hasta el bloque 9, donde el
-- permiso `dashboards.content.view` puede darselas.

ALTER TABLE public.social_post_metrics_daily     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_account_metrics_daily  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_post_comments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_ads_insights_daily       ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'social_post_metrics_daily',
    'social_account_metrics_daily',
    'social_post_comments',
    'meta_ads_insights_daily'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%1$s_select_admin" ON public.%1$I', t);
    EXECUTE format(
      'CREATE POLICY "%1$s_select_admin" ON public.%1$I
         FOR SELECT TO authenticated
         USING (public.is_workspace_admin(workspace_id))',
      t
    );
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 7. Cron de metricas (F47)
-- ------------------------------------------------------------
--
-- Corre cada hora y la ruta decide para que workspaces encolar: los que en
-- ese momento son las 3:30 de la mañana en SU zona horaria. Un cron por
-- workspace seria lo mismo con mas piezas que mantener.

CREATE OR REPLACE FUNCTION private.call_app_cron(p_path text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_base text; v_secret text;
BEGIN
  IF p_path NOT IN (
    'jobs', 'sequences', 'whatsapp-health', 'inactivity', 'automation-events',
    'agent-bursts', 'drafts-refresh', 'bg-dispatch', 'bg-collect',
    'social-token-refresh', 'content-media-cleanup', 'metrics-sync'
  ) THEN
    RAISE EXCEPTION 'ruta de cron no permitida: %', p_path;
  END IF;
  SELECT value INTO v_base FROM private.system_config WHERE key = 'app_url';
  SELECT value INTO v_secret FROM private.system_config WHERE key = 'cron_secret';
  IF v_base IS NULL OR v_secret IS NULL THEN
    RAISE WARNING 'private.system_config sin app_url o cron_secret: el cron "%" no se ejecuto', p_path;
    RETURN NULL;
  END IF;
  RETURN net.http_get(
    url => rtrim(v_base, '/') || '/api/cron/' || p_path,
    headers => jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json'),
    timeout_milliseconds => 60000
  );
END; $function$;

REVOKE ALL ON FUNCTION private.call_app_cron(text) FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'metrics-sync') THEN
    PERFORM cron.unschedule('metrics-sync');
  END IF;
  -- Al minuto 30 de cada hora: la ruta se queda con los workspaces cuya hora
  -- local es 03:30. Las zonas con medias horas (India, Nepal) entran igual
  -- porque la ruta compara la hora local, no el offset.
  PERFORM cron.schedule(
    'metrics-sync',
    '30 * * * *',
    $cron$SELECT private.call_app_cron('metrics-sync')$cron$
  );
END $$;

-- ============================================================
-- MIGRATION 87: EMAIL CHANNEL
-- ============================================================
-- ============================================================
-- 00087: el email como un canal mas (F62, bloque 8)
-- ============================================================
--
-- La decision de fondo: el email NO es un modulo aparte. Es un canal, como
-- Instagram o WhatsApp, y entra por las mismas tablas: `channels`,
-- `conversations`, `messages`. Una bandeja aparte para el email seria una
-- segunda bandeja que revisar, y el punto del sistema es que haya una sola.
--
-- Lo que el email SI necesita y los otros canales no son las cabeceras del
-- hilo: sin `In-Reply-To` y `References`, una respuesta llega como un mail
-- suelto y el cliente de la otra persona la muestra fuera de conversacion.
--
-- `late_account_id` sigue siendo NOT NULL, como en toda la tabla: el canal
-- de email guarda ahi `email:<direccion>`. Aflojar ese NOT NULL para un
-- canal obligaria a revisar los 40+ lugares que lo leen asumiendo un texto.

-- ------------------------------------------------------------
-- 1. El canal
-- ------------------------------------------------------------

ALTER TABLE public.channels DROP CONSTRAINT IF EXISTS channels_platform_check;
ALTER TABLE public.channels ADD CONSTRAINT channels_platform_check
  CHECK (platform IN (
    'facebook', 'instagram', 'twitter', 'telegram', 'bluesky', 'reddit',
    'whatsapp', 'email'
  ));

ALTER TABLE public.channels DROP CONSTRAINT IF EXISTS channels_provider_check;
ALTER TABLE public.channels ADD CONSTRAINT channels_provider_check
  CHECK (provider IN ('zernio', 'evolution', 'resend'));

ALTER TABLE public.channels
  ADD COLUMN IF NOT EXISTS email_address text;

COMMENT ON COLUMN public.channels.email_address IS
  'La direccion que recibe y desde la que se responde. Solo en canales de email.';

-- Uno solo por workspace: dos canales de email serian dos bandejas para la
-- misma direccion.
CREATE UNIQUE INDEX IF NOT EXISTS uq_channels_email_per_workspace
  ON public.channels (workspace_id)
  WHERE platform = 'email';

-- ------------------------------------------------------------
-- 2. Las cabeceras del hilo
-- ------------------------------------------------------------

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS email_subject text,
  ADD COLUMN IF NOT EXISTS email_message_id text,
  ADD COLUMN IF NOT EXISTS email_in_reply_to text,
  ADD COLUMN IF NOT EXISTS email_references text,
  ADD COLUMN IF NOT EXISTS email_from text,
  ADD COLUMN IF NOT EXISTS email_to jsonb,
  ADD COLUMN IF NOT EXISTS email_cc jsonb;

COMMENT ON COLUMN public.messages.email_message_id IS
  'El Message-ID del correo. Es con lo que el cliente de la otra persona arma el hilo.';
COMMENT ON COLUMN public.messages.email_references IS
  'La cadena References acumulada: todos los Message-ID del hilo, en orden.';

-- Para encontrar el ultimo entrante del hilo al responder.
CREATE INDEX IF NOT EXISTS idx_messages_email_message_id
  ON public.messages (email_message_id)
  WHERE email_message_id IS NOT NULL;

-- ------------------------------------------------------------
-- 3. Los adjuntos
-- ------------------------------------------------------------
--
-- Se copian a nuestro Storage apenas llegan: los links que da Resend
-- vencen, y un adjunto que no se puede abrir tres dias despues es un
-- adjunto perdido.
--
-- Misma regla que el bucket de contenido: el primer segmento del path es el
-- workspace, y la base decide quien lee.

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('email-attachments', 'email-attachments', false, 26214400)  -- 25 MB
ON CONFLICT (id) DO NOTHING;

UPDATE storage.buckets
SET public = false, file_size_limit = 26214400
WHERE id = 'email-attachments';

DROP POLICY IF EXISTS "email_attachments_select" ON storage.objects;
CREATE POLICY "email_attachments_select" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'email-attachments'
    AND public.is_workspace_member(((storage.foldername(name))[1])::uuid)
  );

-- Escribir y borrar son del servidor: los adjuntos los copia el receptor
-- del webhook, y nadie los sube a mano.
DROP POLICY IF EXISTS "email_attachments_insert" ON storage.objects;
DROP POLICY IF EXISTS "email_attachments_update" ON storage.objects;
DROP POLICY IF EXISTS "email_attachments_delete" ON storage.objects;

-- ------------------------------------------------------------
-- 4. El trigger de flows (F67)
-- ------------------------------------------------------------

-- La lista completa de la 00038 mas `email_received`. Se tira y se rehace,
-- porque Postgres no deja extender un CHECK.
ALTER TABLE public.triggers DROP CONSTRAINT IF EXISTS triggers_type_check;

ALTER TABLE public.triggers ADD CONSTRAINT triggers_type_check CHECK (
  type IN (
    'keyword',
    'postback',
    'quick_reply',
    'welcome',
    'default',
    'comment_keyword',
    'new_contact',
    'crm_event',
    'inactivity',
    -- Etapa 2
    'email_received'
  )
);

-- ============================================================
-- MIGRATION 88: WORKSPACE ROLES
-- ============================================================
-- ============================================================
-- 00088: roles personalizados (F69, bloque 9)
-- ============================================================
--
-- Hasta acá un permiso era `role IN ('owner','admin')`. Eso alcanza con tres
-- personas; deja de alcanzar cuando hay alguien que tiene que ver los
-- dashboards pero no tocar las integraciones.
--
-- Dos decisiones que sostienen la migracion:
--
-- 1. **`workspace_members.role` NO se toca.** Sigue siendo owner, admin o
--    member, y sigue siendo lo que leen `is_workspace_admin` y las
--    cuarenta policies que ya existen. `role_id` se suma al lado y apunta al
--    rol con los permisos finos. Un rol personalizado es siempre un `member`
--    con permisos de mas: asi ninguna policy vieja cambia de comportamiento.
-- 2. **Los tres roles de sistema existen como filas.** Se crean por
--    workspace con un backfill. Tenerlos como filas es lo que permite que la
--    pantalla los muestre al lado de los personalizados y que `role_id`
--    nunca sea null.
--
-- Esta migracion NO cambia `can_see_contact` ni `can_see_conversation`: eso
-- es la 00089, que se aplica despues de ver esta en verde.

-- ------------------------------------------------------------
-- 1. La tabla
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.workspace_roles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name         text NOT NULL,
  description  text,
  -- El rol de sistema al que equivale, o NULL si es personalizado. Es lo que
  -- impide editarlos y lo que permite encontrarlos en el backfill.
  system_role  text,
  -- { keys: [...], scopes: { leads, conversations } }. Se valida en
  -- TypeScript (lib/auth/permissions.ts): un CHECK con la lista de claves
  -- obligaria a una migracion por cada permiso nuevo.
  permissions  jsonb NOT NULL DEFAULT '{"keys": [], "scopes": {"leads": "own", "conversations": "own"}}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.workspace_roles IS
  'Los roles de un workspace: los tres de sistema (system_role no nulo, no editables) y los personalizados.';
COMMENT ON COLUMN public.workspace_roles.permissions IS
  'Las claves de permiso y los alcances. El catalogo vive en lib/auth/permissions.ts.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_roles_system_check') THEN
    ALTER TABLE public.workspace_roles ADD CONSTRAINT workspace_roles_system_check
      CHECK (system_role IS NULL OR system_role IN ('owner', 'admin', 'member'));
  END IF;
END $$;

-- Un nombre no se repite dentro del workspace: dos roles "Setter" serian
-- imposibles de distinguir en el selector del equipo.
CREATE UNIQUE INDEX IF NOT EXISTS uq_workspace_roles_name
  ON public.workspace_roles (workspace_id, lower(name));

-- Un solo rol de sistema de cada tipo por workspace.
CREATE UNIQUE INDEX IF NOT EXISTS uq_workspace_roles_system
  ON public.workspace_roles (workspace_id, system_role)
  WHERE system_role IS NOT NULL;

-- ------------------------------------------------------------
-- 2. Los tres roles de sistema, en cada workspace
-- ------------------------------------------------------------
--
-- Los permisos van vacios a proposito: los de sistema los resuelve
-- TypeScript desde `SYSTEM_ROLE_PERMISSIONS`, que es la fuente. Guardar una
-- copia en la base daria dos fuentes que se pueden separar, y la que manda
-- seria la que alguien mire primero.

INSERT INTO public.workspace_roles (workspace_id, name, description, system_role)
SELECT w.id, r.name, r.description, r.system_role
FROM public.workspaces w
CROSS JOIN (VALUES
  ('Owner',  'Puede todo, incluida la propiedad del negocio.', 'owner'),
  ('Admin',  'Puede todo menos transferir la propiedad.',      'admin'),
  ('Member', 'Ve y atiende los leads que tiene asignados.',    'member')
) AS r(name, description, system_role)
ON CONFLICT DO NOTHING;

-- Un workspace nuevo también los necesita: el trigger que lo crea no sabe de
-- roles, así que se agregan acá.
CREATE OR REPLACE FUNCTION public.seed_workspace_roles()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.workspace_roles (workspace_id, name, description, system_role)
  VALUES
    (NEW.id, 'Owner',  'Puede todo, incluida la propiedad del negocio.', 'owner'),
    (NEW.id, 'Admin',  'Puede todo menos transferir la propiedad.',      'admin'),
    (NEW.id, 'Member', 'Ve y atiende los leads que tiene asignados.',    'member')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS seed_roles_on_workspace ON public.workspaces;
CREATE TRIGGER seed_roles_on_workspace
  AFTER INSERT ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.seed_workspace_roles();

-- ------------------------------------------------------------
-- 3. El rol de cada persona
-- ------------------------------------------------------------

ALTER TABLE public.workspace_members
  ADD COLUMN IF NOT EXISTS role_id uuid REFERENCES public.workspace_roles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.workspace_members.role_id IS
  'El rol con los permisos finos. `role` sigue siendo owner/admin/member y es lo que leen las policies viejas.';

-- Backfill: cada persona queda con el rol de sistema que ya tenia.
UPDATE public.workspace_members m
SET role_id = r.id
FROM public.workspace_roles r
WHERE r.workspace_id = m.workspace_id
  AND r.system_role = m.role
  AND m.role_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_workspace_members_role
  ON public.workspace_members (role_id)
  WHERE role_id IS NOT NULL;

-- ------------------------------------------------------------
-- 4. Los roles de sistema no se editan
-- ------------------------------------------------------------
--
-- Un trigger y no una policy: la policy puede saltarse con el service role,
-- y "el Owner puede todo" tiene que valer también para el Owner. Si alguien
-- le saca un permiso al rol Admin, la mitad del sistema deja de andar sin
-- que quede claro por qué.

CREATE OR REPLACE FUNCTION public.protect_system_roles()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Borrar un rol de sistema A MANO no se permite; que se vaya con su
    -- workspace, si. Sin esta distincion el trigger frena el borrado en
    -- cascada y no se puede borrar un workspace (lo encontro la limpieza de
    -- verify-rls, que es justo para lo que esta).
    IF OLD.system_role IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = OLD.workspace_id) THEN
      RAISE EXCEPTION 'los roles de sistema no se pueden borrar';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.system_role IS NOT NULL THEN
    -- Se deja cambiar la descripcion: es texto y no afecta a nadie.
    IF NEW.system_role IS DISTINCT FROM OLD.system_role
       OR NEW.name IS DISTINCT FROM OLD.name
       OR NEW.permissions IS DISTINCT FROM OLD.permissions THEN
      RAISE EXCEPTION 'los roles de sistema no se pueden editar';
    END IF;
  END IF;

  -- Un rol personalizado no puede convertirse en uno de sistema.
  IF OLD.system_role IS NULL AND NEW.system_role IS NOT NULL THEN
    RAISE EXCEPTION 'un rol personalizado no puede volverse de sistema';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_system_roles ON public.workspace_roles;
CREATE TRIGGER protect_system_roles
  BEFORE UPDATE OR DELETE ON public.workspace_roles
  FOR EACH ROW EXECUTE FUNCTION public.protect_system_roles();

-- ------------------------------------------------------------
-- 5. Preguntar por un permiso desde la base
-- ------------------------------------------------------------
--
-- `SECURITY DEFINER` porque tiene que leer `workspace_members` y
-- `workspace_roles` sin que la RLS de esas tablas la frene, igual que
-- `is_workspace_admin`.
--
-- Owner y Admin devuelven true sin mirar el jsonb: sus permisos los define
-- TypeScript, y duplicar esa lista en SQL daria dos fuentes.

CREATE OR REPLACE FUNCTION public.has_permission(p_workspace_id uuid, p_key text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_role       text;
  v_permissions jsonb;
BEGIN
  SELECT m.role, COALESCE(r.permissions, '{}'::jsonb)
    INTO v_role, v_permissions
  FROM public.workspace_members m
  LEFT JOIN public.workspace_roles r ON r.id = m.role_id
  WHERE m.workspace_id = p_workspace_id AND m.user_id = auth.uid();

  IF v_role IS NULL THEN
    RETURN false;
  END IF;

  IF v_role IN ('owner', 'admin') THEN
    RETURN true;
  END IF;

  -- OJO: los permisos del rol de sistema "Member" NO estan en el jsonb (su
  -- fila los tiene vacios a proposito: la fuente es lib/auth/permissions.ts).
  -- Esta funcion responde por los roles PERSONALIZADOS y por owner/admin.
  -- Ninguna policy la usa hoy; el alcance de leads lo resuelve
  -- permission_scope, que si contempla los tres casos.
  --
  -- El COALESCE importa: sin el, un rol sin la clave `keys` devuelve NULL en
  -- vez de false, y una funcion booleana que devuelve NULL es una trampa.
  RETURN COALESCE(v_permissions -> 'keys' @> to_jsonb(ARRAY[p_key]), false);
END;
$$;

REVOKE ALL ON FUNCTION public.has_permission(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_permission(uuid, text) TO authenticated, service_role;

-- El alcance de un modulo: `own` o `all`.
--
-- Owner y Admin siempre `all`. Un member sin rol asignado, `own`: el mas
-- restrictivo, que es lo que corresponde cuando falta el dato.
CREATE OR REPLACE FUNCTION public.permission_scope(p_workspace_id uuid, p_module text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_role  text;
  v_scope text;
BEGIN
  SELECT m.role, r.permissions #>> ARRAY['scopes', p_module]
    INTO v_role, v_scope
  FROM public.workspace_members m
  LEFT JOIN public.workspace_roles r ON r.id = m.role_id
  WHERE m.workspace_id = p_workspace_id AND m.user_id = auth.uid();

  IF v_role IS NULL THEN
    RETURN 'own';
  END IF;

  IF v_role IN ('owner', 'admin') THEN
    RETURN 'all';
  END IF;

  RETURN COALESCE(v_scope, 'own');
END;
$$;

REVOKE ALL ON FUNCTION public.permission_scope(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.permission_scope(uuid, text) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 6. RLS
-- ------------------------------------------------------------
--
-- Los roles los ve cualquier miembro: el selector del equipo los necesita, y
-- saber que roles existen no es informacion sensible. Escribirlos es de
-- Owner/Admin, igual que invitar gente.

ALTER TABLE public.workspace_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workspace_roles_select" ON public.workspace_roles;
CREATE POLICY "workspace_roles_select" ON public.workspace_roles
  FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "workspace_roles_insert" ON public.workspace_roles;
CREATE POLICY "workspace_roles_insert" ON public.workspace_roles
  FOR INSERT TO authenticated
  WITH CHECK (public.is_workspace_admin(workspace_id) AND system_role IS NULL);

DROP POLICY IF EXISTS "workspace_roles_update" ON public.workspace_roles;
CREATE POLICY "workspace_roles_update" ON public.workspace_roles
  FOR UPDATE TO authenticated
  USING (public.is_workspace_admin(workspace_id))
  WITH CHECK (public.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "workspace_roles_delete" ON public.workspace_roles;
CREATE POLICY "workspace_roles_delete" ON public.workspace_roles
  FOR DELETE TO authenticated
  USING (public.is_workspace_admin(workspace_id) AND system_role IS NULL);

-- updated_at
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_workspace_roles') THEN
    CREATE TRIGGER set_updated_at_workspace_roles
      BEFORE UPDATE ON public.workspace_roles
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
  END IF;
END $$;

-- ============================================================
-- MIGRATION 89: CAN SEE WITH ROLES
-- ============================================================
-- ============================================================
-- 00089: el alcance de leads sale del rol (F69, bloque 9)
-- ============================================================
--
-- Se reescribe SOLO EL CUERPO de `can_see_contact` y `can_see_conversation`.
-- La firma, los GRANT y las cuarenta policies que las llaman no cambian:
-- por eso esta migracion puede correr sin tocar nada mas, y por eso el
-- `verify-rls.mjs` de antes vale como prueba de que no se rompio nada.
--
-- Lo que cambia es UNA linea de logica: donde antes decia "si es Admin, ve
-- todo", ahora dice "si es Admin O su rol tiene alcance `all`, ve todo". El
-- resto —el flag del workspace, las tres vias de asignacion, los leads sin
-- asignar— queda igual.
--
-- Se aplica DESPUES de ver la 00088 en verde, y `verify-rls` se vuelve a
-- correr despues. El orden importa: si algo sale mal, se sabe cual de las
-- dos lo rompio.

-- ------------------------------------------------------------
-- 1. can_see_contact
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

  -- LO NUEVO (00089): un rol personalizado con alcance `all` en leads ve
  -- todo, igual que un Admin. Es el unico agregado de esta migracion.
  IF public.permission_scope(c.workspace_id, 'leads') = 'all' THEN
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
-- 2. can_see_conversation
-- ------------------------------------------------------------
--
-- Sigue DELEGANDO en `can_see_contact`, como la dejo la 00028: las dos
-- reglas no pueden separarse, y el contacto borrado tambien esconde sus
-- conversaciones. Lo unico que se suma es el alcance propio de
-- conversaciones, ANTES de delegar: solo ensancha, nunca angosta.
--
-- (El primer intento de esta migracion copio la logica de leads aca en vez
-- de delegar, y con eso deshizo lo de la 00028. Lo encontro verify-rls.)

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

  -- Un rol con alcance `all` en conversaciones las ve todas. Es un permiso
  -- aparte del de leads: se puede querer que alguien atienda cualquier
  -- conversacion sin darle la ficha de todos los contactos.
  IF public.permission_scope(conv.workspace_id, 'conversations') = 'all' THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.contacts c
    WHERE c.id = conv.contact_id
      AND c.deleted_at IS NULL
      AND public.can_see_contact(c)
  );
END;
$$;

COMMENT ON FUNCTION public.can_see_conversation(public.conversations) IS
  'Se ve la conversacion de un lead que se puede ver, o cualquiera si el rol tiene alcance `all` en conversaciones. Delega en can_see_contact para que las dos reglas no puedan separarse (00028, 00089).';

-- Los GRANT sobreviven al CREATE OR REPLACE, pero se repiten por si esta
-- migracion corre sobre una base donde alguna anterior quedo parcial.
REVOKE ALL ON FUNCTION public.can_see_contact(public.contacts) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_see_conversation(public.conversations) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_see_contact(public.contacts) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_see_conversation(public.conversations) TO authenticated, service_role;

-- ============================================================
-- MIGRATION 90: DROP LEGACY SECRET COLUMNS
-- ============================================================
-- ============================================================
-- 00090: borrar las columnas de secretos viejas
-- ============================================================
--
-- ⛔ ESTA MIGRACION NO ESTA APLICADA, Y NO HAY QUE APLICARLA TODAVIA.
--
-- Borra las tres columnas donde vivian los secretos antes de Vault:
--
--   - workspaces.late_api_key_encrypted  (la API key de Zernio)
--   - workspaces.webhook_secret          (el secreto del webhook de Zernio)
--   - channels.webhook_secret            (idem, por canal)
--
-- Por que no se aplica: **la clave de Zernio de este negocio todavia vive
-- en `late_api_key_encrypted`**. Es de donde la lee el fallback de
-- `getZernioApiKey`, y por lo tanto de donde la lee el sistema cada vez que
-- manda un mensaje por Instagram. Aplicar esto hoy deja la bandeja sin
-- poder responder y el agente sin poder contestar, en el momento.
--
-- ── Como aplicarla, cuando corresponda ───────────────────────────────────
--
-- 1. En Ajustes → Integraciones, abrir la card de Zernio y apretar
--    "Migrar a Vault". Copia la API key y el secreto del webhook desde las
--    columnas viejas a Vault, sin mostrarlos ni loguearlos.
-- 2. Comprobar que la card de Zernio deja de mostrar el aviso "La clave
--    todavia no esta en Vault".
-- 3. Mandar un mensaje de prueba desde la bandeja y ver que sale. Eso
--    prueba que el sistema esta leyendo de Vault y no de la columna.
-- 4. Recien ahi aplicar esta migracion.
-- 5. Volver a mandar un mensaje. Si sale, listo.
--
-- Hay dos scripts que tambien leen estas columnas como fallback y dejan de
-- necesitarlo despues del paso 1:
--   - scripts/backfill-zernio-messages.mjs
--   - scripts/enrich-instagram-contacts.mjs
--
-- ── Por que se escribe igual ─────────────────────────────────────────────
--
-- Porque el trabajo de decidir QUE borrar y en QUE orden ya esta hecho, y
-- escribirlo seis meses despues significa volver a averiguar quien leia
-- cada columna. Asi el dia que se migre, es una linea de comando.

-- Se comprueba primero que no quede nada adentro: aplicar esto con una
-- clave todavia en la columna es perder la clave.
DO $$
DECLARE v_pendientes integer;
BEGIN
  SELECT count(*) INTO v_pendientes
  FROM public.workspaces
  WHERE late_api_key_encrypted IS NOT NULL OR webhook_secret IS NOT NULL;

  IF v_pendientes > 0 THEN
    RAISE EXCEPTION
      'Hay % workspace(s) con secretos todavia en las columnas viejas. Apreta "Migrar a Vault" en Integraciones antes de aplicar esta migracion.',
      v_pendientes;
  END IF;

  SELECT count(*) INTO v_pendientes
  FROM public.channels
  WHERE webhook_secret IS NOT NULL;

  IF v_pendientes > 0 THEN
    RAISE EXCEPTION
      'Hay % canal(es) con el secreto del webhook todavia en la columna vieja.',
      v_pendientes;
  END IF;
END $$;

ALTER TABLE public.workspaces DROP COLUMN IF EXISTS late_api_key_encrypted;
ALTER TABLE public.workspaces DROP COLUMN IF EXISTS webhook_secret;
ALTER TABLE public.channels   DROP COLUMN IF EXISTS webhook_secret;

-- ============================================================
-- MIGRATION 91: PUBLISH PROGRESS
-- ============================================================
-- 00091 · Que parte de una publicacion ya salio (A10, A14)
--
-- Algunas publicaciones tienen varios pasos contra el proveedor. Un hilo de
-- Threads es el caso claro: se publica el post principal y despues cada
-- respuesta. Si falla la segunda respuesta, el reintento volvia a empezar
-- desde el principio y **duplicaba el post principal**, que ya estaba en la
-- red.
--
-- Con esto el publicador deja anotado que paso ya salio, y el reintento
-- arranca donde quedo. Es del publicador y de nadie mas: ninguna pantalla lo
-- lee.
--
-- Aditiva. No borra ni modifica nada.

ALTER TABLE public.social_posts
  ADD COLUMN IF NOT EXISTS publish_progress jsonb;

COMMENT ON COLUMN public.social_posts.publish_progress IS
  'Que pasos de la publicacion ya salieron, para que un reintento no los repita (A10). Lo escribe solo el publicador.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'social_posts_publish_progress_object'
  ) THEN
    ALTER TABLE public.social_posts
      ADD CONSTRAINT social_posts_publish_progress_object
      CHECK (publish_progress IS NULL OR jsonb_typeof(publish_progress) = 'object');
  END IF;
END $$;

-- ============================================================
-- MIGRATION 92: CONTENT UPLOAD CRON
-- ============================================================
-- 00092 · La ruta de las subidas largas (A17)
--
-- Subir un video a YouTube por trozos puede tardar minutos. Corriendo dentro
-- del cron general, esos minutos se los come la cola entera: los jobs que
-- venian detras esperan. Y esa ruta no declara limite de tiempo, asi que la
-- corrida se puede cortar a la mitad de la subida.
--
-- `/api/cron/content-upload` corre de a una subida, con cinco minutos de
-- margen, cada dos minutos.
--
-- La lista blanca de `call_app_cron` se redefine entera (es el patron desde
-- la 00036): la funcion no acumula rutas, se reescribe con la lista vigente.
--
-- Aditiva. No borra ni modifica datos.

CREATE OR REPLACE FUNCTION private.call_app_cron(p_path text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_base text; v_secret text;
BEGIN
  IF p_path NOT IN (
    'jobs', 'sequences', 'whatsapp-health', 'inactivity', 'automation-events',
    'agent-bursts', 'drafts-refresh', 'bg-dispatch', 'bg-collect',
    'social-token-refresh', 'content-media-cleanup', 'metrics-sync',
    'content-upload'
  ) THEN
    RAISE EXCEPTION 'ruta de cron no permitida: %', p_path;
  END IF;
  SELECT value INTO v_base FROM private.system_config WHERE key = 'app_url';
  SELECT value INTO v_secret FROM private.system_config WHERE key = 'cron_secret';
  IF v_base IS NULL OR v_secret IS NULL THEN
    RAISE WARNING 'private.system_config sin app_url o cron_secret: el cron "%" no se ejecuto', p_path;
    RETURN NULL;
  END IF;
  RETURN net.http_get(
    url => rtrim(v_base, '/') || '/api/cron/' || p_path,
    headers => jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json'),
    timeout_milliseconds => 60000
  );
END; $$;

-- Cada dos minutos: una publicacion programada no puede esperar mucho mas
-- que eso, y con una subida por corrida no se pisan entre si.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('content-upload')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'content-upload');

    PERFORM cron.schedule(
      'content-upload',
      '*/2 * * * *',
      $cron$SELECT private.call_app_cron('content-upload');$cron$
    );
  END IF;
END $$;

-- ============================================================
-- MIGRATION 93: ZERNIO NATIVE SCHEDULING
-- ============================================================
-- 00093 · Instagram y TikTok se programan del lado de Zernio (grupo D)
--
-- Hasta ahora el sistema guardaba la fecha y, a esa hora, le pedia a Zernio
-- "publica ahora". Eso ata la publicacion a que nuestro cron corra en el
-- momento justo, y de ahi salen casi todos los problemas del grupo A: el job
-- viejo que sobrevive al reprogramar, las filas trabadas, los reintentos
-- propios.
--
-- Zernio sabe programar: se le pasa la fecha y la zona, y publica el. Eso es
-- lo que hace LateWiz, su cliente de referencia.
--
-- Dos cosas hacen falta:
--
-- 1. Un estado nuevo, `uploading`. Para que Zernio publique un video dias
--    despues, el archivo tiene que estar en Zernio, no detras de un link
--    firmado nuestro que vence en 24 horas. La subida corre en un job y la
--    fila espera ahi mientras tanto. No es `publishing`: nadie esta
--    publicando todavia, y el barrido de publicaciones trabadas no tiene que
--    tocarla.
--
-- 2. `provider_media`, que recuerda que archivo nuestro corresponde a que URL
--    de Zernio. Sin esto, programar tres redes con el mismo video lo sube
--    tres veces.
--
-- Aditiva. No borra ni modifica datos.

-- ------------------------------------------------------------
-- 1. El estado `uploading`
-- ------------------------------------------------------------

DO $$
BEGIN
  ALTER TABLE public.social_posts DROP CONSTRAINT IF EXISTS social_posts_status_check;
  ALTER TABLE public.social_posts
    ADD CONSTRAINT social_posts_status_check
    CHECK (
      status IS NULL OR status IN (
        'uploading', 'scheduled', 'publishing', 'published', 'failed', 'cancelled'
      )
    );
END $$;

COMMENT ON COLUMN public.social_posts.status IS
  'uploading = subiendo la media al proveedor; scheduled = agendado (nuestro o de Zernio); publishing = el proveedor la esta publicando.';

-- ------------------------------------------------------------
-- 2. La media que ya vive en el proveedor
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.provider_media (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- Que proveedor tiene la copia: 'zernio' hoy, otro manana.
  publisher     text NOT NULL,
  -- La ruta en nuestro bucket content-media.
  storage_path  text NOT NULL,
  -- Cuanto pesaba cuando se subio: si el archivo cambia, hay que volver a
  -- subirlo, y el tamano es la senal mas barata de que cambio.
  size_bytes    bigint,
  -- La direccion publica que devolvio el proveedor.
  provider_url  text NOT NULL,
  uploaded_at   timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS provider_media_unique
  ON public.provider_media (workspace_id, publisher, storage_path);

CREATE INDEX IF NOT EXISTS provider_media_workspace_idx
  ON public.provider_media (workspace_id);

COMMENT ON TABLE public.provider_media IS
  'Que archivo de content-media corresponde a que URL del proveedor, para no subirlo dos veces (D5).';

ALTER TABLE public.provider_media ENABLE ROW LEVEL SECURITY;

-- Solo el servidor la escribe (la sube un job con service role). Los
-- miembros del workspace pueden leerla: no hay nada sensible y sirve para
-- diagnosticar por que una publicacion no encuentra su media.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'provider_media'
      AND policyname = 'provider_media_select'
  ) THEN
    CREATE POLICY provider_media_select ON public.provider_media
      FOR SELECT TO authenticated
      USING (public.is_workspace_member(workspace_id));
  END IF;
END $$;

-- ============================================================
-- MIGRATION 94: COPYWRITER AGENT
-- ============================================================
-- 00094 · El agente copywriter de contenido (grupo E)
--
-- Tres cosas.
--
-- 1. **Un CHECK viejo que rechaza los runs de copy.** La Etapa 2 agrego
--    `agent_runs_source_check` con `content_copy` y `ads_analysis`, pero dejo
--    vivo `agent_runs_source_values` (de la 00076), que no los tiene. Los dos
--    se aplican, asi que **hoy, contra la base real, registrar un run de
--    generacion de copy falla**: la generacion funciona pero el costo no
--    queda anotado en ningun lado, y por lo tanto no cuenta para los topes.
--    Los tests no lo veian porque mockean la base.
--
-- 2. **El agente necesita poder firmar sus runs.**
--    `agent_runs_agent_only_for_agent_sources` solo deja guardar `agent_id`
--    cuando el origen es `agent` o `conversation_summary`. El copywriter
--    tiene que poder decir cual de sus ejecuciones fue: sin eso no hay
--    pestana Runs ni Costos que valga.
--
-- 3. **Que se vea que esta escribiendo.** `content_posts.copy_status` es lo
--    que hace que el tablero y el editor muestren "el copywriter esta
--    escribiendo" y se actualicen solos al terminar.
--
-- Y siembra un agente `copywriter` por workspace, existente y futuro.
--
-- Aditiva. No borra ni modifica datos: el unico DROP es el de un CHECK que
-- contradice a otro mas nuevo.

-- ------------------------------------------------------------
-- 1. Los CHECK de agent_runs
-- ------------------------------------------------------------

ALTER TABLE public.agent_runs DROP CONSTRAINT IF EXISTS agent_runs_source_values;

DO $$
BEGIN
  ALTER TABLE public.agent_runs DROP CONSTRAINT IF EXISTS agent_runs_agent_only_for_agent_sources;
  ALTER TABLE public.agent_runs
    ADD CONSTRAINT agent_runs_agent_only_for_agent_sources
    CHECK (
      agent_id IS NULL
      OR source IN ('agent', 'conversation_summary', 'content_copy')
    );
END $$;

-- ------------------------------------------------------------
-- 2. Que el copywriter esta escribiendo
-- ------------------------------------------------------------

ALTER TABLE public.content_posts
  ADD COLUMN IF NOT EXISTS copy_status text NOT NULL DEFAULT 'idle';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_posts_copy_status_check') THEN
    ALTER TABLE public.content_posts
      ADD CONSTRAINT content_posts_copy_status_check
      CHECK (copy_status IN ('idle', 'generating', 'failed'));
  END IF;
END $$;

COMMENT ON COLUMN public.content_posts.copy_status IS
  'Si el copywriter esta escribiendo esta pieza. Lo lee el kanban y el editor para mostrarlo y refrescarse solos (E6).';

-- ------------------------------------------------------------
-- 3. Un copywriter por workspace
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.seed_copywriter_agent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Apagado y sin prompt propio: la voz de marca se carga desde la pantalla.
  -- Nace pudiendo correr a mano; producir el copy solo al aprobar una idea es
  -- un interruptor aparte, que arranca apagado.
  INSERT INTO public.agents (workspace_id, name, type, is_enabled, system_prompt)
  VALUES (
    NEW.id,
    'Copywriter de contenido',
    'copywriter',
    true,
    ''
  )
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS seed_copywriter_on_workspace ON public.workspaces;
CREATE TRIGGER seed_copywriter_on_workspace
  AFTER INSERT ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.seed_copywriter_agent();

-- Los que ya existen.
INSERT INTO public.agents (workspace_id, name, type, is_enabled, system_prompt)
SELECT w.id, 'Copywriter de contenido', 'copywriter', true, ''
FROM public.workspaces w
WHERE NOT EXISTS (
  SELECT 1 FROM public.agents a
  WHERE a.workspace_id = w.id AND a.type = 'copywriter' AND a.deleted_at IS NULL
);

-- Un solo copywriter por workspace: dos serian dos voces distintas para la
-- misma marca, y nadie sabria cual escribio que.
CREATE UNIQUE INDEX IF NOT EXISTS uq_agents_copywriter_por_workspace
  ON public.agents (workspace_id)
  WHERE type = 'copywriter' AND deleted_at IS NULL;

-- ============================================================
-- MIGRATION 95: SCHEDULING PROFILES CALENDARS
-- ============================================================
-- ============================================================================
-- 00095 — Perfil de agenda y calendarios (Etapa 4, Bloque 1, F1)
-- ============================================================================
-- Lo que suma:
--
--  1. scheduling_profiles: una por persona y workspace. El "usuario" que va en
--     los links de sus eventos, su zona horaria y su formato de hora.
--  2. calendars: los calendarios de cada cuenta de Google conectada por una
--     persona. Cuales revisan conflictos y cual es el destino por defecto.
--  3. oauth_connections: el proveedor `google_calendar` (por persona, varias
--     cuentas), y el unico pasa a dos indices parciales sin expresiones:
--       - una conexion de WORKSPACE por proveedor (user_id NULL), como hoy;
--       - por PERSONA, una por cuenta externa (user_id + external_account_id).
--     El indice viejo (con coalesce) se borra en esta misma migracion. No toca
--     datos: la tabla esta vacia y, aunque no lo estuviera, las filas de hoy
--     cumplen los dos indices nuevos.
--     Ademas, cada persona puede LEER sus propias conexiones (antes solo los
--     admins leian la tabla).
--  4. contacts.timezone: la zona IANA del contacto, que la agenda aprende del
--     invitado y el agente de chat confirma.
--  5. Bucket `avatars` para la foto del perfil de agenda: publico para leer
--     (se muestra en la pagina publica de reserva, sin sesion), escritura
--     solo de miembros del workspace en su carpeta.
--  6. scheduling_can_manage(ws, user): la regla de "es la persona dueña o
--     tiene scheduling.manage_others", que usan las policies de este modulo.
--
-- Idempotente.
-- ============================================================================

-- ------------------------------------------------------------
-- 0. La regla de "puede administrar la agenda de esta persona"
-- ------------------------------------------------------------
-- Admin, o la propia persona, o alguien con `scheduling.manage_others`.
-- `has_permission` devuelve false para el rol Member de sistema (sus permisos
-- viven en TypeScript, no en la fila), y eso es lo que corresponde: un Member
-- de sistema no tiene manage_others.

CREATE OR REPLACE FUNCTION public.scheduling_can_manage(p_workspace_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.is_workspace_member(p_workspace_id)
     AND (
       auth.uid() = p_user_id
       OR public.is_workspace_admin(p_workspace_id)
       OR public.has_permission(p_workspace_id, 'scheduling.manage_others')
     );
$$;

REVOKE ALL ON FUNCTION public.scheduling_can_manage(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.scheduling_can_manage(uuid, uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 1. oauth_connections: proveedor google_calendar y unicos por persona
-- ------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'oauth_connections_provider_check') THEN
    ALTER TABLE public.oauth_connections DROP CONSTRAINT oauth_connections_provider_check;
  END IF;
  ALTER TABLE public.oauth_connections ADD CONSTRAINT oauth_connections_provider_check
    CHECK (provider IN ('google', 'linkedin', 'threads', 'google_calendar'));
END $$;

-- Una conexion de workspace por proveedor (las de YouTube, LinkedIn, Threads).
CREATE UNIQUE INDEX IF NOT EXISTS uq_oauth_connections_workspace_provider
  ON public.oauth_connections (workspace_id, provider)
  WHERE user_id IS NULL;

-- Por persona: una fila por cuenta externa. Reconectar la misma cuenta
-- actualiza; una cuenta distinta suma una fila.
CREATE UNIQUE INDEX IF NOT EXISTS uq_oauth_connections_user_account
  ON public.oauth_connections (workspace_id, provider, user_id, external_account_id)
  WHERE user_id IS NOT NULL;

DROP INDEX IF EXISTS public.uq_oauth_connections_ws_provider_user;

CREATE INDEX IF NOT EXISTS idx_oauth_connections_user
  ON public.oauth_connections (workspace_id, user_id, provider)
  WHERE user_id IS NOT NULL;

COMMENT ON COLUMN public.oauth_connections.user_id IS
  'NULL = la conexion es del workspace (una por proveedor). Con valor = de esa persona (google_calendar): una fila por cuenta externa.';

-- Cada persona ve sus propias conexiones (sus cuentas de Google Calendar).
-- Los admins siguen viendo todas por la policy de la 00082.
DROP POLICY IF EXISTS "oauth_connections_select_own" ON public.oauth_connections;
CREATE POLICY "oauth_connections_select_own" ON public.oauth_connections
  FOR SELECT USING (user_id = auth.uid() AND public.is_workspace_member(workspace_id));

-- ------------------------------------------------------------
-- 2. scheduling_profiles
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.scheduling_profiles (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id                    uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id                         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Va en los links: /calendario/<username>/<evento>. Minusculas, numeros y guiones.
  username                        text NOT NULL,
  display_name                    text NOT NULL,
  avatar_url                      text,
  timezone                        text NOT NULL,
  time_format                     text NOT NULL DEFAULT '24h',
  welcome_message                 text,
  -- FK a availability_schedules se agrega en la 00096 (la tabla no existe todavia).
  default_schedule_id             uuid,
  default_destination_calendar_id uuid,
  is_active                       boolean NOT NULL DEFAULT true,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.scheduling_profiles IS
  'El perfil de agenda de cada persona: usuario de los links, zona horaria, formato de hora, horario y calendario destino por defecto.';
COMMENT ON COLUMN public.scheduling_profiles.username IS
  'Slug de 3 a 40 caracteres, unico en el workspace sin distinguir mayusculas. Palabras reservadas: agenda, embed, api, equipo, admin.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scheduling_profiles_username_check') THEN
    ALTER TABLE public.scheduling_profiles ADD CONSTRAINT scheduling_profiles_username_check
      CHECK (username ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scheduling_profiles_time_format_check') THEN
    ALTER TABLE public.scheduling_profiles ADD CONSTRAINT scheduling_profiles_time_format_check
      CHECK (time_format IN ('12h', '24h'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_scheduling_profiles_ws_user
  ON public.scheduling_profiles (workspace_id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_scheduling_profiles_ws_username
  ON public.scheduling_profiles (workspace_id, lower(username));

DROP TRIGGER IF EXISTS set_updated_at ON public.scheduling_profiles;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.scheduling_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.scheduling_profiles ENABLE ROW LEVEL SECURITY;

-- Lo leen todos los miembros: hace falta para elegir anfitriones y para
-- mostrar de quien es cada agenda.
DROP POLICY IF EXISTS "scheduling_profiles_select" ON public.scheduling_profiles;
CREATE POLICY "scheduling_profiles_select" ON public.scheduling_profiles
  FOR SELECT USING (public.is_workspace_member(workspace_id));

-- Escribe la persona dueña o quien administra agendas ajenas. Sin DELETE: se
-- desactiva.
DROP POLICY IF EXISTS "scheduling_profiles_insert" ON public.scheduling_profiles;
CREATE POLICY "scheduling_profiles_insert" ON public.scheduling_profiles
  FOR INSERT WITH CHECK (public.scheduling_can_manage(workspace_id, user_id));

DROP POLICY IF EXISTS "scheduling_profiles_update" ON public.scheduling_profiles;
CREATE POLICY "scheduling_profiles_update" ON public.scheduling_profiles
  FOR UPDATE USING (public.scheduling_can_manage(workspace_id, user_id))
  WITH CHECK (public.scheduling_can_manage(workspace_id, user_id));

-- ------------------------------------------------------------
-- 3. calendars
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.calendars (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id            uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  connection_id           uuid NOT NULL REFERENCES public.oauth_connections(id) ON DELETE CASCADE,
  user_id                 uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  external_calendar_id    text NOT NULL,
  name                    text NOT NULL,
  color                   text,
  access_role             text NOT NULL,
  is_primary              boolean NOT NULL DEFAULT false,
  check_conflicts         boolean NOT NULL DEFAULT false,
  is_active               boolean NOT NULL DEFAULT true,
  -- Reservadas para la sincronizacion push (fase futura). Sin uso hoy.
  push_channel_id         text,
  push_channel_expires_at timestamptz,
  sync_token              text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.calendars IS
  'Los calendarios de cada cuenta de Google conectada por una persona. check_conflicts = se leen sus horarios ocupados; is_active = sigue existiendo en la cuenta.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'calendars_access_role_check') THEN
    ALTER TABLE public.calendars ADD CONSTRAINT calendars_access_role_check
      CHECK (access_role IN ('owner', 'writer', 'reader', 'freeBusyReader'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_calendars_connection_external
  ON public.calendars (connection_id, external_calendar_id);
CREATE INDEX IF NOT EXISTS idx_calendars_ws_user
  ON public.calendars (workspace_id, user_id, is_active);

DROP TRIGGER IF EXISTS set_updated_at ON public.calendars;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.calendars
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.calendars ENABLE ROW LEVEL SECURITY;

-- Los ve la persona dueña (o quien administra agendas ajenas). Los titulos de
-- los eventos de Google nunca estan aca: solo el nombre del calendario.
DROP POLICY IF EXISTS "calendars_select" ON public.calendars;
CREATE POLICY "calendars_select" ON public.calendars
  FOR SELECT USING (public.scheduling_can_manage(workspace_id, user_id));

-- Insertar y borrar es del servidor (la sincronizacion con Google). La persona
-- solo cambia sus switches (check_conflicts).
DROP POLICY IF EXISTS "calendars_update_own" ON public.calendars;
CREATE POLICY "calendars_update_own" ON public.calendars
  FOR UPDATE USING (user_id = auth.uid() AND public.is_workspace_member(workspace_id))
  WITH CHECK (user_id = auth.uid() AND public.is_workspace_member(workspace_id));

-- El destino por defecto del perfil apunta a un calendario (recien ahora que
-- la tabla existe).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scheduling_profiles_default_destination_fk') THEN
    ALTER TABLE public.scheduling_profiles
      ADD CONSTRAINT scheduling_profiles_default_destination_fk
      FOREIGN KEY (default_destination_calendar_id) REFERENCES public.calendars(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 4. contacts.timezone
-- ------------------------------------------------------------

ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS timezone text;
COMMENT ON COLUMN public.contacts.timezone IS
  'Zona IANA del contacto (ej. America/Mexico_City). La aprende la agenda del invitado; el agente de chat la confirma antes de proponer horarios.';

-- ------------------------------------------------------------
-- 5. Bucket avatars
-- ------------------------------------------------------------
-- Publico para leer: la foto se muestra en la pagina publica de reserva, que
-- no tiene sesion. Escribir es de miembros del workspace, en su carpeta
-- (<workspace_id>/<user_id>/<archivo>).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  true,
  2097152,  -- 2 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

UPDATE storage.buckets
SET public = true,
    file_size_limit = 2097152,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
WHERE id = 'avatars';

DROP POLICY IF EXISTS "avatars_select" ON storage.objects;
CREATE POLICY "avatars_select" ON storage.objects
  FOR SELECT USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "avatars_insert" ON storage.objects;
CREATE POLICY "avatars_insert" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'avatars'
    AND public.is_workspace_member(((storage.foldername(name))[1])::uuid)
  );

DROP POLICY IF EXISTS "avatars_update" ON storage.objects;
CREATE POLICY "avatars_update" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'avatars'
    AND public.is_workspace_member(((storage.foldername(name))[1])::uuid)
  );

DROP POLICY IF EXISTS "avatars_delete" ON storage.objects;
CREATE POLICY "avatars_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'avatars'
    AND public.is_workspace_member(((storage.foldername(name))[1])::uuid)
  );

-- ============================================================
-- MIGRATION 96: AVAILABILITY
-- ============================================================
-- ============================================================================
-- 00096 — Disponibilidad: horarios y tiempo fuera (Etapa 4, Bloque 2, F9)
-- ============================================================================
--  1. availability_schedules: los horarios de cada persona, con las reglas
--     semanales (`weekly_hours`) y las excepciones por fecha (`date_overrides`)
--     como jsonb (§9.0: pocas filas que siempre se leen con su horario). Un
--     solo horario por defecto por persona, garantizado con un unico parcial.
--  2. out_of_office: los periodos bloqueados de la persona, en UTC. Aplican a
--     todos sus horarios y eventos.
--  3. set_default_schedule(): marcar por defecto en UNA transaccion (el
--     anterior deja de serlo y el nuevo pasa a serlo, sin ventana en la que
--     haya dos o ninguno).
--  4. ensure_default_schedule(): crea "Horario normal" (lun a vie, 9 a 17, en
--     la zona del perfil) si la persona no tiene ningun horario. Backfill para
--     los perfiles que ya existen (F3: "al crear el perfil se crea Horario
--     normal"; el perfil llego en la 00095 y la tabla recien ahora).
--  5. purge_soft_deleted() suma las dos tablas (retencion de 30 dias).
--
-- Idempotente y aditiva.
-- ============================================================================

-- ------------------------------------------------------------
-- 1. availability_schedules
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.availability_schedules (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name           text NOT NULL,
  -- Zona IANA en la que estan escritas las reglas ("09:00" es 09:00 ACA).
  timezone       text NOT NULL,
  is_default     boolean NOT NULL DEFAULT false,
  -- { "1": [{"start":"09:00","end":"13:00"}], ... } clave = dia (0 = domingo).
  weekly_hours   jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- [{ "date": "2026-10-12", "ranges": [] }, ...] ranges vacio = no disponible.
  date_overrides jsonb NOT NULL DEFAULT '[]'::jsonb,
  deleted_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.availability_schedules IS
  'Horarios de disponibilidad de cada persona. Las reglas van en hora local + la zona del horario; el motor las convierte a UTC.';
COMMENT ON COLUMN public.availability_schedules.weekly_hours IS
  'Rangos por dia de la semana (clave 0=domingo..6=sabado). Dia ausente o vacio = no trabaja. Validado con Zod en la Server Action.';
COMMENT ON COLUMN public.availability_schedules.date_overrides IS
  'Excepciones por fecha: reemplazan la regla semanal de ese dia. ranges vacio = no disponible todo el dia.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'availability_schedules_name_check') THEN
    ALTER TABLE public.availability_schedules ADD CONSTRAINT availability_schedules_name_check
      CHECK (char_length(btrim(name)) BETWEEN 1 AND 60);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'availability_schedules_weekly_hours_object') THEN
    ALTER TABLE public.availability_schedules ADD CONSTRAINT availability_schedules_weekly_hours_object
      CHECK (jsonb_typeof(weekly_hours) = 'object');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'availability_schedules_date_overrides_array') THEN
    ALTER TABLE public.availability_schedules ADD CONSTRAINT availability_schedules_date_overrides_array
      CHECK (jsonb_typeof(date_overrides) = 'array');
  END IF;
END $$;

-- Exactamente un horario por defecto por persona, entre los no borrados.
CREATE UNIQUE INDEX IF NOT EXISTS uq_availability_schedules_default
  ON public.availability_schedules (user_id)
  WHERE is_default AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_availability_schedules_ws_user
  ON public.availability_schedules (workspace_id, user_id)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS set_updated_at ON public.availability_schedules;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.availability_schedules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.availability_schedules ENABLE ROW LEVEL SECURITY;

-- La persona dueña o quien tiene scheduling.manage_others (F9). Sin DELETE:
-- se marca deleted_at.
DROP POLICY IF EXISTS "availability_schedules_select" ON public.availability_schedules;
CREATE POLICY "availability_schedules_select" ON public.availability_schedules
  FOR SELECT USING (public.scheduling_can_manage(workspace_id, user_id));

DROP POLICY IF EXISTS "availability_schedules_insert" ON public.availability_schedules;
CREATE POLICY "availability_schedules_insert" ON public.availability_schedules
  FOR INSERT WITH CHECK (public.scheduling_can_manage(workspace_id, user_id));

DROP POLICY IF EXISTS "availability_schedules_update" ON public.availability_schedules;
CREATE POLICY "availability_schedules_update" ON public.availability_schedules
  FOR UPDATE USING (public.scheduling_can_manage(workspace_id, user_id))
  WITH CHECK (public.scheduling_can_manage(workspace_id, user_id));

-- El horario por defecto del perfil (la columna existe desde la 00095).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scheduling_profiles_default_schedule_fk') THEN
    ALTER TABLE public.scheduling_profiles
      ADD CONSTRAINT scheduling_profiles_default_schedule_fk
      FOREIGN KEY (default_schedule_id) REFERENCES public.availability_schedules(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 2. out_of_office
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.out_of_office (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  starts_at    timestamptz NOT NULL,
  ends_at      timestamptz NOT NULL,
  all_day      boolean NOT NULL DEFAULT true,
  reason       text NOT NULL DEFAULT 'other',
  note         text,
  deleted_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.out_of_office IS
  'Tiempo fuera de una persona (vacaciones, viajes). Bloquea todos sus horarios y eventos. Instantes en UTC.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'out_of_office_range_check') THEN
    ALTER TABLE public.out_of_office ADD CONSTRAINT out_of_office_range_check CHECK (ends_at > starts_at);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'out_of_office_reason_check') THEN
    ALTER TABLE public.out_of_office ADD CONSTRAINT out_of_office_reason_check
      CHECK (reason IN ('vacation', 'travel', 'sick', 'other'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_out_of_office_user_range
  ON public.out_of_office (user_id, starts_at, ends_at)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS set_updated_at ON public.out_of_office;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.out_of_office
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.out_of_office ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "out_of_office_select" ON public.out_of_office;
CREATE POLICY "out_of_office_select" ON public.out_of_office
  FOR SELECT USING (public.scheduling_can_manage(workspace_id, user_id));

DROP POLICY IF EXISTS "out_of_office_insert" ON public.out_of_office;
CREATE POLICY "out_of_office_insert" ON public.out_of_office
  FOR INSERT WITH CHECK (public.scheduling_can_manage(workspace_id, user_id));

DROP POLICY IF EXISTS "out_of_office_update" ON public.out_of_office;
CREATE POLICY "out_of_office_update" ON public.out_of_office
  FOR UPDATE USING (public.scheduling_can_manage(workspace_id, user_id))
  WITH CHECK (public.scheduling_can_manage(workspace_id, user_id));

-- ------------------------------------------------------------
-- 3. Marcar por defecto, en una sola transaccion
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_default_schedule(p_schedule_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ws   uuid;
  v_user uuid;
BEGIN
  SELECT workspace_id, user_id INTO v_ws, v_user
  FROM public.availability_schedules
  WHERE id = p_schedule_id AND deleted_at IS NULL;

  IF v_ws IS NULL THEN
    RAISE EXCEPTION 'schedule_not_found';
  END IF;
  IF NOT public.scheduling_can_manage(v_ws, v_user) THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;

  -- Primero se apaga el anterior: el unico parcial no admite dos a la vez.
  UPDATE public.availability_schedules
  SET is_default = false
  WHERE user_id = v_user AND deleted_at IS NULL AND is_default AND id <> p_schedule_id;

  UPDATE public.availability_schedules
  SET is_default = true
  WHERE id = p_schedule_id;

  UPDATE public.scheduling_profiles
  SET default_schedule_id = p_schedule_id
  WHERE workspace_id = v_ws AND user_id = v_user;
END;
$$;

REVOKE ALL ON FUNCTION public.set_default_schedule(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_default_schedule(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 4. "Horario normal" si la persona no tiene ninguno (F3)
-- ------------------------------------------------------------
-- Lun a vie, 9 a 17, en la zona del perfil. Es el mismo valor que
-- defaultWeeklyHours() en lib/scheduling/availability-schema.ts (hay un test
-- que compara los dos).

CREATE OR REPLACE FUNCTION public.ensure_default_schedule(p_workspace_id uuid, p_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_existing uuid;
  v_tz       text;
  v_id       uuid;
BEGIN
  IF NOT public.scheduling_can_manage(p_workspace_id, p_user_id) AND auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;

  SELECT id INTO v_existing
  FROM public.availability_schedules
  WHERE workspace_id = p_workspace_id AND user_id = p_user_id AND deleted_at IS NULL
  ORDER BY is_default DESC, created_at ASC
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    -- Hay horarios pero ninguno por defecto: el mas viejo pasa a serlo.
    IF NOT EXISTS (
      SELECT 1 FROM public.availability_schedules
      WHERE user_id = p_user_id AND deleted_at IS NULL AND is_default
    ) THEN
      UPDATE public.availability_schedules SET is_default = true WHERE id = v_existing;
      UPDATE public.scheduling_profiles SET default_schedule_id = v_existing
      WHERE workspace_id = p_workspace_id AND user_id = p_user_id;
    END IF;
    RETURN v_existing;
  END IF;

  SELECT timezone INTO v_tz FROM public.scheduling_profiles
  WHERE workspace_id = p_workspace_id AND user_id = p_user_id;
  IF v_tz IS NULL THEN
    SELECT timezone INTO v_tz FROM public.workspaces WHERE id = p_workspace_id;
  END IF;

  INSERT INTO public.availability_schedules (workspace_id, user_id, name, timezone, is_default, weekly_hours, date_overrides)
  VALUES (
    p_workspace_id, p_user_id, 'Horario normal', COALESCE(v_tz, 'America/Costa_Rica'), true,
    '{"1":[{"start":"09:00","end":"17:00"}],"2":[{"start":"09:00","end":"17:00"}],"3":[{"start":"09:00","end":"17:00"}],"4":[{"start":"09:00","end":"17:00"}],"5":[{"start":"09:00","end":"17:00"}]}'::jsonb,
    '[]'::jsonb
  )
  RETURNING id INTO v_id;

  UPDATE public.scheduling_profiles SET default_schedule_id = v_id
  WHERE workspace_id = p_workspace_id AND user_id = p_user_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_default_schedule(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_default_schedule(uuid, uuid) TO authenticated, service_role;

-- Backfill: los perfiles creados con la 00095 todavia no tienen horario.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT workspace_id, user_id FROM public.scheduling_profiles LOOP
    PERFORM public.ensure_default_schedule(r.workspace_id, r.user_id);
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 5. Purga de borrados logicos (30 dias)
-- ------------------------------------------------------------
-- Copia de la definicion vigente mas las dos tablas nuevas. El resultado
-- conserva las claves de siempre y suma las nuevas.

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
  v_schedules  integer := 0;
  v_ooo        integer := 0;
BEGIN
  DELETE FROM public.contacts WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_contacts = ROW_COUNT;

  DELETE FROM public.conversations WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_convs = ROW_COUNT;

  DELETE FROM public.contact_notes WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_notes = ROW_COUNT;

  DELETE FROM public.response_templates WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_templates = ROW_COUNT;

  DELETE FROM public.availability_schedules WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_schedules = ROW_COUNT;

  DELETE FROM public.out_of_office WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_ooo = ROW_COUNT;

  RETURN jsonb_build_object(
    'cutoff', v_cutoff,
    'contacts', v_contacts,
    'conversations', v_convs,
    'contact_notes', v_notes,
    'response_templates', v_templates,
    'availability_schedules', v_schedules,
    'out_of_office', v_ooo
  );
END;
$$;

REVOKE ALL ON FUNCTION public.purge_soft_deleted(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_soft_deleted(integer) TO service_role;

-- ============================================================
-- MIGRATION 97: BOOKING CATEGORIES
-- ============================================================
-- ============================================================================
-- 00097 — Categorias de agenda (Etapa 4, Bloque 3, F50)
-- ============================================================================
-- Una sola tabla con dos niveles: `parent_id` null = AREA; con `parent_id` =
-- TIPO dentro de esa area. Un trigger impide el tercer nivel.
--
-- Precarga por workspace (trigger + backfill): areas Ventas y Servicio
-- (`is_system`: se renombran, no se archivan) con sus tipos.
--
-- No hay borrado: se archiva (`archived_at`). La policy de DELETE no existe.
--
-- Idempotente y aditiva.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.booking_categories (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- null = area; con valor = tipo dentro de esa area.
  parent_id    uuid REFERENCES public.booking_categories(id) ON DELETE CASCADE,
  name         text NOT NULL,
  -- Solo las areas tienen color.
  color        text,
  position     integer NOT NULL DEFAULT 0,
  -- Ventas y Servicio: se renombran, no se archivan.
  is_system    boolean NOT NULL DEFAULT false,
  archived_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.booking_categories IS
  'Areas (parent_id null) y tipos (con parent_id) con los que se clasifican eventos y agendas. Maximo dos niveles.';
COMMENT ON COLUMN public.booking_categories.is_system IS
  'Ventas y Servicio vienen precargadas: se renombran pero no se archivan.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_categories_name_check') THEN
    ALTER TABLE public.booking_categories ADD CONSTRAINT booking_categories_name_check
      CHECK (char_length(btrim(name)) BETWEEN 1 AND 40);
  END IF;
END $$;

-- Unico por nivel, sin distinguir mayusculas, entre los NO archivados. El
-- coalesce evita areas duplicadas: en Postgres dos NULL no chocan entre si.
CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_categories_name
  ON public.booking_categories (
    workspace_id,
    coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(name)
  )
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_booking_categories_ws
  ON public.booking_categories (workspace_id, parent_id, position);

DROP TRIGGER IF EXISTS set_updated_at ON public.booking_categories;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.booking_categories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ------------------------------------------------------------
-- Maximo dos niveles: el padre tiene que ser un area
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.booking_categories_two_levels()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_grandparent uuid; v_parent_ws uuid;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT parent_id, workspace_id INTO v_grandparent, v_parent_ws
  FROM public.booking_categories WHERE id = NEW.parent_id;

  IF v_parent_ws IS NULL THEN
    RAISE EXCEPTION 'la categoria padre no existe';
  END IF;
  IF v_parent_ws <> NEW.workspace_id THEN
    RAISE EXCEPTION 'la categoria padre es de otro negocio';
  END IF;
  IF v_grandparent IS NOT NULL THEN
    RAISE EXCEPTION 'solo hay dos niveles: un tipo no puede tener tipos adentro';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS booking_categories_two_levels ON public.booking_categories;
CREATE TRIGGER booking_categories_two_levels
  BEFORE INSERT OR UPDATE OF parent_id ON public.booking_categories
  FOR EACH ROW EXECUTE FUNCTION public.booking_categories_two_levels();

-- ------------------------------------------------------------
-- Precarga por workspace
-- ------------------------------------------------------------
-- Las mismas areas y tipos que SYSTEM_AREAS en lib/scheduling/categories.ts
-- (hay un test que compara las dos listas).

CREATE OR REPLACE FUNCTION public.seed_booking_categories()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_ventas uuid; v_servicio uuid;
BEGIN
  INSERT INTO public.booking_categories (workspace_id, name, color, position, is_system)
  VALUES (NEW.id, 'Ventas', '#2563eb', 0, true)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_ventas;

  INSERT INTO public.booking_categories (workspace_id, name, color, position, is_system)
  VALUES (NEW.id, 'Servicio', '#0d9488', 1, true)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_servicio;

  IF v_ventas IS NOT NULL THEN
    INSERT INTO public.booking_categories (workspace_id, parent_id, name, position, is_system)
    VALUES (NEW.id, v_ventas, 'Triaje', 0, true),
           (NEW.id, v_ventas, 'Cierre', 1, true),
           (NEW.id, v_ventas, 'Seguimiento', 2, true)
    ON CONFLICT DO NOTHING;
  END IF;

  IF v_servicio IS NOT NULL THEN
    INSERT INTO public.booking_categories (workspace_id, parent_id, name, position, is_system)
    VALUES (NEW.id, v_servicio, 'Onboarding', 0, true),
           (NEW.id, v_servicio, 'Uno a uno', 1, true)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS seed_booking_categories ON public.workspaces;
CREATE TRIGGER seed_booking_categories AFTER INSERT ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.seed_booking_categories();

-- Backfill para los workspaces que ya existen.
DO $$
DECLARE r record; v_ventas uuid; v_servicio uuid;
BEGIN
  FOR r IN SELECT id FROM public.workspaces LOOP
    IF EXISTS (SELECT 1 FROM public.booking_categories WHERE workspace_id = r.id) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.booking_categories (workspace_id, name, color, position, is_system)
    VALUES (r.id, 'Ventas', '#2563eb', 0, true) RETURNING id INTO v_ventas;
    INSERT INTO public.booking_categories (workspace_id, name, color, position, is_system)
    VALUES (r.id, 'Servicio', '#0d9488', 1, true) RETURNING id INTO v_servicio;

    INSERT INTO public.booking_categories (workspace_id, parent_id, name, position, is_system)
    VALUES (r.id, v_ventas, 'Triaje', 0, true),
           (r.id, v_ventas, 'Cierre', 1, true),
           (r.id, v_ventas, 'Seguimiento', 2, true),
           (r.id, v_servicio, 'Onboarding', 0, true),
           (r.id, v_servicio, 'Uno a uno', 1, true);
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
-- Lectura: todos los miembros (hace falta para elegir y para filtrar).
-- Escritura: `scheduling.manage_categories`, o admin (has_permission devuelve
-- false para el rol Member de sistema, que efectivamente no lo tiene).
-- DELETE: nadie. Se archiva.

ALTER TABLE public.booking_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "booking_categories_select" ON public.booking_categories;
CREATE POLICY "booking_categories_select" ON public.booking_categories
  FOR SELECT USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "booking_categories_insert" ON public.booking_categories;
CREATE POLICY "booking_categories_insert" ON public.booking_categories
  FOR INSERT WITH CHECK (
    public.is_workspace_admin(workspace_id)
    OR public.has_permission(workspace_id, 'scheduling.manage_categories')
  );

DROP POLICY IF EXISTS "booking_categories_update" ON public.booking_categories;
CREATE POLICY "booking_categories_update" ON public.booking_categories
  FOR UPDATE USING (
    public.is_workspace_admin(workspace_id)
    OR public.has_permission(workspace_id, 'scheduling.manage_categories')
  )
  WITH CHECK (
    public.is_workspace_admin(workspace_id)
    OR public.has_permission(workspace_id, 'scheduling.manage_categories')
  );

-- ============================================================
-- MIGRATION 98: EVENT TYPES
-- ============================================================
-- ============================================================================
-- 00098 — Tipos de evento (Etapa 4, Bloque 3, F16)
-- ============================================================================
--  1. event_types (§9.3 completa): el anfitrion es `owner_user_id` (no se crea
--     `event_type_hosts` en esta etapa), los calendarios de conflicto son una
--     lista de ids, el formulario y los mensajes de "no se puede agendar" van
--     en jsonb.
--  2. flows.event_type_id y flows.template_key (para los flujos por evento, B7).
--  3. workspaces.scheduling_auto_create_flows y scheduling_public_base_url.
--  4. Los eventos entran en la purga de borrados logicos, SALVO los que tienen
--     agendas (§16: "los eventos con agendas se conservan"). Como `bookings`
--     llega en la 00099, la condicion se escribe con to_regclass para que la
--     funcion valga antes y despues.
--
-- Idempotente y aditiva.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.event_types (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id                uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  category_id                 uuid NOT NULL REFERENCES public.booking_categories(id),
  owner_user_id               uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title                       text NOT NULL,
  slug                        text NOT NULL,
  description_md              text,
  duration_minutes            integer NOT NULL DEFAULT 30,
  color                       text,
  location_type               text NOT NULL DEFAULT 'google_meet',
  location_text               text,
  hide_location_until_booked  boolean NOT NULL DEFAULT false,
  status                      text NOT NULL DEFAULT 'inactive',
  -- Hoy siempre 'individual'. La fase de equipos suma round_robin y collective.
  scheduling_type             text NOT NULL DEFAULT 'individual',
  -- null = usa el horario por defecto de la persona.
  schedule_id                 uuid REFERENCES public.availability_schedules(id) ON DELETE SET NULL,
  -- null = usa el calendario destino del perfil.
  destination_calendar_id     uuid REFERENCES public.calendars(id) ON DELETE SET NULL,
  -- vacio = usa los calendarios de conflicto del perfil.
  conflict_calendar_ids       uuid[] NOT NULL DEFAULT '{}',
  before_buffer_minutes       integer NOT NULL DEFAULT 0,
  after_buffer_minutes        integer NOT NULL DEFAULT 0,
  minimum_notice_minutes      integer NOT NULL DEFAULT 120,
  -- null = igual a la duracion.
  slot_interval_minutes       integer,
  max_per_day                 integer,
  max_per_week                integer,
  period_type                 text NOT NULL DEFAULT 'rolling_calendar',
  period_days                 integer DEFAULT 60,
  period_start_date           date,
  period_end_date             date,
  contact_assignment          text NOT NULL DEFAULT 'none',
  success_redirect_url        text,
  redirect_with_params        boolean NOT NULL DEFAULT false,
  -- Reservada: sin limites para cancelar ni reagendar en esta etapa (F30 se elimino).
  change_min_notice_minutes   integer,
  booking_fields              jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- null = los textos por defecto (F58).
  unavailable_messages        jsonb,
  deleted_at                  timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.event_types IS
  'Los tipos de llamada que se pueden agendar. El anfitrion es owner_user_id; los eventos de equipo llegan en la fase futura.';
COMMENT ON COLUMN public.event_types.conflict_calendar_ids IS
  'Calendarios de conflicto propios del evento. Vacio = los del perfil. Los ids inactivos se ignoran al leer.';
COMMENT ON COLUMN public.event_types.booking_fields IS
  'Formulario de reserva (F20), validado con Zod: [{id, type, system, label, visibility, options?, identifier, ...}].';
COMMENT ON COLUMN public.event_types.unavailable_messages IS
  'Que ve el invitado cuando no puede agendar (F58). null = textos por defecto.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_types_status_check') THEN
    ALTER TABLE public.event_types ADD CONSTRAINT event_types_status_check
      CHECK (status IN ('active', 'hidden', 'inactive'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_types_location_check') THEN
    ALTER TABLE public.event_types ADD CONSTRAINT event_types_location_check
      CHECK (location_type IN ('google_meet', 'manual'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_types_scheduling_type_check') THEN
    ALTER TABLE public.event_types ADD CONSTRAINT event_types_scheduling_type_check
      CHECK (scheduling_type IN ('individual', 'round_robin', 'collective'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_types_period_check') THEN
    ALTER TABLE public.event_types ADD CONSTRAINT event_types_period_check
      CHECK (period_type IN ('rolling_calendar', 'rolling_business', 'range', 'unlimited'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_types_assignment_check') THEN
    ALTER TABLE public.event_types ADD CONSTRAINT event_types_assignment_check
      CHECK (contact_assignment IN ('none', 'setter_if_empty', 'vendedor_if_empty'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_types_duration_check') THEN
    ALTER TABLE public.event_types ADD CONSTRAINT event_types_duration_check
      CHECK (duration_minutes BETWEEN 5 AND 480);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_types_slug_check') THEN
    ALTER TABLE public.event_types ADD CONSTRAINT event_types_slug_check
      CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) <= 60);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_types_booking_fields_array') THEN
    ALTER TABLE public.event_types ADD CONSTRAINT event_types_booking_fields_array
      CHECK (jsonb_typeof(booking_fields) = 'array');
  END IF;
END $$;

-- El slug es unico por PERSONA (no por workspace): dos personas pueden tener
-- "llamada" y sus links no chocan porque llevan el usuario adelante.
CREATE UNIQUE INDEX IF NOT EXISTS uq_event_types_owner_slug
  ON public.event_types (owner_user_id, slug)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_event_types_ws_status
  ON public.event_types (workspace_id, status)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_event_types_owner
  ON public.event_types (owner_user_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_event_types_category
  ON public.event_types (workspace_id, category_id)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS set_updated_at ON public.event_types;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.event_types
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.event_types ENABLE ROW LEVEL SECURITY;

-- Lectura: todos los miembros (hace falta para elegir eventos en los flows y
-- en el agendar manual). La lectura PUBLICA no pasa por aca: la hace el
-- servidor con service role y campos filtrados (§15: no hay policy para anon).
DROP POLICY IF EXISTS "event_types_select" ON public.event_types;
CREATE POLICY "event_types_select" ON public.event_types
  FOR SELECT USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "event_types_insert" ON public.event_types;
CREATE POLICY "event_types_insert" ON public.event_types
  FOR INSERT WITH CHECK (public.scheduling_can_manage(workspace_id, owner_user_id));

DROP POLICY IF EXISTS "event_types_update" ON public.event_types;
CREATE POLICY "event_types_update" ON public.event_types
  FOR UPDATE USING (public.scheduling_can_manage(workspace_id, owner_user_id))
  WITH CHECK (public.scheduling_can_manage(workspace_id, owner_user_id));

-- ------------------------------------------------------------
-- flows y workspaces
-- ------------------------------------------------------------

ALTER TABLE public.flows ADD COLUMN IF NOT EXISTS event_type_id uuid REFERENCES public.event_types(id) ON DELETE SET NULL;
ALTER TABLE public.flows ADD COLUMN IF NOT EXISTS template_key text;

COMMENT ON COLUMN public.flows.event_type_id IS
  'El evento de agenda al que pertenece este flujo (F48, F49). null = flujo general.';
COMMENT ON COLUMN public.flows.template_key IS
  'Cual de las 7 plantillas precreadas es (F49): confirmation, reminder_24h, ...';

CREATE INDEX IF NOT EXISTS idx_flows_event_type ON public.flows (event_type_id) WHERE event_type_id IS NOT NULL;

ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS scheduling_auto_create_flows boolean NOT NULL DEFAULT true;
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS scheduling_public_base_url text;

COMMENT ON COLUMN public.workspaces.scheduling_auto_create_flows IS
  'Crear los 7 flujos sugeridos (apagados) al crear un evento (F49).';
COMMENT ON COLUMN public.workspaces.scheduling_public_base_url IS
  'Dominio propio de las paginas publicas de agenda (F42). null = NEXT_PUBLIC_APP_URL.';

-- ------------------------------------------------------------
-- Purga: los eventos borrados, salvo los que tienen agendas
-- ------------------------------------------------------------

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
  v_schedules  integer := 0;
  v_ooo        integer := 0;
  v_events     integer := 0;
BEGIN
  DELETE FROM public.contacts WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_contacts = ROW_COUNT;

  DELETE FROM public.conversations WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_convs = ROW_COUNT;

  DELETE FROM public.contact_notes WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_notes = ROW_COUNT;

  DELETE FROM public.response_templates WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_templates = ROW_COUNT;

  DELETE FROM public.availability_schedules WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_schedules = ROW_COUNT;

  DELETE FROM public.out_of_office WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_ooo = ROW_COUNT;

  -- Un evento con agendas NO se purga: la agenda guarda su historia y apunta
  -- al evento. (bookings llega en la 00099; antes de eso la condicion de
  -- existencia da falso y se purgan todos los borrados.)
  IF to_regclass('public.bookings') IS NULL THEN
    DELETE FROM public.event_types WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  ELSE
    EXECUTE '
      DELETE FROM public.event_types e
      WHERE e.deleted_at IS NOT NULL AND e.deleted_at < $1
        AND NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.event_type_id = e.id)
    ' USING v_cutoff;
  END IF;
  GET DIAGNOSTICS v_events = ROW_COUNT;

  RETURN jsonb_build_object(
    'cutoff', v_cutoff,
    'contacts', v_contacts,
    'conversations', v_convs,
    'contact_notes', v_notes,
    'response_templates', v_templates,
    'availability_schedules', v_schedules,
    'out_of_office', v_ooo,
    'event_types', v_events
  );
END;
$$;

REVOKE ALL ON FUNCTION public.purge_soft_deleted(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_soft_deleted(integer) TO service_role;

-- ============================================================
-- MIGRATION 99: BOOKINGS
-- ============================================================
-- ============================================================================
-- 00099 — Agendas (Etapa 4, Bloque 4a, F26)
-- ============================================================================
--  1. `bookings` (§9.4): una fila por reunion. `status_group` es una columna
--     CALCULADA (el CASE sale de groupOf() en booking-status.ts; hay un test
--     que compara las dos listas). La proteccion contra doble reserva es una
--     restriccion de EXCLUSION sobre los estados activos, que es lo unico que
--     funciona de verdad con dos pedidos simultaneos.
--  2. `rate_limits`: generica, para cualquier endpoint publico. Sin
--     workspace_id, sin policies: solo service role.
--  3. `can_see_booking(id)`: la regla de quien ve una agenda.
--  4. Una rama nueva en `audit_log_select`: el historial de la agenda es el
--     audit_log con `entity_type = 'booking'`, visible para quien ve la agenda.
--  5. `scheduled_jobs.status` suma `cancelled` (anular los jobs relativos) y
--     un indice de expresion por `payload->>'booking_id'`.
--  6. `create_booking(...)`: crea el contacto (o lo encuentra), aplica la
--     asignacion, inserta la agenda, el historial, el evento de automatizacion
--     y los jobs. Todo en UNA transaccion, con advisory lock por anfitrion.
--
-- Idempotente y aditiva.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

-- ------------------------------------------------------------
-- 1. bookings
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.bookings (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id                uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- 22 caracteres URL-safe: es el token secreto de cancelar y reagendar.
  uid                         text NOT NULL,
  event_type_id               uuid NOT NULL REFERENCES public.event_types(id),
  category_id                 uuid REFERENCES public.booking_categories(id),
  category_snapshot           jsonb,
  metadata                    jsonb NOT NULL DEFAULT '{}'::jsonb,
  host_user_id                uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id                  uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  title                       text NOT NULL,
  start_at                    timestamptz NOT NULL,
  end_at                      timestamptz NOT NULL,
  status                      text NOT NULL DEFAULT 'scheduled',
  status_changed_at           timestamptz,
  status_changed_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  booker_name                 text,
  booker_email                text,
  booker_phone                text,
  booker_timezone             text,
  host_timezone               text,
  location_type               text,
  location_text               text,
  meet_url                    text,
  responses                   jsonb NOT NULL DEFAULT '{}'::jsonb,
  origin                      text NOT NULL DEFAULT 'public_page',
  utm                         jsonb NOT NULL DEFAULT '{}'::jsonb,
  referrer_url                text,
  created_by                  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reschedule_count            integer NOT NULL DEFAULT 0,
  cancelled_at                timestamptz,
  cancelled_by_type           text,
  cancelled_by_user_id        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cancellation_reason         text,
  internal_notes              text,
  google_sync_status          text NOT NULL DEFAULT 'pending',
  google_sync_error           text,
  google_connection_id        uuid REFERENCES public.oauth_connections(id) ON DELETE SET NULL,
  google_calendar_id          uuid REFERENCES public.calendars(id) ON DELETE SET NULL,
  google_event_id             text,
  ical_uid                    text,
  google_event_deleted_at     timestamptz,
  is_do_not_contact_at_booking boolean NOT NULL DEFAULT false,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  -- Calculada: el CASE es groupOf() de lib/scheduling/booking-status.ts.
  status_group                text GENERATED ALWAYS AS (
    CASE
      WHEN status IN ('scheduled', 'confirmed', 'rescheduled') THEN 'active'
      WHEN status = 'no_show' THEN 'no_show'
      WHEN status IN ('followup_warm', 'followup_cold', 'sale', 'not_qualified') THEN 'outcome'
      ELSE 'cancelled'
    END
  ) STORED
);

COMMENT ON TABLE public.bookings IS
  'Una fila por reunion agendada. No se borran: cancelar es un estado. El historial vive en audit_log con entity_type = booking.';
COMMENT ON COLUMN public.bookings.uid IS
  'Token publico de 22 caracteres (unos 131 bits): con el se cancela y se reagenda sin sesion. Nunca se le entrega al agente de IA.';
COMMENT ON COLUMN public.bookings.status_group IS
  'Calculada desde status. active / no_show / outcome / cancelled. Solo las active ocupan el horario.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_status_check') THEN
    ALTER TABLE public.bookings ADD CONSTRAINT bookings_status_check CHECK (status IN (
      'scheduled', 'confirmed', 'rescheduled',
      'no_show',
      'followup_warm', 'followup_cold', 'sale', 'not_qualified',
      'cancelled_not_qualified', 'cancelled_no_response', 'cancelled_other'
    ));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_origin_check') THEN
    ALTER TABLE public.bookings ADD CONSTRAINT bookings_origin_check
      CHECK (origin IN ('public_page', 'embed', 'manual', 'agent', 'api'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_cancelled_by_check') THEN
    ALTER TABLE public.bookings ADD CONSTRAINT bookings_cancelled_by_check
      CHECK (cancelled_by_type IS NULL OR cancelled_by_type IN ('invitee', 'host', 'system'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_sync_status_check') THEN
    ALTER TABLE public.bookings ADD CONSTRAINT bookings_sync_status_check
      CHECK (google_sync_status IN ('pending', 'synced', 'failed', 'not_applicable'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_range_check') THEN
    ALTER TABLE public.bookings ADD CONSTRAINT bookings_range_check CHECK (end_at > start_at);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_bookings_uid ON public.bookings (uid);
CREATE INDEX IF NOT EXISTS idx_bookings_ws_start ON public.bookings (workspace_id, start_at);
CREATE INDEX IF NOT EXISTS idx_bookings_ws_category_start ON public.bookings (workspace_id, category_id, start_at);
CREATE INDEX IF NOT EXISTS idx_bookings_host_start ON public.bookings (host_user_id, start_at);
CREATE INDEX IF NOT EXISTS idx_bookings_contact_start ON public.bookings (contact_id, start_at);
CREATE INDEX IF NOT EXISTS idx_bookings_ws_status_start ON public.bookings (workspace_id, status, start_at);
CREATE INDEX IF NOT EXISTS idx_bookings_event_start ON public.bookings (event_type_id, start_at);

-- La proteccion de verdad contra la doble reserva: dos agendas ACTIVAS del
-- mismo anfitrion no pueden superponerse. El advisory lock de create_booking
-- evita el reintento perdido; esto evita la carrera.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_no_overlap') THEN
    ALTER TABLE public.bookings ADD CONSTRAINT bookings_no_overlap
      EXCLUDE USING gist (
        host_user_id WITH =,
        tstzrange(start_at, end_at) WITH &&
      ) WHERE (status IN ('scheduled', 'confirmed', 'rescheduled'));
  END IF;
END $$;

DROP TRIGGER IF EXISTS set_updated_at ON public.bookings;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ------------------------------------------------------------
-- 2. can_see_booking
-- ------------------------------------------------------------
-- Owner o Admin; o `bookings.view` con alcance `all`; o es el anfitrion.
-- Para el rol Member de sistema, has_permission da false (sus permisos viven
-- en TypeScript) y cae al tercer caso, que es justo su alcance `own`.

CREATE OR REPLACE FUNCTION public.can_see_booking(b public.bookings)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.is_workspace_member(b.workspace_id)
     AND (
       public.is_workspace_admin(b.workspace_id)
       OR b.host_user_id = auth.uid()
       OR (
         public.has_permission(b.workspace_id, 'bookings.view')
         AND public.permission_scope(b.workspace_id, 'bookings') = 'all'
       )
     );
$$;

REVOKE ALL ON FUNCTION public.can_see_booking(public.bookings) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_see_booking(public.bookings) TO authenticated, service_role;

ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

-- Solo lectura para los usuarios: escribir es del servidor (las acciones ya
-- verifican el permiso). Sin DELETE: las agendas no se borran.
DROP POLICY IF EXISTS "bookings_select" ON public.bookings;
CREATE POLICY "bookings_select" ON public.bookings
  FOR SELECT USING (public.can_see_booking(bookings));

-- ------------------------------------------------------------
-- 3. audit_log: el historial de la agenda
-- ------------------------------------------------------------
-- Se copia la politica vigente (00068) y se suma una rama: las filas de
-- entity_type = 'booking' las ve quien ve la agenda.

DROP POLICY IF EXISTS "audit_log_select" ON public.audit_log;
CREATE POLICY "audit_log_select" ON public.audit_log
  FOR SELECT TO authenticated
  USING (
    public.is_workspace_admin(workspace_id)
    OR (public.is_workspace_member(workspace_id) AND performed_by = auth.uid())
    OR (
      public.is_workspace_member(workspace_id)
      AND performed_by_agent_id IS NOT NULL
      AND (
        (entity_type = 'contact' AND EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = audit_log.entity_id))
        OR (entity_type = 'conversation' AND EXISTS (SELECT 1 FROM public.conversations cv WHERE cv.id = audit_log.entity_id))
      )
    )
    -- Etapa 4: el historial de una agenda lo ve quien ve la agenda.
    OR (
      public.is_workspace_member(workspace_id)
      AND entity_type = 'booking'
      AND EXISTS (SELECT 1 FROM public.bookings b WHERE b.id = audit_log.entity_id)
    )
  );

CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON public.audit_log (entity_type, entity_id, performed_at DESC);

-- ------------------------------------------------------------
-- 4. rate_limits
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.rate_limits (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- prefijo del modulo + accion + hash de IP: "scheduling:create:<sha256>".
  key          text NOT NULL,
  window_start timestamptz NOT NULL,
  count        integer NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.rate_limits IS
  'Tope por IP de los endpoints publicos. La IP va como hash con sal, nunca en texto. Se purga a las 24 h.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_rate_limits_key_window ON public.rate_limits (key, window_start);
CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON public.rate_limits (window_start);

-- Sin policies: solo el service role entra.
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

/** Suma uno y devuelve cuantos van en la ventana. Solo service role. */
CREATE OR REPLACE FUNCTION public.bump_rate_limit(p_key text, p_window_start timestamptz)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_count integer;
BEGIN
  INSERT INTO public.rate_limits (key, window_start, count)
  VALUES (p_key, p_window_start, 1)
  ON CONFLICT (key, window_start) DO UPDATE SET count = public.rate_limits.count + 1
  RETURNING count INTO v_count;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.bump_rate_limit(text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bump_rate_limit(text, timestamptz) TO service_role;

/** Purga lo que ya no sirve (24 h). La llama el cron diario. */
CREATE OR REPLACE FUNCTION public.purge_rate_limits()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v integer;
BEGIN
  DELETE FROM public.rate_limits WHERE window_start < now() - interval '24 hours';
  GET DIAGNOSTICS v = ROW_COUNT;
  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_rate_limits() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_rate_limits() TO service_role;

-- ------------------------------------------------------------
-- 5. scheduled_jobs: estado `cancelled` e indice por agenda
-- ------------------------------------------------------------
-- Aditivo: se suma un valor al CHECK. El runner solo toma `pending`, asi que
-- un job `cancelled` queda fuera sin tocar nada mas.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scheduled_jobs_status_check') THEN
    ALTER TABLE public.scheduled_jobs DROP CONSTRAINT scheduled_jobs_status_check;
  END IF;
  ALTER TABLE public.scheduled_jobs ADD CONSTRAINT scheduled_jobs_status_check
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled'));
END $$;

CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_booking
  ON public.scheduled_jobs ((payload->>'booking_id'))
  WHERE payload ? 'booking_id';

-- ------------------------------------------------------------
-- 6. create_booking
-- ------------------------------------------------------------
-- Una sola transaccion: contacto, asignacion, agenda, historial, evento de
-- automatizacion y jobs. El advisory lock serializa los pedidos del mismo
-- anfitrion; la exclusion es la garantia final.
--
-- La deduplicacion reproduce la prioridad de find_or_link_contact (telefono,
-- despues email) sin exigir un canal: una reserva publica no viene de uno.

CREATE OR REPLACE FUNCTION public.create_booking(
  p_workspace_id   uuid,
  p_event_type_id  uuid,
  p_host_user_id   uuid,
  p_start_at       timestamptz,
  p_end_at         timestamptz,
  p_title          text,
  p_name           text,
  p_email          text,
  p_phone          text,
  p_timezone       text,
  p_host_timezone  text,
  p_location_type  text,
  p_location_text  text,
  p_responses      jsonb,
  p_origin         text,
  p_utm            jsonb,
  p_referrer_url   text,
  p_uid            text,
  p_category_id    uuid,
  p_category_snapshot jsonb,
  p_contact_assignment text,
  p_created_by     uuid DEFAULT NULL,
  p_contact_id     uuid DEFAULT NULL,
  p_metadata       jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_contact_id   uuid := p_contact_id;
  v_created      boolean := false;
  v_booking_id   uuid;
  v_email        text := nullif(btrim(lower(p_email)), '');
  v_phone        text := nullif(btrim(p_phone), '');
  v_dnc          boolean := false;
  v_setter       uuid;
  v_vendedor     uuid;
  v_assigned     boolean := false;
BEGIN
  -- Serializa los pedidos del mismo anfitrion dentro de la transaccion.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_host_user_id::text, 0));

  -- a. El contacto. Si viene dado (agendar manual, agente), se usa tal cual.
  IF v_contact_id IS NULL THEN
    IF v_phone IS NOT NULL THEN
      SELECT id INTO v_contact_id FROM public.contacts
      WHERE workspace_id = p_workspace_id AND deleted_at IS NULL
        AND (phone = v_phone OR whatsapp_phone = v_phone)
      ORDER BY created_at ASC LIMIT 1;
    END IF;

    IF v_contact_id IS NULL AND v_email IS NOT NULL THEN
      SELECT id INTO v_contact_id FROM public.contacts
      WHERE workspace_id = p_workspace_id AND deleted_at IS NULL
        AND (lower(email) = v_email OR lower(secondary_email) = v_email)
      ORDER BY created_at ASC LIMIT 1;
    END IF;

    IF v_contact_id IS NULL THEN
      INSERT INTO public.contacts (workspace_id, display_name, email, phone, timezone, attribution, last_interaction_at)
      VALUES (
        p_workspace_id,
        nullif(btrim(p_name), ''),
        v_email,
        v_phone,
        nullif(p_timezone, ''),
        coalesce(p_utm, '{}'::jsonb) || jsonb_build_object('source', 'scheduling', 'referrer', p_referrer_url),
        now()
      )
      RETURNING id INTO v_contact_id;
      v_created := true;
    END IF;
  END IF;

  -- Completa SOLO los campos vacios: nunca pisa lo que ya hay.
  IF NOT v_created THEN
    UPDATE public.contacts
    SET display_name = coalesce(display_name, nullif(btrim(p_name), '')),
        email        = coalesce(email, v_email),
        phone        = coalesce(phone, v_phone),
        timezone     = coalesce(timezone, nullif(p_timezone, '')),
        last_interaction_at = now()
    WHERE id = v_contact_id;
  END IF;

  SELECT do_not_contact, setter_id, vendedor_id INTO v_dnc, v_setter, v_vendedor
  FROM public.contacts WHERE id = v_contact_id;

  -- b. La asignacion (F22): solo si el campo esta vacio. El UPDATE dispara el
  -- trigger de la 00039, que emite assignment_changed en automation_events.
  IF p_contact_assignment = 'setter_if_empty' AND v_setter IS NULL THEN
    UPDATE public.contacts SET setter_id = p_host_user_id WHERE id = v_contact_id;
    v_assigned := true;
  ELSIF p_contact_assignment = 'vendedor_if_empty' AND v_vendedor IS NULL THEN
    UPDATE public.contacts SET vendedor_id = p_host_user_id WHERE id = v_contact_id;
    v_assigned := true;
  END IF;

  -- c. La agenda.
  INSERT INTO public.bookings (
    workspace_id, uid, event_type_id, category_id, category_snapshot, metadata,
    host_user_id, contact_id, title, start_at, end_at, status,
    booker_name, booker_email, booker_phone, booker_timezone, host_timezone,
    location_type, location_text, responses, origin, utm, referrer_url,
    created_by, is_do_not_contact_at_booking, google_sync_status
  ) VALUES (
    p_workspace_id, p_uid, p_event_type_id, p_category_id, p_category_snapshot, coalesce(p_metadata, '{}'::jsonb),
    p_host_user_id, v_contact_id, p_title, p_start_at, p_end_at, 'scheduled',
    nullif(btrim(p_name), ''), v_email, v_phone, nullif(p_timezone, ''), nullif(p_host_timezone, ''),
    p_location_type, p_location_text, coalesce(p_responses, '{}'::jsonb), p_origin,
    coalesce(p_utm, '{}'::jsonb), p_referrer_url,
    p_created_by, coalesce(v_dnc, false), 'pending'
  )
  RETURNING id INTO v_booking_id;

  -- d. El historial.
  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by)
  VALUES (
    p_workspace_id, 'booking', v_booking_id, 'booking.created',
    jsonb_build_object('start_at', p_start_at, 'end_at', p_end_at),
    jsonb_build_object('origin', p_origin, 'actor_type', CASE WHEN p_created_by IS NULL THEN 'invitee' ELSE 'user' END),
    p_created_by
  );

  -- e. El evento de automatizacion.
  INSERT INTO public.automation_events (workspace_id, event_type, contact_id, payload)
  VALUES (
    p_workspace_id, 'booking_created', v_contact_id,
    jsonb_build_object(
      'booking_id', v_booking_id,
      'event_type_id', p_event_type_id,
      'host_user_id', p_host_user_id,
      'origin', p_origin
    )
  );

  -- f. Los jobs: crear el evento en Google y avisar cuando la agenda termine.
  INSERT INTO public.scheduled_jobs (type, payload, run_at, status)
  VALUES (
    'booking_google_sync',
    jsonb_build_object('booking_id', v_booking_id, 'action', 'create', 'attempt', 0),
    now(), 'pending'
  );
  INSERT INTO public.scheduled_jobs (type, payload, run_at, status, dedupe_key)
  VALUES (
    'booking_ended',
    jsonb_build_object('booking_id', v_booking_id),
    p_end_at, 'pending', 'ended:' || v_booking_id::text || ':0'
  );

  RETURN jsonb_build_object(
    'booking_id', v_booking_id,
    'contact_id', v_contact_id,
    'created_contact', v_created,
    'assignment_changed', v_assigned,
    'do_not_contact', coalesce(v_dnc, false)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_booking(uuid, uuid, uuid, timestamptz, timestamptz, text, text, text, text, text, text, text, text, jsonb, text, jsonb, text, text, uuid, jsonb, text, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_booking(uuid, uuid, uuid, timestamptz, timestamptz, text, text, text, text, text, text, text, text, jsonb, text, jsonb, text, text, uuid, jsonb, text, uuid, uuid, jsonb) TO service_role;

-- ============================================================
-- MIGRATION 100: BOOKING TRIGGERS
-- ============================================================
-- ============================================================================
-- 00100 — Triggers de agenda (Etapa 4, Bloque 7a, F43 a F46)
-- ============================================================================
-- 1. `triggers_type_check` suma los nueve tipos de agenda. Postgres no deja
--    extender un CHECK: se tira y se rehace con la lista completa, como hizo
--    la 00087 con `email_received`.
--
-- 2. `flow_sessions.channel_id` pasa a admitir null.
--    Hasta hoy era NOT NULL y el cron de `automation_events` mandaba el canal
--    vacio cuando el contacto no tenia conversacion: el insert de la sesion
--    fallaba en silencio y el flow no corria. Un lead que agenda desde la
--    pagina publica no tiene conversacion, asi que sin esto NINGUN flujo de
--    agenda arrancaria. El motor tolera la sesion sin canal: los nodos que
--    mandan por un canal se saltean con motivo y `send_email` no lo necesita.
--
-- 3. Un indice para buscar los disparos por clave de idempotencia.
--
-- Idempotente y aditiva. No toca datos.
-- ============================================================================

-- ------------------------------------------------------------
-- 1. Los nueve tipos de agenda
-- ------------------------------------------------------------

ALTER TABLE public.triggers DROP CONSTRAINT IF EXISTS triggers_type_check;

ALTER TABLE public.triggers ADD CONSTRAINT triggers_type_check CHECK (
  type IN (
    -- Etapa 1
    'keyword',
    'postback',
    'quick_reply',
    'welcome',
    'default',
    'comment_keyword',
    'new_contact',
    'crm_event',
    'inactivity',
    -- Etapa 2
    'email_received',
    -- Etapa 4: agenda. Los seis primeros nacen de un evento; los tres
    -- ultimos los agenda un job relativo a la hora de la reunion.
    'booking_created',
    'booking_rescheduled',
    'booking_cancelled',
    'booking_updated',
    'booking_ended',
    'booking_status_changed',
    'booking_before_start',
    'booking_after_end',
    'booking_after_created'
  )
);

COMMENT ON CONSTRAINT triggers_type_check ON public.triggers IS
  'La lista viene del registro de TypeScript (lib/flow-engine/registry). Hay un test que compara las dos.';

-- ------------------------------------------------------------
-- 2. Una sesion de flow puede no tener canal
-- ------------------------------------------------------------

ALTER TABLE public.flow_sessions ALTER COLUMN channel_id DROP NOT NULL;

COMMENT ON COLUMN public.flow_sessions.channel_id IS
  'Null cuando el flow no arranco por un canal (agenda, evento de CRM sin conversacion). Los nodos que envian por canal se saltean con motivo.';

-- El indice parcial de sesiones activas seguia sirviendo, pero con canal null
-- dos sesiones del mismo contacto no chocaban entre si de todos modos: no era
-- un unico, es un indice de busqueda. Se rehace incluyendo las de canal null.
DROP INDEX IF EXISTS public.idx_flow_sessions_contact_active;
CREATE INDEX IF NOT EXISTS idx_flow_sessions_contact_active
  ON public.flow_sessions (contact_id, channel_id)
  WHERE status = 'active';

-- ------------------------------------------------------------
-- 3. Buscar disparos por clave
-- ------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_trigger_fires_dedupe
  ON public.trigger_fires (workspace_id, dedupe_key);

-- ============================================================
-- MIGRATION 101: BG TASK DEDUPE
-- ============================================================
-- ============================================================================
-- 00101 — Idempotencia del despacho de tareas de IA en segundo plano
-- ============================================================================
-- El problema: `bg-dispatch` inserta un `scheduled_jobs` por ventana confiando
-- en `uq_scheduled_jobs_dedupe_pending` (00061), que es UNICO SOLO ENTRE LOS
-- PENDING. Cuando el job se completa, la fila sale del indice y el cron de los
-- 15 minutos siguientes vuelve a insertar la misma clave. Y otra vez. Para
-- siempre, mientras la ventana siga vigente. Al 28/9/2026 habia 229 filas
-- `bg_task` para 23 ventanas distintas: 96 de ellas de la misma clave.
--
-- Hoy es gratis porque el handler de `bg_task` no hace nada. Con el
-- clasificador implementado serian 96 clasificaciones del mismo dia.
--
-- 1. Se borran los jobs que nunca trabajaron, y los huerfanos de workspaces
--    borrados (20 al 28/9). Tiene que ir ANTES del indice: con 96 duplicados
--    vivos, el CREATE UNIQUE INDEX falla.
--
-- 2. Un indice unico ACOTADO A `bg_task`, sin filtro de estado. La ventana no
--    se vuelve a despachar sin importar como haya quedado el job.
--
--    Por que no un unico total sobre `dedupe_key`: romperia dos mecanismos que
--    NECESITAN repetir la clave despues de que la fila anterior dejo de estar
--    pending.
--      - `agent_burst`: la 00061 (lineas 20-24) documenta la parcialidad como
--        diseno. Cuando el turno pasa a processing la fila sale del indice, y
--        un mensaje que llega mientras el agente genera inserta una fila
--        pending nueva con la misma clave para abrir la ventana siguiente. Con
--        un unico total ese mensaje no tendria donde anotarse. Ademas la
--        clausula `ON CONFLICT (dedupe_key) WHERE ... status='pending'` de
--        `push_debounced_job` dejaria de poder inferir su indice.
--      - `booking_relative_trigger`: `syncRelativeJobs` CANCELA Y REINSERTA la
--        misma clave, y `backfillRelativeJobs` (al prender un flujo de evento)
--        lo hace con el mismo `reschedule_count`.
--
--    El predicado `type = 'bg_task'` no puede satisfacer el WHERE de la
--    clausula de inferencia de `push_debounced_job`, asi que esa RPC sigue
--    apuntando a `uq_scheduled_jobs_dedupe_pending`, intacto.
--
-- Consecuencia aceptada: si el job de una ventana termina en `failed` (agoto
-- sus 3 reintentos), esa ventana no se reencola. No se pierde trabajo: la
-- seleccion del clasificador no mira ventanas, asi que la corrida del dia
-- siguiente toma los mismos pendientes. Solo se posterga.
--
-- Idempotente. Borra datos, y solo los que se explican arriba.
-- ============================================================================

-- ------------------------------------------------------------
-- 1. Limpieza
-- ------------------------------------------------------------

-- Los `bg_task` anteriores al 29/9/2026: todos completaron sin hacer nada,
-- porque el handler era `async () => {}`. La fecha de corte hace este DELETE
-- seguro si la migracion se vuelve a correr: no puede borrar un job legitimo
-- encolado despues de que exista el handler de verdad.
DELETE FROM public.scheduled_jobs
 WHERE type = 'bg_task'
   AND created_at < TIMESTAMPTZ '2026-09-29 00:00:00+00';

-- Huerfanos: el workspace del payload ya no existe. `scheduled_jobs` no tiene
-- columna `workspace_id` (va en el payload), asi que no hay FK que los limpie.
-- Sin fecha de corte: un job de un workspace borrado nunca es valido.
DELETE FROM public.scheduled_jobs
 WHERE type = 'bg_task'
   AND payload ? 'workspaceId'
   AND NOT EXISTS (
     SELECT 1 FROM public.workspaces w
      WHERE w.id::text = public.scheduled_jobs.payload ->> 'workspaceId'
   );

-- ------------------------------------------------------------
-- 2. El indice
-- ------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS uq_scheduled_jobs_bg_task_dedupe
  ON public.scheduled_jobs (dedupe_key)
  WHERE type = 'bg_task' AND dedupe_key IS NOT NULL;

COMMENT ON INDEX public.uq_scheduled_jobs_bg_task_dedupe IS
  'Una ventana de tarea en segundo plano se despacha UNA vez, en cualquier estado que haya quedado el job. Acotado a bg_task para no tocar la ventana de agent_burst ni el re-planificado de los avisos de agenda, que necesitan repetir su clave.';

-- ============================================================
-- MIGRATION 102: CHAT MEDIA
-- ============================================================
-- ============================================================================
-- 00102 — La media del chat vive en nuestro Storage
-- ============================================================================
-- El problema: hoy no guardamos ningun archivo que llega por el chat. De
-- Instagram se guarda la URL del CDN de Meta, que VENCE; de WhatsApp, el nodo
-- crudo de Baileys, cuya `url` es un `.enc` cifrado que no se puede abrir sin
-- la `mediaKey`. Resultado: una nota de voz que llego ayer no se puede
-- escuchar, y no hay nada que transcribir para que el agente la entienda.
--
-- Esta migracion no cambia comportamiento por si sola: abre el lugar donde
-- guardar. Todo lo que agrega es aditivo.
--
--   1. Bucket privado `chat-media`, con la misma regla que `email-attachments`
--      y `content-media`: el PRIMER SEGMENTO del path es el workspace, y es lo
--      que lee la policy. Sin policies de escritura: solo el service role
--      sube, porque quien copia los archivos es el receptor del webhook.
--
--   2. `messages.media_description` e `interpretability`. La segunda se guarda
--      aunque se pueda calcular: es lo que va a permitir responder "cuantos
--      mensajes no pudo entender el agente este mes" sin recorrer los adjuntos
--      de cada fila. Las filas viejas quedan en 'unknown' y no se reprocesan.
--
--   3. Dos interruptores por workspace: apagar la ingesta sin deploy, y la
--      retencion de los archivos.
--
-- Idempotente.
-- ============================================================================

-- ------------------------------------------------------------
-- 1. El bucket
-- ------------------------------------------------------------
--
-- 25 MB es el techo de lo que aceptan los proveedores de transcripcion, asi
-- que un archivo mas grande no serviria igual. Los MIME son los que mandan de
-- verdad Instagram y WhatsApp: los tres formatos de audio de WhatsApp
-- (ogg/opus nativo, mp4 y mpeg), los dos que graba un navegador (webm y mp4),
-- y los de imagen, video y documento habituales.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat-media',
  'chat-media',
  false,
  26214400,  -- 25 MB
  ARRAY[
    -- Imagen
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
    -- Video
    'video/mp4', 'video/quicktime', 'video/webm', 'video/3gpp',
    -- Audio: los de WhatsApp, los del navegador y los que acepta el proveedor
    'audio/ogg', 'audio/opus', 'audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/mp3',
    'audio/wav', 'audio/x-wav', 'audio/aac', 'audio/x-m4a', 'audio/m4a', 'audio/amr', 'audio/flac',
    -- Documento
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain', 'text/csv', 'application/zip', 'application/octet-stream'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- Si el bucket ya existia (por ejemplo creado a mano), se le fuerzan los
-- valores: que sea privado es una condicion de seguridad, no una preferencia.
UPDATE storage.buckets
SET
  public = false,
  file_size_limit = 26214400,
  allowed_mime_types = (
    SELECT allowed_mime_types FROM storage.buckets WHERE id = 'chat-media'
  )
WHERE id = 'chat-media';

-- Leer: cualquier miembro del workspace del primer segmento del path. NO es
-- `bucket_id = 'chat-media'` a secas: eso dejaria a cualquier usuario
-- autenticado escuchar los audios de otro negocio. El scope de leads lo
-- resuelve la ruta de descarga, que usa el cliente del usuario.
DROP POLICY IF EXISTS "chat_media_select" ON storage.objects;
CREATE POLICY "chat_media_select" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'chat-media'
    AND public.is_workspace_member(((storage.foldername(name))[1])::uuid)
  );

-- Escribir y borrar son del servidor: los archivos los copia el receptor del
-- webhook con el service role, y los borra el cron de retencion. Nadie sube a
-- mano a este bucket.
DROP POLICY IF EXISTS "chat_media_insert" ON storage.objects;
DROP POLICY IF EXISTS "chat_media_update" ON storage.objects;
DROP POLICY IF EXISTS "chat_media_delete" ON storage.objects;

-- ------------------------------------------------------------
-- 2. Columnas de media en messages
-- ------------------------------------------------------------

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS media_description text;

COMMENT ON COLUMN public.messages.media_description IS
  'Descripcion de la imagen generada por el modelo de vision (F8). Es lo que lee el agente cuando el lead manda una captura sin texto.';

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS interpretability text NOT NULL DEFAULT 'unknown';

DO $$
BEGIN
  ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_interpretability_check;
  ALTER TABLE public.messages
    ADD CONSTRAINT messages_interpretability_check
    CHECK (interpretability IN (
      'text',         -- tiene texto propio
      'transcribed',  -- se entendio por su transcripcion
      'described',    -- se entendio por la descripcion de la imagen
      'label_only',   -- solo hay una etiqueta (una ubicacion, un contacto)
      'unreadable',   -- no se pudo interpretar: el agente escala
      'unknown'       -- todavia no se evaluo (y las filas anteriores a esta migracion)
    ));
END $$;

COMMENT ON COLUMN public.messages.interpretability IS
  'Si el agente pudo entender este mensaje. Se guarda aunque se pueda calcular: permite contar los no interpretables sin recorrer los adjuntos de cada fila.';

-- Los mensajes que el agente no pudo entender, por conversacion. Es el indice
-- que usa el escalado y el que va a usar el informe de "cuantos no entendio".
CREATE INDEX IF NOT EXISTS idx_messages_unreadable
  ON public.messages(conversation_id, created_at DESC)
  WHERE interpretability = 'unreadable';

-- ------------------------------------------------------------
-- 3. Los dos interruptores del workspace
-- ------------------------------------------------------------
--
-- Mismo patron que `persist_zernio_inbound` (00053): si el bucket se llena o
-- Evolution empieza a fallar, se apaga desde Ajustes sin esperar un deploy.

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS persist_chat_media boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.workspaces.persist_chat_media IS
  'Copiar a nuestro Storage la media que llega por el chat. Apagarlo no borra lo ya guardado: los mensajes nuevos quedan solo con la URL del proveedor, que vence.';

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS chat_media_retention_days integer NOT NULL DEFAULT 180;

DO $$
BEGIN
  ALTER TABLE public.workspaces DROP CONSTRAINT IF EXISTS workspaces_chat_media_retention_check;
  ALTER TABLE public.workspaces
    ADD CONSTRAINT workspaces_chat_media_retention_check
    CHECK (chat_media_retention_days >= 0 AND chat_media_retention_days <= 3650);
END $$;

COMMENT ON COLUMN public.workspaces.chat_media_retention_days IS
  'Dias que se conserva el archivo de un adjunto del chat. 0 = no borrar nunca. La TRANSCRIPCION nunca se borra por retencion: es texto, pesa nada, y es el contexto del agente.';

-- ============================================================
-- MIGRATION 103: TRANSCRIPTS AND NEEDS HUMAN
-- ============================================================
-- ============================================================================
-- 00103 — Transcripciones, y la conversacion que necesita una persona
-- ============================================================================
-- El problema que arregla, en una frase: hoy un lead manda una nota de voz y el
-- agente le contesta igual, sin haberla escuchado. El mensaje entra con el texto
-- vacio, el agente lo filtra del historial, pero el turno IGUAL se agenda y
-- responde. Esta contestando cosas que no tienen nada que ver.
--
-- Esta migracion abre las dos columnas que hacen falta para arreglarlo:
--
--   1. La transcripcion del audio, con su estado. `transcript_started_at` esta
--      para el reaper: un `pending` colgado (por ejemplo, un after() que se
--      corto) se libera a los 10 minutos. Sin eso, la bandeja queda con
--      "Transcribiendo…" girando para siempre y el mensaje no se reintenta
--      nunca.
--
--   2. La marca de "necesita humano" en la conversacion. Cuando el agente no
--      puede interpretar lo que llego, no responde: marca, se apaga en esa
--      conversacion, y avisa. Ante la duda escala: es preferible que una
--      persona conteste de mas a que el bot conteste a ciegas.
--
-- Y suma dos valores al CHECK de `agent_runs.source`, para que el consumo de la
-- transcripcion y de la descripcion de imagenes quede registrado con su costo
-- como cualquier otra llamada a un modelo.
--
-- Todo aditivo: columnas con default y un CHECK que se reemplaza SUMANDO
-- valores, nunca quitando. Idempotente.
-- ============================================================================

-- ------------------------------------------------------------
-- 1. La transcripcion
-- ------------------------------------------------------------

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS transcript text,
  ADD COLUMN IF NOT EXISTS transcript_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS transcript_error text,
  ADD COLUMN IF NOT EXISTS transcript_seconds numeric,
  ADD COLUMN IF NOT EXISTS transcript_started_at timestamptz;

DO $$
BEGIN
  ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_transcript_status_check;
  ALTER TABLE public.messages
    ADD CONSTRAINT messages_transcript_status_check
    CHECK (transcript_status IN ('none', 'pending', 'ready', 'failed'));
END $$;

COMMENT ON COLUMN public.messages.transcript IS
  'Lo que dice el audio, en su idioma original. NUNCA se borra por retencion: es texto, pesa nada, y es el contexto del agente.';

COMMENT ON COLUMN public.messages.transcript_started_at IS
  'Cuando arranco la transcripcion. Es lo que usa el reaper: un pending de mas de 10 minutos se libera para que se pueda reintentar.';

COMMENT ON COLUMN public.messages.transcript_seconds IS
  'Segundos de audio que cobro el proveedor. Los proveedores de transcripcion cobran por duracion, no por tokens.';

-- El reaper busca por este indice. Parcial, asi que pesa lo que pesan los
-- pendientes del momento (normalmente cero).
CREATE INDEX IF NOT EXISTS idx_messages_transcript_pending
  ON public.messages(transcript_started_at)
  WHERE transcript_status = 'pending';

-- ------------------------------------------------------------
-- 2. La conversacion que necesita una persona
-- ------------------------------------------------------------

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS needs_human boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS needs_human_reason text,
  ADD COLUMN IF NOT EXISTS needs_human_at timestamptz;

COMMENT ON COLUMN public.conversations.needs_human IS
  'El agente no pudo interpretar lo que llego y escalo. Se limpia cuando una persona responde o marca "Ya lo vi".';

COMMENT ON COLUMN public.conversations.needs_human_reason IS
  'Por que escalo, en castellano y en una linea: es lo que lee la persona que la toma.';

-- El filtro "Necesita humano" de la bandeja. Parcial por la misma razon: son
-- pocas conversaciones a la vez, y son justo las que hay que encontrar rapido.
CREATE INDEX IF NOT EXISTS idx_conversations_needs_human
  ON public.conversations(workspace_id, needs_human_at DESC)
  WHERE needs_human;

-- ------------------------------------------------------------
-- 3. El interruptor de la compuerta
-- ------------------------------------------------------------
--
-- Arranca PRENDIDO: es el arreglo, no una opcion. Pero es apagable por
-- workspace por si los primeros dias genera demasiado escalado.

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS agent_escalate_on_unreadable boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.workspaces.agent_escalate_on_unreadable IS
  'Si el agente escala a una persona cuando no puede interpretar un mensaje de la rafaga. Apagarlo hace que vuelva a responder a ciegas.';

-- ------------------------------------------------------------
-- 4. Los dos valores nuevos de agent_runs.source
-- ------------------------------------------------------------
--
-- La constraint vigente es `agent_runs_source_check`, de la 00085. Se reemplaza
-- con los nueve valores que ya tenia MAS los dos nuevos: nunca se quita uno,
-- porque las filas viejas lo siguen usando.
--
-- La otra constraint, `agent_runs_agent_only_for_agent_sources` (00094), NO se
-- toca: estos dos runs no llevan agent_id (no los pide un agente, los pide el
-- sistema al recibir un mensaje), asi que ya pasan.

DO $$
BEGIN
  ALTER TABLE public.agent_runs DROP CONSTRAINT IF EXISTS agent_runs_source_check;

  ALTER TABLE public.agent_runs
    ADD CONSTRAINT agent_runs_source_check
    CHECK (source IN (
      'agent',
      'flow_ai_node',
      'sequence_ai_step',
      'kb_indexing',
      'conversation_summary',
      'message_classification',
      'message_classification_eval',
      -- Etapa 2
      'content_copy',
      'ads_analysis',
      -- Mejoras de Chat
      'audio_transcription',
      'media_description'
    ));
END $$;

-- ------------------------------------------------------------
-- 5. El consumo de la transcripcion, en su unidad
-- ------------------------------------------------------------
--
-- Los proveedores de transcripcion NO cobran por token: cobran por HORA DE
-- AUDIO (Groq US$ 0,04, OpenAI US$ 0,36 al 28/9/2026). Guardar eso en
-- `input_per_mtok` seria un numero que dice una cosa y significa otra, y el
-- informe de gasto quedaria mintiendo.
--
-- Asi que cada tabla suma una columna en la unidad correcta. Las dos son
-- nullable: una fila de un modelo de chat no tiene hora de audio, y un run del
-- agente no tiene segundos.
--
-- El precio sigue viviendo en la base y no en el codigo, que es la regla de la
-- 00059: cambia seguido y el numero no deberia depender de un deploy.

ALTER TABLE public.model_pricing
  ADD COLUMN IF NOT EXISTS audio_per_hour numeric(12,6);

COMMENT ON COLUMN public.model_pricing.audio_per_hour IS
  'USD por hora de audio. Solo para modelos de transcripcion, que se cobran por duracion y no por tokens. Null en los modelos de chat y de embeddings.';

ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS audio_seconds numeric(12,3);

COMMENT ON COLUMN public.agent_runs.audio_seconds IS
  'Segundos de audio transcriptos en este run. Es lo que se multiplica por model_pricing.audio_per_hour para congelar el costo.';

-- ============================================================
-- MIGRATION 104: CONTACT AVATAR REFRESH
-- ============================================================
-- ============================================================
-- MIGRACION 00104 — LA FOTO DE PERFIL SE PUEDE REFRESCAR (F16)
-- ============================================================
-- Instagram sí manda la foto del contacto (`msg.sender.picture`), pero hoy
-- `find_or_link_contact` la guarda con COALESCE: "lo que ya estaba cargado
-- gana". La primera vez que se guarda una URL del CDN de Meta queda ahí para
-- siempre, y esas URLs VENCEN -- la burbuja termina mostrando un ícono roto.
--
-- El arreglo no es "pisar siempre": una foto que alguien subió a mano
-- (`avatar_source = 'manual'`) no se puede perder porque llegó un mensaje
-- nuevo, y una que F16 ya copió a nuestro Storage (`avatar_source = 'storage'`)
-- tampoco -- esa la refresca el código de TypeScript cada 30 días, no esta
-- función. Lo único que esta función puede refrescar es una foto `external`:
-- la URL cruda del proveedor, que es justo la que vence.
--
-- Por eso la columna `avatar_source` nueva, con default `'external'`: todo
-- contacto existente queda en ese estado, así que el próximo mensaje que
-- reciba ya refresca su foto con la URL fresca que trae ese mensaje -- eso
-- solo arregla el caso más común sin esperar a que el Bloque 4 de TypeScript
-- corra una sola vez.
--
-- ADVERTENCIA (siguiendo la instrucción explícita de la corrida): esta
-- migración reescribe `find_or_link_contact`, la función de deduplicación
-- cross-canal, que es la regla de negocio central del sistema. Copia la 00031
-- COMPLETA, letra por letra, y cambia SOLO las dos líneas del avatar (las que
-- en la 00031 están en `avatar_url = COALESCE(c.avatar_url, p_avatar_url)`,
-- una por cada rama que ya tenía esa línea). Nada más: ni el orden de
-- matcheo, ni las sugerencias por username, ni el audit log, ni
-- is_placeholder_name. La definición vieja (00031) queda completa más abajo
-- en este comentario, por si hay que volver atrás.
--
-- La 00047 le había sacado el EXECUTE a `authenticated` (una función sin
-- control de permisos propio no puede quedar abierta a cualquier rol: un
-- Member podía crear o vincular contactos saltándose el scope de leads). Esta
-- migración CREATE OR REPLACE la función de nuevo, así que el REVOKE se repite
-- al final -- si no, la función volvería a quedar abierta a `authenticated`,
-- que es exactamente el agujero que la 00047 cerró.
--
-- ---- La definición de la 00031, completa, por si hay que volver atrás ----
--
-- CREATE OR REPLACE FUNCTION public.find_or_link_contact(
--   p_channel_id      uuid,
--   p_sender_id       text,
--   p_display_name    text        DEFAULT NULL,
--   p_username        text        DEFAULT NULL,
--   p_avatar_url      text        DEFAULT NULL,
--   p_phone           text        DEFAULT NULL,
--   p_email           text        DEFAULT NULL,
--   p_interaction_at  timestamptz DEFAULT now(),
--   p_stamp_existing  boolean     DEFAULT true
-- )
-- RETURNS jsonb
-- LANGUAGE plpgsql
-- SECURITY DEFINER
-- SET search_path = ''
-- AS $OLD$
-- DECLARE
--   v_ws         uuid;
--   v_platform   text;
--   v_contact    uuid;
--   v_suggested  uuid;
--   v_linked_by  text := NULL;
--   v_phone      text := NULLIF(btrim(p_phone), '');
--   v_email      text := public.normalize_email(p_email);
--   v_handle     text := public.normalize_handle(p_username);
--   v_name       text := NULLIF(btrim(p_display_name), '');
-- BEGIN
--   SELECT ch.workspace_id, ch.platform INTO v_ws, v_platform
--   FROM public.channels ch WHERE ch.id = p_channel_id;
--
--   IF v_ws IS NULL THEN
--     RETURN jsonb_build_object('contact_id', NULL, 'existed', false,
--                               'linked_by', NULL, 'suggested_contact_id', NULL);
--   END IF;
--
--   -- ---- 1. El remitente ya es conocido en este canal ---------------------
--   SELECT cc.contact_id INTO v_contact
--   FROM public.contact_channels cc
--   WHERE cc.channel_id = p_channel_id AND cc.platform_sender_id = p_sender_id;
--
--   IF v_contact IS NOT NULL THEN
--     UPDATE public.contacts c SET
--       last_interaction_at = CASE
--         WHEN p_stamp_existing THEN p_interaction_at
--         ELSE c.last_interaction_at
--       END,
--       display_name = CASE
--         WHEN v_name IS NOT NULL
--          AND NOT public.is_placeholder_name(v_name)
--          AND public.is_placeholder_name(c.display_name)
--         THEN v_name
--         ELSE c.display_name
--       END,
--       avatar_url = COALESCE(c.avatar_url, p_avatar_url),
--       instagram_username = CASE
--         WHEN v_platform = 'instagram' THEN COALESCE(c.instagram_username, v_handle)
--         ELSE c.instagram_username
--       END,
--       twitter_username = CASE
--         WHEN v_platform = 'twitter' THEN COALESCE(c.twitter_username, v_handle)
--         ELSE c.twitter_username
--       END,
--       facebook_id = CASE
--         WHEN v_platform = 'facebook' THEN COALESCE(c.facebook_id, v_handle)
--         ELSE c.facebook_id
--       END,
--       tiktok_username = CASE
--         WHEN v_platform = 'tiktok' THEN COALESCE(c.tiktok_username, v_handle)
--         ELSE c.tiktok_username
--       END
--     WHERE c.id = v_contact;
--
--     UPDATE public.contact_channels cc
--     SET platform_username = COALESCE(cc.platform_username, v_handle)
--     WHERE cc.channel_id = p_channel_id AND cc.platform_sender_id = p_sender_id;
--
--     RETURN jsonb_build_object('contact_id', v_contact, 'existed', true,
--                               'linked_by', 'channel', 'suggested_contact_id', NULL);
--   END IF;
--
--   -- ---- 2. Telefono exacto ---------------------------------------------
--   IF v_phone IS NOT NULL THEN
--     SELECT c.id INTO v_contact
--     FROM public.contacts c
--     WHERE c.workspace_id = v_ws
--       AND c.deleted_at IS NULL
--       AND (c.phone = v_phone OR c.whatsapp_phone = v_phone)
--     ORDER BY c.created_at
--     LIMIT 1;
--     IF v_contact IS NOT NULL THEN v_linked_by := 'phone'; END IF;
--   END IF;
--
--   -- ---- 3. Email exacto -------------------------------------------------
--   IF v_contact IS NULL AND v_email IS NOT NULL THEN
--     SELECT c.id INTO v_contact
--     FROM public.contacts c
--     WHERE c.workspace_id = v_ws
--       AND c.deleted_at IS NULL
--       AND (public.normalize_email(c.email) = v_email
--            OR public.normalize_email(c.secondary_email) = v_email)
--     ORDER BY c.created_at
--     LIMIT 1;
--     IF v_contact IS NOT NULL THEN v_linked_by := 'email'; END IF;
--   END IF;
--
--   -- ---- 4. Usuario exacto de la MISMA plataforma ------------------------
--   IF v_contact IS NULL AND v_handle IS NOT NULL THEN
--     SELECT c.id INTO v_contact
--     FROM public.contacts c
--     WHERE c.workspace_id = v_ws
--       AND c.deleted_at IS NULL
--       AND CASE v_platform
--             WHEN 'instagram' THEN lower(c.instagram_username) = v_handle
--             WHEN 'twitter'   THEN lower(c.twitter_username)   = v_handle
--             WHEN 'facebook'  THEN lower(c.facebook_id)        = v_handle
--             WHEN 'tiktok'    THEN lower(c.tiktok_username)    = v_handle
--             ELSE false
--           END
--     ORDER BY c.created_at
--     LIMIT 1;
--     IF v_contact IS NOT NULL THEN v_linked_by := 'username'; END IF;
--   END IF;
--
--   -- ---- Vincular al contacto encontrado ---------------------------------
--   IF v_contact IS NOT NULL THEN
--     UPDATE public.contacts c SET
--       last_interaction_at = GREATEST(COALESCE(c.last_interaction_at, p_interaction_at), p_interaction_at),
--       display_name = CASE
--         WHEN v_name IS NOT NULL
--          AND NOT public.is_placeholder_name(v_name)
--          AND public.is_placeholder_name(c.display_name)
--         THEN v_name
--         ELSE COALESCE(c.display_name, v_name)
--       END,
--       avatar_url          = COALESCE(c.avatar_url, p_avatar_url),
--       phone               = COALESCE(c.phone, v_phone),
--       email               = COALESCE(c.email, v_email),
--       whatsapp_phone      = CASE WHEN v_platform = 'whatsapp'  THEN COALESCE(c.whatsapp_phone, v_phone)  ELSE c.whatsapp_phone END,
--       instagram_username  = CASE WHEN v_platform = 'instagram' THEN COALESCE(c.instagram_username, v_handle) ELSE c.instagram_username END,
--       twitter_username    = CASE WHEN v_platform = 'twitter'   THEN COALESCE(c.twitter_username, v_handle)   ELSE c.twitter_username END,
--       facebook_id         = CASE WHEN v_platform = 'facebook'  THEN COALESCE(c.facebook_id, v_handle)        ELSE c.facebook_id END,
--       tiktok_username     = CASE WHEN v_platform = 'tiktok'    THEN COALESCE(c.tiktok_username, v_handle)    ELSE c.tiktok_username END
--     WHERE c.id = v_contact;
--
--     INSERT INTO public.contact_channels (contact_id, channel_id, platform_sender_id, platform_username)
--     VALUES (v_contact, p_channel_id, p_sender_id, v_handle)
--     ON CONFLICT (channel_id, platform_sender_id) DO NOTHING;
--
--     INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, metadata, performed_by)
--     VALUES (v_ws, 'contact', v_contact, 'link',
--             jsonb_build_object('linked_by', v_linked_by, 'channel_id', p_channel_id,
--                                'platform', v_platform, 'automatic', true),
--             NULL);
--
--     RETURN jsonb_build_object('contact_id', v_contact, 'existed', true,
--                               'linked_by', v_linked_by, 'suggested_contact_id', NULL);
--   END IF;
--
--   -- ---- 5. Contacto nuevo ------------------------------------------------
--   IF v_handle IS NOT NULL THEN
--     SELECT c.id INTO v_suggested
--     FROM public.contacts c
--     WHERE c.workspace_id = v_ws
--       AND c.deleted_at IS NULL
--       AND (lower(c.instagram_username) = v_handle
--            OR lower(c.twitter_username) = v_handle
--            OR lower(c.facebook_id) = v_handle
--            OR lower(c.tiktok_username) = v_handle)
--     ORDER BY c.created_at
--     LIMIT 1;
--   END IF;
--
--   INSERT INTO public.contacts (
--     workspace_id, display_name, avatar_url, last_interaction_at,
--     phone, email, whatsapp_phone, instagram_username, twitter_username,
--     facebook_id, tiktok_username, metadata
--   ) VALUES (
--     v_ws, v_name, p_avatar_url, p_interaction_at,
--     v_phone, v_email,
--     CASE WHEN v_platform = 'whatsapp'  THEN v_phone  ELSE NULL END,
--     CASE WHEN v_platform = 'instagram' THEN v_handle ELSE NULL END,
--     CASE WHEN v_platform = 'twitter'   THEN v_handle ELSE NULL END,
--     CASE WHEN v_platform = 'facebook'  THEN v_handle ELSE NULL END,
--     CASE WHEN v_platform = 'tiktok'    THEN v_handle ELSE NULL END,
--     CASE
--       WHEN v_suggested IS NOT NULL THEN
--         jsonb_build_object('link_suggestions', jsonb_build_array(
--           jsonb_build_object('contact_id', v_suggested, 'reason', 'username',
--                              'handle', v_handle, 'at', p_interaction_at)))
--       ELSE '{}'::jsonb
--     END
--   )
--   RETURNING id INTO v_contact;
--
--   INSERT INTO public.contact_channels (contact_id, channel_id, platform_sender_id, platform_username)
--   VALUES (v_contact, p_channel_id, p_sender_id, v_handle)
--   ON CONFLICT (channel_id, platform_sender_id) DO NOTHING;
--
--   INSERT INTO public.analytics_events (workspace_id, contact_id, event_type, metadata)
--   VALUES (v_ws, v_contact, 'contact_created',
--           jsonb_build_object('channel_id', p_channel_id, 'platform', v_platform));
--
--   INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, metadata, performed_by)
--   VALUES (v_ws, 'contact', v_contact, 'create',
--           jsonb_build_object('source', 'inbound', 'channel_id', p_channel_id,
--                              'platform', v_platform), NULL);
--
--   RETURN jsonb_build_object('contact_id', v_contact, 'existed', false,
--                             'linked_by', NULL, 'suggested_contact_id', v_suggested);
-- END;
-- $OLD$;
-- ============================================================

-- ------------------------------------------------------------
-- 1. Columnas nuevas en contacts
-- ------------------------------------------------------------

ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS avatar_source text NOT NULL DEFAULT 'external';
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS avatar_updated_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contacts_avatar_source_check'
  ) THEN
    ALTER TABLE public.contacts ADD CONSTRAINT contacts_avatar_source_check
      CHECK (avatar_source IN ('external', 'storage', 'manual'));
  END IF;
END;
$$;

COMMENT ON COLUMN public.contacts.avatar_source IS
  'De donde sale avatar_url. external: la URL cruda del proveedor (vence, se puede refrescar con el proximo mensaje). storage: F16 ya la copio a nuestro bucket avatars (se refresca cada 30 dias desde TypeScript). manual: alguien la cargo a mano (nunca se pisa).';
COMMENT ON COLUMN public.contacts.avatar_updated_at IS
  'Cuando se actualizo avatar_url por ultima vez. Lo usa F16 para decidir si refrescar una foto storage (cada 30 dias) y la retencion (borra la de un contacto storage sin mensajes en 6 meses).';

-- ------------------------------------------------------------
-- 2. find_or_link_contact: copia letra por letra de la 00031,
--    cambiando SOLO las dos lineas del avatar.
-- ------------------------------------------------------------

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
      -- F16 (unica linea que cambia de la 00031): una foto external se
      -- refresca con la URL fresca que trae este mensaje. storage y manual
      -- no se pisan nunca.
      avatar_url = CASE
        WHEN c.avatar_source = 'external' AND p_avatar_url IS NOT NULL THEN p_avatar_url
        ELSE COALESCE(c.avatar_url, p_avatar_url)
      END,
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
    UPDATE public.contacts c SET
      last_interaction_at = GREATEST(COALESCE(c.last_interaction_at, p_interaction_at), p_interaction_at),
      display_name = CASE
        WHEN v_name IS NOT NULL
         AND NOT public.is_placeholder_name(v_name)
         AND public.is_placeholder_name(c.display_name)
        THEN v_name
        ELSE COALESCE(c.display_name, v_name)
      END,
      -- F16 (la otra linea que cambia de la 00031): misma regla que arriba.
      avatar_url = CASE
        WHEN c.avatar_source = 'external' AND p_avatar_url IS NOT NULL THEN p_avatar_url
        ELSE COALESCE(c.avatar_url, p_avatar_url)
      END,
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

    INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, metadata, performed_by)
    VALUES (v_ws, 'contact', v_contact, 'link',
            jsonb_build_object('linked_by', v_linked_by, 'channel_id', p_channel_id,
                               'platform', v_platform, 'automatic', true),
            NULL);

    RETURN jsonb_build_object('contact_id', v_contact, 'existed', true,
                              'linked_by', v_linked_by, 'suggested_contact_id', NULL);
  END IF;

  -- ---- 5. Contacto nuevo ------------------------------------------------
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

-- La 00047 le habia sacado el EXECUTE a `authenticated`. CREATE OR REPLACE no
-- toca los GRANT existentes de una funcion que ya existia, pero se repite el
-- REVOKE explicitamente para que esta migracion sea el registro de lo que
-- tiene que valer, sin depender de que la 00047 se haya aplicado antes.
REVOKE ALL ON FUNCTION public.find_or_link_contact(uuid, text, text, text, text, text, text, timestamptz, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_or_link_contact(uuid, text, text, text, text, text, text, timestamptz, boolean) TO service_role;

COMMENT ON FUNCTION public.find_or_link_contact(uuid, text, text, text, text, text, text, timestamptz, boolean) IS
  'Dedup cross-canal. Solo service_role: no valida permisos, solo deriva el workspace del canal. Las rutas que la usan validan el rol antes y llaman con service client (lib/inbox-sync.ts). F16: el avatar_url de un contacto external se refresca con cada mensaje; storage y manual no se pisan nunca (avatar_source).';

-- ============================================================
-- MIGRATION 105: RESPONSE ASSETS
-- ============================================================
-- ============================================================
-- MIGRACION 00105 — LA BANCA DE RECURSOS (rediseño, F20/F21/F22 unificados)
-- ============================================================
-- Una sola tabla para los dos tipos de respuesta guardada de un workspace:
-- textos (las viejas response_templates, 00023/00026) y audios (la vieja
-- 00105_audio_assets, que nunca se aplico). `kind` las distingue.
--
-- Por que una sola tabla y no dos: eran dos tablas casi identicas (mismo
-- formato de atajo, mismo indice unico parcial, misma RLS letra por letra,
-- mismo soft delete) con un solo campo realmente distinto -- `content` vs
-- `storage_path`. Dos tablas significaban dos pantallas, dos pickers, dos
-- herramientas del agente y dos atajos ("/" y "/a") que la persona tenia que
-- recordar. Y, sobre todo: el atajo tiene que ser unico ENTRE LOS DOS TIPOS,
-- y con dos tablas eso no lo puede garantizar ningun indice.
--
-- Lo que es de cada tipo:
--   text   -> `content` (con variables {{...}}), nada de archivo.
--   audio  -> `storage_path` + `mime_type` en chat-media/<ws>/library/<id>.<ext>,
--             `description` OBLIGATORIA (es lo que lee la IA para decidir
--             cuando usarlo; NUNCA se manda) y la transcripcion.
--
-- Lo nuevo respecto de las dos tablas viejas: `tags text[]` con indice GIN.
--
-- `purge_soft_deleted` NO se toca aca: se redefine en la 00106, que es la que
-- dropea response_templates. Si se sacara esa tabla de la funcion aca,
-- response_templates dejaria de purgarse en la ventana entre las dos
-- migraciones; si se sumara response_assets aca sin sacar la otra, el DROP de
-- la 00106 dejaria la funcion apuntando a una tabla inexistente y el cron
-- empezaria a fallar. Las dos cosas van juntas, en la misma transaccion.
-- ============================================================

-- ------------------------------------------------------------
-- 1. La tabla
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.response_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,

  -- 'text' | 'audio'. Decide que columnas tienen que estar y cuales no (ver
  -- los CHECK de forma mas abajo). Se elige al crear y NO se cambia despues:
  -- convertir un texto en audio no es editar, es crear otra cosa.
  kind text NOT NULL,

  name text NOT NULL,
  -- Atajo para encontrarlo rapido con "/" en la bandeja, ej "/precio". Unico
  -- por workspace ENTRE LOS DOS TIPOS (idx_response_assets_shortcut).
  shortcut text,
  -- Para la IA: cuando corresponde usar este recurso. Obligatoria para un
  -- audio (es lo unico que el agente puede leer sin escucharlo); opcional
  -- para un texto (ahi el contenido se explica solo). Nunca se manda.
  description text,
  -- Etiquetas libres para agrupar ("precios", "objeciones"). Se buscan desde
  -- el picker igual que el nombre. Array y no tabla aparte: no tienen datos
  -- propios, no se renombran en masa y el workspace es single-tenant.
  tags text[] NOT NULL DEFAULT '{}',

  -- Solo kind='text'.
  content text,

  -- Solo kind='audio'.
  storage_path text,
  -- Nullable, a diferencia de la 00105 vieja: un texto no tiene mime. El
  -- CHECK de forma lo exige para un audio y lo prohibe para un texto.
  mime_type text,
  duration_seconds integer,
  size_bytes bigint,

  -- Que dice el audio. La llena el job transcribe_audio (el mismo de F7).
  transcript text,
  transcript_status text NOT NULL DEFAULT 'none',
  transcript_error text,
  -- 'manual' si alguien la corrigio a mano: un reintento automatico no la pisa.
  transcript_source text NOT NULL DEFAULT 'auto',
  -- La necesita el reaper de transcripciones colgadas (10 min). Sin esta
  -- columna, un 'pending' que se muere a mitad de camino queda pending para
  -- siempre y el recurso no se puede volver a habilitar para el agente.
  transcript_started_at timestamptz,

  -- 'recorded' | 'uploaded' | 'synthesized'. NULL para un texto. synthesized
  -- no se usa todavia (texto-a-voz es Etapa 3), va ahora para no migrar.
  source text,

  -- El interruptor del agente, para los dos tipos. Default FALSE: el agente
  -- arranca sin poder usar nada y se habilita recurso por recurso.
  agent_enabled boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,

  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

-- ------------------------------------------------------------
-- 2. CHECKs
-- ------------------------------------------------------------
-- Uno por regla y con nombre propio, no un CHECK gigante: el nombre del
-- constraint es el unico mensaje que llega cuando algo entra mal, asi que
-- tiene que decir QUE regla se rompio.
--
-- Los de forma se escriben `kind <> 'x' OR (...)` en vez de un OR de dos
-- bloques, para que el error nombre el tipo que fallo.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'response_assets_kind_check') THEN
    ALTER TABLE public.response_assets ADD CONSTRAINT response_assets_kind_check
      CHECK (kind IN ('text', 'audio'));
  END IF;

  -- Mismo formato que la 00026, letra por letra.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'response_assets_shortcut_format') THEN
    ALTER TABLE public.response_assets ADD CONSTRAINT response_assets_shortcut_format
      CHECK (shortcut IS NULL OR shortcut ~ '^/[a-z0-9][a-z0-9_-]{0,29}$');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'response_assets_name_not_blank') THEN
    ALTER TABLE public.response_assets ADD CONSTRAINT response_assets_name_not_blank
      CHECK (length(btrim(name)) > 0);
  END IF;

  -- Opcional, pero si esta no puede estar en blanco.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'response_assets_description_not_blank') THEN
    ALTER TABLE public.response_assets ADD CONSTRAINT response_assets_description_not_blank
      CHECK (description IS NULL OR length(btrim(description)) > 0);
  END IF;

  -- Un texto: contenido si, archivo no. Incluye mime_type y source, que en la
  -- tabla vieja de audios eran NOT NULL y aca no pueden serlo para un texto.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'response_assets_text_shape') THEN
    ALTER TABLE public.response_assets ADD CONSTRAINT response_assets_text_shape
      CHECK (kind <> 'text' OR (
        content IS NOT NULL AND length(btrim(content)) > 0
        AND storage_path IS NULL
        AND mime_type IS NULL
        AND duration_seconds IS NULL
        AND size_bytes IS NULL
        AND source IS NULL
      ));
  END IF;

  -- Un texto nunca puede parecer un audio a medio transcribir: si no, la
  -- pantalla y el agente tendrian que preguntar el kind antes de leer el
  -- estado de transcripcion en vez de confiar en la base.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'response_assets_text_no_transcript') THEN
    ALTER TABLE public.response_assets ADD CONSTRAINT response_assets_text_no_transcript
      CHECK (kind <> 'text' OR (
        transcript IS NULL
        AND transcript_status = 'none'
        AND transcript_error IS NULL
        AND transcript_started_at IS NULL
      ));
  END IF;

  -- Un audio: archivo y mime si, contenido no, y descripcion obligatoria.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'response_assets_audio_shape') THEN
    ALTER TABLE public.response_assets ADD CONSTRAINT response_assets_audio_shape
      CHECK (kind <> 'audio' OR (
        storage_path IS NOT NULL AND length(btrim(storage_path)) > 0
        AND mime_type IS NOT NULL
        AND content IS NULL
        AND description IS NOT NULL
        AND source IS NOT NULL
      ));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'response_assets_transcript_status_check') THEN
    ALTER TABLE public.response_assets ADD CONSTRAINT response_assets_transcript_status_check
      CHECK (transcript_status IN ('none', 'pending', 'ready', 'failed'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'response_assets_transcript_source_check') THEN
    ALTER TABLE public.response_assets ADD CONSTRAINT response_assets_transcript_source_check
      CHECK (transcript_source IN ('auto', 'manual'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'response_assets_source_check') THEN
    ALTER TABLE public.response_assets ADD CONSTRAINT response_assets_source_check
      CHECK (source IS NULL OR source IN ('recorded', 'uploaded', 'synthesized'));
  END IF;

  -- Un CHECK no puede llevar subconsulta, asi que "ninguna etiqueta vacia" se
  -- valida en TypeScript. Aca va lo que si se puede: ningun NULL adentro del
  -- array y un tope sano, para que nadie pegue mil etiquetas.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'response_assets_tags_sane') THEN
    ALTER TABLE public.response_assets ADD CONSTRAINT response_assets_tags_sane
      CHECK (array_position(tags, NULL) IS NULL AND cardinality(tags) <= 20);
  END IF;
END;
$$;

-- ------------------------------------------------------------
-- 3. Indices
-- ------------------------------------------------------------

-- El listado de la pantalla y el del picker, ordenados por nombre.
CREATE INDEX IF NOT EXISTS idx_response_assets_workspace
  ON public.response_assets(workspace_id, name) WHERE deleted_at IS NULL;

-- Las pestañas Textos / Audios de la pantalla.
CREATE INDEX IF NOT EXISTS idx_response_assets_kind
  ON public.response_assets(workspace_id, kind, name) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_response_assets_deleted_at
  ON public.response_assets(deleted_at) WHERE deleted_at IS NOT NULL;

-- Para listar_recursos: solo los habilitados y activos.
CREATE INDEX IF NOT EXISTS idx_response_assets_agent_enabled
  ON public.response_assets(workspace_id)
  WHERE deleted_at IS NULL AND agent_enabled = true AND is_active = true;

-- Unico por workspace y ENTRE LOS DOS TIPOS: al no llevar `kind`, el indice
-- ya impide que un texto y un audio compartan atajo. Eso es exactamente lo
-- que con dos tablas no se podia garantizar.
CREATE UNIQUE INDEX IF NOT EXISTS idx_response_assets_shortcut
  ON public.response_assets(workspace_id, shortcut)
  WHERE deleted_at IS NULL AND shortcut IS NOT NULL;

-- Las etiquetas se buscan por contenido (@>, &&), no por prefijo: GIN.
-- Sin workspace_id adelante a proposito: un indice GIN compuesto con una
-- columna btree necesita la extension btree_gin, que no esta instalada. El
-- filtro por workspace lo resuelve el planner con el btree de arriba, y a la
-- escala de este sistema la diferencia no existe.
CREATE INDEX IF NOT EXISTS idx_response_assets_tags
  ON public.response_assets USING gin (tags);

-- ------------------------------------------------------------
-- 4. Trigger
-- ------------------------------------------------------------

DROP TRIGGER IF EXISTS set_updated_at ON public.response_assets;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.response_assets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ------------------------------------------------------------
-- 5. Comentarios
-- ------------------------------------------------------------

COMMENT ON TABLE public.response_assets IS
  'La banca de recursos: textos (ex response_templates) y audios en una sola tabla, distinguidos por `kind`. El atajo es unico entre los dos tipos.';
COMMENT ON COLUMN public.response_assets.kind IS
  'text | audio. Decide que columnas aplican (ver response_assets_text_shape y _audio_shape). No se cambia despues de crear.';
COMMENT ON COLUMN public.response_assets.description IS
  'Obligatoria para un audio, opcional para un texto. Es lo que lee el agente para decidir CUANDO usar este recurso -- nunca se manda.';
COMMENT ON COLUMN public.response_assets.tags IS
  'Etiquetas libres. Se buscan desde el picker "/" igual que el nombre (indice GIN).';
COMMENT ON COLUMN public.response_assets.transcript_source IS
  'auto: la escribio el job de transcripcion. manual: alguien la corrigio a mano, y un reintento automatico no la pisa.';
COMMENT ON COLUMN public.response_assets.transcript_started_at IS
  'Cuando se reclamo la transcripcion. La usa el reaper de pendientes colgados (10 min).';
COMMENT ON COLUMN public.response_assets.agent_enabled IS
  'El interruptor del agente, para los dos tipos. Un audio ademas necesita transcripcion lista; un texto no necesita nada mas.';

-- ------------------------------------------------------------
-- 6. RLS — igual que response_templates (00023:220-239), letra por letra
-- ------------------------------------------------------------

ALTER TABLE public.response_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "response_assets_select" ON public.response_assets;
CREATE POLICY "response_assets_select" ON public.response_assets
  FOR SELECT USING (deleted_at IS NULL AND public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "response_assets_insert" ON public.response_assets;
CREATE POLICY "response_assets_insert" ON public.response_assets
  FOR INSERT WITH CHECK (public.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "response_assets_update" ON public.response_assets;
CREATE POLICY "response_assets_update" ON public.response_assets
  FOR UPDATE USING (public.is_workspace_admin(workspace_id))
  WITH CHECK (public.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "response_assets_delete" ON public.response_assets;
CREATE POLICY "response_assets_delete" ON public.response_assets
  FOR DELETE USING (public.is_workspace_admin(workspace_id));

-- ============================================================
-- MIGRATION 106: DROP RESPONSE TEMPLATES
-- ============================================================
-- ============================================================
-- MIGRACION 00106 — se elimina response_templates (reemplazada por response_assets)
-- ============================================================
-- La 00105 de esta misma tanda crea `response_assets`, que reemplaza tanto a
-- `response_templates` (textos, Fase 1, vacia en produccion) como a la vieja
-- `audio_assets` (nunca aplicada). Esta migracion saca la tabla vieja de
-- textos y, en el mismo paso, redefine `purge_soft_deleted` para que
-- purgue `response_assets` en lugar de `response_templates`.
--
-- Por que las dos cosas van juntas, en esta migracion y no en la 00105: la
-- funcion nombra cada tabla a mano y plpgsql resuelve esos nombres en tiempo
-- de ejecucion.
--   - Si la 00105 sacara `response_templates` de la funcion, la tabla
--     dejaria de purgarse en la ventana entre las dos migraciones.
--   - Si la 00105 sumara `response_assets` sin sacar la otra, el DROP TABLE
--     de esta migracion dejaria la funcion apuntando a una tabla
--     inexistente y el cron de las 4 AM empezaria a fallar.
-- Haciendo las dos cosas en la misma transaccion, cada punto intermedio
-- queda consistente.
--
-- La guarda de abajo comprueba que no haya NINGUNA fila (ni siquiera
-- borrada logicamente) antes de dropear. Verificado el 1/10/2026 contra
-- produccion: 0 filas, activas y borradas. Si alguna vez hubiera datos, esta
-- migracion ABORTA y no los toca -- la decision de que hacer con ellos no es
-- de una migracion.
--
-- ── Para revertir: esto es exactamente lo que se dropea ──────────────────
--
-- La tabla (00023_crm_tables.sql:109-138):
--
--   CREATE TABLE IF NOT EXISTS public.response_templates (
--     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
--     workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
--     name text NOT NULL,
--     content text NOT NULL,
--     shortcut text,
--     created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
--     created_at timestamptz NOT NULL DEFAULT now(),
--     updated_at timestamptz NOT NULL DEFAULT now(),
--     deleted_at timestamptz
--   );
--
--   CREATE INDEX IF NOT EXISTS idx_response_templates_workspace
--     ON public.response_templates(workspace_id, name) WHERE deleted_at IS NULL;
--   CREATE INDEX IF NOT EXISTS idx_response_templates_deleted_at
--     ON public.response_templates(deleted_at) WHERE deleted_at IS NOT NULL;
--
--   DROP TRIGGER IF EXISTS set_updated_at ON public.response_templates;
--   CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.response_templates
--     FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
--
-- Los 3 CHECKs y el UNIQUE parcial (00026_response_templates_shortcut.sql:61-109):
--
--   ALTER TABLE public.response_templates
--     ADD CONSTRAINT response_templates_shortcut_format
--     CHECK (shortcut IS NULL OR shortcut ~ '^/[a-z0-9][a-z0-9_-]{0,29}$');
--   ALTER TABLE public.response_templates
--     ADD CONSTRAINT response_templates_name_not_blank
--     CHECK (length(btrim(name)) > 0);
--   ALTER TABLE public.response_templates
--     ADD CONSTRAINT response_templates_content_not_blank
--     CHECK (length(btrim(content)) > 0);
--
--   CREATE UNIQUE INDEX IF NOT EXISTS idx_response_templates_shortcut
--     ON public.response_templates(workspace_id, shortcut)
--     WHERE deleted_at IS NULL AND shortcut IS NOT NULL;
--
-- Las policies (00023_crm_tables.sql:220-239):
--
--   ALTER TABLE public.response_templates ENABLE ROW LEVEL SECURITY;
--
--   CREATE POLICY "response_templates_select" ON public.response_templates
--     FOR SELECT USING (deleted_at IS NULL AND public.is_workspace_member(workspace_id));
--   CREATE POLICY "response_templates_insert" ON public.response_templates
--     FOR INSERT WITH CHECK (public.is_workspace_admin(workspace_id));
--   CREATE POLICY "response_templates_update" ON public.response_templates
--     FOR UPDATE USING (public.is_workspace_admin(workspace_id))
--     WITH CHECK (public.is_workspace_admin(workspace_id));
--   CREATE POLICY "response_templates_delete" ON public.response_templates
--     FOR DELETE USING (public.is_workspace_admin(workspace_id));
--
-- Para revertir: recrear lo de arriba y despues volver a poner
-- `response_templates`/`v_templates` en `purge_soft_deleted` (ver la version
-- de la 00098_event_types.sql como base).
-- ============================================================

-- ------------------------------------------------------------
-- 1. La guarda: no se borra ningun dato
-- ------------------------------------------------------------

DO $$
DECLARE v_pendientes integer;
BEGIN
  -- count(*) SIN filtrar deleted_at: una fila borrada logicamente sigue
  -- siendo un dato de alguien. Si hay algo adentro, esta migracion NO lo
  -- borra: aborta y lo dice.
  SELECT count(*) INTO v_pendientes FROM public.response_templates;

  IF v_pendientes > 0 THEN
    RAISE EXCEPTION
      'response_templates tiene % fila(s) y esta migracion no borra datos. Pasalas a response_assets con kind = ''text'' (name, content, shortcut, created_by, created_at se copian tal cual) y volve a correrla.',
      v_pendientes;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 2. Se dropea la tabla vieja
-- ------------------------------------------------------------
-- Ninguna FK apunta a response_templates, asi que esto no arrastra nada. Las
-- filas de audit_log con entity_type = 'response_template' sobreviven: esa
-- columna es texto libre sin FK (00023_crm_tables.sql:79-85), y la historia
-- es historia.

DROP TABLE IF EXISTS public.response_templates;

-- ------------------------------------------------------------
-- 3. purge_soft_deleted pasa a purgar response_assets
-- ------------------------------------------------------------
-- Copia completa de la definicion vigente (00098_event_types.sql:173-235),
-- con dos cambios: sale v_templates (y su DELETE sobre response_templates),
-- entra v_assets (y su DELETE sobre response_assets), y la clave del jsonb
-- cambia de nombre junto con la variable. El resto -- incluida la condicion
-- de event_types contra bookings -- queda textual.

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
  v_assets     integer := 0;
  v_schedules  integer := 0;
  v_ooo        integer := 0;
  v_events     integer := 0;
BEGIN
  DELETE FROM public.contacts WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_contacts = ROW_COUNT;

  DELETE FROM public.conversations WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_convs = ROW_COUNT;

  DELETE FROM public.contact_notes WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_notes = ROW_COUNT;

  DELETE FROM public.response_assets WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_assets = ROW_COUNT;

  DELETE FROM public.availability_schedules WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_schedules = ROW_COUNT;

  DELETE FROM public.out_of_office WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_ooo = ROW_COUNT;

  -- Un evento con agendas NO se purga: la agenda guarda su historia y apunta
  -- al evento. (bookings llega en la 00099; antes de eso la condicion de
  -- existencia da falso y se purgan todos los borrados.)
  IF to_regclass('public.bookings') IS NULL THEN
    DELETE FROM public.event_types WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  ELSE
    EXECUTE '
      DELETE FROM public.event_types e
      WHERE e.deleted_at IS NOT NULL AND e.deleted_at < $1
        AND NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.event_type_id = e.id)
    ' USING v_cutoff;
  END IF;
  GET DIAGNOSTICS v_events = ROW_COUNT;

  RETURN jsonb_build_object(
    'cutoff', v_cutoff,
    'contacts', v_contacts,
    'conversations', v_convs,
    'contact_notes', v_notes,
    'response_assets', v_assets,
    'availability_schedules', v_schedules,
    'out_of_office', v_ooo,
    'event_types', v_events
  );
END;
$$;

REVOKE ALL ON FUNCTION public.purge_soft_deleted(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_soft_deleted(integer) TO service_role;

-- ============================================================
-- MIGRATION 110: CHAT DASHBOARD V2
-- ============================================================
-- ============================================================================
-- 00110 — Dashboard de Chat, segunda vuelta (Bloques 2e y 3: F16, F17, F18)
-- ============================================================================
-- La 00078 dejo las metricas basicas. Esta completa lo que la pantalla necesita
-- y arregla tres cosas que estaban mal:
--
--   1. `chat_dashboard_team` calculaba "primera respuesta" y "respuesta" con la
--      MISMA consulta (00078:217-218), asi que las dos columnas mostraban
--      siempre el mismo numero. Ahora la primera respuesta de una persona se
--      cuenta desde que la conversacion le fue asignada o derivada (§11.4).
--   2. Flows, secuencias y broadcasts salian como tres filas distintas, y al
--      tocarlas se filtraba por `author=flow`, que `chat_author_match` no
--      reconoce: el dashboard quedaba en blanco. Ahora son UNA fila,
--      'automations', que es el valor que el filtro si entiende.
--   3. Las tendencias devolvian solo los dias con actividad. Un dia sin
--      mensajes faltaba en vez de valer cero, y el grafico mentia la forma.
--
-- Todas SECURITY INVOKER: se llaman con el cliente del usuario, asi la RLS de
-- messages/conversations aplica el scope de leads sin logica extra en la app.
-- Idempotente. Los DROP son necesarios: no se puede cambiar el tipo de retorno
-- de una funcion con CREATE OR REPLACE (42P13).
--
-- OJO con `agent_runs`: `authenticated` NO puede leer tokens ni `cost_usd`
-- (GRANT por columna de la 00060). Ninguna funcion de aca los toca; una que lo
-- hiciera fallaria con "permission denied" para cualquier persona real.
-- ============================================================================

-- ------------------------------------------------------------
-- 1. Grupo de autor: un color y una fila por grupo
-- ------------------------------------------------------------
-- 'team' agrupa a las personas cuando se las mira juntas; en la tabla "Quien
-- responde" cada persona tiene su propia fila (su uuid).
CREATE OR REPLACE FUNCTION public.chat_origin_group(p_origin text)
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_origin = 'agent' THEN 'agent'
    WHEN p_origin IN ('flow', 'sequence', 'broadcast') THEN 'automations'
    WHEN p_origin = 'user' THEN 'team'
    WHEN p_origin = 'external' THEN 'external'
  END;
$$;

COMMENT ON FUNCTION public.chat_origin_group(text) IS
  'Grupo de autor de un saliente: agent | team | automations | external. NULL para un origin desconocido (no se inventa un grupo).';

-- ------------------------------------------------------------
-- 2. Flags del agente por episodio (una sola definicion)
-- ------------------------------------------------------------
-- Sale a una funcion propia para que los tres numeros grandes y la mini linea
-- de 8 semanas no puedan discrepar: si se calcularan dos veces, un dia una
-- dice 86% y la otra 84% y nadie sabe cual creer.
CREATE OR REPLACE FUNCTION public.chat_agent_episode_flags(
  p_workspace_id uuid,
  p_channel text DEFAULT NULL
)
RETURNS TABLE (
  conversation_id uuid,
  episode_no integer,
  episode_start timestamptz,
  acted boolean,
  took_first boolean,
  escalated boolean
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  WITH ep AS (
    -- El fin del episodio es el arranque del siguiente: sin eso, una accion de
    -- la semana que viene contaria para el episodio de hoy.
    SELECT e.*,
           LEAD(e.episode_start) OVER (PARTITION BY e.conversation_id ORDER BY e.episode_no) AS next_start
    FROM public.chat_episodes(p_workspace_id, p_channel) e
  )
  SELECT
    ep.conversation_id,
    ep.episode_no,
    ep.episode_start,
    (
      ep.first_outbound_origin = 'agent'
      OR EXISTS (
        SELECT 1 FROM public.agent_drafts d
        WHERE d.conversation_id = ep.conversation_id
          AND d.created_at >= ep.episode_start
          AND (ep.next_start IS NULL OR d.created_at < ep.next_start)
      )
      OR EXISTS (
        SELECT 1 FROM public.audit_log al
        WHERE al.entity_id = ep.conversation_id
          AND al.performed_by_agent_id IS NOT NULL
          AND al.performed_at >= ep.episode_start
          AND (ep.next_start IS NULL OR al.performed_at < ep.next_start)
      )
    ) AS acted,
    (ep.first_outbound_origin = 'agent') AS took_first,
    (
      EXISTS (
        SELECT 1 FROM public.agent_runs r
        WHERE r.conversation_id = ep.conversation_id
          AND r.status = 'escalated'
          AND r.created_at >= ep.episode_start
          AND (ep.next_start IS NULL OR r.created_at < ep.next_start)
      )
      OR EXISTS (
        SELECT 1 FROM public.audit_log al2
        WHERE al2.entity_id = ep.conversation_id
          AND al2.action = 'human_takeover'
          AND al2.performed_by_agent_id IS NOT NULL
          AND al2.performed_at >= ep.episode_start
          AND (ep.next_start IS NULL OR al2.performed_at < ep.next_start)
      )
    ) AS escalated
  FROM ep;
$$;

COMMENT ON FUNCTION public.chat_agent_episode_flags(uuid, text) IS
  'Por episodio: si el agente actuo, si tomo desde el primer mensaje y si derivo (§11.5). Fuente unica de los tres numeros y de la serie semanal.';

-- ------------------------------------------------------------
-- 3. Seccion del agente: los tres numeros
-- ------------------------------------------------------------
-- Misma firma que la 00078, asi que alcanza CREATE OR REPLACE. Lo que cambia es
-- que ahora sale de la funcion de flags.
CREATE OR REPLACE FUNCTION public.chat_dashboard_agent(
  p_workspace_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_channel text DEFAULT NULL
)
RETURNS TABLE (
  new_conversations bigint,
  agent_acted bigint,
  agent_took_first bigint,
  agent_escalated bigint
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE acted),
    COUNT(*) FILTER (WHERE took_first),
    COUNT(*) FILTER (WHERE escalated)
  FROM public.chat_agent_episode_flags(p_workspace_id, p_channel)
  WHERE (p_from IS NULL OR episode_start >= p_from)
    AND (p_to IS NULL OR episode_start <= p_to);
$$;

-- ------------------------------------------------------------
-- 4. Las tres tasas del agente por semana (mini linea de 8 semanas)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chat_dashboard_agent_weekly(
  p_workspace_id uuid,
  p_channel text DEFAULT NULL,
  p_tz text DEFAULT 'America/Costa_Rica',
  p_weeks integer DEFAULT 8
)
RETURNS TABLE (
  week_start date,
  new_conversations bigint,
  acted bigint,
  took_first bigint,
  escalated bigint
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  WITH weeks AS (
    SELECT generate_series(
             date_trunc('week', (now() AT TIME ZONE p_tz)) - ((GREATEST(p_weeks, 1) - 1) || ' weeks')::interval,
             date_trunc('week', (now() AT TIME ZONE p_tz)),
             interval '1 week'
           )::date AS w
  ),
  flags AS (
    SELECT date_trunc('week', (episode_start AT TIME ZONE p_tz))::date AS w, acted, took_first, escalated
    FROM public.chat_agent_episode_flags(p_workspace_id, p_channel)
    WHERE episode_start >= (SELECT MIN(w) FROM weeks)
  )
  SELECT
    weeks.w,
    COUNT(f.w),
    COUNT(*) FILTER (WHERE f.acted),
    COUNT(*) FILTER (WHERE f.took_first),
    COUNT(*) FILTER (WHERE f.escalated)
  FROM weeks
  LEFT JOIN flags f ON f.w = weeks.w
  GROUP BY weeks.w
  ORDER BY weeks.w;
$$;

COMMENT ON FUNCTION public.chat_dashboard_agent_weekly(uuid, text, text, integer) IS
  'Las tres tasas del agente por semana ISO (lunes), para la mini linea. Una semana sin episodios devuelve 0 y la app la dibuja como hueco, no como 0%.';

-- ------------------------------------------------------------
-- 5. Quien respondio primero (barra 100%)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chat_dashboard_first_responder(
  p_workspace_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_channel text DEFAULT NULL
)
RETURNS TABLE (responder text, episodes bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  WITH ep AS (
    SELECT COALESCE(public.chat_origin_group(first_outbound_origin), 'unanswered') AS responder
    FROM public.chat_episodes(p_workspace_id, p_channel)
    WHERE (p_from IS NULL OR episode_start >= p_from)
      AND (p_to IS NULL OR episode_start <= p_to)
  ),
  keys AS (
    SELECT * FROM (VALUES ('agent'), ('automations'), ('team'), ('external'), ('unanswered')) AS k(responder)
  )
  -- Siempre las cinco filas, incluso en cero: la barra necesita saber que ese
  -- pedazo existe y vale cero, que no es lo mismo que no saberlo.
  SELECT keys.responder, COUNT(ep.responder)
  FROM keys
  LEFT JOIN ep ON ep.responder = keys.responder
  GROUP BY keys.responder;
$$;

COMMENT ON FUNCTION public.chat_dashboard_first_responder(uuid, timestamptz, timestamptz, text) IS
  'Episodios del periodo por quien respondio primero, incluido "unanswered" (§11.5). Cinco filas siempre.';

-- ------------------------------------------------------------
-- 6. Por que derivo
-- ------------------------------------------------------------
-- El motivo de una derivacion por herramienta lo escribe el modelo en texto
-- libre (`metadata.reason`), asi que se agrupa por el texto normalizado y se
-- muestra la ultima redaccion. Los de guardarrail si tienen clave estable.
CREATE OR REPLACE FUNCTION public.chat_dashboard_escalation_reasons(
  p_workspace_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_channel text DEFAULT NULL,
  p_limit integer DEFAULT 6
)
RETURNS TABLE (
  reason_key text,
  reason_label text,
  origin text,
  escalations bigint,
  pct numeric,
  is_other boolean
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  WITH rows AS (
    SELECT
      COALESCE(al.metadata->>'origin', 'tool') AS origin,
      NULLIF(btrim(COALESCE(al.metadata->>'reason', '')), '') AS reason,
      al.performed_at
    FROM public.audit_log al
    JOIN public.conversations c ON c.id = al.entity_id
    WHERE al.workspace_id = p_workspace_id
      AND al.entity_type = 'conversation'
      AND al.action = 'human_takeover'
      AND al.performed_by_agent_id IS NOT NULL
      AND c.deleted_at IS NULL
      AND (p_from IS NULL OR al.performed_at >= p_from)
      AND (p_to IS NULL OR al.performed_at <= p_to)
      AND (p_channel IS NULL OR c.channel_id::text = p_channel OR c.platform = p_channel)
  ),
  grouped AS (
    SELECT
      COALESCE(NULLIF(public.normalize_for_grouping(reason), ''), 'sin_motivo') AS reason_key,
      -- La ultima redaccion real: las variantes de escritura ya se juntaron por
      -- la clave normalizada.
      COALESCE((ARRAY_AGG(reason ORDER BY performed_at DESC))[1], 'Sin motivo anotado') AS reason_label,
      (ARRAY_AGG(origin ORDER BY performed_at DESC))[1] AS origin,
      COUNT(*) AS n
    FROM rows
    GROUP BY 1
  ),
  ranked AS (
    SELECT *, ROW_NUMBER() OVER (ORDER BY n DESC, reason_key) AS rn, SUM(n) OVER () AS total
    FROM grouped
  )
  SELECT reason_key, reason_label, origin, n,
         ROUND(100.0 * n / NULLIF(total, 0), 1), false
  FROM ranked WHERE rn <= GREATEST(p_limit, 1)
  UNION ALL
  -- Lo que no entra en el top se junta en una fila: veinte motivos de uno no
  -- son informacion, son ruido.
  SELECT 'otros', 'Otros motivos', NULL, SUM(n),
         ROUND(100.0 * SUM(n) / NULLIF(MAX(total), 0), 1), true
  FROM ranked WHERE rn > GREATEST(p_limit, 1)
  HAVING SUM(n) > 0;
$$;

COMMENT ON FUNCTION public.chat_dashboard_escalation_reasons(uuid, timestamptz, timestamptz, text, integer) IS
  'Derivaciones del agente por motivo (§11.5). El motivo de una derivacion por herramienta es texto libre del modelo: se agrupa normalizado y se muestra la ultima redaccion.';

-- ------------------------------------------------------------
-- 7. Acciones del agente
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chat_dashboard_agent_actions(
  p_workspace_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_channel text DEFAULT NULL
)
RETURNS TABLE (action text, actions bigint, reverted bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT al.action, COUNT(*), COUNT(*) FILTER (WHERE al.reverted_at IS NOT NULL)
  FROM public.audit_log al
  LEFT JOIN public.conversations cv
    ON al.entity_type = 'conversation' AND cv.id = al.entity_id
  WHERE al.workspace_id = p_workspace_id
    AND al.performed_by_agent_id IS NOT NULL
    AND al.entity_type IN ('conversation', 'contact')
    AND (p_from IS NULL OR al.performed_at >= p_from)
    AND (p_to IS NULL OR al.performed_at <= p_to)
    AND (
      (al.entity_type = 'conversation'
        AND cv.id IS NOT NULL AND cv.deleted_at IS NULL
        AND (p_channel IS NULL OR cv.channel_id::text = p_channel OR cv.platform = p_channel))
      OR (al.entity_type = 'contact'
        AND (p_channel IS NULL OR EXISTS (
          SELECT 1 FROM public.conversations c2
          WHERE c2.contact_id = al.entity_id AND c2.deleted_at IS NULL
            AND (c2.channel_id::text = p_channel OR c2.platform = p_channel)
        )))
    )
  GROUP BY al.action
  ORDER BY COUNT(*) DESC;
$$;

COMMENT ON FUNCTION public.chat_dashboard_agent_actions(uuid, timestamptz, timestamptz, text) IS
  'Lo que hizo el agente en el periodo, por tipo de accion, desde audit_log.performed_by_agent_id (§11.5). Incluye cuantas se revirtieron.';

-- ------------------------------------------------------------
-- 8. Resultados de las reglas de respuesta
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chat_dashboard_rule_results(
  p_workspace_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_channel text DEFAULT NULL
)
RETURNS TABLE (
  rule_id text,
  rule_index integer,
  action text,
  runs bigint,
  degraded_to_draft bigint,
  is_default boolean
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  WITH r AS (
    SELECT
      ar.routing->>'rule_id' AS rule_id,
      NULLIF(ar.routing->>'rule_index', '')::integer AS rule_index,
      ar.routing->>'action' AS action,
      ar.routing->>'refresh' AS refresh
    FROM public.agent_runs ar
    WHERE ar.workspace_id = p_workspace_id
      AND ar.source = 'agent'
      AND ar.routing->>'mode' = 'rules'
      AND ar.routing->>'action' IN ('send', 'draft', 'skip')
      AND (p_from IS NULL OR ar.created_at >= p_from)
      AND (p_to IS NULL OR ar.created_at <= p_to)
      AND (p_channel IS NULL OR ar.channel_id::text = p_channel OR EXISTS (
        SELECT 1 FROM public.channels ch WHERE ch.id = ar.channel_id AND ch.platform = p_channel
      ))
  )
  SELECT rule_id, MIN(rule_index)::integer, action, COUNT(*),
         -- Un "enviar directo" que se degrado a borrador porque el refresco
         -- contra Zernio fallo: la regla decidio una cosa y paso otra.
         COUNT(*) FILTER (WHERE action = 'send' AND refresh = 'failed'),
         rule_id IS NULL
  FROM r
  GROUP BY rule_id, action
  ORDER BY MIN(rule_index) NULLS LAST, action;
$$;

COMMENT ON FUNCTION public.chat_dashboard_rule_results(uuid, timestamptz, timestamptz, text) IS
  'Turnos por regla y accion (§11.5). rule_id NULL = ninguna regla coincidio y decidio la accion por defecto. La app traduce el id a "Regla N": el id nunca se muestra.';

-- ------------------------------------------------------------
-- 9. Aprobacion de respuestas (borradores)
-- ------------------------------------------------------------
-- Los cinco resultados de §11.6 son EXCLUYENTES y en este orden, para que la
-- barra de 100% sume exactamente el total. Se excluyen `superseded`,
-- `regenerated` y los descartes automaticos que no son una decision.
--
-- "Respondida a mano" se detecta por `discard_reason = 'auto:manual_reply'`, que
-- es lo que escribe el trigger de la 00077 cuando alguien contesta a mano. §11.6
-- lo describe como "descarte no automatico + saliente de una persona", pero en
-- la practica ese caso SIEMPRE llega marcado por el trigger.
CREATE OR REPLACE FUNCTION public.chat_dashboard_drafts(
  p_workspace_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_channel text DEFAULT NULL,
  p_tz text DEFAULT 'America/Costa_Rica'
)
RETURNS TABLE (
  approved_unchanged bigint,
  corrected bigint,
  answered_manually bigint,
  discarded bigint,
  window_missed bigint,
  agent_median_s numeric,
  approval_median_s numeric,
  pending_now bigint,
  pending_under_6h bigint,
  missed_last_7d bigint,
  unedited_weekly jsonb
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  WITH d AS (
    SELECT dr.*
    FROM public.agent_drafts dr
    JOIN public.conversations c ON c.id = dr.conversation_id
    WHERE dr.workspace_id = p_workspace_id
      AND c.deleted_at IS NULL
      AND dr.status NOT IN ('superseded', 'regenerated')
      AND (p_channel IS NULL OR c.channel_id::text = p_channel OR c.platform = p_channel)
  ),
  outcome AS (
    SELECT
      CASE
        WHEN status = 'sent' AND sent_body IS NOT DISTINCT FROM body THEN 'approved_unchanged'
        WHEN status = 'sent' THEN 'corrected'
        WHEN window_missed_at IS NOT NULL THEN 'window_missed'
        WHEN status = 'discarded' AND discard_reason = 'auto:manual_reply' THEN 'answered_manually'
        WHEN status = 'discarded' AND COALESCE(discard_reason, '') NOT LIKE 'auto:%' THEN 'discarded'
      END AS kind,
      COALESCE(window_missed_at, decided_at) AS at
    FROM d
  ),
  counted AS (
    SELECT kind, COUNT(*) AS n
    FROM outcome
    WHERE kind IS NOT NULL
      AND (p_from IS NULL OR at >= p_from)
      AND (p_to IS NULL OR at <= p_to)
    GROUP BY kind
  ),
  runs AS (
    SELECT ar.completed_at, ar.inbound_at, ar.responded_at, ar.id
    FROM public.agent_runs ar
    WHERE ar.workspace_id = p_workspace_id
      AND ar.source = 'agent'
      AND ar.inbound_at IS NOT NULL
      AND (p_channel IS NULL OR ar.channel_id::text = p_channel OR EXISTS (
        SELECT 1 FROM public.channels ch WHERE ch.id = ar.channel_id AND ch.platform = p_channel
      ))
  ),
  weeks AS (
    SELECT generate_series(
             date_trunc('week', (now() AT TIME ZONE p_tz)) - interval '7 weeks',
             date_trunc('week', (now() AT TIME ZONE p_tz)),
             interval '1 week'
           )::date AS w
  ),
  weekly AS (
    SELECT weeks.w,
           COUNT(s.id) AS sent,
           COUNT(s.id) FILTER (WHERE s.sent_body IS NOT DISTINCT FROM s.body) AS unedited
    FROM weeks
    LEFT JOIN (
      SELECT id, body, sent_body, date_trunc('week', (decided_at AT TIME ZONE p_tz))::date AS w
      FROM d WHERE status = 'sent' AND decided_at IS NOT NULL
    ) s ON s.w = weeks.w
    GROUP BY weeks.w
  )
  SELECT
    COALESCE((SELECT n FROM counted WHERE kind = 'approved_unchanged'), 0),
    COALESCE((SELECT n FROM counted WHERE kind = 'corrected'), 0),
    COALESCE((SELECT n FROM counted WHERE kind = 'answered_manually'), 0),
    COALESCE((SELECT n FROM counted WHERE kind = 'discarded'), 0),
    COALESCE((SELECT n FROM counted WHERE kind = 'window_missed'), 0),
    -- Lo que tarda el agente: incluye la espera de la rafaga, no es la
    -- velocidad del modelo.
    (SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (completed_at - inbound_at)))
       FROM runs WHERE completed_at IS NOT NULL
         AND (p_from IS NULL OR completed_at >= p_from) AND (p_to IS NULL OR completed_at <= p_to)),
    -- Lo que tarda la aprobacion: SOLO sobre borradores enviados. Con los de
    -- envio directo adentro (~0 s) la mediana no diria nada.
    (SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (r.responded_at - r.completed_at)))
       FROM d JOIN runs r ON r.id = d.run_id
       WHERE d.status = 'sent' AND r.responded_at IS NOT NULL AND r.completed_at IS NOT NULL
         AND (p_from IS NULL OR d.decided_at >= p_from) AND (p_to IS NULL OR d.decided_at <= p_to)),
    -- Los tres que NO dependen del periodo: son el estado de ahora, y el aviso
    -- de arriba del dashboard los usa (F17).
    (SELECT COUNT(*) FROM d WHERE status IN ('pending', 'failed')),
    (SELECT COUNT(*) FROM d WHERE status IN ('pending', 'failed')
       AND sendable_until IS NOT NULL AND sendable_until > now()
       AND sendable_until - now() < interval '6 hours'),
    (SELECT COUNT(*) FROM d WHERE window_missed_at >= now() - interval '7 days'),
    (SELECT COALESCE(jsonb_agg(jsonb_build_object(
              'week_start', w, 'sent', sent, 'unedited', unedited,
              'pct', ROUND(100.0 * unedited / NULLIF(sent, 0), 1)
            ) ORDER BY w), '[]'::jsonb) FROM weekly);
$$;

COMMENT ON FUNCTION public.chat_dashboard_drafts(uuid, timestamptz, timestamptz, text, text) IS
  'Aprobacion de respuestas (§11.6): los cinco resultados excluyentes, las dos medianas, el estado de ahora (pendientes, por vencer, ventanas perdidas) y ocho semanas de aprobados sin cambios.';

-- ------------------------------------------------------------
-- 10. Tabla "Quien responde"
-- ------------------------------------------------------------
-- Se borra por NOMBRE y no por firma: si la que esta aplicada tuviera un
-- parametro distinto del que dice el archivo (paso: la 00078 se aplico en dos
-- pedazos), un DROP con la firma exacta no encontraria nada y el CREATE fallaria
-- con "cannot change return type". Verificado el 28/9: hoy hay una sola.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'chat_dashboard_team'
  LOOP
    EXECUTE 'DROP FUNCTION ' || r.sig;
  END LOOP;
END $$;

CREATE FUNCTION public.chat_dashboard_team(
  p_workspace_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_channel text DEFAULT NULL
)
RETURNS TABLE (
  author text,
  conversations bigint,
  messages_out bigint,
  first_response_median_seconds numeric,
  reply_median_seconds numeric,
  replies_under_1h_pct numeric,
  escalations_received bigint,
  drafts_approved bigint,
  drafts_approved_unedited_pct numeric
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  WITH ep AS (
    SELECT e.*,
           LEAD(e.episode_start) OVER (PARTITION BY e.conversation_id ORDER BY e.episode_no) AS next_start
    FROM public.chat_episodes(p_workspace_id, p_channel) e
  ),
  msgs AS (
    SELECT
      CASE
        WHEN m.origin = 'user' THEN COALESCE(m.sent_by_user_id::text, 'user')
        ELSE public.chat_origin_group(m.origin)
      END AS author,
      m.conversation_id, m.created_at, m.direction,
      LAG(m.direction) OVER w AS prev_dir,
      LAG(m.created_at) OVER w AS prev_at
    FROM public.messages m
    JOIN public.conversations c ON c.id = m.conversation_id
    WHERE m.workspace_id = p_workspace_id AND c.deleted_at IS NULL
      AND (p_channel IS NULL OR c.channel_id::text = p_channel OR c.platform = p_channel)
    WINDOW w AS (PARTITION BY m.conversation_id ORDER BY m.created_at)
  ),
  outs AS (
    SELECT * FROM msgs WHERE direction = 'outbound' AND author IS NOT NULL
  ),
  outs_p AS (
    SELECT * FROM outs
    WHERE (p_from IS NULL OR created_at >= p_from) AND (p_to IS NULL OR created_at <= p_to)
  ),
  sent AS (
    SELECT author, COUNT(*) AS n FROM outs_p GROUP BY author
  ),
  replies AS (
    -- "Respuesta": cada saliente cuyo mensaje anterior es del lead, contado
    -- desde ese entrante (§11.4).
    SELECT author,
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (created_at - prev_at))) AS reply_med,
           ROUND(100.0 * COUNT(*) FILTER (WHERE created_at - prev_at < interval '1 hour') / NULLIF(COUNT(*), 0), 1) AS under1h
    FROM outs_p WHERE prev_dir = 'inbound'
    GROUP BY author
  ),
  author_ep AS (
    -- El primer saliente de cada autor en cada episodio.
    SELECT o.author, o.conversation_id, ep.episode_no, ep.episode_start, ep.first_inbound_at, ep.contact_id,
           MIN(o.created_at) AS author_first_out,
           BOOL_OR((p_from IS NULL OR o.created_at >= p_from) AND (p_to IS NULL OR o.created_at <= p_to)) AS in_period
    FROM outs o
    JOIN ep ON ep.conversation_id = o.conversation_id
      AND o.created_at >= ep.episode_start
      AND (ep.next_start IS NULL OR o.created_at < ep.next_start)
    GROUP BY o.author, o.conversation_id, ep.episode_no, ep.episode_start, ep.first_inbound_at, ep.contact_id
  ),
  handoff AS (
    -- Para una PERSONA, su tiempo se cuenta desde que la conversacion le fue
    -- asignada o derivada, no desde que escribio el lead: antes de eso no era
    -- suya (§11.4). Para los grupos no hay asignacion y queda el primer
    -- entrante del episodio.
    SELECT ae.author, ae.conversation_id, ae.episode_no,
           MAX(al.performed_at) AS assigned_at
    FROM author_ep ae
    JOIN public.audit_log al
      ON al.workspace_id = p_workspace_id
     AND al.performed_at >= ae.episode_start
     AND al.performed_at < ae.author_first_out
     AND (
       (al.entity_type = 'conversation' AND al.entity_id = ae.conversation_id
         AND al.action = 'assign' AND al.changes->'assigned_to'->>'new' = ae.author)
       OR (al.entity_type = 'contact' AND al.entity_id = ae.contact_id
         AND al.action = 'assign'
         AND (al.changes->'setter_id'->>'new' = ae.author OR al.changes->'vendedor_id'->>'new' = ae.author))
       OR (al.entity_type = 'conversation' AND al.entity_id = ae.conversation_id
         AND al.action = 'human_takeover')
     )
    WHERE ae.author ~ '^[0-9a-f-]{36}$'
    GROUP BY ae.author, ae.conversation_id, ae.episode_no
  ),
  first_resp AS (
    SELECT ae.author,
           COUNT(*) AS conversations,
           PERCENTILE_CONT(0.5) WITHIN GROUP (
             ORDER BY EXTRACT(EPOCH FROM (ae.author_first_out - GREATEST(ae.first_inbound_at, COALESCE(h.assigned_at, ae.first_inbound_at))))
           ) FILTER (WHERE ae.author_first_out >= ae.first_inbound_at) AS first_med
    FROM author_ep ae
    LEFT JOIN handoff h ON h.author = ae.author AND h.conversation_id = ae.conversation_id AND h.episode_no = ae.episode_no
    WHERE ae.in_period
    GROUP BY ae.author
  ),
  esc AS (
    -- Derivaciones RECIBIDAS por una persona: a quien quedo la conversacion.
    SELECT target AS author, COUNT(*) AS n FROM (
      SELECT CASE
               WHEN al.action = 'assign' AND al.entity_type = 'conversation' THEN al.changes->'assigned_to'->>'new'
               WHEN al.action = 'assign' AND al.entity_type = 'contact'
                 THEN COALESCE(al.changes->'setter_id'->>'new', al.changes->'vendedor_id'->>'new')
               WHEN al.action = 'human_takeover'
                 THEN COALESCE(al.metadata->>'assigned_to', cv.assigned_to::text, ct.setter_id::text, ct.vendedor_id::text)
             END AS target
      FROM public.audit_log al
      LEFT JOIN public.conversations cv ON al.entity_type = 'conversation' AND cv.id = al.entity_id
      LEFT JOIN public.contacts ct ON ct.id = COALESCE(cv.contact_id, CASE WHEN al.entity_type = 'contact' THEN al.entity_id END)
      WHERE al.workspace_id = p_workspace_id
        AND al.action IN ('assign', 'human_takeover')
        AND (p_from IS NULL OR al.performed_at >= p_from)
        AND (p_to IS NULL OR al.performed_at <= p_to)
        AND (p_channel IS NULL
             OR (cv.id IS NOT NULL AND (cv.channel_id::text = p_channel OR cv.platform = p_channel))
             OR (al.entity_type = 'contact' AND EXISTS (
                   SELECT 1 FROM public.conversations c3
                   WHERE c3.contact_id = al.entity_id AND c3.deleted_at IS NULL
                     AND (c3.channel_id::text = p_channel OR c3.platform = p_channel))))
    ) t
    WHERE target ~ '^[0-9a-f-]{36}$'
    GROUP BY target
  ),
  drafts AS (
    -- Borradores que aprobo cada persona. Salen con origin 'agent', asi que no
    -- aparecen en sus mensajes enviados: es una columna propia.
    SELECT dr.decided_by::text AS author, COUNT(*) AS n,
           ROUND(100.0 * COUNT(*) FILTER (WHERE dr.sent_body IS NOT DISTINCT FROM dr.body) / NULLIF(COUNT(*), 0), 1) AS unedited_pct
    FROM public.agent_drafts dr
    JOIN public.conversations c ON c.id = dr.conversation_id
    WHERE dr.workspace_id = p_workspace_id AND c.deleted_at IS NULL
      AND dr.status = 'sent' AND dr.decided_by IS NOT NULL
      AND (p_from IS NULL OR dr.decided_at >= p_from) AND (p_to IS NULL OR dr.decided_at <= p_to)
      AND (p_channel IS NULL OR c.channel_id::text = p_channel OR c.platform = p_channel)
    GROUP BY dr.decided_by
  ),
  authors AS (
    SELECT author FROM sent
    UNION SELECT author FROM esc
    UNION SELECT author FROM drafts
  )
  SELECT
    a.author,
    COALESCE(fr.conversations, 0),
    COALESCE(s.n, 0),
    fr.first_med,
    rp.reply_med,
    rp.under1h,
    CASE WHEN a.author ~ '^[0-9a-f-]{36}$' THEN COALESCE(e.n, 0) END,
    CASE WHEN a.author ~ '^[0-9a-f-]{36}$' THEN COALESCE(dp.n, 0) END,
    dp.unedited_pct
  FROM authors a
  LEFT JOIN sent s ON s.author = a.author
  LEFT JOIN replies rp ON rp.author = a.author
  LEFT JOIN first_resp fr ON fr.author = a.author
  LEFT JOIN esc e ON e.author = a.author
  LEFT JOIN drafts dp ON dp.author = a.author;
$$;

COMMENT ON FUNCTION public.chat_dashboard_team(uuid, timestamptz, timestamptz, text) IS
  'Una fila por autor: el agente, "automations" (flows + secuencias + broadcasts, UNA fila), "external" y cada persona. La primera respuesta de una persona se cuenta desde que la conversacion le fue asignada o derivada (§11.4). Para un Member, las derivaciones recibidas pueden quedar cortas: la RLS de audit_log no le muestra las filas de otras personas.';

-- ------------------------------------------------------------
-- 11. Numeros principales: las conversaciones tambien respetan el autor
-- ------------------------------------------------------------
-- La tarjeta dice "En las que participo" cuando hay filtro de persona, pero el
-- numero contaba TODOS los episodios (00078:126-127). §11.2: las metricas por
-- conversacion se acotan a los episodios donde ese autor mando algo.
CREATE OR REPLACE FUNCTION public.chat_dashboard_numbers(
  p_workspace_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_channel text DEFAULT NULL,
  p_author text DEFAULT NULL
)
RETURNS TABLE (
  new_conversations bigint,
  messages_in bigint,
  messages_out bigint,
  first_response_median_seconds numeric
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  WITH ep AS (
    SELECT e.*,
           LEAD(e.episode_start) OVER (PARTITION BY e.conversation_id ORDER BY e.episode_no) AS next_start
    FROM public.chat_episodes(p_workspace_id, p_channel) e
  ),
  ep_period AS (
    SELECT * FROM ep
    WHERE (p_from IS NULL OR episode_start >= p_from) AND (p_to IS NULL OR episode_start <= p_to)
  ),
  msgs AS (
    SELECT m.direction, m.origin, m.sent_by_user_id, m.created_at, m.conversation_id
    FROM public.messages m
    JOIN public.conversations c ON c.id = m.conversation_id
    WHERE m.workspace_id = p_workspace_id AND c.deleted_at IS NULL
      AND (p_channel IS NULL OR c.channel_id::text = p_channel OR c.platform = p_channel)
      AND (p_from IS NULL OR m.created_at >= p_from)
      AND (p_to IS NULL OR m.created_at <= p_to)
  ),
  ep_touched AS (
    SELECT e.*
    FROM ep_period e
    WHERE p_author IS NULL OR p_author = 'all' OR EXISTS (
      SELECT 1 FROM msgs m
      WHERE m.conversation_id = e.conversation_id
        AND m.direction = 'outbound'
        AND m.created_at >= e.episode_start
        AND (e.next_start IS NULL OR m.created_at < e.next_start)
        AND public.chat_author_match(p_author, m.origin, m.sent_by_user_id)
    )
  )
  SELECT
    (SELECT COUNT(*) FROM ep_touched),
    (SELECT COUNT(*) FROM msgs WHERE direction = 'inbound'),
    (SELECT COUNT(*) FROM msgs WHERE direction = 'outbound'
       AND public.chat_author_match(p_author, origin, sent_by_user_id)),
    (SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (first_outbound_at - first_inbound_at)))
       FROM ep_touched
       WHERE first_inbound_at IS NOT NULL AND first_outbound_at IS NOT NULL
         AND first_outbound_at >= first_inbound_at);
$$;

-- ------------------------------------------------------------
-- 12. Tendencias: serie densa, por autor y con la mediana diaria
-- ------------------------------------------------------------
-- Igual que arriba: por nombre, no por firma.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'chat_dashboard_trends'
  LOOP
    EXECUTE 'DROP FUNCTION ' || r.sig;
  END LOOP;
END $$;

CREATE FUNCTION public.chat_dashboard_trends(
  p_workspace_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_channel text DEFAULT NULL,
  p_author text DEFAULT NULL,
  p_tz text DEFAULT 'America/Costa_Rica'
)
RETURNS TABLE (
  day date,
  messages_in bigint,
  messages_out bigint,
  new_conversations bigint,
  sent_agent bigint,
  sent_team bigint,
  sent_automations bigint,
  sent_external bigint,
  first_response_median_seconds numeric
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  WITH all_msgs AS (
    SELECT (m.created_at AT TIME ZONE p_tz)::date AS d, m.direction, m.origin, m.sent_by_user_id, m.created_at
    FROM public.messages m
    JOIN public.conversations c ON c.id = m.conversation_id
    WHERE m.workspace_id = p_workspace_id AND c.deleted_at IS NULL
      AND (p_channel IS NULL OR c.channel_id::text = p_channel OR c.platform = p_channel)
  ),
  bounds AS (
    SELECT
      COALESCE((p_from AT TIME ZONE p_tz)::date, (SELECT MIN(d) FROM all_msgs)) AS d0,
      LEAST(COALESCE((p_to AT TIME ZONE p_tz)::date, (now() AT TIME ZONE p_tz)::date),
            (now() AT TIME ZONE p_tz)::date) AS d1
  ),
  days AS (
    -- Todos los dias del periodo, tengan o no actividad: un dia sin mensajes
    -- vale cero y el grafico tiene que mostrar ese hueco en su lugar.
    SELECT generate_series(d0::timestamp, d1::timestamp, interval '1 day')::date AS d
    FROM bounds WHERE d0 IS NOT NULL AND d1 >= d0
  ),
  msgs AS (
    SELECT * FROM all_msgs
    WHERE (p_from IS NULL OR created_at >= p_from) AND (p_to IS NULL OR created_at <= p_to)
  ),
  per_day AS (
    SELECT d,
      COUNT(*) FILTER (WHERE direction = 'inbound') AS m_in,
      COUNT(*) FILTER (WHERE direction = 'outbound' AND public.chat_author_match(p_author, origin, sent_by_user_id)) AS m_out,
      COUNT(*) FILTER (WHERE direction = 'outbound' AND public.chat_author_match(p_author, origin, sent_by_user_id) AND public.chat_origin_group(origin) = 'agent') AS s_agent,
      COUNT(*) FILTER (WHERE direction = 'outbound' AND public.chat_author_match(p_author, origin, sent_by_user_id) AND public.chat_origin_group(origin) = 'team') AS s_team,
      COUNT(*) FILTER (WHERE direction = 'outbound' AND public.chat_author_match(p_author, origin, sent_by_user_id) AND public.chat_origin_group(origin) = 'automations') AS s_auto,
      COUNT(*) FILTER (WHERE direction = 'outbound' AND public.chat_author_match(p_author, origin, sent_by_user_id) AND public.chat_origin_group(origin) = 'external') AS s_ext
    FROM msgs GROUP BY d
  ),
  eps AS (
    SELECT (episode_start AT TIME ZONE p_tz)::date AS d, first_inbound_at, first_outbound_at
    FROM public.chat_episodes(p_workspace_id, p_channel)
    WHERE (p_from IS NULL OR episode_start >= p_from) AND (p_to IS NULL OR episode_start <= p_to)
  ),
  eps_day AS (
    SELECT d, COUNT(*) AS n,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (first_outbound_at - first_inbound_at)))
        FILTER (WHERE first_outbound_at IS NOT NULL AND first_outbound_at >= first_inbound_at) AS med
    FROM eps GROUP BY d
  )
  SELECT days.d,
    COALESCE(p.m_in, 0), COALESCE(p.m_out, 0), COALESCE(e.n, 0),
    COALESCE(p.s_agent, 0), COALESCE(p.s_team, 0), COALESCE(p.s_auto, 0), COALESCE(p.s_ext, 0),
    -- Sin episodios ese dia la mediana es NULL, no 0: "no sabemos" y "cero
    -- segundos" son afirmaciones distintas.
    e.med
  FROM days
  LEFT JOIN per_day p ON p.d = days.d
  LEFT JOIN eps_day e ON e.d = days.d
  ORDER BY days.d;
$$;

COMMENT ON FUNCTION public.chat_dashboard_trends(uuid, timestamptz, timestamptz, text, text, text) IS
  'Serie diaria densa (todos los dias del periodo) con recibidos, enviados, enviados por grupo de autor, conversaciones nuevas y la mediana diaria de primera respuesta. La app agrupa a semanal si el periodo pasa de 62 dias.';

-- ------------------------------------------------------------
-- 13. Permisos
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.chat_origin_group(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chat_agent_episode_flags(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chat_dashboard_agent(uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chat_dashboard_agent_weekly(uuid, text, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chat_dashboard_first_responder(uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chat_dashboard_escalation_reasons(uuid, timestamptz, timestamptz, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chat_dashboard_agent_actions(uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chat_dashboard_rule_results(uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chat_dashboard_drafts(uuid, timestamptz, timestamptz, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chat_dashboard_team(uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chat_dashboard_numbers(uuid, timestamptz, timestamptz, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chat_dashboard_trends(uuid, timestamptz, timestamptz, text, text, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.chat_origin_group(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_agent_episode_flags(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_dashboard_agent(uuid, timestamptz, timestamptz, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_dashboard_agent_weekly(uuid, text, text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_dashboard_first_responder(uuid, timestamptz, timestamptz, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_dashboard_escalation_reasons(uuid, timestamptz, timestamptz, text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_dashboard_agent_actions(uuid, timestamptz, timestamptz, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_dashboard_rule_results(uuid, timestamptz, timestamptz, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_dashboard_drafts(uuid, timestamptz, timestamptz, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_dashboard_team(uuid, timestamptz, timestamptz, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_dashboard_numbers(uuid, timestamptz, timestamptz, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_dashboard_trends(uuid, timestamptz, timestamptz, text, text, text) TO authenticated, service_role;

-- ============================================================
-- MIGRATION 111: MESSAGE PATTERNS V2
-- ============================================================
-- ============================================================================
-- 00111 — Patrones de mensajes, segunda vuelta (Bloque 4: F21, F22; Bloque 5: F25)
-- ============================================================================
-- La 00079 dejo la agrupacion y una funcion que la pantalla no alcanza a usar:
--
--   1. No recibia canal ni autor, asi que la seccion Patrones ignoraba los dos
--      filtros de arriba: el dashboard decia "filtrado por Sofia" y los patrones
--      mostraban los de todos.
--   2. No devolvia el `text_id` de cada variante, y sin el id no se puede mover
--      un texto de categoria: "Mover a…" no se podia conectar.
--   3. No habia forma de saber que le responden a cada categoria (§11.7).
--
-- Se reemplaza la funcion con el MISMO nombre y se borra la firma vieja: dos
-- sobrecargas que solo difieren en parametros con default dejan a PostgREST sin
-- poder elegir ("Could not choose the best candidate function").
--
-- Todas SECURITY INVOKER: la RLS de messages acota a un Member a su scope.
-- Idempotente.
-- ============================================================================

-- ------------------------------------------------------------
-- 1. Lo que mas se envia / lo que mas responden
-- ------------------------------------------------------------
-- Se borra por NOMBRE y no por firma, y ademas se borran TODAS las sobrecargas:
-- dos versiones que solo difieren en parametros con default dejan a PostgREST
-- sin poder elegir ("Could not choose the best candidate function").
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'chat_dashboard_patterns'
  LOOP
    EXECUTE 'DROP FUNCTION ' || r.sig;
  END LOOP;
END $$;

CREATE FUNCTION public.chat_dashboard_patterns(
  p_workspace_id uuid,
  p_direction text,
  p_from timestamptz,
  p_to timestamptz,
  p_channel text DEFAULT NULL,
  p_author text DEFAULT NULL
)
RETURNS TABLE (
  category_id uuid,
  category_name text,
  description text,
  is_fallback boolean,
  message_count bigint,
  text_count bigint,
  top_author text,
  reply_rate numeric,
  rank integer,
  top_variants jsonb
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  WITH msgs AS (
    SELECT
      m.id, m.text, m.text_norm, m.conversation_id, m.created_at,
      CASE
        WHEN m.origin = 'user' THEN COALESCE(m.sent_by_user_id::text, 'user')
        ELSE public.chat_origin_group(m.origin)
      END AS author
    FROM public.messages m
    JOIN public.conversations c ON c.id = m.conversation_id
    WHERE m.workspace_id = p_workspace_id
      AND m.direction = p_direction
      AND m.text_norm IS NOT NULL
      AND c.deleted_at IS NULL
      AND (p_channel IS NULL OR c.channel_id::text = p_channel OR c.platform = p_channel)
      AND (p_from IS NULL OR m.created_at >= p_from)
      AND (p_to IS NULL OR m.created_at <= p_to)
      -- El filtro de autor solo tiene sentido sobre los salientes: un mensaje
      -- del lead no lo "respondio" nadie.
      AND (p_direction <> 'outbound' OR public.chat_author_match(p_author, m.origin, m.sent_by_user_id))
  ),
  replied AS (
    -- §11.7: un saliente "obtuvo respuesta" si el lead escribio algo en las 24 h
    -- siguientes, en la misma conversacion.
    SELECT o.text_norm,
           COUNT(*) AS n,
           COUNT(*) FILTER (WHERE p_direction = 'outbound' AND EXISTS (
             SELECT 1 FROM public.messages i
             WHERE i.conversation_id = o.conversation_id
               AND i.direction = 'inbound'
               AND i.created_at > o.created_at
               AND i.created_at <= o.created_at + interval '24 hours'
           )) AS n_replied
    FROM msgs o
    GROUP BY o.text_norm
  ),
  texts AS (
    SELECT t.id, t.category_id, t.normalized_text, t.sample_text, t.confidence, t.source, t.is_button,
           COALESCE(r.n, 0) AS msg_n,
           COALESCE(r.n_replied, 0) AS msg_replied
    FROM public.message_texts t
    LEFT JOIN replied r ON r.text_norm = t.normalized_text
    WHERE t.workspace_id = p_workspace_id AND t.direction = p_direction
  ),
  cat_author AS (
    -- El autor principal de la categoria: quien manda mas mensajes de ese grupo.
    SELECT category_id, author, n,
           ROW_NUMBER() OVER (PARTITION BY category_id ORDER BY n DESC, author) AS rn
    FROM (
      SELECT t.category_id, m.author, COUNT(*) AS n
      FROM msgs m
      JOIN texts t ON t.normalized_text = m.text_norm
      WHERE m.author IS NOT NULL
      GROUP BY t.category_id, m.author
    ) x
  )
  SELECT
    c.id, c.name, c.description, c.is_fallback,
    COALESCE(SUM(t.msg_n), 0)::bigint AS message_count,
    -- Variantes CON volumen en el periodo: contar las que no aparecieron seria
    -- decir "8 variantes" de algo que este mes se escribio de dos formas.
    COUNT(t.id) FILTER (WHERE t.msg_n > 0)::bigint AS text_count,
    (SELECT ca.author FROM cat_author ca WHERE ca.category_id = c.id AND ca.rn = 1) AS top_author,
    CASE WHEN p_direction = 'outbound'
      THEN ROUND(100.0 * SUM(t.msg_replied) / NULLIF(SUM(t.msg_n), 0), 1)
    END AS reply_rate,
    ROW_NUMBER() OVER (ORDER BY COALESCE(SUM(t.msg_n), 0) DESC, c.name)::integer AS rank,
    COALESCE((
      SELECT jsonb_agg(v ORDER BY n DESC) FROM (
        SELECT jsonb_build_object(
                 'text_id', t2.id,
                 'text', t2.sample_text,
                 'count', t2.msg_n,
                 'confidence', t2.confidence,
                 'source', t2.source,
                 'is_button', t2.is_button,
                 'reply_rate', CASE WHEN p_direction = 'outbound'
                   THEN ROUND(100.0 * t2.msg_replied / NULLIF(t2.msg_n, 0), 1) END,
                 -- "Tambien: …": otras escrituras que la normalizacion junto en
                 -- esta misma fila. Sin esto parece que se escribio siempre igual.
                 'also_spellings', COALESCE((
                   SELECT jsonb_agg(sp.txt ORDER BY sp.n DESC) FROM (
                     SELECT m2.text AS txt, COUNT(*) AS n
                     FROM msgs m2
                     WHERE m2.text_norm = t2.normalized_text
                       AND m2.text IS DISTINCT FROM t2.sample_text
                       -- Un mensaje sin texto (solo un adjunto) comparte el
                       -- normalizado vacio con otros: sin esto, "También: …"
                       -- salia con un null y una cadena vacia adentro.
                       AND m2.text IS NOT NULL
                       AND btrim(m2.text) <> ''
                     GROUP BY m2.text
                     ORDER BY COUNT(*) DESC
                     LIMIT 3
                   ) sp
                 ), '[]'::jsonb)
               ) AS v,
               t2.msg_n AS n
        FROM texts t2
        WHERE t2.category_id IS NOT DISTINCT FROM c.id AND t2.msg_n > 0
        ORDER BY t2.msg_n DESC
        LIMIT 5
      ) top
    ), '[]'::jsonb) AS top_variants
  FROM public.message_categories c
  LEFT JOIN texts t ON t.category_id = c.id
  WHERE c.workspace_id = p_workspace_id AND c.direction = p_direction AND c.archived_at IS NULL
  GROUP BY c.id, c.name, c.description, c.is_fallback
  ORDER BY COALESCE(SUM(t.msg_n), 0) DESC, c.name;
$$;

COMMENT ON FUNCTION public.chat_dashboard_patterns(uuid, text, timestamptz, timestamptz, text, text) IS
  'Categorias con su volumen de MENSAJES (no de textos distintos), autor principal, % que obtuvo respuesta (§11.7) y hasta 5 variantes con su text_id (para "Mover a…"). Respeta los filtros de canal y autor.';

-- ------------------------------------------------------------
-- 2. Que le responden a una categoria (§11.7)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chat_dashboard_replies(
  p_workspace_id uuid,
  p_category_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_channel text DEFAULT NULL
)
RETURNS TABLE (
  reply_category_id uuid,
  reply_category_name text,
  reply_is_fallback boolean,
  replies bigint,
  pct_of_replies numeric,
  outbound_total bigint,
  outbound_with_reply bigint
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  WITH cat_texts AS (
    SELECT normalized_text FROM public.message_texts
    WHERE workspace_id = p_workspace_id AND direction = 'outbound' AND category_id = p_category_id
  ),
  outs AS (
    SELECT m.id, m.conversation_id, m.created_at
    FROM public.messages m
    JOIN public.conversations c ON c.id = m.conversation_id
    WHERE m.workspace_id = p_workspace_id AND m.direction = 'outbound'
      AND c.deleted_at IS NULL
      AND m.text_norm IN (SELECT normalized_text FROM cat_texts)
      AND (p_from IS NULL OR m.created_at >= p_from)
      AND (p_to IS NULL OR m.created_at <= p_to)
      AND (p_channel IS NULL OR c.channel_id::text = p_channel OR c.platform = p_channel)
  ),
  first_in AS (
    -- El PRIMER entrante despues de cada saliente, dentro de 24 h.
    SELECT o.id, fi.text_norm
    FROM outs o
    LEFT JOIN LATERAL (
      SELECT i.text_norm
      FROM public.messages i
      WHERE i.conversation_id = o.conversation_id
        AND i.direction = 'inbound'
        AND i.created_at > o.created_at
        AND i.created_at <= o.created_at + interval '24 hours'
      ORDER BY i.created_at
      LIMIT 1
    ) fi ON true
  ),
  totals AS (
    SELECT COUNT(*) AS total, COUNT(text_norm) AS with_reply FROM first_in
  ),
  grouped AS (
    SELECT it.category_id, COUNT(*) AS n
    FROM first_in f
    LEFT JOIN public.message_texts it
      ON it.workspace_id = p_workspace_id AND it.direction = 'inbound' AND it.normalized_text = f.text_norm
    WHERE f.text_norm IS NOT NULL
    GROUP BY it.category_id
  )
  SELECT
    g.category_id,
    -- Sin categoria todavia: se dice, no se esconde ni se cuenta como otra cosa.
    COALESCE(c.name, 'Sin clasificar todavía'),
    COALESCE(c.is_fallback, false),
    g.n,
    ROUND(100.0 * g.n / NULLIF((SELECT with_reply FROM totals), 0), 1),
    (SELECT total FROM totals),
    (SELECT with_reply FROM totals)
  FROM grouped g
  LEFT JOIN public.message_categories c ON c.id = g.category_id
  ORDER BY g.n DESC;
$$;

COMMENT ON FUNCTION public.chat_dashboard_replies(uuid, uuid, timestamptz, timestamptz, text) IS
  'Que le responden a una categoria de salientes (§11.7): el primer entrante dentro de 24 h, agrupado por su categoria. outbound_total y outbound_with_reply van en cada fila para calcular el "% no respondio" exacto.';

-- ------------------------------------------------------------
-- 3. Textos con su volumen (entrada de la calidad de la clasificacion)
-- ------------------------------------------------------------
-- `lib/patterns/quality.ts` necesita el volumen de MENSAJES de cada texto: "sin
-- categoria" se mide sobre cuantos mensajes quedaron afuera, no sobre cuantos
-- textos distintos (§13.3). Dos textos raros no son lo mismo que doscientos
-- mensajes sin clasificar.
CREATE OR REPLACE FUNCTION public.message_text_volumes(
  p_workspace_id uuid,
  p_direction text DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
)
RETURNS TABLE (
  text_id uuid,
  direction text,
  category_id uuid,
  source text,
  confidence numeric,
  review_result text,
  is_button boolean,
  prompt_version integer,
  classified_at timestamptz,
  reviewed_at timestamptz,
  sample_text text,
  message_count bigint
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  WITH counts AS (
    SELECT m.text_norm, m.direction, COUNT(*) AS n
    FROM public.messages m
    WHERE m.workspace_id = p_workspace_id
      AND m.text_norm IS NOT NULL
      AND (p_direction IS NULL OR m.direction = p_direction)
      AND (p_from IS NULL OR m.created_at >= p_from)
      AND (p_to IS NULL OR m.created_at <= p_to)
    GROUP BY m.text_norm, m.direction
  )
  SELECT t.id, t.direction, t.category_id, t.source, t.confidence, t.review_result,
         t.is_button, t.prompt_version, t.classified_at, t.reviewed_at, t.sample_text,
         COALESCE(c.n, 0)::bigint
  FROM public.message_texts t
  LEFT JOIN counts c ON c.text_norm = t.normalized_text AND c.direction = t.direction
  WHERE t.workspace_id = p_workspace_id
    AND (p_direction IS NULL OR t.direction = p_direction);
$$;

COMMENT ON FUNCTION public.message_text_volumes(uuid, text, timestamptz, timestamptz) IS
  'Cada texto distinto con su volumen de mensajes en el periodo. Es la entrada de qualityReport(): "sin categoria" se mide sobre mensajes, no sobre textos.';

-- ------------------------------------------------------------
-- 4. Estado de la clasificacion (la linea de calidad y la pantalla de Tareas)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.message_classification_status(
  p_workspace_id uuid,
  p_tz text DEFAULT 'America/Costa_Rica'
)
RETURNS TABLE (
  last_run_at timestamptz,
  last_run_status text,
  last_run_detail text,
  texts_classified_today bigint,
  unclassified_pending bigint,
  active_prompt_version integer
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT
    r.completed_at,
    r.status,
    r.status_detail,
    (SELECT COUNT(*) FROM public.message_texts t
      WHERE t.workspace_id = p_workspace_id
        AND t.classified_at >= (date_trunc('day', (now() AT TIME ZONE p_tz)) AT TIME ZONE p_tz)),
    -- La misma condicion que usa el clasificador para elegir pendientes
    -- (lib/patterns/classifier.ts): si esta cambia, se pisa trabajo humano.
    (SELECT COUNT(*) FROM public.message_texts t
      WHERE t.workspace_id = p_workspace_id AND t.category_id IS NULL AND t.source IS NULL),
    (SELECT MAX(t.prompt_version) FROM public.message_texts t
      WHERE t.workspace_id = p_workspace_id AND t.source = 'model')
  FROM (
    SELECT completed_at, status, status_detail
    FROM public.agent_runs
    WHERE workspace_id = p_workspace_id AND source = 'message_classification'
    ORDER BY created_at DESC
    LIMIT 1
  ) r
  RIGHT JOIN (SELECT 1) one ON true;
$$;

COMMENT ON FUNCTION public.message_classification_status(uuid, text) IS
  'Ultima corrida del clasificador, textos clasificados hoy y cuantos quedan sin clasificar. Un Member ve la corrida en NULL: la RLS de agent_runs le muestra solo runs con conversacion, y el clasificador no tiene ninguna.';

-- ------------------------------------------------------------
-- 5. Permisos
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.chat_dashboard_patterns(uuid, text, timestamptz, timestamptz, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chat_dashboard_replies(uuid, uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.message_text_volumes(uuid, text, timestamptz, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.message_classification_status(uuid, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.chat_dashboard_patterns(uuid, text, timestamptz, timestamptz, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_dashboard_replies(uuid, uuid, timestamptz, timestamptz, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.message_text_volumes(uuid, text, timestamptz, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.message_classification_status(uuid, text) TO authenticated, service_role;

-- ============================================================
-- MIGRATION 112: AI SPEND BY DAY
-- ============================================================
-- ============================================================================
-- 00112 — Gasto de IA por dia y dispersion de corridas (Bloque A, A1)
-- ============================================================================
-- Las dos consultas que le faltan al mini dashboard de Agentes. Todo lo demas
-- ya existe: agent_runs, agent_run_steps y model_pricing (00059), los
-- privilegios de columna (00060), sum_ai_spend (00064) y ai_cost_report
-- (00069, redefinida en la 00071). ai_cost_report da totales y desgloses por
-- dimension, pero ni una serie temporal: no habia NINGUNA funcion que agrupara
-- cost_usd por fecha.
--
-- Van en SQL y no en la app por los dos motivos de siempre:
--   - PostgREST devuelve como maximo 1.000 filas, y una serie armada del lado
--     de la app con mas corridas que eso da un gasto por debajo del real.
--   - cost_usd y los tokens NO son legibles por `authenticated` (00060): ni un
--     Owner los puede leer con su propio cliente. Solo service role, detras de
--     un guard en TypeScript, igual que sum_ai_spend y ai_cost_report.
--
-- 1. ai_spend_by_day: serie DENSA por dia y origen. Un dia sin corridas vale
--    cero y aparece en su lugar: si faltara, el grafico mentiria la forma (el
--    mismo problema que resolvio la 00110 para las tendencias del Chat). Los
--    origenes salen de los DATOS del rango, no de la lista del CHECK: hay un
--    valor (message_classification_eval) que nadie escribe y apareceria
--    siempre vacio.
--
-- 2. ai_runs_scatter: filas, no agregados, para la dispersion costo/tiempo.
--    Con mas de p_limit corridas se muestrea, pero las de error y las
--    escaladas se conservan TODAS: una dispersion que esconde los errores no
--    sirve para nada. El muestreo es deterministico (una de cada N, pareja en
--    el tiempo): recargar la pantalla no cambia el grafico.
--
-- Las dos, como ai_cost_report:
--   - rango semiabierto [p_from, p_to): la suma de las barras coincide con el
--     total del periodo que da ai_cost_report con el mismo rango;
--   - p_from NULL = desde la primera corrida (el atajo "historico"); p_to
--     NULL = sin techo;
--   - las corridas `running` no entran: todavia no tienen costo;
--   - cost_usd NULL (modelo sin precio) suma 0 y la corrida se cuenta igual.
--     ai_spend_by_day la cuenta ademas en missing_pricing, con la misma
--     definicion que ai_cost_report, para que la pantalla lo avise.
--
-- No altera ninguna tabla ni agrega ningun GRANT de columna: solo funciones.
-- Volver atras:
--   DROP FUNCTION IF EXISTS public.ai_spend_by_day(uuid, timestamptz, timestamptz, text);
--   DROP FUNCTION IF EXISTS public.ai_runs_scatter(uuid, timestamptz, timestamptz, integer);
--
-- Idempotente.
-- ============================================================================

-- ------------------------------------------------------------
-- 1. ai_spend_by_day
-- ------------------------------------------------------------
-- Devuelve [{ day: 'YYYY-MM-DD', source, runs, cost_usd, input_tokens,
-- output_tokens, missing_pricing }], un elemento por dia del rango y por cada
-- origen con al menos una corrida en el rango, ordenado por dia y origen.
-- Si el rango no tiene ninguna corrida, devuelve un elemento por dia con
-- source = null y todo en cero: los dias siguen ahi.
CREATE OR REPLACE FUNCTION public.ai_spend_by_day(
  p_workspace_id uuid,
  p_from         timestamptz,
  p_to           timestamptz,
  p_tz           text
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  WITH r AS (
    SELECT
      (created_at AT TIME ZONE p_tz)::date AS d,
      source,
      cost_usd,
      input_tokens,
      output_tokens,
      embedding_tokens
    FROM public.agent_runs
    WHERE workspace_id = p_workspace_id
      AND (p_from IS NULL OR created_at >= p_from)
      AND (p_to IS NULL OR created_at < p_to)
      AND status <> 'running'
  ),
  bounds AS (
    SELECT
      COALESCE((p_from AT TIME ZONE p_tz)::date, (SELECT min(d) FROM r)) AS d0,
      -- No hay corridas en el futuro: el ultimo dia es hoy aunque el rango
      -- siga ("este mes" no dibuja los dias que faltan). p_to es abierto: el
      -- ultimo dia es el del instante anterior, asi un p_to justo a la
      -- medianoche no agrega un dia de largo cero al final.
      LEAST(
        COALESCE(((p_to - interval '1 microsecond') AT TIME ZONE p_tz)::date, (now() AT TIME ZONE p_tz)::date),
        (now() AT TIME ZONE p_tz)::date
      ) AS d1
  ),
  days AS (
    -- Todos los dias del periodo, tengan o no corridas.
    SELECT generate_series(d0::timestamp, d1::timestamp, interval '1 day')::date AS d
    FROM bounds
    WHERE d0 IS NOT NULL AND d1 >= d0
  ),
  sources AS (
    SELECT DISTINCT source FROM r
    UNION ALL
    SELECT NULL::text WHERE NOT EXISTS (SELECT 1 FROM r)
  ),
  agg AS (
    SELECT
      d,
      source,
      count(*) AS runs,
      COALESCE(sum(cost_usd), 0) AS cost_usd,
      COALESCE(sum(input_tokens), 0) AS input_tokens,
      COALESCE(sum(output_tokens), 0) AS output_tokens,
      count(*) FILTER (
        WHERE cost_usd IS NULL
          AND (COALESCE(input_tokens, 0) > 0 OR COALESCE(embedding_tokens, 0) > 0)
      ) AS missing_pricing
    FROM r
    GROUP BY d, source
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'day',             to_char(days.d, 'YYYY-MM-DD'),
        'source',          s.source,
        'runs',            COALESCE(a.runs, 0),
        'cost_usd',        COALESCE(a.cost_usd, 0),
        'input_tokens',    COALESCE(a.input_tokens, 0),
        'output_tokens',   COALESCE(a.output_tokens, 0),
        'missing_pricing', COALESCE(a.missing_pricing, 0)
      )
      ORDER BY days.d, s.source
    ),
    '[]'::jsonb
  )
  FROM days
  CROSS JOIN sources s
  LEFT JOIN agg a ON a.d = days.d AND a.source IS NOT DISTINCT FROM s.source;
$$;

COMMENT ON FUNCTION public.ai_spend_by_day(uuid, timestamptz, timestamptz, text) IS
  'Serie densa de gasto de IA por dia (en la zona p_tz) y origen, con los dias sin corridas en cero. Rango [p_from, p_to), sin corridas running. Solo service role.';

-- ------------------------------------------------------------
-- 2. ai_runs_scatter
-- ------------------------------------------------------------
-- Devuelve [{ id, created_at, source, status, cost_usd, latency_ms,
-- input_tokens, total_tokens, conversation_id }] ordenado por created_at.
-- total_tokens suma entrada, salida, cache y embeddings: es el radio del
-- punto, y una corrida de embeddings solo tiene embedding_tokens.
-- Cuantas corridas habia en total lo sabe la pantalla por ai_cost_report
-- (totals.runs, mismo rango): si es mas que el largo de esto, hubo muestreo.
CREATE OR REPLACE FUNCTION public.ai_runs_scatter(
  p_workspace_id uuid,
  p_from         timestamptz,
  p_to           timestamptz,
  p_limit        integer DEFAULT 500
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  WITH r AS (
    SELECT
      id, created_at, source, status, cost_usd, latency_ms, input_tokens,
      COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)
        + COALESCE(cached_tokens, 0) + COALESCE(embedding_tokens, 0) AS total_tokens,
      conversation_id,
      status IN ('error', 'escalated') AS keep
    FROM public.agent_runs
    WHERE workspace_id = p_workspace_id
      AND (p_from IS NULL OR created_at >= p_from)
      AND (p_to IS NULL OR created_at < p_to)
      AND status <> 'running'
  ),
  quota AS (
    -- Lugar que queda para las que salieron bien despues de conservar todas
    -- las de error y escaladas. Si esas solas pasan p_limit, van igual.
    SELECT
      GREATEST(GREATEST(COALESCE(p_limit, 500), 0) - count(*) FILTER (WHERE keep), 0) AS slots,
      count(*) FILTER (WHERE NOT keep) AS n_ok
    FROM r
  ),
  ok AS (
    SELECT r.*, row_number() OVER (ORDER BY created_at, id) AS rn
    FROM r
    WHERE NOT keep
  ),
  picked AS (
    SELECT id, created_at, source, status, cost_usd, latency_ms, input_tokens, total_tokens, conversation_id
    FROM r
    WHERE keep
    UNION ALL
    -- Una de cada ceil(n_ok / slots), en orden de tiempo: a lo sumo `slots`
    -- filas, repartidas parejo sobre el periodo.
    SELECT ok.id, ok.created_at, ok.source, ok.status, ok.cost_usd, ok.latency_ms,
           ok.input_tokens, ok.total_tokens, ok.conversation_id
    FROM ok, quota q
    WHERE q.n_ok <= q.slots
       OR (q.slots > 0 AND (ok.rn - 1) % ceil(q.n_ok::numeric / q.slots)::bigint = 0)
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id',              id,
        'created_at',      created_at,
        'source',          source,
        'status',          status,
        'cost_usd',        cost_usd,
        'latency_ms',      latency_ms,
        'input_tokens',    input_tokens,
        'total_tokens',    total_tokens,
        'conversation_id', conversation_id
      )
      ORDER BY created_at, id
    ),
    '[]'::jsonb
  )
  FROM picked;
$$;

COMMENT ON FUNCTION public.ai_runs_scatter(uuid, timestamptz, timestamptz, integer) IS
  'Corridas de IA de un rango [p_from, p_to) para la dispersion costo/tiempo. Con mas de p_limit, conserva todas las de error y escaladas y muestrea las demas, parejo en el tiempo y de forma deterministica. Solo service role.';

-- ------------------------------------------------------------
-- 3. Permisos: solo service role, como sum_ai_spend y ai_cost_report
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.ai_spend_by_day(uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_spend_by_day(uuid, timestamptz, timestamptz, text) TO service_role;

REVOKE ALL ON FUNCTION public.ai_runs_scatter(uuid, timestamptz, timestamptz, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_runs_scatter(uuid, timestamptz, timestamptz, integer) TO service_role;

-- ============================================================
-- MIGRATION 113: COMMENT POST AND PROFILE RLS
-- ============================================================
-- 00113: comentarios con su publicacion en la red, error de perfil y lectura
-- de metricas por permiso (Contenido v3, B10: F76, F75, F78).
--
-- Aditiva e idempotente: no borra ni modifica datos existentes.
--
-- 1. social_post_comments.external_post_id: el id del post en la red. Sin
--    esto los comentarios que llegaron antes de tener la cuenta social no se
--    pueden vincular despues (F76). Los 167 actuales quedan en null.
-- 2. social_accounts.profile_sync_error: el error de la ultima lectura de
--    perfil. Antes se sellaba profile_synced_at aunque la lectura fallara y
--    el error solo iba al log (F75).
-- 3. Lectura de metricas y comentarios: pasa de "solo admins" a los permisos
--    social.view y dashboards.content.view (F78). has_permission devuelve
--    true para owner y admin, asi que no les quita nada. meta_ads_insights_daily
--    no se toca: sigue con su regla propia.

ALTER TABLE public.social_post_comments
  ADD COLUMN IF NOT EXISTS external_post_id text;

CREATE INDEX IF NOT EXISTS idx_post_comments_external_post
  ON public.social_post_comments (workspace_id, platform, external_post_id)
  WHERE external_post_id IS NOT NULL;

ALTER TABLE public.social_accounts
  ADD COLUMN IF NOT EXISTS profile_sync_error text;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'social_post_metrics_daily',
    'social_account_metrics_daily',
    'social_post_comments'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%1$s_select_admin" ON public.%1$I', t);
    EXECUTE format('DROP POLICY IF EXISTS "%1$s_select_permission" ON public.%1$I', t);
    EXECUTE format(
      'CREATE POLICY "%1$s_select_permission" ON public.%1$I
         FOR SELECT TO authenticated
         USING (
           public.has_permission(workspace_id, ''social.view'')
           OR public.has_permission(workspace_id, ''dashboards.content.view'')
         )',
      t
    );
  END LOOP;
END $$;

-- ============================================================
-- MIGRATION 114: CONTACT TOUCHES
-- ============================================================
-- 00114: la tabla de toques de atribucion (Contenido v3, B11: F82, F83).
--
-- Un "toque" es una interaccion atribuible de un contacto: su primer DM, un
-- comentario en una publicacion, una reserva, un alta manual. Se guardan TODOS,
-- no solo dos fotos, porque guardar solo "primero" y "ultimo" pierde el camino
-- entero. `contacts.attribution` conserva `first_touch` y `last_touch` como una
-- copia derivada, para que la ficha y los filtros no hagan JOIN.
--
-- Aditiva e idempotente: no toca ningun dato existente.
--
-- La escribe SOLO el servidor (`record_contact_touch`, service_role). Los
-- usuarios leen: un Member ve los toques de los contactos que ya puede ver,
-- porque la subconsulta a `contacts` hereda su scope de leads (misma tecnica
-- que `contact_notes`).

CREATE TABLE IF NOT EXISTS public.contact_touches (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  contact_id      uuid        NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  occurred_at     timestamptz NOT NULL,

  -- La taxonomia (lib/contacts/taxonomy.ts). `content_label` es el "content"
  -- de la taxonomia: el nombre se evita aca porque ya hay columnas llamadas asi.
  source          text        NOT NULL,
  medium          text,
  campaign        text,
  content_label   text,
  term            text,
  -- Un medio que no esta en la lista cerrada se guarda crudo y se marca.
  medium_raw      boolean     NOT NULL DEFAULT false,

  -- La pieza concreta, cuando se conoce.
  social_post_id  uuid        REFERENCES public.social_posts(id) ON DELETE SET NULL,
  content_post_id uuid        REFERENCES public.content_posts(id) ON DELETE SET NULL,

  -- Identificadores de anuncio.
  ad_id           text,
  adset_id        text,
  campaign_id     text,
  fbclid          text,
  gclid           text,
  ttclid          text,
  li_fat_id       text,
  ctwa_clid       text,

  -- Para cuando haya paginas y formularios propios.
  referrer_url    text,
  landing_page    text,

  -- Por que camino tecnico entro.
  origin          text        NOT NULL,
  -- El id del mensaje, del comentario, del evento o de la reserva: es lo que
  -- hace que el mismo toque llegando dos veces quede una sola vez.
  dedupe_key      text        NOT NULL,
  -- La carga original recortada a una lista blanca (nunca tokens ni secretos).
  raw             jsonb       NOT NULL DEFAULT '{}'::jsonb,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT contact_touches_origin_check
    CHECK (origin IN ('dm', 'comment', 'booking', 'form', 'manual', 'import')),
  CONSTRAINT contact_touches_source_not_empty CHECK (btrim(source) <> ''),
  CONSTRAINT uq_contact_touches_dedupe UNIQUE (workspace_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_contact_touches_contact
  ON public.contact_touches (workspace_id, contact_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_contact_touches_source_medium
  ON public.contact_touches (workspace_id, source, medium, occurred_at);
CREATE INDEX IF NOT EXISTS idx_contact_touches_social_post
  ON public.contact_touches (social_post_id) WHERE social_post_id IS NOT NULL;

-- Los filtros de la lista de contactos (por fuente y medio del PRIMER toque) y
-- los conteos por pieza de B13 y B14 leen la copia derivada en `contacts`.
CREATE INDEX IF NOT EXISTS idx_contacts_first_touch_source
  ON public.contacts (workspace_id, (attribution -> 'first_touch' ->> 'source'))
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_first_touch_medium
  ON public.contacts (workspace_id, (attribution -> 'first_touch' ->> 'medium'))
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_first_touch_content_post
  ON public.contacts (workspace_id, (attribution -> 'first_touch' ->> 'content_post_id'))
  WHERE deleted_at IS NULL AND (attribution -> 'first_touch') ? 'content_post_id';

DROP TRIGGER IF EXISTS set_updated_at ON public.contact_touches;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.contact_touches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- RLS: lee quien ve al contacto; nadie escribe desde el cliente.
ALTER TABLE public.contact_touches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contact_touches_select" ON public.contact_touches;
CREATE POLICY "contact_touches_select" ON public.contact_touches
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.id = contact_touches.contact_id
        AND c.workspace_id = contact_touches.workspace_id
    )
  );

REVOKE ALL ON public.contact_touches FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.contact_touches FROM authenticated;

-- El toque tal como se guarda en `contacts.attribution`. Un solo lugar para el
-- formato, porque lo usan la funcion de abajo y el backfill de la 00115.
CREATE OR REPLACE FUNCTION public.contact_touch_json(t public.contact_touches)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'occurred_at',     t.occurred_at,
    'source',          t.source,
    'medium',          t.medium,
    'campaign',        t.campaign,
    'content',         t.content_label,
    'term',            t.term,
    'medium_raw',      CASE WHEN t.medium_raw THEN true END,
    'social_post_id',  t.social_post_id,
    'content_post_id', t.content_post_id,
    'ad_id',           t.ad_id,
    'adset_id',        t.adset_id,
    'campaign_id',     t.campaign_id,
    'fbclid',          t.fbclid,
    'gclid',           t.gclid,
    'ttclid',          t.ttclid,
    'li_fat_id',       t.li_fat_id,
    'ctwa_clid',       t.ctwa_clid,
    'referrer_url',    t.referrer_url,
    'landing_page',    t.landing_page,
    'origin',          t.origin
  ))
$$;

REVOKE ALL ON FUNCTION public.contact_touch_json(public.contact_touches) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contact_touch_json(public.contact_touches) TO service_role;

-- Registra un toque y deja `first_touch` y `last_touch` bien puestos.
--
-- Idempotente por (workspace, dedupe_key): el mismo toque dos veces queda una
-- sola vez y la segunda no toca nada. `first_touch` y `last_touch` se RECALCULAN
-- desde la tabla en vez de compararse con la copia: asi un toque viejo que llega
-- tarde (una relectura) queda en su lugar y el primero sigue siendo el primero.
--
-- `contacts.attribution` se mezcla con `||`: lo que ya habia (la forma vieja de
-- clicks, o la plana del agendamiento) NO se borra.
CREATE OR REPLACE FUNCTION public.record_contact_touch(
  p_workspace_id uuid,
  p_contact_id   uuid,
  p_touch        jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id    uuid;
  v_first jsonb;
  v_last  jsonb;
BEGIN
  IF p_touch IS NULL
     OR nullif(btrim(p_touch->>'source'), '') IS NULL
     OR nullif(btrim(p_touch->>'dedupe_key'), '') IS NULL
     OR nullif(btrim(p_touch->>'origin'), '') IS NULL THEN
    RETURN jsonb_build_object('inserted', false, 'reason', 'invalid');
  END IF;

  PERFORM 1 FROM public.contacts
  WHERE id = p_contact_id AND workspace_id = p_workspace_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('inserted', false, 'reason', 'contact_not_found');
  END IF;

  INSERT INTO public.contact_touches (
    workspace_id, contact_id, occurred_at,
    source, medium, campaign, content_label, term, medium_raw,
    social_post_id, content_post_id,
    ad_id, adset_id, campaign_id, fbclid, gclid, ttclid, li_fat_id, ctwa_clid,
    referrer_url, landing_page, origin, dedupe_key, raw
  )
  VALUES (
    p_workspace_id, p_contact_id,
    coalesce((p_touch->>'occurred_at')::timestamptz, now()),
    btrim(p_touch->>'source'),
    nullif(btrim(p_touch->>'medium'), ''),
    nullif(btrim(p_touch->>'campaign'), ''),
    nullif(btrim(p_touch->>'content'), ''),
    nullif(btrim(p_touch->>'term'), ''),
    coalesce((p_touch->>'medium_raw')::boolean, false),
    -- La pieza solo se enlaza si existe Y es de este workspace: una referencia
    -- colgada o ajena no puede tumbar el registro ni filtrar datos.
    (SELECT id FROM public.social_posts
       WHERE id = nullif(p_touch->>'social_post_id', '')::uuid AND workspace_id = p_workspace_id),
    (SELECT id FROM public.content_posts
       WHERE id = nullif(p_touch->>'content_post_id', '')::uuid AND workspace_id = p_workspace_id),
    nullif(p_touch->>'ad_id', ''),
    nullif(p_touch->>'adset_id', ''),
    nullif(p_touch->>'campaign_id', ''),
    nullif(p_touch->>'fbclid', ''),
    nullif(p_touch->>'gclid', ''),
    nullif(p_touch->>'ttclid', ''),
    nullif(p_touch->>'li_fat_id', ''),
    nullif(p_touch->>'ctwa_clid', ''),
    nullif(p_touch->>'referrer_url', ''),
    nullif(p_touch->>'landing_page', ''),
    btrim(p_touch->>'origin'),
    btrim(p_touch->>'dedupe_key'),
    coalesce(p_touch->'raw', '{}'::jsonb)
  )
  ON CONFLICT (workspace_id, dedupe_key) DO NOTHING
  RETURNING id INTO v_id;

  -- Ya estaba: no hay nada que recalcular ni que escribir.
  IF v_id IS NULL THEN
    RETURN jsonb_build_object('inserted', false, 'reason', 'duplicate');
  END IF;

  SELECT public.contact_touch_json(t) INTO v_first
  FROM public.contact_touches t
  WHERE t.contact_id = p_contact_id
  ORDER BY t.occurred_at ASC, t.created_at ASC, t.id ASC
  LIMIT 1;

  SELECT public.contact_touch_json(t) INTO v_last
  FROM public.contact_touches t
  WHERE t.contact_id = p_contact_id
  ORDER BY t.occurred_at DESC, t.created_at DESC, t.id DESC
  LIMIT 1;

  UPDATE public.contacts
  SET attribution = coalesce(attribution, '{}'::jsonb)
        || jsonb_build_object('version', 2, 'first_touch', v_first, 'last_touch', v_last)
  WHERE id = p_contact_id;

  RETURN jsonb_build_object('inserted', true, 'touch_id', v_id);
END;
$$;

REVOKE ALL ON FUNCTION public.record_contact_touch(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_contact_touch(uuid, uuid, jsonb) TO service_role;

COMMENT ON TABLE public.contact_touches IS
  'Cada interaccion atribuible de un contacto (F82). Solo la escribe el servidor.';

-- ============================================================
-- MIGRATION 115: ATTRIBUTION V2 AND BACKFILL
-- ============================================================
-- 00115: atribucion v2 y el backfill de los contactos existentes (Contenido v3,
-- B11: F84, F87).
--
-- Aditiva con backfill. Escribe SOLO donde `contacts.attribution` esta vacio:
-- nunca pisa un valor. Idempotente: correrla dos veces no duplica toques.
--
-- 1. `create_booking` es la de la 00099 LETRA POR LETRA, con un unico agregado:
--    despues de crear la reserva registra el toque (medium `booking`). El resto
--    de la funcion, incluida la atribucion plana del contacto nuevo, no cambia:
--    esa plana es la que lee el trigger de alta y sigue diciendo 'scheduling'.
--    La definicion anterior esta completa en `00099_bookings.sql` por si hace
--    falta volver atras.
-- 2. Los dos triggers de la 00039 leen `first_touch.source` con respaldo en la
--    clave plana `source`, asi un contacto viejo emite lo mismo que antes.
-- 3. Backfill: un toque por cada evento `contact_created`, con la fuente que
--    tenia el evento o, si no la traia, la del canal de la primera conversacion.

-- ---------------------------------------------------------------------------
-- 1. create_booking: la de la 00099 + el toque
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_booking(
  p_workspace_id   uuid,
  p_event_type_id  uuid,
  p_host_user_id   uuid,
  p_start_at       timestamptz,
  p_end_at         timestamptz,
  p_title          text,
  p_name           text,
  p_email          text,
  p_phone          text,
  p_timezone       text,
  p_host_timezone  text,
  p_location_type  text,
  p_location_text  text,
  p_responses      jsonb,
  p_origin         text,
  p_utm            jsonb,
  p_referrer_url   text,
  p_uid            text,
  p_category_id    uuid,
  p_category_snapshot jsonb,
  p_contact_assignment text,
  p_created_by     uuid DEFAULT NULL,
  p_contact_id     uuid DEFAULT NULL,
  p_metadata       jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_contact_id   uuid := p_contact_id;
  v_created      boolean := false;
  v_booking_id   uuid;
  v_email        text := nullif(btrim(lower(p_email)), '');
  v_phone        text := nullif(btrim(p_phone), '');
  v_dnc          boolean := false;
  v_setter       uuid;
  v_vendedor     uuid;
  v_assigned     boolean := false;
BEGIN
  -- Serializa los pedidos del mismo anfitrion dentro de la transaccion.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_host_user_id::text, 0));

  -- a. El contacto. Si viene dado (agendar manual, agente), se usa tal cual.
  IF v_contact_id IS NULL THEN
    IF v_phone IS NOT NULL THEN
      SELECT id INTO v_contact_id FROM public.contacts
      WHERE workspace_id = p_workspace_id AND deleted_at IS NULL
        AND (phone = v_phone OR whatsapp_phone = v_phone)
      ORDER BY created_at ASC LIMIT 1;
    END IF;

    IF v_contact_id IS NULL AND v_email IS NOT NULL THEN
      SELECT id INTO v_contact_id FROM public.contacts
      WHERE workspace_id = p_workspace_id AND deleted_at IS NULL
        AND (lower(email) = v_email OR lower(secondary_email) = v_email)
      ORDER BY created_at ASC LIMIT 1;
    END IF;

    IF v_contact_id IS NULL THEN
      INSERT INTO public.contacts (workspace_id, display_name, email, phone, timezone, attribution, last_interaction_at)
      VALUES (
        p_workspace_id,
        nullif(btrim(p_name), ''),
        v_email,
        v_phone,
        nullif(p_timezone, ''),
        coalesce(p_utm, '{}'::jsonb) || jsonb_build_object('source', 'scheduling', 'referrer', p_referrer_url),
        now()
      )
      RETURNING id INTO v_contact_id;
      v_created := true;
    END IF;
  END IF;

  -- Completa SOLO los campos vacios: nunca pisa lo que ya hay.
  IF NOT v_created THEN
    UPDATE public.contacts
    SET display_name = coalesce(display_name, nullif(btrim(p_name), '')),
        email        = coalesce(email, v_email),
        phone        = coalesce(phone, v_phone),
        timezone     = coalesce(timezone, nullif(p_timezone, '')),
        last_interaction_at = now()
    WHERE id = v_contact_id;
  END IF;

  SELECT do_not_contact, setter_id, vendedor_id INTO v_dnc, v_setter, v_vendedor
  FROM public.contacts WHERE id = v_contact_id;

  -- b. La asignacion (F22): solo si el campo esta vacio. El UPDATE dispara el
  -- trigger de la 00039, que emite assignment_changed en automation_events.
  IF p_contact_assignment = 'setter_if_empty' AND v_setter IS NULL THEN
    UPDATE public.contacts SET setter_id = p_host_user_id WHERE id = v_contact_id;
    v_assigned := true;
  ELSIF p_contact_assignment = 'vendedor_if_empty' AND v_vendedor IS NULL THEN
    UPDATE public.contacts SET vendedor_id = p_host_user_id WHERE id = v_contact_id;
    v_assigned := true;
  END IF;

  -- c. La agenda.
  INSERT INTO public.bookings (
    workspace_id, uid, event_type_id, category_id, category_snapshot, metadata,
    host_user_id, contact_id, title, start_at, end_at, status,
    booker_name, booker_email, booker_phone, booker_timezone, host_timezone,
    location_type, location_text, responses, origin, utm, referrer_url,
    created_by, is_do_not_contact_at_booking, google_sync_status
  ) VALUES (
    p_workspace_id, p_uid, p_event_type_id, p_category_id, p_category_snapshot, coalesce(p_metadata, '{}'::jsonb),
    p_host_user_id, v_contact_id, p_title, p_start_at, p_end_at, 'scheduled',
    nullif(btrim(p_name), ''), v_email, v_phone, nullif(p_timezone, ''), nullif(p_host_timezone, ''),
    p_location_type, p_location_text, coalesce(p_responses, '{}'::jsonb), p_origin,
    coalesce(p_utm, '{}'::jsonb), p_referrer_url,
    p_created_by, coalesce(v_dnc, false), 'pending'
  )
  RETURNING id INTO v_booking_id;

  -- c2. El toque de atribucion (Contenido v3, F87). Vale para el contacto nuevo
  -- Y para el que ya existia: una reserva es una interaccion mas de esa persona.
  -- Va protegido: una falla de atribucion NUNCA puede impedir una reserva.
  BEGIN
    PERFORM public.record_contact_touch(
      p_workspace_id,
      v_contact_id,
      jsonb_build_object(
        'occurred_at',  now(),
        'source',       coalesce(nullif(lower(btrim(p_utm->>'utm_source')), ''), 'web'),
        'medium',       'booking',
        'campaign',     nullif(btrim(p_utm->>'utm_campaign'), ''),
        'content',      nullif(btrim(p_utm->>'utm_content'), ''),
        'term',         nullif(btrim(p_utm->>'utm_term'), ''),
        'fbclid',       nullif(btrim(p_utm->>'fbclid'), ''),
        'gclid',        nullif(btrim(p_utm->>'gclid'), ''),
        'referrer_url', nullif(btrim(p_referrer_url), ''),
        'origin',       'booking',
        'dedupe_key',   'booking:' || v_booking_id::text,
        'raw',          jsonb_build_object('utm', coalesce(p_utm, '{}'::jsonb), 'booking_origin', p_origin)
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'create_booking: no pude registrar el toque de atribucion: %', SQLERRM;
  END;

  -- d. El historial.
  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by)
  VALUES (
    p_workspace_id, 'booking', v_booking_id, 'booking.created',
    jsonb_build_object('start_at', p_start_at, 'end_at', p_end_at),
    jsonb_build_object('origin', p_origin, 'actor_type', CASE WHEN p_created_by IS NULL THEN 'invitee' ELSE 'user' END),
    p_created_by
  );

  -- e. El evento de automatizacion.
  INSERT INTO public.automation_events (workspace_id, event_type, contact_id, payload)
  VALUES (
    p_workspace_id, 'booking_created', v_contact_id,
    jsonb_build_object(
      'booking_id', v_booking_id,
      'event_type_id', p_event_type_id,
      'host_user_id', p_host_user_id,
      'origin', p_origin
    )
  );

  -- f. Los jobs: crear el evento en Google y avisar cuando la agenda termine.
  INSERT INTO public.scheduled_jobs (type, payload, run_at, status)
  VALUES (
    'booking_google_sync',
    jsonb_build_object('booking_id', v_booking_id, 'action', 'create', 'attempt', 0),
    now(), 'pending'
  );
  INSERT INTO public.scheduled_jobs (type, payload, run_at, status, dedupe_key)
  VALUES (
    'booking_ended',
    jsonb_build_object('booking_id', v_booking_id),
    p_end_at, 'pending', 'ended:' || v_booking_id::text || ':0'
  );

  RETURN jsonb_build_object(
    'booking_id', v_booking_id,
    'contact_id', v_contact_id,
    'created_contact', v_created,
    'assignment_changed', v_assigned,
    'do_not_contact', coalesce(v_dnc, false)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_booking(uuid, uuid, uuid, timestamptz, timestamptz, text, text, text, text, text, text, text, text, jsonb, text, jsonb, text, text, uuid, jsonb, text, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_booking(uuid, uuid, uuid, timestamptz, timestamptz, text, text, text, text, text, text, text, text, jsonb, text, jsonb, text, text, uuid, jsonb, text, uuid, uuid, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Los triggers de alta leen la forma canonica, con respaldo en la plana
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.contacts_emit_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF COALESCE(NEW.is_anonymous, false) THEN
    RETURN NEW;
  END IF;

  PERFORM public.emit_automation_event(
    NEW.workspace_id,
    'contact_created',
    NEW.id,
    jsonb_build_object(
      'source',
      COALESCE(NEW.attribution->'first_touch'->>'source', NEW.attribution->>'source', 'unknown')
    )
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.contacts_emit_deanonymized()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF COALESCE(OLD.is_anonymous, false) AND NOT COALESCE(NEW.is_anonymous, false) THEN
    PERFORM public.emit_automation_event(
      NEW.workspace_id,
      'contact_created',
      NEW.id,
      jsonb_build_object(
        'source',
        COALESCE(NEW.attribution->'first_touch'->>'source', NEW.attribution->>'source', 'unknown'),
        'deanonymized', true
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Backfill desde los eventos de alta
-- ---------------------------------------------------------------------------
-- Un toque por contacto vivo con evento `contact_created`. La fuente sale del
-- evento (`metadata.platform`) y, si el evento no la traia, del canal de la
-- primera conversacion. Si no se puede saber, NO se inventa: el contacto queda
-- sin toque.
INSERT INTO public.contact_touches (
  workspace_id, contact_id, occurred_at, source, medium, origin, dedupe_key, raw
)
SELECT
  e.workspace_id,
  e.contact_id,
  e.created_at,
  src.platform,
  'dm',
  'dm',
  'event:' || e.id::text,
  jsonb_build_object('backfill', true, 'event_id', e.id)
FROM public.analytics_events e
JOIN public.contacts c
  ON c.id = e.contact_id AND c.workspace_id = e.workspace_id AND c.deleted_at IS NULL
CROSS JOIN LATERAL (
  SELECT lower(nullif(btrim(coalesce(
    e.metadata->>'platform',
    (SELECT ch.platform
       FROM public.conversations cv
       JOIN public.channels ch ON ch.id = cv.channel_id
      WHERE cv.contact_id = e.contact_id
      ORDER BY cv.created_at ASC
      LIMIT 1)
  )), '')) AS platform
) src
WHERE e.event_type = 'contact_created'
  AND src.platform IS NOT NULL
ON CONFLICT (workspace_id, dedupe_key) DO NOTHING;

-- La copia derivada, SOLO donde la atribucion esta vacia.
WITH first_touch AS (
  SELECT DISTINCT ON (t.contact_id) t.contact_id, public.contact_touch_json(t) AS j
  FROM public.contact_touches t
  ORDER BY t.contact_id, t.occurred_at ASC, t.created_at ASC, t.id ASC
), last_touch AS (
  SELECT DISTINCT ON (t.contact_id) t.contact_id, public.contact_touch_json(t) AS j
  FROM public.contact_touches t
  ORDER BY t.contact_id, t.occurred_at DESC, t.created_at DESC, t.id DESC
)
UPDATE public.contacts c
SET attribution = jsonb_build_object('version', 2, 'first_touch', f.j, 'last_touch', l.j)
FROM first_touch f
JOIN last_touch l USING (contact_id)
WHERE c.id = f.contact_id
  AND c.attribution = '{}'::jsonb;

-- ============================================================
-- MIGRATION 116: CONTENT TAXONOMY
-- ============================================================
-- 00116: pilares, ofertas y clasificacion de ideas y piezas (Contenido v3, B12:
-- F89, F91).
--
-- Aditiva e idempotente: no borra ni modifica datos existentes. Las columnas
-- nuevas nacen vacias (salvo el pilar de las ideas que ya tenian texto, abajo).
--
-- 1. content_pillars y content_offers: listas del negocio, configurables. No se
--    borran, se ARCHIVAN: una pieza ya publicada sigue mostrando su pilar
--    aunque ya no se ofrezca en el selector. Por eso no hay policy de DELETE.
--    Leer es de todo miembro (is_workspace_member y no has_permission: la
--    funcion no conoce los permisos del Member de sistema, ver 00088);
--    escribir pide `settings.manage`.
-- 2. Clasificacion de ideas y piezas: plataformas, oferta, pilar, etapa del
--    embudo (tofu | mofu | bofu) y referencia. El formato ya existia.
-- 3. Los pilares que hoy son texto libre en content_ideas.pillar pasan a ser
--    filas de content_pillars y la idea queda apuntando a la suya.
-- 4. approve_content_idea_v2: aprobar hereda la clasificacion y las
--    plataformas. La v1 (00084) no se toca: la borra la 00118, que no se aplica.

-- ------------------------------------------------------------
-- 1. Pilares y ofertas
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.content_pillars (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name         text NOT NULL,
  color        text,
  archived_at  timestamptz,
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.content_offers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name         text NOT NULL,
  archived_at  timestamptz,
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.content_pillars IS
  'Pilares de contenido del negocio. Se archivan, nunca se borran: lo publicado sigue mostrando el suyo.';
COMMENT ON TABLE public.content_offers IS
  'Ofertas (lo que se vende) a las que apunta una idea o una pieza. Se archivan, nunca se borran.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_pillars_name_check') THEN
    ALTER TABLE public.content_pillars ADD CONSTRAINT content_pillars_name_check
      CHECK (char_length(btrim(name)) BETWEEN 1 AND 60);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_pillars_color_check') THEN
    ALTER TABLE public.content_pillars ADD CONSTRAINT content_pillars_color_check
      CHECK (color IS NULL OR color ~ '^#[0-9a-fA-F]{6}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_offers_name_check') THEN
    ALTER TABLE public.content_offers ADD CONSTRAINT content_offers_name_check
      CHECK (char_length(btrim(name)) BETWEEN 1 AND 60);
  END IF;
END $$;

-- El nombre es unico entre los NO archivados: uno archivado libera el nombre,
-- asi se puede volver a crear "Educativo" sin pelearse con el viejo.
CREATE UNIQUE INDEX IF NOT EXISTS uq_content_pillars_name
  ON public.content_pillars (workspace_id, lower(btrim(name)))
  WHERE archived_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_content_offers_name
  ON public.content_offers (workspace_id, lower(btrim(name)))
  WHERE archived_at IS NULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['content_pillars', 'content_offers'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.update_updated_at()',
      t
    );

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS "%1$s_select" ON public.%1$I', t);
    EXECUTE format(
      'CREATE POLICY "%1$s_select" ON public.%1$I FOR SELECT USING (public.is_workspace_member(workspace_id))',
      t
    );

    EXECUTE format('DROP POLICY IF EXISTS "%1$s_insert" ON public.%1$I', t);
    EXECUTE format(
      'CREATE POLICY "%1$s_insert" ON public.%1$I FOR INSERT WITH CHECK (public.has_permission(workspace_id, ''settings.manage''))',
      t
    );

    EXECUTE format('DROP POLICY IF EXISTS "%1$s_update" ON public.%1$I', t);
    EXECUTE format(
      'CREATE POLICY "%1$s_update" ON public.%1$I FOR UPDATE USING (public.has_permission(workspace_id, ''settings.manage'')) WITH CHECK (public.has_permission(workspace_id, ''settings.manage''))',
      t
    );

    -- Sin policy de DELETE, a proposito: archivar es la unica forma de sacar
    -- una fila de circulacion.
    EXECUTE format('DROP POLICY IF EXISTS "%1$s_delete" ON public.%1$I', t);
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 2. Clasificacion de ideas y piezas
-- ------------------------------------------------------------

ALTER TABLE public.content_ideas
  ADD COLUMN IF NOT EXISTS content      text,
  ADD COLUMN IF NOT EXISTS platforms    text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS offer_id     uuid REFERENCES public.content_offers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pillar_id    uuid REFERENCES public.content_pillars(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS funnel_stage text;

ALTER TABLE public.content_posts
  ADD COLUMN IF NOT EXISTS script          text,
  ADD COLUMN IF NOT EXISTS recording_notes text,
  ADD COLUMN IF NOT EXISTS offer_id        uuid REFERENCES public.content_offers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pillar_id       uuid REFERENCES public.content_pillars(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS funnel_stage    text,
  ADD COLUMN IF NOT EXISTS reference       text;

COMMENT ON COLUMN public.content_ideas.content IS
  'El texto unico de la idea (reemplaza a hook + angle + notes, que quedan sin uso hasta la 00118).';
COMMENT ON COLUMN public.content_ideas.platforms IS
  'Redes a las que apunta la idea. Es una intencion: al aprobar se heredan a la pieza.';
COMMENT ON COLUMN public.content_posts.script IS
  'El guion completo para grabar (reemplaza a copy.hook + copy.body + copy.cta).';
COMMENT ON COLUMN public.content_posts.recording_notes IS
  'Instrucciones de produccion (reemplaza a copy.recording_notes).';
COMMENT ON COLUMN public.content_posts.media IS
  'La biblioteca de la pieza: todos sus archivos, subidos una vez. Cada red elige los suyos por id en networks[].files.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_ideas_funnel_check') THEN
    ALTER TABLE public.content_ideas ADD CONSTRAINT content_ideas_funnel_check
      CHECK (funnel_stage IS NULL OR funnel_stage IN ('tofu', 'mofu', 'bofu'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_posts_funnel_check') THEN
    ALTER TABLE public.content_posts ADD CONSTRAINT content_posts_funnel_check
      CHECK (funnel_stage IS NULL OR funnel_stage IN ('tofu', 'mofu', 'bofu'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_ideas_platforms_check') THEN
    ALTER TABLE public.content_ideas ADD CONSTRAINT content_ideas_platforms_check
      CHECK (platforms <@ ARRAY['instagram', 'tiktok', 'youtube', 'linkedin', 'threads']::text[]);
  END IF;
END $$;

-- Para "cuantas piezas lo usan" (Ajustes) y para agrupar en el dashboard.
CREATE INDEX IF NOT EXISTS idx_content_posts_pillar
  ON public.content_posts (workspace_id, pillar_id) WHERE pillar_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_content_posts_offer
  ON public.content_posts (workspace_id, offer_id) WHERE offer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_content_ideas_pillar
  ON public.content_ideas (workspace_id, pillar_id) WHERE pillar_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_content_ideas_offer
  ON public.content_ideas (workspace_id, offer_id) WHERE offer_id IS NOT NULL;

-- ------------------------------------------------------------
-- 3. Los pilares que eran texto pasan a ser filas
-- ------------------------------------------------------------
-- Solo toca las columnas NUEVAS (pillar_id) y solo donde esta vacia: el texto
-- viejo de content_ideas.pillar queda como estaba hasta la 00118.

INSERT INTO public.content_pillars (workspace_id, name)
SELECT DISTINCT i.workspace_id, btrim(i.pillar)
FROM public.content_ideas i
WHERE i.pillar IS NOT NULL
  AND btrim(i.pillar) <> ''
  AND char_length(btrim(i.pillar)) <= 60
  AND NOT EXISTS (
    SELECT 1 FROM public.content_pillars p
    WHERE p.workspace_id = i.workspace_id
      AND p.archived_at IS NULL
      AND lower(btrim(p.name)) = lower(btrim(i.pillar))
  );

UPDATE public.content_ideas i
SET pillar_id = p.id
FROM public.content_pillars p
WHERE i.pillar_id IS NULL
  AND i.pillar IS NOT NULL
  AND btrim(i.pillar) <> ''
  AND p.workspace_id = i.workspace_id
  AND p.archived_at IS NULL
  AND lower(btrim(p.name)) = lower(btrim(i.pillar));

-- ------------------------------------------------------------
-- 4. Aprobar una idea hereda la clasificacion
-- ------------------------------------------------------------
-- SECURITY INVOKER, igual que la v1: las dos escrituras pasan por la RLS de
-- quien llama. Las redes de la idea entran a la pieza sin fecha ni caption:
-- elegir la red es decir "va a ir aca", no "sale tal dia" (mismo criterio que
-- createPost). El guion y las notas de grabacion arrancan vacios: el texto de
-- la idea es contexto, no el guion.

CREATE OR REPLACE FUNCTION public.approve_content_idea_v2(
  p_idea_id uuid,
  p_title   text,
  p_format  text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_idea    public.content_ideas%ROWTYPE;
  v_post_id uuid;
  v_networks jsonb;
BEGIN
  SELECT * INTO v_idea FROM public.content_ideas WHERE id = p_idea_id AND deleted_at IS NULL;

  IF v_idea.id IS NULL THEN
    RAISE EXCEPTION 'idea_no_encontrada';
  END IF;

  IF v_idea.status <> 'nueva' THEN
    RAISE EXCEPTION 'idea_ya_decidida';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'platform', p,
    'planned_at', NULL,
    'caption', NULL,
    'media', NULL,
    'cta', jsonb_build_object('type', 'none', 'keyword', NULL),
    'options', '{}'::jsonb
  ) ORDER BY ord), '[]'::jsonb)
  INTO v_networks
  FROM unnest(v_idea.platforms) WITH ORDINALITY AS u(p, ord);

  INSERT INTO public.content_posts (
    workspace_id, idea_id, title, format, reference,
    offer_id, pillar_id, funnel_stage, networks,
    status, created_by, position
  )
  VALUES (
    v_idea.workspace_id, v_idea.id, p_title, COALESCE(p_format, v_idea.format), v_idea.reference,
    v_idea.offer_id, v_idea.pillar_id, v_idea.funnel_stage, v_networks,
    'draft', auth.uid(),
    coalesce((
      SELECT max(position) + 10 FROM public.content_posts
      WHERE workspace_id = v_idea.workspace_id AND status = 'draft' AND deleted_at IS NULL
    ), 10)
  )
  RETURNING id INTO v_post_id;

  UPDATE public.content_ideas
  SET status = 'aprobada', approved_by = auth.uid(), approved_at = now()
  WHERE id = v_idea.id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'sin_permiso_para_aprobar';
  END IF;

  RETURN v_post_id;
END;
$$;

COMMENT ON FUNCTION public.approve_content_idea_v2(uuid, text, text) IS
  'Crea la pieza y marca la idea aprobada en una sola transaccion, heredando clasificacion y plataformas (F91). SECURITY INVOKER: la RLS decide si puede.';

REVOKE ALL ON FUNCTION public.approve_content_idea_v2(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_content_idea_v2(uuid, text, text) TO authenticated, service_role;

-- ============================================================
-- MIGRATION 117: CONTENT SINGLE TEXT
-- ============================================================
-- 00117: rellena el texto unico de ideas y piezas desde las columnas viejas
-- (Contenido v3, B12: F90).
--
-- Aditiva e idempotente. Solo escribe las columnas NUEVAS (content, script,
-- recording_notes) y solo donde estan vacias: nunca pisa algo que ya se haya
-- escrito con el modelo nuevo, y correrla dos veces no cambia nada. Las
-- columnas viejas (hook, angle, notes, copy) no se tocan: las borra la 00118,
-- que no se aplica.
--
-- Idea: content = hook + angulo + notas, separados por una linea en blanco y
-- salteando los que esten vacios.
-- Pieza: script = hook + desarrollo + CTA del copy; recording_notes = las
-- notas de grabacion del copy.
--
-- Hoy hay 1 idea y 1 pieza y las dos estan vacias: el backfill no toca ninguna
-- fila existente. Importa para el dia que se clone el sistema con datos.

UPDATE public.content_ideas
SET content = nullif(btrim(concat_ws(
  E'\n\n',
  nullif(btrim(hook), ''),
  nullif(btrim(angle), ''),
  nullif(btrim(notes), '')
)), '')
WHERE content IS NULL
  AND (
    nullif(btrim(hook), '') IS NOT NULL
    OR nullif(btrim(angle), '') IS NOT NULL
    OR nullif(btrim(notes), '') IS NOT NULL
  );

UPDATE public.content_posts
SET
  script = nullif(btrim(concat_ws(
    E'\n\n',
    nullif(btrim(copy ->> 'hook'), ''),
    nullif(btrim(copy ->> 'body'), ''),
    nullif(btrim(copy ->> 'cta'), '')
  )), ''),
  recording_notes = nullif(btrim(copy ->> 'recording_notes'), '')
WHERE script IS NULL
  AND recording_notes IS NULL
  AND jsonb_typeof(copy) = 'object'
  AND (
    nullif(btrim(copy ->> 'hook'), '') IS NOT NULL
    OR nullif(btrim(copy ->> 'body'), '') IS NOT NULL
    OR nullif(btrim(copy ->> 'cta'), '') IS NOT NULL
    OR nullif(btrim(copy ->> 'recording_notes'), '') IS NOT NULL
  );

-- ============================================================
-- MIGRATION 118: DROP LEGACY CONTENT COLUMNS
-- ============================================================
-- 00118: borra las columnas y la funcion que la v3 dejo sin uso (Contenido v3,
-- B12).
--
-- *** DESTRUCTIVA. NO SE APLICA CON EL RESTO DE LA TANDA. ***
-- Esta migracion esta escrita y anotada en docs/PENDIENTE.md, pero a
-- proposito NO se aplico: borra datos. Se aplica a mano, DESPUES de:
--   1. Haber visto la v3 funcionando en produccion con piezas reales.
--   2. Haber verificado que ninguna idea o pieza tiene texto SOLO en las
--      columnas viejas (la consulta de abajo tiene que dar 0 en las dos).
--   3. Tener un backup (supabase db dump) o la confirmacion de la duena del negocio.
--
-- Comprobacion previa (las dos tienen que devolver 0):
--   SELECT count(*) FROM public.content_ideas
--    WHERE content IS NULL
--      AND (nullif(btrim(hook), '') IS NOT NULL
--        OR nullif(btrim(angle), '') IS NOT NULL
--        OR nullif(btrim(notes), '') IS NOT NULL);
--   SELECT count(*) FROM public.content_posts
--    WHERE script IS NULL AND recording_notes IS NULL
--      AND copy <> '{}'::jsonb;
--
-- Las versiones viejas del historial (content_post_versions.snapshot) guardan
-- `copy` DENTRO del jsonb, no como columna: no se tocan, y el codigo las sigue
-- leyendo (lib/content/versions.ts normaliza al restaurar y al comparar).
--
-- Para volver atras esta migracion no alcanza con una inversa: las columnas se
-- recrean vacias. Por eso la comprobacion previa es obligatoria.

-- La funcion vieja recibe el copy por parametro y escribe content_posts.copy.
DROP FUNCTION IF EXISTS public.approve_content_idea(uuid, text, text, jsonb);

ALTER TABLE public.content_ideas
  DROP COLUMN IF EXISTS hook,
  DROP COLUMN IF EXISTS angle,
  DROP COLUMN IF EXISTS notes,
  DROP COLUMN IF EXISTS pillar;

ALTER TABLE public.content_posts
  DROP COLUMN IF EXISTS copy;

-- ============================================================
-- MIGRATION 119: INVITE SIGNUP NO WORKSPACE
-- ============================================================
-- ============================================================
-- 00119_invite_signup_no_workspace.sql
--
-- Hasta ahora, CUALQUIER alta en auth.users recibia un workspace propio via
-- el trigger on_auth_user_created (00001): el registro publico estaba
-- abierto en /register, asi que cualquiera terminaba con su propio negocio.
--
-- El registro publico se sacó (lib/actions/team.ts, registerFromInvite): la
-- unica forma de crear una cuenta es aceptando una invitacion. Pero el
-- trigger viejo seguia creando un workspace de mentira ANTES de que
-- registerFromInvite sumara a la persona al workspace de la invitacion, asi
-- que terminaba con DOS: el suyo, vacio, y el real.
--
-- Unico cambio sobre la 00001: si new.raw_user_meta_data trae un 'invite_id'
-- que corresponde a una invitacion PENDIENTE para ese mismo email, no se crea
-- workspace ni membership aca. El alta la termina registerFromInvite llamando
-- a finalizeAcceptInvite, que suma a la persona al workspace correcto.
--
-- Definicion vieja completa (00001), por si hay que volver atras:
--
-- create or replace function handle_new_user()
-- returns trigger as $$
-- declare
--   ws_id uuid;
--   user_name text;
--   workspace_slug text;
-- begin
--   user_name := coalesce(
--     new.raw_user_meta_data->>'full_name',
--     new.raw_user_meta_data->>'name',
--     split_part(new.email, '@', 1)
--   );
--   workspace_slug := lower(regexp_replace(user_name, '[^a-zA-Z0-9]', '-', 'g')) || '-' || substr(new.id::text, 1, 8);
--
--   insert into public.workspaces (name, slug)
--   values (user_name || '''s Workspace', workspace_slug)
--   returning id into ws_id;
--
--   insert into public.workspace_members (workspace_id, user_id, role)
--   values (ws_id, new.id, 'owner');
--
--   return new;
-- exception when others then
--   raise log 'handle_new_user error: % %', sqlerrm, sqlstate;
--   return new;
-- end;
-- $$ language plpgsql security definer set search_path = public;
-- ============================================================

create or replace function handle_new_user()
returns trigger as $$
declare
  ws_id uuid;
  user_name text;
  workspace_slug text;
  v_invite_id uuid;
  v_has_pending_invite boolean;
begin
  -- Alta por invitacion: no se crea workspace propio. registerFromInvite ya
  -- valido la invitacion antes de crear esta cuenta y suma la membresia el
  -- mismo, con finalizeAcceptInvite.
  v_invite_id := (new.raw_user_meta_data->>'invite_id')::uuid;
  if v_invite_id is not null then
    select exists (
      select 1 from public.workspace_invites
      where id = v_invite_id
        and email = new.email
        and status = 'pending'
        and expires_at > now()
    ) into v_has_pending_invite;

    if v_has_pending_invite then
      return new;
    end if;
  end if;

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

-- ============================================================
-- MIGRATION 120: RENAME CRON JOBS
-- ============================================================
-- ============================================================
-- 00120_rename_cron_jobs.sql
--
-- Los 25 cron jobs se agendaron con el prefijo 'ssa-cron-' (00036 a 00092).
-- Las migraciones de origen ya se editaron para agendar sin el prefijo
-- ('jobs', 'sequences', 'purge-deleted', etc.): un clon nuevo, que corre esas
-- migraciones desde cero, nace directo con los nombres neutros y esta
-- migracion no encuentra nada que renombrar (el bloque de abajo es un no-op).
--
-- En una base donde 00036-00092 ya corrieron con los nombres viejos (como la
-- de produccion), hay que des-agendar cada 'ssa-cron-X' y agendar 'X' en su
-- lugar, con el mismo horario y el mismo comando que ya tenia: se leen de
-- `cron.job`, no se repiten a mano, para no poder transcribirlos mal.
--
-- Idempotente: una segunda corrida no encuentra ningun 'ssa-cron-%' (ya
-- renombrados) y no hace nada. Si pg_cron no esta habilitado (por ejemplo un
-- entorno de desarrollo sin la extension), tambien no hace nada.
-- ============================================================

do $$
declare
  r record;
  new_name text;
begin
  if to_regclass('cron.job') is null then
    return;
  end if;

  for r in
    select jobid, jobname, schedule, command
    from cron.job
    where jobname like 'ssa-cron-%'
  loop
    new_name := regexp_replace(r.jobname, '^ssa-cron-', '');

    -- Por si una corrida anterior quedo a mitad de camino: no duplicar.
    if not exists (select 1 from cron.job where jobname = new_name) then
      perform cron.schedule(new_name, r.schedule, r.command);
    end if;

    perform cron.unschedule(r.jobid);
  end loop;
end $$;

-- ============================================================
-- MIGRATION 121: USER PREFERENCES
-- ============================================================
-- ============================================================
-- 00121_user_preferences.sql
--
-- Zona horaria por usuario (no por workspace): cada persona ve la bandeja,
-- los dashboards y los filtros en SU zona, detectada del navegador la
-- primera vez que entra y editable despues desde el menu de perfil.
--
-- Independiente del workspace a proposito: es una preferencia de la PERSONA,
-- no del negocio. `workspaces.timezone` sigue existiendo y sigue siendo la
-- que usan las reglas que no pueden depender de quien mira (horario de
-- atencion del agente, topes diarios de gasto de IA, hora de las tareas
-- programadas) — ver 00122.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.user_preferences (
  user_id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  timezone        text NOT NULL,
  -- 'browser': se detecto sola y se guardo en el primer ingreso.
  -- 'manual': la persona la cambio a mano desde el menu de perfil.
  -- Una vez 'manual', no se vuelve a pisar sola (components/timezone-bootstrap.tsx).
  timezone_source text NOT NULL DEFAULT 'browser',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_preferences_timezone_source_check') THEN
    ALTER TABLE public.user_preferences ADD CONSTRAINT user_preferences_timezone_source_check
      CHECK (timezone_source IN ('browser', 'manual'));
  END IF;
END $$;

COMMENT ON TABLE public.user_preferences IS
  'Preferencias por persona, no por workspace. Hoy solo la zona horaria.';

CREATE OR REPLACE FUNCTION public.set_updated_at_user_preferences()
RETURNS trigger AS $$
BEGIN
  new.updated_at = now();
  RETURN new;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_updated_at ON public.user_preferences;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.user_preferences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_user_preferences();

ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

-- Cada uno ve, crea y edita UNICAMENTE su propia fila. No depende de ningun
-- workspace ni de is_workspace_member: es pura identidad (auth.uid()).
DROP POLICY IF EXISTS user_preferences_select ON public.user_preferences;
CREATE POLICY user_preferences_select ON public.user_preferences
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS user_preferences_insert ON public.user_preferences;
CREATE POLICY user_preferences_insert ON public.user_preferences
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS user_preferences_update ON public.user_preferences;
CREATE POLICY user_preferences_update ON public.user_preferences
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Sin policy de DELETE a proposito: se borra sola en cascada si se borra el
-- usuario (ON DELETE CASCADE arriba). Nadie necesita borrar su propia fila;
-- "quiero que se vuelva a detectar" es simplemente cambiarla a mano.

-- ============================================================
-- MIGRATION 122: WORKSPACE TIMEZONE DEFAULT UTC
-- ============================================================
-- ============================================================
-- 00122_workspace_timezone_default_utc.sql
--
-- El default de workspaces.timezone era 'America/Costa_Rica' (00075): tenia
-- sentido para un solo negocio, no para un template que se duplica por
-- cliente. Pasa a 'UTC', neutral.
--
-- Esto NO toca el valor de ningun workspace que ya exista (ALTER COLUMN ...
-- SET DEFAULT solo cambia que valor toma una fila NUEVA sin especificar la
-- columna): el de un workspace que ya tiene un valor puesto no cambia.
--
-- Las funciones RPC de los dashboards (chat_dashboard_trends,
-- chat_dashboard_agent_weekly, chat_dashboard_drafts, chat_dashboard_numbers,
-- message_classification_status) tienen el mismo default en su parametro
-- p_tz. Se deja sin tocar a proposito: la app SIEMPRE pasa p_tz explicito
-- (verificado), asi que el default no afecta ningun comportamiento real, y
-- reescribir esas funciones completas en una migracion nueva solo para
-- cambiar un default sin uso es correr un riesgo real (transcribir mal un
-- cuerpo de funcion grande) por un beneficio simbolico. Ver
-- docs/PROGRESS-white-label.md.
-- ============================================================

ALTER TABLE public.workspaces ALTER COLUMN timezone SET DEFAULT 'UTC';

-- ============================================================
-- MIGRATION 123: USER PREFERENCES SHARED TRIGGER
-- ============================================================
-- ============================================================
-- 00123_user_preferences_shared_trigger.sql
--
-- La 00121 creaba una funcion de trigger propia para user_preferences
-- (set_updated_at_user_preferences) en vez de reusar la que ya existe para
-- esto mismo en el resto de las tablas (public.update_updated_at, 00001).
-- Duplicar la logica tuvo un costo real: la version nueva no tenia
-- `SET search_path`, que la version compartida sí tiene desde hace rato
-- (get_advisors lo marco como WARN apenas se aplico la 00121).
--
-- Se repunta el trigger a la funcion compartida y se borra la propia.
-- ============================================================

DROP TRIGGER IF EXISTS set_updated_at ON public.user_preferences;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.user_preferences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP FUNCTION IF EXISTS public.set_updated_at_user_preferences();

-- ============================================================
-- MIGRATION 124: USER PREFERENCES RLS PERF
-- ============================================================
-- ============================================================
-- 00124_user_preferences_rls_perf.sql
--
-- Las tres policies de la 00121 llamaban a auth.uid() directo. Postgres la
-- re-evalua fila por fila en vez de una sola vez por consulta (get_advisors,
-- auth_rls_initplan, lo marco apenas se aplico la 00121). Con una sola fila
-- por usuario no se nota, pero el patron correcto es `(select auth.uid())`,
-- que Postgres si puede tratar como estable. Mismo comportamiento, mejor
-- plan.
-- ============================================================

DROP POLICY IF EXISTS user_preferences_select ON public.user_preferences;
CREATE POLICY user_preferences_select ON public.user_preferences
  FOR SELECT USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS user_preferences_insert ON public.user_preferences;
CREATE POLICY user_preferences_insert ON public.user_preferences
  FOR INSERT WITH CHECK (user_id = (select auth.uid()));

DROP POLICY IF EXISTS user_preferences_update ON public.user_preferences;
CREATE POLICY user_preferences_update ON public.user_preferences
  FOR UPDATE USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));

-- ============================================================
-- MIGRATION 125: SOCIAL POSTS ORIGIN MANUAL
-- ============================================================
-- ============================================================
-- 00125_social_posts_origin_manual.sql  (Contenido v4, C3)
--
-- Una publicacion subida A MANO por fuera de la app (una red no conectada, o
-- una que se publico desde el celular) pasa a existir como fila real de
-- social_posts con origin = 'manual'. Sin esto no entraria al calendario, a
-- Social ni a las metricas: un flag cosmetico en la pieza no alcanza.
--
-- Solo AMPLIA la lista permitida. No toca ninguna fila existente.
--
-- Definicion vieja (00083_content_pipeline.sql):
--   CHECK (origin IN ('system', 'external'))
--
-- Reversa (solo funciona si antes se borran o reasignan las filas 'manual'):
--   ALTER TABLE public.social_posts DROP CONSTRAINT IF EXISTS social_posts_origin_check;
--   ALTER TABLE public.social_posts ADD CONSTRAINT social_posts_origin_check
--     CHECK (origin IN ('system', 'external'));
--
-- Idempotente: si el CHECK ya admite 'manual', no hace nada.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'social_posts_origin_check'
      AND pg_get_constraintdef(oid) LIKE '%manual%'
  ) THEN
    ALTER TABLE public.social_posts DROP CONSTRAINT IF EXISTS social_posts_origin_check;
    ALTER TABLE public.social_posts ADD CONSTRAINT social_posts_origin_check
      CHECK (origin IN ('system', 'external', 'manual'));
  END IF;
END $$;

COMMENT ON COLUMN public.social_posts.origin IS
  'system: la publico el sistema. external: la trajo la sincronizacion. manual: la subio una persona por fuera de la app y la marco como publicada (Contenido v4).';

-- ============================================================
-- MIGRATION 126: NETWORKS FORMAT BACKFILL
-- ============================================================
-- ============================================================
-- 00126_networks_format_backfill.sql  (Contenido v4, C9)
--
-- Completa `content_posts.networks[].format` desde el campo viejo
-- `networks[].options.contentType`, donde `format` esta vacio. Es el paso
-- previo a que el publicador de Instagram (y la validacion y el calculo de
-- media_type) dejen de leer `contentType` y lean solo `format`.
--
-- Mapeo (solo Instagram tenia `contentType`; las demas redes no se tocan):
--   reel     -> reel
--   story    -> story
--   carousel -> carousel
--   feed     -> image si la red (o, sin `files` propios, la pieza) tiene 1
--               archivo; carousel si tiene 2 o mas; NULL si tiene 0 (nunca
--               se adivina un formato sin archivos: queda para revisar a
--               mano, ver docs/PENDIENTE.md)
--   otro valor (no deberia haber ninguno) -> NULL
--
-- Idempotente: solo completa entradas con `format` vacio Y `contentType`
-- presente. Una vez corrida, una segunda corrida no encuentra nada que
-- cambiar.
--
-- Reversa: poner `format` en NULL donde la pieza tenga
-- `networks[].options.contentType`:
--   update content_posts set networks = (
--     select jsonb_agg(
--       case when n->'options'->>'contentType' is not null
--         then n - 'format' else n end
--     ) from jsonb_array_elements(networks) n
--   ) where networks @> '[{"options":{}}]'::jsonb; -- (ajustar el filtro)
-- La definicion completa de esta migracion, para copiar y pegar en la
-- reversa si hiciera falta el detalle exacto, queda en este comentario.
-- ============================================================

-- Funcion de uso unico: transforma un `networks[]` completo. `media` es la
-- biblioteca de la pieza, para contar archivos cuando la red no tiene
-- `files` propios (modelo anterior a F92/F93).
CREATE OR REPLACE FUNCTION private._cv4_backfill_network_format(networks jsonb, media jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  entry jsonb;
  result jsonb := '[]'::jsonb;
  content_type text;
  file_count int;
  new_format text;
BEGIN
  FOR entry IN SELECT * FROM jsonb_array_elements(COALESCE(networks, '[]'::jsonb))
  LOOP
    content_type := entry -> 'options' ->> 'contentType';

    IF entry ->> 'platform' = 'instagram'
       AND (entry ->> 'format' IS NULL OR entry ->> 'format' = '')
       AND content_type IS NOT NULL
    THEN
      IF entry ? 'files' THEN
        file_count := jsonb_array_length(entry -> 'files');
      ELSE
        file_count := COALESCE(jsonb_array_length(media), 0);
      END IF;

      new_format := CASE content_type
        WHEN 'reel' THEN 'reel'
        WHEN 'story' THEN 'story'
        WHEN 'carousel' THEN 'carousel'
        WHEN 'feed' THEN
          CASE
            WHEN file_count >= 2 THEN 'carousel'
            WHEN file_count = 1 THEN 'image'
            ELSE NULL
          END
        ELSE NULL
      END;

      -- OJO: jsonb_set con un new_value que es SQL NULL devuelve SQL NULL
      -- (se pierde la fila entera), no el jsonb 'null'. Hay que convertir
      -- expresamente: to_jsonb(new_format) es NULL cuando new_format es
      -- NULL; coalesce a 'null'::jsonb lo vuelve un valor jsonb valido.
      entry := jsonb_set(entry, '{format}', COALESCE(to_jsonb(new_format), 'null'::jsonb), true);
    END IF;

    result := result || jsonb_build_array(entry);
  END LOOP;

  RETURN result;
END;
$$;

-- Respaldo de lo que se va a tocar, para poder auditar o volver atras sin
-- adivinar que habia antes (se consulta con list_migrations / execute_sql;
-- no es una tabla nueva, es el registro de esta corrida en el comentario de
-- PROGRESS-CV4.md tras aplicar).
UPDATE public.content_posts
SET networks = private._cv4_backfill_network_format(networks, media)
WHERE EXISTS (
  SELECT 1
  FROM jsonb_array_elements(networks) n
  WHERE n ->> 'platform' = 'instagram'
    AND (n ->> 'format' IS NULL OR n ->> 'format' = '')
    AND n -> 'options' ->> 'contentType' IS NOT NULL
);

DROP FUNCTION private._cv4_backfill_network_format(jsonb, jsonb);

-- ============================================================
-- MIGRATION 127: CONTENT VERSIONS SESSION
-- ============================================================
-- ============================================================
-- 00127_content_versions_session.sql  (Contenido v4, C6)
--
-- Agrupar las versiones de una pieza por SESION de edicion, no una por
-- cambio: con el autoguardado (C6 escribe en cada blur/change), la regla
-- vieja (F22) generaria decenas de versiones en una tarde.
--
-- Dos cosas, las dos aditivas:
--
--   1. `updated_at`: para saber si el ultimo cambio de esa version fue hace
--      menos de 10 minutos (la sesion sigue) o mas (se corto). Nace en
--      `now()` para las filas que ya existen: no hay forma de saber cuando
--      se habian tocado de verdad, y tratarlas como "recien tocadas" es el
--      lado seguro (el peor caso es una sesion que no se agrupa, no una que
--      se agrupa de mas).
--   2. El CHECK de `reason` suma 'edit' (el autoguardado de verdad) y
--      'approve' (aprobar corta la sesion con su propio motivo, separado de
--      'status_change'). Los cinco motivos viejos se conservan: el
--      historial no se reescribe.
--
-- Idempotente: `ADD COLUMN IF NOT EXISTS` y el CHECK se reemplaza solo si
-- todavia no incluye los valores nuevos.
--
-- Reversa:
--   ALTER TABLE public.content_post_versions DROP COLUMN IF EXISTS updated_at;
--   ALTER TABLE public.content_post_versions DROP CONSTRAINT IF EXISTS content_post_versions_reason_check;
--   ALTER TABLE public.content_post_versions ADD CONSTRAINT content_post_versions_reason_check
--     CHECK (reason IN ('status_change','manual_save','resume_after_idle','ai_generation','restore'));
--   -- Solo funciona si antes se borran o se reescriben las filas con
--   -- reason IN ('edit','approve').
-- ============================================================

ALTER TABLE public.content_post_versions
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'content_post_versions_reason_check'
      AND pg_get_constraintdef(oid) LIKE '%''edit''%'
  ) THEN
    ALTER TABLE public.content_post_versions DROP CONSTRAINT IF EXISTS content_post_versions_reason_check;
    ALTER TABLE public.content_post_versions ADD CONSTRAINT content_post_versions_reason_check
      CHECK (reason IN ('status_change', 'manual_save', 'resume_after_idle', 'ai_generation', 'restore', 'edit', 'approve'));
  END IF;
END $$;

COMMENT ON COLUMN public.content_post_versions.updated_at IS
  'Cuando se toco por ultima vez esta fila. Con reason=edit y menos de 10 minutos, el proximo cambio del mismo autor actualiza esta misma version en vez de crear otra (Contenido v4, C6).';

-- ============================================================
-- MIGRATION 128: DROP MATERIAL AND CONTENT TYPE
-- ============================================================
-- ============================================================
-- 00128_drop_material_and_content_type.sql  (Contenido v4, C4 + C9)
--
-- ESCRITA Y NO APLICADA A PROPOSITO (regla del proyecto: lo destructivo se
-- escribe y se anota, nunca se aplica en la misma corrida que lo reemplaza).
-- Ver docs/PENDIENTE.md, seccion "Contenido v4", para el orden exacto y el
-- estado de las consultas de seguridad de abajo.
--
-- Borra DOS cosas que dejaron de leerse en esta tanda:
--
--   1. `content_posts.material_status` (C4): reemplazado por el dropdown de
--      estado, teñido con el color del estado. Sin referencias en lib/ ni en
--      app/ fuera de un comentario en el tipo de la base (que dice "sin uso,
--      se borra en la 00128").
--   2. La clave `options.contentType` dentro de `content_posts.networks[]`
--      (C9): reemplazada por `networks[].format`, el unico campo de formato.
--      No es una columna, es una clave de un jsonb: se borra con
--      `jsonb_set(... '{options}' ...)` quitando `contentType` del objeto
--      `options` de cada entrada de red, sin tocar el resto.
--
-- Esta migracion NO borra `copy`, `hook`, `angle`, `notes` ni `pillar`
-- (texto): esos ya los borro la 00118 (Contenido v3, 6/10/2026).
--
-- ============================================================
-- Consultas de seguridad: tienen que dar 0 ANTES de aplicar esta migracion.
-- ============================================================
--
--   -- A. Nada en el codigo desplegado lee material_status (fuera del
--   --    comentario del tipo y de esta migracion): se verifica con
--   --    `grep -rn "material_status" lib app` en el commit que esta en
--   --    produccion, no aca.
--
--   -- B. Nada en el codigo desplegado lee options.contentType como dato de
--   --    la pieza (fuera del campo propio que el body de Zernio le manda a
--   --    Zernio, que se llama igual mal pero es otra cosa): se verifica con
--   --    `grep -rn "contentType" lib app` en el commit que esta en
--   --    produccion.
--
--   -- C. Nadie quedo con una red sin `format` que dependiera de
--   --    `options.contentType` para programarse: tiene que dar 0.
--   SELECT count(*) FROM content_posts p, jsonb_array_elements(p.networks) n
--   WHERE n ->> 'platform' = 'instagram'
--     AND (n ->> 'format' IS NULL OR n ->> 'format' = '')
--     AND n -> 'options' ->> 'contentType' IS NOT NULL;
--
--   -- D. Un respaldo de lo que se va a borrar (no es una tabla nueva: una
--   --    exportacion a un archivo, fuera de la base, antes de aplicar):
--   SELECT id, material_status, networks FROM content_posts WHERE deleted_at IS NULL;
--
-- ============================================================
-- Reversa (solo funciona si se guardo el respaldo de la consulta D; sin eso
-- es IRREVERSIBLE: los valores se pierden):
--   ALTER TABLE public.content_posts ADD COLUMN material_status text;
--   -- + restaurar material_status y options.contentType desde el respaldo.
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'content_posts' AND column_name = 'material_status'
  ) THEN
    ALTER TABLE public.content_posts DROP CONSTRAINT IF EXISTS content_posts_material_check;
    ALTER TABLE public.content_posts DROP COLUMN material_status;
  END IF;
END $$;

-- Saca la clave 'contentType' de adentro de 'options', en cada entrada de
-- 'networks' de cada pieza que la tenga. El resto de la entrada (platform,
-- format, files, cta, planned_at...) no se toca.
UPDATE public.content_posts
SET networks = (
  SELECT jsonb_agg(
    CASE
      WHEN n -> 'options' ? 'contentType'
        THEN jsonb_set(n, '{options}', (n -> 'options') - 'contentType')
      ELSE n
    END
  )
  FROM jsonb_array_elements(networks) n
)
WHERE EXISTS (
  SELECT 1 FROM jsonb_array_elements(networks) n WHERE n -> 'options' ? 'contentType'
);

-- ============================================================
-- MIGRATION 129: BOOKING ATTRIBUTION V3
-- ============================================================
-- 00129: atribucion v3 de agendas (Agenda v2).
--
-- Aditiva. Dos arreglos sobre `create_booking` (hoy, la de la 00115) y dos
-- piezas nuevas de solo lectura para el widget de filtros.
--
-- 1. `create_booking` es la de la 00115 LETRA POR LETRA, con tres cambios:
--    a. El toque de atribucion NO se registra cuando `p_origin` es 'manual'
--       o 'agent': ahi no se sabe de donde vino el lead (si lo agenda el
--       equipo a mano o el agente, el toque real ya lo tiene el DM o el
--       comentario que lo trajo), y el toque falso `web/booking` pisaba ese
--       toque real en `contacts.attribution.last_touch`.
--    b. Se suman `ttclid`, `li_fat_id` (ya en `contact_touches` desde la
--       00114, pero nada los escribia) y `landing_page` (la pagina donde
--       vivia el formulario o el embed, nueva: `p_landing_page`).
--    c. `p_landing_page text DEFAULT NULL`: parametro nuevo al final, con
--       default. PostgREST llama a las funciones por nombre (no por
--       posicion), asi que esto no rompe ninguna llamada existente.
--    La definicion anterior (00115) esta completa en el comentario de abajo
--    por si hace falta volver atras.
-- 2. Un indice por fuente y por campana del UTM de la agenda, para que el
--    filtro "UTM" de Agenda no escanee toda la tabla.
-- 3. `booking_utm_options`: los valores de fuente/medio/campana que de verdad
--    existen en el workspace, para las opciones del filtro. SECURITY INVOKER
--    (no DEFINER): lee `bookings` con el cliente de quien llama, así que
--    respeta el mismo alcance que ya aplica `bookings_select`.
--
-- Definicion anterior completa (00115_attribution_v2_and_backfill.sql),
-- por si hace falta volver atras:
--
-- CREATE OR REPLACE FUNCTION public.create_booking(
--   p_workspace_id   uuid,
--   p_event_type_id  uuid,
--   p_host_user_id   uuid,
--   p_start_at       timestamptz,
--   p_end_at         timestamptz,
--   p_title          text,
--   p_name           text,
--   p_email          text,
--   p_phone          text,
--   p_timezone       text,
--   p_host_timezone  text,
--   p_location_type  text,
--   p_location_text  text,
--   p_responses      jsonb,
--   p_origin         text,
--   p_utm            jsonb,
--   p_referrer_url   text,
--   p_uid            text,
--   p_category_id    uuid,
--   p_category_snapshot jsonb,
--   p_contact_assignment text,
--   p_created_by     uuid DEFAULT NULL,
--   p_contact_id     uuid DEFAULT NULL,
--   p_metadata       jsonb DEFAULT '{}'::jsonb
-- )
-- RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
-- [...] (el cuerpo entero, igual al de abajo salvo por el bloque "c2" del
-- toque, que ahi SIEMPRE lo registraba y no llevaba ttclid/li_fat_id/landing_page)
-- $$;

-- ---------------------------------------------------------------------------
-- 1. create_booking: la de la 00115 + el filtro por origen + los campos nuevos
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_booking(
  p_workspace_id   uuid,
  p_event_type_id  uuid,
  p_host_user_id   uuid,
  p_start_at       timestamptz,
  p_end_at         timestamptz,
  p_title          text,
  p_name           text,
  p_email          text,
  p_phone          text,
  p_timezone       text,
  p_host_timezone  text,
  p_location_type  text,
  p_location_text  text,
  p_responses      jsonb,
  p_origin         text,
  p_utm            jsonb,
  p_referrer_url   text,
  p_uid            text,
  p_category_id    uuid,
  p_category_snapshot jsonb,
  p_contact_assignment text,
  p_created_by     uuid DEFAULT NULL,
  p_contact_id     uuid DEFAULT NULL,
  p_metadata       jsonb DEFAULT '{}'::jsonb,
  p_landing_page   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_contact_id   uuid := p_contact_id;
  v_created      boolean := false;
  v_booking_id   uuid;
  v_email        text := nullif(btrim(lower(p_email)), '');
  v_phone        text := nullif(btrim(p_phone), '');
  v_dnc          boolean := false;
  v_setter       uuid;
  v_vendedor     uuid;
  v_assigned     boolean := false;
BEGIN
  -- Serializa los pedidos del mismo anfitrion dentro de la transaccion.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_host_user_id::text, 0));

  -- a. El contacto. Si viene dado (agendar manual, agente), se usa tal cual.
  IF v_contact_id IS NULL THEN
    IF v_phone IS NOT NULL THEN
      SELECT id INTO v_contact_id FROM public.contacts
      WHERE workspace_id = p_workspace_id AND deleted_at IS NULL
        AND (phone = v_phone OR whatsapp_phone = v_phone)
      ORDER BY created_at ASC LIMIT 1;
    END IF;

    IF v_contact_id IS NULL AND v_email IS NOT NULL THEN
      SELECT id INTO v_contact_id FROM public.contacts
      WHERE workspace_id = p_workspace_id AND deleted_at IS NULL
        AND (lower(email) = v_email OR lower(secondary_email) = v_email)
      ORDER BY created_at ASC LIMIT 1;
    END IF;

    IF v_contact_id IS NULL THEN
      INSERT INTO public.contacts (workspace_id, display_name, email, phone, timezone, attribution, last_interaction_at)
      VALUES (
        p_workspace_id,
        nullif(btrim(p_name), ''),
        v_email,
        v_phone,
        nullif(p_timezone, ''),
        coalesce(p_utm, '{}'::jsonb) || jsonb_build_object('source', 'scheduling', 'referrer', p_referrer_url),
        now()
      )
      RETURNING id INTO v_contact_id;
      v_created := true;
    END IF;
  END IF;

  -- Completa SOLO los campos vacios: nunca pisa lo que ya hay.
  IF NOT v_created THEN
    UPDATE public.contacts
    SET display_name = coalesce(display_name, nullif(btrim(p_name), '')),
        email        = coalesce(email, v_email),
        phone        = coalesce(phone, v_phone),
        timezone     = coalesce(timezone, nullif(p_timezone, '')),
        last_interaction_at = now()
    WHERE id = v_contact_id;
  END IF;

  SELECT do_not_contact, setter_id, vendedor_id INTO v_dnc, v_setter, v_vendedor
  FROM public.contacts WHERE id = v_contact_id;

  -- b. La asignacion (F22): solo si el campo esta vacio. El UPDATE dispara el
  -- trigger de la 00039, que emite assignment_changed en automation_events.
  IF p_contact_assignment = 'setter_if_empty' AND v_setter IS NULL THEN
    UPDATE public.contacts SET setter_id = p_host_user_id WHERE id = v_contact_id;
    v_assigned := true;
  ELSIF p_contact_assignment = 'vendedor_if_empty' AND v_vendedor IS NULL THEN
    UPDATE public.contacts SET vendedor_id = p_host_user_id WHERE id = v_contact_id;
    v_assigned := true;
  END IF;

  -- c. La agenda.
  INSERT INTO public.bookings (
    workspace_id, uid, event_type_id, category_id, category_snapshot, metadata,
    host_user_id, contact_id, title, start_at, end_at, status,
    booker_name, booker_email, booker_phone, booker_timezone, host_timezone,
    location_type, location_text, responses, origin, utm, referrer_url,
    created_by, is_do_not_contact_at_booking, google_sync_status
  ) VALUES (
    p_workspace_id, p_uid, p_event_type_id, p_category_id, p_category_snapshot, coalesce(p_metadata, '{}'::jsonb),
    p_host_user_id, v_contact_id, p_title, p_start_at, p_end_at, 'scheduled',
    nullif(btrim(p_name), ''), v_email, v_phone, nullif(p_timezone, ''), nullif(p_host_timezone, ''),
    p_location_type, p_location_text, coalesce(p_responses, '{}'::jsonb), p_origin,
    coalesce(p_utm, '{}'::jsonb), p_referrer_url,
    p_created_by, coalesce(v_dnc, false), 'pending'
  )
  RETURNING id INTO v_booking_id;

  -- c2. El toque de atribucion (Contenido v3, F87; Agenda v2). Vale para el
  -- contacto nuevo Y para el que ya existia: una reserva es una interaccion
  -- mas de esa persona. NO se registra para 'manual' ni 'agent': ahi no hay
  -- forma de saber de donde vino el lead, y un toque `web/booking` inventado
  -- pisaria el toque real (el DM o el comentario que lo trajo).
  -- Va protegido: una falla de atribucion NUNCA puede impedir una reserva.
  IF p_origin NOT IN ('manual', 'agent') THEN
    BEGIN
      PERFORM public.record_contact_touch(
        p_workspace_id,
        v_contact_id,
        jsonb_build_object(
          'occurred_at',  now(),
          'source',       coalesce(nullif(lower(btrim(p_utm->>'utm_source')), ''), 'web'),
          'medium',       'booking',
          'campaign',     nullif(btrim(p_utm->>'utm_campaign'), ''),
          'content',      nullif(btrim(p_utm->>'utm_content'), ''),
          'term',         nullif(btrim(p_utm->>'utm_term'), ''),
          'fbclid',       nullif(btrim(p_utm->>'fbclid'), ''),
          'gclid',        nullif(btrim(p_utm->>'gclid'), ''),
          'ttclid',       nullif(btrim(p_utm->>'ttclid'), ''),
          'li_fat_id',    nullif(btrim(p_utm->>'li_fat_id'), ''),
          'referrer_url', nullif(btrim(p_referrer_url), ''),
          'landing_page', nullif(btrim(p_landing_page), ''),
          'origin',       'booking',
          'dedupe_key',   'booking:' || v_booking_id::text,
          'raw',          jsonb_build_object('utm', coalesce(p_utm, '{}'::jsonb), 'booking_origin', p_origin)
        )
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'create_booking: no pude registrar el toque de atribucion: %', SQLERRM;
    END;
  END IF;

  -- d. El historial.
  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by)
  VALUES (
    p_workspace_id, 'booking', v_booking_id, 'booking.created',
    jsonb_build_object('start_at', p_start_at, 'end_at', p_end_at),
    jsonb_build_object('origin', p_origin, 'actor_type', CASE WHEN p_created_by IS NULL THEN 'invitee' ELSE 'user' END),
    p_created_by
  );

  -- e. El evento de automatizacion.
  INSERT INTO public.automation_events (workspace_id, event_type, contact_id, payload)
  VALUES (
    p_workspace_id, 'booking_created', v_contact_id,
    jsonb_build_object(
      'booking_id', v_booking_id,
      'event_type_id', p_event_type_id,
      'host_user_id', p_host_user_id,
      'origin', p_origin
    )
  );

  -- f. Los jobs: crear el evento en Google y avisar cuando la agenda termine.
  INSERT INTO public.scheduled_jobs (type, payload, run_at, status)
  VALUES (
    'booking_google_sync',
    jsonb_build_object('booking_id', v_booking_id, 'action', 'create', 'attempt', 0),
    now(), 'pending'
  );
  INSERT INTO public.scheduled_jobs (type, payload, run_at, status, dedupe_key)
  VALUES (
    'booking_ended',
    jsonb_build_object('booking_id', v_booking_id),
    p_end_at, 'pending', 'ended:' || v_booking_id::text || ':0'
  );

  RETURN jsonb_build_object(
    'booking_id', v_booking_id,
    'contact_id', v_contact_id,
    'created_contact', v_created,
    'assignment_changed', v_assigned,
    'do_not_contact', coalesce(v_dnc, false)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_booking(uuid, uuid, uuid, timestamptz, timestamptz, text, text, text, text, text, text, text, text, jsonb, text, jsonb, text, text, uuid, jsonb, text, uuid, uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_booking(uuid, uuid, uuid, timestamptz, timestamptz, text, text, text, text, text, text, text, text, jsonb, text, jsonb, text, text, uuid, jsonb, text, uuid, uuid, jsonb, text) TO service_role;

-- La firma vieja (sin `p_landing_page`) queda huerfana: Postgres no permite
-- dos funciones con el mismo nombre y la misma lista de tipos, pero esta es
-- una lista distinta (24 tipos contra 25), asi que la de la 00115 sigue
-- existiendo como una sobrecarga separada. Se borra para que nadie la llame
-- sin querer desde una conexion vieja en caliente.
DROP FUNCTION IF EXISTS public.create_booking(uuid, uuid, uuid, timestamptz, timestamptz, text, text, text, text, text, text, text, text, jsonb, text, jsonb, text, text, uuid, jsonb, text, uuid, uuid, jsonb);

-- ---------------------------------------------------------------------------
-- 2. Indices para el filtro "UTM" de Agenda
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_bookings_utm_source
  ON public.bookings (workspace_id, (utm ->> 'utm_source'), start_at);
CREATE INDEX IF NOT EXISTS idx_bookings_utm_campaign
  ON public.bookings (workspace_id, (utm ->> 'utm_campaign'), start_at);

-- ---------------------------------------------------------------------------
-- 3. Las opciones del filtro UTM: SECURITY INVOKER, respeta `bookings_select`
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.booking_utm_options(p_workspace_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'sources',   coalesce((SELECT jsonb_agg(DISTINCT v ORDER BY v) FROM public.bookings b, lateral (SELECT b.utm ->> 'utm_source' AS v) s WHERE b.workspace_id = p_workspace_id AND s.v IS NOT NULL), '[]'::jsonb),
    'mediums',   coalesce((SELECT jsonb_agg(DISTINCT v ORDER BY v) FROM public.bookings b, lateral (SELECT b.utm ->> 'utm_medium' AS v) s WHERE b.workspace_id = p_workspace_id AND s.v IS NOT NULL), '[]'::jsonb),
    'campaigns', coalesce((SELECT jsonb_agg(DISTINCT v ORDER BY v) FROM public.bookings b, lateral (SELECT b.utm ->> 'utm_campaign' AS v) s WHERE b.workspace_id = p_workspace_id AND s.v IS NOT NULL), '[]'::jsonb)
  )
$$;

REVOKE ALL ON FUNCTION public.booking_utm_options(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.booking_utm_options(uuid) TO authenticated, service_role;

-- ============================================================
-- MIGRATION 130: BOOKING SLOT RELEASE
-- ============================================================
-- 00130: liberar espacio (Agenda v2).
--
-- Aditiva. Una agenda liberada sigue existiendo, activa, con su lead y su
-- link de Meet: lo unico que cambia es que su horario deja de contar como
-- ocupado, para que el equipo pueda agendar otro lead en el mismo lugar
-- mientras este no se confirma (por ejemplo, mientras se espera saber si
-- descalifica). Volver a ocupar lo mismo lo revierte.
--
-- 1. `slot_released_at`/`slot_released_by`: cuando se libero y quien. NULL de
--    toda la vida de una agenda que nunca se libero.
-- 2. `bookings_no_overlap` (00099) se recrea para excluir las liberadas: dos
--    agendas activas siguen sin poder pisarse, salvo que una este liberada.
-- 3. `google_host_connection_id`/`google_host_calendar_id`: a nombre de QUIEN
--    esta sincronizado el evento hoy. Antes de reasignar (bloque D) siempre
--    es la conexion del propio anfitrion (`google_connection_id`); estas dos
--    columnas quedan listas para cuando reasignar las corra a las del nuevo
--    anfitrion sin tocar `google_connection_id` (que sigue siendo el
--    organizador real en Google).

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS slot_released_at timestamptz,
  ADD COLUMN IF NOT EXISTS slot_released_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS google_host_connection_id uuid REFERENCES public.oauth_connections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS google_host_calendar_id uuid REFERENCES public.calendars(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_no_overlap') THEN
    ALTER TABLE public.bookings DROP CONSTRAINT bookings_no_overlap;
  END IF;
  ALTER TABLE public.bookings ADD CONSTRAINT bookings_no_overlap
    EXCLUDE USING gist (
      host_user_id WITH =,
      tstzrange(start_at, end_at) WITH &&
    ) WHERE (status IN ('scheduled', 'confirmed', 'rescheduled') AND slot_released_at IS NULL);
END $$;

CREATE INDEX IF NOT EXISTS idx_bookings_slot_released
  ON public.bookings (host_user_id, start_at) WHERE slot_released_at IS NOT NULL;

-- ============================================================
-- MIGRATION 131: RESPONSE ASSETS SIX KINDS
-- ============================================================
-- ============================================================
-- MIGRACION 00131 — LA BANCA DE RECURSOS PASA DE DOS TIPOS A SEIS
-- ============================================================
-- Plano: requerimientos-banca-recursos-v2.md (v2.1), §2 y F1. El plano la
-- numeraba 00125; esa numeracion ya estaba ocupada (00125-00130 aplicadas
-- antes de esta corrida), asi que es la 00131 con el contenido aprobado.
--
-- Que hace:
--   1. `kind` acepta text | audio | video | image | file | link.
--   2. Seis columnas nuevas, todas opcionales: url, link_kind, preview_path,
--      caption, usage_count (default 0) y last_used_at.
--   3. Reemplaza las reglas de forma de 00105 por unas que cubren los seis
--      tipos. Conserva TODAS las exigencias que ya habia (contenido no en
--      blanco, un texto sin mime/duracion/peso/source, un archivo con source)
--      y suma las nuevas.
--   4. Las tres policies de escritura pasan a aceptar, ademas de Owner/Admin,
--      a un rol personalizado con `templates.manage` (mismo patron que 00097).
--   5. Un indice para el orden por defecto del widget (los mas usados).
--
-- Riesgo: la tabla tenia 0 filas al escribir esta migracion (7 y 8/10/2026).
-- Cambiar reglas de una tabla vacia no invalida ningun dato. Y el codigo viejo
-- sigue funcionando contra la base nueva: los dos tipos que conocia siguen
-- siendo validos con la misma forma, y todo lo nuevo es opcional.
--
-- ------------------------------------------------------------
-- COMO VOLVER ATRAS (copia letra por letra de lo que esta migracion reemplaza,
-- tomado de 00105_response_assets.sql)
-- ------------------------------------------------------------
-- Los cuatro CHECK de tipo y forma originales:
--
--   ALTER TABLE public.response_assets ADD CONSTRAINT response_assets_kind_check
--     CHECK (kind IN ('text', 'audio'));
--
--   ALTER TABLE public.response_assets ADD CONSTRAINT response_assets_text_shape
--     CHECK (kind <> 'text' OR (
--       content IS NOT NULL AND length(btrim(content)) > 0
--       AND storage_path IS NULL
--       AND mime_type IS NULL
--       AND duration_seconds IS NULL
--       AND size_bytes IS NULL
--       AND source IS NULL
--     ));
--
--   ALTER TABLE public.response_assets ADD CONSTRAINT response_assets_text_no_transcript
--     CHECK (kind <> 'text' OR (
--       transcript IS NULL
--       AND transcript_status = 'none'
--       AND transcript_error IS NULL
--       AND transcript_started_at IS NULL
--     ));
--
--   ALTER TABLE public.response_assets ADD CONSTRAINT response_assets_audio_shape
--     CHECK (kind <> 'audio' OR (
--       storage_path IS NOT NULL AND length(btrim(storage_path)) > 0
--       AND mime_type IS NOT NULL
--       AND content IS NULL
--       AND description IS NOT NULL
--       AND source IS NOT NULL
--     ));
--
-- Las tres policies de escritura originales:
--
--   CREATE POLICY "response_assets_insert" ON public.response_assets
--     FOR INSERT WITH CHECK (public.is_workspace_admin(workspace_id));
--
--   CREATE POLICY "response_assets_update" ON public.response_assets
--     FOR UPDATE USING (public.is_workspace_admin(workspace_id))
--     WITH CHECK (public.is_workspace_admin(workspace_id));
--
--   CREATE POLICY "response_assets_delete" ON public.response_assets
--     FOR DELETE USING (public.is_workspace_admin(workspace_id));
--
-- Para revertir: borrar las filas de los tipos nuevos (si las hubiera),
-- DROP de los CHECK nuevos (response_assets_kind_check, _text_shape,
-- _no_transcript, _file_shape, _link_shape, _link_kind_check, _caption_kinds,
-- _preview_path_video_only, _url_http, _duration_kinds, _recorded_audio_only,
-- _usage_count_positive), restaurar los cuatro de arriba y las tres policies,
-- DROP INDEX idx_response_assets_last_used, y DROP COLUMN de url, link_kind,
-- preview_path, caption, usage_count y last_used_at.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Columnas nuevas
-- ------------------------------------------------------------

-- Solo kind='link': la direccion. No va en storage_path porque esa columna es
-- la que usa el bucket para buscar archivos, y la limpieza intentaria borrarla.
ALTER TABLE public.response_assets ADD COLUMN IF NOT EXISTS url text;

-- Solo kind='link': que clase de enlace es. Lista cerrada (ver el CHECK) para
-- que el filtro pueda agrupar sin terminar con "testimonio" y "Testimonios".
ALTER TABLE public.response_assets ADD COLUMN IF NOT EXISTS link_kind text;

-- Solo kind='video': la miniatura (un jpg en chat-media/<ws>/library/), para
-- que una lista de diez videos no baje diez videos.
ALTER TABLE public.response_assets ADD COLUMN IF NOT EXISTS preview_path text;

-- image | video | file: el texto que ve el CONTACTO al recibirlo. No es la
-- descripcion: la descripcion es para encontrarlo (y para el agente).
ALTER TABLE public.response_assets ADD COLUMN IF NOT EXISTS caption text;

-- Cuantas veces se mando y cuando fue la ultima. Las escribe solo
-- touch_response_asset (00132): un Member no tiene escritura sobre la tabla.
ALTER TABLE public.response_assets ADD COLUMN IF NOT EXISTS usage_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.response_assets ADD COLUMN IF NOT EXISTS last_used_at timestamptz;

-- ------------------------------------------------------------
-- 2. Reglas de forma
-- ------------------------------------------------------------
-- Mismo estilo que 00105: una regla por constraint, con nombre propio, escrita
-- `kind <> 'x' OR (...)` para que el error de Postgres nombre el tipo que
-- fallo. DROP + ADD es idempotente: correrla dos veces deja lo mismo.

DO $$
BEGIN
  -- Los cuatro que se reemplazan (ver la cabecera).
  ALTER TABLE public.response_assets DROP CONSTRAINT IF EXISTS response_assets_kind_check;
  ALTER TABLE public.response_assets DROP CONSTRAINT IF EXISTS response_assets_text_shape;
  ALTER TABLE public.response_assets DROP CONSTRAINT IF EXISTS response_assets_text_no_transcript;
  ALTER TABLE public.response_assets DROP CONSTRAINT IF EXISTS response_assets_audio_shape;

  -- Los nuevos, por si se corre dos veces.
  ALTER TABLE public.response_assets DROP CONSTRAINT IF EXISTS response_assets_no_transcript;
  ALTER TABLE public.response_assets DROP CONSTRAINT IF EXISTS response_assets_file_shape;
  ALTER TABLE public.response_assets DROP CONSTRAINT IF EXISTS response_assets_link_shape;
  ALTER TABLE public.response_assets DROP CONSTRAINT IF EXISTS response_assets_link_kind_check;
  ALTER TABLE public.response_assets DROP CONSTRAINT IF EXISTS response_assets_caption_kinds;
  ALTER TABLE public.response_assets DROP CONSTRAINT IF EXISTS response_assets_preview_path_video_only;
  ALTER TABLE public.response_assets DROP CONSTRAINT IF EXISTS response_assets_url_http;
  ALTER TABLE public.response_assets DROP CONSTRAINT IF EXISTS response_assets_duration_kinds;
  ALTER TABLE public.response_assets DROP CONSTRAINT IF EXISTS response_assets_recorded_audio_only;
  ALTER TABLE public.response_assets DROP CONSTRAINT IF EXISTS response_assets_usage_count_positive;

  ALTER TABLE public.response_assets ADD CONSTRAINT response_assets_kind_check
    CHECK (kind IN ('text', 'audio', 'video', 'image', 'file', 'link'));

  -- Un texto: contenido si; ni archivo, ni enlace, ni caption, ni miniatura.
  -- Las seis primeras condiciones son las de 00105 tal cual.
  ALTER TABLE public.response_assets ADD CONSTRAINT response_assets_text_shape
    CHECK (kind <> 'text' OR (
      content IS NOT NULL AND length(btrim(content)) > 0
      AND storage_path IS NULL
      AND mime_type IS NULL
      AND duration_seconds IS NULL
      AND size_bytes IS NULL
      AND source IS NULL
      AND url IS NULL
      AND link_kind IS NULL
      AND caption IS NULL
      AND preview_path IS NULL
    ));

  -- Lo que no se transcribe nunca no puede parecer a medio transcribir. Era
  -- solo para el texto; ahora vale para los cuatro tipos sin voz. Un video SI
  -- puede quedar en 'none': es un video sin voz, que no se encola.
  ALTER TABLE public.response_assets ADD CONSTRAINT response_assets_no_transcript
    CHECK (kind NOT IN ('text', 'image', 'file', 'link') OR (
      transcript IS NULL
      AND transcript_status = 'none'
      AND transcript_error IS NULL
      AND transcript_started_at IS NULL
    ));

  -- Los cuatro tipos con archivo: archivo, mime, descripcion y source; nada de
  -- contenido ni de enlace. Es la regla del audio de 00105 extendida.
  ALTER TABLE public.response_assets ADD CONSTRAINT response_assets_file_shape
    CHECK (kind NOT IN ('audio', 'video', 'image', 'file') OR (
      storage_path IS NOT NULL AND length(btrim(storage_path)) > 0
      AND mime_type IS NOT NULL
      AND content IS NULL
      AND description IS NOT NULL
      AND source IS NOT NULL
      AND url IS NULL
      AND link_kind IS NULL
    ));

  -- Un enlace: URL, clase y descripcion; nada de archivo.
  ALTER TABLE public.response_assets ADD CONSTRAINT response_assets_link_shape
    CHECK (kind <> 'link' OR (
      url IS NOT NULL
      AND link_kind IS NOT NULL
      AND description IS NOT NULL
      AND content IS NULL
      AND storage_path IS NULL
      AND mime_type IS NULL
      AND duration_seconds IS NULL
      AND size_bytes IS NULL
      AND source IS NULL
      AND caption IS NULL
      AND preview_path IS NULL
    ));

  -- La clase de enlace: lista cerrada, y solo en un enlace.
  ALTER TABLE public.response_assets ADD CONSTRAINT response_assets_link_kind_check
    CHECK (link_kind IS NULL OR (
      kind = 'link'
      AND link_kind IN ('video', 'imagen', 'testimonio', 'articulo', 'landing',
                        'formulario', 'agenda', 'pago', 'otro')
    ));

  ALTER TABLE public.response_assets ADD CONSTRAINT response_assets_caption_kinds
    CHECK (caption IS NULL OR (
      kind IN ('image', 'video', 'file') AND length(btrim(caption)) > 0
    ));

  ALTER TABLE public.response_assets ADD CONSTRAINT response_assets_preview_path_video_only
    CHECK (preview_path IS NULL OR (
      kind = 'video' AND length(btrim(preview_path)) > 0
    ));

  -- Solo http/https: un `javascript:` o un `file:` no tiene nada que hacer en
  -- un mensaje a un contacto. La normalizacion fina la hace TypeScript.
  ALTER TABLE public.response_assets ADD CONSTRAINT response_assets_url_http
    CHECK (url IS NULL OR url ~* '^https?://[^[:space:]]+$');

  -- La duracion es de lo que se reproduce.
  ALTER TABLE public.response_assets ADD CONSTRAINT response_assets_duration_kinds
    CHECK (duration_seconds IS NULL OR kind IN ('audio', 'video'));

  -- Grabar en el navegador existe solo para el audio; los demas se suben.
  ALTER TABLE public.response_assets ADD CONSTRAINT response_assets_recorded_audio_only
    CHECK (source IS NULL OR kind = 'audio' OR source = 'uploaded');

  ALTER TABLE public.response_assets ADD CONSTRAINT response_assets_usage_count_positive
    CHECK (usage_count >= 0);
END;
$$;

-- ------------------------------------------------------------
-- 3. Indice
-- ------------------------------------------------------------
-- El orden por defecto del widget y de la lista: los mas usados primero. El
-- GIN de tags y el (workspace_id, kind, name) ya existen desde 00105.
CREATE INDEX IF NOT EXISTS idx_response_assets_last_used
  ON public.response_assets(workspace_id, last_used_at DESC NULLS LAST)
  WHERE deleted_at IS NULL;

-- ------------------------------------------------------------
-- 4. Policies de escritura
-- ------------------------------------------------------------
-- Owner/Admin como antes, y ademas un rol personalizado con `templates.manage`.
-- has_permission (00088) devuelve false para el Member de sistema (sus
-- permisos viven solo en lib/auth/permissions.ts y no incluyen esta clave),
-- asi que un Member sigue sin poder escribir. Leer no cambia: cualquier
-- miembro.

DROP POLICY IF EXISTS "response_assets_insert" ON public.response_assets;
CREATE POLICY "response_assets_insert" ON public.response_assets
  FOR INSERT WITH CHECK (
    public.is_workspace_admin(workspace_id)
    OR public.has_permission(workspace_id, 'templates.manage')
  );

DROP POLICY IF EXISTS "response_assets_update" ON public.response_assets;
CREATE POLICY "response_assets_update" ON public.response_assets
  FOR UPDATE USING (
    public.is_workspace_admin(workspace_id)
    OR public.has_permission(workspace_id, 'templates.manage')
  )
  WITH CHECK (
    public.is_workspace_admin(workspace_id)
    OR public.has_permission(workspace_id, 'templates.manage')
  );

DROP POLICY IF EXISTS "response_assets_delete" ON public.response_assets;
CREATE POLICY "response_assets_delete" ON public.response_assets
  FOR DELETE USING (
    public.is_workspace_admin(workspace_id)
    OR public.has_permission(workspace_id, 'templates.manage')
  );

-- ------------------------------------------------------------
-- 5. Comentarios
-- ------------------------------------------------------------

COMMENT ON TABLE public.response_assets IS
  'La banca de recursos: textos, audios, videos, imagenes, archivos y enlaces en una sola tabla, distinguidos por `kind`. El atajo es unico entre todos los tipos.';
COMMENT ON COLUMN public.response_assets.kind IS
  'text | audio | video | image | file | link. Decide que columnas aplican (ver los CHECK _text_shape, _file_shape y _link_shape). No se cambia despues de crear.';
COMMENT ON COLUMN public.response_assets.description IS
  'Obligatoria para todo menos un texto. Es lo que lee el agente para decidir CUANDO usar este recurso, y lo que lee una persona para saber que es sin abrirlo. Nunca se manda.';
COMMENT ON COLUMN public.response_assets.url IS
  'Solo enlaces: la direccion, http o https.';
COMMENT ON COLUMN public.response_assets.link_kind IS
  'Solo enlaces: video | imagen | testimonio | articulo | landing | formulario | agenda | pago | otro.';
COMMENT ON COLUMN public.response_assets.preview_path IS
  'Solo videos: la miniatura del primer fotograma en chat-media/<ws>/library/. Opcional: si el navegador no la pudo sacar, la pantalla muestra el icono del tipo.';
COMMENT ON COLUMN public.response_assets.caption IS
  'image | video | file: el texto que acompaña al archivo cuando se manda. Lo ve el contacto.';
COMMENT ON COLUMN public.response_assets.usage_count IS
  'Cuantas veces se mando. Lo suma touch_response_asset (00132).';
COMMENT ON COLUMN public.response_assets.last_used_at IS
  'Cuando se mando por ultima vez. Ordena el widget del chat.';
COMMENT ON COLUMN public.response_assets.agent_enabled IS
  'El interruptor del agente, para los seis tipos. Un audio, o un video con voz, ademas necesita la transcripcion lista.';

-- ============================================================
-- MIGRATION 132: TOUCH RESPONSE ASSET
-- ============================================================
-- ============================================================
-- MIGRACION 00132 — CONTAR LOS USOS DE UN RECURSO
-- ============================================================
-- Plano: requerimientos-banca-recursos-v2.md (v2.1), §5 "Contar los usos sin
-- abrir la escritura" y F1. El plano la numeraba 00126 (ocupada).
--
-- `usage_count` y `last_used_at` (00131) los tiene que poder actualizar
-- cualquiera que MANDE un recurso, y un Member no tiene escritura sobre
-- response_assets (ni la va a tener: le dejaria editar los recursos del
-- negocio). Esta funcion es la puerta angosta: corre con permisos elevados
-- pero sabe hacer una sola cosa, sumar uno al contador de un recurso.
--
-- Quien la puede usar con efecto:
--   - Un usuario, solo sobre un recurso de un workspace del que es miembro.
--     Si el recurso es de otro workspace, o no existe, o esta borrado, no
--     hace nada y no dice nada: no revela que existe.
--   - El servidor (service_role), sobre cualquiera. Es el caso del agente de
--     IA, que corre con el service client y no tiene auth.uid(): sin esta
--     rama, sus envios nunca contarian.
--
-- Mismo patron que find_or_link_contact y record_contact_touch: SECURITY
-- DEFINER con search_path vacio, todo calificado con el esquema.
--
-- Como volver atras:
--   DROP FUNCTION IF EXISTS public.touch_response_asset(uuid);
-- ============================================================

CREATE OR REPLACE FUNCTION public.touch_response_asset(p_asset_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.response_assets
     SET usage_count = usage_count + 1,
         last_used_at = now()
   WHERE id = p_asset_id
     AND deleted_at IS NULL
     AND (
       auth.role() = 'service_role'
       OR public.is_workspace_member(workspace_id)
     );
END;
$$;

COMMENT ON FUNCTION public.touch_response_asset(uuid) IS
  'Suma 1 a usage_count y pone last_used_at = now() en un recurso del workspace de quien llama (o en cualquiera, si llama el servidor). Si no corresponde, no hace nada y no lo dice.';

REVOKE ALL ON FUNCTION public.touch_response_asset(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.touch_response_asset(uuid) TO authenticated, service_role;

-- ============================================================
-- MIGRATION 133: AI SPEND ACTIONS
-- ============================================================
-- ============================================================
-- 00133_ai_spend_actions.sql
--
-- Topes de gasto de IA del workspace: que hacen al llegar, y un aviso antes.
--
-- Hasta ahora los dos topes del workspace (ai_daily_cost_limit_usd y
-- ai_monthly_cost_limit_usd, 00058) siempre CORTABAN: el diario frena la IA
-- hasta la medianoche local y el mensual apaga el agente. La accion estaba
-- fija en el codigo (lib/ai/spend.ts) y la pantalla de Ajustes decia, mal,
-- que el diario "avisa".
--
-- Ahora cada tope elige:
--   - 'disable' (el comportamiento de siempre): frena / apaga.
--   - 'notify': solo avisa, no frena nada.
-- Y un aviso opcional ANTES de llegar: al pasar ai_spend_alert_pct % de
-- cualquiera de los dos topes se crea una notificacion (una por periodo).
--
-- Aditiva y sin riesgo: los defaults dejan todo exactamente como esta hoy
-- ('disable' en los dos, sin aviso).
-- ============================================================

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS ai_daily_limit_action text NOT NULL DEFAULT 'disable',
  ADD COLUMN IF NOT EXISTS ai_monthly_limit_action text NOT NULL DEFAULT 'disable',
  ADD COLUMN IF NOT EXISTS ai_spend_alert_pct smallint;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspaces_ai_daily_limit_action_check') THEN
    ALTER TABLE public.workspaces ADD CONSTRAINT workspaces_ai_daily_limit_action_check
      CHECK (ai_daily_limit_action IN ('disable', 'notify'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspaces_ai_monthly_limit_action_check') THEN
    ALTER TABLE public.workspaces ADD CONSTRAINT workspaces_ai_monthly_limit_action_check
      CHECK (ai_monthly_limit_action IN ('disable', 'notify'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspaces_ai_spend_alert_pct_check') THEN
    ALTER TABLE public.workspaces ADD CONSTRAINT workspaces_ai_spend_alert_pct_check
      CHECK (ai_spend_alert_pct IS NULL OR (ai_spend_alert_pct BETWEEN 1 AND 99));
  END IF;
END $$;

COMMENT ON COLUMN public.workspaces.ai_daily_limit_action IS
  'Que pasa al llegar al tope diario de IA: disable = frena la IA hasta la medianoche local; notify = solo avisa.';
COMMENT ON COLUMN public.workspaces.ai_monthly_limit_action IS
  'Que pasa al llegar al tope mensual de IA: disable = apaga el agente; notify = solo avisa.';
COMMENT ON COLUMN public.workspaces.ai_spend_alert_pct IS
  'Avisar al llegar a este % de cualquiera de los dos topes (1 a 99). NULL = sin aviso previo. Una notificacion por tope y periodo.';

-- ============================================================
-- MIGRATION 134: PRODUCTS PRICE STATUS
-- ============================================================
-- ============================================================
-- 00134_products_price_status.sql
--
-- Las "ofertas" de contenido pasan a ser PRODUCTOS: cada uno con precio y
-- estado (activo, inactivo o discontinuado).
--
-- Se suma a `content_offers` y NO se renombra la tabla: renombrarla obligaria
-- a tocar `offer_id` en ideas y piezas, la funcion approve_content_idea_v2, los
-- indices y las policies de un saque, por un cambio de nombre que el usuario ve
-- en la pantalla y no en la base. En el codigo y en la documentacion
-- `content_offers` ES el catalogo de productos; el renombre de la tabla queda
-- para cuando se construya Ventas (Etapa 5), que es quien la va a usar.
--
-- Aditiva e idempotente. Hoy la tabla esta vacia en produccion: no hay nada
-- que migrar, pero el backfill de abajo cubre un clon con datos.
--
-- Precio: siempre en USD. Puede ser NULL en la base (filas anteriores a esta
-- migracion), pero la accion y el formulario lo exigen para los nuevos.
--
-- Estado y archivado van juntos: un producto "inactivo" o "discontinuado" es
-- uno que ya no se ofrece al clasificar, que es justo lo que ya significaba
-- `archived_at` (sale del selector, libera el nombre, se sigue mostrando en lo
-- ya clasificado). El CHECK lo hace cumplir: no puede haber un producto activo
-- archivado ni uno inactivo sin archivar.
-- ============================================================

ALTER TABLE public.content_offers
  ADD COLUMN IF NOT EXISTS price_usd numeric(12,2),
  ADD COLUMN IF NOT EXISTS status    text NOT NULL DEFAULT 'active';

-- Backfill ANTES del CHECK de coherencia: lo que ya estaba archivado queda discontinuado.
UPDATE public.content_offers
   SET status = 'discontinued'
 WHERE archived_at IS NOT NULL
   AND status = 'active';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_offers_price_check') THEN
    ALTER TABLE public.content_offers ADD CONSTRAINT content_offers_price_check
      CHECK (price_usd IS NULL OR price_usd >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_offers_status_check') THEN
    ALTER TABLE public.content_offers ADD CONSTRAINT content_offers_status_check
      CHECK (status IN ('active', 'inactive', 'discontinued'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_offers_status_archived_check') THEN
    ALTER TABLE public.content_offers ADD CONSTRAINT content_offers_status_archived_check
      CHECK ((status = 'active') = (archived_at IS NULL));
  END IF;
END $$;

COMMENT ON TABLE public.content_offers IS
  'Catalogo de PRODUCTOS (lo que se vende) a los que apunta una idea o una pieza. Se llamaba "ofertas". Un producto no se borra: se pone inactivo o discontinuado.';
COMMENT ON COLUMN public.content_offers.price_usd IS
  'Precio del producto, siempre en USD. NULL solo en filas anteriores a la 00134.';
COMMENT ON COLUMN public.content_offers.status IS
  'active = se ofrece al clasificar; inactive = pausado; discontinued = dejo de venderse. Distinto de active <=> archived_at no es NULL (CHECK).';
