import { useEffect, useRef, useState } from 'react';
import { Alert, Linking, ScrollView, Share, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useRoute } from '@react-navigation/native';

import { useThemeColors } from '@/theme/ThemeProvider';
import {
  Badge,
  Button,
  Card,
  DateField,
  ErrorState,
  Header,
  Input,
  LoadingState,
  Modal,
  Screen,
  TimeField,
} from '@/components/ui';
import {
  useTryoutQuery,
  useUpdateTryoutMutation,
  useArchiveTryoutMutation,
  useCopyTryoutMutation,
} from '@/features/queries';
import { getDataSource } from '@/data';
import { useAssessmentId } from '@/features/useAssessmentId';
import { getDefaultRubrics } from '@/data/rubrics';

export default function SettingsScreen() {
  const id = useAssessmentId();
  const route = useRoute<any>();
  const { welcome } = route.params || {};
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const welcomedRef = useRef(false);
  const tryoutQuery = useTryoutQuery(id);
  const updateTryout = useUpdateTryoutMutation();
  const archiveTryout = useArchiveTryoutMutation();
  const copyTryout = useCopyTryoutMutation();
  const [showRubrics, setShowRubrics] = useState(false);
  const [showAssessor, setShowAssessor] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [assessorName, setAssessorName] = useState('');
  const [assessorEmail, setAssessorEmail] = useState('');
  const [name, setName] = useState('');
  const [tryoutDate, setTryoutDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [rink, setRink] = useState('');

  useEffect(() => {
    if (welcome === '1' && !welcomedRef.current) {
      welcomedRef.current = true;
      setShowAssessor(true);
    }
  }, [welcome]);

  if (tryoutQuery.isLoading) return <LoadingState message="Loading settings..." />;
  if (tryoutQuery.isError || !tryoutQuery.data) {
    return <ErrorState message="Could not load settings." onRetry={() => tryoutQuery.refetch()} />;
  }

  const tryout = tryoutQuery.data;
  const rubrics = getDefaultRubrics(tryout.sport);

  const openEdit = () => {
    setName(tryout.name);
    setTryoutDate(tryout.tryoutDate ?? '');
    setStartTime(tryout.startTime ?? '');
    setRink(tryout.rink ?? '');
    setShowEdit(true);
  };

  const saveEdit = async () => {
    await updateTryout.mutateAsync({
      id: tryout.id,
      updates: {
        name: name.trim() || tryout.name,
        tryoutDate: tryoutDate.trim() || undefined,
        startTime: startTime.trim() || undefined,
        rink: rink.trim() || undefined,
      },
    });
    setShowEdit(false);
  };

  const shareAssessorInvite = async (assessor: { name: string; email?: string }) => {
    const link = `https://aas-tryout.app/assess?event=${tryout.cloud?.id ?? tryout.id}&assessor=${encodeURIComponent(assessor.name)}`;
    
    if (assessor.email) {
      const subject = `Invitation to score ${tryout.name}`;
      const body = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f4f5; margin: 0; padding: 0; }
            .container { max-width: 600px; margin: 40px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
            .header { background-color: #0f172a; padding: 32px 24px; text-align: center; }
            .header h1 { margin: 0; color: #ffffff; font-size: 24px; font-weight: 700; letter-spacing: -0.5px; }
            .content { padding: 32px 24px; color: #334155; font-size: 16px; line-height: 1.6; }
            .content p { margin-top: 0; margin-bottom: 20px; }
            .event-name { font-weight: 600; color: #0f172a; }
            .button-wrap { margin: 32px 0; text-align: center; }
            .button { display: inline-block; background-color: #f97316; color: #ffffff !important; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 16px; }
            .footer { padding: 24px; text-align: center; font-size: 14px; color: #94a3b8; background-color: #f8fafc; border-top: 1px solid #f1f5f9; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Athlete Assessment</h1>
            </div>
            <div class="content">
              <p>Hi <strong>${assessor.name}</strong>,</p>
              <p>You have been invited to participate as an assessor for the upcoming event: <span class="event-name">${tryout.name}</span>.</p>
              <p>Your expertise is invaluable to ensuring a fair and comprehensive evaluation. You can access the assessment rubrics, view the roster, and submit your scores directly through our secure platform.</p>
              <p>To get started, please <strong>sign up or log in</strong> to the Athlete Assessment app using this exact email address (<strong>${assessor.email}</strong>). Once you log in, the assessment will automatically appear on your dashboard.</p>
              <div class="button-wrap">
                <a href="${link}" class="button">Open App to Sign Up</a>
              </div>
              <p>If the button doesn't work, you can copy and paste this link into your browser:<br>
              <a href="${link}" style="color: #f97316; word-break: break-all; font-size: 14px;">${link}</a></p>
            </div>
            <div class="footer">
              <p>&copy; ${new Date().getFullYear()} Athlete Assessment. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `;
      
      // @ts-ignore
      const resendApiKey = process.env.EXPO_PUBLIC_RESEND_API_KEY;

      if (resendApiKey && resendApiKey !== 'YOUR_RESEND_API_KEY_HERE') {
        try {
          const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${resendApiKey}`,
            },
            body: JSON.stringify({
              from: 'Athlete Assessment <onboarding@resend.dev>', // Resend test domain
              to: [assessor.email],
              subject: subject,
              html: body,
            }),
          });
          
          if (res.ok) {
            Alert.alert('Invitation Sent', `An invitation email has been successfully sent to ${assessor.email}.`);
            return;
          } else {
            const errorText = await res.text();
            console.error('Failed to send email via Resend:', errorText);
            Alert.alert('Email Failed', 'Could not send the email automatically. Falling back to share menu.');
          }
        } catch (err) {
          console.error('Error sending email', err);
          Alert.alert('Email Error', 'An error occurred while sending the email. Falling back to share menu.');
        }
      } else {
        Alert.alert(
          'Configuration Needed', 
          'To send emails automatically, please replace YOUR_RESEND_API_KEY_HERE in your .env file with a valid Resend API key. Falling back to share menu.'
        );
      }
    }

    await Share.share({
      message: `${assessor.name}, you've been invited to score ${tryout.name}.\nOpen: ${link}`,
    });
  };

  const addAssessor = async () => {
    if (!assessorName.trim()) return;
    
    const emailToInvite = assessorEmail.trim();

    if (!emailToInvite) {
      Alert.alert('Email Required', 'You must provide a valid email address for the assessor.');
      return;
    }

    const exists = await getDataSource().checkUserExistsByEmail(emailToInvite);
      if (!exists) {
        Alert.alert(
          'Email Not Registered',
          'This email is not registered in the system. Assessors must create an account before they can be invited.'
        );
        return;
      }

    const newAssessor = { name: assessorName.trim(), email: emailToInvite, role: 'assessor' as const, status: 'pending' as const };
    
    await updateTryout.mutateAsync({
      id: tryout.id,
      updates: {
        assessors: [
          ...tryout.assessors,
          newAssessor,
        ],
      },
    });
    setAssessorName('');
    setAssessorEmail('');
    setShowAssessor(false);

    if (newAssessor.email) {
      await shareAssessorInvite(newAssessor);
    }
  };

  const removeAssessor = async (index: number) => {
    const newAssessors = [...tryout.assessors];
    newAssessors.splice(index, 1);
    await updateTryout.mutateAsync({
      id: tryout.id,
      updates: {
        assessors: newAssessors,
      },
    });
  };

  const handleCopy = async () => {
    const copy = await copyTryout.mutateAsync(tryout.id);
    navigation.navigate('AssessmentRoster', { id: copy.id });
  };

  const handleArchive = async () => {
    await archiveTryout.mutateAsync(tryout.id);
    navigation.replace('DashboardMain');
  };

  return (
    <Screen scroll>
      <Header title="Assessment Settings" showBack />
      <Card accent className="mb-4 gap-2">
        <Text className="text-lg font-display font-bold" style={{ color: colors.ink }}>
          {tryout.name}
        </Text>
        <Text style={{ color: colors.inkMuted }}>
          {tryout.sport} · {tryout.eventType}
        </Text>
        {tryout.tryoutDate ? (
          <Text style={{ color: colors.inkFaint }}>
            {tryout.tryoutDate} {tryout.startTime ? `· ${tryout.startTime}` : ''} · {tryout.rink}
          </Text>
        ) : null}
        {tryout.cloud?.id ? <Badge label={`Code: ${tryout.cloud.id}`} variant="brand" /> : null}
        <Button label="Edit Details" variant="secondary" size="sm" onPress={openEdit} />
      </Card>

      <Card className="mb-4 gap-3">
        <Text className="text-md font-display font-bold" style={{ color: colors.ink }}>
          Assessors ({tryout.assessors.length})
        </Text>
        {tryout.assessors.map((a, i) => (
          <View key={i} className="py-2 mb-2 border-b border-white/5 flex-col gap-2">
            <View className="flex-row justify-between items-start">
              <View className="flex-1 pr-2">
                <Text className="text-base font-bold" style={{ color: colors.ink }}>{a.name}</Text>
                {a.email ? (
                  <Text className="text-sm mt-0.5" style={{ color: colors.inkMuted }}>
                    {a.email}
                  </Text>
                ) : null}
                <View className="flex-row gap-1 mt-2">
                  {a.role !== 'lead' ? (
                    <Badge label={a.status || 'pending'} variant={a.status === 'accepted' ? 'brand' : 'default'} />
                  ) : null}
                  <Badge label={a.role} />
                </View>
              </View>
              
              {a.role !== 'lead' ? (
                <View className="flex-col gap-2 items-end">
                  <Button label="Invite" size="sm" variant="secondary" onPress={() => shareAssessorInvite(a)} />
                  <Button label="Remove" size="sm" variant="ghost" onPress={() => removeAssessor(i)} />
                </View>
              ) : null}
            </View>
          </View>
        ))}
        <Button label="+ Add Assessor" variant="secondary" size="sm" onPress={() => setShowAssessor(true)} />
      </Card>

      <Card className="mb-4 gap-2">
        <Text className="text-md font-display font-bold" style={{ color: colors.ink }}>
          Rubrics
        </Text>
        <Text className="text-sm" style={{ color: colors.inkMuted }}>
          {rubrics.skater.length} skater + {rubrics.goalie.length} goalie categories
        </Text>
        <Button label="Open Rubric Builder" variant="secondary" size="sm" onPress={() => navigation.navigate('AssessmentRubrics', { id: id })} />
        <Button label="View Reference" variant="ghost" size="sm" onPress={() => setShowRubrics(true)} />
      </Card>

      <Card className="mb-4 gap-2">
        <Text className="text-md font-display font-bold" style={{ color: colors.ink }}>
          Duplicate
        </Text>
        <Button label="Copy Assessment" variant="secondary" onPress={handleCopy} loading={copyTryout.isPending} />
      </Card>

      <Card className="mb-4 gap-2">
        <Text className="text-md font-display font-bold" style={{ color: colors.danger }}>
          Danger Zone
        </Text>
        <Button label="Archive Assessment" variant="danger" onPress={handleArchive} loading={archiveTryout.isPending} />
      </Card>

      <Modal visible={showEdit} title="Edit Assessment" onClose={() => setShowEdit(false)}>
        <View className="gap-3">
          <Input label="Name" value={name} onChangeText={setName} />
          <DateField label="Date" value={tryoutDate} onChange={setTryoutDate} placeholder="Select a date" />
          <TimeField label="Start Time" value={startTime} onChange={setStartTime} placeholder="Select a time" />
          <Input label="Location" value={rink} onChangeText={setRink} placeholder="Rink A" />
          <Button label="Save" onPress={saveEdit} loading={updateTryout.isPending} />
        </View>
      </Modal>

      <Modal visible={showRubrics} title="Rubric Reference" onClose={() => setShowRubrics(false)}>
        <ScrollView>
          <Text className="text-sm font-bold mb-2" style={{ color: colors.primary }}>
            Skater Categories
          </Text>
          {rubrics.skater.map((r) => (
            <View key={r.key} className="mb-2">
              <Text className="text-base" style={{ color: colors.ink }}>
                {r.label}
              </Text>
              <Text className="text-sm" style={{ color: colors.inkMuted }}>
                {r.subskills.map((s) => s.label).join(', ')}
              </Text>
            </View>
          ))}
          {rubrics.goalie.length > 0 ? (
            <>
              <Text className="text-sm font-bold mt-4 mb-2" style={{ color: colors.primary }}>
                Goalie Categories
              </Text>
              {rubrics.goalie.map((r) => (
                <View key={r.key} className="mb-2">
                  <Text className="text-base" style={{ color: colors.ink }}>
                    {r.label}
                  </Text>
                  <Text className="text-sm" style={{ color: colors.inkMuted }}>
                    {r.subskills.map((s) => s.label).join(', ')}
                  </Text>
                </View>
              ))}
            </>
          ) : null}
        </ScrollView>
      </Modal>

      <Modal visible={showAssessor} title="Add Assessor" onClose={() => setShowAssessor(false)}>
        <View className="gap-3">
          <Text className="text-sm" style={{ color: colors.inkMuted }}>
            Assessors must have a registered account in the app before they can be invited.
          </Text>
          <Input label="Name" value={assessorName} onChangeText={setAssessorName} />
          <Input label="Email (Required)" value={assessorEmail} onChangeText={setAssessorEmail} autoCapitalize="none" />
          <Button label="Add" onPress={addAssessor} loading={updateTryout.isPending} />
        </View>
      </Modal>
    </Screen>
  );
}
