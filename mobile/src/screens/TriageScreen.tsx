import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTriageStore } from '../lib/useTriageStore';
import { api } from '../lib/api';
import type { TriageEvaluation, PreemptionDecision } from '../types';

// Priority colors
const PRIORITY_COLORS: Record<string, string> = {
  P0: '#dc2626',
  P1: '#ea580c',
  P2: '#ca8a04',
  P3: '#16a34a',
};

// SLA hours for reference
const SLA_HOURS: Record<string, number> = {
  P0: 2,
  P1: 6,
  P2: 24,
  P3: 72,
};

function formatCountdown(slaDeadline: string, now: number): string {
  const deadline = new Date(slaDeadline).getTime();
  const diff = deadline - now;

  if (diff <= 0) return 'BREACHED';

  const totalSec = Math.floor(diff / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function getStatusColor(status: 'ok' | 'warning' | 'breach'): string {
  switch (status) {
    case 'breach': return '#dc2626';
    case 'warning': return '#ea580c';
    case 'ok': return '#16a34a';
  }
}

function CountdownTimer({ slaDeadline, status }: { slaDeadline: string; status: 'ok' | 'warning' | 'breach' }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const countdown = formatCountdown(slaDeadline, now);
  const isBreached = countdown === 'BREACHED';

  return (
    <Text style={[
      s.countdown,
      { color: isBreached ? '#dc2626' : status === 'warning' ? '#ea580c' : '#f9fafb' },
    ]}>
      {countdown}
    </Text>
  );
}

function SlackProgressBar({ slackMinutes, priority }: { slackMinutes: number; priority: string }) {
  const totalMinutes = (SLA_HOURS[priority] || 24) * 60;
  const progress = Math.max(0, Math.min(1, slackMinutes / totalMinutes));
  const color = slackMinutes <= 0 ? '#dc2626' : slackMinutes < totalMinutes * 0.2 ? '#ea580c' : '#16a34a';

  return (
    <View style={s.progressContainer}>
      <View style={[s.progressBar, { width: `${Math.round(progress * 100)}%` as any, backgroundColor: color }]} />
    </View>
  );
}

function EvaluationCard({ evaluation, onPreempt }: { evaluation: TriageEvaluation; onPreempt: (id: string) => void }) {
  const priorityColor = PRIORITY_COLORS[evaluation.priority] || '#9ca3af';
  const isBreached = evaluation.status === 'breach';

  return (
    <View style={[s.evalCard, isBreached && s.evalCardBreached]}>
      <View style={s.evalHeader}>
        <View style={[s.priorityBadge, { backgroundColor: `${priorityColor}22`, borderColor: priorityColor }]}>
          <Text style={[s.priorityBadgeText, { color: priorityColor }]}>{evaluation.priority}</Text>
        </View>
        <View style={[s.statusBadge, { backgroundColor: `${getStatusColor(evaluation.status)}22` }]}>
          <Text style={[s.statusBadgeText, { color: getStatusColor(evaluation.status) }]}>
            {evaluation.status.toUpperCase()}
          </Text>
        </View>
        <CountdownTimer slaDeadline={evaluation.sla_deadline} status={evaluation.status} />
      </View>

      <Text style={s.supplyName}>{evaluation.supply_name}</Text>
      <Text style={s.nodeRoute}>
        {(evaluation as any).source_name || evaluation.source_node_id} → {(evaluation as any).target_name || evaluation.target_node_id}
      </Text>

      <View style={s.evalMeta}>
        <Text style={s.metaText}>Vehicle: {evaluation.vehicle_type}</Text>
        <Text style={s.metaText}>Slack: {evaluation.slack_minutes.toFixed(0)}m</Text>
      </View>

      <SlackProgressBar slackMinutes={evaluation.slack_minutes} priority={evaluation.priority} />

      {evaluation.preemption_eligible && (
        <TouchableOpacity
          style={s.preemptBtn}
          onPress={() => onPreempt(evaluation.delivery_id)}
        >
          <Text style={s.preemptBtnText}>Trigger Preemption</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function DecisionCard({ decision }: { decision: PreemptionDecision }) {
  const priorityColor = PRIORITY_COLORS[decision.priority] || '#9ca3af';

  return (
    <View style={s.decisionCard}>
      <View style={s.decisionHeader}>
        <View style={[s.priorityBadge, { backgroundColor: `${priorityColor}22`, borderColor: priorityColor }]}>
          <Text style={[s.priorityBadgeText, { color: priorityColor }]}>{decision.priority}</Text>
        </View>
        <Text style={s.decisionType}>{decision.decision_type.replace('_', ' ').toUpperCase()}</Text>
        <Text style={s.decisionTime}>{new Date(decision.created_at).toLocaleTimeString()}</Text>
      </View>
      <Text style={s.decisionSupply}>{decision.supply_name}</Text>
      <Text style={s.decisionRationale}>{decision.rationale}</Text>
      {decision.dropped_cargo && (
        <Text style={s.droppedCargo}>Dropped: {(Array.isArray(decision.dropped_cargo) ? decision.dropped_cargo : JSON.parse(decision.dropped_cargo || '[]')).join(', ')}</Text>
      )}
      <View style={s.etaRow}>
        <Text style={s.etaOld}>ETA: {new Date(decision.old_eta).toLocaleTimeString()}</Text>
        <Text style={s.etaArrow}> → </Text>
        <Text style={s.etaNew}>{new Date(decision.new_eta).toLocaleTimeString()}</Text>
      </View>
    </View>
  );
}

interface Props {
  onBack: () => void;
}

export default function TriageScreen({ onBack }: Props) {
  const {
    priorities,
    evaluations,
    decisions,
    loading,
    lastEvaluatedAt,
    breachCount,
    warningCount,
    fetchPriorities,
    runEvaluation,
    executePreemption,
    fetchDecisions,
  } = useTriageStore();

  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    fetchPriorities();
    fetchDecisions();
    runEvaluation();
  }, []);

  // WebSocket listener for triage events
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
            // Update state directly from WS payload — do NOT call runEvaluation()
            // as that would POST to server, which broadcasts again → infinite loop
            useTriageStore.setState({
              evaluations: msg.data.evaluations || [],
              breachCount: msg.data.breach_count || 0,
              warningCount: msg.data.warning_count || 0,
              lastEvaluatedAt: msg.data.evaluated_at || new Date().toISOString(),
            });
          } else if (msg.type === 'PREEMPTION_EXECUTED') {
            fetchDecisions();
          }
        } catch {}
      };
      ws.onerror = () => {};
    } catch {}

    return () => {
      try { ws?.close(); } catch {}
    };
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([runEvaluation(), fetchDecisions()]);
    setRefreshing(false);
  }, []);

  const handlePreempt = useCallback((deliveryId: string) => {
    Alert.alert(
      'Confirm Preemption',
      'This will preempt the current delivery to prioritize this urgent supply. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Preempt',
          style: 'destructive',
          onPress: () => executePreemption(deliveryId),
        },
      ],
    );
  }, [executePreemption]);

  const okCount = evaluations.filter((e) => e.status === 'ok').length;

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#dc2626" />}
      >
        {/* Header */}
        <View style={s.headerRow}>
          <TouchableOpacity onPress={onBack} style={s.backBtn}>
            <Text style={s.backBtnText}>Back</Text>
          </TouchableOpacity>
          <View style={s.headerCenter}>
            <Text style={s.title}>Triage Engine</Text>
            {lastEvaluatedAt && (
              <Text style={s.sub}>Updated {new Date(lastEvaluatedAt).toLocaleTimeString()}</Text>
            )}
          </View>
          <TouchableOpacity
            style={[s.evalBtn, loading && s.evalBtnDisabled]}
            onPress={runEvaluation}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator size="small" color="#fca5a5" />
            ) : (
              <Text style={s.evalBtnText}>Evaluate</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Stats Bar */}
        <View style={s.statsRow}>
          <View style={[s.statCard, { borderColor: '#dc2626' }]}>
            <Text style={[s.statNum, { color: '#dc2626' }]}>{breachCount}</Text>
            <Text style={s.statLabel}>Breach</Text>
          </View>
          <View style={[s.statCard, { borderColor: '#ea580c' }]}>
            <Text style={[s.statNum, { color: '#ea580c' }]}>{warningCount}</Text>
            <Text style={s.statLabel}>Warning</Text>
          </View>
          <View style={[s.statCard, { borderColor: '#16a34a' }]}>
            <Text style={[s.statNum, { color: '#16a34a' }]}>{okCount}</Text>
            <Text style={s.statLabel}>OK</Text>
          </View>
        </View>

        {/* Priority Taxonomy */}
        {priorities.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>PRIORITY TAXONOMY</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.taxonomyRow}>
              {priorities.map((p) => {
                const color = PRIORITY_COLORS[p.tier] || '#9ca3af';
                return (
                  <View key={p.tier} style={[s.taxonomyCard, { borderColor: color, backgroundColor: `${color}11` }]}>
                    <Text style={[s.taxonomyTier, { color }]}>{p.tier}</Text>
                    <Text style={s.taxonomyLabel}>{p.label}</Text>
                    <Text style={[s.taxonomySla, { color }]}>{p.sla_hours}h SLA</Text>
                    <Text style={s.taxonomyEx} numberOfLines={2}>{p.examples}</Text>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* Fallback taxonomy when not loaded */}
        {priorities.length === 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>PRIORITY TAXONOMY</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.taxonomyRow}>
              {Object.entries(SLA_HOURS).map(([tier, hours]) => {
                const color = PRIORITY_COLORS[tier];
                return (
                  <View key={tier} style={[s.taxonomyCard, { borderColor: color, backgroundColor: `${color}11` }]}>
                    <Text style={[s.taxonomyTier, { color }]}>{tier}</Text>
                    <Text style={[s.taxonomySla, { color }]}>{hours}h SLA</Text>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* Live SLA Countdown — Evaluations */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>ACTIVE DELIVERIES ({evaluations.length})</Text>
          {loading && evaluations.length === 0 && (
            <View style={s.loadingRow}>
              <ActivityIndicator color="#dc2626" />
              <Text style={s.loadingText}>Evaluating deliveries...</Text>
            </View>
          )}
          {evaluations.length === 0 && !loading && (
            <View style={s.emptyBox}>
              <Text style={s.emptyText}>No active deliveries to evaluate.</Text>
              <Text style={s.emptySubText}>Pull to refresh or tap Evaluate.</Text>
            </View>
          )}
          {evaluations.map((ev) => (
            <EvaluationCard key={ev.delivery_id} evaluation={ev} onPreempt={handlePreempt} />
          ))}
        </View>

        {/* Preemption Decision Log */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>DECISION LOG ({decisions.length})</Text>
          {decisions.length === 0 && (
            <View style={s.emptyBox}>
              <Text style={s.emptyText}>No preemption decisions yet.</Text>
            </View>
          )}
          {decisions.map((d) => (
            <DecisionCard key={d.id} decision={d} />
          ))}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#030712' },
  content: { padding: 20, paddingTop: 12 },

  // Header
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  backBtn: {
    backgroundColor: '#1f2937',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#374151',
  },
  backBtnText: { color: '#9ca3af', fontSize: 13, fontWeight: '600' },
  headerCenter: { flex: 1, alignItems: 'center' },
  title: { fontSize: 18, fontWeight: 'bold', color: '#f9fafb' },
  sub: { fontSize: 11, color: '#9ca3af', marginTop: 2 },
  evalBtn: {
    backgroundColor: '#7f1d1d',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#dc2626',
    minWidth: 72,
    alignItems: 'center',
  },
  evalBtnDisabled: { opacity: 0.5 },
  evalBtnText: { color: '#fca5a5', fontSize: 13, fontWeight: '600' },

  // Stats
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  statCard: {
    flex: 1,
    backgroundColor: '#111827',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
  },
  statNum: { fontSize: 28, fontWeight: 'bold' },
  statLabel: { fontSize: 11, color: '#9ca3af', marginTop: 2, fontWeight: '600' },

  // Sections
  section: { marginBottom: 20 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#9ca3af',
    letterSpacing: 1,
    marginBottom: 10,
  },

  // Taxonomy cards
  taxonomyRow: { gap: 10, paddingRight: 20 },
  taxonomyCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    width: 130,
  },
  taxonomyTier: { fontSize: 22, fontWeight: 'bold', marginBottom: 2 },
  taxonomyLabel: { fontSize: 12, color: '#d1d5db', fontWeight: '600', marginBottom: 4 },
  taxonomySla: { fontSize: 14, fontWeight: '700', marginBottom: 4 },
  taxonomyEx: { fontSize: 10, color: '#9ca3af', lineHeight: 14 },

  // Evaluation cards
  evalCard: {
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
  },
  evalCardBreached: {
    borderColor: '#dc2626',
    backgroundColor: '#1c0a0a',
  },
  evalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  priorityBadge: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  priorityBadgeText: { fontSize: 12, fontWeight: 'bold' },
  statusBadge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statusBadgeText: { fontSize: 10, fontWeight: 'bold' },
  countdown: { fontSize: 16, fontWeight: 'bold', marginLeft: 'auto' },
  supplyName: { fontSize: 15, fontWeight: '600', color: '#f9fafb', marginBottom: 2 },
  nodeRoute: { fontSize: 12, color: '#9ca3af', marginBottom: 8 },
  evalMeta: { flexDirection: 'row', gap: 16, marginBottom: 8 },
  metaText: { fontSize: 12, color: '#6b7280' },

  // Progress bar
  progressContainer: {
    height: 4,
    backgroundColor: '#374151',
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 10,
  },
  progressBar: { height: 4, borderRadius: 2 },

  // Preempt button
  preemptBtn: {
    backgroundColor: '#7f1d1d',
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#dc2626',
  },
  preemptBtnText: { color: '#fca5a5', fontSize: 13, fontWeight: '600' },

  // Decision cards
  decisionCard: {
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  decisionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  decisionType: { fontSize: 11, fontWeight: '600', color: '#d1d5db', flex: 1 },
  decisionTime: { fontSize: 11, color: '#6b7280' },
  decisionSupply: { fontSize: 14, fontWeight: '600', color: '#f9fafb', marginBottom: 4 },
  decisionRationale: { fontSize: 12, color: '#9ca3af', lineHeight: 18, marginBottom: 6 },
  droppedCargo: { fontSize: 11, color: '#f87171', marginBottom: 4 },
  etaRow: { flexDirection: 'row', alignItems: 'center' },
  etaOld: { fontSize: 12, color: '#9ca3af' },
  etaArrow: { fontSize: 12, color: '#374151' },
  etaNew: { fontSize: 12, color: '#22c55e', fontWeight: '600' },

  // Loading / empty
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 20, justifyContent: 'center' },
  loadingText: { color: '#9ca3af', fontSize: 13 },
  emptyBox: { paddingVertical: 20, alignItems: 'center' },
  emptyText: { color: '#6b7280', fontSize: 14 },
  emptySubText: { color: '#4b5563', fontSize: 12, marginTop: 4 },
});
