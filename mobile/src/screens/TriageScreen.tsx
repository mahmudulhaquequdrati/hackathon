import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  RefreshControl, ActivityIndicator, Alert, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTriageStore } from '../lib/useTriageStore';
import { api } from '../lib/api';
import { Card } from '../components/Card';
import { ActionButton } from '../components/ActionButton';
import { StatusBadge } from '../components/StatusBadge';
import { PriorityBadge, getPriorityColor } from '../components/PriorityBadge';
import { StatCard } from '../components/StatCard';
import { EmptyState } from '../components/EmptyState';
import { colors } from '../theme/colors';
import { textStyles, fontSize, fontWeight } from '../theme/typography';
import { spacing, radius } from '../theme/spacing';
import type { TriageEvaluation, PreemptionDecision } from '../types';

const SLA_HOURS: Record<string, number> = { P0: 2, P1: 6, P2: 24, P3: 72 };

function formatCountdown(slaDeadline: string, now: number): string {
  const diff = new Date(slaDeadline).getTime() - now;
  if (diff <= 0) return 'BREACHED';
  const totalSec = Math.floor(diff / 1000);
  const h = String(Math.floor(totalSec / 3600)).padStart(2, '0');
  const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
  const s = String(totalSec % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function getStatusColor(status: 'ok' | 'warning' | 'breach'): string {
  switch (status) {
    case 'breach': return colors.status.error;
    case 'warning': return colors.status.warning;
    case 'ok': return colors.status.success;
  }
}

function CountdownTimer({ slaDeadline, status }: { slaDeadline: string; status: 'ok' | 'warning' | 'breach' }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);
  const countdown = formatCountdown(slaDeadline, now);
  const isBreached = countdown === 'BREACHED';
  return (
    <Text style={[st.countdown, { color: isBreached ? colors.status.error : status === 'warning' ? colors.status.warning : colors.text.primary }]}>
      {countdown}
    </Text>
  );
}

function SlackProgressBar({ slackMinutes, priority }: { slackMinutes: number; priority: string }) {
  const totalMinutes = (SLA_HOURS[priority] || 24) * 60;
  const progress = Math.max(0, Math.min(1, slackMinutes / totalMinutes));
  const color = slackMinutes <= 0 ? colors.status.error : slackMinutes < totalMinutes * 0.2 ? colors.status.warning : colors.status.success;
  return (
    <View style={st.progressContainer}>
      <View style={[st.progressBar, { width: `${Math.round(progress * 100)}%` as any, backgroundColor: color }]} />
    </View>
  );
}

function EvaluationCard({ evaluation, onPreempt }: { evaluation: TriageEvaluation; onPreempt: (id: string) => void }) {
  const isBreached = evaluation.status === 'breach';
  return (
    <Card style={[st.evalCard, isBreached && st.evalCardBreached]} variant={isBreached ? 'accent' : 'default'} accentColor={isBreached ? colors.status.error : undefined}>
      <View style={st.evalHeader}>
        <PriorityBadge priority={evaluation.priority} showLabel />
        <StatusBadge label={evaluation.status.toUpperCase()} color={getStatusColor(evaluation.status)} dot />
        <CountdownTimer slaDeadline={evaluation.sla_deadline} status={evaluation.status} />
      </View>

      <Text style={st.supplyName}>{evaluation.supply_name}</Text>
      <Text style={st.nodeRoute}>
        {(evaluation as any).source_name || evaluation.source_node_id} {'\u2192'} {(evaluation as any).target_name || evaluation.target_node_id}
      </Text>

      <View style={st.evalMeta}>
        <View style={st.evalMetaItem}>
          <Text style={st.metaLabel}>Vehicle</Text>
          <Text style={st.metaValue}>{evaluation.vehicle_type}</Text>
        </View>
        <View style={st.evalMetaItem}>
          <Text style={st.metaLabel}>Slack</Text>
          <Text style={[st.metaValue, { color: evaluation.slack_minutes <= 0 ? colors.status.error : colors.text.primary }]}>
            {evaluation.slack_minutes.toFixed(0)}m
          </Text>
        </View>
      </View>

      <SlackProgressBar slackMinutes={evaluation.slack_minutes} priority={evaluation.priority} />

      {evaluation.preemption_eligible && (
        <ActionButton
          title="Trigger Preemption"
          onPress={() => onPreempt(evaluation.delivery_id)}
          variant="destructive"
          fullWidth
          size="sm"
          style={{ marginTop: spacing.sm }}
        />
      )}
    </Card>
  );
}

function DecisionCard({ decision, expanded, onToggle }: { decision: PreemptionDecision; expanded: boolean; onToggle: () => void }) {
  return (
    <Card style={st.decisionCard}>
      <TouchableOpacity onPress={onToggle} activeOpacity={0.7}>
        <View style={st.decisionHeader}>
          <PriorityBadge priority={decision.priority} />
          <StatusBadge label={decision.decision_type.replace('_', ' ').toUpperCase()} color={colors.module.triage} />
          <Text style={st.decisionTime}>{new Date(decision.created_at).toLocaleTimeString()}</Text>
        </View>
        <Text style={st.decisionSupply}>{decision.supply_name}</Text>
      </TouchableOpacity>

      {expanded && (
        <View style={st.decisionExpanded}>
          <Text style={st.decisionRationale}>{decision.rationale}</Text>
          {decision.dropped_cargo && (
            <View style={st.droppedWrap}>
              <Text style={st.droppedLabel}>Dropped Cargo:</Text>
              <Text style={st.droppedText}>
                {(Array.isArray(decision.dropped_cargo) ? decision.dropped_cargo : JSON.parse(decision.dropped_cargo || '[]')).join(', ')}
              </Text>
            </View>
          )}
          <View style={st.etaRow}>
            <View style={st.etaBox}>
              <Text style={st.etaLabel}>Old ETA</Text>
              <Text style={st.etaOld}>{new Date(decision.old_eta).toLocaleTimeString()}</Text>
            </View>
            <Text style={st.etaArrow}>{'\u2192'}</Text>
            <View style={st.etaBox}>
              <Text style={st.etaLabel}>New ETA</Text>
              <Text style={st.etaNew}>{new Date(decision.new_eta).toLocaleTimeString()}</Text>
            </View>
          </View>
        </View>
      )}
    </Card>
  );
}

interface Props { onBack: () => void; }

export default function TriageScreen({ onBack: _onBack }: Props) {
  const {
    priorities, evaluations, decisions, loading,
    lastEvaluatedAt, breachCount, warningCount,
    fetchPriorities, runEvaluation, executePreemption, fetchDecisions,
  } = useTriageStore();

  const [refreshing, setRefreshing] = useState(false);
  const [showTaxonomy, setShowTaxonomy] = useState(false);
  const [expandedDecision, setExpandedDecision] = useState<string | null>(null);
  const pulseAnim = React.useRef(new Animated.Value(1)).current;

  useEffect(() => { fetchPriorities(); fetchDecisions(); runEvaluation(); }, []);

  // Pulse animation for breach count
  useEffect(() => {
    if (breachCount > 0) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.1, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        ]),
      );
      pulse.start();
      return () => pulse.stop();
    } else { pulseAnim.setValue(1); }
  }, [breachCount, pulseAnim]);

  // WebSocket listener
  useEffect(() => {
    const apiUrl = api.getBaseUrl() || '';
    const wsUrl = apiUrl.replace(/^http/, 'ws').replace(/\/api\/v1$/, '');
    if (!wsUrl) return;
    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket(wsUrl);
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'TRIAGE_EVALUATED' && msg.data) {
            useTriageStore.setState({
              evaluations: msg.data.evaluations || [],
              breachCount: msg.data.breach_count || 0,
              warningCount: msg.data.warning_count || 0,
              lastEvaluatedAt: msg.data.evaluated_at || new Date().toISOString(),
            });
          } else if (msg.type === 'PREEMPTION_EXECUTED') { fetchDecisions(); }
        } catch {}
      };
      ws.onerror = () => {};
    } catch {}
    return () => { try { ws?.close(); } catch {} };
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([runEvaluation(), fetchDecisions()]);
    setRefreshing(false);
  }, []);

  const handlePreempt = useCallback((deliveryId: string) => {
    Alert.alert('Confirm Preemption', 'Drop low-priority cargo and reroute with urgent supplies only?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Preempt', style: 'destructive', onPress: () => executePreemption(deliveryId) },
    ]);
  }, [executePreemption]);

  const okCount = evaluations.filter(e => e.status === 'ok').length;

  return (
    <SafeAreaView style={st.safe} edges={['top']}>
      {/* Header */}
      <View style={st.header}>
        <View>
          <Text style={st.headerTitle}>Triage Engine</Text>
          {lastEvaluatedAt && <Text style={st.headerSub}>Updated {new Date(lastEvaluatedAt).toLocaleTimeString()}</Text>}
        </View>
        <ActionButton
          title={loading ? '...' : 'Evaluate'}
          onPress={runEvaluation}
          loading={loading}
          variant="destructive"
          size="sm"
        />
      </View>

      <ScrollView
        contentContainerStyle={st.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.status.error} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Stats Row */}
        <View style={st.statsRow}>
          <Animated.View style={[{ flex: 1 }, { transform: [{ scale: breachCount > 0 ? pulseAnim : 1 }] }]}>
            <StatCard value={breachCount} label="Breach" color={colors.status.error} />
          </Animated.View>
          <View style={{ width: spacing.sm }} />
          <StatCard value={warningCount} label="Warning" color={colors.status.warning} />
          <View style={{ width: spacing.sm }} />
          <StatCard value={okCount} label="OK" color={colors.status.success} />
        </View>

        {/* Priority Taxonomy (collapsible) */}
        <TouchableOpacity onPress={() => setShowTaxonomy(!showTaxonomy)} style={st.taxonomyToggle} activeOpacity={0.7}>
          <Text style={st.sectionLabel}>PRIORITY TAXONOMY</Text>
          <Text style={st.toggleIcon}>{showTaxonomy ? '\u25B2' : '\u25BC'}</Text>
        </TouchableOpacity>

        {showTaxonomy && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={st.taxonomyScroll}>
            {(priorities.length > 0 ? priorities : Object.entries(SLA_HOURS).map(([tier, hours]) => ({
              tier, label: tier === 'P0' ? 'Critical Medical' : tier === 'P1' ? 'High Priority' : tier === 'P2' ? 'Standard' : 'Low Priority',
              sla_hours: hours, examples: '',
            }))).map((p: any) => {
              const pColor = getPriorityColor(p.tier);
              return (
                <View key={p.tier} style={[st.taxonomyCard, { borderColor: pColor, backgroundColor: `${pColor}11` }]}>
                  <Text style={[st.taxonomyTier, { color: pColor }]}>{p.tier}</Text>
                  <Text style={st.taxonomyLabel}>{p.label}</Text>
                  <Text style={[st.taxonomySla, { color: pColor }]}>{p.sla_hours}h SLA</Text>
                  {p.examples ? <Text style={st.taxonomyEx} numberOfLines={2}>{p.examples}</Text> : null}
                </View>
              );
            })}
          </ScrollView>
        )}

        {/* Active Deliveries - Evaluations */}
        <Text style={[st.sectionLabel, { marginTop: spacing.lg }]}>ACTIVE DELIVERIES ({evaluations.length})</Text>

        {loading && evaluations.length === 0 && (
          <View style={st.loadingRow}>
            <ActivityIndicator color={colors.status.error} />
            <Text style={st.loadingText}>Evaluating deliveries...</Text>
          </View>
        )}

        {evaluations.length === 0 && !loading && (
          <EmptyState title="No active deliveries" message="Pull to refresh or tap Evaluate" />
        )}

        {evaluations.map(ev => (
          <EvaluationCard key={ev.delivery_id} evaluation={ev} onPreempt={handlePreempt} />
        ))}

        {/* Decision Log */}
        <Text style={[st.sectionLabel, { marginTop: spacing.xl }]}>DECISION LOG ({decisions.length})</Text>

        {decisions.length === 0 && (
          <EmptyState title="No preemption decisions" message="Decisions appear when deliveries are preempted" />
        )}

        {decisions.map(d => (
          <DecisionCard
            key={d.id}
            decision={d}
            expanded={expandedDecision === d.id}
            onToggle={() => setExpandedDecision(expandedDecision === d.id ? null : d.id)}
          />
        ))}

        <View style={{ height: spacing['3xl'] }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.primary },

  // Header
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border.default,
  },
  headerTitle: { ...textStyles.h3, color: colors.text.primary },
  headerSub: { fontSize: fontSize.xs, color: colors.text.muted, marginTop: 1 },

  content: { padding: spacing.lg },

  // Stats
  statsRow: { flexDirection: 'row', marginBottom: spacing.lg },

  // Sections
  sectionLabel: { ...textStyles.label, color: colors.text.muted, marginBottom: spacing.md },

  // Taxonomy
  taxonomyToggle: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  toggleIcon: { color: colors.text.muted, fontSize: 12 },
  taxonomyScroll: { marginBottom: spacing.lg },
  taxonomyCard: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, width: 130, marginRight: spacing.sm },
  taxonomyTier: { fontSize: fontSize['2xl'], fontWeight: fontWeight.bold, marginBottom: 2 },
  taxonomyLabel: { fontSize: fontSize.sm, color: colors.text.secondary, fontWeight: fontWeight.semibold, marginBottom: spacing.xs },
  taxonomySla: { fontSize: fontSize.base, fontWeight: fontWeight.bold, marginBottom: spacing.xs },
  taxonomyEx: { fontSize: fontSize.xs, color: colors.text.muted, lineHeight: 14 },

  // Evaluation cards
  evalCard: { marginBottom: spacing.md },
  evalCardBreached: { borderColor: colors.status.error },
  evalHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  countdown: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, marginLeft: 'auto' },
  supplyName: { ...textStyles.h4, color: colors.text.primary, marginBottom: 2 },
  nodeRoute: { fontSize: fontSize.sm, color: colors.text.muted, marginBottom: spacing.md },
  evalMeta: { flexDirection: 'row', gap: spacing.xl, marginBottom: spacing.sm },
  evalMetaItem: {},
  metaLabel: { fontSize: fontSize.xs, color: colors.text.muted },
  metaValue: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.text.primary },

  // Progress
  progressContainer: { height: 4, backgroundColor: colors.bg.elevated, borderRadius: 2, overflow: 'hidden', marginBottom: spacing.sm },
  progressBar: { height: 4, borderRadius: 2 },

  // Decision cards
  decisionCard: { marginBottom: spacing.sm },
  decisionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  decisionTime: { fontSize: fontSize.xs, color: colors.text.muted, marginLeft: 'auto' },
  decisionSupply: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.text.primary },
  decisionExpanded: { marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border.default },
  decisionRationale: { fontSize: fontSize.sm, color: colors.text.tertiary, lineHeight: 20, marginBottom: spacing.sm },
  droppedWrap: { marginBottom: spacing.sm },
  droppedLabel: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.status.error },
  droppedText: { fontSize: fontSize.sm, color: colors.status.error, marginTop: 2 },
  etaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  etaBox: { flex: 1, backgroundColor: colors.bg.elevated, borderRadius: radius.sm, padding: spacing.sm, alignItems: 'center' },
  etaLabel: { fontSize: fontSize.xs, color: colors.text.muted },
  etaOld: { fontSize: fontSize.base, color: colors.text.tertiary, fontWeight: fontWeight.medium },
  etaArrow: { color: colors.text.muted, fontSize: 16 },
  etaNew: { fontSize: fontSize.base, color: colors.status.success, fontWeight: fontWeight.bold },

  // Loading
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xl, justifyContent: 'center' },
  loadingText: { color: colors.text.muted, fontSize: fontSize.md },
});
