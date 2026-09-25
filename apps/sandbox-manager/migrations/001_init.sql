-- State of the T2 sandboxes (ADR 0002). The manager has a database of its own and no
-- access to the API's: the only process that can start containers cannot read accounts.

create table sandboxes (
  id                text primary key check (id ~ '^t2_[0-9a-f]{24}$'),
  request_id        text not null unique,
  status            text not null check (status in (
                      'PENDING', 'PROVISIONING', 'READY', 'ACTIVE',
                      'EXPIRING', 'DESTROYING', 'DESTROYED', 'FAILED')),
  seed              text,
  lab_password      text,
  ttl_seconds       integer not null check (ttl_seconds > 0),
  idle_seconds      integer not null check (idle_seconds > 0),
  requested_at      timestamptz not null,
  provisioning_at   timestamptz,
  ready_at          timestamptz,
  -- Where a client reaches the sandbox, as the provider reported it once READY.
  host              text,
  port              integer,
  last_heartbeat_at timestamptz,
  expires_at        timestamptz,
  ended_at          timestamptz,
  end_reason        text,
  failure           text,
  destroy_attempts  integer not null default 0,
  -- A sandbox that ended keeps its history, never its secrets.
  check (status not in ('DESTROYED', 'FAILED') or (seed is null and lab_password is null))
);

-- The queue is the PENDING rows in request order; admission and counts read this index.
create index sandboxes_status_requested_at on sandboxes (status, requested_at);

create table sandbox_transitions (
  sandbox_id  text not null references sandboxes (id) on delete cascade,
  seq         integer not null,
  -- Null on the first row, which records the request itself.
  from_status text,
  to_status   text not null,
  reason      text,
  at          timestamptz not null,
  primary key (sandbox_id, seq)
);
