import fs from 'fs';
import path from 'path';

const SRC_DIR = path.join(process.cwd(), 'src');

function walkDir(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    let dirPath = path.join(dir, f);
    let isDirectory = fs.statSync(dirPath).isDirectory();
    isDirectory ? walkDir(dirPath, callback) : callback(dirPath);
  });
}

const assessmentScreens = [
  'AssessmentRoster',
  'AssessmentRegistrations',
  'AssessmentResults',
  'AssessmentSettings',
  'AssessmentExport',
  'AssessmentRubrics',
  'AssessmentPlayer',
  'AssessmentScore',
  'AssessmentRinkside',
  'AssessmentTeamBuilder',
  'AssessmentCompare',
  'AssessmentRosterLibrary',
  'AssessmentScanSheet'
];

walkDir(SRC_DIR, (filePath) => {
  if (filePath.endsWith('.tsx') || filePath.endsWith('.ts')) {
    let content = fs.readFileSync(filePath, 'utf8');
    let original = content;

    for (const screen of assessmentScreens) {
      // navigation.navigate('AssessmentRoster', { id: ... })
      // navigation.replace('AssessmentRoster', { id: ... })
      // We want to replace it with:
      // navigation.navigate('AssessmentFlow', { screen: 'AssessmentRoster', params: { id: ... } })
      
      const regex = new RegExp(`(navigate|replace|push)\\(['"\`]${screen}['"\`]\\s*,\\s*\\{([^{}]*)\\}\\)`, 'g');
      content = content.replace(regex, (match, method, paramsInner) => {
        return `${method}('AssessmentFlow', { screen: '${screen}', params: {${paramsInner}} })`;
      });
      
      // Handle cases where no params are passed (unlikely for assessments, but just in case)
      const regexNoParams = new RegExp(`(navigate|replace|push)\\(['"\`]${screen}['"\`]\\)`, 'g');
      content = content.replace(regexNoParams, (match, method) => {
        return `${method}('AssessmentFlow', { screen: '${screen}' })`;
      });
    }

    if (content !== original) {
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`Updated ${filePath.replace(process.cwd(), '')}`);
    }
  }
});
