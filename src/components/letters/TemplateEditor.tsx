import { Pressable, Text, View } from 'react-native';

import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Chip, Input, Modal } from '@/components/ui';
import {
  BUILT_IN_LETTER_TEMPLATES,
  LETTER_KINDS,
  LETTER_KIND_DESCRIPTIONS,
  LETTER_KIND_LABELS,
  LETTER_PLACEHOLDERS,
  type LetterKind,
} from '@/data/letters';

/** The template editor's working copy — a new template until it has an id. */
export interface TemplateDraft {
  id?: string;
  name: string;
  kind: LetterKind;
  subject: string;
  body: string;
}

/**
 * The letter template editor sheet. Shared by the evaluation's Letters screen
 * and the team's Options tab, so a template reads and edits the same wherever
 * it is opened from.
 */
export function TemplateEditor({
  draft,
  saving,
  onChange,
  onClose,
  onSave,
}: {
  draft: TemplateDraft | null;
  saving: boolean;
  onChange: (d: TemplateDraft) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const colors = useThemeColors();
  return (
    <Modal
      visible={!!draft}
      title={draft?.id ? 'Edit Template' : 'New Template'}
      onClose={onClose}
      footer={<Button label="Save Template" loading={saving} onPress={onSave} />}
    >
      {draft ? (
        <View className="gap-3">
          <Input
            label="Template name"
            value={draft.name}
            onChangeText={(v) => onChange({ ...draft, name: v })}
            placeholder="e.g. U15 AAA Offer Letter"
          />
          <View className="gap-1">
            <Text className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
              Type
            </Text>
            <View className="flex-row flex-wrap">
              {LETTER_KINDS.map((k) => (
                <Chip
                  key={k}
                  label={LETTER_KIND_LABELS[k]}
                  active={draft.kind === k}
                  onPress={() => onChange({ ...draft, kind: k })}
                />
              ))}
            </View>
            <Text className="text-xs" style={{ color: colors.inkMuted }}>
              {LETTER_KIND_DESCRIPTIONS[draft.kind]}
            </Text>
          </View>
          <Input label="Subject" value={draft.subject} onChangeText={(v) => onChange({ ...draft, subject: v })} />
          <Input
            label="Letter"
            value={draft.body}
            onChangeText={(v) => onChange({ ...draft, body: v })}
            multiline
            numberOfLines={12}
            style={{ minHeight: 220, textAlignVertical: 'top' }}
          />
          <Text className="text-xs" style={{ color: colors.inkMuted }}>
            Tap a placeholder below to add it to the end of the letter.
          </Text>

          {/* Only the standard letters carry pre-written wording, so offering
              them here is what makes "start from the template" reachable when a
              coach is already halfway through writing their own. */}
          {!draft.id ? (
            <View>
              <Text className="mb-1.5 text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
                Start from a standard letter
              </Text>
              <View className="flex-row flex-wrap">
                {BUILT_IN_LETTER_TEMPLATES.map((t) => (
                  <Chip
                    key={t.kind}
                    label={LETTER_KIND_LABELS[t.kind]}
                    onPress={() =>
                      onChange({
                        ...draft,
                        // Keep a name the coach typed, but not one a previous standard
                        // chip filled in — otherwise switching Offer -> Decision left
                        // a "Offer Letter" name on decision wording and type.
                        name:
                          !draft.name.trim() || BUILT_IN_LETTER_TEMPLATES.some((b) => b.name === draft.name)
                            ? t.name
                            : draft.name,
                        kind: t.kind,
                        subject: t.subject,
                        body: t.body,
                      })
                    }
                  />
                ))}
              </View>
            </View>
          ) : null}

          <View>
            <Text className="mb-1.5 text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
              Placeholders
            </Text>
            <View className="gap-1">
              {LETTER_PLACEHOLDERS.map((p) => (
                <Pressable
                  key={p.token}
                  onPress={() => onChange({ ...draft, body: `${draft.body}{{${p.token}}}` })}
                  className="flex-row flex-wrap items-center gap-2 rounded-lg px-2 py-2 active:opacity-70"
                  style={{ backgroundColor: colors.tile }}
                >
                  <Text className="text-xs font-bold" style={{ color: colors.primary }}>{`{{${p.token}}}`}</Text>
                  <Text className="flex-1 text-xs" style={{ color: colors.inkMuted }}>
                    {p.hint}
                  </Text>
                  {!p.auto ? <Badge label="you write this" variant="warning" /> : null}
                </Pressable>
              ))}
            </View>
          </View>
        </View>
      ) : null}
    </Modal>
  );
}
