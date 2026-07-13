/// <reference types="node" />
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase';
import { APP_CONFIG } from '@/config/app';
import type { DataSource } from '../datasource';
import type {
  AddPlayerForm,
  AdminStats,
  AdminUserRow,
  AiCompareSummary,
  AiPlayerSummary,
  Assessor,
  AuthSession,
  CreateAssessmentForm,
  CreateEventForm,
  CreateSeasonForm,
  Database,
  EnterprisePayment,
  Evaluation,
  EventType,
  EventKind,
  ExportFormat,
  Org,
  Player,
  Recommendation,
  Registration,
  RegistrationSubmit,
  ScoreForm,
  Season,
  SeasonEvent,
  SeasonPlayer,
  Athlete,
  AthleteHistory,
  Team,
  Tryout,
  UserProfile,
} from '../types';
import type { TeamBuilderConfig, TeamBuilderState } from '../teamBuilder';
import { buildTeams, formatExportCsv, mockAiCompare, mockAiPlayerSummary } from '../teamBuilder';
import type { FeedbackSubmission } from '../extras';
import { generateCloudCode, generateId, getDefaultWeights } from '../rubrics';

// ─── small helpers ──────────────────────────────────────────────────────────
type Row = Record<string, any>;

function unwrap<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

function toMs(iso: string | null | undefined): number {
  return iso ? new Date(iso).getTime() : 0;
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
  private accountId: string | null = null;

  private notImplemented(method: string): never {
    throw new Error(`SupabaseDataSource.${method}() not implemented yet.`);
  }

  private async ctx(): Promise<{ supabase: SupabaseClient; userId: string; accountId: string }> {
    const supabase = getSupabase();
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) throw new Error('Not authenticated');
    if (!this.accountId) {
      // Fetch all memberships to determine the best account to use
      const m = await supabase
        .from('memberships')
        .select('account_id, role')
        .eq('user_id', u.user.id)
        .order('created_at', { ascending: true });
      const memberships = m.data ?? [];
      
      // Prefer a non-owner membership (e.g. guardian in a coach's org) over the user's own account
      const nonOwner = memberships.find((r: any) => r.role !== 'owner');
      const accId: string | null = nonOwner?.account_id ?? memberships[0]?.account_id ?? null;
      if (!accId) throw new Error('No account for user');
      this.accountId = accId;
    }
    return { supabase, userId: u.user.id, accountId: this.accountId };
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
    return { name: a.name, email: a.email ?? '', role: a.role ?? 'assessor', status: a.status ?? 'accepted' };
  }

  private rowToRegistration(r: Row): Registration {
    return {
      id: r.id,
      eventId: r.tryout_id,
      firstName: r.first_name,
      lastName: r.last_name,
      yearOfBirth: r.year_of_birth != null ? String(r.year_of_birth) : undefined,
      positionTryingOutFor: r.position_trying_out_for ?? undefined,
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
    };
  }

  /** Assemble full Tryout objects for a set of tryout rows (batched relational fetch). */
  private async assembleTryouts(tryoutRows: Row[]): Promise<Tryout[]> {
    if (tryoutRows.length === 0) return [];
    const supabase = getSupabase();
    const ids = tryoutRows.map((t) => t.id);

    const [participants, assessors, evals, registrations] = await Promise.all([
      supabase.from('tryout_participants').select('*, athletes(*)').in('tryout_id', ids),
      supabase.from('tryout_assessors').select('*').in('tryout_id', ids),
      supabase.from('evaluations').select('*, evaluation_scores(rubric_key, value)').in('tryout_id', ids),
      supabase.from('registrations').select('*').in('tryout_id', ids),
    ]);

    const pRows = unwrap(participants) as Row[];
    const aRows = unwrap(assessors) as Row[];
    const eRows = unwrap(evals) as Row[];
    const rRows = unwrap(registrations) as Row[];

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
    const supabase = getSupabase();
    const profile = unwrap(
      await supabase.from('profiles').select('*').eq('id', userId).single(),
    ) as Row;
    const membership = (
      await supabase
        .from('memberships')
        .select('role, accounts(*)')
        .eq('user_id', userId)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()
    ).data as Row | null;
    const account = Array.isArray(membership?.accounts)
      ? membership.accounts[0]
      : (membership?.accounts as Row | undefined);
    return {
      id: profile.id,
      email: profile.email,
      displayName: profile.display_name,
      organization: account?.type === 'organization' ? account.name : undefined,
      avatarUrl: profile.avatar_url ?? undefined,
      planTier: (account?.plan_tier as UserProfile['planTier']) ?? 'free',
      subscriptionStatus: account?.subscription_status,
      createdAt: toMs(profile.created_at),
      onboardingCompleted: profile.onboarding_completed,
      onboardingSteps: profile.onboarding_steps,
    };
  }

  private toAuthSession(session: Session, user: UserProfile): AuthSession {
    return { token: session.access_token, user, expiresAt: (session.expires_at ?? 0) * 1000 };
  }

  async login(email: string, password: string): Promise<AuthSession> {
    const supabase = getSupabase();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.session) throw new Error(error?.message ?? 'Login failed');
    this.accountId = null;
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
    if (error) throw new Error(error.message);
    let session = data.session;
    if (!session) {
      const { data: signIn, error: e2 } = await supabase.auth.signInWithPassword({ email, password });
      if (e2 || !signIn.session) {
        throw new Error('Account created. Please confirm your email, then log in.');
      }
      session = signIn.session;
    }
    this.accountId = null;
    const user = await this.loadUserProfile(session.user.id);
    return this.toAuthSession(session, user);
  }

  async logout(): Promise<void> {
    this.accountId = null;
    await getSupabase().auth.signOut();
  }

  async getSession(): Promise<AuthSession | null> {
    const supabase = getSupabase();
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session) return null;
    try {
      const user = await this.loadUserProfile(data.session.user.id);
      return this.toAuthSession(data.session, user);
    } catch (e) {
      console.warn('Failed to restore session profile, signing out:', e);
      await supabase.auth.signOut();
      return null;
    }
  }

  async getProfile(): Promise<UserProfile | null> {
    const supabase = getSupabase();
    const { data } = await supabase.auth.getUser();
    if (!data.user) return null;
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
    return this.loadUserProfile(userId);
  }

  async updatePassword(password: string): Promise<void> {
    const { supabase } = await this.ctx();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw new Error(error.message);
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
    if (error) throw new Error(error.message);
  }

  async verifyPasswordResetOtp(email: string, token: string): Promise<void> {
    const supabase = getSupabase();
    const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'recovery' });
    if (error) throw new Error(error.message);
    if (data.session) {
      this.accountId = null;
    }
  }

  async resetPasswordWithOtp(email: string, token: string, newPassword: string): Promise<void> {
    const supabase = getSupabase();
    const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'recovery' });
    if (error) throw new Error(error.message);
    if (!data.session) throw new Error('Failed to start session after OTP verification');
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    if (updateError) throw new Error(updateError.message);
    this.accountId = null;
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
  private rowToTeam(t: Row): Team {
    return {
      id: t.id,
      name: t.name,
      season: t.season_label ?? undefined,
      createdAt: toMs(t.created_at),
      updatedAt: t.updated_at ? toMs(t.updated_at) : undefined,
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
    return rows.map((t) => this.rowToTeam(t));
  }

  async createTeam(name: string, season?: string): Promise<Team> {
    const { supabase, accountId } = await this.ctx();
    const row = unwrap(
      await supabase
        .from('teams')
        .insert({ account_id: accountId, name, season_label: season ?? null })
        .select()
        .single(),
    ) as Row;
    await this.markOnboarding({ createTeam: true });
    return this.rowToTeam(row);
  }

  async deleteTeam(id: string): Promise<void> {
    const { supabase } = await this.ctx();
    unwrap(await supabase.from('teams').update({ archived: true }).eq('id', id).select().maybeSingle());
  }

  async updateTeam(id: string, updates: Partial<Team>): Promise<Team> {
    const { supabase } = await this.ctx();
    const patch: Row = {};
    if (updates.name !== undefined) patch.name = updates.name;
    if (updates.season !== undefined) patch.season_label = updates.season;
    const row = unwrap(await supabase.from('teams').update(patch).eq('id', id).select().single()) as Row;
    return this.rowToTeam(row);
  }

  // ─── Tryouts ──────────────────────────────────────────────────────────────────
  async listTryouts(includeArchived = false): Promise<Tryout[]> {
    const { supabase, accountId } = await this.ctx();
    let q = supabase
      .from('tryouts')
      .select('*')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false });
    if (!includeArchived) q = q.eq('archived', false);
    const rows = unwrap(await q) as Row[];
    return this.assembleTryouts(rows);
  }

  async getTryout(id: string): Promise<Tryout | null> {
    const { supabase } = await this.ctx();
    const row = (await supabase.from('tryouts').select('*').eq('id', id).maybeSingle()).data as Row | null;
    if (!row) return null;
    const [assembled] = await this.assembleTryouts([row]);
    return assembled ?? null;
  }

  async listAssignedTryouts(): Promise<Tryout[]> {
    const { supabase, userId, accountId } = await this.ctx();
    const links = unwrap(
      await supabase.from('tryout_assessors').select('tryout_id').eq('user_id', userId),
    ) as Row[];
    const ids = [...new Set(links.map((l) => l.tryout_id))];
    if (!ids.length) return [];
    const rows = unwrap(
      await supabase.from('tryouts').select('*').in('id', ids).eq('archived', false),
    ) as Row[];
    // Exclude tryouts the user already owns (those show in listTryouts).
    const assigned = rows.filter((t) => t.account_id !== accountId);
    return this.assembleTryouts(assigned);
  }

  async rejectAssignedTryout(tryoutId: string): Promise<void> {
    const { supabase, userId } = await this.ctx();
    const { error } = await supabase
      .from('tryout_assessors')
      .delete()
      .eq('tryout_id', tryoutId)
      .eq('user_id', userId);
    if (error) throw new Error(error.message);
  }

  async createTryout(form: CreateAssessmentForm): Promise<Tryout> {
    const { supabase, userId, accountId } = await this.ctx();
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
          tryout_date: form.tryoutDate ?? null,
          start_time: form.startTime ?? null,
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
      joined_at: new Date().toISOString(),
    });

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
    if (updates.rink !== undefined) patch.location = updates.rink || null;
    if (updates.defaultPosition !== undefined) patch.default_position = updates.defaultPosition || null;
    if (updates.headAssessor !== undefined) patch.head_assessor = updates.headAssessor || null;
    if (updates.headCoach !== undefined) patch.head_coach = updates.headCoach || null;
    if (updates.teamId !== undefined) patch.team_id = updates.teamId || null;
    if (updates.seasonId !== undefined) patch.season_id = updates.seasonId || null;
    if (updates.settings !== undefined) patch.settings = updates.settings;
    if (updates.archived !== undefined) patch.archived = updates.archived;

    if (updates.teamBuilder !== undefined || updates.aiAssessments !== undefined) {
      const current = (await supabase.from('tryouts').select('ai_assessments').eq('id', id).single())
        .data?.ai_assessments ?? {};
      const next = { ...current };
      if (updates.aiAssessments !== undefined) Object.assign(next, updates.aiAssessments);
      if (updates.teamBuilder !== undefined) next.teamBuilder = updates.teamBuilder;
      patch.ai_assessments = next;
    }

    if (Object.keys(patch).length) {
      unwrap(await supabase.from('tryouts').update(patch).eq('id', id).select().single());
    }
    if (updates.assessors !== undefined) {
      await this.syncAssessors(id, updates.assessors);
    }
    const result = await this.getTryout(id);
    if (!result) throw new Error('Tryout not found');
    return result;
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
    unwrap(await supabase.from('tryouts').delete().eq('id', id).select().maybeSingle());
  }

  async sendEmail(type: 'org_invite' | 'tryout_invite' | 'schedule_update' | 'reminder' | 'registration_confirmation', to: string, payload: any): Promise<void> {
    const { supabase } = await this.ctx();
    const { error } = await supabase.functions.invoke('send-email', {
      body: { type, to, payload },
    });
    if (error) {
      let msg = error.message;
      try {
        const body = await error.context.json();
        if (body?.error) msg = body.error;
      } catch {}
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
      joined_at: new Date().toISOString(),
    });

    // Copy roster (participants reuse the canonical athletes).
    const participants = unwrap(
      await supabase.from('tryout_participants').select('*').eq('tryout_id', id),
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
        })),
      );
    }
    const [assembled] = await this.assembleTryouts([copy]);
    return assembled;
  }

  // ─── Players ──────────────────────────────────────────────────────────────────
  private async createAthlete(accountId: string, fields: Row): Promise<string> {
    const supabase = getSupabase();

    if (fields.guardian_email && !fields.guardian_user_id) {
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
             fields.guardian_user_id = newUserId;
             try {
               await this.sendEmail('org_invite', fields.guardian_email, { role: 'guardian', password: defaultPassword });
             } catch (emailErr) {
               console.warn('Failed to send auto-created guardian invite email:', emailErr);
             }
          }
        }
      } catch (err) {
        console.warn('Failed to auto-create guardian account:', err);
      }
    }

    const row = unwrap(
      await supabase.from('athletes').insert({ account_id: accountId, ...fields }).select('id').single(),
    ) as Row;
    return row.id;
  }

  async addPlayer(tryoutId: string, form: AddPlayerForm): Promise<Player> {
    const { supabase, accountId } = await this.ctx();
    let athleteId = form.athleteId;
    if (!athleteId) {
      athleteId = await this.createAthlete(accountId, {
        first_name: form.first,
        last_name: form.last,
        year_of_birth: form.yearOfBirth ? Number(form.yearOfBirth) : null,
        guardian_name: form.guardianName || null,
        guardian_email: form.guardianEmail || null,
        guardian_phone: form.guardianPhone || null,
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
      await supabase.from('athletes').update(athletePatch).eq('id', part.athlete_id);
    }
    if (Object.keys(participantPatch).length) {
      await supabase.from('tryout_participants').update(participantPatch).eq('id', playerId);
    }
    return this.fetchPlayer(playerId);
  }

  async deletePlayer(_tryoutId: string, playerId: string): Promise<void> {
    const { supabase } = await this.ctx();
    unwrap(
      await supabase.from('tryout_participants').delete().eq('id', playerId).select().maybeSingle(),
    );
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
  ): Promise<Evaluation> {
    const { supabase, userId } = await this.ctx();
    const recDb = form.recommendation ? REC_TO_DB[form.recommendation] : null;

    let id = evalId;
    if (!id) {
      const { data: existingRows } = await supabase
        .from('evaluations')
        .select('id')
        .eq('tryout_id', tryoutId)
        .eq('participant_id', playerId)
        .eq('evaluator_user_id', userId)
        .eq('session', form.session);
        
      if (existingRows && existingRows.length > 0) {
        id = existingRows[0].id;
        // Clean up duplicates if the DB was corrupted
        if (existingRows.length > 1) {
          const duplicateIds = existingRows.slice(1).map((r) => r.id);
          await supabase.from('evaluation_scores').delete().in('evaluation_id', duplicateIds);
          await supabase.from('evaluations').delete().in('id', duplicateIds);
        }
      }
    }

    if (id) {
      unwrap(
        await supabase
          .from('evaluations')
          .update({
            session: form.session,
            strengths: form.strengths ?? null,
            improve: form.improve ?? null,
            recommendation: recDb,
          })
          .eq('id', id)
          .select()
          .single(),
      );
      await supabase.from('evaluation_scores').delete().eq('evaluation_id', id);
    } else {
      const profile = await this.loadUserProfile(userId);
      const created = unwrap(
        await supabase
          .from('evaluations')
          .insert({
            tryout_id: tryoutId,
            participant_id: playerId,
            evaluator_user_id: userId,
            evaluator_name: profile.displayName,
            session: form.session,
            strengths: form.strengths ?? null,
            improve: form.improve ?? null,
            recommendation: recDb,
            source: 'manual',
          })
          .select('id')
          .single(),
      ) as Row;
      id = created.id;
    }

    const scoreRows = Object.entries(form.scores)
      .filter(([, v]) => v != null && !Number.isNaN(v))
      .map(([rubric_key, value]) => ({ evaluation_id: id, rubric_key, value }));
    if (scoreRows.length) {
      unwrap(await supabase.from('evaluation_scores').insert(scoreRows).select());
    }

    await this.markOnboarding({ scorePlayers: true });
    return this.fetchEval(id!);
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

  // ─── Registration ───────────────────────────────────────────────────────────
  async ensureCloudSession(tryoutId: string): Promise<Tryout> {
    const { supabase } = await this.ctx();
    const row = unwrap(
      await supabase.from('tryouts').select('registration_code').eq('id', tryoutId).single(),
    ) as Row;
    if (!row.registration_code) {
      await supabase
        .from('tryouts')
        .update({ registration_code: generateCloudCode(), registration_open: true })
        .eq('id', tryoutId);
    }
    const result = await this.getTryout(tryoutId);
    if (!result) throw new Error('Tryout not found');
    return result;
  }

  async listRegistrations(tryoutId: string): Promise<Registration[]> {
    const { supabase } = await this.ctx();
    const rows = unwrap(
      await supabase
        .from('registrations')
        .select('*')
        .eq('tryout_id', tryoutId)
        .order('created_at', { ascending: false }),
    ) as Row[];
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
      medical_info: reg.medical_info || null,
      about: reg.about_player || null,
    });
    const participant = unwrap(
      await supabase
        .from('tryout_participants')
        .insert({
          tryout_id: tryoutId,
          athlete_id: athleteId,
          position_trying_out_for: reg.position_trying_out_for || null,
          current_team: reg.current_team || null,
          current_level: reg.current_level || null,
          registration_source: 'qr',
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

  async dismissRegistration(_tryoutId: string, registrationId: string): Promise<void> {
    const { supabase } = await this.ctx();
    await supabase.from('registrations').update({ status: 'dismissed' }).eq('id', registrationId);
  }

  // ─── Phase 2: Team Builder, AI, Export ──────────────────────────────────────────
  async generateTeamBuilder(tryoutId: string, config: TeamBuilderConfig): Promise<TeamBuilderState> {
    const tryout = await this.getTryout(tryoutId);
    if (!tryout) throw new Error('Tryout not found');
    const result = buildTeams(tryout, config);
    await this.updateTryout(tryoutId, { teamBuilder: result });
    return result;
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
    const { supabase } = await this.ctx();
    const { data, error } = await supabase.functions.invoke('generate-ai-insights', {
      body: { action: 'compare', tryout, playerIds }
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
  private rowToSeasonEvent(ev: Row, availability: Record<string, string>): SeasonEvent {
    return {
      id: ev.id,
      type: EVENT_KIND_FROM_DB[ev.kind] ?? 'Game',
      title: ev.title,
      date: ev.event_date,
      startTime: ev.start_time ?? undefined,
      endTime: ev.end_time ?? undefined,
      location: ev.location ?? undefined,
      notes: ev.notes ?? undefined,
      availability: availability as SeasonEvent['availability'],
      createdAt: toMs(ev.created_at),
      updatedAt: ev.updated_at ? toMs(ev.updated_at) : undefined,
    };
  }

  private rowToSeasonPlayer(r: Row, invites: Row[]): SeasonPlayer {
    const a = r.athletes ?? {};
    const myInvites = invites.filter((i) => i.athlete_id === a.id);
    return {
      id: r.id,
      firstName: a.first_name ?? '',
      lastName: a.last_name ?? '',
      jersey: r.jersey ?? undefined,
      guardianEmail: a.guardian_email ?? undefined,
      guardianPhone: a.guardian_phone ?? undefined,
      playerEmail: r.player_email ?? undefined,
      portalInviteEmails: myInvites.length ? myInvites.map((i) => i.email) : undefined,
      portalInviteSentAt: myInvites.length
        ? Math.max(...myInvites.map((i) => toMs(i.sent_at)))
        : undefined,
    };
  }

  private async assembleSeasons(seasonRows: Row[], withDetail: boolean): Promise<Season[]> {
    if (seasonRows.length === 0) return [];
    const supabase = getSupabase();
    const ids = seasonRows.map((s) => s.id);

    const [eventsRes, rosterRes] = await Promise.all([
      supabase.from('season_events').select('*').in('season_id', ids).order('event_date'),
      supabase.from('season_roster').select('*, athletes(*)').in('season_id', ids),
    ]);
    const eventRows = unwrap(eventsRes) as Row[];
    const rosterRows = unwrap(rosterRes) as Row[];

    let availabilityRows: Row[] = [];
    let inviteRows: Row[] = [];
    if (withDetail) {
      const eventIds = eventRows.map((e) => e.id);
      const [availRes, invRes] = await Promise.all([
        eventIds.length
          ? supabase.from('event_availability').select('*').in('season_event_id', eventIds)
          : Promise.resolve({ data: [], error: null }),
        supabase.from('portal_invites').select('*').in('season_id', ids),
      ]);
      availabilityRows = (availRes.data ?? []) as Row[];
      inviteRows = (invRes.data ?? []) as Row[];
    }

    const eventsBySeason: Record<string, Row[]> = {};
    for (const e of eventRows) (eventsBySeason[e.season_id] ??= []).push(e);
    const rosterBySeason: Record<string, Row[]> = {};
    for (const r of rosterRows) (rosterBySeason[r.season_id] ??= []).push(r);
    const availByEvent: Record<string, Record<string, string>> = {};
    for (const a of availabilityRows) (availByEvent[a.season_event_id] ??= {})[a.roster_id] = a.response;

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
        this.rowToSeasonEvent(ev, availByEvent[ev.id] ?? {}),
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
    return this.assembleSeasons(rows, false);
  }

  async getSeason(id: string): Promise<Season | null> {
    await this.ctx();
    const supabase = getSupabase();
    const row = (await supabase.from('seasons').select('*').eq('id', id).maybeSingle()).data as Row | null;
    if (!row) return null;
    const [assembled] = await this.assembleSeasons([row], true);
    return assembled ?? null;
  }

  async createSeason(form: CreateSeasonForm): Promise<Season> {
    const { supabase, accountId } = await this.ctx();
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
    const [assembled] = await this.assembleSeasons([row], true);
    return assembled;
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

  async addSeasonEvent(seasonId: string, form: CreateEventForm): Promise<SeasonEvent> {
    const { supabase } = await this.ctx();
    const row = unwrap(
      await supabase
        .from('season_events')
        .insert({
          season_id: seasonId,
          kind: EVENT_KIND_TO_DB[form.type] ?? 'game',
          title: form.title,
          event_date: form.date,
          start_time: form.startTime ?? null,
          end_time: form.endTime ?? null,
          location: form.location ?? null,
          notes: form.notes ?? null,
        })
        .select()
        .single(),
    ) as Row;

    try {
      const season = await this.getSeason(seasonId);
      if (season) {
        // Find all guardians related to this season and send them emails.
        const emails = Array.from(new Set(
          season.roster
            .map(p => p.guardianEmail)
            .filter(Boolean)
        ));
        
        for (const email of emails) {
          if (email) {
            await this.sendEmail('schedule_update', email, {
              eventName: form.title,
              date: form.date,
              time: form.startTime,
              location: form.location,
            });
          }
        }
      }
    } catch (e) {
      console.error('Failed to send schedule emails', e);
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
    if (updates.startTime !== undefined) patch.start_time = updates.startTime || null;
    if (updates.endTime !== undefined) patch.end_time = updates.endTime || null;
    if (updates.location !== undefined) patch.location = updates.location || null;
    if (updates.notes !== undefined) patch.notes = updates.notes || null;
    const row = unwrap(
      await supabase.from('season_events').update(patch).eq('id', eventId).select().single(),
    ) as Row;

    try {
      const { data } = await supabase.from('season_roster').select('player_email').eq('season_id', seasonId);
      const emails = data?.map((r) => r.player_email).filter(Boolean) || [];
      if (emails.length > 0) {
        supabase.functions.invoke('send-push-notification', {
          body: { target_user_ids: emails, heading: `Schedule Update: ${row.title}`, content: `Event updated to ${row.event_date}.` }
        }).catch(console.error);

        for (const email of emails) {
          supabase.functions.invoke('send-email', {
            body: { type: 'schedule_update', to: email, payload: { eventName: row.title, date: row.event_date, time: row.start_time, location: row.location } }
          }).catch(console.error);
        }
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
      } catch {}
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

  async listAthletes(): Promise<Athlete[]> {
    const { supabase, accountId } = await this.ctx();
    const { data: athletes } = await supabase
      .from('athletes')
      .select('*, tryout_participants(current_team, current_level, jersey, created_at)')
      .eq('account_id', accountId)
      .order('first_name', { ascending: true });
      
    if (!athletes) return [];
    
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
      .select('id')
      .eq('athlete_id', athleteId);
    
    let pastEvaluations: Evaluation[] = [];
    if (tryoutRosterRows && tryoutRosterRows.length > 0) {
      const rosterIds = tryoutRosterRows.map(r => r.id);
      const { data: evals } = await supabase
        .from('evaluations')
        .select('*, evaluation_scores(rubric_key, value)')
        .in('participant_id', rosterIds);
      if (evals) {
        pastEvaluations = evals.map(e => this.rowToEval(e));
      }
    }

    return {
      athleteId,
      pastSeasons,
      pastEvaluations,
    };
  }

  async setEventAvailability(
    _seasonId: string,
    eventId: string,
    playerId: string,
    response: 'yes' | 'maybe' | 'no',
  ): Promise<void> {
    const { supabase } = await this.ctx();
    await supabase
      .from('event_availability')
      .upsert(
        { season_event_id: eventId, roster_id: playerId, response },
        { onConflict: 'season_event_id,roster_id' },
      );
  }

  // ─── Phase 4: Enterprise & Admin ─────────────────────────────────────────────────
  async getOrg(): Promise<Org | null> {
    const { supabase, accountId } = await this.ctx();
    const account = unwrap(
      await supabase.from('accounts').select('*').eq('id', accountId).single(),
    ) as Row;
    if (account.type !== 'organization') return null;

    const [members, tryouts, athletes] = await Promise.all([
      supabase.from('memberships').select('id', { count: 'exact', head: true }).eq('account_id', accountId),
      supabase.from('tryouts').select('id', { count: 'exact', head: true }).eq('account_id', accountId),
      supabase.from('athletes').select('id', { count: 'exact', head: true }).eq('account_id', accountId),
    ]);
    return {
      id: account.id,
      orgSlug: account.slug ?? account.id,
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
    const rows = (
      await supabase.from('payments').select('*').eq('account_id', accountId).order('created_at', { ascending: false })
    ).data as Row[] | null;
    return (rows ?? []).map((p) => ({
      id: p.id,
      playerName: '',
      assessmentName: '',
      amount: (p.amount_cents ?? 0) / 100,
      status: p.status,
      receivedAt: p.received_at ? toMs(p.received_at) : toMs(p.created_at),
    }));
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
      planDistribution: { free: 0, coach: 0, club: 0, pro: 0, association: 0 },
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

  async createCheckoutSession(planTier: string): Promise<{ url: string }> {
    const { supabase } = await this.ctx();
    const { data, error } = await supabase.functions.invoke('create-checkout-session', {
      body: { planTier }
    });
    if (error) throw new Error(error.message);
    if (data.error) throw new Error(data.error);
    return data;
  }

  async createPortalSession(): Promise<{ url: string }> {
    const { supabase } = await this.ctx();
    const { data, error } = await supabase.functions.invoke('create-portal-session');
    if (error) throw new Error(error.message);
    if (data.error) throw new Error(data.error);
    return data;
  }

  // ─── Misc ──────────────────────────────────────────────────────────────────────
  async submitFeedback(submission: FeedbackSubmission): Promise<void> {
    // No feedback table yet; log + accept so the UI flow completes.
    console.log('[feedback]', JSON.stringify(submission));
  }

  // ─── Org Members ─────────────────────────────────────────────────────────────
  async listOrgMembers(): Promise<import('../types').OrgMember[]> {
    const { supabase, accountId } = await this.ctx();
    
    // Fetch memberships
    const { data: memData } = await supabase
      .from('memberships')
      .select('id, user_id, role, created_at, profiles(email, display_name)')
      .eq('account_id', accountId);

    // Fetch tryouts for the account to get assessors
    const { data: tryouts } = await supabase
      .from('tryouts')
      .select('id')
      .eq('account_id', accountId);
    
    let assData: any[] = [];
    if (tryouts && tryouts.length > 0) {
      const tryoutIds = tryouts.map(t => t.id);
      const { data } = await supabase
        .from('tryout_assessors')
        .select('id, user_id, role, joined_at, email, name')
        .in('tryout_id', tryoutIds);
      assData = data || [];
    }
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
      });
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
      throw new Error(fnError.message || 'Failed to create user account');
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
      } catch {}
      throw new Error(msg);
    }
  }

  async updateOrgMemberRole(memberId: string, role: import('../types').OrgRole): Promise<import('../types').OrgMember> {
    const { supabase } = await this.ctx();
    
    const { data, error } = await supabase
      .from('memberships')
      .update({ role })
      .eq('id', memberId)
      .select()
      .maybeSingle();

    if (!error && !data) {
      await supabase.from('tryout_assessors').update({ role }).eq('id', memberId);
    } else if (error) {
      throw new Error(error.message);
    }
    return {} as any;
  }

  async removeOrgMember(memberId: string): Promise<void> {
    const { supabase } = await this.ctx();
    const { error } = await supabase.from('memberships').delete().eq('id', memberId);
    if (error) throw new Error(error.message);
  }

  async linkGuardianToAthlete(guardianId: string, tryoutId: string, playerId: string): Promise<import('../types').Player> {
    const { supabase } = await this.ctx();

    const { data, error } = await supabase
      .from('athletes')
      .update({ guardian_user_id: guardianId })
      .eq('id', playerId)
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
      .single();

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
      .eq('athlete_id', playerId)
      .eq('tryout_id', tryoutId)
      .single();

    if (fetchError) throw fetchError;

    const ath = Array.isArray(updatedPlayer.athletes) ? updatedPlayer.athletes[0] : updatedPlayer.athletes;

    return {
      id: ath.id,
      first: ath.first_name,
      last: ath.last_name,
      pos: updatedPlayer.position,
      jersey: updatedPlayer.jersey,
      guardianName: ath.guardian_name,
      guardianEmail: ath.guardian_email,
      linkedGuardianId: ath.guardian_user_id,
      athleteId: ath.id,
    } as import('../types').Player;
  }

  async getGuardianRosters(): Promise<import('../types').GuardianRosterAthlete[]> {
    const { supabase, userId } = await this.ctx();
    if (!userId) return [];

    const { data, error } = await supabase
      .from('athletes')
      .select(`
        id,
        first_name,
        last_name,
        avatar_url,
        tryout_participants(
          tryouts(id, name, sport),
          evaluations(session, recommendation, created_at, evaluation_scores(rubric_key, value))
        ),
        season_roster(
          seasons(id, name, team_name, sport)
        )
      `)
      .eq('guardian_user_id', userId);

    if (error) {
      console.error('Failed to fetch guardian rosters:', error);
      return [];
    }

    return (data as any[]).map((row) => ({
      id: row.id,
      firstName: row.first_name,
      lastName: row.last_name,
      avatarUrl: row.avatar_url,
      tryouts: (row.tryout_participants || [])
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
                // Map scores from evaluation_scores array to Record
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
                  scores: scoresRecord
                });
              }
            }
          }
          
          const sessions = Array.from(sessionMap.entries()).map(([name, data]) => ({
            name,
            result: data.result,
            date: data.date,
            scores: Object.keys(data.scores).length > 0 ? data.scores : undefined
          })).sort((a, b) => a.name.localeCompare(b.name));

          return {
            ...tp.tryouts,
            sessions
          };
        })
        .filter(Boolean),
      seasons: (row.season_roster || [])
        .map((sr: any) => sr.seasons)
        .filter(Boolean),
    }));
  }
}

export const supabaseDataSource = new SupabaseDataSource();
