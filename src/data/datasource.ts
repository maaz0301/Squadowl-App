import type {
  AddPlayerForm,
  Assessor,
  AdminStats,
  AdminUserRow,
  AiCompareSummary,
  AiPlayerSummary,
  AssessmentAthlete,
  AuthSession,
  CreateAssessmentForm,
  ConnectAccountStatus,
  CreateEventForm,
  CreateSeasonForm,
  Database,
  EnterprisePayment,
  Evaluation,
  ExportFormat,
  GuardianRosterAthlete,
  Org,
  OrgMember,
  ReferralSummary,
  OrgRole,
  Player,
  PlayerImportResult,
  Registration,
  RegistrationSubmit,
  ScoreForm,
  Season,
  SeasonEvent,
  EventRsvpContext,
  EventRsvpToken,
  Athlete,
  AthleteHistory,
  AthleteShare,
  CoachDirectoryEntry,
  PlayerProfile,
  ShareComment,
  Team,
  TeamBuilderResult,
  TeamMessage,
  Tryout,
  TryoutSummary,
  UserProfile,
} from './types';
import type { TeamBuilderConfig, TeamBuilderState } from './teamBuilder';

export interface DataSource {
  // Auth
  login(email: string, password: string): Promise<AuthSession>;
  signup(displayName: string, email: string, password: string, accountType: string): Promise<AuthSession>;
  logout(): Promise<void>;
  deleteAccount(): Promise<void>;
  getSession(forceRefresh?: boolean): Promise<AuthSession | null>;
  getProfile(forceRefresh?: boolean): Promise<UserProfile | null>;
  updateProfile(updates: Partial<UserProfile>): Promise<UserProfile>;
  updatePassword(password: string): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  verifyPasswordResetOtp(email: string, token: string): Promise<void>;
  resetPasswordWithOtp(email: string, token: string, newPassword: string): Promise<void>;
  resendVerificationEmail(email: string): Promise<void>;
  checkUserExistsByEmail(email: string): Promise<boolean>;
  uploadCoachPhoto(userId: string, fileUri: string, fileType: string): Promise<string>;

  // Database
  getDatabase(): Promise<Database>;
  saveDatabase(db: Database): Promise<void>;

  // Teams
  listTeams(): Promise<Team[]>;
  createTeam(name: string, season?: string): Promise<Team>;
  updateTeam(id: string, updates: Partial<Team>): Promise<Team>;
  uploadTeamLogo(teamId: string, fileUri: string, fileType: string): Promise<string>;
  deleteTeam(id: string): Promise<void>;

  // Team managers (CLUB mode): hand one team to another coach/manager by email.
  // The club's own staff keep full access to a delegated team.
  listTeamManagers(teamId: string): Promise<import('./types').TeamManager[]>;
  /**
   * Delegates `teamId` to the account behind `email`. When no account exists for
   * that address yet, one is created first (mirroring createAndInviteUser) so a
   * club can hand a team to a coach who has never opened the app.
   */
  inviteTeamManager(
    teamId: string,
    email: string,
    role: import('./types').TeamManagerRole,
    name?: string,
  ): Promise<import('./types').TeamManager>;
  removeTeamManager(managerId: string): Promise<void>;

  // Tryouts
  listTryouts(includeArchived?: boolean): Promise<Tryout[]>;
  /**
   * The list screens' read — see TryoutSummary. Same tryouts as listTryouts(),
   * without the rosters, evaluations and registrations no card ever shows.
   */
  listTryoutSummaries(includeArchived?: boolean): Promise<TryoutSummary[]>;
  /**
   * Every athlete on any assessment roster, one row per (athlete, assessment) —
   * the candidate pool for a team's "Add Players from Assessments" picker. See
   * listTryoutSummaries(): same reasoning, one level further down.
   */
  listAssessmentAthletes(): Promise<AssessmentAthlete[]>;
  /** Tryouts the current user is invited to as an assessor (not owned by their account). */
  listAssignedTryouts(): Promise<Tryout[]>;
  /** listAssignedTryouts() in the light shape — see listTryoutSummaries(). */
  listAssignedTryoutSummaries(): Promise<TryoutSummary[]>;
  acceptAssignedTryout(tryoutId: string): Promise<void>;
  rejectAssignedTryout(tryoutId: string): Promise<void>;
  /** Marks the caller's own assessor row 'completed' — off their hub, scores untouched. */
  completeAssignedTryout(tryoutId: string): Promise<void>;
  getTryout(id: string): Promise<Tryout | null>;
  createTryout(form: CreateAssessmentForm): Promise<Tryout>;
  updateTryout(id: string, updates: Partial<Tryout>): Promise<Tryout>;
  archiveTryout(id: string): Promise<Tryout>;
  deleteTryout(id: string): Promise<void>;

  // Players
  addPlayer(tryoutId: string, form: AddPlayerForm): Promise<Player>;
  updatePlayer(tryoutId: string, playerId: string, updates: Partial<Player>): Promise<Player>;
  deletePlayer(tryoutId: string, playerId: string): Promise<void>;
  uploadPlayerPhoto(athleteId: string, fileUri: string, fileType: string): Promise<string>;

  // Evaluations
  saveEvaluation(
    tryoutId: string,
    playerId: string,
    form: ScoreForm,
    evalId?: string,
    activeAssessor?: Assessor | null,
  ): Promise<Evaluation>;
  deleteEvaluation(tryoutId: string, evalId: string): Promise<void>;

  // Registration (QR mock)
  ensureCloudSession(tryoutId: string): Promise<Tryout>;
  listRegistrations(tryoutId: string): Promise<Registration[]>;
  submitRegistration(tryoutId: string, form: RegistrationSubmit): Promise<Registration>;
  addRegistrationToRoster(tryoutId: string, registrationId: string): Promise<Player>;
  /**
   * Place a registration straight onto a team's own roster, with no assessment
   * involved. Mirrors addRegistrationToRoster for the "Team" destination.
   */
  addRegistrationToTeam(
    teamId: string,
    registrationId: string,
  ): Promise<import('./types').TeamRosterPlayer[]>;
  /**
   * Bulk twins of the two single-registration placements above, for the
   * "Add N to Roster" selection. Placed in chunks so a selection of any size is
   * a handful of requests rather than ~8 per player; `onProgress` reports the
   * running placed count. Both return how many registrations were actually
   * placed — ids that no longer exist are skipped, not an error.
   */
  addRegistrationsToRoster(
    tryoutId: string,
    registrationIds: string[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<number>;
  addRegistrationsToTeam(
    teamId: string,
    registrationIds: string[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<number>;
  dismissRegistration(tryoutId: string, registrationId: string): Promise<void>;

  // Phase 2: Team Builder, AI, Export
  generateTeamBuilder(tryoutId: string, config: TeamBuilderConfig): Promise<TeamBuilderState>;
  /** Permanently-saved Team Builder snapshots for a tryout, newest first. */
  listTeamBuilderResults(tryoutId: string): Promise<TeamBuilderResult[]>;
  saveTeamBuilderResult(tryoutId: string, label: string, state: TeamBuilderState): Promise<TeamBuilderResult>;
  deleteTeamBuilderResult(id: string): Promise<void>;
  getAiPlayerSummary(tryoutId: string, playerId: string): Promise<AiPlayerSummary>;
  getAiCompare(tryoutId: string, playerIds: string[]): Promise<AiCompareSummary>;
  exportTryout(tryoutId: string, format: ExportFormat): Promise<{ content: string; filename: string }>;
  createShareLink(tryoutId: string, label?: string): Promise<{ token: string; expiresAt: number }>;

  // Phase 3: Seasons
  listSeasons(): Promise<Season[]>;
  /** The light season read for screens that only need to find one — see SeasonSummary. */
  listSeasonSummaries(): Promise<import('./types').SeasonSummary[]>;
  /**
   * `onPartial` is called with the season as each stage of the read lands —
   * the events first, then the roster, then the RSVPs — so the schedule can
   * draw without waiting for a club-sized roster and every RSVP on every event.
   * `rosterPending` / `availabilityPending` say which stage a partial is.
   */
  getSeason(id: string, onPartial?: (season: Season) => void): Promise<Season | null>;
  createSeason(form: CreateSeasonForm): Promise<Season>;
  updateSeason(id: string, updates: Partial<Season>): Promise<Season>;
  deleteSeason(id: string): Promise<void>;
  /**
   * `onProgress` reports the per-player invite writes — everyone on the roster
   * gets an availability row, so on a big team this is the slow part of saving
   * an event and the UI shows a progress bar against it.
   */
  addSeasonEvent(
    seasonId: string,
    form: CreateEventForm,
    onProgress?: (done: number, total: number) => void,
  ): Promise<SeasonEvent>;
  updateSeasonEvent(seasonId: string, eventId: string, updates: Partial<SeasonEvent>): Promise<SeasonEvent>;
  deleteSeasonEvent(seasonId: string, eventId: string): Promise<void>;
  sendPortalInvite(seasonId: string, playerId: string, email: string): Promise<void>;
  sendTeamAnnouncement(seasonId: string, title: string, message: string): Promise<void>;
  setEventAvailability(seasonId: string, eventId: string, playerId: string, response: 'yes' | 'maybe' | 'no'): Promise<void>;
  /**
   * RSVP straight from the schedule email. `issueEventRsvpTokens` mints one
   * unguessable link per invited player for the coach's client to embed;
   * `getEventRsvpContext`/`submitEventRsvp` back the RSVP landing page, and both
   * work unauthenticated — the recipient usually has no account. The answer
   * lands in the same `event_availability` row the in-app portal buttons write,
   * so there is one source of truth for attendance.
   */
  issueEventRsvpTokens(eventId: string): Promise<EventRsvpToken[]>;
  getEventRsvpContext(token: string): Promise<EventRsvpContext | null>;
  submitEventRsvp(token: string, response: 'yes' | 'maybe' | 'no'): Promise<EventRsvpContext>;
  listTeamMessages(seasonId: string): Promise<TeamMessage[]>;
  /** Messages posted to this season since `sinceMs`, excluding the caller's own. */
  countUnreadTeamMessages(seasonId: string, sinceMs: number): Promise<number>;
  sendTeamMessage(seasonId: string, body: string): Promise<TeamMessage>;
  deleteTeamMessage(messageId: string): Promise<void>;
  getAthleteHistory(athleteId: string): Promise<AthleteHistory>;
  /**
   * Highest session number each player in an assessment has already been
   * scored under, keyed by player id. For assessors, whose read of the
   * assessment's evaluations comes back empty — it carries the numbering they
   * need to continue at the right session without exposing anyone's scores.
   */
  getSessionProgress(tryoutId: string): Promise<Record<string, number>>;
  getPlayerProfile(athleteId: string): Promise<PlayerProfile>;
  listAthletes(): Promise<Athlete[]>;

  // Phase 4: Enterprise & Admin
  getOrg(): Promise<Org | null>;
  getEnterprisePayments(): Promise<EnterprisePayment[]>;
  getAdminStats(): Promise<AdminStats>;
  listAdminUsers(): Promise<AdminUserRow[]>;
  overrideUserPlan(userId: string, planTier: UserProfile['planTier']): Promise<void>;
  createCheckoutSession(
    planTier: string,
    interval: 'year' | 'month',
    options?: { applyCredits?: boolean },
  ): Promise<{ url: string }>;
  /** Checkout for add-on team licenses beyond the plan's included teams (Club: CAD$10/team/year). */
  createTeamLicenseCheckoutSession(
    quantity: number,
    options?: { applyCredits?: boolean },
  ): Promise<{ url: string }>;

  // Loyalty program
  /** Code, balance and ledger for the loyalty screen. Mints the code on first read. */
  getReferralSummary(): Promise<ReferralSummary>;
  /** Attach this account to a referrer. One-time, and only before the first paid plan. */
  applyReferralCode(code: string): Promise<void>;
  createPortalSession(): Promise<{ url: string }>;
  /** Stripe Connect Standard onboarding for coaches collecting registration fees. */
  createConnectAccountLink(): Promise<{ url: string }>;
  /** Live details on the coach's connected Stripe account, straight from Stripe (not cached DB flags). */
  getConnectAccountStatus(): Promise<ConnectAccountStatus>;
  /** Checkout for a guardian paying a tryout's registration fee (0.5% platform cut via Connect). */
  createRegistrationPayment(
    registrationId: string,
    successUrl?: string,
    cancelUrl?: string,
  ): Promise<{ url: string }>;
  /** Checkout for a guardian paying their athlete's team/season fee (0.5% platform cut via Connect). */
  createTeamFeePayment(
    seasonRosterId: string,
    successUrl?: string,
    cancelUrl?: string,
  ): Promise<{ url: string }>;

  // Org Members & Permissions
  /**
   * `includeTeamManagers` (legacy boolean) or options. `includeGuardians`
   * defaults true — pass false for the light staff/assessor path used by
   * permissions and the dashboard members tab's first paint.
   */
  listOrgMembers(
    includeTeamManagersOrOpts?:
      | boolean
      | { includeTeamManagers?: boolean; includeGuardians?: boolean },
  ): Promise<OrgMember[]>;
  inviteOrgMember(email: string, role: OrgRole): Promise<OrgMember>;
  updateOrgMemberRole(memberId: string, role: OrgRole): Promise<OrgMember>;
  removeOrgMember(memberId: string): Promise<void>;
  linkGuardianToAthlete(guardianId: string, tryoutId: string, playerId: string): Promise<Player>;

  // Guardian -> Coach athlete profile sharing
  getCoachDirectory(): Promise<CoachDirectoryEntry[]>;
  shareAthleteWithCoach(athleteId: string, coachUserId: string, coachAccountId: string): Promise<AthleteShare>;
  getMyAthleteShares(athleteId: string): Promise<AthleteShare[]>;
  getSharedAthletesForCoach(): Promise<AthleteShare[]>;
  getAthleteShare(shareId: string): Promise<AthleteShare>;
  acceptAthleteShare(shareId: string, tryoutId: string): Promise<AthleteShare>;
  rejectAthleteShare(shareId: string): Promise<AthleteShare>;
  listShareComments(shareId: string): Promise<ShareComment[]>;
  addShareComment(shareId: string, body: string): Promise<ShareComment>;

  // Extended UI operations
  sendEmail(type: 'org_invite' | 'player_invite' | 'team_manager_invite' | 'tryout_invite' | 'schedule_update' | 'reminder' | 'registration_confirmation' | 'tryout_letter', to: string, payload: any): Promise<void>;
  copyTryout(id: string): Promise<Tryout>;
  restoreTryout(id: string): Promise<Tryout>;
  importLibraryPlayers(tryoutId: string, entries: { first: string; last: string; jersey?: string; pos?: string }[]): Promise<Player[]>;
  submitFeedback(submission: import('./extras').FeedbackSubmission): Promise<void>;
  /**
   * Uploads one screenshot into the private feedback bucket and returns the
   * stored file, to be handed back in `submitFeedback`'s `attachments`.
   *
   * Takes the picker's own fields rather than a File: there is no File in React
   * Native, and the local `file://` URI is what react-native-image-picker gives
   * back.
   *
   * Uploading before the submission exists means an abandoned form can leave a
   * file behind; that is the trade for letting the coach see their screenshot
   * attached, and removed again, before they commit to sending anything.
   */
  uploadFeedbackAttachment(file: {
    uri: string;
    name: string;
    type: string;
    size: number;
  }): Promise<import('./extras').FeedbackAttachment>;
  /** Removes an attachment the user uploaded but then took off the form. */
  deleteFeedbackAttachment(path: string): Promise<void>;
  /** Whether the signed-in user may read everyone's feedback — see the `feedback_reviewers` allowlist. */
  isFeedbackReviewer(): Promise<boolean>;
  /** Every submission, newest first. RLS narrows this to the caller's own unless they are a reviewer. */
  listFeedbackSubmissions(): Promise<import('./extras').FeedbackReport[]>;
  /** A short-lived signed URL for one attachment in the private bucket. */
  getFeedbackAttachmentUrl(path: string): Promise<string>;
  addSeasonPlayer(seasonId: string, player: Omit<import('./types').SeasonPlayer, 'id'>): Promise<import('./types').SeasonPlayer>;
  /**
   * Bulk twin of addSeasonPlayer for players that already have an athlete row
   * (e.g. syncing a team roster into a season). One upsert instead of one
   * request per player — a 25-player team was ~25 sequential round trips.
   * Athletes already on the season are left as they are, not an error.
   */
  addSeasonPlayers(
    seasonId: string,
    players: { athleteId: string; jersey?: string; playerEmail?: string }[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<import('./types').SeasonPlayer[]>;
  deleteSeasonPlayer(seasonId: string, playerId: string): Promise<void>;
  /**
   * `onProgress` reports the enrollment writes. On a team whose linked
   * assessments carry a large roster this is the slow half of saving that
   * team's first event, so the UI shows a progress bar against it.
   */
  importSeasonPlayersFromTeam(
    seasonId: string,
    onProgress?: (done: number, total: number) => void,
  ): Promise<import('./types').SeasonPlayer[]>;
  /**
   * Just the roster — no events, no availability rows, no portal invites.
   * getSeason() assembles all of that, which is fine for the season screen but
   * a poor fit for a callsite that only needs athlete ids: on a season with a
   * big roster and several events already scheduled, getSeason() means
   * fetching every guardian's RSVP on every past event just to answer "who's
   * already on this roster".
   */
  listSeasonRoster(seasonId: string): Promise<import('./types').SeasonPlayer[]>;
  /**
   * One page of a season's roster for the list screen — see
   * listSeasonRosterPage. `after` is the previous page's last id; `nextCursor`
   * is undefined once there is nothing left.
   */
  listSeasonRosterPage(
    seasonId: string,
    opts?: { after?: string; limit?: number },
  ): Promise<{ players: import('./types').SeasonPlayer[]; nextCursor?: string }>;
  emailScheduleToPlayers(seasonId: string): Promise<void>;
  updateTeam(id: string, updates: Partial<Team>): Promise<Team>;

  // Team roster: a team's own players, selectable from any assessment's roster.
  listTeamRoster(teamId: string): Promise<import('./types').TeamRosterPlayer[]>;
  /**
   * One page of a team's roster for the Players tab — see listTeamRosterPage.
   * `after` is the previous page's cursor; `nextCursor` is undefined once there
   * is nothing left. `search` is matched server-side, over the whole roster.
   */
  listTeamRosterPage(
    teamId: string,
    opts?: {
      after?: import('./types').TeamRosterCursor;
      limit?: number;
      search?: string;
    },
  ): Promise<{
    players: import('./types').TeamRosterPlayer[];
    nextCursor?: import('./types').TeamRosterCursor;
  }>;
  /** One player's team-roster row — see getTeamRosterPlayer(). */
  getTeamRosterPlayer(
    teamId: string,
    athleteId: string,
  ): Promise<import('./types').TeamRosterPlayer | null>;
  /** Just the athlete ids on a team's roster — see listTeamRosterAthleteIds(). */
  listTeamRosterAthleteIds(teamId: string): Promise<string[]>;
  addTeamRosterPlayers(
    teamId: string,
    entries: { athleteId: string; jersey?: string; pos?: string; sourceTryoutId?: string }[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<import('./types').TeamRosterPlayer[]>;
  // Same form as the assessment roster's "Add Player" (AddPlayerForm) — picks
  // from or creates an athlete and places them directly on a team's roster,
  // for a player who never went through an assessment (no tryout to pull
  // them from), rather than only being reachable via "Add Players from
  // Assessments".
  /** Bulk-create players on an assessment roster from parsed spreadsheet rows. */
  importTryoutPlayers(
    tryoutId: string,
    rows: { line: number; form: AddPlayerForm }[],
    onProgress?: (done: number) => void,
  ): Promise<PlayerImportResult>;
  /** The team-roster counterpart of importTryoutPlayers. */
  importTeamRosterPlayers(
    teamId: string,
    rows: { line: number; form: AddPlayerForm }[],
    onProgress?: (done: number) => void,
  ): Promise<PlayerImportResult>;
  addManualTeamPlayer(teamId: string, form: AddPlayerForm): Promise<{ athleteId: string }>;
  removeTeamRosterPlayer(teamId: string, athleteId: string): Promise<void>;
  /**
   * Invite a team's roster to the player/guardian portal — each player's own
   * email and their guardian's, both when present.
   *
   * `athleteIds` narrows it to specific players; omitted, the whole roster is
   * invited. Never throws for a single bad address: see TeamInviteResult.
   */
  sendTeamRosterInvites(teamId: string, athleteIds?: string[]): Promise<import('./types').TeamInviteResult>;
  /**
   * Invite season-roster players to the portal on every address each has on
   * file — the automatic counterpart to sendPortalInvite's one chosen address,
   * and the season twin of sendTeamRosterInvites.
   */
  sendSeasonRosterInvites(
    seasonId: string,
    playerIds?: string[],
    emails?: string[],
  ): Promise<import('./types').TeamInviteResult>;
  /**
   * Invite tryout participants to the portal on every address each has on
   * file — the assessment-roster twin of sendSeasonRosterInvites /
   * sendTeamRosterInvites. No RLS or RPC change backs this: `can_access_tryout`
   * already lets a guardian read a tryout once their athlete is on its roster
   * and their account is linked; this is what actually gets them that link.
   */
  sendTryoutRosterInvites(
    tryoutId: string,
    participantIds?: string[],
    emails?: string[],
  ): Promise<import('./types').TeamInviteResult>;
  importScanScores(tryoutId: string, scores: { playerId: string; rubricKey: string; value: number }[]): Promise<void>;
  getGuardianRosters(): Promise<GuardianRosterAthlete[]>;
  /**
   * Takes the guardian's own athlete off a team: the season roster entry, the
   * team roster row behind it, and any other live season of the same team
   * (guardian_leave_season RPC). Removing the team roster row is what makes it
   * stick — anything less and the team's next event save re-enrolls them.
   */
  leaveSeason(seasonRosterId: string): Promise<void>;

  // Extra family contacts a guardian keeps on their own athlete's profile
  // (see athlete_family_contacts migration for the access model).
  listFamilyContacts(athleteId: string): Promise<import('./types').FamilyContact[]>;
  addFamilyContact(
    athleteId: string,
    contact: { name: string; relationship?: string; email?: string; phone?: string },
  ): Promise<import('./types').FamilyContact>;
  removeFamilyContact(id: string): Promise<void>;

  // Player selection letters — the offer / roster-decision letters a coach
  // sends when a tryout is decided. Templates are account-wide and reusable;
  // a sent letter is snapshotted onto the player it went to. See letters.ts
  // for the placeholder model and the tryout_letters migration for access.
  listLetterTemplates(): Promise<import('./types').LetterTemplate[]>;
  createLetterTemplate(input: {
    name: string;
    kind: import('./letters').LetterKind;
    subject: string;
    body: string;
    tryoutId?: string;
  }): Promise<import('./types').LetterTemplate>;
  updateLetterTemplate(
    id: string,
    updates: Partial<{ name: string; kind: import('./letters').LetterKind; subject: string; body: string }>,
  ): Promise<import('./types').LetterTemplate>;
  deleteLetterTemplate(id: string): Promise<void>;

  /**
   * Every letter sent from this assessment, newest first — the send screen's
   * history. Pass participantId to scope to one player's copies instead of
   * fetching the whole assessment's.
   */
  listPlayerLetters(tryoutId: string, participantId?: string): Promise<import('./types').PlayerLetter[]>;
  /**
   * Render a template for each selected player, email it, and attach the copy
   * to their card.
   *
   * Players are independent, like importTryoutPlayers(): one player with no
   * address on file (or a bounced send) is reported in the result, not thrown,
   * so a 40-player send doesn't abort on the first bad row. The copy is stored
   * either way — a failed letter is a draft the coach can fix and retry.
   */
  sendPlayerLetters(
    tryoutId: string,
    letters: {
      playerId: string;
      /** Echoed back on the result, so a partial-failure report can name people. */
      playerName: string;
      athleteId?: string;
      templateId?: string;
      kind: import('./letters').LetterKind;
      subject: string;
      body: string;
      recipientEmail?: string;
    }[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<import('./types').PlayerLetterSendResult[]>;
  /** Edit a stored copy without sending it — the coach fixing a typo before a re-send. */
  updatePlayerLetter(
    id: string,
    updates: Partial<{ subject: string; body: string; recipientEmail: string }>,
  ): Promise<import('./types').PlayerLetter>;
  /** Re-send a stored letter as it currently reads, updating its copy in place. */
  resendPlayerLetter(id: string): Promise<import('./types').PlayerLetter>;
  deletePlayerLetter(id: string): Promise<void>;

  // Testing utilities (association/enterprise): bulk-generate dummy registrations
  // and/or scored roster players, stand up whole dummy teams, and clear either
  // batch again. See `testDataGenerator.ts` for the option shapes.
  generateTestData(
    tryoutId: string,
    options: import('./testDataGenerator').DummyDataOptions,
    onProgress?: (done: number, total: number) => void,
  ): Promise<import('./testDataGenerator').DummyDataResult>;
  clearTestData(tryoutId: string): Promise<{ removed: number }>;
  generateDummyTeams(
    options: import('./testDataGenerator').DummyTeamOptions,
    onProgress?: (done: number, total: number) => void,
  ): Promise<import('./testDataGenerator').DummyTeamResult>;
  clearDummyTeams(): Promise<{ teams: number; assessments: number }>;
}
