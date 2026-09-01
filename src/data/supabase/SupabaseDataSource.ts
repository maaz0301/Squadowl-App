/// <reference types="node" />
import { getSupabase } from '@/lib/supabase';
import { type Session, type SupabaseClient } from '@supabase/supabase-js';
import type { DataSource } from '../datasource';
import type { FeedbackSubmission } from '../extras';
import {
  categoryAveragesAcrossEvals,
  generateCloudCode,
  generateId,
  getDefaultWeights,
  getPlayerCategories,
  getPlayerSubskills,
  isGoaliePosition,
  playerDisplayName,
  weightedOverall,
  weightedOverallAcrossEvals,
} from '../rubrics';
import type { TeamBuilderConfig, TeamBuilderState } from '../teamBuilder';
import { buildTeams, formatExportCsv } from '../teamBuilder';
import { computePlayerResults } from '../scoring';
import {
  POSITIONS_BY_SPORT,
  TEST_DATA_TAG,
  clampScoreToRubric,
  generateDummyPlayers,
  generateDummyRegistration,
  generateDummyRubrics,
  generateDummyTeamNames,
  generateScoresForPlayer,
  mapAIPlayer,
  pickRecommendation,
  type AITestPlayer,
  type DummyDataOptions,
  type DummyDataResult,
  type DummyTeamOptions,
  type DummyTeamResult,
  type GeneratedPlayer,
} from '../testDataGenerator';
import type {
  AddPlayerForm,
  AdminStats,
  AdminUserRow,
  AiCompareSummary,
  AiPlayerSummary,
  Assessor,
  AssessmentAthlete,
  Athlete,
  AthleteHistory,
  AthleteShare,
  CoachDirectoryEntry,
  PlayerProfile,
  ShareComment,
  PlayerProfileAssessment,
  AuthSession,
  ConnectAccountStatus,
  CreateAssessmentForm,
  CreateEventForm,
  CreateSeasonForm,
  Database,
  EnterprisePayment,
  Evaluation,
  EventKind,
  EventType,
  ExportFormat,
  FamilyContact,
  Org,
  Player,
  Recommendation,
  Registration,
  RegistrationSubmit,
  ScoreForm,
  Season,
  SeasonEvent,
  SeasonPlayer,
  Sport,
  Team,
  TeamBuilderResult,
  TeamInviteResult,
  TeamMessage,
  TeamRosterPlayer,
  Tryout,
  TryoutSummary,
  UserProfile,
} from '../types';

// ─── small helpers ──────────────────────────────────────────────────────────
type Row = Record<string, any>;

/**
 * Which table a Manage Organization row came out of, and who it belongs to.
 * listOrgMembers() folds memberships, tryout_assessors and athlete guardian
 * contacts into one list, so a row id alone doesn't say what removing it means.
 */
type OrgMemberIdentity = {
  kind: 'membership' | 'assessor' | 'guardian' | 'teamManager';
  accountId: string | null;
  userId?: string;
  email?: string;
  /** memberships.role, so an owner/admin can be refused before the delete. */
  role?: string;
  /** The one assessor row the deduped list surfaced. */
  tryoutId?: string;
};

function unwrap<T>(res: { data: T; error: { message: string; code?: string } | null }): T {
  if (res.error) {
    const err = new Error(res.error.message) as Error & { code?: string };
    err.code = res.error.code;
    throw err;
  }
  return res.data;
}

/** Roles the RLS write policies (athletes/teams/tryouts) accept. */
const WRITABLE_ROLES = ['owner', 'admin', 'coach'];

function isStaleAccountError(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | undefined;
  return e?.code === '42501' || /row-level security/i.test(e?.message ?? '');
}

function toMs(iso: string | null | undefined): number {
  return iso ? new Date(iso).getTime() : 0;
}

/**
 * Supabase's GoTrueClient occasionally can't parse a non-2xx auth response (e.g. a
 * bare 5xx with no JSON body) and falls back to stringifying the raw fetch Response
 * as the error message — a huge blob of headers/cf-ray/bodyBlob JSON. Collapse
 * anything that doesn't look like a normal short message into a friendly fallback.
 */
function authErrorMessage(error: { message?: string } | null | undefined, fallback: string): string {
  const msg = error?.message;
  if (!msg) return fallback;
  const looksRaw = msg.length > 200 || /^\s*[{[]/.test(msg);
  return looksRaw ? fallback : msg;
}

/**
 * A generated dummy player, with the AI's raw per-rubric scores when the batch
 * was AI-generated and without them when it was produced locally.
 */
type ScorableDummyPlayer = GeneratedPlayer & { scores?: Record<string, number> };

/**
 * Row ceilings for the dummy-data bulk inserts, sized per table so one request's
 * JSON body lands around ~500KB. A full 1000-player × 5-session batch is ~37,000
 * rows across four tables; at these sizes that's ~11 requests instead of the ~74
 * that 500-row chunks cost, and the narrow tables (scores are three columns) get
 * the biggest chunks because their rows are the cheapest to ship. Kept bounded
 * rather than "one request per table" so a dropped request on a phone network
 * doesn't cost the whole batch.
 */
const DUMMY_CHUNK = {
  registrations: 500,
  athletes: 1000,
  participants: 1000,
  evaluations: 20000,
  scores: 5000,
} as const;

/**
 * Row ceilings for clearTestData's deletes. Deliberately *not* DUMMY_CHUNK: an
 * insert chunk is sized by how big its JSON body gets, but a delete chunk is
 * sized by what the statement drags along behind it. Removing one tagged
 * participant cascades to its ~5 evaluations and their ~36 scores, so a
 * 1000-row participant chunk is ~36,000 row deletes in a single statement —
 * exactly the shape that trips the `authenticated` role's 8s statement_timeout.
 * At 100 the same batch is ten short statements instead, fired as one wave.
 * Registrations cascade to nothing, so they keep an insert-sized chunk.
 */
const DUMMY_CLEAR_CHUNK = {
  participants: 100,
  registrations: 500,
} as const;

/**
 * Registrations placed onto a roster per round trip. A chunk of 20 is one
 * `select`, one bulk guardian-resolve RPC, one bulk athlete RPC, one
 * participant/roster insert, and one status update — so a selection of 20 or
 * fewer is placed in a single pass, and larger selections stream through in
 * 20s rather than one player at a time.
 */
/**
 * Rows per request when reading a team roster. The embedded `athletes(*)` join
 * makes PostgREST evaluate the athletes_read policy — can_access_athlete(),
 * five OR'd EXISTS subqueries after the assessor/sharing/team-manager
 * migrations widened it — once per row. A large roster read in one statement
 * therefore outruns the statement timeout long before it outruns the row cap,
 * so the read is paged to keep each statement's share of that predicate bounded.
 */
const TEAM_ROSTER_PAGE = 200;

/**
 * Rows per `team_roster` / `season_roster` upsert, and how many of those
 * requests run at once. The chunk stays at the size this codebase already
 * proved safe for a comparable upsert (REGISTRATION_CHUNK) so no single
 * statement gets long enough to risk a `statement_timeout`; the concurrency is
 * what stops a large roster from paying every chunk's latency in series.
 */
const ROSTER_UPSERT_CHUNK = 20;
const ROSTER_WRITE_CONCURRENCY = 8;

/**
 * Lookups in flight at once while assembling a roster read (the per-athlete fee
 * status batches). Bounded for the same reason as every other pool here — one
 * shared Postgres pooler sits behind all of them.
 */
const ROSTER_LOOKUP_CONCURRENCY = 6;

/** Default rows per request for fetchAllByIn — PostgREST's own row cap. */
const FETCH_PAGE_SIZE = 1000;

/**
 * Cut points for fetchAllByIn's parallel shards. Every table it reads is
 * uuid-keyed (see 0001_initial_schema.sql) and Postgres orders uuids by their
 * bytes, so cutting on the leading hex digit splits the key space into eight
 * roughly equal ranges. Written as whole uuids rather than one-character
 * prefixes because PostgREST casts the literal to the column's type before
 * comparing, and `'2'::uuid` is not a value.
 *
 * Balance is an optimisation, not a correctness condition: shardRangesAfter
 * always returns ranges that are disjoint and that together cover everything
 * above the cursor, so an account whose ids all happen to start with `f` reads
 * completely — just out of one shard, exactly as slowly as before.
 */
const SHARD_BOUNDS = ['2', '4', '6', '8', 'a', 'c', 'e'].map(
  (hex) => `${hex}0000000-0000-0000-0000-000000000000`,
);

/** `[exclusive lower bound, inclusive upper bound]`; `undefined` is unbounded. */
type ShardRange = [string | undefined, string | undefined];

/**
 * The select list `fetchPage` actually issues, guaranteed to carry the keyset
 * column.
 *
 * Keyset paging reads `id` off the last row of a page to place the next one, so
 * a caller that selects only the columns it needs — `'athlete_id'`, say — hands
 * the pager rows with no `id` on them. That cursor is `undefined`, `fetchPage`
 * treats an undefined bound as "unbounded" and skips the `gt('id', …)` filter
 * entirely, and every page then re-reads the same first rows forever. It hangs
 * rather than erroring, because a full page is also the signal to keep going:
 * the short-page exit never fires. Requesting `id` alongside whatever was asked
 * for costs one indexed column already in the primary key and removes the whole
 * class of bug.
 *
 * Only top-level tokens count — `athletes(id, …)` selects an `id` on the
 * *embedded* row, which never appears on this row at all.
 */
function withKeysetColumn(select: string): string {
  const top: string[] = [];
  let depth = 0;
  let token = '';
  for (const ch of select) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      top.push(token);
      token = '';
    } else {
      token += ch;
    }
  }
  top.push(token);
  // `*` already brings the primary key with it.
  const hasId = top.some((t) => {
    const name = t.trim();
    return name === 'id' || name === '*';
  });
  return hasId ? select : `id,${select}`;
}

/**
 * The `id` to resume a keyset scan after, or a thrown error.
 *
 * withKeysetColumn() means a page always *should* carry one. If something ever
 * strips it again anyway, the caller is one round trip away from re-reading
 * this same page forever (see withKeysetColumn) — an unkillable spinner with a
 * counter climbing behind it and no error anywhere to point at the cause.
 * Failing here turns that hang into something diagnosable.
 */
function keysetCursor(table: string, page: Row[]): string {
  const cursor = page[page.length - 1]?.id;
  if (typeof cursor !== 'string') {
    throw new Error(
      `Keyset paging over "${table}" read a row without an id, so the next page cannot be placed.`,
    );
  }
  return cursor;
}

/**
 * The key space above `cursor`, cut into ranges at every SHARD_BOUNDS point
 * that is still ahead of it. Bounds at or below the cursor are dropped — that
 * ground is already read — so a cursor past the last bound yields a single
 * unbounded range and the tail is simply paged in series.
 */
function shardRangesAfter(cursor: string): ShardRange[] {
  const ahead = SHARD_BOUNDS.filter((b) => b > cursor);
  const ranges: ShardRange[] = [];
  let from: string | undefined = cursor;
  for (const bound of ahead) {
    ranges.push([from, bound]);
    from = bound;
  }
  ranges.push([from, undefined]);
  return ranges;
}

/**
 * Rows per request for the reads that embed `athletes(*)` or
 * `evaluation_scores(...)`. Same reasoning as TEAM_ROSTER_PAGE: the embed makes
 * PostgREST evaluate the child table's read policy once per row, so a
 * full-size page costs far more than its row count suggests. Keyset paging
 * (see fetchAllByIn) keeps the cost flat across pages; these keep the cost of
 * any single page bounded. Mirrors the web app's PARTICIPANTS_PAGE /
 * SEASON_ROSTER_PAGE / EVALUATIONS_PAGE.
 */
const PARTICIPANTS_PAGE = 200;
const SEASON_ROSTER_PAGE = 200;
const EVALUATIONS_PAGE = 300;
// event_availability's read policy re-checks can_access_season per row, so a
// single unbounded page over a 1000-invite event runs that expensive predicate
// 1000× in one statement and trips the 8s statement timeout — which is exactly
// why the RSVPs failed to load (and, before the assemble was made resilient,
// took the whole schedule down with them). Bounded pages keep each statement
// cheap, same reasoning as SEASON_ROSTER_PAGE / EVALUATIONS_PAGE.
const AVAILABILITY_PAGE = 200;
/**
 * Rows per `get_event_availability()` call. Much larger than AVAILABILITY_PAGE
 * because the RPC authorizes once per event rather than once per row, so a page
 * costs roughly what its row count suggests — the reason the function exists.
 * It is bounded at all only because a set-returning RPC is still subject to
 * PostgREST's db-max-rows cap, so the client has to page to know it has
 * everything; keep this at or below that server-side limit or the short-page
 * check that ends the loop can never fire.
 */
const AVAILABILITY_RPC_PAGE = 1000;
/**
 * Events per statement when the RSVP read has to filter `event_availability`
 * itself. Small because that path pays the per-row policy: a chunk is one
 * statement's worth of events, and the chunks run concurrently.
 */
const EVENT_AVAILABILITY_EVENT_CHUNK = 25;

/**
 * Exactly the columns rowToPlayer / rowToEval read, rather than `*` plus a
 * wildcard embed. `athletes(*)` shipped every column of every athlete — medical
 * notes, guardian details, timestamps — to render a name and a jersey number,
 * on the read that is already the slowest thing in the app. Same trim the team
 * roster read got in listTeamRoster. Keep these in sync with the mappers: a
 * column dropped here silently becomes `undefined` there.
 */
const PARTICIPANT_SELECT =
  'id, tryout_id, athlete_id, anonymous, jersey, jersey_colour, position, shoots, ' +
  'assigned_assessor_id, current_team, current_level, position_trying_out_for, friend1_name, ' +
  'friend2_name, sort_out, waiver_accepted_at, registration_source, removed_at, created_at, ' +
  'updated_at, ' +
  'athletes(id, first_name, last_name, avatar_url, player_email, guardian_name, guardian_email, ' +
  'guardian_phone, guardian_user_id, year_of_birth, default_position, about, medical_info)';

const EVALUATION_SELECT =
  'id, tryout_id, participant_id, evaluator_user_id, evaluator_name, session, strengths, improve, ' +
  'recommendation, source, created_at, updated_at, evaluation_scores(rubric_key, value)';

const REGISTRATION_CHUNK = 20;

/**
 * Chunks in flight at once for a bulk placement. Each chunk is its own set of
 * round trips, so running them one at a time made a 1000-player selection (50
 * chunks) pay 50x its per-chunk latency in full. Bounded rather than unlimited
 * for the same reason as `DUMMY_MAX_CONCURRENCY.insert` — one shared Postgres
 * pooler behind every chunk's requests.
 */
const REGISTRATION_CHUNK_CONCURRENCY = 6;

/**
 * Headcount statements in flight at once for the list screens — see
 * countParticipantsByTryout(). Bounded rather than "all the tryouts at once"
 * for the same reason as REGISTRATION_CHUNK_CONCURRENCY: one shared Postgres
 * pooler sits behind every one of them, and an account with dozens of tryouts
 * would otherwise open dozens of simultaneous statements the moment its
 * dashboard mounts.
 */
const PARTICIPANT_COUNT_CONCURRENCY = 6;

/**
 * Guardian invite emails are fired after a chunk's accounts are resolved and
 * are best-effort (a missed invite doesn't block placement), so they're kept
 * off the placement critical path entirely and just bounded here so a chunk
 * with many new guardians doesn't burst-invoke the send-email function.
 */
const GUARDIAN_EMAIL_CONCURRENCY = 10;

/**
 * Distinct guardian emails resolved per `resolve_guardians_for_caller` call.
 * Deduplicated across the whole selection first (see
 * `resolveGuardiansForRegistrations`), so this only needs to cover as many
 * *distinct* guardians as a batch — kept small since each one can mean a
 * bcrypt hash plus an `auth.users`/`auth.identities` insert, and a long single
 * statement is exactly what risks a `statement_timeout` under load.
 */
const GUARDIAN_RESOLVE_BATCH = 50;

/** Players per `generate-test-players` call — sized so one Claude response stays
 * within a comfortable output length rather than risking a truncated batch. */
const AI_CHUNK = 20;

/** Extra attempts per AI chunk before it falls back to local generation. */
const AI_CHUNK_RETRIES = 2;

/**
 * Ceilings on how many requests a dummy batch keeps in flight. The actual width
 * is chosen per run by `concurrencyFor` — a 25-player batch has nothing to gain
 * from a wide burst, while the 1000-player ceiling wants everything at once.
 *
 * Writes land on one Postgres pooler, so `insert` is kept below the AI ceiling —
 * that pool has a fixed number of connections to share across the whole app, not
 * just this batch. The AI chunks are independent edge-function invocations that
 * scale out, so `ai` can go wider; 50 is exactly the chunk count of a 1000-player
 * run (1000 ÷ AI_CHUNK), so the largest batch allowed fires as a single wave.
 */
const DUMMY_MAX_CONCURRENCY = { insert: 20, ai: 50 } as const;

/**
 * Floor for `insertChunked`'s adaptive shrinking. A statement that still times
 * out with this few rows is not a chunking problem — it's a missing index or a
 * pathological policy — so the error surfaces instead of the batch dissolving
 * into thousands of single-row requests that would never finish either.
 */
const DUMMY_MIN_CHUNK = 25;

/** In-flight width for a run of `chunkCount` chunks: everything at once, capped. */
function concurrencyFor(chunkCount: number, max: number): number {
  return Math.max(1, Math.min(chunkCount, max));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run `task` over every item with at most `limit` in flight, returning results
 * **in input order** — never completion order, since callers zip the returned
 * ids against their own arrays. A worker pool rather than fixed-size waves, so
 * one slow request doesn't hold back the rest of its group.
 */
async function mapPool<T, R>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrencyFor(items.length, limit) }, async () => {
      for (let i = next++; i < items.length; i = next++) {
        results[i] = await task(items[i], i);
      }
    }),
  );
  return results;
}

/**
 * Did Postgres kill this statement for running past `statement_timeout`?
 *
 * PostgREST forwards the SQLSTATE, which `unwrap` preserves as `code`; the RPC
 * paths in this file throw a bare Error, so the message is matched too.
 */
function isStatementTimeout(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | undefined;
  if (err?.code === '57014') return true;
  return /canceling statement due to statement timeout/i.test(err?.message ?? '');
}

/**
 * Insert `items` in chunks of `size`, up to `DUMMY_MAX_CONCURRENCY.insert`
 * requests in flight, returning every chunk's rows concatenated in input order.
 * `task` gets the chunk's offset into `items` so a chunk can index into arrays
 * built by an earlier phase. `onProgress` fires as each chunk lands, with the
 * running item count — which climbs monotonically even though chunks may finish
 * out of order.
 *
 * A chunk that Postgres kills on the statement timeout (57014) is halved and
 * retried rather than failing the whole batch, down to `DUMMY_MIN_CHUNK`. Two
 * things make that safe and cheap:
 *
 *  - **Safe**, because the failure is atomic. PostgREST runs one statement per
 *    request, and a statement killed by the timeout is rolled back whole — not
 *    one row of the killed chunk was committed, so re-sending it cannot
 *    duplicate anything. (This is the same reason the batch as a whole is *not*
 *    retried anywhere: only the individual statement is atomic, the four-phase
 *    pipeline around it is not.)
 *  - **Cheap**, because the smaller size is written back into the run's shared
 *    `state`. Every chunk that hasn't started yet is then split before it is
 *    sent, so the batch pays for one timeout total instead of rediscovering the
 *    same ceiling — at 8s a go — once per chunk.
 */
async function insertChunked<T, R>(
  items: T[],
  size: number,
  task: (chunk: T[], offset: number) => Promise<R[]>,
  onProgress?: (done: number) => void,
): Promise<R[]> {
  const chunks: { rows: T[]; offset: number }[] = [];
  for (let i = 0; i < items.length; i += size) chunks.push({ rows: items.slice(i, i + size), offset: i });

  // Shared across the pool, so one chunk's discovery spares all the others.
  const state = { size };
  let done = 0;

  const send = async (rows: T[], offset: number): Promise<R[]> => {
    if (rows.length > state.size) {
      // Some chunk has already proved this many rows is too many. Split before
      // sending rather than spending another timeout to learn the same thing.
      const out: R[] = [];
      // `width` is read once per slice, never re-read after the await: another
      // worker can shrink `state.size` while this send is in flight, and an
      // `i += state.size` that picked up the new, smaller value would advance
      // past fewer rows than the slice consumed — re-sending the overlap and
      // duplicating real athletes and participants.
      for (let i = 0; i < rows.length; ) {
        const width = state.size;
        out.push(...(await send(rows.slice(i, i + width), offset + i)));
        i += width;
      }
      return out;
    }
    try {
      const inserted = await task(rows, offset);
      done += rows.length;
      onProgress?.(done);
      return inserted;
    } catch (e) {
      if (!isStatementTimeout(e) || rows.length <= DUMMY_MIN_CHUNK) throw e;
      state.size = Math.min(state.size, Math.max(DUMMY_MIN_CHUNK, Math.ceil(rows.length / 2)));
      return send(rows, offset);
    }
  };

  const results = await mapPool(chunks, DUMMY_MAX_CONCURRENCY.insert, (c) => send(c.rows, c.offset));
  return results.flat();
}

/** Coerce a caller-supplied count into a safe range, falling back if unusable. */
function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Math.floor(Number(value));
  return Math.max(min, Math.min(max, isFinite(n) && n > 0 ? n : fallback));
}
function toIso(ms: number | null | undefined): string | null {
  return ms != null ? new Date(ms).toISOString() : null;
}

const EVENT_TYPE_TO_DB: Record<EventType, string> = {
  Tryout: 'tryout',
  Assessment: 'assessment',
  'Sort Out': 'sort_out',
  Combine: 'combine',
};
const EVENT_TYPE_FROM_DB: Record<string, EventType> = {
  tryout: 'Tryout',
  assessment: 'Assessment',
  sort_out: 'Sort Out',
  combine: 'Combine',
};

const REC_TO_DB: Record<Exclude<Recommendation, ''>, string> = {
  Make: 'make',
  Keep: 'keep',
  Bubble: 'bubble',
  Release: 'release',
};
const REC_FROM_DB: Record<string, Recommendation> = {
  make: 'Make',
  keep: 'Keep',
  bubble: 'Bubble',
  release: 'Release',
};

const EVENT_KIND_TO_DB: Record<EventKind, string> = {
  Game: 'game',
  Practice: 'practice',
  Event: 'event',
};
const EVENT_KIND_FROM_DB: Record<string, EventKind> = {
  game: 'Game',
  practice: 'Practice',
  event: 'Event',
};

export class SupabaseDataSource implements DataSource {
  private userId: string | null = null;
  private accountId: string | null = null;
  /** In-flight ctx() account resolution, shared by concurrent callers. */
  private accountPromise: Promise<void> | null = null;
  private profileCache: Record<string, UserProfile> = {};

  private notImplemented(method: string): never {
    throw new Error(`SupabaseDataSource.${method}() not implemented yet.`);
  }

  // Resolves just the authenticated user id, without requiring an account/
  // membership. Guardians are provisioned with a `profiles` row but
  // intentionally no `accounts`/`memberships` row (see 0011_user_account_types.sql),
  // so guardian-only reads must use this instead of `ctx()`.
  private async userCtx(): Promise<{ supabase: SupabaseClient; userId: string }> {
    const supabase = getSupabase();
    let uId = this.userId;
    if (!uId) {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        uId = session.user.id;
      } else {
        const { data: u } = await supabase.auth.getUser();
        if (!u.user) throw new Error('Not authenticated');
        uId = u.user.id;
      }
      this.userId = uId;
    }
    return { supabase, userId: uId };
  }

  private async ctx(): Promise<{ supabase: SupabaseClient; userId: string; accountId: string }> {
    const { supabase, userId: uId } = await this.userCtx();
    if (!this.accountId) {
      // Share one lookup between everything that asks while it is in flight.
      // ctx() fronts ~90 datasource methods and the screens above it fire their
      // reads together, so the identical memberships query used to go out once
      // per caller — four times on the web dashboard's first paint, with every
      // caller then waiting on the slowest copy instead of the first. Cleared
      // in `finally` so only a *resolved* account is remembered; a failure
      // leaves the next caller to retry rather than handing it a cached
      // rejection.
      const pending = (this.accountPromise ??= this.resolveAccount(supabase, uId).finally(() => {
        // Only retire *this* lookup — a reset may have dropped it and started
        // a newer one, which clearing unconditionally would discard.
        if (this.accountPromise === pending) this.accountPromise = null;
      }));
      await pending;
    }
    if (!this.accountId) throw new Error('No account for user');
    return { supabase, userId: uId, accountId: this.accountId };
  }

  /**
   * The memberships read behind ctx(), factored out so concurrent callers can
   * share a single in-flight copy of it. Same selection rule and same error as
   * the code this replaced.
   */
  private async resolveAccount(supabase: SupabaseClient, uId: string): Promise<void> {
    // Fetch all memberships to determine the best account to use
    const m = await supabase
      .from('memberships')
      .select('account_id, role')
      .eq('user_id', uId)
      .order('created_at', { ascending: true });
    const memberships = m.data ?? [];

    // Pick the highest-privilege membership. Writes are gated by RLS on
    // has_account_role(account_id, ['owner','admin','coach']), so a staff user who is
    // *also* a guardian/assessor somewhere must still resolve to the account they can
    // write to. Only a pure guardian falls through to the coach's org.
    const RANK: Record<string, number> = { admin: 0, coach: 1, owner: 2, assessor: 3, guardian: 4 };
    const best = [...memberships].sort(
      (a: any, b: any) => (RANK[a.role] ?? 99) - (RANK[b.role] ?? 99),
    )[0];
    const accId: string | null = best?.account_id ?? null;
    if (!accId) throw new Error('No account for user');
    this.accountId = accId;
  }

  // `ctx()` caches accountId for the process lifetime. If the account backing
  // that id is deleted/recreated server-side (support reset, membership role
  // change) while the app is still running, every write fails RLS with a
  // stale id until the app restarts. Retry once with a forced re-resolve
  // instead of surfacing that as a dead end.
  private async withFreshAccount<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (isStaleAccountError(err)) {
        this.accountId = null;
        // Drop any in-flight ctx() lookup with it, so the next caller re-resolves
        // instead of awaiting an answer computed before this reset.
        this.accountPromise = null;
        return await fn();
      }
      throw err;
    }
  }

  /**
   * Resolve an account the signed-in user can actually WRITE to.
   *
   * ctx() caches accountId for the process lifetime and ranks *every* membership,
   * read-only ones (guardian/assessor) included. If that cached id is stale — the
   * account was deleted/recreated server-side — or resolves to a non-staff
   * membership, each insert fails RLS with "new row violates row-level security
   * policy". Writes therefore re-resolve, filtered to the roles the policies accept.
   */
  private async writableAccountId(): Promise<string> {
    const { supabase, userId } = await this.ctx();
    const { data } = await supabase
      .from('memberships')
      .select('account_id, role')
      .eq('user_id', userId)
      .in('role', WRITABLE_ROLES)
      .order('created_at', { ascending: true });
    const rows = (data ?? []) as Array<{ account_id: string; role: string }>;
    if (!rows.length) {
      throw new Error(
        'This account does not have permission to add players or assessments. Ask an owner or admin for coach access.',
      );
    }
    const RANK: Record<string, number> = { admin: 0, coach: 1, owner: 2 };
    const best = [...rows].sort((a, b) => (RANK[a.role] ?? 99) - (RANK[b.role] ?? 99))[0];
    this.accountId = best.account_id;
    return best.account_id;
  }

  private async markOnboarding(patch: Record<string, boolean>): Promise<void> {
    try {
      const { supabase, userId } = await this.ctx();
      const prof = await supabase
        .from('profiles')
        .select('onboarding_steps')
        .eq('id', userId)
        .single();
      const steps = { ...(prof.data?.onboarding_steps ?? {}), ...patch };
      await supabase.from('profiles').update({ onboarding_steps: steps }).eq('id', userId);
    } catch {
      // onboarding flags are best-effort; never block the primary mutation
    }
  }

  // ─── shape mappers ──────────────────────────────────────────────────────────
  private rowToPlayer(p: Row, assessorNameById: Record<string, string>): Player {
    const rawAthletes = p.athletes;
    const a = Array.isArray(rawAthletes) ? rawAthletes[0] : rawAthletes ?? {};
    return {
      id: p.id,
      athleteId: a.id,
      first: a.first_name ?? '',
      last: a.last_name ?? '',
      avatarUrl: a.avatar_url ?? undefined,
      anonymous: p.anonymous || undefined,
      jersey: p.jersey ?? undefined,
      jerseyColour: p.jersey_colour ?? undefined,
      pos: p.position ?? undefined,
      shoots: p.shoots ?? undefined,
      assignedAssessor: p.assigned_assessor_id ? assessorNameById[p.assigned_assessor_id] : undefined,
      playerEmail: a.player_email ?? undefined,
      guardianName: a.guardian_name ?? undefined,
      guardianEmail: a.guardian_email ?? undefined,
      guardianPhone: a.guardian_phone ?? undefined,
      linkedGuardianId: a.guardian_user_id ?? undefined,
      yearOfBirth: a.year_of_birth != null ? String(a.year_of_birth) : undefined,
      currentPosition: a.default_position ?? undefined,
      currentTeam: p.current_team ?? undefined,
      currentLevel: p.current_level ?? undefined,
      positionTryingOutFor: p.position_trying_out_for ?? undefined,
      aboutChild: a.about ?? undefined,
      medicalInfo: a.medical_info ?? undefined,
      friend1Name: p.friend1_name ?? undefined,
      friend2Name: p.friend2_name ?? undefined,
      sortOut: p.sort_out || undefined,
      waiverAcceptedAt: p.waiver_accepted_at ? toMs(p.waiver_accepted_at) : undefined,
      registrationSource: p.registration_source ?? undefined,
      createdAt: toMs(p.created_at),
      updatedAt: p.updated_at ? toMs(p.updated_at) : undefined,
    };
  }

  private rowToEval(e: Row): Evaluation {
    const scores: Record<string, number> = {};
    for (const s of e.evaluation_scores ?? []) scores[s.rubric_key] = Number(s.value);
    return {
      id: e.id,
      playerId: e.participant_id,
      date: e.created_at ? new Date(e.created_at).toISOString().split('T')[0] : '',
      evaluator: e.evaluator_name,
      session: e.session ?? 'Session 1',
      strengths: e.strengths ?? undefined,
      improve: e.improve ?? undefined,
      recommendation: e.recommendation ? REC_FROM_DB[e.recommendation] ?? '' : '',
      scores,
      source: e.source ?? undefined,
      createdAt: toMs(e.created_at),
      updatedAt: e.updated_at ? toMs(e.updated_at) : undefined,
    };
  }

  private rowToAssessor(a: Row): Assessor {
    return {
      name: a.name,
      email: a.email ?? '',
      role: a.role ?? 'assessor',
      status: a.status ?? 'accepted',
      userId: a.user_id ?? undefined,
    };
  }

  private rowToRegistration(r: Row): Registration {
    return {
      id: r.id,
      eventId: r.tryout_id,
      firstName: r.first_name,
      lastName: r.last_name,
      yearOfBirth: r.year_of_birth != null ? String(r.year_of_birth) : undefined,
      positionTryingOutFor: r.position_trying_out_for ?? undefined,
      playerEmail: r.player_email ?? undefined,
      guardianName: r.guardian_name,
      guardianEmail: r.guardian_email,
      guardianPhone: r.guardian_phone ?? undefined,
      currentTeam: r.current_team ?? undefined,
      currentLevel: r.current_level ?? undefined,
      aboutPlayer: r.about_player ?? undefined,
      medicalInfo: r.medical_info ?? undefined,
      friend1Name: r.friend1_name ?? undefined,
      friend2Name: r.friend2_name ?? undefined,
      status: r.status,
      paymentStatus: r.payment_status ?? undefined,
      createdAt: toMs(r.created_at),
      // Only present when this row came back from submit_public_registration.
      registrationFeeCents: r.registrationFeeCents ?? undefined,
      connectChargesEnabled: r.connectChargesEnabled ?? undefined,
    };
  }

  /**
   * Every row of `table` whose `column` is one of `ids`, read in pages.
   *
   * PostgREST caps any single response at the project's default row limit
   * (commonly 1000), silently truncating rather than erroring — so a query
   * spanning tryouts whose combined rows exceed that cap would otherwise
   * return an incomplete (or, for later tryouts in the batch, empty) result.
   *
   * Paged by **keyset** (`id > last id seen`), not OFFSET. OFFSET makes every
   * later page re-scan and re-authorize everything it has already skipped:
   * the row-level policy runs on candidate rows *before* LIMIT applies, so
   * `offset=5000` pays for 5000 rows' worth of `can_access_*` before
   * returning one. That is what produced 500s on the roster read once an
   * account had a few thousand participants — and shrinking the page alone
   * cannot fix it, only push the crossover point further out. Keyset paging
   * makes every page cost the same as the first regardless of how deep it is.
   *
   * `id` is the primary key, so ordering by it is total — pages can neither
   * overlap nor skip rows.
   */
  private async fetchAllByIn(
    table: string,
    select: string,
    column: string,
    ids: string[],
    pageSize = FETCH_PAGE_SIZE,
    onRows?: (soFar: number) => void,
  ): Promise<Row[]> {
    if (ids.length === 0) return [];

    // Keyset paging is sequential by construction — page N+1 needs the last id
    // of page N — so a read big enough to need several pages paid every page's
    // latency end to end. A tryout with a thousand participants and three
    // thousand evaluations is ~15 round trips in series before the roster
    // paints.
    //
    // So: read the first page exactly as before, and only fan out if it comes
    // back full. Most reads here are one short page — a small roster, an
    // assessor list — and those still cost precisely one request; sharding them
    // unconditionally would have turned every cheap read into eight, each
    // paying its own pass over the row-level policy. When there *is* more, the
    // rest of the key space is split into disjoint ranges that are keyset-paged
    // independently and all at once.
    const first = await this.fetchPage(table, select, column, ids, pageSize, [undefined, undefined]);
    onRows?.(first.length);
    if (first.length < pageSize) return first;

    // Shards run concurrently, so their row counts are tallied through one
    // shared counter rather than each reporting its own — onRows is meant to
    // read as "how far into the whole read are we", not restart from zero
    // once every shard's own count.
    let total = first.length;
    const cursor = keysetCursor(table, first);
    const rest = await mapPool(shardRangesAfter(cursor), SHARD_BOUNDS.length + 1, (range) =>
      this.fetchShard(table, select, column, ids, pageSize, range, (n) => onRows?.((total += n))),
    );
    return first.concat(rest.flat());
  }

  /**
   * One shard of fetchAllByIn: every matching row whose `id` falls in
   * `(from, to]`, read in keyset pages.
   */
  private async fetchShard(
    table: string,
    select: string,
    column: string,
    ids: string[],
    pageSize: number,
    [from, to]: ShardRange,
    onRows?: (n: number) => void,
  ): Promise<Row[]> {
    const out: Row[] = [];
    let cursor = from;
    for (;;) {
      const page = await this.fetchPage(table, select, column, ids, pageSize, [cursor, to]);
      out.push(...page);
      onRows?.(page.length);
      // A short page means the server had nothing left to give.
      if (page.length < pageSize) return out;
      cursor = keysetCursor(table, page);
    }
  }

  /** A single keyset page: up to `pageSize` matching rows with `from < id <= to`. */
  private async fetchPage(
    table: string,
    select: string,
    column: string,
    ids: string[],
    pageSize: number,
    [from, to]: ShardRange,
  ): Promise<Row[]> {
    const supabase = getSupabase();
    let q = supabase
      .from(table)
      .select(withKeysetColumn(select))
      .in(column, ids)
      .order('id')
      .limit(pageSize);
    if (from !== undefined) q = q.gt('id', from);
    if (to !== undefined) q = q.lte('id', to);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data ?? []) as Row[];
  }

  /**
   * Every evaluation (with its scores) for a batch of tryouts.
   *
   * Prefers get_evaluations_for_tryouts() — see
   * 20260826160000_evaluations_rpc_and_analyze.sql. Reading `evaluations` with
   * `evaluation_scores` embedded makes Postgres evaluate BOTH of that table's
   * permissive policies for every score row, and each one re-queries
   * `evaluations` and then can_access_tryout(). On a 1000-player x 5-session
   * assessment (~50,000 score rows) that is what overran the 8s statement
   * timeout and made the roster screen show "Could not load roster."; the RPC
   * authorizes once per tryout instead, admitting exactly the same rows.
   *
   * Keyset-paged because a `setof jsonb` RPC is still capped by PostgREST's
   * db-max-rows, exactly like a table read — taking one call's result as
   * complete would silently drop the excess.
   *
   * Any failure falls back to the embedded read rather than surfacing, so a
   * database that hasn't had the migration applied yet keeps working (just
   * slowly) instead of reporting an assessment with no evaluations at all —
   * which a coach would read as lost scores.
   */
  private async fetchEvaluationsForTryouts(ids: string[]): Promise<Row[]> {
    if (ids.length === 0) return [];
    const supabase = getSupabase();

    try {
      const rows: Row[] = [];
      let cursor: string | null = null;
      for (;;) {
        const { data, error } = await supabase.rpc('get_evaluations_for_tryouts', {
          p_tryout_ids: ids,
          p_after_id: cursor,
          p_limit: EVALUATIONS_PAGE,
        });
        if (error) throw new Error(error.message);
        const page = ((data as Row[]) ?? []) as Row[];
        rows.push(...page);
        // A short page means the server had nothing left to give.
        if (page.length < EVALUATIONS_PAGE) return rows;
        cursor = page[page.length - 1].id as string;
      }
    } catch (e) {
      console.warn(
        'get_evaluations_for_tryouts unavailable — falling back to the embedded read.',
        e,
      );
      return this.fetchAllByIn('evaluations', EVALUATION_SELECT, 'tryout_id', ids, EVALUATIONS_PAGE);
    }
  }

  private async assembleTryouts(tryoutRows: Row[]): Promise<Tryout[]> {
    if (tryoutRows.length === 0) return [];
    const ids = tryoutRows.map((t) => t.id);

    const [pRowsAll, aRows, eRows, rRows] = await Promise.all([
      this.fetchAllByIn('tryout_participants', PARTICIPANT_SELECT, 'tryout_id', ids, PARTICIPANTS_PAGE),
      this.fetchAllByIn('tryout_assessors', '*', 'tryout_id', ids),
      this.fetchEvaluationsForTryouts(ids),
      this.fetchAllByIn('registrations', '*', 'tryout_id', ids),
    ]);
    // Soft-removed players (see deletePlayer) stay in the table so their
    // evaluations still count toward the athlete's permanent profile history,
    // but they should no longer appear on this tryout's active roster.
    const pRows = pRowsAll.filter((p) => !p.removed_at);

    const assessorNameById: Record<string, string> = {};
    for (const a of aRows) assessorNameById[a.id] = a.name;

    const byTryout = (rows: Row[]) => {
      const map: Record<string, Row[]> = {};
      for (const r of rows) (map[r.tryout_id] ??= []).push(r);
      return map;
    };
    const pByT = byTryout(pRows);
    const aByT = byTryout(aRows);
    const eByT = byTryout(eRows);
    const rByT = byTryout(rRows);

    // Deduplicate evals by participant_id, evaluator_user_id, and session to hide existing corrupted duplicates
    for (const tryoutId of Object.keys(eByT)) {
      const uniqueEvals = new Map<string, Row>();
      for (const e of eByT[tryoutId]) {
        const key = `${e.participant_id}-${e.evaluator_user_id}-${e.session}`;
        const existing = uniqueEvals.get(key);

        const currentScoresLen = e.evaluation_scores?.length ?? 0;
        const existingScoresLen = existing?.evaluation_scores?.length ?? 0;

        // Prefer the duplicate that actually has scores; if tied, take the newest one
        if (
          !existing ||
          currentScoresLen > existingScoresLen ||
          (currentScoresLen === existingScoresLen && new Date(e.created_at) > new Date(existing.created_at))
        ) {
          uniqueEvals.set(key, e);
        }
      }
      eByT[tryoutId] = Array.from(uniqueEvals.values());
    }

    return tryoutRows.map((t) => {
      const settings = t.settings ?? { skaterWeights: {}, goalieWeights: {}, customRubrics: [] };
      const ai = t.ai_assessments ?? {};
      const { teamBuilder, ...aiAssessments } = ai;
      const roster = (pByT[t.id] ?? []).map((p) => this.rowToPlayer(p, assessorNameById));
      return {
        id: t.id,
        name: t.name,
        teamId: t.team_id ?? undefined,
        seasonId: t.season_id ?? undefined,
        createdAt: toMs(t.created_at),
        updatedAt: toMs(t.updated_at),
        eventType: EVENT_TYPE_FROM_DB[t.event_type] ?? 'Tryout',
        tryoutDate: t.tryout_date ?? undefined,
        startTime: t.start_time ?? undefined,
        endTime: t.end_time ?? undefined,
        rink: t.location ?? undefined,
        sport: t.sport,
        sportOther: t.sport_other ?? undefined,
        defaultPosition: t.default_position ?? undefined,
        headAssessor: t.head_assessor ?? undefined,
        headCoach: t.head_coach ?? undefined,
        assessors: (aByT[t.id] ?? []).map((a) => this.rowToAssessor(a)),
        roster,
        evals: (eByT[t.id] ?? []).map((e) => this.rowToEval(e)),
        registrations: (rByT[t.id] ?? []).map((r) => this.rowToRegistration(r)),
        settings,
        cloud: t.registration_code
          ? { id: t.registration_code, enabled: t.registration_open }
          : undefined,
        archived: t.archived,
        registrationFeeCents: t.registration_fee_cents ?? undefined,
        teamBuilder,
        aiAssessments: Object.keys(aiAssessments).length ? aiAssessments : undefined,
      } as Tryout;
    });
  }

  private async fetchPlayer(participantId: string): Promise<Player> {
    const supabase = getSupabase();
    const data = unwrap(
      await supabase.from('tryout_participants').select('*, athletes(*)').eq('id', participantId).single(),
    ) as Row;
    return this.rowToPlayer(data, {});
  }

  private async fetchEval(evalId: string): Promise<Evaluation> {
    const supabase = getSupabase();
    const data = unwrap(
      await supabase
        .from('evaluations')
        .select('*, evaluation_scores(rubric_key, value)')
        .eq('id', evalId)
        .single(),
    ) as Row;
    return this.rowToEval(data);
  }

  // ─── Auth ──────────────────────────────────────────────────────────────────
  private async loadUserProfile(userId: string): Promise<UserProfile> {
    if (this.profileCache[userId]) {
      return this.profileCache[userId];
    }
    const supabase = getSupabase();
    // Three independent lookups, all keyed on a userId we already hold: the
    // profile row, the memberships that carry the account (and therefore the
    // plan), and the Auth server's view of whether the address is confirmed.
    // Nothing here feeds anything else here, so awaiting them one after another
    // just stacked three round trips in front of *every* login and every cold
    // boot — this sits on the path from "signed in" to the first screen having
    // a session at all. Measured on web, where the same three cost
    // 1262ms + 755ms + 384ms in series.
    const [profileRes, membershipsRes, userRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).single(),
      supabase.from('memberships').select('role, accounts(*)').eq('user_id', userId),
      supabase.auth.getUser(),
    ]);

    // Unwrapped after the wave rather than inside it. A PostgREST call resolves
    // with `{ data, error }` instead of rejecting, so all three still complete
    // and a failing profile read throws from exactly the same place, with the
    // same error, as it did when these ran in series.
    const profile = unwrap(profileRes) as Row;
    // A *failed* membership read must not be read as "this user has no
    // membership". Everything the account carries — plan tier, org name, extra
    // team licenses, Connect flags — comes off these rows, so swallowing the
    // error silently signed a coach in as free-tier and persisted that, which
    // then reads as a bogus "you've reached your plan's limit". Seen for real
    // against a transient 401. An empty list with no error still means what it
    // always did: a guardian, provisioned with a profile and no membership row.
    if (membershipsRes.error) throw membershipsRes.error;
    const memberships = membershipsRes.data as Row[] | null;
    // Same priority as ctx(): a staff role (admin/coach/owner) always wins over
    // assessor/guardian, so the plan/limits shown here match the account that
    // team/tryout writes actually go through — not just whichever membership
    // happens to be oldest.
    const MEMBERSHIP_RANK: Record<string, number> = { admin: 0, coach: 1, owner: 2, assessor: 3, guardian: 4 };
    const membership = (memberships ?? [])
      .slice()
      .sort((a: any, b: any) => (MEMBERSHIP_RANK[a.role] ?? 99) - (MEMBERSHIP_RANK[b.role] ?? 99))[0] as Row | undefined;
    const account = Array.isArray(membership?.accounts)
      ? membership.accounts[0]
      : (membership?.accounts as Row | undefined);

    const { data: uData } = userRes;
    const metaAccountType = uData?.user?.user_metadata?.account_type;
    const rawRole = membership?.role ?? metaAccountType ?? 'coach';
    const role = rawRole === 'owner' ? 'admin' : rawRole;

    const emailVerified = uData?.user?.email_confirmed_at != null || uData?.user?.confirmed_at != null || !uData?.user;

    const result = {
      id: profile.id,
      email: profile.email,
      displayName: profile.display_name,
      organization: account?.type === 'organization' ? account.name : undefined,
      avatarUrl: profile.avatar_url ?? undefined,
      planTier: (account?.plan_tier as UserProfile['planTier']) ?? 'free',
      subscriptionStatus: account?.subscription_status,
      extraTeamLicenses: account?.extra_team_licenses ?? 0,
      connectChargesEnabled: !!account?.stripe_connect_charges_enabled,
      connectPayoutsEnabled: !!account?.stripe_connect_payouts_enabled,
      createdAt: toMs(profile.created_at),
      onboardingCompleted: profile.onboarding_completed,
      onboardingSteps: profile.onboarding_steps,
      role: role ?? undefined,
      emailVerified,
    };
    this.profileCache[userId] = result;
    return result;
  }

  private toAuthSession(session: Session, user: UserProfile): AuthSession {
    return { token: session.access_token, user, expiresAt: (session.expires_at ?? 0) * 1000 };
  }

  async login(email: string, password: string): Promise<AuthSession> {
    const supabase = getSupabase();
    const cleanEmail = email.trim();
    const { data, error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
    if (error) console.error('LOGIN ERROR:', error);
    if (error || !data.session) throw new Error(authErrorMessage(error, 'Login failed. Please try again.'));
    this.accountId = null;
    // Drop any in-flight ctx() lookup with it, so the next caller re-resolves
    // instead of awaiting an answer computed before this reset.
    this.accountPromise = null;
    this.userId = data.session.user.id;
    const user = await this.loadUserProfile(data.session.user.id);
    return this.toAuthSession(data.session, user);
  }

  async signup(displayName: string, email: string, password: string, accountType: string): Promise<AuthSession> {
    const supabase = getSupabase();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName, account_type: accountType } },
    });
    if (error) console.error('SIGNUP ERROR:', error);
    if (error) throw new Error(authErrorMessage(error, 'Signup failed. Please try again.'));
    let session = data.session;
    if (!session) {
      const { data: signIn, error: e2 } = await supabase.auth.signInWithPassword({ email, password });
      if (e2 || !signIn.session) {
        throw new Error('Account created. Please confirm your email, then log in.');
      }
      session = signIn.session;
    }
    this.accountId = null;
    // Drop any in-flight ctx() lookup with it, so the next caller re-resolves
    // instead of awaiting an answer computed before this reset.
    this.accountPromise = null;
    this.userId = session.user.id;
    const user = await this.loadUserProfile(session.user.id);
    return this.toAuthSession(session, user);
  }

  async logout(): Promise<void> {
    this.accountId = null;
    // Drop any in-flight ctx() lookup with it, so the next caller re-resolves
    // instead of awaiting an answer computed before this reset.
    this.accountPromise = null;
    this.userId = null;
    try {
      await getSupabase().auth.signOut();
    } catch (error) {
      console.warn('Supabase signOut failed, force clearing auth storage:', error);
    } finally {
      const { storage } = require('@/lib/storage');
      const keys = storage.getAllKeys();
      for (const key of keys) {
        if (key.includes('auth-token') || key.startsWith('sb-')) {
          storage.remove(key);
        }
      }
    }
  }

  async getSession(forceRefresh?: boolean): Promise<AuthSession | null> {
    const supabase = getSupabase();
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session) {
      this.userId = null;
      this.accountId = null;
      // Drop any in-flight ctx() lookup with it, so the next caller re-resolves
      // instead of awaiting an answer computed before this reset.
      this.accountPromise = null;
      return null;
    }
    try {
      this.userId = data.session.user.id;
      if (forceRefresh) {
        delete this.profileCache[data.session.user.id];
        // ctx() caches accountId for the process lifetime (it's the account every
        // team/tryout query and mutation runs against) — a forced refresh needs to
        // drop it too, or a plan/account change (e.g. a support-side account reset)
        // stays invisible to every non-profile query until the app is restarted.
        this.accountId = null;
        // Drop any in-flight ctx() lookup with it, so the next caller re-resolves
        // instead of awaiting an answer computed before this reset.
        this.accountPromise = null;
      }
      const user = await this.loadUserProfile(data.session.user.id);
      return this.toAuthSession(data.session, user);
    } catch (e) {
      console.warn('Failed to restore session profile, signing out:', e);
      this.userId = null;
      this.accountId = null;
      // Drop any in-flight ctx() lookup with it, so the next caller re-resolves
      // instead of awaiting an answer computed before this reset.
      this.accountPromise = null;
      await supabase.auth.signOut();
      return null;
    }
  }

  async getProfile(forceRefresh?: boolean): Promise<UserProfile | null> {
    const supabase = getSupabase();
    const { data } = await supabase.auth.getUser();
    if (!data.user) return null;
    if (forceRefresh) {
      delete this.profileCache[data.user.id];
    }
    return this.loadUserProfile(data.user.id);
  }

  async updateProfile(updates: Partial<UserProfile>): Promise<UserProfile> {
    const { supabase, userId, accountId } = await this.ctx();
    const profilePatch: Row = {};
    if (updates.displayName !== undefined) profilePatch.display_name = updates.displayName;
    if (updates.onboardingCompleted !== undefined)
      profilePatch.onboarding_completed = updates.onboardingCompleted;
    if (updates.onboardingSteps !== undefined) profilePatch.onboarding_steps = updates.onboardingSteps;
    if (updates.avatarUrl !== undefined) profilePatch.avatar_url = updates.avatarUrl;
    if (Object.keys(profilePatch).length) {
      unwrap(await supabase.from('profiles').update(profilePatch).eq('id', userId).select().single());
    }
    if (updates.planTier !== undefined || updates.organization !== undefined) {
      const accPatch: Row = {};
      if (updates.planTier !== undefined) accPatch.plan_tier = updates.planTier;
      if (updates.organization !== undefined) {
        accPatch.name = updates.organization;
        accPatch.type = 'organization';
      }
      await supabase.from('accounts').update(accPatch).eq('id', accountId);
    }
    delete this.profileCache[userId];
    return this.loadUserProfile(userId);
  }

  async updatePassword(password: string): Promise<void> {
    const { supabase } = await this.ctx();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw new Error(authErrorMessage(error, 'Could not update your password. Please try again.'));
  }

  async resendVerificationEmail(email: string): Promise<void> {
    const supabase = getSupabase();
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
    });
    if (error) throw new Error(authErrorMessage(error, 'Could not resend the verification email. Please try again.'));
  }

  async requestPasswordReset(email: string): Promise<void> {
    const supabase = getSupabase();

    // Check if the user email is registered using RLS-safe function
    const exists = await this.checkUserExistsByEmail(email);
    if (!exists) {
      throw new Error('Email address not found');
    }

    // Providing a redirectTo is generally needed for magic link/password reset flows in Supabase,
    // though the actual URL depends on the project setup. For Expo, an app scheme like 'aas://reset-password' is often used.
    // If none is provided, it falls back to the site url configured in Supabase.
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) throw new Error(authErrorMessage(error, 'Could not send a reset code right now. Please try again shortly.'));
  }

  async verifyPasswordResetOtp(email: string, token: string): Promise<void> {
    const supabase = getSupabase();
    const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'recovery' });
    if (error) throw new Error(authErrorMessage(error, 'That code is invalid or has expired.'));
    if (data.session) {
      this.accountId = null;
      // Drop any in-flight ctx() lookup with it, so the next caller re-resolves
      // instead of awaiting an answer computed before this reset.
      this.accountPromise = null;
      this.userId = null;
    }
  }

  async resetPasswordWithOtp(email: string, token: string, newPassword: string): Promise<void> {
    const supabase = getSupabase();
    const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'recovery' });
    if (error) throw new Error(authErrorMessage(error, 'That code is invalid or has expired.'));
    if (!data.session) throw new Error('Failed to start session after OTP verification');
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    if (updateError) throw new Error(authErrorMessage(updateError, 'Could not update your password. Please try again.'));
    this.accountId = null;
    // Drop any in-flight ctx() lookup with it, so the next caller re-resolves
    // instead of awaiting an answer computed before this reset.
    this.accountPromise = null;
    this.userId = null;
  }

  async checkUserExistsByEmail(email: string): Promise<boolean> {
    const supabase = getSupabase();
    // Using the secure RPC function to check without violating RLS
    const { data, error } = await supabase.rpc('check_user_exists', { lookup_email: email });
    if (error) {
      console.warn('checkUserExistsByEmail error:', error);
      return false; // Fail safe
    }
    return !!data;
  }

  async uploadCoachPhoto(userId: string, fileUri: string, fileType: string): Promise<string> {
    const { supabase } = await this.ctx();
    const RNFS = require('react-native-fs');

    const decodeBase64 = (base64Str: string): ArrayBuffer => {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
      const lookup = new Uint8Array(256);
      for (let i = 0; i < chars.length; i++) {
        lookup[chars.charCodeAt(i)] = i;
      }
      let bufferLength = base64Str.length * 0.75;
      const len = base64Str.length;
      let p = 0;

      if (base64Str[len - 1] === '=') {
        bufferLength--;
        if (base64Str[len - 2] === '=') {
          bufferLength--;
        }
      }

      const arrayBuffer = new ArrayBuffer(bufferLength);
      const bytes = new Uint8Array(arrayBuffer);

      for (let i = 0; i < len; i += 4) {
        const encoded1 = lookup[base64Str.charCodeAt(i)];
        const encoded2 = lookup[base64Str.charCodeAt(i + 1)];
        const encoded3 = lookup[base64Str.charCodeAt(i + 2)];
        const encoded4 = lookup[base64Str.charCodeAt(i + 3)];

        bytes[p++] = (encoded1 << 2) | (encoded2 >> 4);
        bytes[p++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
        bytes[p++] = ((encoded3 & 3) << 6) | (encoded4 & 63);
      }

      return arrayBuffer;
    };

    let cleanPath = fileUri;
    if (cleanPath.startsWith('file://')) {
      cleanPath = cleanPath.slice(7);
    }
    cleanPath = decodeURIComponent(cleanPath);

    const base64 = await RNFS.readFile(cleanPath, 'base64');
    const buffer = decodeBase64(base64);

    const fileExtension = fileType.split('/')[1] || 'jpg';
    const filePath = `coaches/${userId}.${fileExtension}`;

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(filePath, buffer, {
        contentType: fileType,
        upsert: true,
      });

    if (uploadError) {
      throw new Error(`Upload failed: ${uploadError.message}`);
    }

    const { data: { publicUrl } } = supabase.storage
      .from('avatars')
      .getPublicUrl(filePath);

    unwrap(
      await supabase
        .from('profiles')
        .update({ avatar_url: publicUrl })
        .eq('id', userId)
        .select()
        .single()
    );

    return publicUrl;
  }

  // ─── Database aggregate (used by global search) ──────────────────────────────
  async getDatabase(): Promise<Database> {
    const [profile, tryouts, teams, seasons] = await Promise.all([
      this.getProfile(),
      this.listTryouts(true),
      this.listTeams(),
      this.listSeasons(),
    ]);
    const tryoutMap: Record<string, Tryout> = {};
    for (const t of tryouts) tryoutMap[t.id] = t;
    const seasonMap: Record<string, Season> = {};
    for (const s of seasons) seasonMap[s.id] = s;
    return {
      version: 2,
      tryouts: tryoutMap,
      teams,
      seasons: seasonMap,
      orgs: {},
      orgMembers: {},
      profile: profile ?? undefined,
    };
  }

  saveDatabase(): Promise<void> {
    return this.notImplemented('saveDatabase');
  }

  // ─── Teams ───────────────────────────────────────────────────────────────────
  private rowToTeam(t: Row, managed = false, ownerPlanTier?: string): Team {
    let season = t.season_label ?? undefined;
    let logoUrl = t.logo_url ?? undefined;
    
    if (season && season.includes('|LOGO|')) {
      const parts = season.split('|LOGO|');
      season = parts[0] || undefined;
      logoUrl = parts[1];
    }

    return {
      id: t.id,
      name: t.name,
      logoUrl,
      season,
      collectsFees: t.collects_fees ?? undefined,
      registrationFeeCents: t.registration_fee_cents ?? undefined,
      brandColor: t.brand_color ?? undefined,
      managed: managed || undefined,
      ownerPlanTier: managed ? ((ownerPlanTier as Team['ownerPlanTier']) ?? undefined) : undefined,
      createdAt: toMs(t.created_at),
      updatedAt: t.updated_at ? toMs(t.updated_at) : undefined,
      archived: t.archived || undefined,
    };
  }

  async listTeams(): Promise<Team[]> {
    const { supabase, accountId } = await this.ctx();
    const rows = unwrap(
      await supabase
        .from('teams')
        .select('*')
        .eq('account_id', accountId)
        .eq('archived', false)
        .order('created_at', { ascending: false }),
    ) as Row[];

    // Teams a club has delegated to this user (CLUB mode) live on someone
    // else's account, so the query above can't see them. They come from a
    // separate RPC rather than by dropping the account_id filter and leaning on
    // RLS: has_account_access() is true for every account when the caller is a
    // platform admin, so an unfiltered select would hand admins every team on
    // the instance instead of their own.
    const { data: managedRows, error: managedErr } = await supabase.rpc('list_teams_managed_by_me');
    if (managedErr) {
      // Pre-migration instances have no such function. Own teams are still
      // correct without it, so degrade rather than failing the whole list.
      console.log('list_teams_managed_by_me unavailable:', managedErr.message);
      return rows.map((t) => this.rowToTeam(t));
    }

    const own = rows.map((t) => this.rowToTeam(t));
    const ownIds = new Set(own.map((t) => t.id));

    // Which club plan tier each delegated team should gate features against.
    // Best-effort: if this lookup fails (pre-migration instance), managed
    // teams just fall back to the caller's own tier via ownerPlanTier being
    // undefined — same degrade-gracefully approach as managedRows above.
    const { data: tierRows } = await supabase.rpc('list_managed_team_owner_tiers');
    const tierByTeamId = new Map(((tierRows ?? []) as Row[]).map((r) => [r.team_id, r.plan_tier as string]));

    const managed = ((managedRows ?? []) as Row[])
      // An owner/admin delegating a team to themselves would otherwise show it
      // twice; their own-account row wins, since it carries full rights.
      .filter((t) => !ownIds.has(t.id))
      .map((t) => this.rowToTeam(t, true, tierByTeamId.get(t.id)));

    return [...own, ...managed];
  }

  async createTeam(name: string, season?: string): Promise<Team> {
    return this.withFreshAccount(async () => {
      const { supabase } = await this.ctx();
      const accountId = await this.writableAccountId();
      const row = unwrap(
        await supabase
          .from('teams')
          .insert({ account_id: accountId, name, season_label: season ?? null })
          .select()
          .single(),
      ) as Row;
      await this.markOnboarding({ createTeam: true });
      return this.rowToTeam(row);
    });
  }


  async uploadTeamLogo(teamId: string, fileUri: string, fileType: string): Promise<string> {
    const { supabase } = await this.ctx();
    const RNFS = require('react-native-fs');

    const decodeBase64 = (base64Str: string): ArrayBuffer => {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
      const lookup = new Uint8Array(256);
      for (let i = 0; i < chars.length; i++) {
        lookup[chars.charCodeAt(i)] = i;
      }
      let bufferLength = base64Str.length * 0.75;
      if (base64Str.endsWith('==')) bufferLength -= 2;
      else if (base64Str.endsWith('=')) bufferLength -= 1;
      const arraybuffer = new ArrayBuffer(bufferLength);
      const bytes = new Uint8Array(arraybuffer);
      let p = 0;
      for (let i = 0; i < base64Str.length; i += 4) {
        const encoded1 = lookup[base64Str.charCodeAt(i)];
        const encoded2 = lookup[base64Str.charCodeAt(i + 1)];
        const encoded3 = lookup[base64Str.charCodeAt(i + 2)];
        const encoded4 = lookup[base64Str.charCodeAt(i + 3)];
        bytes[p++] = (encoded1 << 2) | (encoded2 >> 4);
        bytes[p++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
        bytes[p++] = ((encoded3 & 3) << 6) | (encoded4 & 63);
      }
      return arraybuffer;
    };

    const base64 = await RNFS.readFile(fileUri, 'base64');
    const buffer = decodeBase64(base64);

    const fileExtension = fileType.split('/')[1] || 'jpg';
    const filePath = `teams/${teamId}.${fileExtension}`;

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(filePath, buffer, {
        contentType: fileType,
        upsert: true,
      });

    if (uploadError) {
      throw new Error(`Upload failed: ${uploadError.message}`);
    }

    const { data: { publicUrl } } = supabase.storage
      .from('avatars')
      .getPublicUrl(filePath);

    const publicUrlWithCacheBuster = `${publicUrl}?v=${Date.now()}`;
    return publicUrlWithCacheBuster;
  }

  /**
   * A team's own roster. Independent of assessments — an athlete stays on the
   * team even if the assessment they were picked from is archived or deleted.
   *
   * Read the same way the tryout rosters are (see fetchAllByIn): **keyset**
   * pages, never `.range()`. OFFSET paging made every later page re-scan and
   * re-authorize every row it had already skipped — the row-level policy runs
   * on candidate rows before LIMIT applies — so on a 1,600-player roster the
   * last page cost eight pages' worth of `can_access_athlete()` before
   * returning a row, and the whole read ran serially on top of that.
   */
  async listTeamRoster(teamId: string): Promise<TeamRosterPlayer[]> {
    const { supabase } = await this.ctx();

    const [rows, teamRes] = await Promise.all([
      this.fetchAllByIn(
        'team_roster',
        // Only what rowToTeamRosterPlayer actually reads. The guardian contact
        // and medical columns are read deliberately — the team player detail
        // renders them, and sourcing them from the assessment roster instead
        // meant they showed "—" for anyone not on one. `athletes(*)` shipped
        // every column of every athlete to render a name and a birth year, and
        // a second embed (`tryouts:source_tryout_id(name)`) made PostgREST
        // evaluate the tryouts read policy once per roster row on top of the
        // athletes one — those names are resolved in a single follow-up query
        // below instead, since a roster of any size has only a handful of
        // source assessments.
        'id, team_id, athlete_id, jersey, position, source_tryout_id, created_at, athletes(id, first_name, last_name, year_of_birth, avatar_url, player_email, guardian_email, guardian_name, guardian_phone, guardian_user_id, medical_info)',
        'team_id',
        [teamId],
        TEAM_ROSTER_PAGE,
      ),
      supabase.from('teams').select('collects_fees').eq('id', teamId).maybeSingle(),
    ]);

    // Keyset paging orders by id, which is not the order a coach expects to
    // read a roster in. created_at ties are the norm here rather than the
    // exception — a bulk add writes a whole chunk on the same timestamp — so
    // id breaks them, exactly as the server-side ordering used to.
    rows.sort(
      (a, b) =>
        String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')) ||
        String(a.id).localeCompare(String(b.id)),
    );

    const sourceIds = [...new Set(rows.map((r) => r.source_tryout_id).filter(Boolean))] as string[];
    const athleteIds = rows.map((r) => r.athlete_id).filter(Boolean) as string[];

    const [nameBySourceId, feeStatusByAthlete] = await Promise.all([
      this.sourceTryoutNames(sourceIds),
      teamRes.data?.collects_fees
        ? this.teamFeeStatuses(supabase, teamId, athleteIds)
        : Promise.resolve(new Map<string, TeamRosterPlayer['feeStatus']>()),
    ]);

    return rows.map((r) =>
      this.rowToTeamRosterPlayer(
        r,
        feeStatusByAthlete.get(r.athlete_id),
        r.source_tryout_id ? nameBySourceId.get(r.source_tryout_id) : undefined,
      ),
    );
  }

  /** Names of the assessments a roster's players were pulled from, keyed by id. */
  private async sourceTryoutNames(ids: string[]): Promise<Map<string, string>> {
    const byId = new Map<string, string>();
    if (ids.length === 0) return byId;
    const rows = await this.fetchAllByIn('tryouts', 'id, name', 'id', ids);
    for (const t of rows) byId.set(t.id as string, t.name as string);
    return byId;
  }

  /**
   * Fee status per athlete for a fee-collecting team.
   *
   * Fee status lives on season_roster, not team_roster (a team's fee is charged
   * per season enrollment — see 20260811183700_season_team_fee_payments.sql),
   * so it has to be looked up separately and merged in by athlete.
   */
  private async teamFeeStatuses(
    supabase: SupabaseClient,
    teamId: string,
    athleteIds: string[],
  ): Promise<Map<string, TeamRosterPlayer['feeStatus']>> {
    const byAthlete = new Map<string, TeamRosterPlayer['feeStatus']>();
    if (athleteIds.length === 0) return byAthlete;

    const { data: teamSeasons } = await supabase.from('seasons').select('id').eq('team_id', teamId);
    const seasonIds = (teamSeasons ?? []).map((s) => s.id);
    if (seasonIds.length === 0) return byAthlete;

    // Batched for the same reason the roster read above is paged: a single
    // `.in()` carrying a whole large roster's athlete ids is both an enormous
    // URL and one statement's worth of RLS work. The batches are disjoint by
    // athlete, so running several at once can't change which row wins.
    const batches: string[][] = [];
    for (let i = 0; i < athleteIds.length; i += TEAM_ROSTER_PAGE) {
      batches.push(athleteIds.slice(i, i + TEAM_ROSTER_PAGE));
    }
    const pages = await mapPool(batches, ROSTER_LOOKUP_CONCURRENCY, async (batch) => {
      const { data } = await supabase
        .from('season_roster')
        .select('athlete_id, fee_status, created_at')
        .in('season_id', seasonIds)
        .in('athlete_id', batch)
        .order('created_at', { ascending: false });
      return (data ?? []) as Row[];
    });

    for (const page of pages) {
      for (const sr of page) {
        // Most recent season enrollment wins when an athlete has been on this
        // team across more than one season.
        if (!byAthlete.has(sr.athlete_id)) {
          byAthlete.set(sr.athlete_id, sr.fee_status as TeamRosterPlayer['feeStatus']);
        }
      }
    }
    return byAthlete;
  }

  private rowToTeamRosterPlayer(
    r: Row,
    feeStatus?: TeamRosterPlayer['feeStatus'],
    sourceTryoutName?: string,
  ): TeamRosterPlayer {
    const rawAthlete = r.athletes;
    const a = (Array.isArray(rawAthlete) ? rawAthlete[0] : rawAthlete) ?? {};
    return {
      id: r.id,
      athleteId: r.athlete_id,
      first: a.first_name ?? '',
      last: a.last_name ?? '',
      jersey: r.jersey ?? undefined,
      pos: r.position ?? undefined,
      yearOfBirth: a.year_of_birth ?? undefined,
      avatarUrl: a.avatar_url ?? undefined,
      playerEmail: a.player_email ?? undefined,
      guardianEmail: a.guardian_email ?? undefined,
      guardianName: a.guardian_name ?? undefined,
      guardianPhone: a.guardian_phone ?? undefined,
      linkedGuardianId: a.guardian_user_id ?? undefined,
      medicalInfo: a.medical_info ?? undefined,
      sourceTryoutId: r.source_tryout_id ?? undefined,
      sourceTryoutName,
      feeStatus,
    };
  }

  /**
   * Attach athletes to a team. Upserts on (team_id, athlete_id) so re-adding
   * someone already on the roster refreshes their jersey/position instead of
   * failing the whole batch on the unique constraint.
   */
  async addTeamRosterPlayers(
    teamId: string,
    entries: { athleteId: string; jersey?: string; pos?: string; sourceTryoutId?: string }[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<TeamRosterPlayer[]> {
    if (entries.length === 0) return [];
    const { supabase } = await this.ctx();
    // Collapse duplicate athletes within the batch — upsert rejects a payload
    // that hits the same conflict target twice.
    const byAthlete = new Map<string, (typeof entries)[number]>();
    for (const e of entries) if (e.athleteId) byAthlete.set(e.athleteId, e);
    const rosterRows = [...byAthlete.values()].map((e) => ({
      team_id: teamId,
      athlete_id: e.athleteId,
      jersey: e.jersey || null,
      position: e.pos || null,
      source_tryout_id: e.sourceTryoutId || null,
    }));

    // A single upsert with a large enough batch (hundreds+ rows — a real club
    // combine, not just test data) can outrun Postgres's statement timeout and
    // fail the whole write with nothing saved. Chunk it at the same size this
    // codebase already proved safe for a comparable upsert (REGISTRATION_CHUNK,
    // used for the registration bulk-placement path — see TODO.md 1i) rather
    // than guessing a larger number, and run several chunks at once: the wall
    // time was the sum of every chunk's latency, so a 1,600-player team paid 80
    // round trips strictly in series. Concurrency shortens the queue without
    // lengthening any single statement, which is what the timeout cares about.
    const chunks: (typeof rosterRows)[] = [];
    for (let i = 0; i < rosterRows.length; i += ROSTER_UPSERT_CHUNK) {
      chunks.push(rosterRows.slice(i, i + ROSTER_UPSERT_CHUNK));
    }
    // Progress covers this phase only, not the season-roster sync below — that
    // one's conditional and typically fast, and the batch that can actually run
    // long (hundreds+ athletes) is this one. Counted by completed rows rather
    // than by chunk index, since chunks no longer finish in order.
    let done = 0;
    onProgress?.(0, rosterRows.length);
    const pages = await mapPool(chunks, ROSTER_WRITE_CONCURRENCY, async (chunk) => {
      const rows = unwrap(
        await supabase
          .from('team_roster')
          .upsert(chunk, { onConflict: 'team_id,athlete_id' })
          // Returned rather than re-read: this used to end with a full
          // listTeamRoster(), so the bulk registration placement — which calls
          // in here once per 20-registration chunk — re-read the entire team
          // roster once per chunk.
          .select(
            'id, team_id, athlete_id, jersey, position, source_tryout_id, created_at, athletes(id, first_name, last_name, year_of_birth, player_email, guardian_email, guardian_name, guardian_phone, guardian_user_id, medical_info)',
          ),
      ) as Row[];
      done += chunk.length;
      onProgress?.(Math.min(rosterRows.length, done), rosterRows.length);
      return rows;
    });
    const upserted = pages.flat();

    // A season's roster is normally seeded from tryout_participants when the
    // season is *created* (createSeason) — a player added to the team roster
    // afterwards never gets that backfill. Season membership is what grants a
    // player's guardian access to the team (can_access_season): the fee status,
    // the schedule, and the team chat all key off it, so this syncs on every
    // add rather than only for fee-collecting teams. Teams with no season yet
    // are left alone; the flows that create one already sync the roster too.
    const { data: currentSeason } = await supabase
      .from('seasons')
      .select('id')
      .eq('team_id', teamId)
      .eq('archived', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (currentSeason) {
      const seasonRows = [...byAthlete.values()].map((e) => ({
        season_id: currentSeason.id,
        athlete_id: e.athleteId,
      }));
      const seasonChunks: (typeof seasonRows)[] = [];
      for (let i = 0; i < seasonRows.length; i += ROSTER_UPSERT_CHUNK) {
        seasonChunks.push(seasonRows.slice(i, i + ROSTER_UPSERT_CHUNK));
      }
      await mapPool(seasonChunks, ROSTER_WRITE_CONCURRENCY, async (chunk) => {
        await supabase
          .from('season_roster')
          .upsert(chunk, { onConflict: 'season_id,athlete_id', ignoreDuplicates: true });
      });
    }

    const sourceIds = [...new Set(upserted.map((r) => r.source_tryout_id).filter(Boolean))] as string[];
    const nameBySourceId = await this.sourceTryoutNames(sourceIds);
    return upserted.map((r) =>
      this.rowToTeamRosterPlayer(
        r,
        undefined,
        r.source_tryout_id ? nameBySourceId.get(r.source_tryout_id) : undefined,
      ),
    );
  }

  // Same shape as the assessment roster's "Add Player" (AddPlayerForm) — a
  // manually-added team player picks from or creates an athlete exactly the
  // same way, just attached to the team roster instead of tryout_participants.
  async addManualTeamPlayer(teamId: string, form: AddPlayerForm): Promise<{ athleteId: string }> {
    return this.withFreshAccount(() => this._addManualTeamPlayer(teamId, form));
  }

  private async _addManualTeamPlayer(teamId: string, form: AddPlayerForm): Promise<{ athleteId: string }> {
    const accountId = await this.writableAccountId();
    let athleteId = form.athleteId;
    if (typeof athleteId === 'object' && athleteId !== null) {
      athleteId = String((athleteId as any).id || athleteId);
    }
    if (!athleteId) {
      athleteId = await this.createAthlete(accountId, {
        first_name: form.first,
        last_name: form.last,
        year_of_birth: form.yearOfBirth ? Number(form.yearOfBirth) : null,
        guardian_name: form.guardianName || null,
        guardian_email: form.guardianEmail || null,
        guardian_phone: form.guardianPhone || null,
        player_email: form.playerEmail || null,
        medical_info: form.medicalInfo || null,
        about: form.aboutChild || null,
        avatar_url: form.avatarUrl || null,
      });
    }
    await this.addTeamRosterPlayers(teamId, [{ athleteId, jersey: form.jersey, pos: form.pos }]);
    return { athleteId };
  }

  async removeTeamRosterPlayer(teamId: string, athleteId: string): Promise<void> {
    const { supabase } = await this.ctx();
    unwrap(
      await supabase
        .from('team_roster')
        .delete()
        .eq('team_id', teamId)
        .eq('athlete_id', athleteId)
        .select('id'),
    );
  }

  /**
   * Invite a team's roster to the player/guardian portal.
   *
   * The season equivalent (sendPortalInvite) takes one player and one address
   * chosen by the caller. A team roster is invited as a set, and each player has
   * up to two addresses — their own and their guardian's — so the recipient list
   * is derived here rather than passed in.
   *
   * Every address is attempted. A player with no email on file, or an address
   * the send-email function rejects, is reported back rather than thrown: on a
   * roster of any size at least one of those is normal, and failing the whole
   * batch on it would leave the coach unable to tell who was actually invited.
   */
  async sendTeamRosterInvites(teamId: string, athleteIds?: string[]): Promise<TeamInviteResult> {
    const { supabase } = await this.ctx();

    // portal_invites.account_id is the *team's* owning account, not the
    // caller's: for a delegated team those differ, and its RLS policy is keyed
    // to the former — the same account team_roster's own policy checks.
    // accounts(name) rides along so the invite email can name the club that sent
    // it — a guardian with children at two clubs can't tell them apart otherwise.
    const team = unwrap(
      await supabase.from('teams').select('id, account_id, name, accounts(name)').eq('id', teamId).maybeSingle(),
    ) as Row | null;
    if (!team) throw new Error('Team not found');
    const rawAccount = team.accounts;
    const clubName = (Array.isArray(rawAccount) ? rawAccount[0] : rawAccount)?.name as string | undefined;

    const roster = await this.listTeamRoster(teamId);
    const invitees = athleteIds ? roster.filter((p) => athleteIds.includes(p.athleteId)) : roster;

    const result: TeamInviteResult = { sent: [], failed: [], skipped: [] };

    // One work item per (player, address). A player and their guardian each get
    // their own invite row and token, so accepting one doesn't consume the other.
    // The role travels with the address because the email is worded differently
    // for the player than for their guardian; when one address is on file as
    // both, Player wins and it's only sent once.
    const targets: { player: TeamRosterPlayer; email: string; role: 'Player' | 'Guardian' }[] = [];
    for (const p of invitees) {
      const byEmail = new Map<string, 'Player' | 'Guardian'>();
      const guardian = p.guardianEmail?.trim();
      if (guardian) byEmail.set(guardian, 'Guardian');
      const own = p.playerEmail?.trim();
      if (own) byEmail.set(own, 'Player');
      if (byEmail.size === 0) {
        result.skipped.push(`${p.first} ${p.last}`.trim() || 'Unnamed player');
        continue;
      }
      for (const [email, role] of byEmail) targets.push({ player: p, email, role });
    }

    if (targets.length === 0) return result;

    // Same bounded fan-out as the other per-recipient email loops — each target
    // is an insert plus a send-email call, and a full roster sent serially is
    // the dominant cost of the whole operation.
    await mapPool(targets, GUARDIAN_EMAIL_CONCURRENCY, async ({ player, email, role }) => {
      try {
        unwrap(
          await supabase
            .from('portal_invites')
            .insert({
              account_id: team.account_id,
              athlete_id: player.athleteId,
              team_id: teamId,
              email,
              token: generateId('invite').slice(0, 20),
            })
            .select('id'),
        );
        await this.sendEmail('player_invite', email, {
          playerName: `${player.first} ${player.last}`.trim(),
          teamName: team.name,
          clubName,
          jersey: player.jersey,
          position: player.pos,
          role,
        });
        result.sent.push(email);
      } catch (e) {
        result.failed.push({ email, message: e instanceof Error ? e.message : 'Could not send invite.' });
      }
    });

    return result;
  }

  async deleteTeam(id: string): Promise<void> {
    const { supabase } = await this.ctx();
    // Assessments outlive the team they were grouped under — detach them so they
    // show up as unlinked and can be attached to another team. Goes through an
    // RPC, not a plain update: a tryout created by a delegated manager (or, from
    // a manager's side, one created by the club) can carry an account_id other
    // than the caller's own, and no RLS policy's WITH CHECK can authorize nulling
    // team_id on such a row directly — see migration
    // 20260821100000_fix_team_delete_tryout_detach.sql for the full story.
    const { error: detachError } = await supabase.rpc('detach_team_tryouts', { p_team_id: id });
    if (detachError) throw new Error(detachError.message);
    // The team's schedule goes with it; a new team provisions its own season.
    unwrap(await supabase.from('seasons').update({ archived: true }).eq('team_id', id).select());
    // `.maybeSingle()` on its own hides an RLS-blocked write: an update that
    // matches zero rows comes back as { data: null, error: null }, identical to
    // a genuine "no row with this id" — so a delete silently blocked by teams_rw
    // (caller isn't owner/admin/coach on this team's account) looked like a
    // successful delete. Same silent-no-op trap as the team-chat and
    // assessor-status deletes; check the row actually came back before treating
    // this as done, same as the caller's own confirm-then-navigate assumes.
    const row = unwrap(
      await supabase.from('teams').update({ archived: true }).eq('id', id).select().maybeSingle(),
    );
    if (!row) {
      throw new Error(
        "This team couldn't be deleted. You need to be an owner, admin, or coach on the account that owns it.",
      );
    }
  }

  // --------------------------------------------------------------------------
  // Team managers (CLUB mode)
  // --------------------------------------------------------------------------

  async listTeamManagers(teamId: string): Promise<import('../types').TeamManager[]> {
    const { supabase } = await this.ctx();
    const { data, error } = await supabase.rpc('list_team_managers', { team_uuid: teamId });
    if (error) {
      // Nothing in the UI should hard-fail because an instance predates the
      // migration — an empty list reads the same as "nobody delegated yet".
      console.log('list_team_managers unavailable:', error.message);
      return [];
    }
    return ((data ?? []) as any[]).map((r) => this.rowToTeamManager(r));
  }

  async inviteTeamManager(
    teamId: string,
    email: string,
    role: import('../types').TeamManagerRole = 'manager',
    name?: string,
  ): Promise<import('../types').TeamManager> {
    const { supabase } = await this.ctx();

    // Read server-side rather than trusting a client-supplied team name — this
    // is the only place that name reaches an email, and the RPC below already
    // needs a round trip anyway.
    const teamRow = (await supabase.from('teams').select('name').eq('id', teamId).maybeSingle()).data as
      | Row
      | null;
    const teamName = teamRow?.name || 'a team';

    const invite = async () =>
      await supabase.rpc('invite_team_manager_by_email', {
        team_uuid: teamId,
        lookup_email: email.trim(),
        manager_role: role,
      });

    let { data, error } = await invite();
    let password: string | undefined;

    // The invitee may not have an account yet. Stand one up the same way staff
    // invites do (create-user edge function -> real GoTrue password hash), then
    // retry the delegation once so the club isn't blocked on the coach signing
    // up first.
    if (error && error.message.includes('User not found')) {
      // Same shape the guardian auto-invite uses at line ~1747: 8 random chars
      // plus a fixed suffix so it always clears GoTrue's complexity rules.
      password = Math.random().toString(36).slice(-8) + 'Aa1!';
      const { data: created, error: fnError } = await supabase.functions.invoke('create-user', {
        body: {
          email: email.trim(),
          password,
          display_name: name?.trim() || email.trim().split('@')[0],
          account_type: 'coach',
        },
      });
      if (fnError) {
        let msg = fnError.message;
        try {
          const body = await (fnError as any).context.json();
          if (body?.error) msg = body.error;
        } catch {}
        throw new Error(msg || 'Could not create an account for that email address');
      }
      if ((created as any)?.error) throw new Error((created as any).error);

      ({ data, error } = await invite());
      if (error) throw error;
    } else if (error) {
      throw error;
    }

    // Sent either way now: an existing coach getting handed a team is exactly
    // as much "you now have access to this" as one who needed an account
    // created for them — only the credentials block differs (password is
    // undefined on the existing-user path, so tplTeamManagerInvite omits it).
    try {
      await this.sendEmail('team_manager_invite', email.trim(), { teamName, role, password });
    } catch (e) {
      console.log('Failed to send team manager invite email:', e);
    }

    return this.rowToTeamManager(data);
  }

  async removeTeamManager(managerId: string): Promise<void> {
    const { supabase } = await this.ctx();
    const { error } = await supabase.rpc('remove_team_manager', { manager_id: managerId });
    if (error) throw error;
  }

  /** Every team's managers in one pass, for the callers that hold team ids. */
  private async fetchTeamManagers(teamIds: string[]): Promise<import('../types').TeamManager[]> {
    if (teamIds.length === 0) return [];
    const lists = await Promise.all(teamIds.map((id) => this.listTeamManagers(id)));
    return lists.flat();
  }

  private rowToTeamManager(r: any): import('../types').TeamManager {
    return {
      id: r.id,
      teamId: r.teamId ?? r.team_id,
      userId: r.userId ?? r.user_id,
      email: r.email,
      name: r.name ?? undefined,
      role: (r.role ?? 'manager') as import('../types').TeamManagerRole,
      createdAt: r.created_at ? toMs(r.created_at) : Date.now(),
    };
  }

  async updateTeam(id: string, updates: Partial<Team>): Promise<Team> {
    const { supabase } = await this.ctx();
    const patch: any = {};
    if (updates.name !== undefined) patch.name = updates.name;
    if (updates.archived !== undefined) patch.archived = updates.archived;
    
    // Fetch existing to preserve season/logo during hijacking
    const existingRow = unwrap(await supabase.from('teams').select().eq('id', id).single()) as Row;
    const currentTeam = this.rowToTeam(existingRow);
    
    const newSeason = updates.season !== undefined ? updates.season : currentTeam.season;
    const newLogoUrl = updates.logoUrl !== undefined ? updates.logoUrl : currentTeam.logoUrl;

    if (updates.logoUrl !== undefined) patch.logo_url = updates.logoUrl;
    if (updates.season !== undefined) patch.season_label = updates.season;
    if (updates.collectsFees !== undefined) patch.collects_fees = updates.collectsFees;
    if (updates.registrationFeeCents !== undefined) {
      patch.registration_fee_cents = updates.registrationFeeCents || null;
    }
    // Empty string clears the colour back to the app theme; the column's CHECK
    // only accepts #RRGGBB or NULL.
    if (updates.brandColor !== undefined) patch.brand_color = updates.brandColor || null;

    // Try standard update first
    const { data, error } = await supabase.from('teams').update(patch).eq('id', id).select().single();
    
    if (error) {
      if (error.message.includes('logo_url')) {
        // Fallback: encode logo in season_label
        delete patch.logo_url;
        if (newLogoUrl) {
          patch.season_label = `${newSeason || ''}|LOGO|${newLogoUrl}`;
        } else {
          patch.season_label = newSeason || null;
        }
        const fallbackRow = unwrap(await supabase.from('teams').update(patch).eq('id', id).select().single()) as Row;
        return this.rowToTeam(fallbackRow);
      }
      unwrap({ error, data: null }); // throw other errors
    }
    
    return this.rowToTeam(data as Row);
  }

  // ─── Tryouts ──────────────────────────────────────────────────────────────────
  /**
   * Every tryout row the caller can see, from all three sources, de-duplicated.
   *
   * The three reads go out together rather than one after another: they are
   * independent, and awaiting them in series put three full round trips in
   * front of the dashboard before any child data was even requested.
   */
  private async fetchVisibleTryoutRows(includeArchived: boolean): Promise<Row[]> {
    const { supabase, accountId } = await this.ctx();
    let q = supabase
      .from('tryouts')
      .select('*')
      .eq('account_id', accountId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });
    if (!includeArchived) q = q.eq('archived', false);

    // Assessments linked to a team delegated to this user (CLUB mode) live on
    // the club's account, so the account_id filter above can't see them — same
    // reasoning as listTeams()'s managed-teams merge. Pre-migration instances
    // have no such function; own tryouts are still correct without it.
    //
    // The second RPC is the mirror image: a manager creating a *new* assessment
    // for a team always inserts it under their own account (createTryout always
    // does), so the club owner needs this to see it too — without it, a team
    // the club owns could have assessments on it the club's own staff never
    // see listed, only the delegate who happened to create them.
    const [ownRes, managedRes, ownedTeamRes] = await Promise.all([
      q,
      supabase.rpc('list_tryouts_for_managed_teams'),
      supabase.rpc('list_tryouts_on_my_owned_teams'),
    ]);

    const rows = unwrap(ownRes) as Row[];
    // Each RPC is judged on its own. The version this replaced abandoned the
    // second one whenever the first was unavailable, which hid assessments on
    // the club's own teams on any deployment missing only the first function.
    if (managedRes.error) console.log('list_tryouts_for_managed_teams unavailable:', managedRes.error.message);
    if (ownedTeamRes.error) console.log('list_tryouts_on_my_owned_teams unavailable:', ownedTeamRes.error.message);

    const seen = new Set(rows.map((t) => t.id as string));
    const extra: Row[] = [];
    for (const source of [managedRes.data, ownedTeamRes.data]) {
      for (const t of (source ?? []) as Row[]) {
        if (seen.has(t.id)) continue;
        if (t.deleted_at || (!includeArchived && t.archived)) continue;
        seen.add(t.id);
        extra.push(t);
      }
    }
    return [...rows, ...extra];
  }

  async listTryouts(includeArchived = false): Promise<Tryout[]> {
    return this.assembleTryouts(await this.fetchVisibleTryoutRows(includeArchived));
  }

  /**
   * The list screens' read — see TryoutSummary.
   *
   * assembleTryouts() pulls every participant (joined to its athlete), every
   * evaluation (joined to its scores) and every registration in the account to
   * produce cards that show a name, a sport, a date and a headcount. Here the
   * only child reads are the assessors and a per-tryout COUNT, so the payload
   * stops scaling with how much scoring an account has done.
   */
  async listTryoutSummaries(includeArchived = false): Promise<TryoutSummary[]> {
    return this.summariseTryouts(await this.fetchVisibleTryoutRows(includeArchived));
  }

  /**
   * Every athlete on any of the account's assessment rosters, one row per
   * (athlete, assessment) — the candidate pool behind a team's "Add Players
   * from Assessments" picker.
   *
   * That picker used to run off listTryouts(), which assembles every
   * evaluation joined to its scores and every registration in the account just
   * so a list of names can be drawn. This reads the participants (and only the
   * athlete columns the picker renders) and nothing else, so opening the picker
   * no longer costs the heaviest query in the app.
   */
  async listAssessmentAthletes(): Promise<AssessmentAthlete[]> {
    const tryoutRows = await this.fetchVisibleTryoutRows(false);
    if (tryoutRows.length === 0) return [];
    const nameById = new Map(tryoutRows.map((t) => [t.id as string, t.name as string]));

    const rows = await this.fetchAllByIn(
      'tryout_participants',
      'id, tryout_id, athlete_id, jersey, position, removed_at, athletes(id, first_name, last_name, year_of_birth, guardian_email)',
      'tryout_id',
      [...nameById.keys()],
      PARTICIPANTS_PAGE,
    );

    const out: AssessmentAthlete[] = [];
    for (const r of rows) {
      // Soft-removed players are off the active roster (see deletePlayer), so
      // they must not be offered as candidates.
      if (r.removed_at) continue;
      const rawAthlete = r.athletes;
      const a = (Array.isArray(rawAthlete) ? rawAthlete[0] : rawAthlete) ?? {};
      const athleteId = (a.id ?? r.athlete_id) as string | undefined;
      if (!athleteId) continue;
      out.push({
        athleteId,
        first: a.first_name ?? '',
        last: a.last_name ?? '',
        jersey: r.jersey ?? undefined,
        pos: r.position ?? undefined,
        yearOfBirth: a.year_of_birth != null ? String(a.year_of_birth) : undefined,
        guardianEmail: a.guardian_email ?? undefined,
        tryoutId: r.tryout_id,
        tryoutName: nameById.get(r.tryout_id) ?? '',
      });
    }
    return out;
  }

  /**
   * Active roster size per tryout, for the list cards.
   *
   * One `COUNT(*)` per tryout, several in flight at once — the cards only ever
   * show these numbers, and counting server-side transfers no rows at all.
   * Paging the ids back to count them in JS costs a page per thousand
   * participants, strictly serially; on the web app, where this was profiled,
   * that was 8.4s for an account with ~5,700 participants versus ~1.7s here.
   *
   * `count: 'exact'` is deliberately *not* used the way it once was on the full
   * roster read — that one embedded `athletes(*)`, so counting forced
   * can_access_athlete() over every matching row and overran the statement
   * timeout during login (see "Fix login timeout: stop requesting exact count
   * on tryout roster reads"). This selects a single column off
   * tryout_participants with no embed, so only that table's own policy runs.
   *
   * Any failure — a timeout on an account with one enormous tryout, most
   * likely — falls through to the paged read, so the worst case is one wasted
   * round trip rather than a missing or wrong headcount.
   */
  private async countParticipantsByTryout(
    supabase: SupabaseClient,
    ids: string[],
  ): Promise<Record<string, number>> {
    const byTryout: Record<string, number> = {};
    if (ids.length === 0) return byTryout;
    try {
      const counts = await mapPool(ids, PARTICIPANT_COUNT_CONCURRENCY, async (tryoutId) => {
        const { count, error } = await supabase
          .from('tryout_participants')
          .select('id', { count: 'exact', head: true })
          // Soft-removed players are off the active roster, so they must not be
          // counted on the card — same filter assembleTryouts applies.
          .eq('tryout_id', tryoutId)
          .is('removed_at', null);
        if (error) throw error;
        return count ?? 0;
      });
      ids.forEach((id, i) => {
        byTryout[id] = counts[i];
      });
      return byTryout;
    } catch (error) {
      console.warn('Counting participants per tryout failed — falling back to the paged read.', error);
    }

    // `id` rides along only because keyset paging orders by it; nothing here
    // reads it.
    const rows = await this.fetchAllByIn('tryout_participants', 'id, tryout_id, removed_at', 'tryout_id', ids);
    for (const p of rows) {
      if (p.removed_at) continue;
      byTryout[p.tryout_id] = (byTryout[p.tryout_id] ?? 0) + 1;
    }
    return byTryout;
  }

  private async summariseTryouts(tryoutRows: Row[]): Promise<TryoutSummary[]> {
    if (tryoutRows.length === 0) return [];
    const supabase = getSupabase();
    const ids = tryoutRows.map((t) => t.id as string);

    const [countByTryout, aRows] = await Promise.all([
      this.countParticipantsByTryout(supabase, ids),
      this.fetchAllByIn('tryout_assessors', '*', 'tryout_id', ids),
    ]);

    const assessorsByTryout: Record<string, Assessor[]> = {};
    for (const a of aRows) (assessorsByTryout[a.tryout_id] ??= []).push(this.rowToAssessor(a));

    return tryoutRows.map((t) => ({
      id: t.id,
      name: t.name,
      teamId: t.team_id ?? undefined,
      seasonId: t.season_id ?? undefined,
      createdAt: toMs(t.created_at),
      updatedAt: toMs(t.updated_at),
      eventType: EVENT_TYPE_FROM_DB[t.event_type] ?? 'Tryout',
      tryoutDate: t.tryout_date ?? undefined,
      startTime: t.start_time ?? undefined,
      rink: t.location ?? undefined,
      sport: t.sport,
      sportOther: t.sport_other ?? undefined,
      assessors: assessorsByTryout[t.id] ?? [],
      playerCount: countByTryout[t.id] ?? 0,
      archived: !!t.archived,
    }));
  }


  async getTryout(id: string): Promise<Tryout | null> {
    const { supabase } = await this.ctx();
    const row = (
      await supabase.from('tryouts').select('*').eq('id', id).is('deleted_at', null).maybeSingle()
    ).data as Row | null;
    if (!row) return null;
    const [assembled] = await this.assembleTryouts([row]);
    return assembled ?? null;
  }

  async listAssignedTryouts(): Promise<Tryout[]> {
    return this.assembleTryouts(await this.fetchAssignedTryoutRows());
  }

  /**
   * listAssignedTryouts() in the light shape — see listTryoutSummaries(). The
   * dashboard's "Assigned to me" list only needs the name, sport, headcount and
   * the caller's own assessor row (to know whether the invite is still pending).
   */
  async listAssignedTryoutSummaries(): Promise<TryoutSummary[]> {
    return this.summariseTryouts(await this.fetchAssignedTryoutRows());
  }

  private async fetchAssignedTryoutRows(): Promise<Row[]> {
    const { supabase, userId, accountId } = await this.ctx();
    const links = unwrap(
      await supabase.from('tryout_assessors').select('tryout_id').eq('user_id', userId).neq('status', 'declined'),
    ) as Row[];
    const ids = [...new Set(links.map((l) => l.tryout_id))];
    if (!ids.length) return [];
    const rows = unwrap(
      await supabase.from('tryouts').select('*').in('id', ids).eq('archived', false).is('deleted_at', null),
    ) as Row[];

    // Exclude tryouts already surfaced by listTryouts(): the caller's own
    // account, a team delegated to them, or their own team a delegate
    // created an assessment under (CLUB mode). Comparing account_id to the
    // caller's single resolved ctx().accountId alone isn't enough for the
    // latter two — those two return tryouts under an account_id that isn't
    // the caller's ctx() account, so without this a club owner or coach who
    // (as an assessor) is also staff on a delegated team's account, or a
    // delegate managing a team, would see the same tryout listed twice.
    const [managedRes, ownedTeamRes] = await Promise.all([
      supabase.rpc('list_tryouts_for_managed_teams'),
      supabase.rpc('list_tryouts_on_my_owned_teams'),
    ]);
    const ownIds = new Set<string>([
      ...rows.filter((t) => t.account_id === accountId).map((t) => t.id as string),
      ...((managedRes.data ?? []) as Row[]).map((t) => t.id as string),
      ...((ownedTeamRes.data ?? []) as Row[]).map((t) => t.id as string),
    ]);
    return rows.filter((t) => !ownIds.has(t.id as string));
  }

  async acceptAssignedTryout(tryoutId: string): Promise<void> {
    const { supabase } = await this.ctx();
    const { error } = await supabase.rpc('set_assessor_status', { p_tryout_id: tryoutId, p_status: 'accepted' });
    if (error) throw new Error(error.message);
  }

  async rejectAssignedTryout(tryoutId: string): Promise<void> {
    const { supabase } = await this.ctx();
    const { error } = await supabase.rpc('set_assessor_status', { p_tryout_id: tryoutId, p_status: 'declined' });
    if (error) throw new Error(error.message);
  }

  async createTryout(form: CreateAssessmentForm): Promise<Tryout> {
    return this.withFreshAccount(() => this._createTryout(form));
  }

  private async _createTryout(form: CreateAssessmentForm): Promise<Tryout> {
    const { supabase, userId } = await this.ctx();
    let accountId = await this.writableAccountId();

    // A new assessment for a team belongs to whoever owns the team, not
    // whoever happens to be creating it. Without this, an assessment a
    // delegate creates for a club's team would sit under the delegate's own
    // account — counting against the delegate's own plan limits instead of
    // the club's, and orphaned from the club's account entirely if the
    // delegation is ever revoked. `tryouts_manager_write`'s RLS check only
    // requires team_id + being a manager/owner of that team, not account_id
    // matching the caller's own — so inserting under the team's real account
    // is already permitted, this just does it. A no-op when the caller owns
    // the team themselves, since teamRow.account_id then equals accountId.
    if (form.teamId) {
      const teamRow = (
        await supabase.from('teams').select('account_id').eq('id', form.teamId).maybeSingle()
      ).data as Row | null;
      if (teamRow?.account_id) accountId = teamRow.account_id;
    }

    const profile = await this.loadUserProfile(userId);
    const weights = getDefaultWeights(form.sport);
    const settings = {
      skaterWeights: weights.skater,
      goalieWeights: weights.goalie,
      customRubrics: [],
    };
    const row = unwrap(
      await supabase
        .from('tryouts')
        .insert({
          account_id: accountId,
          team_id: form.teamId ?? null,
          name: form.name,
          event_type: EVENT_TYPE_TO_DB[form.eventType] ?? 'tryout',
          sport: form.sport,
          sport_other: form.sportOther ?? null,
          tryout_date: form.tryoutDate || null,
          start_time: form.startTime ?? null,
          end_time: form.endTime ?? null,
          location: form.rink ?? null,
          head_coach: form.headCoach ?? profile.displayName,
          head_assessor: form.headAssessor ?? profile.displayName,
          settings,
        })
        .select()
        .single(),
    ) as Row;

    // Seed the creator as the lead assessor.
    await supabase.from('tryout_assessors').insert({
      tryout_id: row.id,
      user_id: userId,
      name: profile.displayName,
      email: profile.email,
      role: 'lead',
      status: 'accepted',
      joined_at: new Date().toISOString(),
    });

    // When the assessment is created inside a team, auto-import the team's
    // roster so the coach doesn't have to re-add every player manually.
    if (form.teamId) {
      try {
        // Paged, not a bare `.select()`: PostgREST caps an unbounded response at
        // the project's row limit (commonly 1000), so a team with more players
        // than that silently had only its first page imported — see
        // fetchAllByIn.
        const teamRosterRows = await this.fetchAllByIn(
          'team_roster',
          'athlete_id, jersey, position',
          'team_id',
          [form.teamId],
          TEAM_ROSTER_PAGE,
        );

        if (teamRosterRows.length > 0) {
          const participants = teamRosterRows.map((r) => ({
            tryout_id: row.id,
            athlete_id: r.athlete_id,
            jersey: r.jersey ?? null,
            position: r.position ?? null,
            registration_source: 'manual' as const,
          }));
          // Chunked for the same reason addTeamRosterPlayers is: a whole large
          // team's worth of rows in one insert can outrun Postgres's statement
          // timeout, which — since this whole import is best-effort — used to
          // mean a big team's assessment came back with no players imported at
          // all instead of a slower but complete import.
          const chunks: (typeof participants)[] = [];
          for (let i = 0; i < participants.length; i += ROSTER_UPSERT_CHUNK) {
            chunks.push(participants.slice(i, i + ROSTER_UPSERT_CHUNK));
          }
          await mapPool(chunks, ROSTER_WRITE_CONCURRENCY, async (chunk) => {
            await supabase.from('tryout_participants').insert(chunk);
          });
        }
      } catch {
        // Non-fatal: the assessment is created, the coach can add players later.
      }
    }

    await this.markOnboarding({ createAssessment: true });
    const [assembled] = await this.assembleTryouts([row]);
    return assembled;
  }

  async updateTryout(id: string, updates: Partial<Tryout>): Promise<Tryout> {
    const { supabase } = await this.ctx();
    const patch: Row = {};
    if (updates.name !== undefined) patch.name = updates.name;
    if (updates.sport !== undefined) patch.sport = updates.sport;
    if (updates.sportOther !== undefined) patch.sport_other = updates.sportOther;
    if (updates.eventType !== undefined) patch.event_type = EVENT_TYPE_TO_DB[updates.eventType];
    if (updates.tryoutDate !== undefined) patch.tryout_date = updates.tryoutDate || null;
    if (updates.startTime !== undefined) patch.start_time = updates.startTime || null;
    if (updates.endTime !== undefined) patch.end_time = updates.endTime || null;
    if (updates.rink !== undefined) patch.location = updates.rink || null;
    if (updates.defaultPosition !== undefined) patch.default_position = updates.defaultPosition || null;
    if (updates.headAssessor !== undefined) patch.head_assessor = updates.headAssessor || null;
    if (updates.headCoach !== undefined) patch.head_coach = updates.headCoach || null;
    if (updates.teamId !== undefined) patch.team_id = updates.teamId || null;
    if (updates.seasonId !== undefined) patch.season_id = updates.seasonId || null;
    if (updates.settings !== undefined) patch.settings = updates.settings;
    if (updates.archived !== undefined) patch.archived = updates.archived;
    if (updates.registrationFeeCents !== undefined) patch.registration_fee_cents = updates.registrationFeeCents || null;

    if (updates.teamBuilder !== undefined || updates.aiAssessments !== undefined) {
      const current = (await supabase.from('tryouts').select('ai_assessments').eq('id', id).single())
        .data?.ai_assessments ?? {};
      const next = { ...current };
      if (updates.aiAssessments !== undefined) Object.assign(next, updates.aiAssessments);
      if (updates.teamBuilder !== undefined) next.teamBuilder = updates.teamBuilder;
      patch.ai_assessments = next;
    }

    const row = Object.keys(patch).length
      ? (unwrap(await supabase.from('tryouts').update(patch).eq('id', id).select().single()) as Row)
      : (unwrap(await supabase.from('tryouts').select('*').eq('id', id).single()) as Row);

    if (updates.assessors !== undefined) {
      await this.syncAssessors(id, updates.assessors);
    }

    // Built from the patched row plus a cheap assessors fetch, instead of
    // getTryout()'s full reassembly (every player, every evaluation, every
    // registration). Every caller of updateTryout either discards this
    // return value — relying on useUpdateTryoutMutation's cache invalidation
    // to pick up the change in the background — or, the one exception
    // (assessment/new.tsx right after creating a tryout), only reads
    // `.assessors`. Nobody needs roster/evals/registrations here, and a patch
    // as small as re-linking a tryout's team was paying the same cost as
    // opening the full roster screen — which is what timed out attaching a
    // 1,000-player assessment to a team.
    const assessorRows = unwrap(
      await supabase.from('tryout_assessors').select('*').eq('tryout_id', id),
    ) as Row[];
    const settings = row.settings ?? { skaterWeights: {}, goalieWeights: {}, customRubrics: [] };
    const ai = row.ai_assessments ?? {};
    const { teamBuilder, ...aiAssessments } = ai;

    return {
      id: row.id,
      name: row.name,
      teamId: row.team_id ?? undefined,
      seasonId: row.season_id ?? undefined,
      createdAt: toMs(row.created_at),
      updatedAt: toMs(row.updated_at),
      eventType: EVENT_TYPE_FROM_DB[row.event_type] ?? 'Tryout',
      tryoutDate: row.tryout_date ?? undefined,
      startTime: row.start_time ?? undefined,
      endTime: row.end_time ?? undefined,
      rink: row.location ?? undefined,
      sport: row.sport,
      sportOther: row.sport_other ?? undefined,
      defaultPosition: row.default_position ?? undefined,
      headAssessor: row.head_assessor ?? undefined,
      headCoach: row.head_coach ?? undefined,
      assessors: assessorRows.map((a) => this.rowToAssessor(a)),
      roster: [],
      evals: [],
      registrations: [],
      settings,
      cloud: row.registration_code
        ? { id: row.registration_code, enabled: row.registration_open }
        : undefined,
      archived: row.archived,
      registrationFeeCents: row.registration_fee_cents ?? undefined,
      teamBuilder,
      aiAssessments: Object.keys(aiAssessments).length ? aiAssessments : undefined,
    } as Tryout;
  }

  /** Reconcile the desired assessor list against the tryout_assessors table. */
  private async syncAssessors(tryoutId: string, desired: Assessor[]): Promise<void> {
    const supabase = getSupabase();
    const existing = unwrap(
      await supabase.from('tryout_assessors').select('id, name, email, role').eq('tryout_id', tryoutId),
    ) as Row[];

    const keyOf = (a: { name: string; email?: string | null }): string =>
      a.email && a.email.length ? `e:${a.email.toLowerCase()}` : `n:${a.name.toLowerCase()}`;
    const rowKey = (r: Row) => keyOf({ name: r.name, email: r.email });

    const existingByKey = new Map(existing.map((r) => [rowKey(r), r]));
    const desiredKeys = new Set(desired.map(keyOf));

    const toInsert = desired
      .filter((d) => !existingByKey.has(keyOf(d)))
      .map((d) => ({
        tryout_id: tryoutId,
        name: d.name,
        email: d.email && d.email.length ? d.email : null,
        role: d.role ?? 'assessor',
      }));
    if (toInsert.length) {
      unwrap(await supabase.from('tryout_assessors').insert(toInsert).select());
    }

    const toDelete = existing.filter((r) => !desiredKeys.has(rowKey(r))).map((r) => r.id);
    if (toDelete.length) {
      unwrap(await supabase.from('tryout_assessors').delete().in('id', toDelete).select());
    }

    if (desired.length > 1) await this.markOnboarding({ inviteAssessors: true });
  }

  archiveTryout(id: string): Promise<Tryout> {
    return this.updateTryout(id, { archived: true });
  }

  restoreTryout(id: string): Promise<Tryout> {
    return this.updateTryout(id, { archived: false });
  }

  async deleteTryout(id: string): Promise<void> {
    const { supabase } = await this.ctx();
    // Soft delete — the row (and the evaluations/scores it cascades to) stays
    // in the database so it still counts toward a player's permanent history,
    // it just disappears from every coach-facing view (see the deleted_at
    // filters on listTryouts/listAssignedTryouts/getTryout).
    unwrap(
      await supabase
        .from('tryouts')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .maybeSingle(),
    );
  }

  async sendEmail(type: 'org_invite' | 'player_invite' | 'team_manager_invite' | 'tryout_invite' | 'schedule_update' | 'reminder' | 'registration_confirmation', to: string, payload: any): Promise<void> {
    const { supabase } = await this.ctx();
    const { error } = await supabase.functions.invoke('send-email', {
      body: { type, to, payload },
    });
    if (error) {
      let msg = error.message;
      try {
        const body = await error.context.json();
        if (body?.error) msg = body.error;
      } catch { }
      throw new Error(msg);
    }
  }

  async copyTryout(id: string): Promise<Tryout> {
    const { supabase, userId, accountId } = await this.ctx();
    const src = unwrap(await supabase.from('tryouts').select('*').eq('id', id).single()) as Row;
    const copy = unwrap(
      await supabase
        .from('tryouts')
        .insert({
          account_id: accountId,
          team_id: src.team_id,
          season_id: src.season_id,
          name: `${src.name} (Copy)`,
          event_type: src.event_type,
          sport: src.sport,
          sport_other: src.sport_other,
          tryout_date: src.tryout_date,
          start_time: src.start_time,
          end_time: src.end_time,
          location: src.location,
          default_position: src.default_position,
          head_coach: src.head_coach,
          head_assessor: src.head_assessor,
          settings: src.settings,
        })
        .select()
        .single(),
    ) as Row;

    const profile = await this.loadUserProfile(userId);
    await supabase.from('tryout_assessors').insert({
      tryout_id: copy.id,
      user_id: userId,
      name: profile.displayName,
      email: profile.email,
      role: 'lead',
      status: 'accepted',
      joined_at: new Date().toISOString(),
    });

    // Copy roster (participants reuse the canonical athletes). Players
    // soft-removed from the source tryout shouldn't reappear in the copy.
    const participants = unwrap(
      await supabase.from('tryout_participants').select('*').eq('tryout_id', id).is('removed_at', null),
    ) as Row[];
    if (participants.length) {
      await supabase.from('tryout_participants').insert(
        participants.map((p) => ({
          tryout_id: copy.id,
          athlete_id: p.athlete_id,
          jersey: p.jersey,
          jersey_colour: p.jersey_colour,
          position: p.position,
          shoots: p.shoots,
          position_trying_out_for: p.position_trying_out_for,
          current_team: p.current_team,
          current_level: p.current_level,
          registration_source: p.registration_source,
          anonymous: p.anonymous,
          sort_out: p.sort_out,
          friend1_name: p.friend1_name,
          friend2_name: p.friend2_name,
        })),
      );
    }
    const [assembled] = await this.assembleTryouts([copy]);
    return assembled;
  }

  // ─── Players ──────────────────────────────────────────────────────────────────
  /**
   * Give `fields` a `guardian_user_id`, creating the guardian's login (and
   * mailing them the password) when they don't have one yet. Split out of
   * createAthlete so the bulk registration-placement path can run this per
   * registration while still writing the athletes themselves in one request.
   *
   * Best-effort throughout: an athlete without a linked guardian account is
   * still a valid athlete, so every failure here is logged and swallowed.
   */
  private async resolveGuardianUserId(fields: Row): Promise<void> {
    const supabase = getSupabase();
    if (!fields.guardian_email || fields.guardian_user_id) return;
    try {
      const { data: exists } = await supabase.rpc('check_user_exists', { lookup_email: fields.guardian_email });
      if (!exists) {
        const defaultPassword = Math.random().toString(36).slice(-8) + 'Aa1!';
        const name = fields.guardian_name || 'Guardian';
        const { data: newUserId, error } = await supabase.rpc('create_user_with_password', {
          email: fields.guardian_email,
          password: defaultPassword,
          display_name: name,
          account_type: 'guardian'
        });
        if (newUserId && !error) {
          fields.guardian_user_id = typeof newUserId === 'object' && newUserId !== null ? (newUserId as any).id || newUserId : newUserId;
          try {
            await this.sendEmail('org_invite', fields.guardian_email, { role: 'guardian', password: defaultPassword });
          } catch (emailErr) {
            console.warn('Failed to send auto-created guardian invite email:', emailErr);
          }
        }
      } else {
        // User already exists (e.g. an existing coach account) — link guardian_user_id without touching password or role!
        const { data: existingId } = await supabase.rpc('get_user_id_by_email', { lookup_email: fields.guardian_email });
        if (existingId) {
          fields.guardian_user_id = typeof existingId === 'object' && existingId !== null ? (existingId as any).id || existingId : existingId;
        }
      }
    } catch (err) {
      console.warn('Failed to auto-create guardian account:', err);
    }
  }

  private async createAthlete(accountId: string, fields: Row): Promise<string> {
    const supabase = getSupabase();
    await this.resolveGuardianUserId(fields);

    // Insert via create_athlete_for_caller() rather than a direct table insert:
    // it treats account_id as a hint and resolves the real owning account from
    // auth.uid() server-side, so a stale cached accountId can no longer produce
    // an RLS rejection that survives until the app process restarts. The same
    // owner/admin/coach roles are still required.
    const { data, error } = await supabase.rpc('create_athlete_for_caller', {
      payload: { account_id: accountId, ...fields },
    });
    if (error) throw new Error(error.message);
    return data as string;
  }

  async addPlayer(tryoutId: string, form: AddPlayerForm): Promise<Player> {
    return this.withFreshAccount(() => this._addPlayer(tryoutId, form));
  }

  private async _addPlayer(tryoutId: string, form: AddPlayerForm): Promise<Player> {
    const { supabase } = await this.ctx();
    const accountId = await this.writableAccountId();
    if (typeof tryoutId === 'object' && tryoutId !== null) {
      tryoutId = String((tryoutId as any).id || tryoutId);
    }

    let athleteId = form.athleteId;
    if (typeof athleteId === 'object' && athleteId !== null) {
      athleteId = String((athleteId as any).id || athleteId);
    }

    if (!athleteId) {
      athleteId = await this.createAthlete(accountId, {
        first_name: form.first,
        last_name: form.last,
        year_of_birth: form.yearOfBirth ? Number(form.yearOfBirth) : null,
        guardian_name: form.guardianName || null,
        guardian_email: form.guardianEmail || null,
        guardian_phone: form.guardianPhone || null,
        player_email: form.playerEmail || null,
        medical_info: form.medicalInfo || null,
        about: form.aboutChild || null,
        avatar_url: form.avatarUrl || null,
      });
    }
    const participant = unwrap(
      await supabase
        .from('tryout_participants')
        .insert({
          tryout_id: tryoutId,
          athlete_id: athleteId,
          jersey: form.jersey || null,
          position: form.pos || null,
          shoots: form.shoots || null,
          position_trying_out_for: form.positionTryingOutFor || null,
          current_team: form.currentTeam || null,
          current_level: form.currentLevel || null,
          registration_source: 'manual',
          friend1_name: form.friend1Name || null,
          friend2_name: form.friend2Name || null,
        })
        .select('id')
        .single(),
    ) as Row;
    await this.markOnboarding({ addPlayers: true });
    return this.fetchPlayer(participant.id);
  }

  async updatePlayer(tryoutId: string, playerId: string, updates: Partial<Player>): Promise<Player> {
    const { supabase } = await this.ctx();

    const athletePatch: Row = {};
    if (updates.first !== undefined) athletePatch.first_name = updates.first;
    if (updates.last !== undefined) athletePatch.last_name = updates.last;
    if (updates.yearOfBirth !== undefined)
      athletePatch.year_of_birth = updates.yearOfBirth ? Number(updates.yearOfBirth) : null;
    if (updates.guardianName !== undefined) athletePatch.guardian_name = updates.guardianName || null;
    if (updates.guardianEmail !== undefined) athletePatch.guardian_email = updates.guardianEmail || null;
    if (updates.guardianPhone !== undefined) athletePatch.guardian_phone = updates.guardianPhone || null;
    if (updates.playerEmail !== undefined) athletePatch.player_email = updates.playerEmail || null;
    if (updates.medicalInfo !== undefined) athletePatch.medical_info = updates.medicalInfo || null;
    if (updates.aboutChild !== undefined) athletePatch.about = updates.aboutChild || null;
    if (updates.currentPosition !== undefined)
      athletePatch.default_position = updates.currentPosition || null;
    if (updates.avatarUrl !== undefined) athletePatch.avatar_url = updates.avatarUrl || null;




    const participantPatch: Row = {};
    if (updates.jersey !== undefined) participantPatch.jersey = updates.jersey || null;
    if (updates.jerseyColour !== undefined) participantPatch.jersey_colour = updates.jerseyColour || null;
    if (updates.pos !== undefined) participantPatch.position = updates.pos || null;
    if (updates.shoots !== undefined) participantPatch.shoots = updates.shoots || null;
    if (updates.positionTryingOutFor !== undefined)
      participantPatch.position_trying_out_for = updates.positionTryingOutFor || null;
    if (updates.currentTeam !== undefined) participantPatch.current_team = updates.currentTeam || null;
    if (updates.currentLevel !== undefined) participantPatch.current_level = updates.currentLevel || null;
    if (updates.anonymous !== undefined) participantPatch.anonymous = updates.anonymous;
    if (updates.sortOut !== undefined) participantPatch.sort_out = updates.sortOut;
    if (updates.waiverAcceptedAt !== undefined)
      participantPatch.waiver_accepted_at = toIso(updates.waiverAcceptedAt);
    if (updates.friend1Name !== undefined) participantPatch.friend1_name = updates.friend1Name || null;
    if (updates.friend2Name !== undefined) participantPatch.friend2_name = updates.friend2Name || null;

    if (updates.assignedAssessor !== undefined) {
      let assessorId: string | null = null;
      if (updates.assignedAssessor) {
        const found = (
          await supabase
            .from('tryout_assessors')
            .select('id')
            .eq('tryout_id', tryoutId)
            .eq('name', updates.assignedAssessor)
            .limit(1)
            .maybeSingle()
        ).data as Row | null;
        assessorId = found?.id ?? null;
      }
      participantPatch.assigned_assessor_id = assessorId;
    }

    if (Object.keys(athletePatch).length) {
      const part = unwrap(
        await supabase.from('tryout_participants').select('athlete_id').eq('id', playerId).single(),
      ) as Row;
      unwrap(await supabase.from('athletes').update(athletePatch).eq('id', part.athlete_id).select());
    }
    if (Object.keys(participantPatch).length) {
      unwrap(await supabase.from('tryout_participants').update(participantPatch).eq('id', playerId).select());
    }
    return this.fetchPlayer(playerId);
  }

  async deletePlayer(_tryoutId: string, playerId: string): Promise<void> {
    const { supabase } = await this.ctx();
    // Best-effort: if this player was created by accepting a guardian's shared
    // athlete, flip that share to 'released' so the guardian is told the coach
    // let them go. Never let this block the actual removal below.
    try {
      await supabase.rpc('release_athlete_share_for_participant', { p_participant_id: playerId });
    } catch {
      // non-blocking
    }
    // Soft delete — the participant row (and its evaluations/scores) stays in
    // the database so it still counts toward the player's permanent profile
    // history, it just disappears from this tryout's active roster (see the
    // removed_at filter in assembleTryouts).
    const removed = unwrap(
      await supabase
        .from('tryout_participants')
        .update({ removed_at: new Date().toISOString() })
        .eq('id', playerId)
        .select('athlete_id')
        .maybeSingle(),
    ) as Row | null;
    if (removed?.athlete_id) await this.clearGuardianIfUnrostered(removed.athlete_id as string);
  }

  /**
   * Drop the guardian contact from an athlete once that athlete is off every
   * roster. Guardians have no rows of their own — they are contact columns on
   * `athletes`, and everything that lists them (listOrgMembers, the org member
   * directory) derives them from those columns. Removing a player therefore has
   * to clear them here, or the parent lingers as a "member" of the org with no
   * player attached.
   *
   * Guarded on the athlete holding no remaining spot in any assessment, team, or
   * season: one athlete row is shared across all three, so a player cut from one
   * assessment but still rostered elsewhere keeps their guardian.
   */
  private async clearGuardianIfUnrostered(athleteId: string): Promise<void> {
    const { supabase } = await this.ctx();
    const [participants, teamRoster, seasonRoster] = await Promise.all([
      supabase
        .from('tryout_participants')
        .select('id', { count: 'exact', head: true })
        .eq('athlete_id', athleteId)
        .is('removed_at', null),
      supabase.from('team_roster').select('id', { count: 'exact', head: true }).eq('athlete_id', athleteId),
      supabase.from('season_roster').select('id', { count: 'exact', head: true }).eq('athlete_id', athleteId),
    ]);
    const stillRostered =
      (participants.count ?? 0) + (teamRoster.count ?? 0) + (seasonRoster.count ?? 0) > 0;
    if (stillRostered) return;
    await supabase
      .from('athletes')
      .update({
        guardian_name: null,
        guardian_email: null,
        guardian_phone: null,
        guardian_user_id: null,
      })
      .eq('id', athleteId);
  }

  async uploadPlayerPhoto(athleteId: string, fileUri: string, fileType: string): Promise<string> {
    const { supabase } = await this.ctx();
    const RNFS = require('react-native-fs');

    const decodeBase64 = (base64Str: string): ArrayBuffer => {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
      const lookup = new Uint8Array(256);
      for (let i = 0; i < chars.length; i++) {
        lookup[chars.charCodeAt(i)] = i;
      }
      let bufferLength = base64Str.length * 0.75;
      const len = base64Str.length;
      let p = 0;

      if (base64Str[len - 1] === '=') {
        bufferLength--;
        if (base64Str[len - 2] === '=') {
          bufferLength--;
        }
      }

      const arrayBuffer = new ArrayBuffer(bufferLength);
      const bytes = new Uint8Array(arrayBuffer);

      for (let i = 0; i < len; i += 4) {
        const encoded1 = lookup[base64Str.charCodeAt(i)];
        const encoded2 = lookup[base64Str.charCodeAt(i + 1)];
        const encoded3 = lookup[base64Str.charCodeAt(i + 2)];
        const encoded4 = lookup[base64Str.charCodeAt(i + 3)];

        bytes[p++] = (encoded1 << 2) | (encoded2 >> 4);
        bytes[p++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
        bytes[p++] = ((encoded3 & 3) << 6) | (encoded4 & 63);
      }

      return arrayBuffer;
    };

    let cleanPath = fileUri;
    if (cleanPath.startsWith('file://')) {
      cleanPath = cleanPath.slice(7);
    }
    cleanPath = decodeURIComponent(cleanPath);

    const base64 = await RNFS.readFile(cleanPath, 'base64');
    const buffer = decodeBase64(base64);

    const fileExtension = fileType.split('/')[1] || 'jpg';
    const filePath = `${athleteId}.${fileExtension}`;

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(filePath, buffer, {
        contentType: fileType,
        upsert: true,
      });

    if (uploadError) {
      throw new Error(`Upload failed: ${uploadError.message}`);
    }

    const { data: { publicUrl } } = supabase.storage
      .from('avatars')
      .getPublicUrl(filePath);

    const publicUrlWithCacheBuster = `${publicUrl}?v=${Date.now()}`;

    unwrap(
      await supabase
        .from('athletes')
        .update({ avatar_url: publicUrlWithCacheBuster })
        .eq('id', athleteId)
        .select()
        .single()
    );

    return publicUrlWithCacheBuster;
  }

  async importLibraryPlayers(
    tryoutId: string,
    entries: { first: string; last: string; jersey?: string; pos?: string }[],
  ): Promise<Player[]> {
    const players: Player[] = [];
    for (const e of entries) {
      players.push(
        await this.addPlayer(tryoutId, {
          first: e.first,
          last: e.last,
          jersey: e.jersey,
          pos: e.pos,
        } as AddPlayerForm),
      );
    }
    return players;
  }

  // ─── Evaluations ──────────────────────────────────────────────────────────────
  async saveEvaluation(
    tryoutId: string,
    playerId: string,
    form: ScoreForm,
    evalId?: string,
    activeAssessor?: import('@/data/types').Assessor | null,
  ): Promise<Evaluation> {
    const { supabase, userId } = await this.ctx();
    const recDb = form.recommendation ? REC_TO_DB[form.recommendation] : null;

    let evaluatorUserId: string | null = userId;
    let evaluatorName = '';

    if (activeAssessor) {
      evaluatorName = activeAssessor.name;
      // We directly read the userId property mapped in rowToAssessor, bypassing DB lookup
      evaluatorUserId = activeAssessor.userId ?? null;

      if (!evaluatorUserId) {
        const profile = await this.loadUserProfile(userId);
        if (
          profile.email &&
          activeAssessor.email &&
          profile.email.toLowerCase() === activeAssessor.email.toLowerCase()
        ) {
          evaluatorUserId = userId;
        }
      }
    } else {
      const profile = await this.loadUserProfile(userId);
      evaluatorName = profile.displayName;
    }

    let id = evalId;
    if (!id) {
      // Correctly check for existing evaluation including null check for evaluatorUserId
      let query = supabase
        .from('evaluations')
        .select('id')
        .eq('tryout_id', tryoutId)
        .eq('participant_id', playerId)
        .eq('session', form.session);

      if (evaluatorUserId) {
        query = query.eq('evaluator_user_id', evaluatorUserId);
      } else {
        query = query.is('evaluator_user_id', null).eq('evaluator_name', evaluatorName);
      }

      const { data: existingRows } = await query;
      if (existingRows && existingRows.length > 0) {
        id = existingRows[0].id;

        // Clean up duplicate evaluation rows if they exist in the DB (fixes 'two go remove and one remain')
        if (existingRows.length > 1) {
          const extraIds = existingRows.slice(1).map((r) => r.id);
          await supabase.from('evaluations').delete().in('id', extraIds);
        }
      }
    }

    let savedData: Row;

    if (id) {
      const updateResult = await supabase
        .from('evaluations')
        .update({
          session: form.session,
          strengths: form.strengths ?? null,
          improve: form.improve ?? null,
          recommendation: recDb,
          evaluator_user_id: evaluatorUserId,
          evaluator_name: evaluatorName,
        })
        .eq('id', id)
        .select()
        .single();
      savedData = unwrap(updateResult) as Row;
    } else {
      const insertResult = await supabase
        .from('evaluations')
        .insert({
          tryout_id: tryoutId,
          participant_id: playerId,
          evaluator_user_id: evaluatorUserId,
          evaluator_name: evaluatorName,
          session: form.session,
          strengths: form.strengths ?? null,
          improve: form.improve ?? null,
          recommendation: recDb,
          source: 'manual',
        })
        .select()
        .single();
      savedData = unwrap(insertResult) as Row;
      id = savedData.id;
    }

    const scoreRows = Object.entries(form.scores)
      .filter(([, v]) => v != null && !Number.isNaN(v))
      .map(([rubric_key, value]) => ({ evaluation_id: id, rubric_key, value }));

    if (scoreRows.length) {
      const keys = scoreRows.map(r => r.rubric_key);
      // Save scores and clean up old ones in parallel
      await Promise.all([
        supabase.from('evaluation_scores').upsert(scoreRows, { onConflict: 'evaluation_id,rubric_key' }),
        supabase.from('evaluation_scores').delete().eq('evaluation_id', id).not('rubric_key', 'in', `(${keys.join(',')})`),
      ]).then(([upsertRes, deleteRes]) => {
        unwrap(upsertRes);
        unwrap(deleteRes);
      });
    } else {
      unwrap(await supabase.from('evaluation_scores').delete().eq('evaluation_id', id));
    }

    this.markOnboarding({ scorePlayers: true }).catch(() => { });

    savedData.evaluation_scores = scoreRows;
    return this.rowToEval(savedData);
  }

  async deleteEvaluation(_tryoutId: string, evalId: string): Promise<void> {
    const { supabase } = await this.ctx();
    unwrap(await supabase.from('evaluations').delete().eq('id', evalId).select().maybeSingle());
  }

  async importScanScores(
    tryoutId: string,
    scores: { playerId: string; rubricKey: string; value: number }[],
  ): Promise<void> {
    const byPlayer: Record<string, Record<string, number>> = {};
    for (const s of scores) (byPlayer[s.playerId] ??= {})[s.rubricKey] = s.value;
    for (const [playerId, scoreMap] of Object.entries(byPlayer)) {
      await this.saveEvaluation(tryoutId, playerId, {
        session: 'Scan Import',
        recommendation: '',
        scores: scoreMap,
      });
    }
  }

  // ─── Testing utilities (association/enterprise) ───────────────────────────────
  async generateTestData(
    tryoutId: string,
    options: DummyDataOptions,
    onProgress?: (done: number, total: number) => void,
  ): Promise<DummyDataResult> {
    const { supabase, userId } = await this.ctx();
    // Not wrapped in withFreshAccount(): a retry here would re-run inserts that
    // already succeeded and duplicate players. writableAccountId() re-resolves
    // from memberships on every call, so there's no cached id to go stale.
    const accountId = await this.writableAccountId();
    const tryout = await this.getTryout(tryoutId);
    if (!tryout) throw new Error('Assessment not found');

    const target = options?.target ?? 'roster';
    const wantsRoster = target === 'roster' || target === 'both';
    const wantsRegistrations = target === 'registrations' || target === 'both';
    // Scores only exist on rostered players — a registration has nowhere to hang them.
    const withScores = wantsRoster && options?.withScores !== false;

    const rubrics = tryout.settings.customRubrics ?? [];
    if (withScores && rubrics.length === 0) {
      // Surfaced to the UI, which prompts the user to add rubrics first.
      throw new Error('NO_RUBRICS');
    }

    const n = clampInt(options?.count, 1, 1000, 50);
    const currentYear = new Date().getFullYear();

    // Progress is measured in the records the user asked for, so every target —
    // registrations, roster, or both — drives the bar, not just the AI-scored
    // path. The AI round trip is the slow half of a scored roster, so it owns
    // half of that phase's share; an unscored batch is generated locally and
    // instantly, leaving the whole share to insertion.
    const regUnits = wantsRegistrations ? n : 0;
    const rosterUnits = wantsRoster ? n : 0;
    const totalUnits = regUnits + rosterUnits;
    const genWeight = withScores ? rosterUnits * 0.5 : 0;
    const insertWeight = rosterUnits - genWeight;
    let doneUnits = 0;
    // Monotonic — each phase reports its own share, and a later phase must never
    // walk the bar backwards.
    const report = (units: number) => {
      doneUnits = Math.min(totalUnits, Math.max(doneUnits, units));
      onProgress?.(Math.round(doneUnits), totalUnits);
    };
    report(0);

    // Only pay for the AI round trip when the batch actually needs scores;
    // an unscored batch just needs names, so generate those locally.
    const generated: ScorableDummyPlayer[] = withScores
      ? await this.generateAITestPlayers(supabase, tryout, rubrics, n, currentYear, (done) =>
          report((done / n) * genWeight),
        )
      : generateDummyPlayers(n, tryout.sport, currentYear);

    let registrations = 0;
    if (wantsRegistrations) {
      // `both` creates two distinct cohorts so the pending queue isn't just a
      // duplicate of the roster — generate a second batch of names for it.
      const regPlayers = target === 'both'
        ? generateDummyPlayers(n, tryout.sport, currentYear)
        : generated;
      registrations = await this.insertDummyRegistrations(supabase, tryout, regPlayers, (inserted) =>
        report(genWeight + inserted),
      );
    }

    let players = 0;
    let evaluations = 0;
    if (wantsRoster) {
      const res = await this.insertDummyRoster(
        supabase,
        accountId,
        userId,
        tryout,
        generated,
        {
          withScores,
          sessionsPerPlayer: clampInt(options?.sessionsPerPlayer, 1, 5, 1),
        },
        (fraction) => report(genWeight + regUnits + fraction * insertWeight),
      );
      players = res.players;
      evaluations = res.evaluations;
    }
    report(totalUnits);

    // Only set flags we actually earned — `markOnboarding` spreads the patch, so
    // an `undefined` value would wipe a step the user had already completed.
    const steps: Record<string, boolean> = {};
    if (players > 0) steps.addPlayers = true;
    if (evaluations > 0) steps.scorePlayers = true;
    if (Object.keys(steps).length) await this.markOnboarding(steps);

    return { registrations, players, evaluations };
  }

  /**
   * Insert a batch of pending registrations for `tryout`, with the same
   * invented guardian contact block used for roster players. Addresses use a
   * reserved domain, so nothing here can mail a real person.
   */
  private async insertDummyRegistrations(
    supabase: any,
    tryout: Tryout,
    generated: GeneratedPlayer[],
    /** Called with the running row count after each chunk lands. */
    onProgress?: (inserted: number) => void,
  ): Promise<number> {
    const positions =
      POSITIONS_BY_SPORT[tryout.sport as keyof typeof POSITIONS_BY_SPORT] ?? POSITIONS_BY_SPORT.Other;
    const rows = generated.map((g, i) => {
      const form = generateDummyRegistration(g, i, positions);
      return {
        tryout_id: tryout.id,
        first_name: form.firstName,
        last_name: form.lastName,
        year_of_birth: form.yearOfBirth ? Number(form.yearOfBirth) : null,
        position_trying_out_for: form.positionTryingOutFor || null,
        player_email: form.playerEmail || null,
        guardian_name: form.guardianName,
        guardian_email: form.guardianEmail,
        guardian_phone: form.guardianPhone || null,
        current_team: TEST_DATA_TAG,
        current_level: form.currentLevel || null,
        about_player: form.aboutPlayer || null,
        medical_info: form.medicalInfo || null,
        status: 'pending',
      };
    });
    const inserted = await insertChunked(
      rows,
      DUMMY_CHUNK.registrations,
      async (chunk) => unwrap(await supabase.from('registrations').insert(chunk).select('id')) as Row[],
      onProgress,
    );
    return inserted.length;
  }

  /**
   * Insert generated players straight onto the roster, optionally with
   * `sessionsPerPlayer` scored evaluations each. Shared by the in-assessment
   * dummy button and the New Team flow.
   */
  private async insertDummyRoster(
    supabase: any,
    accountId: string,
    userId: string,
    tryout: Tryout,
    generated: ScorableDummyPlayer[],
    opts: { withScores: boolean; sessionsPerPlayer: number },
    /** Called with this phase's completion as a 0–1 fraction, chunk by chunk, so
     * a caller can fold it into a wider progress bar. */
    onProgress?: (fraction: number) => void,
  ): Promise<{ players: number; evaluations: number; athleteIds: string[] }> {
    if (generated.length === 0) {
      onProgress?.(1);
      return { players: 0, evaluations: 0, athleteIds: [] };
    }

    // 1. Bulk-insert canonical athletes, including their invented guardian
    // contact (reserved yopmail.com domain — see dummyGuardian) so roster
    // players are reachable the same way registration players are.
    // Chunked at DUMMY_CHUNK.athletes, so the 1000-player ceiling is one request.
    //
    // Routed through create_athletes_for_caller() rather than a direct table
    // insert, for the same reason createAthlete() uses the single-row RPC: it
    // takes account_id as a hint and resolves the real owning account from
    // auth.uid() server-side, so a stale or read-only cached accountId can't
    // fail the athletes_insert policy with "new row violates row-level security
    // policy". The RPC returns ids in input order.
    const athleteIds = await insertChunked(
      generated,
      DUMMY_CHUNK.athletes,
      async (chunk) => {
        const { data, error } = await supabase.rpc('create_athletes_for_caller', {
          account_hint: accountId,
          players: chunk.map((g) => ({
            first_name: g.form.first,
            last_name: g.form.last,
            year_of_birth: g.form.yearOfBirth ? Number(g.form.yearOfBirth) : null,
            guardian_name: g.form.guardianName || null,
            guardian_email: g.form.guardianEmail || null,
            player_email: g.form.playerEmail || null,
          })),
        });
        if (error) throw new Error(error.message);
        return (data ?? []) as string[];
      },
      // The four inserts below share this phase's slice of the bar, weighted by
      // roughly how long each takes on a large batch.
      (done) => onProgress?.(0.35 * (done / generated.length)),
    );

    // 2. Bulk-insert participants, tagged via current_team so they can be cleared.
    // `offset` is what lets a chunk find its own athlete ids while chunks run
    // concurrently — the ids are in input order, not completion order.
    //
    // Routed through insert_tryout_participants_for_caller() rather than a
    // direct table insert, for the same reason step 1 uses an RPC: a plain
    // insert re-evaluates participants_write's can_access_tryout() check once
    // per row, and a 1000-row chunk of those (each a handful of nested EXISTS
    // lookups) was long enough to trip the `authenticated` role's 8s
    // statement_timeout — "canceling statement due to statement timeout" on a
    // batch that used to be well within the row-count limits. The RPC checks
    // authorization once and inserts as `postgres` (bypassrls), so the cost is
    // flat regardless of batch size. Same fix applied to evaluations/scores below.
    const participants = await insertChunked(
      generated,
      DUMMY_CHUNK.participants,
      async (chunk, offset) => {
        const { data, error } = await supabase.rpc('insert_tryout_participants_for_caller', {
          p_tryout_id: tryout.id,
          participants: chunk.map((g, j) => ({
            athlete_id: athleteIds[offset + j],
            jersey: g.form.jersey || null,
            position: g.form.pos || null,
            current_team: TEST_DATA_TAG,
            current_level: g.form.currentLevel || null,
            registration_source: 'import',
          })),
        });
        if (error) throw new Error(error.message);
        return ((data ?? []) as string[]).map((id) => ({ id })) as Row[];
      },
      (done) => onProgress?.(0.35 + 0.25 * (done / generated.length)),
    );

    if (!opts.withScores) {
      onProgress?.(1);
      return { players: participants.length, evaluations: 0, athleteIds };
    }

    const rubrics = tryout.settings.customRubrics ?? [];

    // 3. Build evaluations: every player gets exactly `sessionsPerPlayer`
    //    sessions, spread across the assessment's assessors.
    const profile = await this.loadUserProfile(userId);
    const assessorNames = tryout.assessors.length
      ? tryout.assessors.map((a) => a.name)
      : [profile.displayName];

    const evalRows: Row[] = [];
    const evalPlayerIndex: number[] = [];
    generated.forEach((g, i) => {
      for (let sIdx = 0; sIdx < opts.sessionsPerPlayer; sIdx++) {
        const evaluatorName = assessorNames[(i + sIdx) % assessorNames.length];
        const isOwner = evaluatorName === profile.displayName;
        evalRows.push({
          tryout_id: tryout.id,
          participant_id: participants[i].id,
          evaluator_user_id: isOwner ? userId : null,
          evaluator_name: evaluatorName,
          session: `Session ${sIdx + 1}`,
          recommendation: REC_TO_DB[pickRecommendation(g.ability) as Exclude<Recommendation, ''>] ?? null,
          source: 'manual',
        });
        evalPlayerIndex.push(i);
      }
    });

    // Routed through insert_evaluations_for_caller() — see the comment on
    // step 2's RPC call. evaluations_write's can_access_tryout() check re-run
    // per row is exactly what turned a 1000-player x 5-session batch's 5,000
    // evaluation rows into a statement_timeout.
    const evals = await insertChunked(
      evalRows,
      DUMMY_CHUNK.evaluations,
      async (chunk) => {
        const { data, error } = await supabase.rpc('insert_evaluations_for_caller', {
          p_tryout_id: tryout.id,
          rows: chunk,
        });
        if (error) throw new Error(error.message);
        return ((data ?? []) as string[]).map((id) => ({ id })) as Row[];
      },
      (done) => onProgress?.(0.6 + 0.25 * (done / Math.max(1, evalRows.length))),
    );

    // 4. Build and chunk-insert scores for every applicable rubric per eval.
    const scoreRows: Row[] = [];
    evals.forEach((e, idx) => {
      const g = generated[evalPlayerIndex[idx]];
      const subskills = getPlayerSubskills(tryout.sport, g.form.pos, rubrics);
      // Prefer the AI-generated raw score per rubric (validated against its
      // benchmarks); fall back to an ability-derived score for any rubric the
      // AI didn't score, so ranking logic always has a full score set.
      const derived = generateScoresForPlayer(subskills, g.ability);
      for (const s of subskills) {
        const aiScore = g.scores ? clampScoreToRubric(g.scores[s.key], s) : null;
        const value = aiScore ?? derived[s.key];
        if (value !== undefined) scoreRows.push({ evaluation_id: e.id, rubric_key: s.key, value });
      }
    });
    // Routed through insert_evaluation_scores_for_caller() — same reasoning as
    // steps 2 and 3, and the biggest table of the four: a full batch is
    // ~30,000+ rows, each of which used to re-run eval_scores_rw's nested
    // EXISTS-on-evaluations-then-can_access_tryout check.
    await insertChunked(
      scoreRows,
      DUMMY_CHUNK.scores,
      async (chunk) => {
        const { error } = await supabase.rpc('insert_evaluation_scores_for_caller', {
          p_tryout_id: tryout.id,
          rows: chunk,
        });
        if (error) throw new Error(error.message);
        return [];
      },
      (done) => onProgress?.(0.85 + 0.15 * (done / scoreRows.length)),
    );
    onProgress?.(1);

    return { players: participants.length, evaluations: evals.length, athleteIds };
  }

  /**
   * Stand up whole dummy teams from the New Team screen. Teams hold no roster of
   * their own, so each one gets a linked assessment (seeded with a rubric set
   * spanning every scoring type) and that assessment carries the players. The
   * assessment is flagged `settings.isTestData` so `clearDummyTeams` can undo
   * the entire bundle later.
   */
  async generateDummyTeams(
    options: DummyTeamOptions,
    onProgress?: (done: number, total: number) => void,
  ): Promise<DummyTeamResult> {
    const { supabase, userId } = await this.ctx();
    // teams/tryouts insert with this id directly, so it must be an account the
    // caller can actually write to — not whatever ctx() cached first. Same
    // reasoning as generateTestData for not retrying via withFreshAccount().
    const accountId = await this.writableAccountId();
    const profile = await this.loadUserProfile(userId);

    const teamCount = clampInt(options?.teams, 1, 10, 1);
    const playersPerTeam = clampInt(options?.playersPerTeam, 1, 1000, 20);
    const sessionsPerPlayer = clampInt(options?.sessionsPerPlayer, 1, 5, 1);
    const withScores = options?.withScores !== false;
    const currentYear = new Date().getFullYear();

    const rubrics = generateDummyRubrics();
    const names = generateDummyTeamNames(teamCount);
    const result: DummyTeamResult = {
      teams: 0,
      assessments: 0,
      registrations: 0,
      players: 0,
      evaluations: 0,
    };

    const totalPlayers = teamCount * playersPerTeam;
    for (let teamIdx = 0; teamIdx < names.length; teamIdx++) {
      const name = names[teamIdx];
      const team = unwrap(
        await supabase
          .from('teams')
          .insert({ account_id: accountId, name, season_label: `${currentYear}-${String((currentYear + 1) % 100).padStart(2, '0')}` })
          .select()
          .single(),
      ) as Row;
      result.teams++;

      const tryoutRow = unwrap(
        await supabase
          .from('tryouts')
          .insert({
            account_id: accountId,
            team_id: team.id,
            name: `${name} Tryout`,
            event_type: 'tryout',
            sport: 'Hockey',
            tryout_date: new Date().toISOString().slice(0, 10),
            head_coach: profile.displayName,
            head_assessor: profile.displayName,
            settings: {
              skaterWeights: {},
              goalieWeights: {},
              customRubrics: rubrics,
              isTestData: true,
            },
          })
          .select()
          .single(),
      ) as Row;
      result.assessments++;

      // Seed the creator as lead assessor, matching `createTryout`.
      await supabase.from('tryout_assessors').insert({
        tryout_id: tryoutRow.id,
        user_id: userId,
        name: profile.displayName,
        email: profile.email,
        role: 'lead',
        status: 'accepted',
        joined_at: new Date().toISOString(),
      });

      const [tryout] = await this.assembleTryouts([tryoutRow]);
      const teamOffset = teamIdx * playersPerTeam;
      // Each team's slice of the bar is split between generating its players and
      // writing them, so the bar advances during both halves rather than
      // standing still through the inserts.
      const genShare = withScores ? playersPerTeam * 0.5 : 0;
      const insertShare = playersPerTeam - genShare;
      const generated = withScores
        ? await this.generateAITestPlayers(
            supabase,
            tryout,
            rubrics,
            playersPerTeam,
            currentYear,
            (done) =>
              onProgress?.(
                Math.round(teamOffset + (done / playersPerTeam) * genShare),
                totalPlayers,
              ),
          )
        : generateDummyPlayers(playersPerTeam, tryout.sport, currentYear);

      const res = await this.insertDummyRoster(
        supabase,
        accountId,
        userId,
        tryout,
        generated,
        {
          withScores,
          sessionsPerPlayer,
        },
        (fraction) =>
          onProgress?.(Math.round(teamOffset + genShare + fraction * insertShare), totalPlayers),
      );
      result.players += res.players;
      result.evaluations += res.evaluations;

      // Put the same athletes on the team's own roster, so a generated team
      // shows players immediately rather than an empty Players list.
      await this.addTeamRosterPlayers(
        team.id,
        res.athleteIds.map((athleteId, i) => ({
          athleteId,
          jersey: generated[i]?.form.jersey,
          pos: generated[i]?.form.pos,
          sourceTryoutId: tryout.id,
        })),
      );
    }

    const steps: Record<string, boolean> = { createTeam: true, createAssessment: true };
    if (result.players > 0) steps.addPlayers = true;
    if (result.evaluations > 0) steps.scorePlayers = true;
    await this.markOnboarding(steps);

    return result;
  }

  /**
   * Delete every team/assessment bundle created by `generateDummyTeams`.
   * Assessments are found by their `settings.isTestData` flag; deleting them
   * cascades to participants, evaluations, and scores. A team is only removed
   * once it has no assessments left, so a team the user has since attached real
   * work to survives.
   */
  async clearDummyTeams(): Promise<{ teams: number; assessments: number }> {
    const { supabase, accountId } = await this.ctx();
    const rows = unwrap(
      await supabase
        .from('tryouts')
        .select('id, team_id, settings')
        .eq('account_id', accountId)
        .contains('settings', { isTestData: true }),
    ) as Row[];
    if (rows.length === 0) return { teams: 0, assessments: 0 };

    const ids = rows.map((r) => r.id);
    unwrap(await supabase.from('tryouts').delete().in('id', ids).select('id'));

    const teamIds = [...new Set(rows.map((r) => r.team_id).filter(Boolean))] as string[];
    let teams = 0;
    for (const teamId of teamIds) {
      const remaining = unwrap(
        await supabase.from('tryouts').select('id').eq('team_id', teamId).limit(1),
      ) as Row[];
      if (remaining.length > 0) continue;
      const deleted = unwrap(
        await supabase.from('teams').delete().eq('id', teamId).select('id'),
      ) as Row[];
      teams += deleted.length;
    }
    return { teams, assessments: ids.length };
  }

  /**
   * Generate `count` dummy players (identity + scores) via the AI edge function,
   * in bounded chunks with limited concurrency. Any chunk that fails or returns
   * too few players is topped up with the local deterministic generator, so the
   * feature always yields a full batch even if AI is unavailable.
   */
  private async generateAITestPlayers(
    supabase: any,
    tryout: any,
    rubrics: any[],
    count: number,
    currentYear: number,
    /** Called with the running player count as each chunk lands. */
    onProgress?: (done: number) => void,
  ): Promise<Array<{ form: AITestPlayer['form']; ability: number; scores?: Record<string, number> }>> {
    const sport = tryout.sport;
    const positions = POSITIONS_BY_SPORT[sport as keyof typeof POSITIONS_BY_SPORT] ?? POSITIONS_BY_SPORT.Other;
    const rubricDescriptors = rubrics.map((r) => ({
      key: r.key,
      label: r.label,
      scoringType: r.scoringType,
      scale: r.scale,
      minVal: r.minVal,
      maxVal: r.maxVal,
      rankingDirection: r.rankingDirection,
    }));

    // Chunk so each Claude call stays within a comfortable output size.
    const chunkSizes: number[] = [];
    for (let remaining = count; remaining > 0; remaining -= AI_CHUNK) {
      chunkSizes.push(Math.min(AI_CHUNK, remaining));
    }

    // Every chunk at once for a big batch (1000 players = 50 chunks = 50 in
    // flight), scaling down to the chunk count for small ones. These are
    // independent edge-function invocations, so width here is what turns a
    // multi-minute batch into a single round trip's worth of waiting.
    const width = concurrencyFor(chunkSizes.length, DUMMY_MAX_CONCURRENCY.ai);
    let reported = 0;
    const results = await mapPool(chunkSizes, width, async (chunkCount) => {
      let players: AITestPlayer[] = [];
      // A burst this wide is exactly what trips a rate limit, and a rate-limited
      // chunk would otherwise fall through to local filler — fast, but silently
      // worse data. Retry with backoff so width costs latency, never quality.
      for (let attempt = 0; attempt <= AI_CHUNK_RETRIES; attempt++) {
        try {
          const { data, error } = await supabase.functions.invoke('generate-test-players', {
            body: { sport, count: chunkCount, positions, rubrics: rubricDescriptors },
          });
          if (!error && data && !data.error && Array.isArray(data.players)) {
            players = (data.players as any[])
              .map((p) => mapAIPlayer(p, sport, currentYear))
              .filter((p): p is AITestPlayer => p !== null);
          }
        } catch {
          // Chunk lost — retried below, then topped up locally if it keeps failing.
        }
        if (players.length > 0 || attempt === AI_CHUNK_RETRIES) break;
        // Jittered so a wave of rate-limited chunks doesn't retry in lockstep.
        await sleep(500 * 2 ** attempt + Math.random() * 400);
      }
      // Counted as each chunk lands rather than once per group, so the bar keeps
      // moving through a long batch.
      reported += players.length;
      onProgress?.(Math.min(reported, count));
      return players;
    });

    const collected: AITestPlayer[] = results.flat();

    // Top up any shortfall (partial or total AI failure) with local generation.
    if (collected.length < count) {
      const filler = generateDummyPlayers(count - collected.length, sport, currentYear);
      for (const f of filler) collected.push({ form: f.form, ability: f.ability, scores: {} });
    }
    onProgress?.(count);

    return collected.slice(0, count);
  }

  async clearTestData(tryoutId: string): Promise<{ removed: number }> {
    const { supabase } = await this.ctx();

    // Both deletes used to go out as a single unbounded statement, which is the
    // same statement-timeout trap the inserts fell into (see DUMMY_CHUNK) — and
    // worse on this side, because deleting a participant cascades to its
    // evaluations and their scores. Clearing a full 1000-player x 5-session
    // batch is ~36,000 cascaded row deletes in one statement; it dies on the 8s
    // timeout, and because the tagged rows it did not reach are still there, the
    // user is left with dummy data they have no other way to remove.
    //
    // So: collect the tagged ids first, then delete them through insertChunked,
    // which bounds each statement and halves the chunk again if one still times
    // out. Mirrors the web app's clearTestData.
    const collectIds = async (table: string): Promise<string[]> => {
      const out: string[] = [];
      let cursor: string | null = null;
      for (;;) {
        let q = supabase
          .from(table)
          .select('id')
          .eq('tryout_id', tryoutId)
          .eq('current_team', TEST_DATA_TAG);
        // Keyset, not OFFSET — same reasoning as fetchAllByIn. An unranged
        // select would also stop silently at PostgREST's 1000-row default and
        // leave a 1000-player batch permanently half-cleared.
        if (cursor !== null) q = q.gt('id', cursor);
        const page = ((unwrap(await q.order('id').limit(FETCH_PAGE_SIZE)) as Row[] | null) ?? []) as Row[];
        out.push(...page.map((r) => r.id as string));
        if (page.length < FETCH_PAGE_SIZE) return out;
        cursor = page[page.length - 1].id as string;
      }
    };

    const deleteByIds = async (table: string, ids: string[], size: number): Promise<number> => {
      if (ids.length === 0) return 0;
      const deleted = await insertChunked(ids, size, async (chunk) => {
        unwrap(await supabase.from(table).delete().in('id', chunk));
        return chunk;
      });
      return deleted.length;
    };

    // Participants carry the cascade, so they get the smaller chunk.
    const participantIds = await collectIds('tryout_participants');
    const removedPlayers = await deleteByIds(
      'tryout_participants',
      participantIds,
      DUMMY_CLEAR_CHUNK.participants,
    );

    // Generated registrations carry the same tag, so a pending queue filled by
    // the dummy button is cleared by the same action.
    const registrationIds = await collectIds('registrations');
    const removedRegs = await deleteByIds(
      'registrations',
      registrationIds,
      DUMMY_CLEAR_CHUNK.registrations,
    );

    return { removed: removedPlayers + removedRegs };
  }

  // ─── Registration ───────────────────────────────────────────────────────────
  async ensureCloudSession(tryoutId: string): Promise<Tryout> {
    const { supabase } = await this.ctx();
    const row = unwrap(
      await supabase.from('tryouts').select('registration_code').eq('id', tryoutId).single(),
    ) as Row;
    if (!row.registration_code) {
      unwrap(
        await supabase
          .from('tryouts')
          .update({ registration_code: generateCloudCode(), registration_open: true })
          .eq('id', tryoutId)
          .select()
      );
    }
    const result = await this.getTryout(tryoutId);
    if (!result) throw new Error('Tryout not found');
    return result;
  }

  async listRegistrations(tryoutId: string): Promise<Registration[]> {
    await this.ctx();
    // Paged: an unbounded select is silently truncated at PostgREST's row cap
    // (commonly 1000), so a QR link that drew more registrations than that
    // showed — and could place onto a roster — only the first 1000 of them.
    // Sorted client-side because the helper orders by id to page by keyset.
    const rows = await this.fetchAllByIn('registrations', '*', 'tryout_id', [tryoutId]);
    rows.sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));
    return rows.map((r) => this.rowToRegistration(r));
  }

  async submitRegistration(tryoutId: string, form: RegistrationSubmit): Promise<Registration> {
    const { supabase } = await this.ctx();
    const row = unwrap(
      await supabase
        .from('registrations')
        .insert({
          tryout_id: tryoutId,
          first_name: form.firstName,
          last_name: form.lastName,
          year_of_birth: form.yearOfBirth ? Number(form.yearOfBirth) : null,
          position_trying_out_for: form.positionTryingOutFor || null,
          player_email: form.playerEmail || null,
          guardian_name: form.guardianName,
          guardian_email: form.guardianEmail,
          guardian_phone: form.guardianPhone || null,
          current_team: form.currentTeam || null,
          current_level: form.currentLevel || null,
          about_player: form.aboutPlayer || null,
          medical_info: form.medicalInfo || null,
          friend1_name: form.friend1Name || null,
          friend2_name: form.friend2Name || null,
          status: 'pending',
        })
        .select()
        .single(),
    ) as Row;
    return this.rowToRegistration(row);
  }

  async submitPublicRegistration(eventIdOrCode: string, form: RegistrationSubmit): Promise<Registration> {
    const supabase = getSupabase();

    const { data, error } = await supabase.rpc('submit_public_registration', {
      code: eventIdOrCode,
      payload: form,
    });

    if (error) {
      throw new Error(error.message);
    }

    return this.rowToRegistration(data as Row);
  }

  async addRegistrationToRoster(tryoutId: string, registrationId: string): Promise<Player> {
    const { supabase, accountId } = await this.ctx();
    const reg = unwrap(
      await supabase.from('registrations').select('*').eq('id', registrationId).single(),
    ) as Row;
    const athleteId = await this.createAthlete(accountId, {
      first_name: reg.first_name,
      last_name: reg.last_name,
      year_of_birth: reg.year_of_birth ?? null,
      guardian_name: reg.guardian_name || null,
      guardian_email: reg.guardian_email || null,
      guardian_phone: reg.guardian_phone || null,
      player_email: reg.player_email || null,
      medical_info: reg.medical_info || null,
      about: reg.about_player || null,
    });
    // Real athletes never pick their own jersey at registration — a coach
    // assigns it after roster placement. Test data gets a random one instead so
    // a dummy-data batch looks fully populated without manual entry per player.
    const isTestData = reg.current_team === TEST_DATA_TAG;
    const participant = unwrap(
      await supabase
        .from('tryout_participants')
        .insert({
          tryout_id: tryoutId,
          athlete_id: athleteId,
          jersey: isTestData ? String(Math.floor(1 + Math.random() * 99)) : null,
          position: reg.position_trying_out_for || null,
          position_trying_out_for: reg.position_trying_out_for || null,
          current_team: reg.current_team || null,
          current_level: reg.current_level || null,
          registration_source: 'qr',
          friend1_name: reg.friend1_name || null,
          friend2_name: reg.friend2_name || null,
        })
        .select('id')
        .single(),
    ) as Row;
    await supabase
      .from('registrations')
      .update({ status: 'added', athlete_id: athleteId })
      .eq('id', registrationId);
    await this.markOnboarding({ addPlayers: true });
    return this.fetchPlayer(participant.id);
  }

  /**
   * Team destination for a registration: create the canonical athlete from the
   * registration exactly as addRegistrationToRoster does, then put them on the
   * team's roster instead of an assessment's. No tryout_participant row is
   * created — the athlete isn't being evaluated, just rostered.
   */
  async addRegistrationToTeam(teamId: string, registrationId: string): Promise<TeamRosterPlayer[]> {
    const { supabase, accountId } = await this.ctx();
    const reg = unwrap(
      await supabase.from('registrations').select('*').eq('id', registrationId).single(),
    ) as Row;
    const athleteId = await this.createAthlete(accountId, {
      first_name: reg.first_name,
      last_name: reg.last_name,
      year_of_birth: reg.year_of_birth ?? null,
      guardian_name: reg.guardian_name || null,
      guardian_email: reg.guardian_email || null,
      guardian_phone: reg.guardian_phone || null,
      player_email: reg.player_email || null,
      medical_info: reg.medical_info || null,
      about: reg.about_player || null,
    });
    const rows = await this.addTeamRosterPlayers(teamId, [
      { athleteId, pos: reg.position_trying_out_for || undefined },
    ]);
    await supabase
      .from('registrations')
      .update({ status: 'added', athlete_id: athleteId })
      .eq('id', registrationId);
    await this.markOnboarding({ addPlayers: true });
    return rows;
  }

  /**
   * Resolve (and create, where needed) every distinct guardian email across
   * the *whole* selection in one pass, before any chunk starts creating
   * athletes. Returns a lowercase-email -> guardian_user_id map.
   *
   * Deduplicating up front — rather than per chunk — is what makes it safe to
   * run the resolve calls concurrently: since each email is only ever handed
   * to one batch, two batches can never race to insert the same new
   * auth.users row at once. That race (two concurrently-running chunks both
   * seeing "doesn't exist yet" for the same sibling's guardian and both
   * trying to create it) is what produced "canceling statement due to
   * statement timeout" once chunk processing became concurrent — the second
   * insert blocks on the first's still-open transaction and can sit waiting
   * long enough to trip the timeout.
   *
   * Invite emails for newly created guardians are dispatched afterwards
   * without being awaited — best-effort, same as the single-add path, and
   * kept off the placement critical path since the caller only needs the
   * returned map before it can create athletes.
   */
  private async resolveGuardiansForRegistrations(supabase: any, regs: Row[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    const displayNameByEmail = new Map<string, string>();
    for (const reg of regs) {
      const email = reg.guardian_email;
      if (!email) continue;
      const lc = String(email).toLowerCase();
      if (!displayNameByEmail.has(lc)) displayNameByEmail.set(lc, reg.guardian_name || 'Guardian');
    }
    if (displayNameByEmail.size === 0) return map;

    const entries = [...displayNameByEmail.entries()];
    const batches: { email: string; display_name: string }[][] = [];
    for (let i = 0; i < entries.length; i += GUARDIAN_RESOLVE_BATCH) {
      batches.push(entries.slice(i, i + GUARDIAN_RESOLVE_BATCH).map(([email, display_name]) => ({ email, display_name })));
    }

    const invites: { email: string; password: string }[] = [];
    await mapPool(batches, REGISTRATION_CHUNK_CONCURRENCY, async (batch) => {
      try {
        const { data, error } = await supabase.rpc('resolve_guardians_for_caller', { guardians: batch });
        if (error) throw new Error(error.message);
        const resolved = (data ?? []) as { email: string; user_id: string | null; created: boolean; password: string | null }[];
        for (const r of resolved) {
          if (r.email && r.user_id) map.set(r.email.toLowerCase(), r.user_id);
          if (r.created && r.password) invites.push({ email: r.email, password: r.password });
        }
      } catch (err) {
        console.warn('Failed to bulk-resolve guardian accounts:', err);
      }
    });

    if (invites.length > 0) {
      mapPool(invites, GUARDIAN_EMAIL_CONCURRENCY, (r) =>
        this.sendEmail('org_invite', r.email, { role: 'guardian', password: r.password }).catch((emailErr) =>
          console.warn('Failed to send auto-created guardian invite email:', emailErr),
        ),
      ).catch((err) => console.warn('Guardian invite dispatch failed:', err));
    }

    return map;
  }

  /** Build a `create_athletes_for_caller` payload row from a registration. */
  private athleteFieldsFromRegistration(reg: Row, guardianMap: Map<string, string>): Row {
    const guardianUserId = reg.guardian_email ? guardianMap.get(String(reg.guardian_email).toLowerCase()) : undefined;
    return {
      first_name: reg.first_name,
      last_name: reg.last_name,
      year_of_birth: reg.year_of_birth ?? null,
      guardian_name: reg.guardian_name || null,
      guardian_email: reg.guardian_email || null,
      guardian_phone: reg.guardian_phone || null,
      guardian_user_id: guardianUserId || null,
      player_email: reg.player_email || null,
      medical_info: reg.medical_info || null,
      about: reg.about_player || null,
    };
  }

  /** Mark a placed chunk's registrations as added, one request per chunk. */
  private async markRegistrationsAdded(
    supabase: any,
    placed: { reg: Row; athleteId: string }[],
  ): Promise<void> {
    // `athlete_id` differs per row, so this can't be one `update ... in (...)`.
    // Upserting the whole row instead — and it has to be the *whole* row, spread
    // from the `select('*')` these came back on: an upsert is an INSERT with ON
    // CONFLICT DO UPDATE, and Postgres checks NOT NULL on the proposed tuple
    // before it ever looks for the conflict, so a partial payload would fail on
    // registrations' not-null columns rather than falling through to the update.
    unwrap(
      await supabase
        .from('registrations')
        .upsert(
          placed.map(({ reg, athleteId }) => ({ ...reg, status: 'added', athlete_id: athleteId })),
          { onConflict: 'id' },
        )
        .select('id'),
    );
  }

  /**
   * Shared body of both bulk placement paths: split into id chunks, load
   * every chunk's registration rows up front (read-only, so this is fully
   * parallel regardless of the write-side concurrency limit), resolve every
   * distinct guardian in the whole selection exactly once, then create
   * athletes chunk by chunk — with bounded concurrency, since none of this
   * phase touches auth.users and so can't hit the guardian create-race above.
   * `place` does the caller-specific roster/participant insert for a chunk's
   * newly created athletes.
   */
  private async placeRegistrations(
    supabase: any,
    accountId: string,
    registrationIds: string[],
    place: (placed: { reg: Row; athleteId: string }[]) => Promise<void>,
    onProgress?: (done: number, total: number) => void,
  ): Promise<number> {
    const idChunks: string[][] = [];
    for (let i = 0; i < registrationIds.length; i += REGISTRATION_CHUNK) {
      idChunks.push(registrationIds.slice(i, i + REGISTRATION_CHUNK));
    }
    if (idChunks.length === 0) return 0;

    const regChunks = await mapPool(idChunks, REGISTRATION_CHUNK_CONCURRENCY * 2, async (ids) => {
      // Postgres doesn't promise `.in()` comes back in the order the ids were
      // passed, so everything downstream is keyed off this array's own order
      // rather than the caller's id list.
      return unwrap(await supabase.from('registrations').select('*').in('id', ids)) as Row[];
    });

    const guardianMap = await this.resolveGuardiansForRegistrations(supabase, regChunks.flat());

    let done = 0;
    const total = registrationIds.length;
    await mapPool(regChunks, REGISTRATION_CHUNK_CONCURRENCY, async (regs) => {
      if (regs.length === 0) return;
      const fields = regs.map((reg) => this.athleteFieldsFromRegistration(reg, guardianMap));
      const { data, error } = await supabase.rpc('create_athletes_for_caller', {
        account_hint: accountId,
        players: fields,
      });
      if (error) throw new Error(error.message);
      const athleteIds = (data ?? []) as string[];
      const placed = regs.map((reg, i) => ({ reg, athleteId: athleteIds[i] }));

      await place(placed);
      await this.markRegistrationsAdded(supabase, placed);

      done += placed.length;
      onProgress?.(done, total);
    });

    if (done > 0) await this.markOnboarding({ addPlayers: true });
    return done;
  }

  async addRegistrationsToRoster(
    tryoutId: string,
    registrationIds: string[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<number> {
    const { supabase, accountId } = await this.ctx();
    return this.placeRegistrations(
      supabase,
      accountId,
      registrationIds,
      async (placed) => {
        unwrap(
          await supabase
            .from('tryout_participants')
            .insert(
              placed.map(({ reg, athleteId }) => ({
                tryout_id: tryoutId,
                athlete_id: athleteId,
                // Real athletes never pick their own jersey at registration — a
                // coach assigns it after roster placement. Test data gets a
                // random one instead so a dummy-data batch looks fully populated
                // without manual entry per player.
                jersey:
                  reg.current_team === TEST_DATA_TAG
                    ? String(Math.floor(1 + Math.random() * 99))
                    : null,
                position: reg.position_trying_out_for || null,
                position_trying_out_for: reg.position_trying_out_for || null,
                current_team: reg.current_team || null,
                current_level: reg.current_level || null,
                registration_source: 'qr',
                friend1_name: reg.friend1_name || null,
                friend2_name: reg.friend2_name || null,
              })),
            )
            .select('id'),
        );
      },
      onProgress,
    );
  }

  async addRegistrationsToTeam(
    teamId: string,
    registrationIds: string[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<number> {
    const { supabase, accountId } = await this.ctx();
    return this.placeRegistrations(
      supabase,
      accountId,
      registrationIds,
      async (placed) => {
        // addTeamRosterPlayers already upserts the whole batch in one request
        // (and handles the season-roster backfill for fee-collecting teams).
        await this.addTeamRosterPlayers(
          teamId,
          placed.map(({ reg, athleteId }) => ({
            athleteId,
            pos: reg.position_trying_out_for || undefined,
          })),
        );
      },
      onProgress,
    );
  }

  async dismissRegistration(_tryoutId: string, registrationId: string): Promise<void> {
    const { supabase } = await this.ctx();
    await supabase.from('registrations').update({ status: 'dismissed' }).eq('id', registrationId);
  }

  // ─── Phase 2: Team Builder, AI, Export ──────────────────────────────────────────
  async generateTeamBuilder(tryoutId: string, config: TeamBuilderConfig): Promise<TeamBuilderState> {
    const tryout = await this.getTryout(tryoutId);
    if (!tryout) throw new Error('Tryout not found');

    let result: TeamBuilderState;
    if (config.prompt) {
      // Map UUIDs to short IDs to drastically reduce token usage and prevent truncation
      const idMap = new Map<string, string>(); // shortId -> realId
      const realToShort = new Map<string, string>(); // realId -> shortId

      // Pool every evaluation down to one weighted overall + per-category average
      // per player (matches the ranking shown in Roster/Export). Sending this instead
      // of raw eval records (strengths/improve text, dates, evaluator names, one row
      // per session) keeps the payload flat as roster size and eval count grow —
      // otherwise a large roster with multiple sessions per player blows past the
      // model's input token limit.
      const results = computePlayerResults(tryout);
      const resultByPlayerId = new Map(results.map(r => [r.player.id, r]));

      const shortTryout = {
        ...tryout,
        roster: tryout.roster.map((p, i) => {
          const shortId = `p${i}`;
          idMap.set(shortId, p.id);
          realToShort.set(p.id, shortId);
          return { ...p, id: shortId };
        }),
        rankings: tryout.roster.map(p => {
          const r = resultByPlayerId.get(p.id);
          return {
            id: realToShort.get(p.id) || p.id,
            overall: r?.overall ?? 0,
            categoryScores: r?.categoryScores ?? {},
            recommendation: r?.latestRecommendation || undefined,
          };
        }),
      };
      delete (shortTryout as any).evals;

      // Call Claude via edge function
      const { supabase } = await this.ctx();
      const { data, error } = await supabase.functions.invoke('generate-ai-insights', {
        body: { action: 'team_builder', tryout: shortTryout, prompt: config.prompt }
      });
      if (error) {
        throw new Error(error.message);
      }
      if (data?.error) {
        throw new Error(data.message || data.error);
      }

      // Restore real UUIDs
      const restoreIds = (arr: string[] = []) => arr.map(short => idMap.get(short) || short);
      const posById = new Map(tryout.roster.map((p) => [p.id, p.pos]));

      // Merge Claude's response with local state structure. The model is only asked
      // for one "players" array per team (not a redundant "skaters"/"goalies" split —
      // that used to double output size and risk truncation on large rosters); the
      // skater/goalie split is derived here from the roster's own position data,
      // which is also guaranteed to be internally consistent with "players".
      result = {
        generatedAt: Date.now(),
        sortMethod: config.sortMethod ?? 'balanced',
        config: {
          teamCount: data.teams?.length || config.teamCount,
          teamNames: data.teams?.map((t: any) => t.name) || [],
          keepFriendPackages: config.keepFriendPackages ?? true,
          splitGoalies: config.splitGoalies ?? true,
        },
        ranks: [], // We can omit full rankings or compute them locally if needed
        warnings: data.warnings || [],
        explanation: data.explanation,
        teams: (data.teams || []).map((t: any, i: number) => {
          const players = restoreIds(t.players);
          return {
            index: i,
            id: `ai-team-${i}`,
            name: t.name || `Team ${i + 1}`,
            players,
            skaters: players.filter((id) => !isGoaliePosition(posById.get(id))),
            goalies: players.filter((id) => isGoaliePosition(posById.get(id))),
          };
        }),
        unassigned: restoreIds(data.unassigned),
      };
    } else {
      // No prompt: skip the AI round-trip entirely and balance teams with a
      // deterministic algorithm instead — guarantees evenly matched team
      // averages, which a free-text AI prompt could only approximate. This is
      // what the Team Builder screen's "Balance Evenly" action uses.
      result = buildTeams(tryout, config);
    }

    await this.updateTryout(tryoutId, { teamBuilder: result });
    return result;
  }

  async listTeamBuilderResults(tryoutId: string): Promise<TeamBuilderResult[]> {
    const { supabase } = await this.ctx();
    const rows = unwrap(
      await supabase
        .from('team_builder_results')
        .select('*')
        .eq('tryout_id', tryoutId)
        .order('created_at', { ascending: false }),
    ) as Row[];
    return rows.map((r) => this.rowToTeamBuilderResult(r));
  }

  async saveTeamBuilderResult(tryoutId: string, label: string, state: TeamBuilderState): Promise<TeamBuilderResult> {
    const { supabase, userId } = await this.ctx();
    const row = unwrap(
      await supabase
        .from('team_builder_results')
        .insert({ tryout_id: tryoutId, label, state, created_by: userId })
        .select()
        .single(),
    ) as Row;
    return this.rowToTeamBuilderResult(row);
  }

  async deleteTeamBuilderResult(id: string): Promise<void> {
    const { supabase } = await this.ctx();
    unwrap(await supabase.from('team_builder_results').delete().eq('id', id));
  }

  private rowToTeamBuilderResult(r: Row): TeamBuilderResult {
    return {
      id: r.id,
      tryoutId: r.tryout_id,
      label: r.label,
      state: r.state,
      createdAt: new Date(r.created_at).getTime(),
    };
  }

  async getAiPlayerSummary(tryoutId: string, playerId: string): Promise<AiPlayerSummary> {
    const tryout = await this.getTryout(tryoutId);
    if (!tryout) throw new Error('Tryout not found');
    const { supabase } = await this.ctx();
    const { data, error } = await supabase.functions.invoke('generate-ai-insights', {
      body: { action: 'summary', tryout, playerIds: [playerId] }
    });
    if (error) {
      let message = error.message;
      try {
        if ('context' in error && typeof (error as any).context?.json === 'function') {
          const body = await (error as any).context.json();
          if (body && body.error) {
            message = body.message || body.error;
          }
        }
      } catch (e) {
        // ignore parsing error
      }
      throw new Error(message);
    }
    // Edge function returns { error, message } for expected errors (status 200)
    if (data?.error) {
      throw new Error(data.message || data.error);
    }
    const summary = data;
    // Best-effort: cache the AI result on the tryout record.
    // If the current user lacks write permission (e.g. assessor role), the DB
    // update will fail with "Cannot coerce the result to a single JSON object"
    // (PostgREST returns 0 rows when RLS blocks the UPDATE). We don't want that
    // to surface as a user-facing error — the summary was generated successfully.
    try {
      await this.updateTryout(tryoutId, { aiAssessments: { [playerId]: summary } });
    } catch (saveErr) {
      console.warn('AI summary generated but could not be saved to tryout:', saveErr);
    }
    return summary;
  }

  async getAiCompare(tryoutId: string, playerIds: string[]): Promise<AiCompareSummary> {
    const tryout = await this.getTryout(tryoutId);
    if (!tryout) throw new Error('Tryout not found');

    const players = tryout.roster.filter((p) => playerIds.includes(p.id));
    const results = computePlayerResults(tryout);
    const resultByPlayerId = new Map(results.map((r) => [r.player.id, r]));

    // Compact, structured per-player profile — pooled overall, per-category
    // averages with human-readable labels, and a per-session trend — instead
    // of a raw eval dump (free-text strengths/improve, one row per session).
    // This keeps the comparison grounded in the same numbers the app itself
    // computes, and keeps the payload flat regardless of session count.
    const comparisonProfiles = players.map((p) => {
      const categories = getPlayerCategories(tryout.sport, p.pos, tryout.settings.customRubrics);
      const categoryLabels = new Map(categories.map((c) => [c.key, c.label]));
      const weights = isGoaliePosition(p.pos) ? tryout.settings.goalieWeights : tryout.settings.skaterWeights;
      const playerEvals = tryout.evals
        .filter((e) => e.playerId === p.id)
        .sort((a, b) => a.createdAt - b.createdAt);
      const r = resultByPlayerId.get(p.id);

      return {
        name: playerDisplayName(p),
        pos: p.pos || 'N/A',
        overall: r?.overall ?? 0,
        evalCount: playerEvals.length,
        latestRecommendation: r?.latestRecommendation || undefined,
        categories: Object.entries(r?.categoryScores ?? {}).map(([key, score]) => ({
          label: categoryLabels.get(key) || key,
          score,
        })),
        sessionTrend: playerEvals.map((e) => ({
          session: e.session || 'Session',
          overall: weightedOverall(e.scores ?? {}, categories, weights),
        })),
      };
    });

    if (comparisonProfiles.every((p) => p.evalCount === 0)) {
      throw new Error('None of the selected players have evaluation data yet. Score the players first before comparing.');
    }

    const { supabase } = await this.ctx();
    const { data, error } = await supabase.functions.invoke('generate-ai-insights', {
      body: { action: 'compare', tryout, playerIds, comparisonProfiles }
    });
    if (error) {
      let message = error.message;
      try {
        if ('context' in error && typeof (error as any).context?.json === 'function') {
          const body = await (error as any).context.json();
          if (body && body.error) {
            message = body.message || body.error;
          }
        }
      } catch (e) {
        // ignore parsing error
      }
      throw new Error(message);
    }
    // Edge function returns { error, message } for expected errors (status 200)
    if (data?.error) {
      throw new Error(data.message || data.error);
    }
    return data;
  }

  async exportTryout(
    tryoutId: string,
    format: ExportFormat,
  ): Promise<{ content: string; filename: string }> {
    const tryout = await this.getTryout(tryoutId);
    if (!tryout) throw new Error('Tryout not found');
    const safeName = tryout.name.replace(/\s+/g, '_').toLowerCase();
    if (format === 'pdf') {
      return {
        content: `PDF Export: ${tryout.name}\nPlayers: ${tryout.roster.length}\nEvaluations: ${tryout.evals.length}`,
        filename: `${safeName}_report.pdf`,
      };
    }
    return {
      content: formatExportCsv(tryout),
      filename: `${safeName}_results.${format === 'xlsx' ? 'xlsx' : 'csv'}`,
    };
  }

  async createShareLink(tryoutId: string, _label?: string): Promise<{ token: string; expiresAt: number }> {
    const tryout = await this.getTryout(tryoutId);
    if (!tryout) throw new Error('Tryout not found');
    const token = generateId('share').slice(0, 12);
    const expiresAt = Date.now() + 7 * 86400000;

    // Store in settings to avoid needing a schema migration
    const newSettings = { ...tryout.settings, shareToken: token, shareExpiresAt: expiresAt };
    await this.updateTryout(tryoutId, { settings: newSettings });

    return { token, expiresAt };
  }

  // ─── Phase 3: Seasons ───────────────────────────────────────────────────────────
  private rowToSeasonEvent(
    ev: Row,
    availability: Record<string, string>,
    availabilityUnavailable = false,
  ): SeasonEvent {
    return {
      id: ev.id,
      type: EVENT_KIND_FROM_DB[ev.kind] ?? 'Game',
      title: ev.title,
      date: ev.event_date,
      endDate: ev.end_date && ev.end_date !== ev.event_date ? ev.end_date : undefined,
      startTime: ev.start_time ?? undefined,
      endTime: ev.end_time ?? undefined,
      location: ev.location ?? undefined,
      notes: ev.notes ?? undefined,
      availability: availability as SeasonEvent['availability'],
      ...(availabilityUnavailable ? { availabilityUnavailable: true } : {}),
      createdAt: toMs(ev.created_at),
      updatedAt: ev.updated_at ? toMs(ev.updated_at) : undefined,
    };
  }

  private rowToSeasonPlayer(r: Row, invites: Row[]): SeasonPlayer {
    const rawAthletes = r.athletes;
    const a = Array.isArray(rawAthletes) ? rawAthletes[0] : rawAthletes ?? {};
    const myInvites = invites.filter((i) => i.athlete_id === a.id);
    return {
      id: r.id,
      // Callers dedupe roster entries by athlete (e.g. syncing a team roster
      // into a season), so this has to survive the mapping.
      athleteId: a.id ?? r.athlete_id ?? undefined,
      firstName: a.first_name ?? '',
      lastName: a.last_name ?? '',
      jersey: r.jersey ?? undefined,
      guardianEmail: a.guardian_email ?? undefined,
      guardianPhone: a.guardian_phone ?? undefined,
      // The season enrollment can override it, but the athlete's own address is
      // the default — otherwise a player email captured on the assessment or
      // team roster would be invisible here until it was retyped per season.
      playerEmail: r.player_email ?? a.player_email ?? undefined,
      portalInviteEmails: myInvites.length ? myInvites.map((i) => i.email) : undefined,
      portalInviteSentAt: myInvites.length
        ? Math.max(...myInvites.map((i) => toMs(i.sent_at)))
        : undefined,
    };
  }

  /**
   * Every RSVP row for a set of events.
   *
   * Prefers the `get_event_availability` RPC for the same reason
   * getGuardianRosters() prefers `get_guardian_rosters`: reading this table
   * directly makes Postgres evaluate its row-level policy once per RSVP row,
   * and on a full-roster event that overruns the statement timeout (57014)
   * before any rows come back. Client-side paging does not help — the policy
   * runs on candidate rows *before* the LIMIT applies, so a bounded page on a
   * single event times out exactly as an unbounded read does. That is why the
   * schedule kept reporting "RSVPs couldn't be loaded" on a 1,000-player team:
   * the read never failed to *find* the rows, it never got to run at all.
   *
   * Returns `failed: true` rather than throwing when the read didn't work.
   * Reporting zero RSVPs and "nobody was invited" for what is really a failed
   * read is the worse outcome: it reads as data loss to a coach who just
   * invited a full roster. Mirrors the web app's fetchEventAvailability().
   */
  private async fetchEventAvailability(eventIds: string[]): Promise<{ rows: Row[]; failed: boolean }> {
    if (eventIds.length === 0) return { rows: [], failed: false };

    const supabase = getSupabase();

    // Keyset-paged, not one shot: the RPC returns a row set, so PostgREST caps
    // it at db-max-rows exactly like a table read. Taking the first response as
    // the whole answer silently dropped every RSVP past ~1000 — undercounting
    // the yes/maybe/no tallies on precisely the full-roster events this path
    // exists to rescue, and doing it invisibly, with no error to notice.
    const rpcRows: Row[] = [];
    let cursor: string | null = null;
    for (;;) {
      const { data, error } = await supabase.rpc('get_event_availability', {
        p_event_ids: eventIds,
        p_after_id: cursor,
        p_limit: AVAILABILITY_RPC_PAGE,
      });

      if (error) {
        const missingFunction = error.code === 'PGRST202' || error.code === '42883';
        if (!missingFunction) {
          console.error('get_event_availability failed:', error);
          // Pages that already landed are real rows and worth keeping; the
          // caller treats `failed` as "this list may be short", which is
          // exactly right for a read that died partway through.
          return { rows: rpcRows, failed: true };
        }
        // Only a genuinely absent function falls through to the older, slower
        // paths — and only from the first page, since a function that existed
        // a moment ago cannot vanish mid-scan.
        if (rpcRows.length > 0) return { rows: rpcRows, failed: true };
        console.warn('get_event_availability() not deployed — trying the embedded read.');
        break;
      }

      const page = ((data as Row[]) ?? []) as Row[];
      rpcRows.push(...page);
      // A short page means the server had nothing left to give.
      if (page.length < AVAILABILITY_RPC_PAGE) return { rows: rpcRows, failed: false };
      cursor = page[page.length - 1].id as string;
    }

    // Attempt 2: read the rows as an embed hanging off season_events instead of
    // filtering event_availability directly.
    //
    // Same statement, different plan. In the direct form the `season_event_id`
    // filter is an ordinary user qual and the policy is evaluated ahead of it.
    // As an embed, PostgREST emits a LATERAL keyed on `season_events.id`, so
    // the FK is a join condition that can drive the scan before the policy is
    // applied to what survives.
    const embedded = await this.fetchAvailabilityViaEvents(eventIds);
    if (embedded.ok) return { rows: embedded.rows, failed: false };

    const eventChunks: string[][] = [];
    for (let i = 0; i < eventIds.length; i += EVENT_AVAILABILITY_EVENT_CHUNK) {
      eventChunks.push(eventIds.slice(i, i + EVENT_AVAILABILITY_EVENT_CHUNK));
    }
    let failed = false;
    const chunks = await mapPool(eventChunks, REGISTRATION_CHUNK_CONCURRENCY, async (chunk) => {
      const { rows, complete } = await this.readAvailabilityChunk(chunk);
      if (!complete) failed = true;
      return rows;
    });
    return { rows: chunks.flat(), failed };
  }

  /**
   * RSVP rows read as an embed on their parent event.
   *
   * Only the fields the callers actually use are selected — the rest of the row
   * is dead weight through a LATERAL. Returns `ok: false` on any error so the
   * caller falls through to the direct read rather than this becoming another
   * way to silently report zero RSVPs.
   */
  private async fetchAvailabilityViaEvents(eventIds: string[]): Promise<{ rows: Row[]; ok: boolean }> {
    const rows: Row[] = [];
    const chunks: string[][] = [];
    for (let i = 0; i < eventIds.length; i += EVENT_AVAILABILITY_EVENT_CHUNK) {
      chunks.push(eventIds.slice(i, i + EVENT_AVAILABILITY_EVENT_CHUNK));
    }

    try {
      const parentChunks = await mapPool(chunks, REGISTRATION_CHUNK_CONCURRENCY, (chunk) =>
        this.fetchAllByIn('season_events', 'id, event_availability(roster_id, response)', 'id', chunk),
      );
      for (const parent of parentChunks.flat()) {
        for (const a of (parent.event_availability ?? []) as Row[]) {
          // Flattened back into the row shape the direct read returns, so the
          // caller can't tell which path produced it.
          rows.push({ season_event_id: parent.id, roster_id: a.roster_id, response: a.response });
        }
      }
      return { rows, ok: true };
    } catch (e) {
      console.warn('Embedded event_availability read failed; falling back to the direct read.', e);
      return { rows: [], ok: false };
    }
  }

  /**
   * One chunk of events' RSVP rows, read directly and paged.
   *
   * Deliberately does *not* retry a statement timeout (57014) at a smaller page
   * size: the policy is evaluated before the filter and the LIMIT, so a
   * narrower window costs the same 8s and only multiplies the time spent
   * failing. Whatever pages did land are kept — a partial RSVP list is more use
   * to a coach than an empty one — so `complete` reports the shortfall instead
   * of the rows being thrown away.
   */
  private async readAvailabilityChunk(eventIds: string[]): Promise<{ rows: Row[]; complete: boolean }> {
    const supabase = getSupabase();
    const rows: Row[] = [];
    let from = 0;

    for (;;) {
      try {
        const page = (unwrap(
          await supabase
            .from('event_availability')
            .select('*')
            .in('season_event_id', eventIds)
            // Offset paging needs a total order or pages silently overlap and
            // skip. This pair is the table's unique key, so it orders rows
            // completely.
            .order('season_event_id', { ascending: true })
            .order('roster_id', { ascending: true })
            .range(from, from + AVAILABILITY_PAGE - 1),
        ) ?? []) as Row[];

        rows.push(...page);
        if (page.length < AVAILABILITY_PAGE) return { rows, complete: true };
        from += AVAILABILITY_PAGE;
      } catch (e) {
        if (isStatementTimeout(e)) {
          console.error(
            'event_availability read hit the statement timeout. This is a database-side problem — ' +
              'the row-level policy runs before the season_event_id filter. Deploy ' +
              'get_event_availability() and the event_availability indexes.',
          );
        } else {
          console.error('Failed to read event_availability', e);
        }
        return { rows, complete: false };
      }
    }
  }

  private async assembleSeasons(seasonRows: Row[], withDetail: boolean): Promise<Season[]> {
    if (seasonRows.length === 0) return [];
    const ids = seasonRows.map((s) => s.id);

    // `.order()` isn't supported by the paginated helper, but tryout ordering here
    // is cosmetic (chronological display) — sort client-side after fetching all rows.
    const [eventRowsUnsorted, rosterRows] = await Promise.all([
      this.fetchAllByIn('season_events', '*', 'season_id', ids),
      this.fetchAllByIn('season_roster', '*, athletes(*)', 'season_id', ids, SEASON_ROSTER_PAGE),
    ]);
    const eventRows = [...eventRowsUnsorted].sort((a, b) =>
      String(a.event_date ?? '').localeCompare(String(b.event_date ?? '')),
    );

    let availabilityRows: Row[] = [];
    let inviteRows: Row[] = [];
    // Set when the availability read fails so the events are still returned with
    // an "RSVPs couldn't be loaded" flag rather than the whole season throwing.
    let availabilityFailed = false;
    if (withDetail) {
      const eventIds = eventRows.map((e) => e.id as string);
      // These two reads are the ONLY thing getSeason (withDetail) does that
      // listSeasons doesn't, and on a large season they're the heaviest part of
      // the assembly. A failure here must NOT discard the events (the schedule)
      // themselves: fetchEventAvailability reports a failure instead of
      // throwing, and allSettled keeps a slow/failed invites read from
      // rejecting the whole assemble, so the season still comes back with its
      // events. Without this, one timed-out availability read made getSeason()
      // throw and the entire schedule vanished on the Team screen for big
      // rosters — while the lighter listSeasons() still showed the event.
      // Mirrors the web app's graceful degradation.
      const [availResult, inviteResult] = await Promise.allSettled([
        this.fetchEventAvailability(eventIds),
        this.fetchAllByIn('portal_invites', '*', 'season_id', ids),
      ]);
      if (availResult.status === 'fulfilled') {
        availabilityRows = availResult.value.rows;
        availabilityFailed = availResult.value.failed;
      } else {
        availabilityFailed = true;
        console.warn('Season availability read failed, returning events without RSVPs:', availResult.reason?.message ?? availResult.reason);
      }
      if (inviteResult.status === 'fulfilled') {
        inviteRows = inviteResult.value;
      } else {
        console.warn('Season portal-invites read failed, returning roster without invite status:', inviteResult.reason?.message ?? inviteResult.reason);
      }
    }

    const eventsBySeason: Record<string, Row[]> = {};
    for (const e of eventRows) (eventsBySeason[e.season_id] ??= []).push(e);
    const rosterBySeason: Record<string, Row[]> = {};
    for (const r of rosterRows) (rosterBySeason[r.season_id] ??= []).push(r);
    const availByEvent: Record<string, Record<string, string>> = {};
    // Indexed once rather than a .find() per availability row — that scan was
    // O(roster × RSVPs), which for a full-roster event on a large team is a
    // million comparisons on the JS thread before anything renders.
    const rosterById = new Map(rosterRows.map((r) => [r.id, r]));
    for (const a of availabilityRows) {
      const rosterItem = rosterById.get(a.roster_id);
      if (rosterItem) {
        if (rosterItem.athlete_id) {
          (availByEvent[a.season_event_id] ??= {})[rosterItem.athlete_id] = a.response;
        }
        (availByEvent[a.season_event_id] ??= {})[rosterItem.id] = a.response;
      } else {
        (availByEvent[a.season_event_id] ??= {})[a.roster_id] = a.response;
      }
    }

    return seasonRows.map((s) => ({
      id: s.id,
      name: s.name,
      teamName: s.team_name,
      sport: s.sport,
      year: s.year ?? undefined,
      division: s.division ?? undefined,
      coach: s.coach ?? undefined,
      teamId: s.team_id ?? undefined,
      events: (eventsBySeason[s.id] ?? []).map((ev) =>
        this.rowToSeasonEvent(ev, availByEvent[ev.id] ?? {}, availabilityFailed),
      ),
      roster: (rosterBySeason[s.id] ?? []).map((r) => this.rowToSeasonPlayer(r, inviteRows)),
      scheduleShareToken: s.schedule_share_token ?? undefined,
      createdAt: toMs(s.created_at),
      updatedAt: toMs(s.updated_at),
      archived: s.archived || undefined,
    })) as Season[];
  }

  async listSeasons(): Promise<Season[]> {
    const { supabase, accountId } = await this.ctx();
    const rows = unwrap(
      await supabase
        .from('seasons')
        .select('*')
        .eq('account_id', accountId)
        .eq('archived', false)
        .order('created_at', { ascending: false }),
    ) as Row[];

    // Mirrors listTryouts()'s managed/owned-team merge (CLUB mode): a season
    // for a delegated team can live under either side's account_id depending
    // on who created it, so the plain account-scoped query above can't see
    // it alone.
    const { data: managedRows, error: managedErr } = await supabase.rpc('list_seasons_for_managed_teams');
    if (managedErr) {
      console.log('list_seasons_for_managed_teams unavailable:', managedErr.message);
      return this.assembleSeasons(rows, false);
    }
    const { data: ownedTeamRows, error: ownedErr } = await supabase.rpc('list_seasons_on_my_owned_teams');
    if (ownedErr) {
      console.log('list_seasons_on_my_owned_teams unavailable:', ownedErr.message);
    }

    const ownIds = new Set(rows.map((s) => s.id));
    const managed = ((managedRows ?? []) as Row[]).filter((s) => !ownIds.has(s.id));
    const onOwnedTeams = ((ownedTeamRows ?? []) as Row[]).filter(
      (s) => !ownIds.has(s.id) && !managed.some((m) => m.id === s.id),
    );

    return this.assembleSeasons([...rows, ...managed, ...onOwnedTeams], false);
  }

  async getSeason(id: string): Promise<Season | null> {
    await this.ctx();
    const supabase = getSupabase();
    const row = (await supabase.from('seasons').select('*').eq('id', id).maybeSingle()).data as Row | null;
    if (!row) return null;
    const [assembled] = await this.assembleSeasons([row], true);
    return assembled ?? null;
  }

  async listSeasonRoster(seasonId: string): Promise<SeasonPlayer[]> {
    await this.ctx();
    // Paged for the same reason assembleSeasons pages this table: an unbounded
    // select stops at PostgREST's row cap, so on a season with more than ~1000
    // enrolled athletes the callers that diff against this list (see
    // syncSeasonRosterFromTeam) concluded the rest were missing and re-added
    // them on every single write.
    const rows = await this.fetchAllByIn(
      'season_roster',
      '*, athletes(*)',
      'season_id',
      [seasonId],
      SEASON_ROSTER_PAGE,
    );
    return rows.map((r) => this.rowToSeasonPlayer(r, []));
  }

  async createSeason(form: CreateSeasonForm): Promise<Season> {
    const { supabase, accountId: callerAccountId } = await this.ctx();
    let accountId = callerAccountId;

    // A season for a team belongs to whoever owns the team, not whoever
    // happens to be creating it -- matches `_createTryout`'s team-ownership
    // resolution. Without this, a schedule a delegate creates for a club's
    // team would sit under the delegate's own account, invisible to the
    // club's own listSeasons() even though can_access_season already grants
    // them read access to it. A no-op when the caller owns the team
    // themselves, since teamRow.account_id then equals accountId.
    if (form.teamId) {
      const teamRow = (
        await supabase.from('teams').select('account_id').eq('id', form.teamId).maybeSingle()
      ).data as Row | null;
      if (teamRow?.account_id) accountId = teamRow.account_id;
    }

    const row = unwrap(
      await supabase
        .from('seasons')
        .insert({
          account_id: accountId,
          team_id: form.teamId ?? null,
          name: form.name,
          team_name: form.teamName,
          sport: form.sport,
          year: form.year ?? null,
          division: form.division ?? null,
          coach: form.coach ?? null,
          schedule_share_token: generateId('sched').slice(0, 16),
        })
        .select()
        .single(),
    ) as Row;

    const seasonId = row.id;

    let rosterRows: Row[] = [];
    if (form.teamId) {
      // Find all tryouts linked to this team
      const { data: tryouts } = await supabase
        .from('tryouts')
        .select('id')
        .eq('team_id', form.teamId);

      if (tryouts && tryouts.length > 0) {
        const tryoutIds = tryouts.map((t) => t.id);
        // Find all unique participants in these tryouts
        const { data: participants } = await supabase
          .from('tryout_participants')
          .select('athlete_id, jersey')
          .in('tryout_id', tryoutIds)
          .is('removed_at', null);

        if (participants && participants.length > 0) {
          // De-duplicate by athlete_id
          const uniqueAthletes = new Map<string, string | null>();
          for (const p of participants) {
            if (p.athlete_id) {
              // Prefer keeping a jersey number if one exists
              if (!uniqueAthletes.has(p.athlete_id) || p.jersey) {
                uniqueAthletes.set(p.athlete_id, p.jersey);
              }
            }
          }

          const rosterInserts = Array.from(uniqueAthletes.entries()).map(([athleteId, jersey]) => ({
            season_id: seasonId,
            athlete_id: athleteId,
            jersey: jersey || null,
          }));

          if (rosterInserts.length > 0) {
            rosterRows = unwrap(
              await supabase.from('season_roster').insert(rosterInserts).select('*, athletes(*)'),
            ) as Row[];
          }
        }
      }
    }

    // A season one statement old has no events, no availability and no portal
    // invites, and the roster is exactly what was just inserted — so assemble it
    // from what's already in hand rather than re-reading all of that back.
    return {
      id: row.id,
      name: row.name,
      teamName: row.team_name,
      sport: row.sport,
      year: row.year ?? undefined,
      division: row.division ?? undefined,
      coach: row.coach ?? undefined,
      teamId: row.team_id ?? undefined,
      events: [],
      roster: rosterRows.map((r) => this.rowToSeasonPlayer(r, [])),
      scheduleShareToken: row.schedule_share_token ?? undefined,
      createdAt: toMs(row.created_at),
      updatedAt: toMs(row.updated_at),
      archived: row.archived || undefined,
    } as Season;
  }

  async updateSeason(id: string, updates: Partial<Season>): Promise<Season> {
    const { supabase } = await this.ctx();
    const patch: Row = {};
    if (updates.name !== undefined) patch.name = updates.name;
    if (updates.teamName !== undefined) patch.team_name = updates.teamName;
    if (updates.sport !== undefined) patch.sport = updates.sport;
    if (updates.year !== undefined) patch.year = updates.year || null;
    if (updates.division !== undefined) patch.division = updates.division || null;
    if (updates.coach !== undefined) patch.coach = updates.coach || null;
    if (updates.teamId !== undefined) patch.team_id = updates.teamId || null;
    if (updates.archived !== undefined) patch.archived = updates.archived;
    if (Object.keys(patch).length) {
      unwrap(await supabase.from('seasons').update(patch).eq('id', id).select().single());
    }
    const result = await this.getSeason(id);
    if (!result) throw new Error('Season not found');
    return result;
  }

  async deleteSeason(id: string): Promise<void> {
    const { supabase } = await this.ctx();
    unwrap(await supabase.from('seasons').delete().eq('id', id).select().maybeSingle());
  }

  /**
   * Emails every guardian about a newly created event, without making the
   * caller wait. Best-effort by design: never fail event creation over a mail
   * problem, and never hold the coach's spinner for the sum of one
   * send-email invoke per guardian (in series, a 25-player team was 25 round
   * trips of dead time; a 1000-player team was hopeless).
   */
  private dispatchScheduleEmails(emails: string[], form: CreateEventForm): void {
    if (emails.length === 0) return;
    void Promise.allSettled(
      emails.map((email) =>
        this.sendEmail('schedule_update', email, {
          eventName: form.title,
          date: form.date,
          time: form.startTime,
          location: form.location,
        }),
      ),
    ).then((results) => {
      const failed = results.filter((r) => r.status === 'rejected');
      if (failed.length) {
        console.error(
          `Failed to send ${failed.length}/${emails.length} schedule emails`,
          (failed[0] as PromiseRejectedResult).reason,
        );
      }
    });
  }

  async addSeasonEvent(
    seasonId: string,
    form: CreateEventForm,
    onProgress?: (done: number, total: number) => void,
  ): Promise<SeasonEvent> {
    const { supabase } = await this.ctx();

    // Fast path: the event row and every invite in ONE statement, server-side.
    //
    // The fallback below has to read the roster (paged) and then write the
    // invites back in small chunks, because event_availability's write policy
    // is re-evaluated per row and a big insert from the client trips the 8s
    // statement timeout. create_season_event_for_caller() authorizes once for
    // the season and then inserts set-based as a definer, so a 1000-player
    // event costs one round trip instead of ~55. See
    // 20260826180000_create_season_event_rpc.sql.
    const selectedIds = form.playerIds && form.playerIds.length > 0 ? form.playerIds : null;
    if (selectedIds) onProgress?.(0, selectedIds.length);
    const rpc = await supabase.rpc('create_season_event_for_caller', {
      p_season_id: seasonId,
      p_event: {
        kind: EVENT_KIND_TO_DB[form.type] ?? 'game',
        title: form.title,
        event_date: form.date,
        end_date: form.endDate || form.date,
        start_time: form.startTime ?? null,
        end_time: form.endTime ?? null,
        location: form.location ?? null,
        notes: form.notes ?? null,
      },
      p_roster_ids: selectedIds,
    });
    if (!rpc.error) {
      const payload = (rpc.data ?? {}) as Row;
      const eventRow = payload.event as Row;
      const invited = Number(payload.invited_count ?? 0);
      onProgress?.(invited, invited);
      this.dispatchScheduleEmails((payload.guardian_emails as string[]) ?? [], form);
      return this.rowToSeasonEvent(eventRow, {});
    }
    // Only a not-yet-deployed function falls through — anything else (a real
    // authorization failure, a bad date) must surface rather than be retried
    // the slow way and fail again at the end of a long progress bar.
    if (rpc.error.code !== 'PGRST202' && rpc.error.code !== '42883') {
      throw new Error(rpc.error.message);
    }
    console.warn('create_season_event_for_caller() not deployed — falling back to the chunked write.');

    const row = unwrap(
      await supabase
        .from('season_events')
        .insert({
          season_id: seasonId,
          kind: EVENT_KIND_TO_DB[form.type] ?? 'game',
          title: form.title,
          event_date: form.date,
          end_date: form.endDate || form.date,
          start_time: form.startTime ?? null,
          end_time: form.endTime ?? null,
          location: form.location ?? null,
          notes: form.notes ?? null,
        })
        .select()
        .single(),
    ) as Row;

    const eventId = row.id;

    // Only the roster is needed here — reading it directly instead of through
    // getSeason() skips assembling the season's events, every availability row
    // on them, and its portal invites, none of which this uses.
    // Paged: an unbounded select stops at PostgREST's row cap, so on a season
    // with more than ~1000 players every event silently invited only the first
    // 1000 of them — and the rest never saw it in the guardian portal.
    const rosterRows = await this.fetchAllByIn(
      'season_roster',
      'id, athletes(guardian_email)',
      'season_id',
      [seasonId],
      SEASON_ROSTER_PAGE,
    );

    if (rosterRows.length > 0) {
      // Find which players are selected (default to all if none provided)
      const selected = form.playerIds && form.playerIds.length > 0
        ? rosterRows.filter((r) => form.playerIds!.includes(r.id))
        : rosterRows;

      // Pre-populate event_availability for these players. This is what later
      // gates who receives schedule/reminder emails, so a failure here must
      // surface — don't swallow it, or the event silently ends up with no
      // recipients even though players are attached.
      if (selected.length > 0) {
        const availability = selected.map((r) => ({
          season_event_id: eventId,
          roster_id: r.id,
          response: 'pending' as const,
        }));
        // Chunked for the same reason the roster upserts are: a whole large
        // team's worth of rows in one insert outran the statement timeout.
        const chunks: (typeof availability)[] = [];
        for (let i = 0; i < availability.length; i += ROSTER_UPSERT_CHUNK) {
          chunks.push(availability.slice(i, i + ROSTER_UPSERT_CHUNK));
        }
        let done = 0;
        let failedRows = 0;
        onProgress?.(0, availability.length);
        await mapPool(chunks, ROSTER_WRITE_CONCURRENCY, async (chunk) => {
          try {
            unwrap(await supabase.from('event_availability').insert(chunk));
          } catch (e) {
            // A slow/failed chunk must not cost the rest of the roster their
            // invite, or throw away the chunks that already landed — only
            // surface an error below if literally nobody got invited.
            failedRows += chunk.length;
            console.error('Failed to insert an event_availability chunk', e);
          } finally {
            done += chunk.length;
            onProgress?.(Math.min(availability.length, done), availability.length);
          }
        });
        if (failedRows === availability.length) {
          throw new Error('Could not invite any players to this event. Please try again.');
        }
      }

      // Find all guardians related to the selected players and send them emails.
      const emails = Array.from(new Set(
        selected
          .map((r) => {
            const a = Array.isArray(r.athletes) ? r.athletes[0] : r.athletes;
            return a?.guardian_email as string | undefined;
          })
          .filter(Boolean) as string[],
      ));

      this.dispatchScheduleEmails(emails, form);
    }

    return this.rowToSeasonEvent(row, {});
  }

  async updateSeasonEvent(
    seasonId: string,
    eventId: string,
    updates: Partial<SeasonEvent>,
  ): Promise<SeasonEvent> {
    const { supabase } = await this.ctx();
    const patch: Row = {};
    if (updates.type !== undefined) patch.kind = EVENT_KIND_TO_DB[updates.type];
    if (updates.title !== undefined) patch.title = updates.title;
    if (updates.date !== undefined) patch.event_date = updates.date;
    if (updates.endDate !== undefined || updates.date !== undefined) {
      patch.end_date = updates.endDate || updates.date || patch.event_date;
    }
    if (updates.startTime !== undefined) patch.start_time = updates.startTime || null;
    if (updates.endTime !== undefined) patch.end_time = updates.endTime || null;
    if (updates.location !== undefined) patch.location = updates.location || null;
    if (updates.notes !== undefined) patch.notes = updates.notes || null;
    const row = unwrap(
      await supabase.from('season_events').update(patch).eq('id', eventId).select().single(),
    ) as Row;

    try {
      const { data: availPlayers } = await supabase
        .from('event_availability')
        .select(`
          roster_id,
          season_roster(
            player_email,
            athletes(
              guardian_email
            )
          )
        `)
        .eq('season_event_id', eventId);

      const playerEmails = new Set<string>();
      const guardianEmails = new Set<string>();

      if (availPlayers) {
        for (const item of availPlayers as any[]) {
          const sr = item.season_roster;
          if (sr) {
            if (sr.player_email) playerEmails.add(sr.player_email);
            if (sr.athletes?.guardian_email) guardianEmails.add(sr.athletes.guardian_email);
          }
        }
      }

      const allEmails = new Set([...playerEmails, ...guardianEmails]);

      if (playerEmails.size > 0) {
        supabase.functions.invoke('send-push-notification', {
          body: { target_user_ids: Array.from(playerEmails), heading: `Schedule Update: ${row.title}`, content: `Event updated to ${row.event_date}.` }
        }).catch(console.error);
      }

      for (const email of allEmails) {
        supabase.functions.invoke('send-email', {
          body: { type: 'schedule_update', to: email, payload: { eventName: row.title, date: row.event_date, time: row.start_time, location: row.location } }
        }).catch(console.error);
      }
    } catch (e) {
      console.error('Failed to send update emails', e);
    }

    return this.rowToSeasonEvent(row, {});
  }

  async deleteSeasonEvent(_seasonId: string, eventId: string): Promise<void> {
    const { supabase } = await this.ctx();
    unwrap(await supabase.from('season_events').delete().eq('id', eventId).select().maybeSingle());
  }

  async addSeasonPlayer(seasonId: string, player: Omit<SeasonPlayer, 'id'>): Promise<SeasonPlayer> {
    const { supabase, accountId } = await this.ctx();
    const athleteId = player.athleteId || await this.createAthlete(accountId, {
      first_name: player.firstName,
      last_name: player.lastName,
      guardian_email: player.guardianEmail || null,
      guardian_phone: player.guardianPhone || null,
      player_email: player.playerEmail || null,
    });
    const row = unwrap(
      await supabase
        .from('season_roster')
        .insert({
          season_id: seasonId,
          athlete_id: athleteId,
          jersey: player.jersey || null,
          player_email: player.playerEmail || null,
        })
        .select('*, athletes(*)')
        .single(),
    ) as Row;
    return this.rowToSeasonPlayer(row, []);
  }

  async addSeasonPlayers(
    seasonId: string,
    players: { athleteId: string; jersey?: string; playerEmail?: string }[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<SeasonPlayer[]> {
    if (players.length === 0) return [];
    const { supabase } = await this.ctx();
    // De-dupe in-memory first: `upsert` rejects a payload that hits the same
    // (season_id, athlete_id) twice within one statement, and a team roster can
    // legitimately list the same athlete more than once.
    const byAthlete = new Map<string, { athleteId: string; jersey?: string; playerEmail?: string }>();
    for (const p of players) {
      if (p.athleteId && !byAthlete.has(p.athleteId)) byAthlete.set(p.athleteId, p);
    }
    const payload = Array.from(byAthlete.values()).map((p) => ({
      season_id: seasonId,
      athlete_id: p.athleteId,
      jersey: p.jersey || null,
      player_email: p.playerEmail || null,
    }));

    // Chunked rather than one statement, for the same reason
    // addTeamRosterPlayers is: a whole large team's worth of rows in a single
    // upsert — with `athletes(*)` embedded in the RETURNING clause, so the
    // athletes read policy runs once per returned row — outran the statement
    // timeout and failed the entire write with nothing saved.
    const chunks: (typeof payload)[] = [];
    for (let i = 0; i < payload.length; i += ROSTER_UPSERT_CHUNK) {
      chunks.push(payload.slice(i, i + ROSTER_UPSERT_CHUNK));
    }
    let done = 0;
    onProgress?.(0, payload.length);
    const pages = await mapPool(chunks, ROSTER_WRITE_CONCURRENCY, async (chunk) => {
      const rows = unwrap(
        await supabase
          .from('season_roster')
          .upsert(
            chunk,
            // Athletes already enrolled keep their existing row (jersey, fee
            // status) — this is a "make sure they're on the season" call, not an
            // edit. `unique (season_id, athlete_id)` backs the conflict target.
            { onConflict: 'season_id,athlete_id', ignoreDuplicates: true },
          )
          .select('*, athletes(*)'),
      ) as Row[];
      done += chunk.length;
      onProgress?.(Math.min(payload.length, done), payload.length);
      return rows;
    });
    return pages.flat().map((r) => this.rowToSeasonPlayer(r, []));
  }

  async deleteSeasonPlayer(_seasonId: string, playerId: string): Promise<void> {
    const { supabase } = await this.ctx();
    unwrap(
      await supabase.from('season_roster').delete().eq('id', playerId).select().maybeSingle(),
    );
  }

  async importSeasonPlayersFromTeam(
    seasonId: string,
    onProgress?: (done: number, total: number) => void,
  ): Promise<SeasonPlayer[]> {
    const { supabase } = await this.ctx();
    const seasonRow = unwrap(
      await supabase.from('seasons').select('team_id').eq('id', seasonId).single()
    ) as Row;

    const teamId = seasonRow.team_id;
    if (!teamId) {
      throw new Error('No team linked to this season');
    }

    const { data: tryouts } = await supabase
      .from('tryouts')
      .select('id')
      .eq('team_id', teamId);

    // The season roster as it stands, not an empty list: this returns the
    // roster, and "there was nothing new to import" is not the same as "this
    // season has nobody on it". Callers use the return value as the set of
    // players to invite (see syncSeasonRosterFromTeam), so answering [] here
    // would drop every athlete already enrolled.
    if (!tryouts || tryouts.length === 0) {
      return this.listSeasonRoster(seasonId);
    }

    const tryoutIds = tryouts.map((t) => t.id);

    // Paged, for the same reason every other read of these two tables is: an
    // unbounded select stops at PostgREST's row cap, so a team whose linked
    // assessments carry more than ~1000 participants silently imported only
    // the first page of them — and a capped read of the *existing* roster
    // made the diff below re-add athletes that were already enrolled.
    // total: 0 is the "still scanning, don't know the total yet" signal the
    // UI reads as distinct from a finished count — this read is the part that
    // can genuinely run long on a big linked assessment (RLS is evaluated per
    // row) with no fixed total to report until it's done, so without this the
    // progress bar had nothing to show but a static placeholder for however
    // long it took.
    const participants = await this.fetchAllByIn(
      'tryout_participants',
      'athlete_id, jersey, removed_at',
      'tryout_id',
      tryoutIds,
      PARTICIPANTS_PAGE,
      (soFar) => onProgress?.(soFar, 0),
    );
    // Soft-removed participants stay in the table so their evaluations still
    // count toward the athlete's history, but they are no longer on the
    // assessment's active roster and must not be enrolled onto the season.
    const active = participants.filter((p) => !p.removed_at);

    // Same reasoning as the no-linked-assessments case above.
    if (active.length === 0) {
      return this.listSeasonRoster(seasonId);
    }

    const existingRoster = await this.fetchAllByIn(
      'season_roster',
      'athlete_id',
      'season_id',
      [seasonId],
      SEASON_ROSTER_PAGE,
    );

    const existingAthleteIds = new Set(existingRoster.map((r) => r.athlete_id));

    const uniqueAthletes = new Map<string, string | null>();
    const distinctActiveIds = new Set<string>();
    for (const p of active) {
      if (!p.athlete_id) continue;
      distinctActiveIds.add(p.athlete_id);
      if (!existingAthleteIds.has(p.athlete_id)) {
        if (!uniqueAthletes.has(p.athlete_id) || p.jersey) {
          uniqueAthletes.set(p.athlete_id, p.jersey);
        }
      }
    }

    // Reported the moment the scan above finishes, not left blank through it:
    // the two paginated reads this function starts with are themselves a
    // real, if usually brief, network cost on a large linked assessment, and
    // there's no meaningful done/total to report until they've both landed —
    // this turns "nothing on screen while it works" into an honest starting
    // count (which, when nothing new needs enrolling, is already the answer).
    let done = distinctActiveIds.size - uniqueAthletes.size;
    onProgress?.(done, distinctActiveIds.size);

    if (uniqueAthletes.size > 0) {
      // Chunked for the same reason the other season_roster writes are: one
      // insert for a whole assessment's worth of athletes outran the statement
      // timeout, and PostgREST re-evaluates the insert policy per row.
      const inserts = Array.from(uniqueAthletes.entries()).map(([athleteId, jersey]) => ({
        season_id: seasonId,
        athlete_id: athleteId,
        jersey: jersey || null,
      }));
      const chunks: (typeof inserts)[] = [];
      for (let i = 0; i < inserts.length; i += ROSTER_UPSERT_CHUNK) {
        chunks.push(inserts.slice(i, i + ROSTER_UPSERT_CHUNK));
      }
      await mapPool(chunks, ROSTER_WRITE_CONCURRENCY, async (chunk) => {
        unwrap(await supabase.from('season_roster').insert(chunk));
        done += chunk.length;
        onProgress?.(Math.min(distinctActiveIds.size, done), distinctActiveIds.size);
      });
    }

    // listSeasonRoster, not getSeason: callers only ever want the roster, and
    // getSeason() assembles every event and every RSVP row on all of them on
    // top of it — the dominant cost of this call, and pure waste here.
    return this.listSeasonRoster(seasonId);
  }

  async emailScheduleToPlayers(seasonId: string): Promise<void> {
    const { supabase } = await this.ctx();
    const season = await this.getSeason(seasonId);
    if (!season) throw new Error('Season not found');

    // Get all roster IDs that are assigned to at least one event in this season
    const eventIds = season.events.map(e => e.id);
    let availData: any[] = [];
    if (eventIds.length > 0) {
      const { data } = await supabase.from('event_availability').select('roster_id').in('season_event_id', eventIds);
      availData = data || [];
    }

    const assignedRosterIds = new Set(availData.map((a: any) => a.roster_id));

    // Restrict to players assigned to an event. If no availability rows exist at
    // all (e.g. events created before availability was pre-populated, or a failed
    // pre-population), fall back to the full roster so players who have emails
    // still receive the schedule instead of silently getting nothing.
    const restrictToAssigned = assignedRosterIds.size > 0;

    const emails = new Set<string>();
    for (const p of season.roster) {
      if (!restrictToAssigned || assignedRosterIds.has(p.id)) {
        if (p.playerEmail) emails.add(p.playerEmail);
        if (p.guardianEmail) emails.add(p.guardianEmail);
        if (p.portalInviteEmails) {
          for (const e of p.portalInviteEmails) if (e) emails.add(e);
        }
      }
    }

    if (emails.size === 0) {
      throw new Error('No player or guardian emails found for players added to scheduled events.');
    }

    const scheduleUrl = `https://aas-tryout.app/?schedule=${season.scheduleShareToken}`;

    for (const email of emails) {
      await supabase.functions.invoke('send-email', {
        body: {
          type: 'schedule_update',
          to: email,
          payload: {
            eventName: `Public Schedule for ${season.teamName}`,
            date: 'View online',
            time: scheduleUrl,
            location: 'Online Portal'
          }
        }
      });
    }
  }



  async sendPortalInvite(seasonId: string, playerId: string, email: string): Promise<void> {
    const { supabase, accountId } = await this.ctx();
    const roster = unwrap(
      await supabase.from('season_roster').select('athlete_id').eq('id', playerId).single(),
    ) as Row;
    const token = generateId('invite').slice(0, 20);
    await supabase.from('portal_invites').insert({
      account_id: accountId,
      athlete_id: roster.athlete_id,
      season_id: seasonId,
      email,
      token,
    });
    const { error } = await supabase.functions.invoke('send-email', {
      body: { type: 'org_invite', to: email, payload: { role: 'Guardian/Player' } }
    });
    if (error) {
      let msg = error.message;
      try {
        const body = await error.context.json();
        if (body?.error) msg = body.error;
      } catch { }
      throw new Error(msg);
    }
  }

  async sendTeamAnnouncement(seasonId: string, title: string, message: string): Promise<void> {
    const { supabase } = await this.ctx();
    const { data } = await supabase.from('season_roster').select('player_email').eq('season_id', seasonId);
    const emails = data?.map((r) => r.player_email).filter(Boolean) || [];
    if (emails.length > 0) {
      supabase.functions.invoke('send-push-notification', {
        body: { target_user_ids: emails, heading: `Announcement: ${title}`, content: message }
      }).catch(console.error);

      for (const email of emails) {
        supabase.functions.invoke('send-email', {
          body: { type: 'reminder', to: email, payload: { title, message } }
        }).catch(console.error);
      }
    }
  }

  private mapTeamMessage(row: Row): TeamMessage {
    return {
      id: row.id,
      seasonId: row.season_id,
      authorUserId: row.author_user_id,
      authorName: row.author_name,
      authorRole: row.author_role,
      body: row.body,
      createdAt: toMs(row.created_at),
    };
  }

  // userCtx() rather than ctx(): a guardian has no staff account of their own,
  // and RLS here keys off can_access_season(), not the caller's account.
  async listTeamMessages(seasonId: string): Promise<TeamMessage[]> {
    const { supabase } = await this.userCtx();
    // Newest-first with a cap so a long-running team's history doesn't grow
    // unbounded on the wire; reversed to chronological for display.
    const rows = unwrap(
      await supabase
        .from('season_messages')
        .select('*')
        .eq('season_id', seasonId)
        .order('created_at', { ascending: false })
        .limit(200),
    ) as Row[] | null;
    return (rows ?? []).reverse().map((row) => this.mapTeamMessage(row));
  }

  async sendTeamMessage(seasonId: string, body: string): Promise<TeamMessage> {
    const { supabase } = await this.userCtx();
    // author_name/author_role are derived inside the function — see the
    // season_messages migration for why clients can't insert directly.
    const data = unwrap(
      await supabase.rpc('send_season_message', { p_season_id: seasonId, p_body: body }),
    );
    const row = Array.isArray(data) ? data[0] : data;
    return this.mapTeamMessage(row as Row);
  }

  async deleteTeamMessage(messageId: string): Promise<void> {
    const { supabase } = await this.userCtx();
    // `.select()` is load-bearing: a DELETE that RLS filters down to zero rows
    // comes back with no error and no data, so without it a blocked delete is
    // indistinguishable from a successful one — the caller invalidates, refetches,
    // and the message is simply still there with nothing shown to the user. Same
    // silent-no-op trap as the assessor `.delete()` that set_assessor_status fixed.
    const rows = unwrap(
      await supabase.from('season_messages').delete().eq('id', messageId).select('id'),
    ) as Row[] | null;
    if (!rows || rows.length === 0) {
      throw new Error(
        'That message could not be removed. season_messages_delete only allows the message author, ' +
          'or an owner/admin/coach on the account that owns this season.',
      );
    }
  }

  async listAthletes(): Promise<Athlete[]> {
    const { supabase, accountId } = await this.ctx();

    const { data: grantRows } = await supabase
      .from('athlete_account_access')
      .select('athlete_id')
      .eq('account_id', accountId);
    const grantedIds = (grantRows ?? []).map((g: any) => g.athlete_id);

    // Keyset-paged by id, the same way fetchAllByIn does it — that helper only
    // supports a single `.in()` filter, and this read needs an `.or()`. Without
    // paging the library silently stopped at PostgREST's row cap, so an account
    // past ~1000 athletes simply could not see the rest of them.
    const ATHLETE_PAGE = 500;
    const athletes: Row[] = [];
    let cursor: string | null = null;
    for (;;) {
      let athleteQuery = supabase
        .from('athletes')
        .select('*, tryout_participants(current_team, current_level, jersey, created_at)')
        .order('id')
        .limit(ATHLETE_PAGE);
      athleteQuery = grantedIds.length
        ? athleteQuery.or(`account_id.eq.${accountId},id.in.(${grantedIds.join(',')})`)
        : athleteQuery.eq('account_id', accountId);
      if (cursor !== null) athleteQuery = athleteQuery.gt('id', cursor);

      const { data, error } = await athleteQuery;
      if (error) throw new Error(error.message);
      const page = (data ?? []) as Row[];
      athletes.push(...page);
      if (page.length < ATHLETE_PAGE) break;
      cursor = page[page.length - 1].id as string;
    }

    // Ordering came off the server before; it has to come after paging now,
    // since pages are ordered by id.
    athletes.sort((a, b) => String(a.first_name ?? '').localeCompare(String(b.first_name ?? '')));

    return athletes.map(a => {
      const parts = (a.tryout_participants as any[])?.sort((p1, p2) =>
        new Date(p1.created_at).getTime() - new Date(p2.created_at).getTime()
      ) || [];
      const recentPart = parts.length > 0 ? parts[parts.length - 1] : null;

      return {
        id: a.id,
        first: a.first_name ?? '',
        last: a.last_name ?? '',
        yearOfBirth: a.year_of_birth != null ? String(a.year_of_birth) : undefined,
        playerEmail: a.player_email ?? undefined,
        guardianName: a.guardian_name ?? undefined,
        guardianEmail: a.guardian_email ?? undefined,
        guardianPhone: a.guardian_phone ?? undefined,
        medicalInfo: a.medical_info ?? undefined,
        aboutChild: a.about ?? undefined,
        currentPosition: a.default_position ?? undefined,
        currentTeam: recentPart?.current_team ?? undefined,
        currentLevel: recentPart?.current_level ?? undefined,
        jersey: recentPart?.jersey ?? undefined,
        pastSeasonsCount: parts.length,
      };
    });
  }

  async getAthleteHistory(athleteId: string): Promise<AthleteHistory> {
    const { supabase } = await this.ctx();

    // 1. Fetch past seasons
    const { data: rosterRows } = await supabase
      .from('season_roster')
      .select('season_id, seasons(name, team_name)')
      .eq('athlete_id', athleteId);

    let pastSeasons = (rosterRows || []).map((r: any) => ({
      seasonId: r.season_id,
      seasonName: r.seasons?.name || 'Unknown Season',
      teamName: r.seasons?.team_name || 'Unknown Team',
    }));

    if (pastSeasons.length > 0) {
      const seasonIds = pastSeasons.map((s) => s.seasonId);
      const { data: eventsData } = await supabase
        .from('season_events')
        .select('season_id')
        .in('season_id', seasonIds);

      const seasonsWithEvents = new Set((eventsData || []).map((e: any) => e.season_id));
      pastSeasons = pastSeasons.filter((s) => seasonsWithEvents.has(s.seasonId));
    }

    // 2. Fetch past evaluations across tryouts
    const { data: tryoutRosterRows } = await supabase
      .from('tryout_participants')
      .select('id, tryout_id')
      .eq('athlete_id', athleteId);

    let pastEvaluations: Evaluation[] = [];
    if (tryoutRosterRows && tryoutRosterRows.length > 0) {
      const tryoutIds = [...new Set(tryoutRosterRows.map((r: any) => r.tryout_id))];
      const { data: activeTryouts } = await supabase
        .from('tryouts')
        .select('id')
        .in('id', tryoutIds)
        .is('deleted_at', null);
      const activeTryoutIds = new Set((activeTryouts ?? []).map((t: any) => t.id));
      const rosterIds = tryoutRosterRows
        .filter((r: any) => activeTryoutIds.has(r.tryout_id))
        .map((r: any) => r.id);
      if (rosterIds.length > 0) {
        const { data: evals } = await supabase
          .from('evaluations')
          .select('*, evaluation_scores(rubric_key, value)')
          .in('participant_id', rosterIds);
        if (evals) {
          pastEvaluations = evals.map(e => this.rowToEval(e));
        }
      }
    }

    return {
      athleteId,
      pastSeasons,
      pastEvaluations,
    };
  }

  /**
   * Everything getPlayerProfile needs to describe an athlete's assessment
   * history — pulled out on its own so a share snapshot (shareAthleteWithCoach)
   * can reuse the exact same aggregation instead of duplicating it.
   */
  private async fetchAthleteAssessmentContext(
    supabase: SupabaseClient,
    athleteId: string,
  ): Promise<{
    participants: Row[];
    tryoutById: Map<string, Row>;
    teams: { teamId: string; teamName: string }[];
    assessments: PlayerProfileAssessment[];
  }> {
    const { data: participantRows } = await supabase
      .from('tryout_participants')
      .select('id, tryout_id, jersey, position, current_team, current_level, created_at')
      .eq('athlete_id', athleteId);
    const participants = participantRows ?? [];

    const tryoutIds = [...new Set(participants.map((p: any) => p.tryout_id))];
    const { data: tryoutRows } = tryoutIds.length
      ? await supabase
          .from('tryouts')
          .select('id, name, sport, settings, tryout_date, created_at, event_type, season_id, team_id, teams(name)')
          .in('id', tryoutIds)
          .is('deleted_at', null)
      : { data: [] as any[] };
    const tryoutById = new Map((tryoutRows ?? []).map((t: any) => [t.id, t]));

    // A tryout's `season_id` column is only ever set when it's created from inside a Season
    // Hub screen — a flow that doesn't currently exist in the app. What every team-linked
    // assessment DOES have is the Season Hub entry auto-created alongside its team (see
    // createTeam/team/new.tsx), which is what actually carries season identity here.
    const tryoutTeamIds = [...new Set((tryoutRows ?? []).map((t: any) => t.team_id).filter(Boolean))];
    const tryoutSeasonIds = [...new Set((tryoutRows ?? []).map((t: any) => t.season_id).filter(Boolean))];

    let allSeasons: any[] = [];
    if (tryoutTeamIds.length > 0) {
      const { data } = await supabase
        .from('seasons')
        .select('id, name, team_id, created_at')
        .in('team_id', tryoutTeamIds)
        .order('created_at', { ascending: false });
      if (data) allSeasons.push(...data);
    }

    if (tryoutSeasonIds.length > 0) {
      const alreadyFetchedIds = new Set(allSeasons.map(s => s.id));
      const remainingSeasonIds = tryoutSeasonIds.filter(id => !alreadyFetchedIds.has(id));

      if (remainingSeasonIds.length > 0) {
        const { data } = await supabase
          .from('seasons')
          .select('id, name, team_id, created_at')
          .in('id', remainingSeasonIds);
        if (data) allSeasons.push(...data);
      }
    }

    allSeasons.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    const seasonsByTeamId = new Map<string, any[]>();
    const seasonById = new Map<string, { id: string; name: string }>();
    for (const s of allSeasons) {
      if (s.team_id) {
        const arr = seasonsByTeamId.get(s.team_id) || [];
        arr.push(s);
        seasonsByTeamId.set(s.team_id, arr);
      }
      if (!seasonById.has(s.id)) seasonById.set(s.id, { id: s.id, name: s.name });
    }

    // Actual team membership (Teams feature) — the source of truth for "current team",
    // since tryout_participants.current_team is a free-text field that's usually left blank.
    const { data: teamRosterRows } = await supabase
      .from('team_roster')
      .select('team_id, created_at, teams(name)')
      .eq('athlete_id', athleteId)
      .order('created_at', { ascending: false });
    const teamRoster = teamRosterRows ?? [];
    const teams = [...new Map(teamRoster.map((r: any) => [r.team_id, {
      teamId: r.team_id,
      teamName: r.teams?.name ?? 'Unknown Team',
    }])).values()];

    const participantIds = participants.map((p: any) => p.id);
    const evalRows = await this.fetchAllByIn(
      'evaluations',
      '*, evaluation_scores(rubric_key, value)',
      'participant_id',
      participantIds,
      EVALUATIONS_PAGE,
    );
    const evalsByParticipant = new Map<string, Evaluation[]>();
    for (const row of evalRows) {
      const ev = this.rowToEval(row);
      const arr = evalsByParticipant.get(ev.playerId) ?? [];
      arr.push(ev);
      evalsByParticipant.set(ev.playerId, arr);
    }

    const assessments: PlayerProfileAssessment[] = participants
      .map((p: any): PlayerProfileAssessment | null => {
        const tryout = tryoutById.get(p.tryout_id);
        if (!tryout) return null;
        const evals = evalsByParticipant.get(p.id) ?? [];
        const categories = getPlayerCategories(tryout.sport, p.position, tryout.settings?.customRubrics ?? []);
        const weights = isGoaliePosition(p.position)
          ? tryout.settings?.goalieWeights ?? {}
          : tryout.settings?.skaterWeights ?? {};
        const overall = evals.length ? weightedOverallAcrossEvals(evals, categories, weights) : 0;
        const categoryScores = categoryAveragesAcrossEvals(evals, categories);
        const latest = [...evals].sort((a, b) => b.createdAt - a.createdAt)[0];
        const explicitSeason = tryout.season_id ? seasonById.get(tryout.season_id) : undefined;
        let teamSeason: { id: string; name: string } | undefined;
        if (!explicitSeason && tryout.team_id) {
          const teamSeasons = seasonsByTeamId.get(tryout.team_id);
          if (teamSeasons && teamSeasons.length > 0) {
            const tryoutTime = new Date(tryout.tryout_date ?? tryout.created_at ?? Date.now()).getTime();
            let closestSeason = teamSeasons[0];
            let minDiff = Math.abs(new Date(closestSeason.created_at).getTime() - tryoutTime);
            for (const s of teamSeasons) {
              const diff = Math.abs(new Date(s.created_at).getTime() - tryoutTime);
              if (diff < minDiff) {
                minDiff = diff;
                closestSeason = s;
              }
            }
            teamSeason = { id: closestSeason.id, name: closestSeason.name };
          }
        }
        const resolvedSeason = explicitSeason ?? teamSeason;
        return {
          tryoutId: tryout.id,
          tryoutName: tryout.name,
          seasonId: resolvedSeason?.id ?? tryout.season_id ?? undefined,
          seasonName: resolvedSeason?.name ?? undefined,
          eventType: tryout.event_type,
          sport: tryout.sport,
          date: tryout.tryout_date ?? undefined,
          position: p.position ?? undefined,
          teamName: tryout.teams?.name ?? undefined,
          overall,
          categoryScores,
          evalCount: evals.length,
          latestRecommendation: (latest?.recommendation ?? '') as Recommendation,
          participantId: p.id,
          evaluations: evals.map(ev => ({
            ...ev,
            overall: weightedOverallAcrossEvals([ev], categories, weights),
          })),
        };
      })
      .filter((a): a is PlayerProfileAssessment => a !== null)
      .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));

    return { participants, tryoutById, teams, assessments };
  }

  async getPlayerProfile(athleteId: string): Promise<PlayerProfile> {
    const { supabase } = await this.ctx();

    const { data: athleteRow } = await supabase
      .from('athletes')
      .select('id, first_name, last_name, avatar_url, player_email, guardian_name, guardian_email, guardian_phone, default_position, year_of_birth, about, medical_info')
      .eq('id', athleteId)
      .maybeSingle();
    if (!athleteRow) throw new Error('Athlete not found');

    const { participants, tryoutById, teams, assessments } = await this.fetchAthleteAssessmentContext(
      supabase,
      athleteId,
    );

    const { data: rosterRows } = await supabase
      .from('season_roster')
      .select('season_id, seasons(name, team_name)')
      .eq('athlete_id', athleteId);
    const pastSeasons = (rosterRows || []).map((r: any) => ({
      seasonId: r.season_id,
      seasonName: r.seasons?.name || 'Unknown Season',
      teamName: r.seasons?.team_name || 'Unknown Team',
    }));

    const mostRecent = [...participants].sort(
      (a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    ).pop() as any;
    const mostRecentTryout = mostRecent ? tryoutById.get(mostRecent.tryout_id) : undefined;

    // "Current team" priority: actual Teams roster membership (most authoritative) >
    // the free-text field on their latest assessment > the team that assessment was run for.
    const currentTeam =
      teams[0]?.teamName ?? mostRecent?.current_team ?? mostRecentTryout?.teams?.name ?? undefined;

    return {
      athleteId,
      first: athleteRow.first_name ?? '',
      last: athleteRow.last_name ?? '',
      avatarUrl: athleteRow.avatar_url ?? undefined,
      currentPosition: mostRecent?.position ?? athleteRow.default_position ?? undefined,
      currentTeam,
      currentLevel: mostRecent?.current_level ?? undefined,
      jersey: mostRecent?.jersey ?? undefined,
      yearOfBirth: athleteRow.year_of_birth != null ? String(athleteRow.year_of_birth) : undefined,
      aboutChild: athleteRow.about ?? undefined,
      medicalInfo: athleteRow.medical_info ?? undefined,
      playerEmail: athleteRow.player_email ?? undefined,
      guardianName: athleteRow.guardian_name ?? undefined,
      guardianEmail: athleteRow.guardian_email ?? undefined,
      guardianPhone: athleteRow.guardian_phone ?? undefined,
      pastSeasons,
      teams,
      assessments,
    };
  }

  async setEventAvailability(
    seasonId: string,
    eventId: string,
    playerId: string,
    response: 'yes' | 'maybe' | 'no',
  ): Promise<void> {
    const { supabase } = await this.ctx();
    const rosterRow = unwrap(
      await supabase
        .from('season_roster')
        .select('id')
        .eq('season_id', seasonId)
        .or(`athlete_id.eq.${playerId},id.eq.${playerId}`)
        .maybeSingle()
    ) as Row | null;

    if (!rosterRow) {
      console.warn('Cannot set availability: player is not in roster');
      return;
    }

    unwrap(
      await supabase
        .from('event_availability')
        .upsert(
          { season_event_id: eventId, roster_id: rosterRow.id, response },
          { onConflict: 'season_event_id,roster_id' },
        )
    );
  }

  // ─── Phase 4: Enterprise & Admin ─────────────────────────────────────────────────
  async getOrg(): Promise<Org | null> {
    const { supabase, accountId } = await this.ctx();
    const account = unwrap(
      await supabase.from('accounts').select('*').eq('id', accountId).single(),
    ) as Row;
    // Deliberately not gated on `type === 'organization'`: accounts default to
    // 'individual' and are only flipped when someone fills in an organization
    // name (see updateUserProfile), so gating here errored the whole dashboard
    // out with "No organization found" for plan-eligible accounts that never set
    // one. Access is governed by plan tier, and every metric on the screen is
    // derived from this same account either way.

    const [members, tryouts, athletes] = await Promise.all([
      supabase.from('memberships').select('id', { count: 'exact', head: true }).eq('account_id', accountId),
      supabase.from('tryouts').select('id', { count: 'exact', head: true }).eq('account_id', accountId),
      supabase.from('athletes').select('id', { count: 'exact', head: true }).eq('account_id', accountId),
    ]);
    return {
      id: account.id,
      // `slug` is nullable and only set for orgs that claimed a handle — leave it
      // undefined rather than falling back to the account UUID, which reads as a
      // meaningless code in the UI.
      orgSlug: account.slug ?? undefined,
      orgName: account.name,
      sport: account.sport ?? undefined,
      memberCount: members.count ?? 0,
      assessmentCount: tryouts.count ?? 0,
      playerCount: athletes.count ?? 0,
      planTier: account.plan_tier,
      createdAt: toMs(account.created_at),
    };
  }

  async getEnterprisePayments(): Promise<EnterprisePayment[]> {
    const { supabase, accountId } = await this.ctx();
    // Only fees collected through the connected Stripe account carry a
    // registration_id (tryout fees) or season_roster_id (team/season fees) —
    // TryoutHQ's own subscription invoices (billed on the platform's Stripe
    // account) never do, so this filter is what excludes them from the
    // coach's payout ledger.
    const rows = (
      await supabase
        .from('payments')
        .select(
          '*, registrations(first_name, last_name), tryouts(name, teams(name)), ' +
            'season_roster(athletes(first_name, last_name), seasons(name, team_name))',
        )
        .eq('account_id', accountId)
        .or('registration_id.not.is.null,season_roster_id.not.is.null')
        .order('created_at', { ascending: false })
    ).data as any[] | null;
    return (rows ?? []).map((p) => {
      const athlete = p.season_roster?.athletes;
      return {
        id: p.id,
        playerName: p.registrations
          ? `${p.registrations.first_name} ${p.registrations.last_name}`.trim()
          : athlete
            ? `${athlete.first_name} ${athlete.last_name}`.trim()
            : 'Unknown Player',
        teamName: p.tryouts?.teams?.name ?? p.season_roster?.seasons?.team_name ?? '',
        assessmentName: p.tryouts?.name ?? (p.season_roster ? 'Team Fee' : ''),
        amount: (p.amount_cents ?? 0) / 100,
        status: p.status,
        receivedAt: p.received_at ? toMs(p.received_at) : toMs(p.created_at),
      };
    });
  }

  async getAdminStats(): Promise<AdminStats> {
    const { supabase, accountId } = await this.ctx();
    const [tryouts, regs] = await Promise.all([
      supabase.from('tryouts').select('id', { count: 'exact', head: true }).eq('account_id', accountId),
      supabase.from('registrations').select('id', { count: 'exact', head: true }),
    ]);
    return {
      totalUsers: 1,
      activeUsers: 1,
      totalAssessments: tryouts.count ?? 0,
      totalRegistrations: regs.count ?? 0,
      planDistribution: { free: 0, coach: 0, coach_plus: 0, club: 0 },
      revenueMtd: 0,
    };
  }

  async listAdminUsers(): Promise<AdminUserRow[]> {
    const { userId } = await this.ctx();
    const profile = await this.loadUserProfile(userId);
    const [teams, tryouts] = await Promise.all([this.listTeams(), this.listTryouts(true)]);
    return [
      {
        id: profile.id,
        email: profile.email,
        displayName: profile.displayName,
        planTier: profile.planTier,
        teamCount: teams.length,
        assessmentCount: tryouts.length,
        lastActiveAt: Date.now(),
      },
    ];
  }

  async overrideUserPlan(userId: string, planTier: UserProfile['planTier']): Promise<void> {
    const ctx = await this.ctx();
    if (userId === ctx.userId) {
      await ctx.supabase.from('accounts').update({ plan_tier: planTier }).eq('id', ctx.accountId);
    }
  }

  async createCheckoutSession(planTier: string, interval: 'year' | 'month'): Promise<{ url: string }> {
    const { supabase } = await this.ctx();
    const { data, error } = await supabase.functions.invoke('create-checkout-session', {
      body: { planTier, interval }
    });
    if (error) {
      let detail = '';
      try {
        const body = await error.context?.json();
        if (body?.error) detail = body.error;
      } catch (_) { }
      throw new Error(detail || error.message || 'Failed to create checkout session');
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }

  async createTeamLicenseCheckoutSession(quantity: number): Promise<{ url: string }> {
    const { supabase } = await this.ctx();
    const { data, error } = await supabase.functions.invoke('create-checkout-session', {
      body: { addOn: 'team_licenses', quantity: Math.max(1, Math.round(quantity)), interval: 'year' },
    });
    if (error) {
      let detail = '';
      try {
        const body = await error.context?.json();
        if (body?.error) detail = body.error;
      } catch (_) { }
      throw new Error(detail || error.message || 'Failed to create checkout session');
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }

  async createPortalSession(): Promise<{ url: string }> {
    const { supabase } = await this.ctx();
    const { data, error } = await supabase.functions.invoke('create-portal-session');
    if (error) {
      let detail = '';
      try {
        const body = await error.context?.json();
        if (body?.error) detail = body.error;
      } catch (_) { }
      throw new Error(detail || error.message || 'Failed to open portal session');
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }

  async createConnectAccountLink(): Promise<{ url: string }> {
    const { supabase } = await this.ctx();
    const { data, error } = await supabase.functions.invoke('create-connect-account');
    if (error) {
      let detail = '';
      try {
        const body = await error.context?.json();
        if (body?.error) detail = body.error;
      } catch (_) { }
      throw new Error(detail || error.message || 'Failed to start payout onboarding');
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }

  async getConnectAccountStatus(): Promise<ConnectAccountStatus> {
    const { supabase } = await this.ctx();
    const { data, error } = await supabase.functions.invoke('connect-account-status');
    if (error) {
      let detail = '';
      try {
        const body = await error.context?.json();
        if (body?.error) detail = body.error;
      } catch (_) { }
      throw new Error(detail || error.message || 'Failed to load connected account status');
    }
    if (data?.error) throw new Error(data.error);
    return data as ConnectAccountStatus;
  }

  async createRegistrationPayment(
    registrationId: string,
    successUrl?: string,
    cancelUrl?: string,
  ): Promise<{ url: string }> {
    // Guardians call this from the public registration page before they have an
    // account, so it must not depend on an authenticated ctx().
    const supabase = getSupabase();
    const { data, error } = await supabase.functions.invoke('create-registration-payment', {
      body: { registrationId, successUrl, cancelUrl },
    });
    if (error) {
      let detail = '';
      try {
        const body = await error.context?.json();
        if (body?.error) detail = body.error;
      } catch (_) { }
      throw new Error(detail || error.message || 'Failed to start registration payment');
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }

  async createTeamFeePayment(
    seasonRosterId: string,
    successUrl?: string,
    cancelUrl?: string,
  ): Promise<{ url: string }> {
    const { supabase } = await this.userCtx();
    const { data, error } = await supabase.functions.invoke('create-team-fee-payment', {
      body: { seasonRosterId, successUrl, cancelUrl },
    });
    if (error) {
      let detail = '';
      try {
        const body = await error.context?.json();
        if (body?.error) detail = body.error;
      } catch (_) { }
      throw new Error(detail || error.message || 'Failed to start team fee payment');
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }

  // ─── Misc ──────────────────────────────────────────────────────────────────────
  async submitFeedback(submission: FeedbackSubmission): Promise<void> {
    // No feedback table yet; log + accept so the UI flow completes.
    console.log('[feedback]', JSON.stringify(submission));
  }

  // ─── Org Members ─────────────────────────────────────────────────────────────
  async listOrgMembers(includeTeamManagers = false): Promise<import('../types').OrgMember[]> {
    const { supabase, accountId } = await this.ctx();

    // Memberships, the account's tryouts (needed only to scope the assessor
    // read) and the guardian-bearing athletes are three independent reads —
    // only the assessors depend on anything here. Running all four in series
    // put ~2.1s in front of every screen that asks who the caller is.
    const [memRes, tryoutRes, teamRes, athleteRes] = await Promise.all([
      supabase
        .from('memberships')
        .select('id, user_id, role, created_at, profiles(email, display_name)')
        .eq('account_id', accountId),
      // Fetch tryouts for the account to get assessors
      supabase.from('tryouts').select('id').eq('account_id', accountId),
      // …and the teams, for the managers they've been delegated to. Archived
      // ones included: the delegation survives the archive and comes back with
      // the team, so hiding it here would hide access that still exists. Only
      // Manage Organization asks for them — everything else on this query pays
      // a read per team otherwise.
      includeTeamManagers
        ? supabase.from('teams').select('id, name').eq('account_id', accountId)
        : Promise.resolve({ data: [] as Row[] }),
      supabase
        .from('athletes')
        .select('id, guardian_name, guardian_email, guardian_user_id, created_at')
        .eq('account_id', accountId)
        .eq('archived', false),
    ]);

    const memData = memRes.data;
    const tryouts = tryoutRes.data;
    const teams = (teamRes.data ?? []) as Row[];
    const athletesData = athleteRes.data;

    // Second wave: both of these need ids from the first one, and neither needs
    // anything from the other.
    const [assData, teamManagers] = await Promise.all([
      (async (): Promise<any[]> => {
        if (!tryouts || tryouts.length === 0) return [];
        const tryoutIds = tryouts.map(t => t.id);
        const { data } = await supabase
          .from('tryout_assessors')
          .select('id, user_id, role, joined_at, email, name')
          .in('tryout_id', tryoutIds);
        return data || [];
      })(),
      this.fetchTeamManagers(teams.map((t) => t.id as string)),
    ]);
    const members: Map<string, import('../types').OrgMember> = new Map();

    // Add memberships
    for (const r of memData || []) {
      const profiles: any = r.profiles;
      const profile = Array.isArray(profiles) ? profiles[0] : profiles;
      const email = profile?.email ?? '';
      const name = profile?.display_name ?? undefined;
      if (!email) continue;
      members.set(email.toLowerCase(), {
        id: r.id,
        orgId: accountId,
        userId: r.user_id,
        email: email,
        name,
        role: r.role === 'owner' ? 'admin' : r.role,
        status: 'active',
        createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
        source: 'membership',
      });
    }

    // Add assessors
    for (const a of assData) {
      const email = a.email;
      if (!email || members.has(email.toLowerCase())) continue;
      members.set(email.toLowerCase(), {
        id: a.id,
        orgId: accountId,
        userId: a.user_id,
        email: email,
        name: a.name ?? undefined,
        role: 'assessor',
        status: 'active',
        createdAt: a.joined_at ? new Date(a.joined_at).getTime() : Date.now(),
        source: 'assessor',
      });
    }

    // Delegated team managers (CLUB mode). They hold no membership, so before
    // this they were invisible here — Manage Organization showed no trace of
    // someone who had been handed a whole team, and removing their membership
    // (when they even had one) left the delegation behind.
    const teamNames = new Map(teams.map((t) => [t.id as string, (t.name as string) ?? 'a team']));
    for (const tm of teamManagers) {
      const email = tm.email;
      if (!email) continue;
      const emailKey = email.toLowerCase();
      const teamName = teamNames.get(tm.teamId);

      const existing = members.get(emailKey);
      if (existing) {
        // Already staff by another route. Keep that row — its id is the one the
        // role change needs — and just note the teams next to their name.
        if (teamName) existing.teams = [...(existing.teams ?? []), teamName];
        if (!existing.name && tm.name) existing.name = tm.name;
        continue;
      }

      members.set(emailKey, {
        id: tm.id,
        orgId: accountId,
        userId: tm.userId || undefined,
        email,
        name: tm.name,
        // TeamManagerRole ('manager' | 'coach') has no exact OrgRole; both run a
        // team, which is what 'coach' means on this screen.
        role: 'coach',
        // No linked account yet means the invite is still outstanding — the
        // same distinction the guardian rows draw.
        status: tm.userId ? 'active' : 'pending',
        createdAt: tm.createdAt,
        source: 'teamManager',
        teams: teamName ? [teamName] : [],
      });
    }

    // Guardians, off the athletes read issued in the wave above.
    for (const a of athletesData || []) {
      const email = a.guardian_email;
      if (!email) continue;
      const emailKey = email.toLowerCase();

      if (!members.has(emailKey)) {
        members.set(emailKey, {
          id: a.id,
          orgId: accountId,
          userId: a.guardian_user_id ?? undefined,
          email: email,
          name: a.guardian_name ?? undefined,
          role: 'guardian',
          status: a.guardian_user_id ? 'active' : 'pending',
          createdAt: a.created_at ? new Date(a.created_at).getTime() : Date.now(),
          source: 'guardian',
        });
      } else {
        const existing = members.get(emailKey)!;
        if (!existing.name && a.guardian_name) {
          existing.name = a.guardian_name;
        }
        if (!existing.userId && a.guardian_user_id) {
          existing.userId = a.guardian_user_id;
          existing.status = 'active';
        }
        if (!existing.role) {
          existing.role = 'guardian';
        }
      }
    }

    return Array.from(members.values());
  }

  async createAndInviteUser(email: string, password: string, name: string, role: import('../types').OrgRole): Promise<import('../types').OrgMember> {
    const { supabase } = await this.ctx();

    // Create or update user via the Edge Function which uses the official Supabase Admin API.
    // This guarantees the password hash is compatible with GoTrue authentication.
    // Pass account_type so the handle_new_user trigger knows whether to create a personal account.
    const accountType = role === 'guardian' ? 'guardian' : 'coach';
    const { data, error: fnError } = await supabase.functions.invoke('create-user', {
      body: { email, password, display_name: name, account_type: accountType },
    });

    if (fnError) {
      // A non-2xx status surfaces as a generic FunctionsHttpError ("Edge Function
      // returned a non-2xx status code"); the real reason is in the response body.
      let msg = fnError.message;
      try {
        const body = await (fnError as any).context.json();
        if (body?.error) msg = body.error;
      } catch { }
      throw new Error(msg || 'Failed to create user account');
    }

    // If the Edge Function returned an error in the response body
    if (data?.error) {
      throw new Error(data.error);
    }

    return this.inviteOrgMember(email, role, password);
  }

  async inviteOrgMember(email: string, role: import('../types').OrgRole, password?: string): Promise<import('../types').OrgMember> {
    const { supabase, accountId } = await this.ctx();

    const { data, error } = await supabase.rpc('invite_org_member_by_email', {
      account_uuid: accountId,
      lookup_email: email,
      org_role: role,
    });

    if (error) {
      if (error.message.includes('User not found')) {
        throw new Error('User not found. They must create an account first.');
      }
      throw error;
    }

    try {
      await this.sendEmail('org_invite', email, { role, password });
    } catch (e) {
      console.log('Failed to send org invite email (usually due to testing limits):', e);
    }

    return data as import('../types').OrgMember;
  }

  async resendGuardianInvite(userId: string, email: string, role: import('../types').OrgRole = 'guardian'): Promise<void> {
    const { supabase } = await this.ctx();
    const { error } = await supabase.functions.invoke('resend-invite', {
      body: { userId, email, role },
    });
    if (error) {
      let msg = error.message;
      try {
        const body = await error.context.json();
        if (body?.error) msg = body.error;
      } catch { }
      throw new Error(msg);
    }
  }

  async updateOrgMemberRole(memberId: string, role: import('../types').OrgRole): Promise<import('../types').OrgMember> {
    const { supabase } = await this.ctx();

    // Route through a SECURITY DEFINER RPC. A direct `memberships` update is
    // subject to RLS and silently affects zero rows (no error) when the policy
    // filters it out, which made the UI report success while the role never
    // changed. The RPC authorizes the caller, updates the row, and raises a
    // real exception on failure or a no-op.
    const { data, error } = await supabase.rpc('update_org_member_role', {
      member_id: memberId,
      new_role: role,
    });

    if (error) throw new Error(error.message);

    return (data ?? {}) as import('../types').OrgMember;
  }

  async removeOrgMember(memberId: string): Promise<void> {
    // Resolved up front because the removal is what destroys the rows the
    // identity is read from — and the identity is what the team-manager
    // revocation below matches on.
    const identity = await this.resolveOrgMemberIdentity(memberId);

    // A delegated manager has nothing in memberships/tryout_assessors/athletes,
    // so the RPC below would only report "Member not found" — giving up the
    // team *is* the removal.
    if (identity?.kind === 'teamManager') {
      await this.revokeTeamManagerAccess(identity);
      return;
    }

    const { supabase } = await this.ctx();
    const { error } = await supabase.rpc('remove_org_member', { member_id: memberId });

    if (error) {
      // Projects that haven't run 20260831000000_remove_org_member_rpc.sql yet
      // answer PGRST202 ("Could not find the function"); anything else is a
      // real failure — an authorization refusal from inside the function
      // included — and belongs in front of the user unchanged.
      const missingFunction = error.code === 'PGRST202' || error.code === '42883';
      if (!missingFunction) throw new Error(error.message);
      console.log('remove_org_member() not deployed — falling back to direct deletes.');

      await this.removeOrgMemberDirect(memberId, identity);
    }

    // A delegated team (CLUB mode) is a grant of its own: `team_managers` rows
    // are not memberships and nothing above touches them, so a coach removed
    // from the organization kept the team they had been handed and stayed on
    // its Managers list. Guardians are left alone — "Revoke" there clears a
    // guardian contact on an athlete, which says nothing about a coaching role
    // the same person may hold.
    if (identity && identity.kind !== 'guardian') {
      await this.revokeTeamManagerAccess(identity);
    }
  }

  /**
   * Who a Manage Organization row actually is. The list surfaces three
   * different kinds of row under one `id`, so every removal has to work out
   * which table the id came from before it can do anything with it.
   */
  private async resolveOrgMemberIdentity(memberId: string): Promise<OrgMemberIdentity | null> {
    const { supabase } = await this.ctx();

    const { data: membership } = await supabase
      .from('memberships')
      .select('id, user_id, role, account_id, profiles(email)')
      .eq('id', memberId)
      .maybeSingle();

    if (membership) {
      const profiles: any = membership.profiles;
      const profile = Array.isArray(profiles) ? profiles[0] : profiles;
      return {
        kind: 'membership',
        accountId: (membership.account_id as string) ?? null,
        userId: (membership.user_id as string) ?? undefined,
        email: (profile?.email as string) ?? undefined,
        role: (membership.role as string) ?? undefined,
      };
    }

    const { data: assessor } = await supabase
      .from('tryout_assessors')
      .select('id, user_id, email, tryout_id')
      .eq('id', memberId)
      .maybeSingle();

    if (assessor) {
      // Read the owning account off the tryout rather than embedding it: the
      // embed makes RLS run over the parent for a row we already hold, and a
      // relationship PostgREST can't resolve would fail the whole lookup.
      const { data: tryout } = await supabase
        .from('tryouts')
        .select('account_id')
        .eq('id', assessor.tryout_id)
        .maybeSingle();
      return {
        kind: 'assessor',
        accountId: (tryout?.account_id as string) ?? null,
        userId: (assessor.user_id as string) ?? undefined,
        email: (assessor.email as string) ?? undefined,
        tryoutId: (assessor.tryout_id as string) ?? undefined,
      };
    }

    const { data: athlete } = await supabase
      .from('athletes')
      .select('id, guardian_email, guardian_user_id, account_id')
      .eq('id', memberId)
      .maybeSingle();

    if (athlete?.guardian_email) {
      return {
        kind: 'guardian',
        accountId: (athlete.account_id as string) ?? null,
        userId: (athlete.guardian_user_id as string) ?? undefined,
        email: athlete.guardian_email as string,
      };
    }

    // Last, and only once the cheap lookups have missed: a row that is on the
    // list purely because a team was delegated to them. Finding it costs a read
    // per team, which is why nothing above it pays for the search.
    const { accountId } = await this.ctx();
    const { data: teams } = await supabase.from('teams').select('id').eq('account_id', accountId);
    const managers = await this.fetchTeamManagers(((teams ?? []) as Row[]).map((t) => t.id as string));
    const manager = managers.find((m) => m.id === memberId);
    if (manager) {
      return {
        kind: 'teamManager',
        accountId,
        userId: manager.userId || undefined,
        email: manager.email,
      };
    }

    return null;
  }

  /**
   * Give up the delegated teams a person holds under this account.
   *
   * Goes through the deployed list_team_managers/remove_team_manager RPCs
   * rather than deleting `team_managers` directly, so the club-owner check the
   * backend already enforces is the one that runs.
   */
  private async revokeTeamManagerAccess(identity: OrgMemberIdentity): Promise<void> {
    const { supabase, accountId } = await this.ctx();

    const email = identity.email?.toLowerCase();
    if (!email && !identity.userId) return;

    // Archived teams included on purpose — an archived team can be restored,
    // and the delegation would come back with it.
    const { data: teams, error } = await supabase.from('teams').select('id').eq('account_id', accountId);
    if (error) throw new Error(error.message);

    const teamIds = ((teams ?? []) as Row[]).map((t) => t.id as string);
    if (teamIds.length === 0) return;

    const managers = await this.fetchTeamManagers(teamIds);
    const theirs = managers.filter(
      (m) =>
        (!!email && m.email?.toLowerCase() === email) ||
        (!!identity.userId && m.userId === identity.userId),
    );

    for (const manager of theirs) {
      try {
        await this.removeTeamManager(manager.id);
      } catch (e) {
        // The organization row is already gone by now, so say which half failed
        // instead of letting a raw Postgres message read as "nothing happened".
        console.log('Failed to revoke delegated team access:', e);
        throw new Error(
          identity.kind === 'teamManager'
            ? 'Could not remove their access to the team. You may not have permission to change its managers.'
            : 'Removed from the organization, but their delegated team access could not be revoked. Remove them from the team’s Managers list.',
        );
      }
    }
  }

  /**
   * The pre-RPC removal path, kept for deployments without the function.
   *
   * It differs from the original in the two ways that made removals fail
   * silently. Each delete is followed by a read-back, so a row RLS refused to
   * touch raises instead of reporting a success the next refetch undoes; and
   * assessors are removed by identity across every assessment the account owns,
   * not just the single row id the deduped list happened to surface.
   */
  private async removeOrgMemberDirect(memberId: string, identity: OrgMemberIdentity | null): Promise<void> {
    const { supabase, accountId } = await this.ctx();

    if (!identity) throw new Error('Member not found.');
    if (identity.accountId !== accountId) throw new Error('Member not found in this organization.');

    const blocked = (what: string) => {
      console.log(`removeOrgMember: ${what} survived the delete — RLS most likely refused it.`);
      return new Error(
        'Could not remove this member. You may not have permission to remove them from this organization.',
      );
    };

    // 1. Staff, who hold a membership on the account.
    if (identity.kind === 'membership') {
      // The screen already hides the action for admins; this is the half of
      // that the RPC enforces server-side, so it holds here too.
      if (identity.role === 'owner' || identity.role === 'admin') {
        throw new Error('An organization admin cannot be removed here.');
      }

      const { error } = await supabase.from('memberships').delete().eq('id', memberId);
      if (error) throw new Error(error.message);

      const { data: left } = await supabase
        .from('memberships')
        .select('id')
        .eq('id', memberId)
        .maybeSingle();
      if (left) throw blocked('the membership');
      return;
    }

    // 2. Assessors, who exist only as rows against the account's assessments.
    if (identity.kind === 'assessor') {
      const { data: tryouts } = await supabase.from('tryouts').select('id').eq('account_id', accountId);
      const tryoutIds = ((tryouts ?? []) as Row[]).map((t) => t.id as string);
      if (tryoutIds.length === 0) throw new Error('Member not found in this organization.');

      // Two statements rather than one `or()` filter: the identity is a user id
      // *or* an e-mail, an unlinked invite carries only the latter, and an
      // e-mail interpolated into an or() string would have to be escaped.
      if (identity.userId) {
        const { error } = await supabase
          .from('tryout_assessors')
          .delete()
          .in('tryout_id', tryoutIds)
          .eq('user_id', identity.userId);
        if (error) throw new Error(error.message);
      }
      if (identity.email) {
        const { error } = await supabase
          .from('tryout_assessors')
          .delete()
          .in('tryout_id', tryoutIds)
          .eq('email', identity.email);
        if (error) throw new Error(error.message);
      }

      // Read back the whole identity, not just the row the list surfaced: a
      // policy that let one delete through and refused the rest would otherwise
      // look like a clean removal until the person reappeared.
      let remaining = 0;
      if (identity.userId) {
        const { data: left } = await supabase
          .from('tryout_assessors')
          .select('id')
          .in('tryout_id', tryoutIds)
          .eq('user_id', identity.userId)
          .limit(1);
        remaining += left?.length ?? 0;
      }
      if (identity.email) {
        const { data: left } = await supabase
          .from('tryout_assessors')
          .select('id')
          .in('tryout_id', tryoutIds)
          .eq('email', identity.email)
          .limit(1);
        remaining += left?.length ?? 0;
      }
      if (remaining > 0) throw blocked('an assessor row');
      return;
    }

    // 3. Guardians, who are not members at all — they are the guardian contact
    // on one or more of the account's athletes, so removal clears that contact.
    // Delegated managers never reach here: removeOrgMember() hands them to
    // revokeTeamManagerAccess() and returns.
    if (identity.kind !== 'guardian' || !identity.email) throw new Error('Member not found.');

    // guardian_email is citext, so eq() is already case-insensitive and still
    // uses the btree index on the column.
    const { error } = await supabase
      .from('athletes')
      .update({
        guardian_name: null,
        guardian_email: null,
        guardian_phone: null,
        guardian_user_id: null,
      })
      .eq('account_id', accountId)
      .eq('guardian_email', identity.email);
    if (error) throw new Error(error.message);

    const { data: left } = await supabase
      .from('athletes')
      .select('id')
      .eq('account_id', accountId)
      .eq('guardian_email', identity.email)
      .limit(1);
    if (left && left.length > 0) throw blocked('the guardian contact');
  }

  async linkGuardianToAthlete(guardianId: string, tryoutId: string, playerId: string): Promise<import('../types').Player> {
    const { supabase } = await this.ctx();

    // 1. Resolve actual athlete_id (playerId could be tryout_participant.id or athlete.id)
    let athleteId = playerId;
    const { data: tpCheck } = await supabase
      .from('tryout_participants')
      .select('id, athlete_id')
      .or(`id.eq.${playerId},athlete_id.eq.${playerId}`)
      .limit(1)
      .maybeSingle();

    if (tpCheck?.athlete_id) {
      athleteId = tpCheck.athlete_id;
    }

    const { data, error } = await supabase
      .from('athletes')
      .update({ guardian_user_id: guardianId })
      .eq('id', athleteId)
      .select(`
        id,
        first_name,
        last_name,
        year_of_birth,
        default_position,
        guardian_name,
        guardian_email,
        guardian_phone,
        guardian_user_id
      `)
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    // Fetch the updated player from the tryout view to return the expected Player type
    const { data: updatedPlayer, error: fetchError } = await supabase
      .from('tryout_participants')
      .select(`
        id,
        jersey,
        position,
        athletes(
          id,
          first_name,
          last_name,
          year_of_birth,
          guardian_name,
          guardian_email,
          guardian_user_id
        )
      `)
      .eq('athlete_id', athleteId)
      .eq('tryout_id', tryoutId)
      .limit(1)
      .maybeSingle();

    if (fetchError) throw fetchError;

    const tp: any = updatedPlayer || {};
    const ath: any = Array.isArray(tp.athletes) ? tp.athletes[0] : (tp.athletes || data || {});

    return {
      id: tp.id || athleteId,
      first: ath.first_name || '',
      last: ath.last_name || '',
      pos: tp.position || ath.default_position,
      jersey: tp.jersey,
      guardianName: ath.guardian_name,
      guardianEmail: ath.guardian_email,
      linkedGuardianId: ath.guardian_user_id,
      athleteId: ath.id || athleteId,
    } as import('../types').Player;
  }

  // async getGuardianRosters(): Promise<import('../types').GuardianRosterAthlete[]> {
  //   const { supabase, userId } = await this.ctx();
  //   if (!userId) return [];

  //   const { data, error } = await supabase
  //     .from('athletes')
  //     .select(`
  //       id,
  //       first_name,
  //       last_name,
  //       avatar_url,
  //       tryout_participants(
  //         tryouts(id, name, sport),
  //         evaluations(session, recommendation, created_at, evaluation_scores(rubric_key, value))
  //       ),
  //       season_roster(
  //         seasons(id, name, team_name, sport)
  //       )
  //     `)
  //     .eq('guardian_user_id', userId);

  //   if (error) {
  //     console.error('Failed to fetch guardian rosters:', error);
  //     return [];
  //   }

  //   return (data as any[]).map((row) => ({
  //     id: row.id,
  //     firstName: row.first_name,
  //     lastName: row.last_name,
  //     avatarUrl: row.avatar_url,
  //     tryouts: (row.tryout_participants || [])
  //       .map((tp: any) => {
  //         if (!tp.tryouts) return null;

  //         const evals = tp.evaluations || [];
  //         const sessionMap = new Map<string, { result: string; date: number; scores: Record<string, number> }>();

  //         for (const e of evals) {
  //           if (e.recommendation) {
  //             const sessionName = e.session || 'Session 1';
  //             const t = e.created_at ? new Date(e.created_at).getTime() : 0;
  //             const existing = sessionMap.get(sessionName);
  //             if (!existing || t > existing.date) {
  //               // Map scores from evaluation_scores array to Record
  //               const scoresRecord: Record<string, number> = {};
  //               if (e.evaluation_scores && Array.isArray(e.evaluation_scores)) {
  //                 for (const score of e.evaluation_scores) {
  //                   if (score.rubric_key && typeof score.value === 'number') {
  //                     scoresRecord[score.rubric_key] = score.value;
  //                   }
  //                 }
  //               }

  //               sessionMap.set(sessionName, { 
  //                 result: REC_FROM_DB[e.recommendation] || e.recommendation, 
  //                 date: t,
  //                 scores: scoresRecord
  //               });
  //             }
  //           }
  //         }

  //         const sessions = Array.from(sessionMap.entries()).map(([name, data]) => ({
  //           name,
  //           result: data.result,
  //           date: data.date,
  //           scores: Object.keys(data.scores).length > 0 ? data.scores : undefined
  //         })).sort((a, b) => a.name.localeCompare(b.name));

  //         return {
  //           ...tp.tryouts,
  //           sessions
  //         };
  //       })
  //       .filter(Boolean),
  //     seasons: (row.season_roster || [])
  //       .map((sr: any) => sr.seasons)
  //       .filter(Boolean),
  //   }));
  // }
  private rowToFamilyContact(r: Row): FamilyContact {
    return {
      id: r.id,
      athleteId: r.athlete_id,
      name: r.name,
      relationship: r.relationship ?? undefined,
      email: r.email ?? undefined,
      phone: r.phone ?? undefined,
    };
  }

  async listFamilyContacts(athleteId: string): Promise<FamilyContact[]> {
    const { supabase } = await this.ctx();
    const rows = unwrap(
      await supabase
        .from('athlete_family_contacts')
        .select()
        .eq('athlete_id', athleteId)
        .order('created_at', { ascending: true }),
    ) as Row[] | null;
    return (rows ?? []).map((r) => this.rowToFamilyContact(r));
  }

  async addFamilyContact(
    athleteId: string,
    contact: { name: string; relationship?: string; email?: string; phone?: string },
  ): Promise<FamilyContact> {
    const { supabase, userId } = await this.ctx();
    const row = unwrap(
      await supabase
        .from('athlete_family_contacts')
        .insert({
          athlete_id: athleteId,
          name: contact.name,
          relationship: contact.relationship || null,
          email: contact.email || null,
          phone: contact.phone || null,
          created_by: userId,
        })
        .select()
        .single(),
    ) as Row;
    return this.rowToFamilyContact(row);
  }

  async removeFamilyContact(id: string): Promise<void> {
    const { supabase } = await this.ctx();
    unwrap(await supabase.from('athlete_family_contacts').delete().eq('id', id));
  }

  async getGuardianRosters(): Promise<import('../types').GuardianRosterAthlete[]> {
    const { supabase, userId } = await this.userCtx();
    if (!userId) return [];

    // One statement, authorized per tryout/season instead of per leaf row. The nested
    // PostgREST embed this replaces made RLS run on every evaluation score and every
    // RSVP row, which blew the statement timeout (57014) for coaches and guardians
    // alike. See supabase/migrations/20260817130000_guardian_rosters_rpc.sql.
    const { data: rpcData, error: rpcError } = await supabase.rpc('get_guardian_rosters');

    if (!rpcError) {
      return ((rpcData as any[]) ?? []).map((row) => this.mapGuardianRosterRow(row));
    }

    // Environments that haven't run the migration yet fall back to the old embed.
    // Anything other than "function not found" is a real failure worth surfacing.
    const missingFunction = rpcError.code === 'PGRST202' || rpcError.code === '42883';
    if (!missingFunction) {
      console.error('Failed to fetch guardian rosters:', rpcError);
      return [];
    }
    console.warn('get_guardian_rosters() not deployed — falling back to the nested query.');

    // 1. Fetch the actual logged-in user's email to bypass misaligned UUIDs
    const { data: userData } = await supabase.auth.getUser();
    const userEmail = userData?.user?.email?.toLowerCase();

    // 2. Query matching athletes based on User ID OR matching Guardian Email
    let query = supabase
      .from('athletes')
      .select(`
        id,
        first_name,
        last_name,
        avatar_url,
        tryout_participants(
          id,
          tryout_id,
          tryouts(id, name, sport),
          evaluations(
            id,
            session,
            recommendation,
            created_at,
            evaluation_scores(rubric_key, value)
          )
        ),
        season_roster(
          id,
          jersey,
          fee_status,
          event_availability(
            season_event_id,
            response
          ),
          seasons(
            id,
            name,
            team_name,
            sport,
            team_id,
            teams(collects_fees, registration_fee_cents),
            season_events(
              id,
              kind,
              title,
              event_date,
              start_time,
              end_time,
              location,
              notes
            )
          )
        )
      `);

    // Fall back to matching by email if the UUIDs are unlinked. guardian_email is
    // citext, so eq() is already case-insensitive — using eq (not ilike) lets this
    // hit the plain btree index on guardian_email instead of forcing a sequential
    // scan, which is what was timing out (57014) once the athletes table grew.
    if (userEmail) {
      query = query.or(`guardian_user_id.eq.${userId},guardian_email.eq.${userEmail}`);
    } else {
      query = query.eq('guardian_user_id', userId);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Failed to fetch guardian rosters:', error);
      return [];
    }

    return ((data as any[]) ?? []).map((row) => this.mapGuardianRosterRow(row));
  }

  /** Shared by the get_guardian_rosters() RPC and the nested-embed fallback — both
   * hand back the same row shape. */
  private mapGuardianRosterRow(row: any): import('../types').GuardianRosterAthlete {
    // 3. Map tryouts/assessments using the unique participant ID (tp.id)
    const tryoutsList = (row.tryout_participants || [])
      .map((tp: any) => {
        if (!tp.tryouts) return null;

        const evals = tp.evaluations || [];
        const sessionMap = new Map<string, { result: string; date: number; scores: Record<string, number> }>();

        for (const e of evals) {
          if (e.recommendation) {
            const sessionName = e.session || 'Session 1';
            const t = e.created_at ? new Date(e.created_at).getTime() : 0;
            const existing = sessionMap.get(sessionName);

            if (!existing || t > existing.date) {
              const scoresRecord: Record<string, number> = {};
              if (e.evaluation_scores && Array.isArray(e.evaluation_scores)) {
                for (const score of e.evaluation_scores) {
                  if (score.rubric_key && typeof score.value === 'number') {
                    scoresRecord[score.rubric_key] = score.value;
                  }
                }
              }

              sessionMap.set(sessionName, {
                result: REC_FROM_DB[e.recommendation] || e.recommendation,
                date: t,
                scores: scoresRecord,
              });
            }
          }
        }

        const sessions = Array.from(sessionMap.entries())
          .map(([name, data]) => ({
            name,
            result: data.result,
            date: data.date,
            scores: Object.keys(data.scores).length > 0 ? data.scores : undefined,
          }))
          .sort((a, b) => a.name.localeCompare(b.name));

        return {
          ...tp.tryouts,
          // Globally unique ID prevents multiple dashboard row items from collapsing
          participantId: tp.id,
          sessions,
        };
      })
      .filter(Boolean);

    // 4. Map active seasons and nested schedule events (practices/games)
    const seasonsList = (row.season_roster || [])
      .map((sr: any) => {
        if (!sr.seasons) return null;

        const assignedEventIds = new Set<string>(
          (sr.event_availability || []).map((ea: any) => ea.season_event_id)
        );

        const formattedEvents = (sr.seasons.season_events || [])
          .filter((ev: any) => assignedEventIds.has(ev.id))
          .map((ev: any) => {
            const ea = (sr.event_availability || []).find((a: any) => a.season_event_id === ev.id);
            const availabilityRecord: Record<string, string> = {};
            if (ea) {
              availabilityRecord[row.id] = ea.response;
            }
            return {
              id: ev.id,
              type: EVENT_KIND_FROM_DB[ev.kind] ?? 'Game',
              title: ev.title,
              date: ev.event_date,
              startTime: ev.start_time ?? undefined,
              endTime: ev.end_time ?? undefined,
              location: ev.location ?? undefined,
              notes: ev.notes ?? undefined,
              availability: availabilityRecord,
            };
          });

        const team = Array.isArray(sr.seasons.teams) ? sr.seasons.teams[0] : sr.seasons.teams;

        return {
          id: sr.seasons.id,
          name: sr.seasons.name,
          teamName: sr.seasons.team_name,
          sport: sr.seasons.sport,
          jersey: sr.jersey ?? undefined,
          events: formattedEvents, // Mapped practices/games now exposed to frontend!
          seasonRosterId: sr.id,
          collectsFees: !!team?.collects_fees,
          registrationFeeCents: team?.registration_fee_cents ?? undefined,
          feeStatus: (sr.fee_status ?? 'unpaid') as 'unpaid' | 'paid' | 'waived',
        };
      })
      .filter(Boolean);

    return {
      id: row.id,
      firstName: row.first_name,
      lastName: row.last_name,
      avatarUrl: row.avatar_url,
      tryouts: tryoutsList,
      seasons: seasonsList,
    };
  }

  // ─── Guardian -> Coach athlete profile sharing ──────────────────────────

  private mapAthleteShareRow(row: Row): AthleteShare {
    return {
      id: row.id,
      athleteId: row.athlete_id,
      status: row.status,
      athlete: {
        firstName: row.athlete_first_name,
        lastName: row.athlete_last_name,
        avatarUrl: row.athlete_avatar_url ?? undefined,
        yearOfBirth: row.athlete_year_of_birth ?? undefined,
        position: row.athlete_position ?? undefined,
        guardianName: row.athlete_guardian_name ?? undefined,
        guardianEmail: row.athlete_guardian_email ?? undefined,
        guardianPhone: row.athlete_guardian_phone ?? undefined,
        medicalInfo: row.athlete_medical_info ?? undefined,
        about: row.athlete_about ?? undefined,
      },
      assessments: Array.isArray(row.athlete_assessments) ? (row.athlete_assessments as PlayerProfileAssessment[]) : [],
      coach: {
        userId: row.coach_user_id,
        displayName: row.coach_display_name,
        avatarUrl: row.coach_avatar_url ?? undefined,
        accountId: row.coach_account_id,
        accountName: row.coach_account_name,
        sport: row.coach_sport ?? undefined,
      },
      guardianUserId: row.guardian_user_id,
      assignedTryoutId: row.assigned_tryout_id ?? undefined,
      assignedAthleteId: row.assigned_athlete_id ?? undefined,
      assignedParticipantId: row.assigned_participant_id ?? undefined,
      createdAt: toMs(row.created_at),
      updatedAt: toMs(row.updated_at),
    };
  }

  /**
   * Replaces a share's frozen assessment snapshot with live data via
   * get_athlete_share_live_scores() — every tryout this one athlete has ever
   * participated in, including ones added after the share, but never any
   * other athlete on the guardian's roster (that boundary is enforced in the
   * SQL function itself). Falls back to the frozen snapshot passed in if the
   * RPC errors or the caller isn't authorized for this share.
   */
  private async liveAthleteShareAssessments(
    supabase: SupabaseClient,
    shareId: string,
    fallback: PlayerProfileAssessment[],
  ): Promise<PlayerProfileAssessment[]> {
    const { data, error } = await supabase.rpc('get_athlete_share_live_scores', { p_share_id: shareId });
    if (error || !Array.isArray(data)) return fallback;

    return data
      .map((live: any): PlayerProfileAssessment => {
        const position = live.position ?? undefined;
        const sport = live.sport as Sport;
        const settings = live.settings ?? {};
        const categories = getPlayerCategories(sport, position, settings.customRubrics ?? []);
        const weights = isGoaliePosition(position) ? settings.goalieWeights ?? {} : settings.skaterWeights ?? {};
        const evals = ((live.evaluations ?? []) as any[]).map((row) => this.rowToEval(row));
        const overall = evals.length ? weightedOverallAcrossEvals(evals, categories, weights) : 0;
        const categoryScores = categoryAveragesAcrossEvals(evals, categories);
        const latest = [...evals].sort((x, y) => y.createdAt - x.createdAt)[0];

        return {
          tryoutId: live.tryout_id,
          tryoutName: live.tryout_name,
          seasonId: live.season_id ?? undefined,
          eventType: live.event_type as EventType,
          sport,
          date: live.tryout_date ?? undefined,
          position,
          teamName: live.team_name ?? undefined,
          overall,
          categoryScores,
          evalCount: evals.length,
          latestRecommendation: (latest?.recommendation ?? '') as Recommendation,
          participantId: live.participant_id,
          evaluations: evals.map((ev) => ({ ...ev, overall: weightedOverallAcrossEvals([ev], categories, weights) })),
        };
      })
      .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  }

  async getCoachDirectory(): Promise<CoachDirectoryEntry[]> {
    const { supabase } = await this.userCtx();
    const { data, error } = await supabase.rpc('list_coach_directory');
    if (error) throw new Error(error.message);
    return (data ?? []).map((row: any) => ({
      userId: row.user_id,
      displayName: row.display_name,
      avatarUrl: row.avatar_url ?? undefined,
      accountId: row.account_id,
      accountName: row.account_name,
      sport: row.sport ?? undefined,
    }));
  }

  async shareAthleteWithCoach(athleteId: string, coachUserId: string, coachAccountId: string): Promise<AthleteShare> {
    const { supabase, userId } = await this.userCtx();

    const { data: athleteRow, error: athleteError } = await supabase
      .from('athletes')
      .select(
        'id, first_name, last_name, avatar_url, year_of_birth, default_position, guardian_name, guardian_email, guardian_phone, medical_info, about',
      )
      .eq('id', athleteId)
      .maybeSingle();
    if (athleteError) throw new Error(athleteError.message);
    if (!athleteRow) throw new Error('Athlete not found');

    // Full assessment history, frozen at share time — see the athlete_assessments
    // column comment in the migration for why this is a snapshot, not a live join.
    const { assessments } = await this.fetchAthleteAssessmentContext(supabase, athleteId);

    const { data: directory, error: directoryError } = await supabase.rpc('list_coach_directory');
    if (directoryError) throw new Error(directoryError.message);
    const coachRow = (directory ?? []).find(
      (c: any) => c.user_id === coachUserId && c.account_id === coachAccountId,
    );
    if (!coachRow) throw new Error('Coach not found');

    const { data, error } = await supabase
      .from('athlete_shares')
      .insert({
        athlete_id: athleteId,
        guardian_user_id: userId,
        coach_user_id: coachUserId,
        coach_account_id: coachAccountId,
        athlete_first_name: athleteRow.first_name,
        athlete_last_name: athleteRow.last_name,
        athlete_avatar_url: athleteRow.avatar_url,
        athlete_year_of_birth: athleteRow.year_of_birth,
        athlete_position: athleteRow.default_position,
        athlete_guardian_name: athleteRow.guardian_name,
        athlete_guardian_email: athleteRow.guardian_email,
        athlete_guardian_phone: athleteRow.guardian_phone,
        athlete_medical_info: athleteRow.medical_info,
        athlete_about: athleteRow.about,
        athlete_assessments: assessments,
        coach_display_name: coachRow.display_name,
        coach_avatar_url: coachRow.avatar_url,
        coach_account_name: coachRow.account_name,
        coach_sport: coachRow.sport,
      })
      .select('*')
      .single();

    if (error) {
      if ((error as any).code === '23505') throw new Error('Already shared with this coach.');
      throw new Error(error.message);
    }
    return this.mapAthleteShareRow(data as Row);
  }

  async getMyAthleteShares(athleteId: string): Promise<AthleteShare[]> {
    const { supabase } = await this.userCtx();
    const { data, error } = await supabase
      .from('athlete_shares')
      .select('*')
      .eq('athlete_id', athleteId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((row: any) => this.mapAthleteShareRow(row));
  }

  async getSharedAthletesForCoach(): Promise<AthleteShare[]> {
    const { supabase, accountId } = await this.ctx();
    const { data, error } = await supabase
      .from('athlete_shares')
      .select('*')
      .eq('coach_account_id', accountId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((row: any) => this.mapAthleteShareRow(row));
  }

  async getAthleteShare(shareId: string): Promise<AthleteShare> {
    const { supabase } = await this.userCtx();
    const { data, error } = await supabase
      .from('athlete_shares')
      .select('*')
      .eq('id', shareId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error('Share not found');
    const share = this.mapAthleteShareRow(data as Row);
    share.assessments = await this.liveAthleteShareAssessments(supabase, shareId, share.assessments);
    return share;
  }

  async acceptAthleteShare(shareId: string, tryoutId: string): Promise<AthleteShare> {
    const { supabase } = await this.userCtx();
    const { data, error } = await supabase.rpc('accept_athlete_share', {
      p_share_id: shareId,
      p_tryout_id: tryoutId,
    });
    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    return this.mapAthleteShareRow(row as Row);
  }

  async rejectAthleteShare(shareId: string): Promise<AthleteShare> {
    const { supabase } = await this.userCtx();
    const { data, error } = await supabase.rpc('reject_athlete_share', { p_share_id: shareId });
    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    return this.mapAthleteShareRow(row as Row);
  }

  async listShareComments(shareId: string): Promise<ShareComment[]> {
    const { supabase } = await this.userCtx();
    const { data, error } = await supabase
      .from('athlete_share_comments')
      .select('*')
      .eq('share_id', shareId)
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map((row: any) => ({
      id: row.id,
      shareId: row.share_id,
      authorUserId: row.author_user_id,
      authorName: row.author_name,
      authorRole: row.author_role,
      body: row.body,
      createdAt: toMs(row.created_at),
    }));
  }

  async addShareComment(shareId: string, body: string): Promise<ShareComment> {
    const { supabase, userId } = await this.userCtx();

    const { data: shareRow, error: shareError } = await supabase
      .from('athlete_shares')
      .select('guardian_user_id')
      .eq('id', shareId)
      .maybeSingle();
    if (shareError) throw new Error(shareError.message);
    if (!shareRow) throw new Error('Share not found');

    const { data: profileRow } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('id', userId)
      .maybeSingle();

    const authorRole: 'guardian' | 'coach' = shareRow.guardian_user_id === userId ? 'guardian' : 'coach';

    const { data, error } = await supabase
      .from('athlete_share_comments')
      .insert({
        share_id: shareId,
        author_user_id: userId,
        author_name: profileRow?.display_name || 'Unknown',
        author_role: authorRole,
        body,
      })
      .select('*')
      .single();
    if (error) throw new Error(error.message);

    return {
      id: data.id,
      shareId: data.share_id,
      authorUserId: data.author_user_id,
      authorName: data.author_name,
      authorRole: data.author_role,
      body: data.body,
      createdAt: toMs(data.created_at),
    };
  }
}

export const supabaseDataSource = new SupabaseDataSource();
