import { useEffect, useState } from 'react';
import { Alert, Platform, Text, View } from 'react-native';

import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, ErrorState, useTypeToConfirm } from '@/components/ui';
import { TemplateEditor, type TemplateDraft } from '@/components/letters/TemplateEditor';
import { BUILT_IN_LETTER_TEMPLATES, LETTER_KIND_LABELS } from '@/data/letters';
import type { LetterTemplate } from '@/data/types';
import {
  useCreateLetterTemplateMutation,
  useDeleteLetterTemplateMutation,
  useLetterTemplatesQuery,
  useUpdateLetterTemplateMutation,
} from '@/features/queries';

/**
 * The account's letter templates — the Offer Letter and the Roster Decision
 * Letter, plus any custom ones — listed and edited in place.
 *
 * Templates belong to the account, not to an evaluation, so nothing here needs
 * one: the same list and the same editor appear on the evaluation's Letters
 * screen. Only *sending* a letter needs an evaluation, because that is where the
 * players are.
 */
export function LetterTemplatesManager() {
  const typeToConfirm = useTypeToConfirm();
  const colors = useThemeColors();
  const templatesQuery = useLetterTemplatesQuery();
  const createTemplate = useCreateLetterTemplateMutation();
  const updateTemplate = useUpdateLetterTemplateMutation();
  const deleteTemplate = useDeleteLetterTemplateMutation();

  const [draft, setDraft] = useState<TemplateDraft | null>(null);
  // Brief confirmation after a save: the editor closes on success, which on its
  // own reads the same as it closing because something went wrong.
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!savedNotice) return;
    const timer = setTimeout(() => setSavedNotice(null), 2600);
    return () => clearTimeout(timer);
  }, [savedNotice]);

  const alertMsg = (title: string, message: string) => {
    if (Platform.OS === 'web') alert(`${title}\n\n${message}`);
    else Alert.alert(title, message);
  };

  const saveDraft = async () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      alertMsg('Name required', 'Give the template a name so you can find it again.');
      return;
    }
    try {
      if (draft.id) {
        await updateTemplate.mutateAsync({
          id: draft.id,
          updates: { name: draft.name, kind: draft.kind, subject: draft.subject, body: draft.body },
        });
      } else {
        await createTemplate.mutateAsync({
          name: draft.name,
          kind: draft.kind,
          subject: draft.subject,
          body: draft.body,
        });
      }
      setDraft(null);
      setSavedNotice('Template saved');
    } catch (e: any) {
      alertMsg('Save Error', e?.message || 'Could not save the template.');
    }
  };

  const removeTemplate = (t: LetterTemplate) => {
    const message = `"${t.name}" will be removed. Letters already sent from it stay on the players' cards.`;
    const doDelete = async () => {
      try {
        await deleteTemplate.mutateAsync(t.id);
      } catch (e: any) {
        alertMsg('Delete Failed', e?.message || 'Could not delete the template.');
      }
    };
    typeToConfirm.ask({
      title: 'Delete template?',
      message,
      onConfirm: () => void doDelete(),
    });
  };

  const templates = templatesQuery.data ?? [];

  return (
    <View className="gap-2">
      {typeToConfirm.modal}
      {savedNotice ? (
        <View
          className="flex-row items-center gap-2 self-start rounded-full px-3 py-1.5"
          style={{ backgroundColor: 'rgba(34,197,94,0.16)', borderWidth: 1, borderColor: 'rgba(34,197,94,0.45)' }}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          <Text className="text-sm font-bold" style={{ color: colors.success }}>
            ✓
          </Text>
          <Text className="text-sm font-bold" style={{ color: colors.success }}>
            {savedNotice}
          </Text>
        </View>
      ) : null}

      {templatesQuery.isLoading ? (
        <Text className="text-sm" style={{ color: colors.inkMuted }}>
          Loading templates...
        </Text>
      ) : templatesQuery.isError ? (
        <ErrorState message="Could not load your templates." onRetry={() => templatesQuery.refetch()} />
      ) : templates.length === 0 ? (
        <View className="gap-2">
          <Text className="text-sm" style={{ color: colors.inkMuted }}>
            No templates yet. Start from one of the standard letters, you can edit every word of it before
            anything is sent.
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {BUILT_IN_LETTER_TEMPLATES.map((t) => (
              <Button
                key={t.kind}
                label={`Start from ${LETTER_KIND_LABELS[t.kind]}`}
                variant="secondary"
                size="sm"
                onPress={() => setDraft({ name: t.name, kind: t.kind, subject: t.subject, body: t.body })}
              />
            ))}
          </View>
        </View>
      ) : (
        <View className="gap-2">
          {templates.map((t) => (
            <Card key={t.id} className="gap-2">
              <View className="flex-row items-start justify-between gap-2">
                <View className="flex-1">
                  <Text numberOfLines={1} className="text-base font-bold" style={{ color: colors.ink }}>
                    {t.name}
                  </Text>
                  <Text numberOfLines={1} className="mt-0.5 text-sm" style={{ color: colors.inkMuted }}>
                    {t.subject || 'No subject'}
                  </Text>
                </View>
                <Badge label={LETTER_KIND_LABELS[t.kind]} variant={t.kind === 'offer' ? 'success' : 'info'} />
              </View>
              <View className="flex-row flex-wrap gap-2">
                <Button
                  label="Edit"
                  variant="secondary"
                  size="sm"
                  onPress={() =>
                    setDraft({ id: t.id, name: t.name, kind: t.kind, subject: t.subject, body: t.body })
                  }
                />
                <Button label="Delete" variant="ghost" size="sm" onPress={() => removeTemplate(t)} />
              </View>
            </Card>
          ))}
        </View>
      )}

      <View className="flex-row flex-wrap gap-2 mt-1">
        <Button
          label="+ New Template"
          size="sm"
          variant="secondary"
          onPress={() => setDraft({ name: '', kind: 'custom', subject: '', body: '' })}
        />
      </View>

      <TemplateEditor
        draft={draft}
        saving={createTemplate.isPending || updateTemplate.isPending}
        onChange={setDraft}
        onClose={() => setDraft(null)}
        onSave={saveDraft}
      />
    </View>
  );
}
