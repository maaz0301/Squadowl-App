const fs = require('fs');
const file = 'src/screens/(app)/guardian/[playerId].tsx';
let content = fs.readFileSync(file, 'utf8');

// Add ExpandableText component
const expandableText = `
function ExpandableText({ text, style, className }: { text: string, style?: any, className?: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Pressable onPress={() => setExpanded(!expanded)}>
      <Text className={className} style={style} numberOfLines={expanded ? undefined : 1}>
        {text}
      </Text>
    </Pressable>
  );
}
`;

content = content.replace("import type { SeasonEvent } from '@/data/types';", "import type { SeasonEvent } from '@/data/types';\n" + expandableText);

// Use ExpandableText in TryoutSeasonCard
content = content.replace(
  /<Text className="text-lg font-display font-bold mb-1" style={{ color: colors.ink }}>\s*\{item.name\}\s*<\/Text>/,
  '<ExpandableText text={item.name} className="text-lg font-display font-bold mb-1" style={{ color: colors.ink }} />'
);

// Use ExpandableText in EventCard for seasonName
content = content.replace(
  /<Text className="text-sm" style={{ color: colors.primary }}>\s*\{item.seasonName\}\s*<\/Text>/,
  '<ExpandableText text={item.seasonName} className="text-sm" style={{ color: colors.primary }} />'
);

fs.writeFileSync(file, content);
