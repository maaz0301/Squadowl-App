import type { Database, Org, Season, Team, Tryout, UserProfile } from '../types';
import { generateCloudCode, generateId, getDefaultWeights } from '../rubrics';

export const DEMO_USER: UserProfile = {
  id: 'user_demo',
  email: 'coach@example.com',
  displayName: 'Coach Shawn',
  planTier: 'club',
  createdAt: Date.now() - 86400000 * 30,
  onboardingCompleted: false,
  onboardingSteps: {
    createTeam: true,
    createAssessment: false,
    inviteAssessors: false,
    addPlayers: false,
    scorePlayers: false,
  },
};

export const DEMO_TEAM: Team = {
  id: 'team_u14',
  name: 'U14 Thunder',
  season: '2025-26',
  createdAt: Date.now() - 86400000 * 14,
};

export const DEMO_ORG: Org = {
  id: 'org_demo',
  orgSlug: 'thunder-hockey',
  orgName: 'Thunder Hockey Association',
  sport: 'Hockey',
  memberCount: 12,
  assessmentCount: 4,
  playerCount: 86,
  planTier: 'association',
  createdAt: Date.now() - 86400000 * 90,
};

function makeDemoSeason(): Season {
  const now = Date.now();
  return {
    id: 'season_demo_1',
    name: '2025-26 U14 Season',
    teamName: 'U14 Thunder',
    sport: 'Hockey',
    year: '2025-26',
    division: 'U14 AA',
    coach: 'Coach Shawn',
    teamId: DEMO_TEAM.id,
    scheduleShareToken: 'sched_demo_token',
    events: [
      {
        id: 'event_1',
        type: 'Practice',
        title: 'Week 1 Practice',
        date: '2026-03-20',
        startTime: '18:00',
        endTime: '19:30',
        location: 'Rink A',
        notes: 'Bring water bottles',
        availability: { sp1: 'yes', sp2: 'maybe', sp3: 'yes' },
        createdAt: now - 86400000,
      },
      {
        id: 'event_2',
        type: 'Game',
        title: 'vs. North Stars',
        date: '2026-03-22',
        startTime: '10:00',
        endTime: '11:30',
        location: 'Rink B',
        availability: { sp1: 'yes', sp2: 'no', sp3: 'pending' },
        createdAt: now - 86400000,
      },
    ],
    roster: [
      {
        id: 'sp1',
        firstName: 'Alex',
        lastName: 'Johnson',
        jersey: '12',
        guardianEmail: 'sarah@example.com',
        portalInviteEmails: ['sarah@example.com'],
        portalInviteSentAt: now - 86400000 * 2,
      },
      {
        id: 'sp2',
        firstName: 'Jordan',
        lastName: 'Smith',
        jersey: '7',
        guardianEmail: 'mike@example.com',
      },
      {
        id: 'sp3',
        firstName: 'Casey',
        lastName: 'Williams',
        jersey: '1',
        guardianEmail: 'lisa@example.com',
        portalInviteEmails: ['lisa@example.com'],
      },
    ],
    createdAt: now - 86400000 * 30,
    updatedAt: now,
  };
}

function makeDemoTryout(): Tryout {
  const sport = 'Hockey' as const;
  const weights = getDefaultWeights(sport);
  const now = Date.now();
  const tryoutId = 'tryout_demo_1';

  const roster = [
    {
      id: 'player_1',
      athleteId: '48291037',
      first: 'Alex',
      last: 'Johnson',
      jersey: '12',
      pos: 'FWD',
      shoots: 'L',
      yearOfBirth: '2012',
      positionTryingOutFor: 'Forward',
      guardianName: 'Sarah Johnson',
      guardianEmail: 'sarah@example.com',
      registrationSource: 'manual' as const,
      createdAt: now - 86400000,
    },
    {
      id: 'player_2',
      athleteId: '59102847',
      first: 'Jordan',
      last: 'Smith',
      jersey: '7',
      pos: 'DEF',
      shoots: 'R',
      yearOfBirth: '2012',
      positionTryingOutFor: 'Defense',
      guardianName: 'Mike Smith',
      guardianEmail: 'mike@example.com',
      registrationSource: 'manual' as const,
      createdAt: now - 86400000,
    },
    {
      id: 'player_3',
      athleteId: '67283910',
      first: 'Casey',
      last: 'Williams',
      jersey: '1',
      pos: 'GTL',
      shoots: 'L',
      yearOfBirth: '2011',
      positionTryingOutFor: 'Goalie',
      guardianName: 'Lisa Williams',
      guardianEmail: 'lisa@example.com',
      registrationSource: 'manual' as const,
      createdAt: now - 86400000,
    },
  ];

  const evals = [
    {
      id: 'eval_1',
      playerId: 'player_1',
      date: new Date().toISOString().split('T')[0],
      evaluator: 'Coach Shawn',
      session: 'Session 1',
      strengths: 'Strong skating, good puck control',
      improve: 'Needs work on backchecking',
      recommendation: 'Make' as const,
      scores: {
        'SK1 Accel': 4,
        'SK2 Speed': 5,
        'SK3 Edges': 4,
        'PA1 Accuracy': 4,
        'PA3 Vision': 4,
        'SH1 Power': 3,
        'SH2 Accuracy': 4,
        'IQ1 HockeyIQ': 4,
        'IQ3 Compete': 5,
      },
      createdAt: now - 3600000,
    },
  ];

  return {
    id: tryoutId,
    name: 'Spring U14 Tryout',
    teamId: DEMO_TEAM.id,
    seasonId: 'season_demo_1',
    createdAt: now - 86400000 * 2,
    updatedAt: now,
    eventType: 'Tryout',
    tryoutDate: '2026-03-15',
    startTime: '09:00',
    rink: 'Rink A',
    sport,
    headAssessor: 'Coach Shawn',
    headCoach: 'Coach Shawn',
    assessors: [{ name: 'Coach Shawn', email: 'coach@example.com', role: 'lead' }],
    roster,
    evals,
    registrations: [],
    settings: {
      skaterWeights: weights.skater,
      goalieWeights: weights.goalie,
      customRubrics: [],
    },
    cloud: { id: generateCloudCode(), enabled: true },
    archived: false,
  };
}

export function createEmptyDatabase(): Database {
  return {
    version: 2,
    tryouts: {},
    teams: [],
    seasons: {},
    orgs: {},
    profile: undefined,
  };
}

export function createSeedDatabase(): Database {
  const tryout = makeDemoTryout();
  const season = makeDemoSeason();
  return {
    version: 2,
    tryouts: { [tryout.id]: tryout },
    teams: [DEMO_TEAM],
    seasons: { [season.id]: season },
    orgs: { [DEMO_ORG.id]: DEMO_ORG },
    profile: DEMO_USER,
  };
}

export function createFreshDatabaseForUser(profile: UserProfile): Database {
  return {
    version: 2,
    tryouts: {},
    teams: [],
    seasons: {},
    orgs: {},
    profile,
  };
}

export function createTryoutFromForm(
  form: {
    name: string;
    sport: Tryout['sport'];
    sportOther?: string;
    eventType?: Tryout['eventType'];
    tryoutDate?: string;
    startTime?: string;
    rink?: string;
    teamId?: string;
    headAssessor?: string;
    headCoach?: string;
  },
  profile: UserProfile,
): Tryout {
  const now = Date.now();
  const weights = getDefaultWeights(form.sport);
  return {
    id: generateId('tryout'),
    name: form.name,
    teamId: form.teamId,
    createdAt: now,
    updatedAt: now,
    eventType: form.eventType ?? 'Tryout',
    tryoutDate: form.tryoutDate,
    startTime: form.startTime,
    rink: form.rink,
    sport: form.sport,
    sportOther: form.sportOther,
    headAssessor: form.headAssessor ?? profile.displayName,
    headCoach: form.headCoach ?? profile.displayName,
    headAssessorEmail: profile.email,
    assessors: [{ name: profile.displayName, email: profile.email, role: 'lead' }],
    roster: [],
    evals: [],
    registrations: [],
    settings: {
      skaterWeights: weights.skater,
      goalieWeights: weights.goalie,
      customRubrics: [],
    },
    archived: false,
  };
}
