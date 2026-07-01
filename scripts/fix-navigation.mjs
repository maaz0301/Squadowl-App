import fs from 'fs';
import path from 'path';

const SRC_DIR = path.join(process.cwd(), 'src');

function walkDir(dir, callback) {
  fs.readdirSync(dir).forEach((f) => {
    const dirPath = path.join(dir, f);
    const isDirectory = fs.statSync(dirPath).isDirectory();
    isDirectory ? walkDir(dirPath, callback) : callback(dirPath);
  });
}

const replacements = [
  { match: /['"]\/\(app\)\/dashboard['"]/g, replace: "'Dashboard'" },
  { match: /['"]\/\(app\)\/upgrade['"]/g, replace: "'Upgrade'" },
  { match: /['"]\/\(app\)\/search['"]/g, replace: "'Search'" },
  { match: /['"]\/\(app\)\/archived-assessments['"]/g, replace: "'ArchivedAssessments'" },
  { match: /['"]\/\(app\)\/feedback['"]/g, replace: "'Feedback'" },
  { match: /['"]\/\(app\)\/friend-packages['"]/g, replace: "'FriendPackages'" },
  { match: /['"]\/\(app\)\/enterprise['"]/g, replace: "'Enterprise'" },
  { match: /['"]\/\(app\)\/admin['"]/g, replace: "'Admin'" },
  { match: /['"]\/\(app\)\/team\/new['"]/g, replace: "'NewTeam'" },
  { match: /['"]\/\(app\)\/assessment\/new['"]/g, replace: "'NewAssessment'" },
  { match: /['"]\/\(app\)\/combine['"]/g, replace: "'Combine'" },
  { match: /['"]\/\(app\)\/season\/new['"]/g, replace: "'NewSeason'" },
  { match: /['"]\/\(onboarding\)\/wizard['"]/g, replace: "'Wizard'" },
  // Parametrized paths using template literals
  { match: /`\/\(app\)\/assessment\/\$\{([a-zA-Z0-9_.]+)\}\/roster`/g, replace: "'AssessmentRoster', { id: $1 }" },
  { match: /`\/\(app\)\/assessment\/\$\{([a-zA-Z0-9_.]+)\}\/settings\?welcome=1`/g, replace: "'AssessmentSettings', { id: $1, welcome: 1 }" },
  { match: /`\/\(app\)\/assessment\/\$\{([a-zA-Z0-9_.]+)\}\/settings`/g, replace: "'AssessmentSettings', { id: $1 }" },
  { match: /`\/\(app\)\/season\/\$\{([a-zA-Z0-9_.]+)\}\/settings`/g, replace: "'SeasonSettings', { id: $1 }" },
  { match: /`\/\(app\)\/season\/\$\{([a-zA-Z0-9_.]+)\}`/g, replace: "'SeasonDetail', { id: $1 }" },
  { match: /`\/\(app\)\/team\/\$\{([a-zA-Z0-9_.]+)\}`/g, replace: "'TeamDetail', { id: $1 }" },
  { match: /`\/\(app\)\/assessment\/\$\{([a-zA-Z0-9_.]+)\}\/rinkside`/g, replace: "'AssessmentRinkside', { id: $1 }" },
  { match: /`\/\(app\)\/assessment\/\$\{([a-zA-Z0-9_.]+)\}\/score\/\$\{([a-zA-Z0-9_.]+)\}\?evalId=\$\{([a-zA-Z0-9_.]+)\}`/g, replace: "'AssessmentScore', { id: $1, playerId: $2, evalId: $3 }" },
  { match: /`\/\(app\)\/assessment\/\$\{([a-zA-Z0-9_.]+)\}\/score\/\$\{([a-zA-Z0-9_.]+)\}`/g, replace: "'AssessmentScore', { id: $1, playerId: $2 }" },
  { match: /`\/\(app\)\/assessment\/\$\{([a-zA-Z0-9_.]+)\}\/player\/\$\{([a-zA-Z0-9_.]+)\}`/g, replace: "'AssessmentPlayer', { id: $1, playerId: $2 }" },
  { match: /`\/\(app\)\/assessment\/\$\{([a-zA-Z0-9_.]+)\}\/team-builder`/g, replace: "'AssessmentTeamBuilder', { id: $1 }" },
  { match: /`\/\(app\)\/assessment\/\$\{([a-zA-Z0-9_.]+)\}\/roster-library`/g, replace: "'AssessmentRosterLibrary', { id: $1 }" },
  { match: /`\/\(app\)\/assessment\/\$\{([a-zA-Z0-9_.]+)\}\/scan-sheet`/g, replace: "'AssessmentScanSheet', { id: $1 }" },
  { match: /`\/\(app\)\/assessment\/\$\{([a-zA-Z0-9_.]+)\}\/results`/g, replace: "'AssessmentResults', { id: $1 }" },
  { match: /`\/\(app\)\/assessment\/\$\{([a-zA-Z0-9_.]+)\}\/compare`/g, replace: "'AssessmentCompare', { id: $1 }" },
  { match: /`\/\(app\)\/assessment\/\$\{([a-zA-Z0-9_.]+)\}\/export`/g, replace: "'AssessmentExport', { id: $1 }" },
  { match: /`\/\(app\)\/assessment\/\$\{([a-zA-Z0-9_.]+)\}\/rubrics`/g, replace: "'AssessmentRubrics', { id: $1 }" },
  { match: /`\/\(app\)\/season\/\$\{([a-zA-Z0-9_.]+)\}\/schedule`/g, replace: "'SeasonSchedule', { id: $1 }" },
  { match: /`\/\(app\)\/season\/\$\{([a-zA-Z0-9_.]+)\}\/player\/\$\{([a-zA-Z0-9_.]+)\}`/g, replace: "'SeasonPlayer', { id: $1, playerId: $2 }" },
];

walkDir(SRC_DIR, (filePath) => {
  if (filePath.endsWith('.tsx') || filePath.endsWith('.ts')) {
    let content = fs.readFileSync(filePath, 'utf8');
    let original = content;

    for (const { match, replace } of replacements) {
      content = content.replace(match, replace);
    }

    if (content !== original) {
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`Updated ${filePath.replace(process.cwd(), '')}`);
    }
  }
});
