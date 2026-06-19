import { KV_KEYS, getJson, setJson, storage } from '@/lib/storage';
import type { DataSource } from '../datasource';
import type {
  AddPlayerForm,
  AdminStats,
  AdminUserRow,
  AiCompareSummary,
  AiPlayerSummary,
  AuthSession,
  CreateAssessmentForm,
  CreateEventForm,
  CreateSeasonForm,
  Database,
  EnterprisePayment,
  Evaluation,
  ExportFormat,
  Org,
  Player,
  Registration,
  RegistrationSubmit,
  ScoreForm,
  Season,
  SeasonEvent,
  Team,
  Tryout,
  UserProfile,
} from '../types';
import {
  createEmptyDatabase,
  createFreshDatabaseForUser,
  createSeedDatabase,
  createTryoutFromForm,
  DEMO_ORG,
} from './seed';
import { generateAthleteId, generateCloudCode, generateId } from '../rubrics';
import {
  buildTeams,
  formatExportCsv,
  mockAiCompare,
  mockAiPlayerSummary,
  type TeamBuilderConfig,
  type TeamBuilderState,
} from '../teamBuilder';

const AUTH_KEY = KV_KEYS.AUTH;
const DB_KEY = KV_KEYS.DB;

function delay(ms = 120): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function loadDb(): Database {
  const db = getJson<Database>(DB_KEY, createEmptyDatabase());
  if (!db.seasons) db.seasons = {};
  if (!db.orgs) db.orgs = {};
  return db;
}

function saveDb(db: Database): void {
  setJson(DB_KEY, db);
}

function loadAuth(): AuthSession | null {
  return getJson<AuthSession | null>(AUTH_KEY, null);
}

function saveAuth(session: AuthSession | null): void {
  if (session) setJson(AUTH_KEY, session);
  else storage.remove(AUTH_KEY);
}

export class MockDataSource implements DataSource {
  async login(email: string, _password: string): Promise<AuthSession> {
    await delay();
    let db = loadDb();
    if (!db.profile || db.profile.email !== email.toLowerCase()) {
      // Demo login with seed data
      if (email.toLowerCase() === 'coach@example.com') {
        db = createSeedDatabase();
        saveDb(db);
      } else {
        throw new Error('Invalid credentials. Try coach@example.com / password123');
      }
    }
    const session: AuthSession = {
      token: `mock_token_${Date.now()}`,
      user: db.profile!,
      expiresAt: Date.now() + 86400000 * 7,
    };
    saveAuth(session);
    return session;
  }

  async signup(displayName: string, email: string, _password: string): Promise<AuthSession> {
    await delay();
    const profile: UserProfile = {
      id: generateId('user'),
      email: email.toLowerCase(),
      displayName,
      planTier: 'coach',
      createdAt: Date.now(),
      onboardingCompleted: false,
      onboardingSteps: {
        createTeam: false,
        createAssessment: false,
        inviteAssessors: false,
        addPlayers: false,
        scorePlayers: false,
      },
    };
    const db = createFreshDatabaseForUser(profile);
    saveDb(db);
    const session: AuthSession = {
      token: `mock_token_${Date.now()}`,
      user: profile,
      expiresAt: Date.now() + 86400000 * 7,
    };
    saveAuth(session);
    return session;
  }

  async logout(): Promise<void> {
    await delay(50);
    saveAuth(null);
  }

  async getSession(): Promise<AuthSession | null> {
    await delay(50);
    const session = loadAuth();
    if (!session) return null;
    if (session.expiresAt < Date.now()) {
      saveAuth(null);
      return null;
    }
    return session;
  }

  async getProfile(): Promise<UserProfile | null> {
    await delay();
    const db = loadDb();
    return db.profile ?? null;
  }

  async updateProfile(updates: Partial<UserProfile>): Promise<UserProfile> {
    await delay();
    const db = loadDb();
    if (!db.profile) throw new Error('Not authenticated');
    db.profile = { ...db.profile, ...updates };
    saveDb(db);
    const auth = loadAuth();
    if (auth) saveAuth({ ...auth, user: db.profile });
    return db.profile;
  }

  async getDatabase(): Promise<Database> {
    await delay();
    return loadDb();
  }

  async saveDatabase(db: Database): Promise<void> {
    await delay();
    saveDb(db);
  }

  async listTeams(): Promise<Team[]> {
    await delay();
    return loadDb().teams.filter((t) => !t.tombstone);
  }

  async createTeam(name: string, season?: string): Promise<Team> {
    await delay();
    const db = loadDb();
    const team: Team = {
      id: generateId('team'),
      name,
      season,
      createdAt: Date.now(),
    };
    db.teams.push(team);
    if (db.profile) {
      db.profile.onboardingSteps.createTeam = true;
    }
    saveDb(db);
    return team;
  }

  async deleteTeam(id: string): Promise<void> {
    await delay();
    const db = loadDb();
    db.teams = db.teams.map((t) =>
      t.id === id ? { ...t, tombstone: true, updatedAt: Date.now() } : t,
    );
    saveDb(db);
  }

  async listTryouts(includeArchived = false): Promise<Tryout[]> {
    await delay();
    const tryouts = Object.values(loadDb().tryouts);
    return includeArchived ? tryouts : tryouts.filter((t) => !t.archived);
  }

  async getTryout(id: string): Promise<Tryout | null> {
    await delay();
    return loadDb().tryouts[id] ?? null;
  }

  async createTryout(form: CreateAssessmentForm): Promise<Tryout> {
    await delay();
    const db = loadDb();
    if (!db.profile) throw new Error('Not authenticated');
    const tryout = createTryoutFromForm(form, db.profile);
    db.tryouts[tryout.id] = tryout;
    db.profile.onboardingSteps.createAssessment = true;
    saveDb(db);
    return tryout;
  }

  async updateTryout(id: string, updates: Partial<Tryout>): Promise<Tryout> {
    await delay();
    const db = loadDb();
    const existing = db.tryouts[id];
    if (!existing) throw new Error('Tryout not found');
    const updated = { ...existing, ...updates, updatedAt: Date.now() };
    db.tryouts[id] = updated;
    saveDb(db);
    return updated;
  }

  async archiveTryout(id: string): Promise<Tryout> {
    return this.updateTryout(id, { archived: true });
  }

  async deleteTryout(id: string): Promise<void> {
    await delay();
    const db = loadDb();
    delete db.tryouts[id];
    saveDb(db);
  }

  async addPlayer(tryoutId: string, form: AddPlayerForm): Promise<Player> {
    await delay();
    const db = loadDb();
    const tryout = db.tryouts[tryoutId];
    if (!tryout) throw new Error('Tryout not found');
    const now = Date.now();
    const player: Player = {
      id: generateId('player'),
      athleteId: generateAthleteId(),
      ...form,
      registrationSource: 'manual',
      createdAt: now,
      updatedAt: now,
    };
    tryout.roster.push(player);
    tryout.updatedAt = now;
    if (db.profile) db.profile.onboardingSteps.addPlayers = true;
    saveDb(db);
    return player;
  }

  async updatePlayer(tryoutId: string, playerId: string, updates: Partial<Player>): Promise<Player> {
    await delay();
    const db = loadDb();
    const tryout = db.tryouts[tryoutId];
    if (!tryout) throw new Error('Tryout not found');
    const idx = tryout.roster.findIndex((p) => p.id === playerId);
    if (idx < 0) throw new Error('Player not found');
    tryout.roster[idx] = { ...tryout.roster[idx], ...updates, updatedAt: Date.now() };
    tryout.updatedAt = Date.now();
    saveDb(db);
    return tryout.roster[idx];
  }

  async deletePlayer(tryoutId: string, playerId: string): Promise<void> {
    await delay();
    const db = loadDb();
    const tryout = db.tryouts[tryoutId];
    if (!tryout) throw new Error('Tryout not found');
    tryout.roster = tryout.roster.filter((p) => p.id !== playerId);
    tryout.evals = tryout.evals.filter((e) => e.playerId !== playerId);
    tryout.updatedAt = Date.now();
    saveDb(db);
  }

  async saveEvaluation(
    tryoutId: string,
    playerId: string,
    form: ScoreForm,
    evalId?: string,
  ): Promise<Evaluation> {
    await delay();
    const db = loadDb();
    const tryout = db.tryouts[tryoutId];
    if (!tryout) throw new Error('Tryout not found');
    const now = Date.now();
    let evaluation: Evaluation;

    if (evalId) {
      const idx = tryout.evals.findIndex((e) => e.id === evalId);
      if (idx < 0) throw new Error('Evaluation not found');
      evaluation = {
        ...tryout.evals[idx],
        ...form,
        updatedAt: now,
      };
      tryout.evals[idx] = evaluation;
    } else {
      evaluation = {
        id: generateId('eval'),
        playerId,
        date: new Date().toISOString().split('T')[0],
        evaluator: db.profile?.displayName ?? 'Coach',
        ...form,
        createdAt: now,
      };
      tryout.evals.push(evaluation);
    }

    tryout.updatedAt = now;
    if (db.profile) db.profile.onboardingSteps.scorePlayers = true;
    saveDb(db);
    return evaluation;
  }

  async deleteEvaluation(tryoutId: string, evalId: string): Promise<void> {
    await delay();
    const db = loadDb();
    const tryout = db.tryouts[tryoutId];
    if (!tryout) throw new Error('Tryout not found');
    tryout.evals = tryout.evals.filter((e) => e.id !== evalId);
    tryout.updatedAt = Date.now();
    saveDb(db);
  }

  async ensureCloudSession(tryoutId: string): Promise<Tryout> {
    await delay();
    const db = loadDb();
    const tryout = db.tryouts[tryoutId];
    if (!tryout) throw new Error('Tryout not found');
    if (!tryout.cloud?.id) {
      tryout.cloud = { id: generateCloudCode(), enabled: true };
      tryout.updatedAt = Date.now();
      db.tryouts[tryoutId] = tryout;
      saveDb(db);
    }
    return tryout;
  }

  async listRegistrations(tryoutId: string): Promise<Registration[]> {
    await delay();
    const tryout = loadDb().tryouts[tryoutId];
    if (!tryout) throw new Error('Tryout not found');
    return tryout.registrations ?? [];
  }

  async submitRegistration(tryoutId: string, form: RegistrationSubmit): Promise<Registration> {
    await delay();
    const db = loadDb();
    const tryout = db.tryouts[tryoutId];
    if (!tryout) throw new Error('Tryout not found');
    if (!tryout.registrations) tryout.registrations = [];
    const reg: Registration = {
      id: generateId('reg'),
      eventId: tryout.cloud?.id ?? tryoutId,
      ...form,
      status: 'pending',
      createdAt: Date.now(),
    };
    tryout.registrations.push(reg);
    tryout.updatedAt = Date.now();
    saveDb(db);
    return reg;
  }

  async addRegistrationToRoster(tryoutId: string, registrationId: string): Promise<Player> {
    await delay();
    const db = loadDb();
    const tryout = db.tryouts[tryoutId];
    if (!tryout) throw new Error('Tryout not found');
    const reg = tryout.registrations?.find((r) => r.id === registrationId);
    if (!reg) throw new Error('Registration not found');
    const now = Date.now();
    const player: Player = {
      id: generateId('player'),
      athleteId: generateAthleteId(),
      first: reg.firstName,
      last: reg.lastName,
      yearOfBirth: reg.yearOfBirth,
      positionTryingOutFor: reg.positionTryingOutFor,
      guardianName: reg.guardianName,
      guardianEmail: reg.guardianEmail,
      guardianPhone: reg.guardianPhone,
      currentTeam: reg.currentTeam,
      currentLevel: reg.currentLevel,
      aboutChild: reg.aboutPlayer,
      medicalInfo: reg.medicalInfo,
      friend1Name: reg.friend1Name,
      friend2Name: reg.friend2Name,
      registrationSource: 'qr',
      createdAt: now,
    };
    tryout.roster.push(player);
    reg.status = 'added';
    tryout.updatedAt = now;
    if (db.profile) db.profile.onboardingSteps.addPlayers = true;
    saveDb(db);
    return player;
  }

  async dismissRegistration(tryoutId: string, registrationId: string): Promise<void> {
    await delay();
    const db = loadDb();
    const tryout = db.tryouts[tryoutId];
    if (!tryout) throw new Error('Tryout not found');
    const reg = tryout.registrations?.find((r) => r.id === registrationId);
    if (reg) reg.status = 'dismissed';
    tryout.updatedAt = Date.now();
    saveDb(db);
  }

  // ---- Phase 2 ----
  async generateTeamBuilder(tryoutId: string, config: TeamBuilderConfig): Promise<TeamBuilderState> {
    await delay();
    const db = loadDb();
    const tryout = db.tryouts[tryoutId];
    if (!tryout) throw new Error('Tryout not found');
    const teamBuilder = buildTeams(tryout, config);
    tryout.teamBuilder = teamBuilder;
    tryout.updatedAt = Date.now();
    saveDb(db);
    return teamBuilder;
  }

  async getAiPlayerSummary(tryoutId: string, playerId: string): Promise<AiPlayerSummary> {
    await delay(400);
    const tryout = loadDb().tryouts[tryoutId];
    if (!tryout) throw new Error('Tryout not found');
    const summary = mockAiPlayerSummary(tryout, playerId);
    tryout.aiAssessments = { ...tryout.aiAssessments, [playerId]: summary };
    const db = loadDb();
    db.tryouts[tryoutId] = tryout;
    saveDb(db);
    return summary;
  }

  async getAiCompare(tryoutId: string, playerIds: string[]): Promise<AiCompareSummary> {
    await delay(500);
    const tryout = loadDb().tryouts[tryoutId];
    if (!tryout) throw new Error('Tryout not found');
    return mockAiCompare(tryout, playerIds);
  }

  async exportTryout(tryoutId: string, format: ExportFormat): Promise<{ content: string; filename: string }> {
    await delay();
    const tryout = loadDb().tryouts[tryoutId];
    if (!tryout) throw new Error('Tryout not found');
    const safeName = tryout.name.replace(/\s+/g, '_').toLowerCase();
    if (format === 'csv') {
      return { content: formatExportCsv(tryout), filename: `${safeName}_results.csv` };
    }
    if (format === 'pdf') {
      return {
        content: `PDF Export: ${tryout.name}\nPlayers: ${tryout.roster.length}\nEvaluations: ${tryout.evals.length}\n\n[Mock PDF — connect print service in production]`,
        filename: `${safeName}_report.pdf`,
      };
    }
    return {
      content: formatExportCsv(tryout),
      filename: `${safeName}_results.xlsx`,
    };
  }

  async createShareLink(tryoutId: string, label?: string): Promise<{ token: string; expiresAt: number }> {
    await delay();
    return {
      token: generateId('share').slice(0, 12),
      expiresAt: Date.now() + 7 * 86400000,
    };
  }

  // ---- Phase 3: Seasons ----
  async listSeasons(): Promise<Season[]> {
    await delay();
    return Object.values(loadDb().seasons).filter((s) => !s.archived);
  }

  async getSeason(id: string): Promise<Season | null> {
    await delay();
    return loadDb().seasons[id] ?? null;
  }

  async createSeason(form: CreateSeasonForm): Promise<Season> {
    await delay();
    const db = loadDb();
    const now = Date.now();
    const season: Season = {
      id: generateId('season'),
      name: form.name,
      teamName: form.teamName,
      sport: form.sport,
      year: form.year,
      division: form.division,
      coach: form.coach,
      teamId: form.teamId,
      events: [],
      roster: [],
      scheduleShareToken: generateId('sched').slice(0, 16),
      createdAt: now,
      updatedAt: now,
    };
    db.seasons[season.id] = season;
    saveDb(db);
    return season;
  }

  async updateSeason(id: string, updates: Partial<Season>): Promise<Season> {
    await delay();
    const db = loadDb();
    const existing = db.seasons[id];
    if (!existing) throw new Error('Season not found');
    const updated = { ...existing, ...updates, updatedAt: Date.now() };
    db.seasons[id] = updated;
    saveDb(db);
    return updated;
  }

  async deleteSeason(id: string): Promise<void> {
    await delay();
    const db = loadDb();
    delete db.seasons[id];
    saveDb(db);
  }

  async addSeasonEvent(seasonId: string, form: CreateEventForm): Promise<SeasonEvent> {
    await delay();
    const db = loadDb();
    const season = db.seasons[seasonId];
    if (!season) throw new Error('Season not found');
    const event: SeasonEvent = {
      id: generateId('event'),
      ...form,
      availability: {},
      createdAt: Date.now(),
    };
    season.events.push(event);
    season.updatedAt = Date.now();
    saveDb(db);
    return event;
  }

  async updateSeasonEvent(seasonId: string, eventId: string, updates: Partial<SeasonEvent>): Promise<SeasonEvent> {
    await delay();
    const db = loadDb();
    const season = db.seasons[seasonId];
    if (!season) throw new Error('Season not found');
    const idx = season.events.findIndex((e) => e.id === eventId);
    if (idx < 0) throw new Error('Event not found');
    season.events[idx] = { ...season.events[idx], ...updates, updatedAt: Date.now() };
    season.updatedAt = Date.now();
    saveDb(db);
    return season.events[idx];
  }

  async deleteSeasonEvent(seasonId: string, eventId: string): Promise<void> {
    await delay();
    const db = loadDb();
    const season = db.seasons[seasonId];
    if (!season) throw new Error('Season not found');
    season.events = season.events.filter((e) => e.id !== eventId);
    season.updatedAt = Date.now();
    saveDb(db);
  }

  async sendPortalInvite(seasonId: string, playerId: string, email: string): Promise<void> {
    await delay(300);
    const db = loadDb();
    const season = db.seasons[seasonId];
    if (!season) throw new Error('Season not found');
    const player = season.roster.find((p) => p.id === playerId);
    if (!player) throw new Error('Player not found');
    player.portalInviteEmails = [...(player.portalInviteEmails ?? []), email];
    player.portalInviteSentAt = Date.now();
    season.updatedAt = Date.now();
    saveDb(db);
  }

  async setEventAvailability(
    seasonId: string,
    eventId: string,
    playerId: string,
    response: 'yes' | 'maybe' | 'no',
  ): Promise<void> {
    await delay();
    const db = loadDb();
    const season = db.seasons[seasonId];
    if (!season) throw new Error('Season not found');
    const event = season.events.find((e) => e.id === eventId);
    if (!event) throw new Error('Event not found');
    event.availability = { ...event.availability, [playerId]: response };
    season.updatedAt = Date.now();
    saveDb(db);
  }

  // ---- Phase 4 ----
  async getOrg(): Promise<Org | null> {
    await delay();
    const orgs = Object.values(loadDb().orgs);
    return orgs[0] ?? DEMO_ORG;
  }

  async getEnterprisePayments(): Promise<EnterprisePayment[]> {
    await delay();
    return [
      { id: 'pay_1', playerName: 'Alex Johnson', assessmentName: 'Spring U14 Tryout', amount: 150, status: 'paid', receivedAt: Date.now() - 86400000 * 3 },
      { id: 'pay_2', playerName: 'Jordan Smith', assessmentName: 'Spring U14 Tryout', amount: 150, status: 'pending', receivedAt: Date.now() - 86400000 },
      { id: 'pay_3', playerName: 'Casey Williams', assessmentName: 'Spring U14 Tryout', amount: 150, status: 'paid', receivedAt: Date.now() - 86400000 * 5 },
    ];
  }

  async getAdminStats(): Promise<AdminStats> {
    await delay();
    const db = loadDb();
    return {
      totalUsers: 248,
      activeUsers: 89,
      totalAssessments: Object.keys(db.tryouts).length + 42,
      totalRegistrations: 156,
      planDistribution: { free: 120, coach: 68, club: 35, pro: 18, association: 7 },
      revenueMtd: 4280,
    };
  }

  async listAdminUsers(): Promise<AdminUserRow[]> {
    await delay();
    const db = loadDb();
    const profile = db.profile;
    return [
      {
        id: profile?.id ?? 'user_demo',
        email: profile?.email ?? 'coach@example.com',
        displayName: profile?.displayName ?? 'Coach Shawn',
        planTier: profile?.planTier ?? 'club',
        teamCount: db.teams.length,
        assessmentCount: Object.keys(db.tryouts).length,
        lastActiveAt: Date.now(),
      },
      { id: 'user_2', email: 'admin@club.com', displayName: 'Club Admin', planTier: 'pro', teamCount: 5, assessmentCount: 12, lastActiveAt: Date.now() - 86400000 },
      { id: 'user_3', email: 'free@coach.com', displayName: 'Free Coach', planTier: 'free', teamCount: 1, assessmentCount: 1, lastActiveAt: Date.now() - 86400000 * 7 },
    ];
  }

  async overrideUserPlan(userId: string, planTier: UserProfile['planTier']): Promise<void> {
    await delay();
    const db = loadDb();
    if (db.profile?.id === userId) {
      db.profile.planTier = planTier;
      saveDb(db);
    }
  }

  async copyTryout(id: string): Promise<Tryout> {
    await delay();
    const db = loadDb();
    const src = db.tryouts[id];
    if (!src) throw new Error('Tryout not found');
    const now = Date.now();
    const copy: Tryout = {
      ...JSON.parse(JSON.stringify(src)),
      id: generateId('tryout'),
      name: `${src.name} (Copy)`,
      createdAt: now,
      updatedAt: now,
      archived: false,
      cloud: undefined,
      teamBuilder: undefined,
      evals: [],
      registrations: [],
    };
    db.tryouts[copy.id] = copy;
    saveDb(db);
    return copy;
  }

  async restoreTryout(id: string): Promise<Tryout> {
    return this.updateTryout(id, { archived: false });
  }

  async importLibraryPlayers(
    tryoutId: string,
    entries: { first: string; last: string; jersey?: string; pos?: string }[],
  ): Promise<Player[]> {
    await delay();
    const players: Player[] = [];
    for (const e of entries) {
      const p = await this.addPlayer(tryoutId, {
        first: e.first,
        last: e.last,
        jersey: e.jersey,
        pos: e.pos,
      });
      players.push(p);
    }
    return players;
  }

  async submitFeedback(submission: import('../extras').FeedbackSubmission): Promise<void> {
    await delay(200);
    setJson('aas_feedback', { ...submission, submittedAt: Date.now() });
  }

  async addSeasonPlayer(seasonId: string, player: Omit<import('../types').SeasonPlayer, 'id'>): Promise<import('../types').SeasonPlayer> {
    await delay();
    const db = loadDb();
    const season = db.seasons[seasonId];
    if (!season) throw new Error('Season not found');
    const sp = { ...player, id: generateId('sp') };
    season.roster.push(sp);
    season.updatedAt = Date.now();
    saveDb(db);
    return sp;
  }

  async updateTeam(id: string, updates: Partial<Team>): Promise<Team> {
    await delay();
    const db = loadDb();
    const idx = db.teams.findIndex((t) => t.id === id);
    if (idx < 0) throw new Error('Team not found');
    db.teams[idx] = { ...db.teams[idx], ...updates, updatedAt: Date.now() };
    saveDb(db);
    return db.teams[idx];
  }

  async importScanScores(
    tryoutId: string,
    scores: { playerId: string; rubricKey: string; value: number }[],
  ): Promise<void> {
    await delay();
    const db = loadDb();
    const tryout = db.tryouts[tryoutId];
    if (!tryout) throw new Error('Tryout not found');
    const byPlayer: Record<string, Record<string, number>> = {};
    for (const s of scores) {
      if (!byPlayer[s.playerId]) byPlayer[s.playerId] = {};
      byPlayer[s.playerId][s.rubricKey] = s.value;
    }
    for (const [playerId, scoreMap] of Object.entries(byPlayer)) {
      await this.saveEvaluation(tryoutId, playerId, {
        session: 'Scan Import',
        recommendation: '',
        scores: scoreMap,
      });
    }
  }
}

export const mockDataSource = new MockDataSource();
