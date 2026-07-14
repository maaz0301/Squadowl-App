const fs = require('fs');
const file = 'src/data/supabase/SupabaseDataSource.ts';
let content = fs.readFileSync(file, 'utf8');

// 1. Fix assembleSeasons map
content = content.replace(
  /const availByEvent: Record<string, Record<string, string>> = \{\};\n    for \(const a of availabilityRows\) \(availByEvent\[a\.season_event_id\] \?\?= \{\}\)\[a\.roster_id\] = a\.response;/,
  `const availByEvent: Record<string, Record<string, string>> = {};
    for (const a of availabilityRows) {
      const rosterItem = rosterRows.find((r) => r.id === a.roster_id);
      if (rosterItem && rosterItem.athlete_id) {
        (availByEvent[a.season_event_id] ??= {})[rosterItem.athlete_id] = a.response;
      } else {
        (availByEvent[a.season_event_id] ??= {})[a.roster_id] = a.response;
      }
    }`
);

// 2. Fix setEventAvailability
content = content.replace(
  /async setEventAvailability\([\s\S]*?\): Promise<void> \{[\s\S]*?await supabase\n\s*\.from\('event_availability'\)\n\s*\.upsert\([\s\S]*?,\n\s*\{ onConflict: 'season_event_id,roster_id' \},\n\s*\);\n\s*\}/,
  `async setEventAvailability(
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
        .eq('athlete_id', playerId)
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
  }`
);

fs.writeFileSync(file, content);
